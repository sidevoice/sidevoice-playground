import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../preview/mock/world.mjs";
import { desktopEngine, localModels, providerView, webEngine, SAMPLE_KEYS } from "../preview/mock/models.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { exportedNames, mockChunk, packageOf } from "../preview/mock/chunks.mjs";
import { mockModule } from "../preview/mock/attach.mjs";
import { seededStorage, makeIdentities } from "../preview/mock/machines.mjs";
import { loadMockScenarios } from "../preview/proxy.mjs";

const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const world = (voice = {}) => createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice } }, {}, instant);

test("local models run by place, list their voices once installed, and say which build to take", () => {
  const w = world();
  const kokoro = (place) => localModels(w, place).find((m) => m.id === "kokoro-82m-v1.0");
  assert.deepEqual(kokoro("browser").voices, []);
  assert.equal(kokoro("browser").recommendedBuild, "kokoro-82m-v1.0/transformers-js-q8");
  assert.equal(kokoro("desktop").recommendedBuild, "kokoro-82m-v1.0/sherpa-onnx-int8");
  assert.equal(localModels(w, "browser").find((m) => m.id === "piper-es_ES-carlfm-x_low").builds[0].available, false);
  w.patch({ "voice.installed": { "silero-vad": true, "kokoro-82m-v1.0": true } });
  assert.equal(kokoro("browser").installed, true);
  assert.ok(kokoro("browser").voices.length > 0);
  w.patch({ "voice.installed": { "silero-vad": true }, "voice.voicesOnceInstalled": false });
  assert.ok(localModels(w, "browser").find((m) => m.id === "kokoro-82m-v1.0").voices.length > 0);
});

test("providers: no key, a rejected one, an accepted one, none reachable", () => {
  const w = world();
  assert.equal(providerView(w, "openai", null).status.reason.code, "credential-missing");
  assert.equal(providerView(w, "openai", SAMPLE_KEYS.rejected).status.reason.code, "credential-rejected");
  assert.ok(providerView(w, "openai", SAMPLE_KEYS.accepted).models.some((m) => m.capabilities.includes("tts")));
  w.patch({ "voice.providers": "unreachable" });
  assert.equal(providerView(w, "openai", SAMPLE_KEYS.accepted).status.reason.code, "provider-unreachable");
});

test("the desktop app's engine installs with progress, cancels, fails, and keeps keys", async () => {
  const w = world();
  const engine = desktopEngine(w);
  const fractions = [];
  await engine.install("whisper-base", { onProgress: (p) => fractions.push(p.fraction) });
  assert.equal(fractions.at(-1), 1);
  assert.equal((await engine.catalogs())[0].models.find((m) => m.id === "whisper-base").installed, true);
  const abort = new AbortController();
  const running = engine.install("whisper-small", { signal: abort.signal });
  abort.abort();
  await assert.rejects(running, (e) => e.code === "install-cancelled");
  w.patch({ "voice.install": "fail" });
  await assert.rejects(engine.install("whisper-small"), (e) => e.code === "download-failed");
  assert.equal(await engine.hasCredential("openai"), false);
  await engine.setCredential("openai", SAMPLE_KEYS.accepted);
  assert.equal(await engine.hasCredential("openai"), true);
  assert.equal((await engine.catalogs()).find((c) => c.id === "openai").models.length > 0, true);
});

test("the browser's WebEngine reads the page's keys, lists by capability, and installs the engine's way", async () => {
  const w = world();
  const keys = { openai: SAMPLE_KEYS.accepted };
  const engine = await mockModule("engine", w).WebEngine.create({ credential: async (p) => keys[p] ?? null });
  assert.deepEqual(engine.catalogs().map((c) => c.id), ["local", "openai", "elevenlabs"]);
  assert.deepEqual((await engine.localCatalog().models("vad")).map((m) => m.id), ["silero-vad"]);
  assert.equal((await engine.catalog("openai").models("stt")).every((m) => m.capabilities.includes("stt")), true);
  await assert.rejects(engine.catalog("elevenlabs").models(), (e) => e.code === "credential-missing");
  const progress = [];
  await engine.install("kokoro-82m-v1.0", undefined, (p) => progress.push(p));
  assert.equal(progress.at(-1).done, progress.at(-1).files);
  assert.equal((await engine.localCatalog().models("tts")).find((m) => m.id === "kokoro-82m-v1.0").installed, true);
});

test("the voice hears what the card says while it listens, and fails as the world says", async () => {
  const w = world();
  const voice = fakeVoice(w);
  assert.equal(await voice.speak("hola"), false, "not listening yet");
  await assert.rejects(voice.host.start(), (e) => e.code === "settings-missing");
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" } });
  const turns = [];
  const states = [];
  voice.host.onTurn((t) => turns.push(t));
  voice.host.onState((s) => states.push(s.listening));
  await voice.host.start();
  assert.equal(await voice.speak("Hola, ¿me oyes?"), true);
  assert.deepEqual(turns.map((t) => t.phase), ["started", "finished"]);
  assert.equal(turns[1].text, "Hola, ¿me oyes?");
  assert.ok(states.includes("speaking"));
  w.patch({ "voice.stt": "error" });
  const errors = [];
  voice.host.onError((e) => errors.push(e.code));
  await voice.speak("otra");
  assert.deepEqual(errors, ["transcription-failed"]);
  const saying = voice.host.say("Una frase. Y otra.");
  const events = [];
  saying.onEvent((e) => events.push(e.type));
  assert.deepEqual(await saying.outcome, { status: "heard" });
  await new Promise((r) => setImmediate(r));
  assert.equal(events.at(-1), "done");
  w.patch({ "voice.tts": "error" });
  assert.equal((await voice.host.say("x").outcome).code, "speech-failed");
  await voice.host.stop();
  assert.equal((await voice.host.say("x").outcome).status, "not-played");
  w.patch({ "voice.mic": "denied" });
  await assert.rejects(voice.host.start(), (e) => e.code === "microphone-denied");
});

test("in the desktop app a provider's model without its key is refused; in the browser the page's source decides", async () => {
  const w = world();
  const app = fakeVoice(w);
  await app.host.setSettings({ stt: { catalog: "openai", model: "gpt-4o-transcribe" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" } });
  await assert.rejects(app.host.start(), (e) => e.code === "credential-missing");
  const page = fakeVoice(w, { source: { models: async () => { throw Object.assign(new Error("model-unknown"), { code: "model-unknown" }); } } });
  await page.host.setSettings({ stt: {}, tts: {} });
  await assert.rejects(page.host.start(), (e) => e.code === "model-unknown");
});

test("package chunks are told by their exports, and served as the shell's mocks under the same names", () => {
  const engine = exportedNames("var a;export{h as EndOfTurn,C as WebEngine,Re as default,Fe as initSync}");
  assert.deepEqual(engine, ["EndOfTurn", "WebEngine", "default", "initSync"]);
  assert.equal(packageOf(engine), "engine");
  assert.equal(packageOf(["IoSink", "createVoiceHost", "default"]), "voice");
  assert.equal(packageOf(["A", "B"]), null);
  const code = mockChunk("engine", engine);
  assert.match(code, /module\("engine"\)/);
  assert.match(code, /export const WebEngine = mocked\["WebEngine"\];/);
  assert.match(code, /export default mocked\["default"\];/);
});

test("the browser keeps the provider keys the world says; the app keeps its own", async () => {
  const w = world({ keys: { openai: SAMPLE_KEYS.accepted } });
  const ids = await makeIdentities({ machines: {} });
  assert.equal(seededStorage(w.state, ids, 0)["sidevoice.provider-key.openai"], SAMPLE_KEYS.accepted);
  assert.equal(seededStorage(w.state, ids, 0, { desktop: true })["sidevoice.provider-key.openai"], undefined);
});

test("every scenario offers the voice's and the models' options", async () => {
  for (const s of await loadMockScenarios()) {
    for (const id of ["mic", "stt", "tts", "installed", "install", "keys"]) assert.ok(s.options.some((o) => o.id === id), `${s.id}: ${id}`);
  }
});
