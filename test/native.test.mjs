import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSamples, encodeSamples, nativeEngine, onNativeExit, prepareNative, tauri } from "../web/engine/native.mjs";

const SHA = "de128c8f0e2b1a3c4d5e6f708192a3b4c5d6e7f8";

/** The app as the page sees it: `answers(command, args)` answers each invoke; events are emitted by hand. */
function fakeApp(answers) {
  const listeners = new Map();
  const calls = [];
  return {
    calls,
    emit(name, payload) {
      for (const handler of listeners.get(name) ?? []) handler({ payload });
    },
    listening: (name) => (listeners.get(name) ?? []).length,
    core: {
      invoke: async (command, args) => {
        calls.push([command, args]);
        return answers(command, args);
      },
    },
    event: {
      listen: async (name, handler) => {
        listeners.set(name, [...(listeners.get(name) ?? []), handler]);
        return () => listeners.set(name, listeners.get(name).filter((h) => h !== handler));
      },
    },
  };
}

test("the app's Tauri API is found when there is one", () => {
  assert.equal(tauri({}), null);
  const api = {};
  assert.equal(tauri({ __TAURI__: api }), api);
});

test("preparing a native engine: the build's lines reach the page, and its hello comes back", async () => {
  const lines = [];
  let app;
  app = fakeApp(async (command, { job }) => {
    assert.equal(command, "native_prepare");
    app.emit("native-build", { job, line: "== cargo build --release" });
    app.emit("native-build", { job: "another", line: "not this build's" });
    return { protocol: 1, engine: "0.1.0", rev: SHA, dataDir: "/data" };
  });
  const hello = await prepareNative(app, SHA, { onLine: (line) => lines.push(line) });
  assert.equal(hello.engine, "0.1.0");
  assert.deepEqual(app.calls[0], ["native_prepare", { sha: SHA, job: app.calls[0][1].job }]);
  assert.deepEqual(lines, ["== cargo build --release"]);
  assert.equal(app.listening("native-build"), 0);
});

test("cancelling a build kills it, and a build that fails says why with its code", async () => {
  const controller = new AbortController();
  let app;
  app = fakeApp(async (command, args) => {
    if (command === "native_cancel") return true;
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    throw { code: "cancelled", params: {}, message: "the build was cancelled" };
  });
  const error = await prepareNative(app, SHA, { signal: controller.signal }).catch((e) => e);
  assert.equal(error.code, "cancelled");
  assert.ok(app.calls.some(([command]) => command === "native_cancel"));

  const missing = fakeApp(async () => {
    throw { code: "runner-tool-missing", params: {}, message: "error: cmake was not found. Install it: brew install cmake" };
  });
  const why = await prepareNative(missing, SHA).catch((e) => e);
  assert.equal(why.code, "runner-tool-missing");
  assert.match(why.message, /brew install cmake/);
});

test("the runner as a WebEngine: calls carry the commit, progress is the job's, audio crosses as base64", async () => {
  let app;
  app = fakeApp(async (command, { sha, op, args }) => {
    assert.equal(command, "native_call");
    assert.equal(sha, SHA);
    if (op === "models") return [{ id: "kokoro" }];
    if (op === "load") {
      app.emit("native-progress", { sha, job: args.job, files: 2, done: 1, received: 5, size: 10 });
      app.emit("native-progress", { sha: "other", job: args.job, files: 9, done: 9 });
      return { handle: 7, model: args.model, build: "kokoro-fp32", capabilities: ["tts"] };
    }
    if (op === "speak") return { sampleRate: 24000, samples: encodeSamples([0.5, -1]) };
    if (op === "transcribe") return `${decodeSamples(args.samples).length} samples at ${args.sampleRate}`;
    if (op === "free") return true;
    throw new Error(op);
  });
  const engine = nativeEngine(app, SHA);
  assert.deepEqual(await engine.models(), [{ id: "kokoro" }]);
  const progress = [];
  const loaded = await engine.load("kokoro", null, (p) => progress.push(p.done));
  assert.deepEqual(progress, [1]);
  assert.equal(loaded.asStt(), undefined);
  const audio = await loaded.asTts().speak("hi", "af", undefined, 1);
  assert.equal(audio.sampleRate, 24000);
  assert.deepEqual([...audio.samples], [0.5, -1]);
  const call = app.calls.find(([, args]) => args.op === "speak")[1].args;
  assert.deepEqual(call, { handle: 7, text: "hi", voice: "af", language: null, speed: 1 });
  loaded.free();
  assert.ok(app.calls.some(([, args]) => args.op === "free" && args.args.handle === 7));
});

test("a runner that exited rejects with its code and message, and the page hears it", async () => {
  const app = fakeApp(async () => {
    throw { code: "runner-exited", params: {}, message: "the native runner exited (signal: 6 (SIGABRT))" };
  });
  const heard = [];
  await onNativeExit(app, (payload) => heard.push(payload));
  app.emit("native-exited", { sha: SHA, message: "gone" });
  assert.deepEqual(heard, [{ sha: SHA, message: "gone" }]);
  const error = await nativeEngine(app, SHA).models().catch((e) => e);
  assert.equal(error.code, "runner-exited");
  assert.match(error.message, /SIGABRT/);
});

test("samples cross as base64 of little-endian f32, as the runner reads them", () => {
  assert.equal(encodeSamples([0.5, -1]), "AAAAPwAAgL8=");
  assert.deepEqual([...decodeSamples("AAAAPwAAgL8=")], [0.5, -1]);
  assert.deepEqual([...decodeSamples("AAAA")], []);
  const long = new Float32Array(100_000).map((_, i) => i / 100_000);
  assert.deepEqual(decodeSamples(encodeSamples(long)), long);
});
