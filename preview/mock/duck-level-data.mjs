// What the duck-level design sheet (duck-level.html) shows: the options for the level other apps' media is lowered
// to, and the words of the row they sit in. No DOM here, so a test can hold the options to what was decided.
//
// The row is Settings > Call > "Other apps' media" (sidevoice-web#468, MediaDuckRow): a mode (Lower, Pause, Do nothing)
// and, for Lower only, a level. Decided: the level is configurable now, its default is 25 % (what is left of another
// app's volume while it is lowered), Lower is the default mode, and the level control only applies to Lower.

/** The level a person starts at: what is left of another app's volume while it is lowered, in percent. */
export const DEFAULT_LEVEL = 25;

/** The words the app has today for the row and its hints, as the web's Spanish catalogue says them
 *  (sidevoice-web@3b2044d apps/web/src/i18n/locales/es.ts), so the new control sits among the real ones. */
export const TODAY = {
  section: "Llamada",
  sectionHint: "Cómo se comporta una llamada: cuándo acaba tu turno, el sonido mientras el agente trabaja y la pantalla.",
  row: "Multimedia de otras aplicaciones",
  hint: "Mientras tu micrófono está abierto en una llamada y mientras habla el agente. Sidevoice solo restablece lo que bajó o pausó.",
  // macOS: Pause reaches Music and Spotify only, and the row says so (decided 2026-11-04).
  hintPauseMac: "Solo se pueden pausar Música y Spotify; YouTube, los navegadores y otras aplicaciones, no.",
};

/** The row's modes, in the order the row lists them: Lower is the default. */
export const MODES = [
  { value: "lower", label: "Bajar el volumen" },
  { value: "pause", label: "Pausar" },
  { value: "off", label: "No hacer nada" },
];

/** "25 %": a number and its sign, a no-break space between (Spanish typesetting). */
export const percent = (value) => `${value} %`;

/** The three options. The keys are the values of the `duckLevel` variant (preview/mock/shell.mjs VARIANTS). `level` is
 *  what is left of the volume, in percent; the options that are presets list their stops, the slider its range.
 *  `start` is the level an option begins at: the decided 25 % where the option can hold it. */
export const OPTIONS = {
  presets: {
    letter: "A",
    name: "3 presets",
    label: "Cuánto bajar",
    hint: `Deja las demás aplicaciones en el ${percent(50)} de su volumen (Un poco), en el ${percent(25)} (Mucho) o en silencio (Silenciar).`,
    start: DEFAULT_LEVEL,
    steps: [
      { label: "Un poco", level: 50 },
      { label: "Mucho", level: 25 },
      { label: "Silenciar", level: 0 },
    ],
  },
  slider: {
    letter: "B",
    name: "Slider",
    label: "Volumen al bajar",
    hint: `El volumen al que bajan las demás aplicaciones: ${percent(0)} es silencio y ${percent(100)}, sin cambios.`,
    start: DEFAULT_LEVEL,
    range: { min: 0, max: 100, step: 5 },
  },
  windows: {
    letter: "C",
    name: "Windows-style",
    label: "Reducir el volumen",
    hint: "Cuánto se reduce el de las demás aplicaciones, como en Windows. Silenciar las deja mudas y Nada no las toca.",
    // Windows' own four, as reductions: mute, 80 %, 50 %, nothing. A reduction of 80 % leaves 20 %: the decided 25 % is not a stop.
    start: 20,
    steps: [
      { label: "Silenciar", level: 0 },
      { label: percent(80), level: 20 },
      { label: percent(50), level: 50 },
      { label: "Nada", level: 100 },
    ],
  },
};

export const OPTION_IDS = Object.keys(OPTIONS);

/** The step of `option` that `level` is, or -1 when none is (a slider has no steps; a preset list may not hold a level). */
export function stepOf(option, level) {
  return (option.steps ?? []).findIndex((step) => step.level === level);
}

/**
 * What the row says and shows for `mode` and `level` under the option `id`, on macOS with its permissions granted
 * (the path that carries the hint for Pause): the hint under the mode, and the level's row, only for Lower.
 */
export function rowFor(id, mode, level = OPTIONS[id].start) {
  const option = OPTIONS[id];
  return {
    hint: mode === "pause" ? TODAY.hintPauseMac : TODAY.hint,
    level: mode === "lower" ? { label: option.label, hint: option.hint, level, step: stepOf(option, level) } : null,
  };
}
