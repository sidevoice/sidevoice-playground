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
  assert.equal(kokoro("browser").recommendedBuild, "kokoro-82m-v1.0/transformers-js-fp32");
  assert.equal(kokoro("desktop").recommendedBuild, "kokoro-82m-v1.0/sherpa-onnx-int8");
  assert.equal(localModels(w, "browser").find((m) => m.id === "piper-es_ES-carlfm-x_low").builds[0].available, false);
  w.patch({ "voice.installed": { "silero-vad": true, "kokoro-82m-v1.0": true } });
  assert.equal(kokoro("browser").installed, true);
  assert.deepEqual(kokoro("browser").builds.filter((b) => b.installed).map((b) => b.id), ["kokoro-82m-v1.0/transformers-js-fp32"]);
  assert.ok(kokoro("browser").voices.length > 0);
  w.patch({ "voice.installed": { "silero-vad": true }, "voice.voicesOnceInstalled": false });
  assert.ok(localModels(w, "browser").find((m) => m.id === "kokoro-82m-v1.0").voices.length > 0);
});

test("the local catalogue is the engine's v0.3.1, each build placed as the engine's resolver places it", async () => {
  const w = world();
  assert.deepEqual(localModels(w, "browser").map((m) => m.id), [
    "canary-180m-flash", "fastconformer-es-large", "kokoro-82m-v0.19", "kokoro-82m-v1.0", "parakeet-tdt-0.6b-v3",
    "piper-es_ES-carlfm-x_low", "piper-en_US-ljspeech-medium", "qwen3-asr-0.6b", "silero-vad", "smart-turn-v3.2",
    "supertonic-3", "supertonic-2", "whisper-tiny", "whisper-base", "whisper-small", "whisper-large-v3", "whisper-large-v3-turbo",
  ]);
  const model = (place, id) => localModels(w, place).find((m) => m.id === id);
  const placed = (place, id) => Object.fromEntries(model(place, id).builds.map((b) => [b.id.split("/")[1], b.accelerator ?? b.reasons.map((r) => r.code).join()]));
  assert.deepEqual(await webEngine(w, {}).backends(), ["transformers-js"]);

  // A browser with WebGPU: transformers.js takes it first, wherever a build does not ask for WebAssembly.
  assert.deepEqual(placed("browser", "whisper-tiny"), {
    "transformers-js-fp16": "webgpu", "transformers-js-q8": "webgpu",
    "mlx-fp16": "backend-not-in-this-build", "sherpa-onnx-int8": "backend-not-in-this-build", "whisper-cpp-q5_1": "backend-not-in-this-build",
  });
  assert.equal(placed("browser", "kokoro-82m-v1.0")["transformers-js-q8"], "wasm");
  assert.equal(placed("browser", "smart-turn-v3.2")["onnxruntime-int8"], "backend-not-in-this-build");
  const large = model("browser", "whisper-large-v3");
  assert.equal(large.recommendedBuild, "whisper-large-v3/transformers-js-fp16");
  assert.deepEqual(large.builds.find((b) => b.id.endsWith("q8")).reasons, [{ code: "wasm-memory", params: { needs: 2260, has: 2048 } }]);

  // Without WebGPU, its builds do not run, and the large model has none that does.
  w.patch({ "voice.webgpu": false });
  assert.deepEqual(placed("browser", "kokoro-82m-v1.0")["transformers-js-fp32"], "build-accelerator");
  assert.equal(model("browser", "kokoro-82m-v1.0").recommendedBuild, "kokoro-82m-v1.0/transformers-js-q8");
  assert.equal(model("browser", "whisper-tiny").recommendedBuild, "whisper-tiny/transformers-js-q8");
  assert.equal(model("browser", "whisper-large-v3").recommendedBuild, undefined);
  await assert.rejects(webEngine(w, {}).install("whisper-large-v3"), (e) => e.code === "no-build-available");
  await assert.rejects(webEngine(w, {}).install("whisper-base", "whisper-base/transformers-js-fp16"), (e) => e.code === "build-accelerator");

  // The Mac: MLX and whisper.cpp on Metal, sherpa-onnx and ONNX Runtime on the CPU, transformers.js not there.
  assert.deepEqual(placed("desktop", "whisper-base"), {
    "mlx-fp16": "metal", "sherpa-onnx-int8": "cpu", "whisper-cpp-q5_1": "metal",
    "transformers-js-fp16": "backend-not-in-this-build", "transformers-js-q8": "backend-not-in-this-build",
  });
  assert.equal(model("desktop", "smart-turn-v3.2").recommendedBuild, "smart-turn-v3.2/onnxruntime-fp32");
});

test("an install downloads the build it installs", async () => {
  const w = world();
  const sizes = [];
  await webEngine(w, {}).install("whisper-small", undefined, (p) => sizes.push(p.size));
  assert.equal(sizes.at(-1), 488e6, "transformers.js fp16, the first that runs in a browser with WebGPU");
  sizes.length = 0;
  await desktopEngine(w).install("whisper-small", { build: "whisper-small/whisper-cpp-q5_1", onProgress: (p) => sizes.push(p.total) });
  assert.equal(sizes.at(-1), 190e6);
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

test("the mocked voice's microphone and speaker: chosen by id, followed as the headset comes and goes, the speaker sometimes fixed", async () => {
  const voice = fakeVoice(world());
  const seen = [];
  voice.host.onAudioDevices((devices) => seen.push(devices));
  const first = await voice.host.audioDevices();
  assert.deepEqual([first.inputs.map((d) => d.id), first.input, first.output, first.outputSelectable], [["mic-builtin", "mic-headset"], null, null, true]);
  assert.equal((await voice.host.setAudioDevices({ input: "mic-headset", output: "out-headset" })).input, "mic-headset");
  await assert.rejects(voice.host.setAudioDevices({ input: "mic-gone" }), { code: "microphone-unavailable" });
  // The headset unplugged: what was chosen of it is lost, the default in use, said once.
  voice.plugHeadset(false);
  assert.deepEqual([seen.at(-1).input, seen.at(-1).output, seen.at(-1).lost], [null, null, { input: "mic-headset", output: "out-headset" }]);
  voice.plugHeadset(true);
  assert.equal(seen.at(-1).lost, undefined);
  voice.outputSelectable(false);
  assert.equal(seen.at(-1).outputSelectable, false);
  await assert.rejects(voice.host.setAudioDevices({ output: "out-builtin" }), { code: "audio-output-unselectable" });
});
