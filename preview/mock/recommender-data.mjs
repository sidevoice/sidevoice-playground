// What the model recommender design sheet (recommender.html) shows: example devices, an example catalogue, and the
// words. No DOM here, so a test can hold the data to what was decided (briefs/night-2026-11-10-handover/POINT-7).
//
// EXAMPLE DATA. The models, their builds, languages and memory are sidevoice-engine's catalogue (catalog/families at
// 5ed0a9c, the native builds and the browser's transformers.js ones, so "Avanzado" lists what the app lists). The
// devices, their memory budgets and the "comfortable on" hints are INVENTED for this preview: the recommender is
// not built yet, and nothing here was measured (sidevoice-engine#155 is the measurement).

export const CATALOGUE_SOURCE = "sidevoice-engine@5ed0a9c catalog/families";

/** The part of a device's memory the whole voice set (transcription, voice, end of turn) may take: decided, 60 %. */
export const BUDGET = 0.6;
/** The end-of-turn model the set always carries (smart-turn fp32, catalogue). */
export const TURN_MB = 50;

// --- languages, as the catalogue lists them (the order carries meaning: never sorted) ---
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

/** A build: its engine, precision, memory (MB) and download (MB), as the catalogue lists them. */
const build = (backend, precision, memoryMb, downloadMb) => ({ backend, precision, memoryMb, downloadMb });
/** A whisper model: its builds in the catalogue's order. */
const whisper = (id, q5, { mlx, sherpa, cpp, fp16, q8 }) => ({
  id, family: "whisper", capabilities: ["stt"], languages: WHISPER_LANGUAGES,
  builds: [
    ...(mlx ? [build("mlx", "fp16", ...mlx)] : []), build("sherpa-onnx", "int8", ...sherpa), build("whisper-cpp", q5, ...cpp),
    build("transformers-js", "fp16", ...fp16), build("transformers-js", "q8", ...q8),
  ],
});

/** The catalogue's models of the two capabilities the sheet shows, in the catalogue's order (its families by name, each
 *  family's models as it lists them): the order that breaks every tie. Kokoro v0.19 is left out (sidevoice-engine#156). */
export const CATALOGUE = [
  { id: "canary-180m-flash", family: "canary", capabilities: ["stt"], languages: ["en", "de", "es", "fr"], builds: [build("sherpa-onnx", "int8", 260, 207)] },
  { id: "fastconformer-es-large", family: "fastconformer", capabilities: ["stt"], languages: ["es"], builds: [build("sherpa-onnx", "int8", 140, 107)] },
  { id: "kokoro-82m-v1.0", family: "kokoro", capabilities: ["tts"], languages: ["en-US", "en-GB", "es"],
    builds: [build("sherpa-onnx", "int8", 170, 132), build("transformers-js", "fp32", 440, 347), build("transformers-js", "q8", 150, 114), build("mlx", "fp32", 450, 355)] },
  { id: "parakeet-tdt-0.6b-v3", family: "parakeet", capabilities: ["stt"], languages: PARAKEET_LANGUAGES,
    builds: [build("sherpa-onnx", "int8", 840, 670), build("mlx", "fp32", 3110, 2509)] },
  { id: "piper-es_ES-carlfm-x_low", family: "piper", capabilities: ["tts"], languages: ["es-ES"], builds: [build("sherpa-onnx", "int8", 20, 13)] },
  { id: "piper-en_US-ljspeech-medium", family: "piper", capabilities: ["tts"], languages: ["en-US"], builds: [build("sherpa-onnx", "int8", 30, 21)] },
  { id: "qwen3-asr-0.6b", family: "qwen3-asr", capabilities: ["stt"], languages: QWEN3_ASR_LANGUAGES, builds: [build("sherpa-onnx", "int8", 1090, 879)] },
  { id: "supertonic-3", family: "supertonic", capabilities: ["tts"], languages: SUPERTONIC_3_LANGUAGES, builds: [build("sherpa-onnx", "int8", 190, 145)] },
  // Its one build is the browser's: in the apps it never runs, and it lands under "No disponibles aquí".
  { id: "supertonic-2", family: "supertonic", capabilities: ["tts"], languages: ["en", "ko", "es", "pt", "fr"], builds: [build("transformers-js", "fp32", 330, 263)] },
  whisper("whisper-tiny", "q5_1", { mlx: [100, 79], sherpa: [130, 104], cpp: [40, 32], fp16: [100, 79], q8: [60, 44] }),
  whisper("whisper-base", "q5_1", { mlx: [180, 148], sherpa: [200, 161], cpp: [80, 60], fp16: [190, 149], q8: [100, 80] }),
  whisper("whisper-small", "q5_1", { mlx: [600, 486], sherpa: [470, 375], cpp: [240, 190], fp16: [610, 488], q8: [310, 252] }),
  whisper("whisper-large-v3", "q5_0", { sherpa: [2210, 1776], cpp: [1350, 1081], fp16: [3840, 3094], q8: [2260, 1826] }),
  whisper("whisper-large-v3-turbo", "q5_0", { sherpa: [1290, 1037], cpp: [720, 574], fp16: [2010, 1621], q8: [1350, 1088] }),
].map((model, index) => ({ ...model, index }));

/** Quality, hand-written per capability (decided 2026-11-10; Transcripción's third is qwen3-asr, 2026-11-11): the models it
 *  names, best first. A model it does not name is ranked after those it does, in the catalogue's order. */
export const QUALITY = {
  stt: ["whisper-large-v3-turbo", "parakeet-tdt-0.6b-v3", "qwen3-asr-0.6b", "whisper-small", "whisper-base", "whisper-tiny"],
  tts: ["supertonic-3", "supertonic-2", "kokoro-82m-v1.0", "piper-es_ES-carlfm-x_low", "piper-en_US-ljspeech-medium"],
};

/** "Comfortable on": the accelerator classes a model's turn is expected within comfort_ms on (a hand-written hint in the
 *  catalogue until a check measures the device: sidevoice-engine#155). Whisper's large ones are comfortable on a
 *  graphics card only; the rest are small enough for a CPU. */
export const COMFORTABLE_ON = {
  "whisper-large-v3-turbo": ["gpu"],
  "whisper-large-v3": ["gpu"],
  default: ["gpu", "cpu"],
};

/**
 * The three example devices. `engines` says where each backend runs on that device (a backend not listed is not in this
 * build of the engine there); `gpuBuilds: false` removes every build that would run on a graphics card (decided: iOS,
 * until sidevoice-engine#154). `memoryMb` is the memory the set runs on (RAM now; Apple's is unified and counts once).
 */
export const DEVICES = {
  mac: {
    id: "mac", name: "Mac · Apple silicon · 16 GB", short: "Mac", mobile: false, gpuBuilds: true, memoryMb: 16384, frame: 720,
    memoryNote: "16 GB, unified memory (counts once)",
    engines: { "whisper-cpp": { class: "gpu", accelerator: "metal" }, mlx: { class: "gpu", accelerator: "metal" }, "sherpa-onnx": { class: "cpu", accelerator: "cpu" }, onnxruntime: { class: "cpu", accelerator: "cpu" } },
    facts: "Metal is there; MLX and whisper.cpp run on it.",
  },
  windows: {
    id: "windows", name: "Windows · 8 GB · no GPU builds", short: "Windows", mobile: false, gpuBuilds: true, memoryMb: 8192, frame: 720,
    memoryNote: "8 GB RAM",
    engines: { "whisper-cpp": { class: "cpu", accelerator: "cpu" }, "sherpa-onnx": { class: "cpu", accelerator: "cpu" }, onnxruntime: { class: "cpu", accelerator: "cpu" } },
    facts: "No GPU build in the catalogue for Windows today: everything runs on the CPU (MLX is Apple's).",
  },
  iphone: {
    id: "iphone", name: "iPhone", short: "iPhone", mobile: true, gpuBuilds: false, memoryMb: 2048, frame: 390,
    memoryNote: "about 2 GB available to the app",
    engines: { "whisper-cpp": { class: "gpu", accelerator: "metal" }, mlx: { class: "gpu", accelerator: "metal" }, "sherpa-onnx": { class: "cpu", accelerator: "cpu" }, onnxruntime: { class: "cpu", accelerator: "cpu" } },
    facts: "Mobile policy: CPU builds only. GPU builds are removed, not ranked lower (Metal Whisper aborts in the background: engine#153/154).",
  },
};
export const DEVICE_IDS = Object.keys(DEVICES);

/** The person's language, a toggle in the sheet: the one set for Transcription, else the system's. */
export const LANGUAGES = { es: "Español", it: "Italiano" };

/** The two screens' tasks and the capability each one is. */
export const TASKS = ["stt", "tts"];

// --- the words ---

/** What the app already says, by the web's message keys (sidevoice-web@b95f87a apps/web/src/i18n/locales/es.ts). */
export const COPY = {
  "settings.section.transcription": "Transcripción",
  "settings.section.voice": "Voz",
  "settings.transcription.description": "Lo que convierte tu voz en texto para el agente: dónde se ejecuta y con qué modelo.",
  "settings.voice.description": "Lo que lee en voz alta las respuestas del agente: dónde se ejecuta, su modelo y su voz.",
  "voice.source": "Origen",
  "voice.source.local": "En este dispositivo",
  "voice.family": "Familia",
  "voice.model": "Modelo",
  "voice.unfit.memory": "no cabe en la memoria de este dispositivo",
  "voice.unfit.build-accelerator": "necesita un acelerador que este dispositivo no tiene",
  "voice.unfit.backend-not-in-this-build": "su motor no está en esta versión",
  "voice.languages.unsupported": "No admite {language}",
  "voice.languages.more": "+{n} idiomas más",
  "voice.languages.title": "Idiomas que admite este modelo ({n})",
  "voice.prepare.badge.absent": "Sin descargar",
  "voice.prepare.badge.ready": "Listo",
  "voice.prepare.download": "Descargar",
  "voice.prepare.cancel": "Cancelar",
  "voice.prepare.downloading": "Descargando…",
  "voice.prepare.downloadingAt": "Descargando… {percent}%",
  "voice.prepare.progress": "{done} de {size}",
  "voice.prepare.onDevice": "{size} en este dispositivo",
  "voice.prepare.lockedHint": "Cancela la descarga para elegir otro modelo.",
  "runtime.recommended": "Recomendado",
  "runtime.onDisk": "En este dispositivo",
  "runtime.advanced": "Avanzado: cómo se ejecuta",
  "runtime.title": "Cómo se ejecuta",
  "runtime.auto": "Automático (recomendado)",
  "runtime.info": "Qué motor y formato ejecutan este modelo en tu equipo (p. ej. MLX en Apple silicon). Lo recomendado ya es lo mejor para este equipo: cámbialo solo si sabes por qué.",
  "runtime.sizes": "{download} de descarga · {memory} en memoria",
  "runtime.memory": "{memory} en memoria",
  "runtime.fact.languages": "Idiomas",
  "runtime.fact.size": "Tamaño",
  "runtime.fact.status": "Estado",
  "runtime.fact.runsOn": "Se ejecuta en",
  "runtime.hardware.cpu": "CPU",
  "runtime.hardware.gpu": "GPU",
  "runtime.notHere": "No funciona aquí: {reasons}",
  "runtime.on.gpu": "tarjeta gráfica ({api})",
  "runtime.on.cpu": "procesador",
  "wizard.eyebrow": "Primeros pasos",
  "wizard.stepOf": "Paso {n} de {total} · {group}",
  "wizard.progress": "Progreso de configuración",
  "wizard.group.transcription": "Transcripción",
  "wizard.group.voice": "Voz",
  "wizard.title.stt": "Configura la transcripción",
  "wizard.title.tts": "Configura la voz",
  "wizard.sttIntro": "Elige dónde transcribe este dispositivo lo que dices y di una frase corta para probarlo.",
  "wizard.ttsIntro": "Elige cómo dice este dispositivo las respuestas y escucha una frase. Puedes cambiarla.",
  "wizard.back": "Atrás",
  "wizard.continueWithoutTrying": "Continuar sin probar",
  "wizard.skip.later": "Saltar por ahora",
  "try.tryIt": "Probar",
};

/** The one open decision: how the closed Modelo box shows «Recomendado» (the keys are `?rec=`). The words are the sheet's own
 *  chrome, for Rubén; the screens add no word: every option uses the app's «Recomendado» and its components. */
export const REC_VARIANTS = {
  a: { label: "A · Tag inside the box", text: "«Recomendado» after the model's name, inside the closed box, as it is now: the clearest, and the Modelo column is wider than Familia's (on a phone the name is cut short)." },
  b: { label: "B · Tag in the label row", text: "The same tag at the end of the field's label row, next to «Modelo» (the Field's own aside): the box keeps its normal width and its whole name." },
  c: { label: "C · Sparkle in the box", text: "The app's sparkle before the name, in the closed box (the Select's leading icon), with «Recomendado» as its label and tooltip: the box keeps its width; the meaning is in the glyph." },
};
