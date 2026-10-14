// Turn detection as sidevoice-voice decides it (`src/turns.rs` and its parts, `src/config.rs` `Patience`,
// `src/call.rs` `END_OF_TURN_LIKELY`), with no engine and no page, so the screen shows what a call would do with the
// same detector. It is Pipecat's, as the Python core ran it (pipecat-ai 1.10.0):
//
// - a detector window is speech when its probability is at least `CONFIDENCE` and the volume clears the listening
//   bar (`LISTENING_BAR`); a backend that gives no probability is taken at its `speech` flag;
// - the volume is the loudness of the last 400 ms (ITU-R BS.1770: K-weighted, gated at −70 LUFS, in libloudness's
//   0.1 LU bins), from −110 LUFS (0) to −10 LUFS (1), smoothed by 0.2 per window;
// - speech starts after `START_MS` of such windows and stops after the patience's `stop` (with `smart-turn`) or
//   `SILENCE_STOP_MS` (with `silence`) without any, durations rounded to windows half to even;
// - a turn opens where speech starts. Where speech stops a pause begins: with `smart-turn` the end-of-turn model is
//   asked then, at every stop, about the turn from `PRE_SPEECH_MS` before its speech started (its last
//   `END_OF_TURN_AUDIO_MS`); P(end) above the threshold cuts the turn, and the pause cuts it `longest` after the stop
//   whatever the model said. With `silence` the pause cuts it `silence` after the stop. Speech that starts again ends
//   the pause: the same turn goes on.
//
// Times are on the audio's own clock, in ms from the stream's start, so the rules run the same in a test as on a
// microphone.

import { preferredBuild, modelLabel } from "../catalog.mjs";

/** Per patience: with `smart-turn`, how long without speech stops it (and asks the model), and how long after that a
 *  pause cuts the turn anyway; with `silence`, how long after its stop a pause cuts the turn. */
export const PATIENCE = {
  fast: { stop: 600, longest: 2500, silence: 2000 },
  normal: { stop: 900, longest: 3000, silence: 2500 },
  calm: { stop: 1300, longest: 4000, silence: 3500 },
};

/** With `silence`, how long without speech stops it. */
export const SILENCE_STOP_MS = 200;
/** How long speech must go on before it starts. */
export const START_MS = 400;
/** The detector's probability from which a window is speech. */
export const CONFIDENCE = 0.6;
/** The volume speech needs: `quiet` (−60 LUFS), and `playing` (−30 LUFS) while a reply sounds. */
export const LISTENING_BAR = { quiet: 0.5, playing: 0.8 };
/** The voice module's end-of-turn threshold: P(end) above which a paused turn is over. */
export const END_OF_TURN_LIKELY = 0.5;
/** What the end-of-turn model hears: from this long before the turn's speech started, its last seconds at most. */
export const PRE_SPEECH_MS = 500 + START_MS;
export const END_OF_TURN_AUDIO_MS = 8000;

/** The detector options sidevoice-web streams with: they shape only `speech`, which counts where a backend gives no
 *  probability. */
export const VAD_DEFAULTS = { threshold: 0.6, minSilenceMs: 200, minSpeechMs: 400 };

/** `x` rounded to an integer, half to even (Python's `round`). */
export function roundHalfEven(x) {
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** BS.1770's K-weighting at `rate`, as one fourth-order filter, with libloudness's coefficients. */
function kWeighting(rate) {
  const shelf = (() => {
    const f0 = 1681.974450955533;
    const vh = 10 ** (3.999843853973347 / 20);
    const vb = vh ** 0.4996667741545416;
    const q = 0.7071752369554196;
    const k = Math.tan((Math.PI * f0) / rate);
    const a0 = 1 + k / q + k * k;
    return {
      b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0],
      a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
    };
  })();
  const k = Math.tan((Math.PI * 38.13547087602444) / rate);
  const q = 0.5003270373238773;
  const d = 1 + k / q + k * k;
  const highPass = { b: [1, -2, 1], a: [1, (2 * (k * k - 1)) / d, (1 - k / q + k * k) / d] };
  const convolve = (x, y) => [
    x[0] * y[0],
    x[0] * y[1] + x[1] * y[0],
    x[0] * y[2] + x[1] * y[1] + x[2] * y[0],
    x[1] * y[2] + x[2] * y[1],
    x[2] * y[2],
  ];
  return { b: convolve(shelf.b, highPass.b), a: convolve(shelf.a, highPass.a) };
}

/** The loudness of `block` (mono samples at `rate`), filtered from rest, in LUFS: −Infinity under the gate, else the
 *  centre of its 0.1 LU bin. */
export function loudness(block, rate = 16000) {
  const { b, a } = kWeighting(rate);
  let [v0, v1, v2, v3, v4] = [0, 0, 0, 0, 0];
  let energy = 0;
  for (const sample of block) {
    [v4, v3, v2, v1] = [v3, v2, v1, v0];
    v0 = sample - a[1] * v1 - a[2] * v2 - a[3] * v3 - a[4] * v4;
    const out = b[0] * v0 + b[1] * v1 + b[2] * v2 + b[3] * v3 + b[4] * v4;
    energy += out * out;
  }
  const lufs = 10 * Math.log10(energy / block.length) - 0.691;
  if (!(lufs >= -70)) return -Infinity;
  const bin = Math.min(Math.floor((lufs + 70) / 0.1), 999);
  return -70 + bin * 0.1 + 0.05;
}

/** The volume of the windows fed to it, smoothed: 0 until 400 ms are in. */
export function createVolume(rate = 16000) {
  const size = Math.ceil(rate * 0.4);
  let block = new Float32Array(0);
  let value = 0;
  return {
    take(samples) {
      const joined = new Float32Array(block.length + samples.length);
      joined.set(block);
      joined.set(samples, block.length);
      block = joined.subarray(Math.max(0, joined.length - size));
      const lufs = block.length === size ? loudness(block, rate) : -Infinity;
      const volume = Math.min(1, Math.max(0, (lufs + 110) / 100));
      value += 0.2 * (volume - value);
      return value;
    },
    get value() { return value; },
  };
}

/**
 * The chain's decisions. `settings` is `{ mode: "silence" | "smart-turn", patience, threshold, quietBar, playingBar }`,
 * changeable at any time with `configure`; `rate` is the detector's. Each method returns the log entries it produced:
 * `{ kind, at, ... }`, `at` in ms.
 */
export function createTurnChain(settings, rate = 16000) {
  let config = {
    mode: "silence", patience: "normal", threshold: END_OF_TURN_LIKELY,
    quietBar: LISTENING_BAR.quiet, playingBar: LISTENING_BAR.playing, ...settings,
  };
  const volume = createVolume(rate);
  let state = { kind: "quiet", count: 0 }; // the detector: quiet, starting, speaking, stopping
  let heard = { speech: false, volume: 0 }; // the last window: whether it counted as speech, and the volume
  let turn = null; // { number, start, pauses, pausedAt, paused, silent }
  let turns = 0;
  let lastCut = -Infinity;
  const plan = () => PATIENCE[config.patience] ?? PATIENCE.normal;
  const smart = () => config.mode === "smart-turn";
  const ms = (samples) => (samples / rate) * 1000;
  const windows = (durationMs, samples) => roundHalfEven(durationMs / 1000 / (Math.max(1, samples) / rate));
  const stopMs = () => (smart() ? plan().stop : SILENCE_STOP_MS);
  const cut = (at, reason, extra = {}) => {
    const ended = turn;
    turn = null;
    lastCut = at;
    return [{ kind: "cut", at, reason, turn: ended.number, length: at - ended.start, silent: ms(ended.silent), ...extra }];
  };

  /** The detector's state after a window that is speech or not; "started" or "stopped" when it changed. */
  function detect(speech, samples) {
    const { kind, count } = state;
    if (speech) state = kind === "quiet" ? { kind: "starting", count: 1 } : kind === "starting" ? { kind, count: count + 1 } : { kind: "speaking", count: 0 };
    else state = kind === "starting" || kind === "quiet" ? { kind: "quiet", count: 0 } : kind === "speaking" ? { kind: "stopping", count: 1 } : { kind, count: count + 1 };
    if (state.kind === "starting" && state.count >= windows(START_MS, samples)) {
      state = { kind: "speaking", count: 0 };
      return "started";
    }
    if (state.kind === "stopping" && state.count >= windows(stopMs(), samples)) {
      state = { kind: "quiet", count: 0 };
      return "stopped";
    }
    return null;
  }

  return {
    configure(next) { config = { ...config, ...next }; },
    get settings() { return { ...config }; },
    /** The open turn, if any: `{ number, start, pausedAt }`. */
    get turn() { return turn && { number: turn.number, start: turn.start, pausedAt: turn.pausedAt }; },
    /** The last window: whether it counted as speech, and the volume after it. */
    get heard() { return { ...heard }; },
    /**
     * One detector window that ends at `at`: its `samples`, the detector's `probability` (null where the backend gives
     * none, which leaves its `speech` flag to decide), and whether a reply is `playing`.
     */
    window(at, samples, probability, speech, playing = false) {
      const confidence = probability ?? (speech ? 1 : 0);
      const loud = volume.take(samples);
      const bar = playing ? Math.max(config.quietBar, config.playingBar) : config.quietBar;
      heard = { speech: confidence >= CONFIDENCE && loud >= bar, volume: loud };
      const change = detect(heard.speech, samples.length);
      if (!turn) {
        if (change !== "started") return [];
        turn = { number: ++turns, start: at, pauses: 0, pausedAt: null, paused: 0, silent: 0 };
        return [{ kind: "turn", at, turn: turn.number }];
      }
      turn.silent = state.kind === "speaking" ? 0 : turn.silent + samples.length;
      if (change === "started") {
        turn.pausedAt = null;
        return [{ kind: "resumed", at, turn: turn.number }];
      }
      if (change === "stopped") {
        turn.pauses += 1;
        turn.pausedAt = at;
        turn.paused = 0;
        if (!smart()) return [{ kind: "pause", at, turn: turn.number, cutAt: at + plan().silence }];
        const from = Math.max(turn.start - PRE_SPEECH_MS, at - END_OF_TURN_AUDIO_MS, lastCut);
        return [
          { kind: "pause", at, turn: turn.number, askAt: at, cutAt: at + plan().longest },
          { kind: "ask", at, turn: turn.number, pause: turn.pauses, from },
        ];
      }
      if (turn.pausedAt == null) return [];
      turn.paused += samples.length;
      const end = smart() ? plan().longest : plan().silence;
      if (turn.paused < (end / 1000) * rate) return [];
      return cut(at, smart() ? "longest" : "silence");
    },
    /** The model's P(end) for the pause it was `asked` about (`{ turn, pause }`): above the threshold the turn ends,
     *  else it goes on. */
    answer(at, probability, asked) {
      if (!turn || turn.number !== asked.turn || turn.pauses !== asked.pause || turn.pausedAt == null) return [];
      if (probability > config.threshold) return cut(at, "end-of-turn", { probability });
      return [{ kind: "keep", at, turn: turn.number, probability }];
    },
    /** How long until the next thing the chain decides, for a countdown: `{ what, in }` or null. */
    next(at) {
      if (!turn) return null;
      if (turn.pausedAt != null) return { what: "cut", in: turn.pausedAt + (smart() ? plan().longest : plan().silence) - at };
      if (state.kind === "stopping") return { what: smart() ? "ask" : "stop", in: stopMs() - ms(turn.silent) };
      return null;
    },
  };
}

/** The models of `capability` an engine's catalogue offers this screen: those with a build that runs here are usable. */
export function turnModelChoices(catalog, capability) {
  return (catalog ?? [])
    .filter((model) => model.capabilities.includes(capability))
    .map((model) => {
      const build = preferredBuild(model);
      return { id: model.id, label: modelLabel(model), build: build?.id ?? null, disabled: !build };
    });
}

/** A linear resampler from `from` Hz to `to` Hz that keeps its phase across the chunks fed to it. */
export function createResampler(from, to) {
  if (from === to) return (chunk) => chunk;
  const step = from / to;
  let position = 0; // where the next output sample falls, in input samples, relative to the current chunk
  let previous = 0; // the last sample of the previous chunk
  return (chunk) => {
    const out = [];
    for (; position < chunk.length; position += step) {
      const index = Math.floor(position);
      const fraction = position - index;
      const before = index < 0 ? previous : chunk[index];
      const after = index + 1 < chunk.length ? chunk[index + 1] : chunk[index];
      out.push(before + (after - before) * fraction);
    }
    position -= chunk.length;
    previous = chunk.length ? chunk[chunk.length - 1] : previous;
    return Float32Array.from(out);
  };
}
