// The mocked preview's voice: a `VoiceHost` (@sidevoice/voice's seam, js/voice-host.d.ts) that hears no microphone
// and plays no sound. What the person says comes from the card (`speak`): the call tells it as a turn, with the
// levels and states a real one goes through; what the page asks it to say is "heard" at a reading pace, chunk by
// chunk. The world's `voice` says what fails: the microphone (denied, missing), transcription, speech.
//
// In the browser the page's own model source (`source`, its voice-source.ts over the mocked engine) is asked for the
// settings' models before the call starts, so its refusals (a model it does not know, a key missing) are the page's
// own. In the desktop app there is no source: the app's voice checks the choices itself, as here.
// @ts-check

import { LOCAL, voiceState } from "./models.mjs";

/** @typedef {import("./web-types").VoiceHost} VoiceHost */
/** @typedef {import("./web-types").VoiceSettings} VoiceSettings */
/** @typedef {import("./web-types").VoiceTurnEvent} VoiceTurnEvent */
/** @typedef {import("./web-types").VoiceCallState} VoiceCallState */
/** @typedef {import("./web-types").VoiceSayEvent} VoiceSayEvent */
/** @typedef {import("./web-types").VoiceSayOutcome} VoiceSayOutcome */
/** @typedef {import("./web-types").VoiceSaying} VoiceSaying */

const refusal = (code) => Object.assign(new Error(code), { code });

/** The voice host of `world`; `source` is the page's model source (browser), or none (the desktop app's). */
export function fakeVoice(world, { source = null } = {}) {
  /** @type {Record<string, Set<Function>>} */
  const listeners = { turn: new Set(), state: new Set(), level: new Set(), error: new Set() };
  const emit = (kind, value) => {
    for (const listener of [...listeners[kind]]) listener(value);
  };
  const on = (kind) => (listener) => {
    listeners[kind].add(listener);
    return () => listeners[kind].delete(listener);
  };
  /** @type {VoiceSettings | null} */
  let settings = null;
  let started = false;
  let muted = false;
  let turns = 0;
  let says = 0;
  /** @type {VoiceCallState} */
  let state = { listening: "idle", recognising: 0, playback: "idle" };
  const setState = (patch) => {
    state = { ...state, ...patch };
    emit("state", state);
    world.changed();
  };

  /** The models the settings name: the page's source in the browser; in the app, the app's own check. */
  async function check(next) {
    if (source) {
      await source.models(next);
      return;
    }
    const keys = voiceState(world).keys;
    for (const slot of [next.stt, next.tts]) {
      if (slot?.catalog && slot.catalog !== LOCAL && !keys[String(slot.catalog)]) throw refusal("credential-missing");
    }
  }

  /** @type {VoiceHost} */
  const host = {
    async setSettings(next) {
      settings = next;
    },
    async start() {
      if (!settings) throw refusal("settings-missing");
      await check(settings);
      const voice = voiceState(world);
      // The models load, as a call's first start loads them.
      await world.delay(600);
      if (voice.mic === "denied") throw refusal("microphone-denied");
      if (voice.mic === "missing") throw refusal("microphone-unavailable");
      started = true;
      setState({ listening: muted ? "muted" : "listening" });
    },
    async stop() {
      if (!started) return;
      started = false;
      setState({ listening: "idle", recognising: 0, playback: "idle" });
    },
    say(text, options) {
      const id = `say-${++says}`;
      /** @type {Set<(event: VoiceSayEvent) => void>} */
      const events = new Set();
      let cancelled = false;
      const tell = (event) => {
        for (const listener of [...events]) listener(event);
      };
      const outcome = (async () => {
        await Promise.resolve();
        if (!started) return /** @type {VoiceSayOutcome} */ ({ status: "not-played", reason: "stopped" });
        setState({ playback: "synthesizing" });
        await world.delay(400);
        if (voiceState(world).tts === "error") {
          setState({ playback: "idle" });
          emit("error", { code: "speech-failed" });
          return /** @type {VoiceSayOutcome} */ ({ status: "not-played", reason: "failed", code: "speech-failed" });
        }
        setState({ playback: "playing" });
        tell({ type: "playing" });
        // Sentence by sentence, at a reading pace.
        const chunks = text.match(/[^.!?¿¡]+[.!?]*\s*/g) ?? [text];
        let from = 0;
        for (const chunk of chunks) {
          if (cancelled || !started) {
            setState({ playback: "idle" });
            return /** @type {VoiceSayOutcome} */ ({ status: "heard-up-to", heard_chars: from, reason: cancelled ? "cancelled" : "stopped" });
          }
          tell({ type: "progress", sounding: [from, from + chunk.length], heard_chars: from });
          await world.delay(Math.max(400, chunk.length * 55));
          from += chunk.length;
        }
        tell({ type: "progress", sounding: null, heard_chars: from });
        setState({ playback: "idle" });
        return /** @type {VoiceSayOutcome} */ ({ status: "heard" });
      })();
      outcome.then((ended) => tell({ type: "done", outcome: ended }));
      /** @type {VoiceSaying} */
      const saying = {
        id,
        cancel: () => {
          cancelled = true;
        },
        onEvent: (listener) => {
          events.add(listener);
        },
        outcome,
      };
      void options;
      return saying;
    },
    mute(next) {
      muted = next;
      if (started) setState({ listening: next ? "muted" : "listening" });
    },
    cancelInput() {},
    onTurn: on("turn"),
    onState: on("state"),
    onLevel: on("level"),
    onError: on("error"),
  };

  /**
   * The person says `text` (the card's "speak"): a turn, with its levels, recognised and told; or, as the world says,
   * nothing heard, or a transcription that fails. Whether the call heard it: it hears only while it listens.
   */
  async function speak(text) {
    if (!started || muted) return false;
    const voice = voiceState(world);
    const turn = `turn-${++turns}`;
    const startedAt = world.now();
    setState({ listening: "speaking" });
    emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "started", turn_id: turn, started_at: startedAt }));
    const words = Math.max(3, text.split(/\s+/).length);
    for (let i = 0; i < words * 3; i++) {
      emit("level", 0.25 + 0.6 * Math.abs(Math.sin(i * 1.7)));
      await world.delay(110);
    }
    emit("level", 0);
    setState({ listening: "listening", recognising: 1 });
    await world.delay(500);
    setState({ recognising: 0 });
    if (voice.stt === "silence" || !text.trim()) {
      emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: turn, merged: false }));
      return true;
    }
    if (voice.stt === "error") {
      emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: turn, merged: false }));
      emit("error", { code: "transcription-failed" });
      return true;
    }
    const endedAt = world.now();
    emit("turn", /** @type {VoiceTurnEvent} */ ({
      phase: "finished", turn_id: turn, text, ...(settings?.stt?.language ? { language: String(settings.stt.language) } : {}),
      started_at: startedAt, ended_at: endedAt, merged: false,
      timings: { audio_ms: endedAt - startedAt, endpoint_silence_ms: 600, recognition_ms: 500 },
    }));
    return true;
  }

  return { host, speak, get state() { return { ...state, started }; } };
}
