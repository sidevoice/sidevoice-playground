// The mocked preview's models: the engine's catalogues as the page reads them — this device's (`local`) and each
// remote provider's — from the world's `voice` (installed models, provider keys, how installs go). Two faces, the two
// seams the page has: the desktop app's `host.engine` (`ModelCatalogs`, apps/web/src/services/model-catalogs.js), and,
// in the browser, @sidevoice/engine's `WebEngine` (its `catalogs()`, `install`, `uninstall`), which the page's own
// `engineCatalogs` reads as it reads the real one. The local models are a few of sidevoice-engine's
// `catalog/families/*.json`, as its catalogue lists them; the providers' are what their listings give.
// @ts-check

/** @typedef {import("./web-types").LocalModelInfo} LocalModelInfo */
/** @typedef {import("./web-types").RemoteModelInfo} RemoteModelInfo */
/** @typedef {import("./web-types").CatalogStatus} CatalogStatus */
/** @typedef {import("./web-types").Progress} Progress */
/** @typedef {import("./web-types").ModelCatalogs} ModelCatalogs */
/** @typedef {import("./web-types").Voice} Voice */
/** @typedef {{ id: string, backend: string, precision: string, memoryMb: number, downloadBytes: number }} BuildSpec */
/** @typedef {Omit<LocalModelInfo, "installed" | "builds" | "recommendedBuild"> & { builds: BuildSpec[] }} LocalSpec */

export const LOCAL = "local";
export const PROVIDERS = [{ id: "openai", name: "OpenAI" }, { id: "elevenlabs", name: "ElevenLabs" }];
/** The keys the card offers, by what a provider does with them. */
export const SAMPLE_KEYS = { accepted: "sk-preview-accepted", rejected: "sk-preview-rejected" };

/** Backends a browser runs, and those a desktop app runs. */
const BROWSER_BACKENDS = ["transformers-js", "onnxruntime"];
const DESKTOP_BACKENDS = ["sherpa-onnx", "whisper-cpp", "onnxruntime", "mlx"];

/** @returns {BuildSpec} */
const build = (model, backend, precision, mb, downloadMb) => ({ id: `${model}/${backend}-${precision}`, backend, precision, memoryMb: mb, downloadBytes: downloadMb * 1_000_000 });
/** @param {string} id @param {string[]} languages @param {"female" | "male"} [gender] @param {string} [name] @returns {Voice} */
const voice = (id, languages, gender, name) => ({ id, languages, ...(gender ? { gender } : {}), ...(name ? { name } : {}) });

/** The local catalogue's models (sidevoice-engine catalog/families: whisper, kokoro, piper, silero-vad, smart-turn). */
/** @type {LocalSpec[]} */
const LOCAL_MODELS = [
  { id: "whisper-base", family: "whisper", capabilities: ["stt"], languages: ["en", "es", "fr", "de", "it", "pt"], parametersM: 74, license: "MIT",
    voices: [], builds: [build("whisper-base", "transformers-js", "q8", 120, 80), build("whisper-base", "sherpa-onnx", "int8", 200, 160), build("whisper-base", "whisper-cpp", "q5_1", 80, 60)] },
  { id: "whisper-small", family: "whisper", capabilities: ["stt"], languages: ["en", "es", "fr", "de", "it", "pt"], parametersM: 244, license: "MIT",
    voices: [], builds: [build("whisper-small", "transformers-js", "q8", 400, 250), build("whisper-small", "sherpa-onnx", "int8", 470, 360), build("whisper-small", "whisper-cpp", "q5_1", 240, 190)] },
  { id: "kokoro-82m-v1.0", family: "kokoro", capabilities: ["tts"], languages: ["en-US", "en-GB", "es"], parametersM: 82, license: "Apache-2.0",
    speed: { min: 0.5, max: 2 },
    voices: [voice("af_heart", ["en-US"], "female"), voice("am_michael", ["en-US"], "male"), voice("bf_emma", ["en-GB"], "female"), voice("ef_dora", ["es"], "female"), voice("em_alex", ["es"], "male")],
    builds: [build("kokoro-82m-v1.0", "transformers-js", "q8", 150, 92), build("kokoro-82m-v1.0", "sherpa-onnx", "int8", 170, 120)] },
  { id: "piper-es_ES-carlfm-x_low", family: "piper", capabilities: ["tts"], languages: ["es-ES"], parametersM: 7, license: "MIT",
    speed: { min: 0.5, max: 2 }, voices: [voice("0", ["es-ES"], "male")], builds: [build("piper-es_ES-carlfm-x_low", "sherpa-onnx", "int8", 20, 28)] },
  { id: "silero-vad", family: "silero-vad", capabilities: ["vad"], languages: [], parametersM: 1, license: "MIT",
    voices: [], builds: [build("silero-vad", "transformers-js", "fp32", 10, 2), build("silero-vad", "sherpa-onnx", "fp32", 10, 2)] },
  { id: "smart-turn-v3.2", family: "smart-turn", capabilities: ["end-of-turn"], languages: ["en", "es"], parametersM: 8, license: "BSD-2-Clause",
    voices: [], builds: [build("smart-turn-v3.2", "transformers-js", "fp32", 50, 32), build("smart-turn-v3.2", "onnxruntime", "int8", 20, 9)] },
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

/** What the world says of the voice when a scenario says nothing: nothing installed but the detector, no keys. */
export const VOICE_DEFAULTS = {
  installed: { "silero-vad": true },
  keys: {},
  install: "ok", installSlow: false, voicesOnceInstalled: true, providers: "ok",
  mic: "granted", transcript: "Hola, ¿me oyes bien?", stt: "ok", tts: "ok",
};

/** The world's voice state, its defaults filled in. */
export function voiceState(world) {
  // A copy of the defaults: what one world changes in them (a key, an install) is never another's.
  world.state.voice = { ...structuredClone(VOICE_DEFAULTS), ...(world.state.voice ?? {}) };
  return world.state.voice;
}

/** The local catalogue's models for `place` (`browser` or `desktop`), as installed in the world.
 * @returns {LocalModelInfo[]} */
export function localModels(world, place) {
  const voice = voiceState(world);
  const runs = place === "desktop" ? DESKTOP_BACKENDS : BROWSER_BACKENDS;
  return LOCAL_MODELS.map((model) => {
    const installed = !!voice.installed[model.id];
    const builds = model.builds.map((b) => ({
      ...b, ...(runs.includes(b.backend) ? { accelerator: place === "desktop" ? "cpu" : "wasm" } : {}),
      available: runs.includes(b.backend),
      reasons: runs.includes(b.backend) ? [] : [{ code: "backend-not-in-this-build", params: {} }],
      installed: installed && runs.includes(b.backend),
    }));
    const recommended = builds.find((b) => b.available)?.id;
    return {
      ...model,
      voices: voice.voicesOnceInstalled && !installed ? [] : model.voices,
      installed, builds, ...(recommended ? { recommendedBuild: recommended } : {}),
    };
  });
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
 * Installs `model` on the world's clock, telling `onProgress` the engine's way (`Progress`: files done, bytes of the
 * one downloading), until `signal` aborts it or the world says it fails.
 */
async function installing(world, model, onProgress, signal) {
  const voice = voiceState(world);
  const entry = LOCAL_MODELS.find((m) => m.id === model);
  if (!entry) throw engineError("model-not-found");
  const size = entry.builds[0].downloadBytes;
  const steps = 20;
  for (let step = 1; step <= steps; step++) {
    if (signal?.aborted) throw engineError("cancelled");
    if (voice.install === "fail" && step === Math.round(steps * 0.6)) throw engineError("download-failed", "HTTP 503 from the model host");
    /** @type {Progress} */
    const progress = { files: 2, done: step === steps ? 2 : 0, received: Math.round((size * step) / steps), size };
    onProgress?.(progress);
    await world.delay(voice.installSlow ? 900 : 150);
  }
  // A model's id may hold dots (kokoro-82m-v1.0): the map is set whole, never by a dotted path.
  world.patch({ "voice.installed": { ...voice.installed, [model]: true } });
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
    async install(model, { onProgress, signal } = {}) {
      try {
        await installing(world, model, (p) => onProgress?.({ fraction: p.size ? p.received / p.size : null, done: p.received, total: p.size ?? null }), signal);
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
  };
  /** @type {ModelCatalogs} The web's own interface: a member it needs that this lacks fails the check. */
  const typed = engine;
  return typed;
}

/**
 * The browser's `WebEngine` on `host` (the page's: `credential(provider)` reads the keys it keeps): what the page's
 * `engineCatalogs` and its voice's model source ask of it.
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
    /** @param {string} model @param {string | undefined} _build @param {(progress: Progress) => void} [onProgress] @param {AbortSignal} [signal] */
    install: (model, _build, onProgress, signal) => installing(world, model, onProgress, signal),
    /** @param {string} model */
    async uninstall(model) {
      world.patch({ "voice.installed": { ...voiceState(world).installed, [model]: false } });
    },
    async load(model) {
      return catalog(LOCAL).load(model);
    },
  };
}
