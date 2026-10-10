// The native engine in the macOS app: sidevoice-engine's native build at an engine commit, built on this Mac and run
// as a child process by the app (src-tauri/src/runner.rs), reached through the app's Tauri commands and wrapped in the
// shape of a web build's WebEngine (`models`, `install`, `uninstall`, `load`, and the loaded model's `asTts`/`asStt`),
// so the page's screens use either engine alike. Only inside the app: in a browser tab there is no Tauri.
//
// Audio crosses as base64 of little-endian f32 samples, as the runner speaks it.

export const NATIVE = "native";

/** The methods the page checks an engine for (choices.mjs, `engineAbilities`). */
export const NATIVE_METHODS = ["models", "install", "uninstall", "load"];

/** The app's Tauri API (`withGlobalTauri`), or null in a browser tab. */
export function tauri(global = globalThis) {
  return global.__TAURI__ ?? null;
}

let jobs = 0;

/**
 * The runner for engine commit `sha`, built if it is not (minutes the first time) and started if it is not running:
 * what it says of itself, `{ protocol, engine, rev, dataDir }`. Each line of the build's output goes to `onLine`;
 * `signal` kills the build (it then rejects with `cancelled`).
 */
export async function prepareNative(api, sha, { onLine, signal } = {}) {
  if (signal?.aborted) throw coded({ code: "cancelled" });
  const job = `build-${++jobs}`;
  const unlisten = await api.event.listen("native-build", ({ payload }) => {
    if (payload.job === job) onLine?.(payload.line);
  });
  const cancel = () => api.core.invoke("native_cancel", { job }).catch(() => {});
  signal?.addEventListener("abort", cancel);
  try {
    return await api.core.invoke("native_prepare", { sha, job });
  } catch (error) {
    throw coded(error);
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten();
  }
}

/** Calls `handler({ sha, message })` whenever a runner exits on its own (a crash in the engine, say). */
export function onNativeExit(api, handler) {
  return api.event.listen("native-exited", ({ payload }) => handler(payload));
}

/** The runner for engine commit `sha` (prepared first: `prepareNative`) as a web build's WebEngine instance. */
export function nativeEngine(api, sha) {
  const call = (op, args = {}) =>
    api.core.invoke("native_call", { sha, op, args }).catch((error) => {
      throw coded(error);
    });
  const job = (op) => (model, build, onProgress, signal) =>
    withJob(api, sha, call, onProgress, signal, (id) => call(op, { model, build: build ?? null, job: id }));
  const install = job("install");
  const load = job("load");
  return {
    models: () => call("models"),
    install: async (...args) => {
      await install(...args);
    },
    uninstall: (model, build) => call("uninstall", { model, build: build ?? null }),
    load: async (...args) => loadedModel(call, await load(...args)),
  };
}

/**
 * Runs `work` as a job named `id`: its progress events go to `onProgress`, and `signal` cancels it (the call then
 * rejects with `cancelled`).
 */
async function withJob(api, sha, call, onProgress, signal, work) {
  if (signal?.aborted) throw coded({ code: "cancelled" });
  const id = `job-${++jobs}`;
  const unlisten = onProgress
    ? await api.event.listen("native-progress", ({ payload }) => {
        if (payload.sha === sha && payload.job === id) onProgress(payload);
      })
    : null;
  const cancel = () => call("cancel", { job: id }).catch(() => {});
  signal?.addEventListener("abort", cancel);
  try {
    return await work(id);
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten?.();
  }
}

/** A loaded model's handle as a web build's loaded model: `asTts()`, `asStt()`, `free()`. */
function loadedModel(call, { handle, model, build, capabilities }) {
  const tts = {
    voices: () => call("voices", { handle }),
    speak: async (text, voice, language, speed) => {
      const audio = await call("speak", { handle, text, voice, language: language ?? null, speed: speed ?? null });
      return { sampleRate: audio.sampleRate, samples: decodeSamples(audio.samples) };
    },
    free() {},
  };
  const stt = {
    transcribe: (samples, sampleRate, language) =>
      call("transcribe", { handle, samples: encodeSamples(samples), sampleRate, language: language ?? null }),
    free() {},
  };
  return {
    model,
    build,
    asTts: () => (capabilities.includes("tts") ? tts : undefined),
    asStt: () => (capabilities.includes("stt") ? stt : undefined),
    free: () => {
      call("free", { handle }).catch((error) => console.warn("native free", error));
    },
  };
}

/** Samples as base64 of their f32 bytes, little-endian (every Mac this runs on is). */
export function encodeSamples(samples) {
  const floats = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Samples from base64 of little-endian f32 bytes, a trailing partial sample ignored. */
export function decodeSamples(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length - (binary.length % 4));
  for (let i = 0; i < bytes.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/** A command's rejection (`{ code, params, message? }`, or text) as the `Error` a web build rejects with. */
export function coded(error) {
  if (typeof error?.code !== "string") return error instanceof Error ? error : new Error(String(error));
  if (error.message) console.error(`native engine: ${error.code}: ${error.message}`);
  return Object.assign(new Error(error.message ?? error.code), { code: error.code, params: error.params ?? {} });
}
