import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFrom, bytesOf, coded, nativeEngine, nativeInfo, tauri } from "../web/engine/native.mjs";

/** A stand-in for the app's Tauri API: records each invoke, answers from `answers`, and delivers events. */
function fakeApp(answers) {
  const calls = [];
  const listeners = new Set();
  const app = {
    calls,
    emit: (payload) => listeners.forEach((listener) => listener({ payload })),
    core: {
      invoke: async (command, args, options) => {
        calls.push({ command, args, options });
        const answer = answers[command];
        return typeof answer === "function" ? answer(args, app) : answer;
      },
    },
    event: {
      listen: async (event, listener) => {
        assert.equal(event, "native-progress");
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return app;
}

test("only inside the app is there a native engine", () => {
  assert.equal(tauri({}), null);
  const api = { core: {} };
  assert.equal(tauri({ __TAURI__: api }), api);
});

test("the native engine is named by the version and commit the app was built with", async () => {
  const app = fakeApp({ native_info: { version: "0.1.0", rev: "6ae37d12be4b28d30d7566ff9915bb3ac0122f54", dataDir: "/d" } });
  assert.equal((await nativeInfo(app)).label, "native 0.1.0 @ 6ae37d1");
});

test("load reports its own job's progress, and gives a model that speaks and transcribes through the app", async () => {
  const rate = 24000;
  const spoken = new Float32Array([0.25, -0.5]);
  const app = fakeApp({
    native_load: (args, self) => {
      self.emit({ job: "someone-else", files: 9, done: 0, received: 0, size: null });
      self.emit({ job: args.job, files: 2, done: 1, received: 10, size: 20 });
      return { handle: 7, model: "kokoro", build: "kokoro-b", capabilities: ["tts", "stt"] };
    },
    native_voices: [{ id: "af_bella", languages: ["en"] }],
    native_speak: () => {
      const out = new Uint8Array(4 + spoken.byteLength);
      new DataView(out.buffer).setUint32(0, rate, true);
      out.set(new Uint8Array(spoken.buffer), 4);
      return out.buffer;
    },
    native_transcribe: "hello",
    native_free: true,
  });
  const engine = nativeEngine(app);
  const progress = [];
  const loaded = await engine.load("kokoro", undefined, (p) => progress.push(p), new AbortController().signal);
  assert.deepEqual(app.calls[0].args, { model: "kokoro", build: null, job: app.calls[0].args.job });
  assert.deepEqual(progress.map((p) => p.done), [1]);

  const tts = loaded.asTts();
  assert.deepEqual(await tts.voices(), [{ id: "af_bella", languages: ["en"] }]);
  const audio = await tts.speak("hi", "af_bella", undefined, 1.2);
  assert.equal(audio.sampleRate, rate);
  assert.deepEqual([...audio.samples], [...spoken]);
  assert.deepEqual(app.calls.at(-1).args, { handle: 7, text: "hi", voice: "af_bella", language: null, speed: 1.2 });

  assert.equal(await loaded.asStt().transcribe(audio.samples, rate, "en"), "hello");
  const call = app.calls.at(-1);
  assert.deepEqual(call.options.headers, { "x-handle": "7", "x-sample-rate": "24000", "x-language": "en" });
  assert.deepEqual([...new Float32Array(call.args.slice().buffer)], [...spoken]);

  loaded.free();
  assert.deepEqual(app.calls.at(-1), { command: "native_free", args: { handle: 7 }, options: undefined });
});

test("a model that cannot speak has no asTts", async () => {
  const app = fakeApp({ native_load: { handle: 1, model: "whisper", build: "w", capabilities: ["stt"] } });
  const loaded = await nativeEngine(app).load("whisper", "w");
  assert.equal(loaded.asTts(), undefined);
  assert.ok(loaded.asStt());
});

test("aborting cancels the app's job, and its rejection carries the engine's code", async () => {
  let release;
  const app = fakeApp({
    native_install: () => new Promise((_, reject) => (release = () => reject({ code: "cancelled", params: {} }))),
    native_cancel: (args) => {
      assert.match(args.job, /^job-/);
      release();
      return true;
    },
  });
  const controller = new AbortController();
  const installing = nativeEngine(app).install("whisper", "w", () => {}, controller.signal);
  await new Promise((resolve) => setTimeout(resolve));
  controller.abort();
  await assert.rejects(installing, (error) => error instanceof Error && error.code === "cancelled");
  await assert.rejects(nativeEngine(app).install("x", null, null, controller.signal), { code: "cancelled" });
});

test("audio crosses as little-endian bytes", () => {
  const bytes = bytesOf([0.5, -1]);
  assert.equal(bytes.byteLength, 8);
  const answer = new Uint8Array([0x80, 0xbb, 0, 0, ...bytes]);
  assert.deepEqual(audioFrom(answer.buffer), { sampleRate: 48000, samples: new Float32Array([0.5, -1]) });
});

test("a rejection that is not the engine's stays as it is", () => {
  assert.equal(coded("boom").message, "boom");
  const error = coded({ code: "model-in-use", params: {} });
  assert.equal(error.code, "model-in-use");
  assert.deepEqual(error.params, {});
});
