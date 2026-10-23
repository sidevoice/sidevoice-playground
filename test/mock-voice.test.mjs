import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../preview/mock/world.mjs";
import { desktopEngine, localModels, providerView, webEngine, SAMPLE_KEYS } from "../preview/mock/models.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { simulateAgent } from "../preview/mock/card.mjs";
import { exportedNames, mockChunk, packageOf } from "../preview/mock/chunks.mjs";
import { mockModule } from "../preview/mock/attach.mjs";
import { seededStorage, makeIdentities } from "../preview/mock/machines.mjs";
import { loadMockScenarios } from "../preview/proxy.mjs";

const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const world = (voice = {}) => createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice } }, {}, instant);

test("the mocked speaker has its own levels, including zero gaps during playback, and clears on every end", async () => {
  const w = world();
  const voice = fakeVoice(w);
  const output = [], mic = [], states = [];
  const stop = voice.host.onPlaybackLevel((level) => output.push([voice.state.playback, level]));
  voice.host.onLevel((level) => mic.push(level));
  voice.host.onState((state) => states.push(state.playback));
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" } });
  await voice.host.start();
  assert.deepEqual(await voice.host.say("Hello there.").outcome, { status: "heard" });
  assert.ok(output.some(([, level]) => level > 0));
  assert.ok(output.some(([phase, level]) => phase === "playing" && level === 0));
  assert.equal(output.at(-1)[1], 0);
  assert.deepEqual(mic, [], "speaker output never leaks into the microphone channel");
  const first = voice.host.say("Short.");
  const second = voice.host.say("A much longer overlapping reply that keeps sounding after the first finishes.");
  assert.deepEqual(await first.outcome, { status: "heard" });
  assert.equal(voice.state.playback, "playing", "one completed reply cannot idle another");
  assert.deepEqual(await second.outcome, { status: "heard" });
  assert.ok(output.filter(([, level]) => level > 0).every(([phase]) => phase === "playing"), "positive output is always reported under playing");
  assert.equal(output.at(-1)[1], 0);
  const running = voice.host.say("A longer sentence, with enough time to cancel.");
  const continuing = voice.host.say("Another long reply that continues to sound after its neighbor is cancelled.");
  for (let i = 0; i < 12 && voice.state.playback !== "playing"; i++) await new Promise((resolve) => setImmediate(resolve));
  running.cancel();
  await running.outcome;
  assert.equal(voice.state.playback, "playing", "cancelling one reply cannot idle another");
  await continuing.outcome;
  assert.equal(output.at(-1)[1], 0);
  w.patch({ "voice.tts": "error" });
  await voice.host.say("Failure").outcome;
  assert.equal(output.at(-1)[1], 0);
  w.patch({ "voice.tts": "ok" });
  const beforeStop = output.length;
  const stopping = voice.host.say("This reply is long enough to stop while its envelope is still moving.");
  for (let i = 0; i < 12 && !output.slice(beforeStop).some(([phase, level]) => phase === "playing" && level > 0); i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(output.slice(beforeStop).some(([phase, level]) => phase === "playing" && level > 0));
  await voice.host.stop();
  await stopping.outcome;
  const stoppedCount = output.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(output.at(-1)[1], 0);
  assert.equal(output.length, stoppedCount, "the stopped reply publishes no late levels");
  stop();
  const count = output.length;
  await voice.host.say("Not started").outcome;
  assert.equal(output.length, count);
  assert.ok(states.includes("synthesizing") && states.includes("playing"));
});

test("direct agent simulation gives the stage output envelopes and abandons old timers", async () => {
  const facts = { viewedThread: "fp|one", sessionId: "s", history: [], roomBinding: null, botLive: false, karaokeState: null };
  const store = { getState: () => ({ facts, participants: [{ threadId: "fp|one", title: "Agent" }] }), patch: (values) => Object.assign(facts, values) };
  const levels = [];
  const playbackLevel = { clear: () => levels.push(["clear", 0]), publish: (level, thread) => levels.push([thread, level]) };
  const frame = { contentWindow: { sidevoiceUI: { store, playbackLevel } } };
  const pending = [];
  const wait = () => new Promise((resolve) => pending.push(resolve));
  const advance = async () => { pending.shift()(); await new Promise((resolve) => setImmediate(resolve)); };
  assert.equal(simulateAgent(frame, "one two", { wait }), true);
  assert.equal(facts.botLive, true);
  assert.deepEqual(levels.at(-1), ["fp|one", 0.36]);
  for (let i = 0; i < 8; i++) await advance();
  assert.ok(levels.some(([thread, level]) => thread === "fp|one" && level === 0));
  assert.equal(facts.botLive, true);
  await advance();
  assert.equal(facts.botLive, false);
  assert.deepEqual(levels.at(-1), ["clear", 0]);
  assert.equal(simulateAgent(frame, "old", { wait }), true);
  const switchedSegment = facts.history.at(-1).segment;
  const oldWait = pending.shift();
  facts.viewedThread = "fp|other";
  oldWait();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(facts.history.find((row) => row.segment === switchedSegment).audio, "interrupted");
  assert.equal(facts.botLive, false);
  assert.equal(facts.karaokeState, null);
  facts.viewedThread = "fp|one";
  assert.equal(simulateAgent(frame, "old again", { wait }), true);
  const replacedSegment = facts.history.at(-1).segment;
  const replacedWait = pending.shift();
  assert.equal(simulateAgent(frame, "new", { wait }), true);
  const newSegment = facts.history.at(-1).segment;
  const count = levels.length;
  replacedWait();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(levels.length, count, "abandoned playback published nothing");
  assert.equal(facts.history.find((row) => row.segment === replacedSegment).audio, "interrupted");
  assert.equal(facts.botLive, true, "the replaced run cannot stop its successor");
  assert.equal(facts.karaokeState.segment, newSegment);
});

test("direct simulation uses the first participant when no conversation is explicitly selected", async () => {
  const facts = { viewedThread: null, sessionId: "s", history: [], roomBinding: null, botLive: false, karaokeState: null };
  const store = { getState: () => ({ facts, participants: [{ threadId: "fp|first", title: "First" }] }), patch: (values) => Object.assign(facts, values) };
  const levels = [];
  const frame = { contentWindow: { sidevoiceUI: { store, playbackLevel: { clear() {}, publish: (level) => levels.push(level) } } } };
  assert.equal(simulateAgent(frame, "Hello", { wait: () => Promise.resolve() }), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(levels.some((level) => level > 0));
  assert.equal(facts.history[0].audio, "played");
  assert.equal(facts.botLive, false);
});

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

test("a build that runs says the kind of hardware its accelerator is, as the engine does; one that does not says none", () => {
  const w = world();
  const classes = (place, id) => Object.fromEntries(localModels(w, place).find((m) => m.id === id).builds.map((b) => [b.id.split("/")[1], b.acceleratorClass ?? null]));
  assert.deepEqual(classes("desktop", "whisper-base"), {
    "mlx-fp16": "gpu", "sherpa-onnx-int8": "cpu", "whisper-cpp-q5_1": "gpu", "transformers-js-fp16": null, "transformers-js-q8": null,
  });
  assert.deepEqual(classes("browser", "whisper-tiny"), {
    "transformers-js-fp16": "gpu", "transformers-js-q8": "gpu", "mlx-fp16": null, "sherpa-onnx-int8": null, "whisper-cpp-q5_1": null,
  });
  w.patch({ "voice.webgpu": false });
  assert.equal(classes("browser", "kokoro-82m-v1.0")["transformers-js-q8"], "cpu", "WebAssembly runs on the processor");
});

test("a model's last use: dated back in days by the scenario, until the world sees a newer one", () => {
  const now = Date.parse("2026-10-11T12:00:00Z");
  const voice = { installed: { "silero-vad": true, "whisper-small": true }, lastUsedDaysAgo: { "whisper-small": 45, "whisper-tiny": 3 } };
  const w = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice } }, {}, { ...instant, now: () => now });
  const model = (id) => localModels(w, "browser").find((m) => m.id === id);
  assert.equal(model("whisper-small").lastUsedAt, now - 45 * 86_400_000);
  assert.equal(model("silero-vad").lastUsedAt, null, "installed, never dated nor used");
  assert.equal("lastUsedAt" in model("whisper-tiny"), false, "not installed: nothing to say");
  w.patch({ "voice.lastUsed": { "whisper-small": now - 1000 } });
  assert.equal(model("whisper-small").lastUsedAt, now - 1000);
});

test("a model is dated as used when a call or a try loads it, not when it is installed", async () => {
  let now = Date.parse("2026-10-12T09:00:00Z");
  const w = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice: {} } }, {}, { ...instant, now: () => now });
  const model = (id) => localModels(w, "desktop").find((m) => m.id === id);
  await desktopEngine(w).install("whisper-base");
  assert.equal(model("whisper-base").installed, true);
  assert.equal(model("whisper-base").lastUsedAt, null, "installed, never loaded");
  now += 60_000;
  const voice = fakeVoice(w);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "openai", model: "tts-1" } });
  w.patch({ "voice.keys": { openai: "sk" } });
  await voice.host.start();
  assert.equal(model("whisper-base").lastUsedAt, now, "loaded by the start of a call or a try");
  assert.equal(model("silero-vad").lastUsedAt, now);
});

test("a build chosen other than the recommended one is the one installed, and the model with it", async () => {
  const w = world();
  const model = () => localModels(w, "desktop").find((m) => m.id === "whisper-base");
  assert.equal(model().recommendedBuild, "whisper-base/mlx-fp16");
  await desktopEngine(w).install("whisper-base", { build: "whisper-base/sherpa-onnx-int8" });
  assert.equal(model().installed, true);
  assert.deepEqual(model().builds.filter((b) => b.installed).map((b) => b.id), ["whisper-base/sherpa-onnx-int8"]);
  await desktopEngine(w).install("whisper-base", { build: "whisper-base/whisper-cpp-q5_1" });
  assert.deepEqual(model().builds.filter((b) => b.installed).map((b) => b.id).sort(), ["whisper-base/sherpa-onnx-int8", "whisper-base/whisper-cpp-q5_1"]);
  await desktopEngine(w).uninstall("whisper-base");
  assert.equal(model().installed, false);
  assert.equal(model().builds.some((b) => b.installed), false);
  // A scenario's `true` is the recommended build.
  w.patch({ "voice.installed": { "whisper-base": true } });
  assert.deepEqual(model().builds.filter((b) => b.installed).map((b) => b.id), ["whisper-base/mlx-fp16"]);
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

test("a turn ends after the silence the settings wait; a pause shorter than it is still the turn; cut off, the person goes on in a new turn the cut one merges into", async () => {
  const w = world();
  const voice = fakeVoice(w);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" }, end_of_turn: "silence", patience: "calm" });
  const turns = [];
  const recognising = [];
  voice.host.onTurn((t) => turns.push(t));
  voice.host.onState((s) => recognising.push(s.recognising));
  await voice.host.start();
  await voice.speak("uno dos tres cuatro", { pause: true });
  assert.deepEqual(turns.map((t) => t.phase), ["started", "finished"]);
  assert.equal(turns[1].timings.endpoint_silence_ms, 3500);
  assert.equal(recognising.filter((n) => n === 1).length, 1, "the pause did not end the turn");
  turns.length = 0;
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" }, end_of_turn: "smart-turn", patience: "fast" });
  await voice.speak("uno dos tres cuatro", { cutOff: true });
  assert.deepEqual(turns.map((t) => `${t.phase}:${t.turn_id}${t.merged ? ":merged" : ""}`), ["started:mock-call-1-turn-2", "started:mock-call-1-turn-3", "cancelled:mock-call-1-turn-2:merged", "finished:mock-call-1-turn-3:merged"]);
  assert.equal(turns.at(-1).text, "uno dos tres cuatro");
  assert.equal(turns.at(-1).timings.endpoint_silence_ms, 600);
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
  // Its note of the key's last four is the page's, in both.
  for (const desktop of [false, true]) {
    assert.equal(JSON.parse(seededStorage(w.state, ids, 0, { desktop })["sidevoice.provider-key-hint.openai"]).last4, SAMPLE_KEYS.accepted.slice(-4));
  }
  assert.equal(seededStorage(w.state, ids, 0)["sidevoice.provider-key-hint.elevenlabs"], undefined);
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

test("a try's take (web gap #40): asked for, what the voice heard from listening to stopping — the speech voiced at its levels, the pauses quiet, the marks where its turns were told", async () => {
  // The world's clock moves only as the mocks wait, so a take's length and marks are exact.
  let clock = 0;
  const timed = { now: () => clock, tick: (ms) => { clock += ms; return new Promise((r) => setImmediate(r)); } };
  const w = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice: {} } }, {}, timed);
  const voice = fakeVoice(w);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" }, end_of_turn: "silence", patience: "normal" });
  const takes = [];
  const turns = [];
  voice.host.onTake((take) => takes.push(take));
  voice.host.onTurn((turn) => turns.push(turn));
  await voice.host.start({ take: true });
  const listened = clock;
  clock += 1000;
  // "uno dos" (990 ms), a pause shorter than the 2.5 s the end waits (1.5 s), "tres cuatro" (990 ms), then the end.
  await voice.speak("uno dos tres cuatro", { pause: true });
  assert.deepEqual(takes, [], "handed only once the voice stops");
  await voice.host.stop();
  assert.equal(takes.length, 1);
  const [take] = takes;
  assert.equal(take.sampleRate, 16000);
  assert.equal(take.started_at, listened);
  assert.equal(take.ended_at, clock);
  assert.equal(take.samples.length, ((clock - listened) / 1000) * 16000);
  assert.deepEqual(take.turns, [{ turn_id: "mock-call-1-turn-1", speech_ms: 1000, pauses: [{ from_ms: 2500, to_ms: 4000 }], end_ms: 8000 }]);
  // Its marks are the turn the voice told: it started where the take says speech did.
  assert.equal(turns[0].started_at - take.started_at, take.turns[0].speech_ms);
  // Loud where the person spoke, quiet before, in the pause, and in the silence the end waited for.
  const rms = (from, to) => {
    const part = take.samples.subarray((from * 16000) / 1000, (to * 16000) / 1000);
    return Math.sqrt(part.reduce((sum, x) => sum + x * x, 0) / part.length);
  };
  for (const [from, to] of [[1000, 2500], [4000, 5500]]) assert.ok(rms(from, to) > 0.05, `speech ${from}–${to}`);
  for (const [from, to] of [[0, 1000], [2500, 4000], [5500, 8000]]) assert.ok(rms(from, to) < 0.005, `quiet ${from}–${to}`);
  assert.ok(take.samples.every((x) => Math.abs(x) <= 1), "within full scale");

  // Not asked for (a call), or a voice without takes (0.3.x): nothing.
  await voice.host.start();
  await voice.speak("hola");
  await voice.host.stop();
  w.patch({ "voice.take": false });
  await voice.host.start({ take: true });
  await voice.speak("hola");
  await voice.host.stop();
  assert.equal(takes.length, 1);
});

test("a cut-off's take marks both turns: the end decided too soon, and the turn the person went on in", async () => {
  let clock = 0;
  const timed = { now: () => clock, tick: (ms) => { clock += ms; return new Promise((r) => setImmediate(r)); } };
  const w = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice: {} } }, {}, timed);
  const voice = fakeVoice(w);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" }, end_of_turn: "smart-turn", patience: "fast" });
  const takes = [];
  voice.host.onTake((take) => takes.push(take));
  await voice.host.start({ take: true });
  await voice.speak("uno dos tres cuatro", { cutOff: true });
  await voice.host.stop();
  // 990 ms said, 600 ms to the cut, 400 ms recognising, then the rest: 990 ms, and 600 ms to its end.
  assert.deepEqual(takes[0].turns, [
    { turn_id: "mock-call-1-turn-1", speech_ms: 0, pauses: [], end_ms: 2100 },
    { turn_id: "mock-call-1-turn-2", speech_ms: 2500, pauses: [], end_ms: 4600 },
  ]);
});

test("a take keeps silence while the person has the microphone muted, as the voice does", async () => {
  let clock = 0;
  const timed = { now: () => clock, tick: (ms) => { clock += ms; return new Promise((r) => setImmediate(r)); } };
  const w = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice: {} } }, {}, timed);
  const voice = fakeVoice(w);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" }, end_of_turn: "silence", patience: "normal" });
  const takes = [];
  voice.host.onTake((take) => takes.push(take));
  await voice.host.start({ take: true });
  const listened = clock;
  clock += 1000;
  voice.host.mute(true);
  const muted = clock - listened;
  clock += 1500;
  assert.equal(await voice.speak("no me oyes"), false, "muted: not heard");
  voice.host.mute(false);
  const unmuted = clock - listened;
  clock += 1000;
  await voice.host.stop();
  const [take] = takes;
  const part = (from, to) => take.samples.subarray((from * 16000) / 1000, (to * 16000) / 1000);
  assert.ok(part(muted, unmuted).every((x) => x === 0), "silence while muted");
  for (const [from, to] of [[0, muted], [unmuted, unmuted + 1000]]) assert.ok(part(from, to).some((x) => x !== 0), `the microphone's hiss ${from}–${to}`);
  assert.deepEqual(take.turns, []);
});
