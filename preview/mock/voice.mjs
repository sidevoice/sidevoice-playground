// The mocked preview's voice: a `VoiceHost` (@sidevoice/voice's seam, js/voice-host.d.ts) that hears no microphone
// and plays no sound. What the person says comes from the card (`speak`): the call tells it as a turn, with the
// levels and states a real one goes through; what the page asks it to say is "heard" at a reading pace, chunk by
// chunk. The world's `voice` says what fails: the microphone (its permission, or none connected: microphone.mjs), transcription, speech.
//
// The seam is @sidevoice/voice's `VoiceHost` / `VoiceCallHost` (the web's apps/web/src/host/types.ts, `VoiceMember.host()`):
// `start(settings, options)` answers a call at once, and its `ready` says when it works or why it cannot (a key missing,
// the microphone refused). The page's own voice in a browser and the desktop app's are the same mock.
//
// A try's take (@sidevoice/voice's `VoiceTake`, and the desktop app's `host.voice`, sidevoice-desktop#71): started with `{take: true}`, the voice keeps what its microphone "gave" from the
// moment it listens until it stops, silence while muted, and hands it to `onTake` before `stop()` resolves. With no
// microphone, it is made up from what the voice told: a low hiss throughout, a voiced tone at the levels it told while
// the person spoke, the pauses quiet, and the marks of the turns it told, where it told them. The world's `voice.take`
// false hands none, as a voice without takes does (@sidevoice/voice 0.3.x).
// @ts-check

import { LOCAL, voiceState } from "./models.mjs";
import { askMicrophone } from "./microphone.mjs";

/** @typedef {import("./web-types").VoiceHost} VoiceHost */
/** @typedef {import("./web-types").VoiceCallHost} VoiceCallHost */
/** @typedef {import("./web-types").VoiceSettings} VoiceSettings */
/** @typedef {import("./web-types").VoiceTurnEvent} VoiceTurnEvent */
/** @typedef {import("./web-types").VoiceCallState} VoiceCallState */
/** @typedef {import("./web-types").VoiceSayEvent} VoiceSayEvent */
/** @typedef {import("./web-types").VoiceSayOutcome} VoiceSayOutcome */
/** @typedef {import("./web-types").VoiceSaying} VoiceSaying */
/** @typedef {import("./web-types").VoiceTake} VoiceTake */

const refusal = (code) => Object.assign(new Error(code), { code });

/** The call's own rate: a take is 16 kHz mono. */
const TAKE_RATE = 16000;

/**
 * What the microphone "gave" while a take was kept, from `taking` (when it started, what the person said in it, the
 * marks of their turns) until `endedAt`, in the world's ms: a low hiss throughout; where the person spoke, a voice's
 * pitch and two harmonics, as loud as the levels the voice told (the 60 dB window the web reads levels on), from one
 * level to the next; the pauses, the hiss alone; while muted, silence.
 * @param {{ startedAt: number, speech: { from: number, to: number, levels: { at: number, level: number }[] }[], turns: VoiceTake["turns"], muted: { from: number, to: number }[] }} taking
 * @param {number} endedAt
 * @returns {VoiceTake}
 */
export function synthesisedTake(taking, endedAt) {
  const lasted = Math.max(0, endedAt - taking.startedAt);
  const samples = new Float32Array(Math.round((lasted / 1000) * TAKE_RATE));
  let seed = 7;
  const hiss = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 2 ** 32) * 2 - 1; };
  for (let i = 0; i < samples.length; i++) samples[i] = 0.002 * hiss();
  // The harmonics' own RMS: dividing by it, a level's amplitude is the RMS it stands for.
  const unit = Math.sqrt((1 + 0.25 + 0.0625) / 2);
  for (const part of taking.speech) {
    const from = Math.round((part.from / 1000) * TAKE_RATE);
    // Still speaking when the take ended: to its end.
    const to = Math.min(samples.length, Math.round(((part.to > part.from ? Math.min(part.to, lasted) : lasted) / 1000) * TAKE_RATE));
    const levels = part.levels.length ? part.levels : [{ at: part.from, level: 0.5 }];
    let step = 0;
    for (let i = from; i < to; i++) {
      const ms = (i / TAKE_RATE) * 1000;
      while (step < levels.length - 1 && levels[step + 1].at <= ms) step++;
      const now = levels[step], next = levels[step + 1] ?? now;
      const level = next === now ? now.level : now.level + ((next.level - now.level) * (ms - now.at)) / Math.max(1, next.at - now.at);
      const rms = 10 ** ((Math.max(0, level) * 60 - 60) / 20);
      const t = i / TAKE_RATE;
      const voiced = Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.25 * Math.sin(2 * Math.PI * 420 * t);
      samples[i] += (rms * voiced) / unit;
    }
  }
  // Muted: what the microphone gave is not kept.
  for (const part of taking.muted) {
    samples.fill(0, Math.round((part.from / 1000) * TAKE_RATE), Math.min(samples.length, Math.round((part.to / 1000) * TAKE_RATE)));
  }
  return { sampleRate: TAKE_RATE, samples, started_at: taking.startedAt, ended_at: endedAt, turns: taking.turns };
}

/** How long the person speaks when the card says something, whatever its length: the take, the bars and the turn's
 *  timings are the same for a word and a paragraph. */
export const SPEAKING_MS = 3000;
/** How long a turn takes to transcribe once it has ended: long enough to see the transcribing state (operator, 2026-10-15). */
export const TRANSCRIBING_MS = 1500;
/** How often a speaking voice tells its level. */
const LEVEL_STEP_MS = 60;

/**
 * The level of a voice speaking, 0 to 1, `ms` into it: syllables at about four a second, a phrase that rises and
 * falls, short gaps between words, and a little unevenness — so bars move as a real microphone's do. `seed` shifts it,
 * so two turns do not look the same.
 */
export function speechLevel(ms, seed = 0) {
  const t = ms / 1000;
  const syllable = Math.abs(Math.sin(Math.PI * 4.3 * t + seed)) ** 0.6;
  const phrase = 0.62 + 0.38 * Math.sin((2 * Math.PI * t) / 1.9 + seed * 1.3);
  const word = (t * 1.6 + seed) % 1 < 0.13 ? 0.12 : 1;
  const uneven = 0.85 + 0.3 * (((Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453) % 1 + 1) % 1);
  return word < 1 ? 0.12 : Math.max(0.03, Math.min(0.85, 0.3 + 0.55 * syllable * phrase * uneven));
}

/** How long a silence ends a turn, as the settings say: the voice detector's wait alone (Silence), or shorter where
 *  the end-of-turn model decides (Smart); longer the calmer the patience. */
const ENDPOINT_MS = { silence: { fast: 2000, normal: 2500, calm: 3500 }, "smart-turn": { fast: 600, normal: 900, calm: 1300 } };
export function endpointMs(settings) {
  const mode = ENDPOINT_MS[/** @type {keyof typeof ENDPOINT_MS} */ (settings?.end_of_turn ?? "smart-turn")] ?? ENDPOINT_MS["smart-turn"];
  return mode[/** @type {keyof typeof mode} */ (settings?.patience ?? "normal")] ?? mode.normal;
}

/** `endpointMs`'s settings (the turn lab's evidence names them `end_of_turn` and `patience`) for a call's input half:
 *  its `endOfTurn.kind` (`silence` or `smart`) and `patience`. */
const endOfTurnOf = (/** @type {VoiceSettings["input"]} */ input) =>
  ({ end_of_turn: input?.endOfTurn?.kind === "silence" ? "silence" : "smart-turn", patience: input?.patience });

/**
 * One call of the voice host `group` (mock-only: the calls it routes the shared microphone between), begun with `initial` settings.
 * Each call keeps its own turn and playback state; the first call of a host is the one the microphone routes to.
 * @param {any} world @param {any} group @param {VoiceSettings} initial @param {{ take?: boolean }} [options] With `take`, a take is kept from the moment it listens.
 */
function fakeCall(world, group, initial, options) {
  const callId = `mock-call-${++group.nextId}`;
  /** @type {Record<string, Set<Function>>} */
  const listeners = { turn: new Set(), state: new Set(), level: new Set(), playbackLevel: new Set(), error: new Set(), take: new Set() };
  const emit = (kind, value) => {
    for (const listener of [...listeners[kind]]) listener(value);
  };
  const on = (kind) => (listener) => {
    listeners[kind].add(listener);
    return () => listeners[kind].delete(listener);
  };
  /** @type {VoiceSettings} */
  let settings = initial;
  let started = false;
  let stopped = false;
  let muted = false;
  let turns = 0;
  /** @type {{ ended: boolean, hold: boolean, closing: Promise<void> | null, force: () => void, close: () => Promise<void>, lastSpeechAt: number, parts: { words: string[], captured: number, steps: number }[], talk: ((part: string, ms?: number) => Promise<void>) | null } | null} The turn in progress, until its end of turn is decided. */
  let open = null;
  let says = 0;
  let playbackRun = 0;
  let playbackTail = null;
  const playbackLevels = new Map();
  const activeSays = new Map();
  const sayHandles = new Map();
  const publishPlayback = () => emit("playbackLevel", Math.max(0, ...playbackLevels.values()));
  const silence = () => { playbackLevels.clear(); publishPlayback(); };
  /** The take being kept, while one was asked for: when it started, what the person said in it, their turns' marks, and
   *  when the microphone was muted (the last one open while it is).
   *  @type {{ startedAt: number, speech: { from: number, to: number, levels: { at: number, level: number }[] }[], turns: VoiceTake["turns"], muted: { from: number, to: number }[] } | null} */
  let taking = null;
  /** @type {VoiceCallState} */
  let state = { listening: "idle", recognising: 0, playback: "idle", microphone: /** @type {"live" | "muted"} */ ("live") };
  const setState = (patch) => {
    state = { ...state, ...patch };
    emit("state", state);
    world.changed();
  };
  const refreshPlayback = () => {
    const playback = [...activeSays.values()].includes("playing") ? "playing" : activeSays.size ? "synthesizing" : "idle";
    if (state.playback !== playback) setState({ playback });
  };

  /** The models the settings name: a provider's needs its key. */
  async function check(next) {
    const keys = voiceState(world).keys;
    for (const slot of [next.input?.stt, next.output?.tts]) {
      if (slot?.catalog && slot.catalog !== LOCAL && !keys[String(slot.catalog)]) throw refusal("credential-missing");
    }
  }

  /** @type {VoiceCallHost} */
  const host = {
    id: callId,
    ready: /** @type {Promise<void>} */ (/** @type {unknown} */ (null)),
    async update(change) {
      const next = { ...settings, ...change };
      if (!next.input && !next.output) throw new TypeError("voice settings need an input or an output half");
      // A model that cannot be used is an error, and that half stays as it was.
      try { await check(next); } catch (error) { emit("error", error); return; }
      settings = next;
    },
    async stop() {
      stopped = true;
      ++playbackRun;
      activeSays.clear();
      silence();
      stopFailing();
      const at = group.calls.findIndex((item) => item.host === host);
      if (at >= 0) group.calls.splice(at, 1);
      if (group.active?.host === host) group.active = null;
      if (!started) return;
      started = false;
      const kept = taking;
      taking = null;
      if (kept) emit("take", synthesisedTake(kept, world.now()));
      setState({ listening: "idle", recognising: 0, playback: "idle" });
    },
    say(text, options) {
      const id = `say-${++says}`;
      const run = playbackRun;
      const previousPlayback = world.scenario.turn ? playbackTail : null;
      const quiet = () => { if (run === playbackRun) { playbackLevels.delete(id); publishPlayback(); } };
      /** @type {Set<(event: VoiceSayEvent) => void>} */
      const events = new Set();
      let cancelled = false;
      let cancelReason = "cancelled";
      /** @type {() => void} */
      let wake = () => {};
      const woken = new Promise((resolve) => { wake = () => resolve(undefined); });
      /** A wait that a cancellation cuts short: the active delay ends at once, not at its own end. */
      const wait = (ms) => cancelled ? Promise.resolve() : Promise.race([world.delay(ms), woken]);
      // Cancelling (by the page or a barge-in) takes the say off the speaker now: no active say, playback idle at once.
      // The outcome, resolved once by the run below, says how much was heard and why it stopped.
      const interrupt = (reason) => {
        if (cancelled) return;
        cancelled = true;
        cancelReason = reason;
        quiet();
        activeSays.delete(id);
        refreshPlayback();
        wake();
      };
      const tracked = { cancelForBarge: () => interrupt("barge-in") };
      sayHandles.set(id, tracked);
      const tell = (event) => {
        for (const listener of [...events]) listener(event);
      };
      const outcome = (async () => {
        if (previousPlayback) await previousPlayback;
        // Said before the call works: after it does.
        await (started ? Promise.resolve() : host.ready.catch(() => {}));
        if (!started) return /** @type {VoiceSayOutcome} */ ({ status: "not-played", reason: "stopped" });
        activeSays.set(id, "synthesizing");
        refreshPlayback();
        await wait(400);
        if (cancelled || !started) {
          quiet(); activeSays.delete(id); refreshPlayback();
          return /** @type {VoiceSayOutcome} */ ({ status: "not-played", reason: cancelled ? cancelReason : "stopped" });
        }
        if (voiceState(world).tts === "error") {
          quiet();
          activeSays.delete(id);
          refreshPlayback();
          emit("error", { code: "speech-failed" });
          return /** @type {VoiceSayOutcome} */ ({ status: "not-played", reason: "failed", code: "speech-failed" });
        }
        if (run === playbackRun && started) {
          activeSays.set(id, "playing");
          refreshPlayback();
        }
        tell({ type: "playing" });
        // Sentence by sentence, at a reading pace.
        const chunks = text.match(/[^.!?¿¡]+[.!?]*\s*/g) ?? [text];
        let from = 0;
        for (const chunk of chunks) {
          if (cancelled || !started) {
            quiet();
            activeSays.delete(id);
            refreshPlayback();
            return /** @type {VoiceSayOutcome} */ ({ status: "heard-up-to", heard_chars: from, reason: cancelled ? cancelReason : "stopped" });
          }
          tell({ type: "progress", sounding: [from, from + [...chunk].length], heard_chars: from });
          const duration = Math.max(400, chunk.length * 55);
          for (let elapsed = 0; elapsed < duration && !cancelled && started; elapsed += 80) {
            // One silent slice per short envelope: a pause while playback is still "playing".
            if (started && !cancelled && run === playbackRun) {
              playbackLevels.set(id, Math.floor(elapsed / 80) % 5 === 4 ? 0 : speechLevel(elapsed, says * 1.7));
              publishPlayback();
            }
            await wait(Math.min(80, duration - elapsed));
          }
          quiet();
          // Cut during this chunk (the last one too): heard up to where it began, never a success.
          if (cancelled || !started) {
            activeSays.delete(id);
            refreshPlayback();
            return /** @type {VoiceSayOutcome} */ ({ status: "heard-up-to", heard_chars: from, reason: cancelled ? cancelReason : "stopped" });
          }
          from += [...chunk].length;
        }
        tell({ type: "progress", sounding: null, heard_chars: from });
        quiet();
        activeSays.delete(id);
        refreshPlayback();
        return /** @type {VoiceSayOutcome} */ ({ status: "heard" });
      })();
      if (world.scenario.turn) playbackTail = outcome.catch(() => {});
      outcome.then((ended) => { sayHandles.delete(id); tell({ type: "done", outcome: ended }); });
      /** @type {VoiceSaying} */
      const saying = {
        id,
        cancel: () => interrupt("cancelled"),
        onEvent: (listener) => {
          events.add(listener);
        },
        outcome,
      };
      void options;
      return saying;
    },
    mute(next) {
      // A take keeps silence while muted: from now, or no longer.
      if (taking && !!next !== muted) {
        const at = world.now() - taking.startedAt;
        if (next) taking.muted.push({ from: at, to: Infinity });
        else { const open = taking.muted.at(-1); if (open) open.to = at; }
      }
      muted = next;
      if (started) setState({ listening: next ? "muted" : "listening" });
    },
    cancelInput() {},
    /** Closes the open turn now with what was captured so far (@sidevoice/voice 0.5.0): it is transcribed and told as any
     *  turn. Nothing when none is open. Resolves once the turn is closed, not transcribed. */
    async endInput() {
      const turn = open;
      if (!started || !turn || turn.ended) return;
      turn.force();
      await turn.close();
    },
    onTurn: on("turn"),
    onState: on("state"),
    onLevel: on("level"),
    onPlaybackLevel: on("playbackLevel"),
    onError: on("error"),
    onTake: on("take"),
  };

  /**
   * The person says `text` (the card's "speak"): a turn, with its levels, ended once the silence after it is as long
   * as the settings' end of turn waits (`endpointMs`), recognised and told; or, as the world says, nothing heard, or a
   * transcription that fails. `pause`: a pause in the middle, shorter than the end of turn waits — still the turn.
   * `cutOff`: the turn is ended after its first half, and the person goes on — a new turn, the cut one merged into
   * it. Whether the call heard it: it hears only while it listens.
   * @param {string} text @param {{ pause?: boolean, cutOff?: boolean, durationMs?: number, level?: number }} [how]
   */
  async function speak(text, { pause = false, cutOff = false, durationMs = SPEAKING_MS, level = 0.95 } = {}) {
    if (!started || muted) return false;
    // A turn of this call still open (its end of turn not yet decided) goes on: speech routed back before the endpoint
    // continues the same turn, as one call's turns only ever merge within that call.
    if (open && !open.ended) { await open.talk(text, durationMs); return true; }
    const overlapping = [...sayHandles].filter(([id]) => activeSays.has(id));
    if (overlapping.length) {
      const threshold = Math.ceil((settings?.input?.barge_in_min_speech ?? 1) * 1000);
      // Simulated detector gate: short or quiet overlap is discarded before any
      // turn event. In silence, the same short word remains an ordinary turn.
      if (durationMs < threshold || level < 0.8) { await world.delay(durationMs); return true; }
      await world.delay(threshold);
      for (const [id, handle] of overlapping) {
        if (!activeSays.has(id)) continue;
        handle.cancelForBarge();
      }
    }
    const voice = voiceState(world);
    let turn = `${callId}-turn-${++turns}`;
    const startedAt = world.now();
    const silence = endpointMs(endOfTurnOf(settings?.input));
    // The take this is said into, if one is kept: where in it each moment falls, and the turn's marks.
    const take = taking;
    const at = () => (take ? world.now() - take.startedAt : 0);
    const opened = () => {
      const mark = { turn_id: turn, speech_ms: at(), pauses: /** @type {{ from_ms: number, to_ms: number }[]} */ ([]), end_ms: /** @type {number | null} */ (null) };
      take?.turns.push(mark);
      return mark;
    };
    let mark = opened();
    const seed = turns * 1.7;
    // The microphone is shared: a step of speech reaches this call only while it is the routed one and unmuted; any
    // other step is silence to it, and what it captured before stays in its turn.
    const hears = () => started && !muted && group.active?.host === host;
    /** @type {() => void} */
    let force = () => {};
    const forced = new Promise((resolve) => { force = () => resolve(undefined); });
    const current = open = { ended: false, hold: false, closing: null, force, close: () => close(), lastSpeechAt: world.now(), parts: /** @type {{ words: string[], captured: number, steps: number }[]} */ ([]), talk: null };
    // The same time whatever is said: SPEAKING_MS in all, in two halves around a pause or a cut. The utterance goes on
    // on the shared microphone after this call's turn has closed; the call hears none of that remainder. The turn
    // closes at its endpoint even while the utterance still runs elsewhere: the step that finds the endpoint expired
    // finishes the turn, one thing at a time, then the remainder plays on.
    const talk = async (part, ms = SPEAKING_MS) => {
      if (!current.ended) setState({ listening: "speaking" });
      const spoken = { from: at(), to: at(), levels: /** @type {{ at: number, level: number }[]} */ ([]) };
      take?.speech.push(spoken);
      const record = { words: part.split(/\s+/).filter(Boolean), captured: 0, steps: Math.max(1, Math.ceil(ms / LEVEL_STEP_MS)) };
      current.parts.push(record);
      for (let elapsed = 0; elapsed < ms; elapsed += LEVEL_STEP_MS) {
        if (!current.ended && !current.hold && world.now() >= current.lastSpeechAt + silence) await close();
        const routed = !current.ended && hears();
        const level = routed ? speechLevel(elapsed, seed) : 0;
        if (routed) record.captured++;
        spoken.levels.push({ at: at(), level });
        emit("level", level);
        await world.delay(LEVEL_STEP_MS);
        if (routed) current.lastSpeechAt = world.now();
      }
      spoken.to = at();
      emit("level", 0);
      if (!current.ended) setState({ listening: "listening" });
    };
    current.talk = talk;
    const half = (part) => { const words = part.split(/\s+/); const at = Math.max(1, Math.ceil(words.length / 2)); return [words.slice(0, at).join(" "), words.slice(at).join(" ") || part]; };
    setState({ listening: "speaking" });
    emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "started", turn_id: turn, started_at: startedAt }));
    const utterance = async () => {
    if (pause || cutOff) {
      const [first, rest] = half(text);
      current.hold = cutOff;
      await talk(first, durationMs / 2);
      if (cutOff) {
        // The end of turn decided too soon: the turn goes to be recognised, and the person goes on.
        await world.delay(silence);
        mark.end_ms = at();
        setState({ recognising: 1 });
        await world.delay(400);
        const cut = turn;
        turn = `${callId}-turn-${++turns}`;
        mark = opened();
        emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "started", turn_id: turn, started_at: world.now() }));
        emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: cut, merged: true }));
        setState({ recognising: 0 });
        current.hold = false;
        current.lastSpeechAt = world.now();
      } else {
        const paused = at();
        await world.delay(Math.round(silence * 0.6));
        mark.pauses.push({ from_ms: paused, to_ms: at() });
      }
      await talk(rest, durationMs / 2);
    } else await talk(text, durationMs);
    };
    // The endpoint is the end of turn's wait after the last speech this call captured; speech routed back sooner
    // moves it. What the turn holds is what the call captured by then.
    const close = () => current.closing ??= (async () => {
    const endpoint = async () => { for (let left = current.lastSpeechAt + silence - world.now(); left > 0; left = current.lastSpeechAt + silence - world.now()) await world.delay(left); };
    await Promise.race([endpoint(), forced]);
    current.ended = true;
    const heardText = current.parts.map((part) => part.words.slice(0, Math.ceil(part.words.length * part.captured / part.steps)).join(" ")).filter(Boolean).join(" ");
    mark.end_ms = at();
    setState({ recognising: 1 });
    await world.delay(TRANSCRIBING_MS);
    setState({ recognising: 0 });
    if (voice.stt === "silence" || !heardText.trim()) {
      emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: turn, merged: false }));
      return;
    }
    if (voice.stt === "error") {
      emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: turn, merged: false }));
      emit("error", { code: "transcription-failed" });
      return;
    }
    const endedAt = world.now();
    emit("turn", /** @type {VoiceTurnEvent} */ ({
      phase: "finished", turn_id: turn, text: heardText, ...(settings?.input?.stt?.language ? { language: String(settings.input.stt.language) } : {}),
      started_at: startedAt, ended_at: endedAt, merged: cutOff,
      timings: { audio_ms: endedAt - startedAt, endpoint_silence_ms: silence, recognition_ms: 500 },
    }));
    })();
    await utterance();
    await close();
    return true;
  }
  // Listening begins once the models are loaded and the microphone is open, as a call's first state says.
  /** @type {{ ready: Promise<void> }} */ (host).ready = (async () => {
    await check(settings);
    // The models load, as a call's first start loads them.
    await world.delay(600);
    if (stopped) throw refusal("stopped");
    // Opening the microphone asks for it, as the platform does: a prompt where it was never answered (microphone.mjs).
    if (settings.input) {
      const asked = await askMicrophone(world);
      if (stopped) throw refusal("stopped");
      if (asked === "missing") throw refusal("microphone-unavailable");
      if (asked !== "granted") throw refusal("microphone-denied");
    }
    started = true;
    // The models a call or a try loads were just used: this device's transcriber and voice, and the voice detector.
    const voice = voiceState(world);
    const stt = settings.input?.stt;
    const tts = settings.output?.tts;
    const used = [stt?.catalog === LOCAL ? stt.model : null, tts?.catalog === LOCAL ? tts.model : null, "silero-vad"].filter(Boolean);
    world.patch({ "voice.lastUsed": { ...voice.lastUsed, ...Object.fromEntries(used.map((model) => [String(model), world.now()])) } });
    // Listening from now: sample 0 of a take, when one is asked for and the world's voice hands it.
    taking = options?.take && settings.input && voice.take !== false ? { startedAt: world.now(), speech: [], turns: [], muted: muted ? [{ from: 0, to: Infinity }] : [] } : null;
    setState({ listening: !settings.input ? "off" : muted ? "muted" : "listening" });
  })();
  // A call that failed to start is not left holding the microphone's route.
  host.ready.catch(() => { const at = group.calls.findIndex((item) => item.host === host); if (at >= 0) group.calls.splice(at, 1); if (group.active?.host === host) group.active = null; });

  const runtime = { host, speak, get state() { return { ...state, started }; } };
  const first = !group.calls.length;
  group.calls.push(runtime);
  if (first) group.active = runtime;
  // The preview's "Force a voice error" button: the active call's voice reports a failure, as a request that threw does.
  const failers = world.voiceFailers ??= new Set();
  const fail = () => { if (group.active?.host === host) emit("error", new TypeError("Failed to fetch")); };
  failers.add(fail);
  const stopFailing = () => failers.delete(fail);
  return runtime;
}

/** The headset-and-route owner of the calls: a `VoiceHost` whose `start` begins a call, and the preview's own handles
 *  on it (`speak` for the person, the devices, the state of the call the microphone routes to). */
export function fakeVoice(world) {
  /** @type {any} Mock-only routing group; each call still keeps independent turn and playback state. */
  const group = { calls: [], active: null, nextId: 0 };
  /** @type {Set<(devices: any) => void>} */
  const listeners = new Set();
  // The devices: the headset plugged in, nothing chosen (the system's defaults), the speaker choosable.
  const devices = { headset: true, input: /** @type {string | null} */ (null), output: /** @type {string | null} */ (null), outputSelectable: true };
  /** The headset (the card plugs it in and out): its microphone and its speaker, beside the computer's own. */
  function present() {
    const inputs = [{ id: "mic-builtin", label: "MacBook Pro Microphone" }, ...(devices.headset ? [{ id: "mic-headset", label: "AirPods Pro" }] : [])];
    const outputs = [{ id: "out-builtin", label: "MacBook Pro Speakers" }, ...(devices.headset ? [{ id: "out-headset", label: "AirPods Pro" }] : [])];
    return { inputs, outputs };
  }
  function deviceList(lost) {
    return { ...present(), input: devices.input, output: devices.output, outputSelectable: devices.outputSelectable, ...(lost ? { lost } : {}) };
  }
  const tell = (list) => { for (const listener of [...listeners]) listener(list); };
  /** Plugs the headset in or out: a chosen headset device that goes is lost, the default in use from then on. */
  function plugHeadset(plugged) {
    devices.headset = plugged;
    const lost = {};
    if (!plugged && devices.input === "mic-headset") { lost.input = devices.input; devices.input = null; }
    if (!plugged && devices.output === "out-headset") { lost.output = devices.output; devices.output = null; }
    tell(deviceList(Object.keys(lost).length ? lost : undefined));
  }
  /** Whether the speaker can be chosen (a browser without setSinkId cannot). */
  function outputSelectable(selectable) {
    devices.outputSelectable = selectable;
    if (!selectable) devices.output = null;
    tell(deviceList());
  }
  /** Settings with neither half do not make a call. */
  const checked = (settings) => {
    if (!settings || (!settings.input && !settings.output)) throw new TypeError("voice settings need an input or an output half");
  };

  /** @type {VoiceHost} */
  const host = {
    start(settings, options) {
      checked(settings);
      const call = fakeCall(world, group, settings, options);
      return call.host;
    },
    async preload(settings) {
      checked(settings);
    },
    async routeInput(target) {
      const call = target == null ? null : group.calls.find((item) => item.host === target);
      if (target != null && !call) throw refusal("unknown-voice-call");
      group.active = call;
      world.log({ method: "VOICE", url: `routeInput(${target?.id ?? "none"})`, status: "ok", mocked: true });
    },
    // The microphone and the speaker: what there is, which are chosen (null: the system's default), whether the speaker
    // can be chosen, and the list as it changes (the card plugs a headset in and out).
    audioDevices: async () => deviceList(),
    async setAudioDevices(choice) {
      if ("output" in choice && choice.output != null && !devices.outputSelectable) throw Object.assign(new Error("audio-output-unselectable"), { code: "audio-output-unselectable" });
      for (const kind of /** @type {const} */ (["input", "output"])) {
        if (!(kind in choice)) continue;
        const id = choice[kind] ?? null;
        const list = kind === "input" ? present().inputs : present().outputs;
        if (id !== null && !list.some((device) => device.id === id)) throw Object.assign(new Error(kind === "input" ? "microphone-unavailable" : "audio-output-failed"), { code: kind === "input" ? "microphone-unavailable" : "audio-output-failed" });
        devices[kind] = id;
      }
      world.log({ method: "VOICE", url: "setAudioDevices(" + JSON.stringify(choice) + ")", status: "ok", mocked: true });
      return deviceList();
    },
    onAudioDevices(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return { host, speak: (text, how) => group.active?.speak(text, how) ?? false, plugHeadset, outputSelectable, get devices() { return { ...devices }; },
    get state() { return group.active ? group.active.state : { listening: "idle", recognising: 0, playback: "idle", microphone: "live", started: false }; } };
}
