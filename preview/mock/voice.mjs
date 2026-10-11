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
  const listeners = { turn: new Set(), state: new Set(), level: new Set(), error: new Set(), devices: new Set() };
  // The devices: the headset plugged in, nothing chosen (the system's defaults), the speaker choosable.
  const devices = { headset: true, input: /** @type {string | null} */ (null), output: /** @type {string | null} */ (null), outputSelectable: true };
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
      // The models a call loads were just used: this device's transcriber and voice, and the voice detector.
      const used = [settings.stt?.catalog === LOCAL ? settings.stt.model : null, settings.tts?.catalog === LOCAL ? settings.tts.model : null, "silero-vad"].filter(Boolean);
      world.patch({ "voice.lastUsed": { ...voice.lastUsed, ...Object.fromEntries(used.map((model) => [String(model), Date.now()])) } });
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
    // The microphone and the speaker (@sidevoice/voice 0.3.0): what there is, which are chosen (null: the system's
    // default), whether the speaker can be chosen, and the list as it changes (the card plugs a headset in and out).
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
    onAudioDevices: on("devices"),
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

  /** The headset (the card plugs it in and out): its microphone and its speaker, beside the computer's own. */
  function present() {
    const inputs = [{ id: "mic-builtin", label: "MacBook Pro Microphone" }, ...(devices.headset ? [{ id: "mic-headset", label: "AirPods Pro" }] : [])];
    const outputs = [{ id: "out-builtin", label: "MacBook Pro Speakers" }, ...(devices.headset ? [{ id: "out-headset", label: "AirPods Pro" }] : [])];
    return { inputs, outputs };
  }
  function deviceList(lost) {
    return { ...present(), input: devices.input, output: devices.output, outputSelectable: devices.outputSelectable, ...(lost ? { lost } : {}) };
  }
  /** Plugs the headset in or out: a chosen headset device that goes is lost, the default in use from then on. */
  function plugHeadset(plugged) {
    devices.headset = plugged;
    const lost = {};
    if (!plugged && devices.input === "mic-headset") { lost.input = devices.input; devices.input = null; }
    if (!plugged && devices.output === "out-headset") { lost.output = devices.output; devices.output = null; }
    emit("devices", deviceList(Object.keys(lost).length ? lost : undefined));
  }
  /** Whether the speaker can be chosen (a browser without setSinkId cannot). */
  function outputSelectable(selectable) {
    devices.outputSelectable = selectable;
    if (!selectable) devices.output = null;
    emit("devices", deviceList());
  }

  return { host, speak, plugHeadset, outputSelectable, get devices() { return { ...devices }; }, get state() { return { ...state, started }; } };
}
