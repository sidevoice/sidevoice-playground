// Turn detection as sidevoice-voice decides it, with no engine and no page: what ends a turn after the voice
// activity detector's end of speech. The numbers are the voice module's (`src/config.rs`, `Patience`; `src/call.rs`,
// `END_OF_TURN_LIKELY`), so the screen shows what a call would do with the same detector:
//
// - `silence`: the turn ends once silence after the detector's end of speech lasts `silence` ms;
// - `smart-turn`: after a pause of `pause` ms the end-of-turn model is asked about the turn so far; P(end) at or above
//   the threshold ends it now, anything below keeps listening; a pause of `longest` ms ends it whatever was said.
//
// Speech that starts again before any of that cancels it: the same turn goes on. Times are on the audio's own clock, in
// ms from the stream's start, so the rules run the same in a test as on a microphone.

import { preferredBuild, modelLabel } from "../catalog.mjs";

/** Per patience: `silence` ends a turn in `silence` mode; `pause` asks the model and `longest` ends it in `smart-turn`. */
export const PATIENCE = {
  fast: { silence: 2000, pause: 600, longest: 2500 },
  normal: { silence: 2500, pause: 900, longest: 3000 },
  calm: { silence: 3500, pause: 1300, longest: 4000 },
};

/** The voice module's end-of-turn threshold: P(end) from which a paused turn is over. */
export const END_OF_TURN_LIKELY = 0.5;

/** The detector options the voice module streams with (`apps/web` of sidevoice-web passes the same). */
export const VAD_DEFAULTS = { threshold: 0.6, minSilenceMs: 200, minSpeechMs: 400 };

/**
 * The chain's decisions. `settings` is `{ mode: "silence" | "smart-turn", patience, threshold }`, changeable at any
 * time with `configure`. Each method returns the log entries it produced: `{ kind, at, ... }`, `at` in ms.
 */
export function createTurnChain(settings) {
  let config = { mode: "silence", patience: "normal", threshold: END_OF_TURN_LIKELY, ...settings };
  let turn = null; // { number, start, pausedAt, asked, answered }
  let turns = 0;
  const plan = () => PATIENCE[config.patience] ?? PATIENCE.normal;
  const cut = (at, reason, extra = {}) => {
    const ended = turn;
    turn = null;
    return [{ kind: "cut", at, reason, turn: ended.number, length: at - ended.start, ...extra }];
  };
  return {
    configure(next) { config = { ...config, ...next }; },
    get settings() { return { ...config }; },
    /** The open turn, if any: `{ number, start, pausedAt }`. */
    get turn() { return turn && { number: turn.number, start: turn.start, pausedAt: turn.pausedAt }; },
    speechStart(at) {
      if (turn) {
        const resumed = turn.pausedAt != null;
        turn.pausedAt = null;
        turn.asked = turn.answered = false;
        return resumed ? [{ kind: "resumed", at, turn: turn.number }] : [];
      }
      turn = { number: ++turns, start: at, pausedAt: null, asked: false, answered: false };
      return [{ kind: "turn", at, turn: turn.number }];
    },
    speechEnd(at) {
      if (!turn) return [];
      turn.pausedAt = at;
      const { silence, pause, longest } = plan();
      return config.mode === "smart-turn"
        ? [{ kind: "pause", at, turn: turn.number, askAt: at + pause, cutAt: at + longest }]
        : [{ kind: "pause", at, turn: turn.number, cutAt: at + silence }];
    },
    /** What the clock reaching `at` does: in `smart-turn`, asks the model once per pause; ends the turn on time. */
    tick(at) {
      if (!turn || turn.pausedAt == null) return [];
      const { silence, pause, longest } = plan();
      const silent = at - turn.pausedAt;
      if (config.mode !== "smart-turn") return silent >= silence ? cut(at, "silence", { silent }) : [];
      if (silent >= longest) return cut(at, "longest", { silent });
      if (silent >= pause && !turn.asked) {
        turn.asked = true;
        return [{ kind: "ask", at, turn: turn.number, from: turn.start }];
      }
      return [];
    },
    /** The model's P(end) for the pause it was asked about: the turn ends at or above the threshold, else goes on. */
    answer(at, probability, asked) {
      if (!turn || turn.number !== asked || turn.pausedAt == null || turn.answered) return [];
      turn.answered = true;
      if (probability >= config.threshold) return cut(at, "end-of-turn", { probability });
      return [{ kind: "keep", at, turn: turn.number, probability }];
    },
    /** How long until the next thing the clock decides, for a countdown: `{ what, in }` or null. */
    next(at) {
      if (!turn || turn.pausedAt == null) return null;
      const { silence, pause, longest } = plan();
      if (config.mode !== "smart-turn") return { what: "cut", in: turn.pausedAt + silence - at };
      if (!turn.asked) return { what: "ask", in: turn.pausedAt + pause - at };
      return { what: "cut", in: turn.pausedAt + longest - at };
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
