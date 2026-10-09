// The native engine: sidevoice-engine compiled into the macOS app (src-tauri/src/native.rs), reached through the
// app's Tauri commands and wrapped in the shape of a web build's WebEngine (`models`, `install`, `uninstall`, `load`,
// and the loaded model's `asTts`/`asStt`), so the page's screens use either engine alike. Only inside the app: in a
// browser tab there is no Tauri, and the page offers web builds only.
//
// The engine is the one the app was built with: changing it means rebuilding the app (README, "The macOS app").

export const NATIVE = "native";

/** The app's Tauri API (`withGlobalTauri`), or null in a browser tab. */
export function tauri(global = globalThis) {
  return global.__TAURI__ ?? null;
}

/** What the app says of its engine: `{ version, rev, dataDir, error? }`, and the label the page shows it by. */
export async function nativeInfo(api) {
  const info = await api.core.invoke("native_info");
  return { ...info, label: `native ${info.version} @ ${info.rev.slice(0, 7)}` };
}

/** The native engine as a web build's WebEngine instance. */
export function nativeEngine(api) {
  const invoke = (command, args, options) => api.core.invoke(command, args, options).catch((error) => {
    throw coded(error);
  });
  const job = (command) => (model, build, onProgress, signal) =>
    withJob(api, onProgress, signal, (id) => invoke(command, { model, build: build ?? null, job: id }));
  const install = job("native_install");
  const load = job("native_load");
  return {
    models: () => invoke("native_models"),
    install: async (...args) => {
      await install(...args);
    },
    uninstall: (model) => invoke("native_uninstall", { model }),
    load: async (...args) => loadedModel(invoke, await load(...args)),
  };
}

/** The methods the page checks an engine for (choices.mjs, `engineAbilities`). */
export const NATIVE_METHODS = ["models", "install", "uninstall", "load"];

let jobs = 0;

/**
 * Runs `work` as a job the app names `id`: its `native-progress` events go to `onProgress`, and `signal` cancels it
 * (the command then rejects with `cancelled`).
 */
async function withJob(api, onProgress, signal, work) {
  if (signal?.aborted) throw coded({ code: "cancelled" });
  const id = `job-${++jobs}`;
  const unlisten = onProgress
    ? await api.event.listen("native-progress", ({ payload }) => {
        if (payload.job === id) onProgress(payload);
      })
    : null;
  const cancel = () => api.core.invoke("native_cancel", { job: id }).catch(() => {});
  signal?.addEventListener("abort", cancel);
  try {
    return await work(id);
  } finally {
    signal?.removeEventListener("abort", cancel);
    unlisten?.();
  }
}

/** A loaded model's handle as a web build's loaded model: `asTts()`, `asStt()`, `free()`. */
function loadedModel(invoke, { handle, model, build, capabilities }) {
  const tts = {
    voices: () => invoke("native_voices", { handle }),
    speak: async (text, voice, language, speed) =>
      audioFrom(await invoke("native_speak", { handle, text, voice, language: language ?? null, speed: speed ?? null })),
    free() {},
  };
  const stt = {
    transcribe: (samples, sampleRate, language) =>
      invoke("native_transcribe", bytesOf(samples), {
        headers: { "x-handle": String(handle), "x-sample-rate": String(sampleRate), "x-language": language ?? "" },
      }),
    free() {},
  };
  return {
    model,
    build,
    asTts: () => (capabilities.includes("tts") ? tts : undefined),
    asStt: () => (capabilities.includes("stt") ? stt : undefined),
    free: () => {
      invoke("native_free", { handle }).catch((error) => console.warn("native_free", error));
    },
  };
}

/** Samples for the app: f32, little-endian (every Mac this runs on is). */
export function bytesOf(samples) {
  const floats = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  return new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
}

/** Spoken audio from the app: its sample rate (u32 LE), then f32 LE samples. */
export function audioFrom(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? buffer : new Uint8Array(buffer).buffer;
  return { sampleRate: new DataView(bytes).getUint32(0, true), samples: new Float32Array(bytes.slice(4)) };
}

/** A command's rejection (`{ code, params, message? }`, or text) as the `Error` a web build rejects with. */
export function coded(error) {
  if (typeof error?.code !== "string") return error instanceof Error ? error : new Error(String(error));
  if (error.message) console.error(`native engine: ${error.code}: ${error.message}`);
  return Object.assign(new Error(error.message ?? error.code), { code: error.code, params: error.params ?? {} });
}
