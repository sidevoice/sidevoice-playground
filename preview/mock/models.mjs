// The mocked preview's models: the engine's catalogues as the page reads them — this device's (`local`) and each
// remote provider's — from the world's `voice` (installed models, provider keys, how installs go, whether the browser
// has WebGPU). Two faces, the two seams the page has: the desktop app's `host.engine` (`ModelCatalogs`,
// apps/web/src/services/model-catalogs.js), and, in the browser, @sidevoice/engine's `WebEngine` (its `catalogs()`,
// `install`, `uninstall`), which the page's own `engineCatalogs` reads as it reads the real one. The local models are
// sidevoice-engine's catalogue at v0.3.1 (`catalog/families/*.json`), in its order, each build placed as the engine's
// resolver places it; the providers' are what their listings give.
// @ts-check

/** @typedef {import("./web-types").LocalModelInfo} LocalModelInfo */
/** @typedef {import("./web-types").RemoteModelInfo} RemoteModelInfo */
/** @typedef {import("./web-types").CatalogStatus} CatalogStatus */
/** @typedef {import("./web-types").Progress} Progress */
/** @typedef {import("./web-types").ModelCatalogs} ModelCatalogs */
/** @typedef {import("./web-types").Voice} Voice */
/** @typedef {LocalModelInfo["builds"][number]} ModelBuild */
/** @typedef {ModelBuild["reasons"][number]} Reason */
/** What a build asks of where it runs, as the catalogue's `requires` says: the accelerators it takes (all its backend's
 * when absent), and in a page the most memory WebAssembly may hand it (`wasm_max_mb`). Its WebGPU features (fp16's
 * shader-f16) the engine does not check yet, so neither does this.
 * @typedef {{ accelerators?: string[], wasmMaxMb?: number }} Requires */
/** @typedef {{ id: string, backend: string, precision: string, memoryMb: number, downloadBytes: number, requires: Requires }} BuildSpec */
/** @typedef {Omit<LocalModelInfo, "installed" | "builds" | "recommendedBuild"> & { builds: BuildSpec[] }} LocalSpec */

export const LOCAL = "local";
export const PROVIDERS = [{ id: "openai", name: "OpenAI" }, { id: "elevenlabs", name: "ElevenLabs" }];
/** The keys the card offers, by what a provider does with them. */
export const SAMPLE_KEYS = { accepted: "sk-preview-accepted", rejected: "sk-preview-rejected" };

/** Backends a browser runs (the engine's web build has transformers.js only), and those the desktop app runs on the
 * mocked machine, a Mac on Apple silicon. */
const BROWSER_BACKENDS = ["transformers-js"];
const DESKTOP_BACKENDS = ["mlx", "sherpa-onnx", "whisper-cpp", "onnxruntime"];
/** Each backend's accelerators, best first, as the engine declares them (whisper.cpp's, on Apple silicon). */
const BACKEND_ACCELERATORS = {
  "transformers-js": ["webgpu", "wasm"], mlx: ["metal"], "sherpa-onnx": ["cpu"], "whisper-cpp": ["metal", "cpu"], onnxruntime: ["cpu"],
};
/** What the host reports: the Mac its CPU, Metal and Core ML; a page WebAssembly, and WebGPU when the world's browser
 * has it (`voice.webgpu`). */
const hostAccelerators = (place, voice) => (place === "desktop" ? ["cpu", "metal", "coreml"] : voice.webgpu ? ["webgpu", "wasm"] : ["wasm"]);

/** @type {Requires} */ const WEBGPU = { accelerators: ["webgpu"] };
/** @type {Requires} */ const WASM_CAP = { wasmMaxMb: 2048 };
/** @type {Requires} */ const WASM_ONLY = { accelerators: ["wasm"], wasmMaxMb: 2048 };
/** @type {Requires} */ const CPU = { accelerators: ["cpu"] };

/** @param {Requires} [requires] @returns {BuildSpec} */
const build = (model, backend, precision, memoryMb, downloadMb, requires = {}) =>
  ({ id: `${model}/${backend}-${precision}`, backend, precision, memoryMb, downloadBytes: downloadMb * 1_000_000, requires });
/** @param {string} id @param {string[]} languages @param {"female" | "male"} [gender] @param {string} [name] @returns {Voice} */
const voice = (id, languages, gender, name) => ({ id, languages, ...(gender ? { gender } : {}), ...(name ? { name } : {}) });

const WHISPER_LANGUAGES = [
  "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi",
  "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml",
  "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs",
  "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am",
  "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
  "ha", "ba", "jv", "su", "yue",
];
const PARAKEET_LANGUAGES = [
  "en", "es", "fr", "de", "bg", "hr", "cs", "da", "nl", "et", "fi", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt",
  "ro", "sk", "sl", "sv", "ru", "uk",
];
const QWEN3_ASR_LANGUAGES = [
  "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja", "tr", "hi", "ms", "nl",
  "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "hu", "mk", "ro",
];
const SUPERTONIC_3_LANGUAGES = [
  "en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it", "lt",
  "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
];
const SMART_TURN_LANGUAGES = [
  "ar", "bn", "zh", "da", "nl", "de", "en", "fi", "fr", "hi", "id", "it", "ja", "ko", "mr", "no", "pl", "pt", "ru",
  "es", "tr", "uk", "vi",
];

/** A whisper model, its builds in the catalogue's order, each `[memory MB, download MB]`: MLX (the large ones have
 * none), sherpa-onnx, whisper.cpp (`q5` its precision), transformers.js in fp16 on WebGPU only and in q8 under
 * WebAssembly's cap. @returns {LocalSpec} */
const whisper = (id, parametersM, license, q5, { mlx = null, sherpa, cpp, fp16, q8 }) => ({
  id, family: "whisper", capabilities: ["stt"], languages: WHISPER_LANGUAGES, parametersM, license, voices: [],
  builds: [
    ...(mlx ? [build(id, "mlx", "fp16", mlx[0], mlx[1])] : []),
    build(id, "sherpa-onnx", "int8", sherpa[0], sherpa[1]), build(id, "whisper-cpp", q5, cpp[0], cpp[1]),
    build(id, "transformers-js", "fp16", fp16[0], fp16[1], WEBGPU), build(id, "transformers-js", "q8", q8[0], q8[1], WASM_CAP),
  ],
});

const KOKORO_SPEED = { min: 0.5, max: 2 };
const PIPER_SPEED = { min: 0.5, max: 2 };
const SUPERTONIC_SPEED = { min: 0.9, max: 1.5 };

/** The local catalogue's models, in the engine's order: its families by name, each family's models as it lists them.
 * Kokoro v1.0 lists 54 voices: a few of them here, its Spanish ones among them. */
/** @type {LocalSpec[]} */
const LOCAL_MODELS = [
  { id: "canary-180m-flash", family: "canary", capabilities: ["stt"], languages: ["en", "de", "es", "fr"], parametersM: 182, license: "CC-BY-4.0",
    voices: [], builds: [build("canary-180m-flash", "sherpa-onnx", "int8", 260, 207)] },
  { id: "fastconformer-es-large", family: "fastconformer", capabilities: ["stt"], languages: ["es"], parametersM: 114, license: "CC-BY-4.0",
    voices: [], builds: [build("fastconformer-es-large", "sherpa-onnx", "int8", 140, 107)] },
  { id: "kokoro-82m-v0.19", family: "kokoro", capabilities: ["tts"], languages: ["en-US", "en-GB"], parametersM: 82, license: "Apache-2.0",
    speed: KOKORO_SPEED,
    voices: [
      ...["af", "af_bella", "af_nicole", "af_sarah", "af_sky"].map((id) => voice(id, ["en-US"], "female")),
      ...["am_adam", "am_michael"].map((id) => voice(id, ["en-US"], "male")),
      ...["bf_emma", "bf_isabella"].map((id) => voice(id, ["en-GB"], "female")),
      ...["bm_george", "bm_lewis"].map((id) => voice(id, ["en-GB"], "male")),
    ],
    builds: [
      build("kokoro-82m-v0.19", "sherpa-onnx", "int8", 130, 103, CPU),
      build("kokoro-82m-v0.19", "transformers-js", "fp32", 420, 331, WEBGPU),
      build("kokoro-82m-v0.19", "transformers-js", "q8", 130, 98, WASM_ONLY),
    ] },
  { id: "kokoro-82m-v1.0", family: "kokoro", capabilities: ["tts"], languages: ["en-US", "en-GB", "es"], parametersM: 82, license: "Apache-2.0",
    speed: KOKORO_SPEED,
    voices: [
      voice("af_heart", ["en-US"], "female"), voice("af_bella", ["en-US"], "female"), voice("am_michael", ["en-US"], "male"),
      voice("bf_emma", ["en-GB"], "female"), voice("bm_george", ["en-GB"], "male"),
      voice("ef_dora", ["es"], "female"), voice("em_alex", ["es"], "male"), voice("em_santa", ["es"], "male"),
    ],
    builds: [
      build("kokoro-82m-v1.0", "sherpa-onnx", "int8", 170, 132, CPU),
      build("kokoro-82m-v1.0", "transformers-js", "fp32", 440, 347, WEBGPU),
      build("kokoro-82m-v1.0", "transformers-js", "q8", 150, 114, WASM_ONLY),
      build("kokoro-82m-v1.0", "mlx", "fp32", 450, 355),
    ] },
  { id: "parakeet-tdt-0.6b-v3", family: "parakeet", capabilities: ["stt"], languages: PARAKEET_LANGUAGES, parametersM: 600, license: "CC-BY-4.0",
    voices: [], builds: [build("parakeet-tdt-0.6b-v3", "sherpa-onnx", "int8", 840, 670), build("parakeet-tdt-0.6b-v3", "mlx", "fp32", 3110, 2509)] },
  { id: "piper-es_ES-carlfm-x_low", family: "piper", capabilities: ["tts"], languages: ["es-ES"], parametersM: 7, license: "MIT",
    speed: PIPER_SPEED, voices: [], builds: [build("piper-es_ES-carlfm-x_low", "sherpa-onnx", "int8", 20, 13)] },
  { id: "piper-en_US-ljspeech-medium", family: "piper", capabilities: ["tts"], languages: ["en-US"], parametersM: 16, license: "MIT",
    speed: PIPER_SPEED, voices: [voice("0", ["en-US"], "female")], builds: [build("piper-en_US-ljspeech-medium", "sherpa-onnx", "int8", 30, 21)] },
  { id: "qwen3-asr-0.6b", family: "qwen3-asr", capabilities: ["stt"], languages: QWEN3_ASR_LANGUAGES, parametersM: 938, license: "Apache-2.0",
    voices: [], builds: [build("qwen3-asr-0.6b", "sherpa-onnx", "int8", 1090, 879)] },
  { id: "silero-vad", family: "silero-vad", capabilities: ["vad"], languages: [], parametersM: 1, license: "MIT",
    voices: [], builds: [build("silero-vad", "sherpa-onnx", "fp32", 10, 2), build("silero-vad", "transformers-js", "fp32", 10, 2)] },
  { id: "smart-turn-v3.2", family: "smart-turn", capabilities: ["end-of-turn"], languages: SMART_TURN_LANGUAGES, parametersM: 8, license: "BSD-2-Clause",
    voices: [], builds: [
      build("smart-turn-v3.2", "onnxruntime", "fp32", 50, 32), build("smart-turn-v3.2", "transformers-js", "fp32", 50, 32),
      build("smart-turn-v3.2", "onnxruntime", "int8", 20, 9), build("smart-turn-v3.2", "transformers-js", "int8", 20, 9),
    ] },
  { id: "supertonic-3", family: "supertonic", capabilities: ["tts"], languages: SUPERTONIC_3_LANGUAGES, parametersM: 99, license: "OpenRAIL-M",
    speed: SUPERTONIC_SPEED, voices: [], builds: [build("supertonic-3", "sherpa-onnx", "int8", 190, 145)] },
  { id: "supertonic-2", family: "supertonic", capabilities: ["tts"], languages: ["en", "ko", "es", "pt", "fr"], parametersM: 66, license: "OpenRAIL-M",
    speed: SUPERTONIC_SPEED, voices: [], builds: [build("supertonic-2", "transformers-js", "fp32", 330, 263)] },
  whisper("whisper-tiny", 39, "MIT", "q5_1", { mlx: [100, 79], sherpa: [130, 104], cpp: [40, 32], fp16: [100, 79], q8: [60, 44] }),
  whisper("whisper-base", 74, "MIT", "q5_1", { mlx: [180, 148], sherpa: [200, 161], cpp: [80, 60], fp16: [190, 149], q8: [100, 80] }),
  whisper("whisper-small", 244, "MIT", "q5_1", { mlx: [600, 486], sherpa: [470, 375], cpp: [240, 190], fp16: [610, 488], q8: [310, 252] }),
  whisper("whisper-large-v3", 1543, "Apache-2.0", "q5_0", { sherpa: [2210, 1776], cpp: [1350, 1081], fp16: [3840, 3094], q8: [2260, 1826] }),
  whisper("whisper-large-v3-turbo", 809, "MIT", "q5_0", { sherpa: [1290, 1037], cpp: [720, 574], fp16: [2010, 1621], q8: [1350, 1088] }),
];

/** Each provider's models, as its listing gives them once a key is accepted. */
/** @type {Record<string, RemoteModelInfo[]>} */
const PROVIDER_MODELS = {
  openai: [
    { id: "gpt-4o-transcribe", capabilities: ["stt"], languages: ["en", "es", "fr", "de"], voices: [] },
    { id: "gpt-4o-mini-transcribe", capabilities: ["stt"], languages: ["en", "es", "fr", "de"], voices: [] },
    { id: "gpt-4o-mini-tts", capabilities: ["tts"], languages: ["en", "es", "fr", "de"], speed: { min: 0.25, max: 4 },
      voices: ["alloy", "ash", "coral", "nova", "sage"].map((id) => voice(id, ["en", "es", "fr", "de"])) },
  ],
  elevenlabs: [
    { id: "scribe_v1", capabilities: ["stt"], languages: ["en", "es", "fr", "de"], voices: [] },
    { id: "eleven_flash_v2_5", capabilities: ["tts"], languages: ["en", "es", "fr", "de"], speed: { min: 0.7, max: 1.2 },
      voices: [voice("21m00Tcm4TlvDq8ikWAM", ["en", "es"], "female", "Rachel"), voice("pNInz6obpgDQGcFmaJgB", ["en", "es"], "male", "Adam")] },
  ],
};

/** What the world says of the voice when a scenario says nothing: nothing installed but the detector, no keys, a
 * browser with WebGPU. */
export const VOICE_DEFAULTS = {
  installed: { "silero-vad": true },
  // When each local model was last loaded (ms since the epoch), as the engine would say (sidevoice-web CatalogModel.lastUsedAt):
  // every call or try that loads it sets it (an install does not: sidevoice-engine #90). A scenario dates one back in days before the world's now
  // (`lastUsedDaysAgo`); a use since is newer and wins.
  lastUsed: {},
  lastUsedDaysAgo: {},
  keys: {},
  install: "ok", installSlow: false, voicesOnceInstalled: true, providers: "ok", webgpu: true,
  mic: "granted", transcript: "Hola, ¿me oyes bien?", stt: "ok", tts: "ok",
  // Whether the voice hands a try's take (sidevoice-web contract gap #40; voice.mjs): false is @sidevoice/voice 0.3.x.
  take: true,
};

/** The world's voice state, its defaults filled in. */
export function voiceState(world) {
  // A copy of the defaults: what one world changes in them (a key, an install) is never another's.
  world.state.voice = { ...structuredClone(VOICE_DEFAULTS), ...(world.state.voice ?? {}) };
  return world.state.voice;
}

/**
 * Whether `spec` runs in `place`, the engine's funnel (its src/resolver.rs): its backend is in this build of the engine
 * (`backend-not-in-this-build`), one of the backend's accelerators is here (`no-accelerator`), the build takes one of
 * those (`build-accelerator`), and in a page it fits under WebAssembly's cap (`wasm-memory`). The machine's memory and
 * cores the mock does not tell, and what the host does not tell passes.
 * @param {BuildSpec} spec @returns {{ accelerator: string } | { reason: Reason }}
 */
function fit(spec, place, voice) {
  /** @returns {{ reason: Reason }} */
  const rejected = (code, params = {}) => ({ reason: { code, params } });
  if (!(place === "desktop" ? DESKTOP_BACKENDS : BROWSER_BACKENDS).includes(spec.backend)) return rejected("backend-not-in-this-build");
  const here = hostAccelerators(place, voice);
  const working = BACKEND_ACCELERATORS[spec.backend].filter((accelerator) => here.includes(accelerator));
  if (!working.length) return rejected("no-accelerator");
  const taken = spec.requires.accelerators;
  const accelerator = working.find((a) => !taken || taken.includes(a));
  if (!accelerator) return rejected("build-accelerator");
  const cap = spec.requires.wasmMaxMb;
  if (place === "browser" && cap && spec.memoryMb > cap) return rejected("wasm-memory", { needs: spec.memoryMb, has: cap });
  return { accelerator };
}

/** The builds of a model installed, from the world's `voice.installed[model]`: the ids of the builds installed, or
 *  `true`, the build recommended here (what a scenario seeds), or nothing. */
function installedBuilds(entry, recommended) {
  if (Array.isArray(entry)) return entry;
  return entry === true && recommended ? [recommended] : [];
}

/** The local catalogue's models for `place` (`browser` or `desktop`), as installed in the world: each model's builds
 * ranked as the engine ranks them (those that run here first, each on its accelerator, then the rest with why not, each
 * group in catalogue order), the first that runs recommended, and each build installed or not; the model is installed
 * once one of its builds is.
 * @returns {LocalModelInfo[]} */
export function localModels(world, place) {
  const voice = voiceState(world);
  return LOCAL_MODELS.map(({ builds: specs, ...model }) => {
    /** @type {ModelBuild[]} */
    const builds = specs.map((spec) => {
      const { requires, ...shown } = spec;
      const fitted = fit(spec, place, voice);
      return "accelerator" in fitted
        ? { ...shown, accelerator: fitted.accelerator, available: true, reasons: [], installed: false }
        : { ...shown, available: false, reasons: [fitted.reason], installed: false };
    });
    builds.sort((a, b) => Number(b.available) - Number(a.available));
    const recommended = builds.find((b) => b.available);
    const ids = installedBuilds(voice.installed[model.id], recommended?.id);
    for (const b of builds) b.installed = ids.includes(b.id);
    const installed = builds.some((b) => b.installed);
    return {
      ...model,
      voices: voice.voicesOnceInstalled && !installed ? [] : model.voices,
      installed, builds, ...(recommended ? { recommendedBuild: recommended.id } : {}),
      ...(installed ? { lastUsedAt: lastUsedAt(world, voice, model.id) } : {}),
    };
  });
}

const DAY_MS = 86_400_000;

/** When local model `id` was last loaded: the use the world saw, else the day the scenario dates it to, else unknown. */
function lastUsedAt(world, voice, id) {
  const days = voice.lastUsedDaysAgo?.[id];
  return voice.lastUsed?.[id] ?? (typeof days === "number" ? world.now() - days * DAY_MS : null);
}

/** How provider `id` stands with key `key`: listed, refused, missing, or unreachable. */
export function providerView(world, id, key) {
  const voice = voiceState(world);
  /** @type {CatalogStatus} */
  let status = { stale: false };
  /** @type {RemoteModelInfo[]} */
  let models = [];
  if (voice.providers === "unreachable") status = { stale: true, reason: { code: "provider-unreachable", params: {} } };
  else if (!key) status = { stale: false, reason: { code: "credential-missing", params: {} } };
  else if (key.includes("rejected")) {
    status = { stale: false, reason: { code: "credential-rejected", params: {} }, detail: "invalid_api_key: Incorrect API key provided." };
  } else models = PROVIDER_MODELS[id];
  return { id, name: PROVIDERS.find((p) => p.id === id)?.name ?? null, status, models };
}

/** An engine error, as the engine's promises reject with. */
const engineError = (code, detail) => Object.assign(new Error(code), { code, params: {}, ...(detail ? { detail } : {}) });

/**
 * Installs `model` in `place` on the world's clock — build `wanted`, else the first that runs there, as the engine
 * chooses — telling `onProgress` the engine's way (`Progress`: files done, bytes of the one downloading), until
 * `signal` aborts it or the world says it fails.
 * @param {string | null | undefined} wanted
 */
async function installing(world, place, model, wanted, onProgress, signal) {
  const voice = voiceState(world);
  const listed = localModels(world, place).find((m) => m.id === model);
  if (!listed) throw engineError("model-not-found");
  const chosen = wanted ? listed.builds.find((b) => b.id === wanted) : listed.builds.find((b) => b.available);
  if (!chosen) throw engineError(wanted ? "build-not-found" : "no-build-available");
  if (!chosen.available) throw engineError(chosen.reasons[0].code);
  const size = chosen.downloadBytes;
  const steps = 20;
  for (let step = 1; step <= steps; step++) {
    if (signal?.aborted) throw engineError("cancelled");
    if (voice.install === "fail" && step === Math.round(steps * 0.6)) throw engineError("download-failed", "HTTP 503 from the model host");
    /** @type {Progress} */
    const progress = { files: 2, done: step === steps ? 2 : 0, received: Math.round((size * step) / steps), size };
    onProgress?.(progress);
    await world.delay(voice.installSlow ? 900 : 150);
  }
  // The build chosen joins those of the model already installed. A model's id may hold dots (kokoro-82m-v1.0): the
  // map is set whole, never by a dotted path.
  const kept = installedBuilds(voiceState(world).installed[model], listed.recommendedBuild).filter((id) => id !== chosen.id);
  world.patch({ "voice.installed": { ...voiceState(world).installed, [model]: [...kept, chosen.id] } });
}

/** The desktop app's `host.engine`: the catalogues, installs (with their own progress and cancel) and keys. */
export function desktopEngine(world) {
  const keys = () => voiceState(world).keys;
  const engine = {
    async catalogs() {
      await world.delay(200);
      return [
        { id: LOCAL, name: null, status: { stale: false }, models: localModels(world, "desktop") },
        ...PROVIDERS.map((p) => providerView(world, p.id, keys()[p.id])),
      ];
    },
    /** @param {string} model @param {{build?: string | null, engine?: string | null, onProgress?: (p: {fraction: number | null, done: number | null, total: number | null}) => void, signal?: AbortSignal}} [options] */
    async install(model, { build, onProgress, signal } = {}) {
      try {
        await installing(world, "desktop", model, build, (p) => onProgress?.({ fraction: p.size ? p.received / p.size : null, done: p.received, total: p.size ?? null }), signal);
      } catch (error) {
        throw error.code === "cancelled" ? Object.assign(new Error("install-cancelled"), { code: "install-cancelled" }) : error;
      }
    },
    /** @param {string} provider @param {string | null} key */
    async setCredential(provider, key) {
      world.patch({ [`voice.keys.${provider}`]: key || null });
    },
    /** @param {string} provider */
    async hasCredential(provider) {
      return !!keys()[provider];
    },
    /** Takes a model off the computer, every build of it. The real bridge's engine has no `uninstall` yet (sidevoice-web
     *  #75's contract gaps): the mock offers it, so Delete and Remove all can be seen in the app too. @param {string} model */
    async uninstall(model) {
      world.patch({ "voice.installed": { ...voiceState(world).installed, [model]: false } });
    },
  };
  /** @type {ModelCatalogs} The web's own interface: a member it needs that this lacks fails the check. */
  const typed = engine;
  return typed;
}

/**
 * The browser's `WebEngine` on `host` (the page's: `credential(provider)` reads the keys it keeps): what the page's
 * `engineCatalogs` and its voice's model source ask of it. What the browser runs on is the world's (`voice.webgpu`),
 * not what the host's `capabilities()` says of the browser the preview is open in.
 */
export function webEngine(world, host) {
  const catalog = (id) => {
    if (id === LOCAL) {
      return {
        id: LOCAL, name: null,
        status: async () => ({ stale: false }),
        models: async (capability) => localModels(world, "browser").filter((m) => !capability || m.capabilities.includes(capability)),
        refresh: async () => ({ stale: false }),
        load: async (model) => ({ id: () => model, capabilities: () => LOCAL_MODELS.find((m) => m.id === model)?.capabilities ?? [] }),
      };
    }
    if (!PROVIDERS.some((p) => p.id === id)) throw engineError("catalog-not-found");
    const view = async () => providerView(world, id, await host.credential(id));
    return {
      id, name: PROVIDERS.find((p) => p.id === id).name,
      status: async () => (await view()).status,
      models: async (capability) => {
        const listed = await view();
        if (listed.status.reason) throw engineError(listed.status.reason.code, listed.status.detail);
        return listed.models.filter((m) => !capability || m.capabilities.includes(capability));
      },
      refresh: async () => (await view()).status,
      load: async (model) => ({ id: () => model, provider: () => id }),
    };
  };
  return {
    backends: () => BROWSER_BACKENDS,
    catalogs: () => [catalog(LOCAL), ...PROVIDERS.map((p) => catalog(p.id))],
    catalog,
    localCatalog: () => catalog(LOCAL),
    remoteCatalog: (id) => catalog(id),
    /** @param {string} model @param {string | undefined} build @param {(progress: Progress) => void} [onProgress] @param {AbortSignal} [signal] */
    install: (model, build, onProgress, signal) => installing(world, "browser", model, build, onProgress, signal),
    /** @param {string} model */
    async uninstall(model) {
      world.patch({ "voice.installed": { ...voiceState(world).installed, [model]: false } });
    },
    async load(model) {
      return catalog(LOCAL).load(model);
    },
  };
}
