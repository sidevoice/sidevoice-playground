// The mocked preview's voice: a `VoiceHost` (@sidevoice/voice's seam, js/voice-host.d.ts) that hears no microphone
// and plays no sound. What the person says comes from the card (`speak`): the call tells it as a turn, with the
// levels and states a real one goes through; what the page asks it to say is "heard" at a reading pace, chunk by
// chunk. The world's `voice` says what fails: the microphone (denied, missing), transcription, speech.
//
// In the browser the page's own model source (`source`, its voice-source.ts over the mocked engine) is asked for the
// settings' models before the call starts, so its refusals (a model it does not know, a key missing) are the page's
// own. In the desktop app there is no source: the app's voice checks the choices itself, as here.
//
// A try's take (sidevoice-web contract gap #40, pending in @sidevoice/voice; the web's apps/web/src/services/voice-take.ts):
// started with `{take: true}`, the voice keeps what its microphone "gave" from the moment it listens until it stops, and
// hands it to `onTake` before `stop()` resolves. With no microphone, it is made up from what the voice told: a low
// hiss throughout, a voiced tone at the levels it told while the person spoke, the pauses silent, and the marks of the
// turns it told, where it told them. The world's `voice.take` false hands none, as @sidevoice/voice 0.3.x does.
// @ts-check

import { LOCAL, voiceState } from "./models.mjs";

/** @typedef {import("./web-types").VoiceHost} VoiceHost */
/** @typedef {import("./web-types").VoiceSettings} VoiceSettings */
/** @typedef {import("./web-types").VoiceTurnEvent} VoiceTurnEvent */
/** @typedef {import("./web-types").VoiceCallState} VoiceCallState */
/** @typedef {import("./web-types").VoiceSayEvent} VoiceSayEvent */
/** @typedef {import("./web-types").VoiceSayOutcome} VoiceSayOutcome */
/** @typedef {import("./web-types").VoiceSaying} VoiceSaying */
/** @typedef {import("./web-types").VoiceTake} VoiceTake */
/** @typedef {import("./web-types").TakingVoiceHost} TakingVoiceHost */

const refusal = (code) => Object.assign(new Error(code), { code });

/** The call's own rate: a take is 16 kHz mono. */
const TAKE_RATE = 16000;

/**
 * What the microphone "gave" while a take was kept, from `taking` (when it started, what the person said in it, the
 * marks of their turns) until `endedAt`, in the world's ms: a low hiss throughout; where the person spoke, a voice's
 * pitch and two harmonics, as loud as the levels the voice told (the 60 dB window the web reads levels on), from one
 * level to the next; the pauses, the hiss alone.
 * @param {{ startedAt: number, speech: { from: number, to: number, levels: { at: number, level: number }[] }[], turns: VoiceTake["turns"] }} taking
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
  return { sampleRate: TAKE_RATE, samples, started_at: taking.startedAt, ended_at: endedAt, turns: taking.turns };
}

/** The voice host of `world`; `source` is the page's model source (browser), or none (the desktop app's). */
/** How long a silence ends a turn, as the settings say: the voice detector's wait alone (Silence), or shorter where
 *  the end-of-turn model decides (Smart); longer the calmer the patience. */
const ENDPOINT_MS = { silence: { fast: 2000, normal: 2500, calm: 3500 }, "smart-turn": { fast: 600, normal: 900, calm: 1300 } };
function endpointMs(settings) {
  const mode = ENDPOINT_MS[/** @type {keyof typeof ENDPOINT_MS} */ (settings?.end_of_turn ?? "smart-turn")] ?? ENDPOINT_MS["smart-turn"];
  return mode[/** @type {keyof typeof mode} */ (settings?.patience ?? "normal")] ?? mode.normal;
}

export function fakeVoice(world, { source = null } = {}) {
  /** @type {Record<string, Set<Function>>} */
  const listeners = { turn: new Set(), state: new Set(), level: new Set(), error: new Set(), devices: new Set(), take: new Set() };
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
  /** The take being kept, while one was asked for: when it started, what the person said in it, their turns' marks.
   *  @type {{ startedAt: number, speech: { from: number, to: number, levels: { at: number, level: number }[] }[], turns: VoiceTake["turns"] } | null} */
  let taking = null;
  /** @type {VoiceCallState} */
  let state = { listening: "idle", recognising: 0, playback: "idle", microphone: /** @type {"live" | "muted"} */ ("live") };
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

  /** @type {TakingVoiceHost} */
  const host = {
    async setSettings(next) {
      settings = next;
    },
    /** @param {{ take?: boolean }} [options] With `take`, a take is kept from the moment it listens (web gap #40). */
    async start(options) {
      if (!settings) throw refusal("settings-missing");
      await check(settings);
      const voice = voiceState(world);
      // The models load, as a call's first start loads them.
      await world.delay(600);
      if (voice.mic === "denied") throw refusal("microphone-denied");
      if (voice.mic === "missing") throw refusal("microphone-unavailable");
      started = true;
      // The models a call or a try loads were just used: this device's transcriber and voice, and the voice detector.
      const used = [settings.stt?.catalog === LOCAL ? settings.stt.model : null, settings.tts?.catalog === LOCAL ? settings.tts.model : null, "silero-vad"].filter(Boolean);
      world.patch({ "voice.lastUsed": { ...voice.lastUsed, ...Object.fromEntries(used.map((model) => [String(model), world.now()])) } });
      // Listening from now: sample 0 of a take, when one is asked for and the world's voice hands it.
      taking = options?.take && voice.take !== false ? { startedAt: world.now(), speech: [], turns: [] } : null;
      setState({ listening: muted ? "muted" : "listening" });
    },
    async stop() {
      if (!started) return;
      started = false;
      const kept = taking;
      taking = null;
      if (kept) emit("take", synthesisedTake(kept, world.now()));
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
    onTake: on("take"),
  };

  /**
   * The person says `text` (the card's "speak"): a turn, with its levels, ended once the silence after it is as long
   * as the settings' end of turn waits (`endpointMs`), recognised and told; or, as the world says, nothing heard, or a
   * transcription that fails. `pause`: a pause in the middle, shorter than the end of turn waits — still the turn.
   * `cutOff`: the turn is ended after its first half, and the person goes on — a new turn, the cut one merged into
   * it. Whether the call heard it: it hears only while it listens.
   * @param {string} text @param {{ pause?: boolean, cutOff?: boolean }} [how]
   */
  async function speak(text, { pause = false, cutOff = false } = {}) {
    if (!started || muted) return false;
    const voice = voiceState(world);
    let turn = `turn-${++turns}`;
    const startedAt = world.now();
    const silence = endpointMs(settings);
    // The take this is said into, if one is kept: where in it each moment falls, and the turn's marks.
    const take = taking;
    const at = () => (take ? world.now() - take.startedAt : 0);
    const opened = () => {
      const mark = { turn_id: turn, speech_ms: at(), pauses: /** @type {{ from_ms: number, to_ms: number }[]} */ ([]), end_ms: /** @type {number | null} */ (null) };
      take?.turns.push(mark);
      return mark;
    };
    let mark = opened();
    const talk = async (part) => {
      setState({ listening: "speaking" });
      const spoken = { from: at(), to: at(), levels: /** @type {{ at: number, level: number }[]} */ ([]) };
      take?.speech.push(spoken);
      const words = Math.max(3, part.split(/\s+/).length);
      for (let i = 0; i < words * 3; i++) {
        const level = 0.25 + 0.6 * Math.abs(Math.sin(i * 1.7));
        spoken.levels.push({ at: at(), level });
        emit("level", level);
        await world.delay(110);
      }
      spoken.to = at();
      emit("level", 0);
      setState({ listening: "listening" });
    };
    const half = (part) => { const words = part.split(/\s+/); const at = Math.max(1, Math.ceil(words.length / 2)); return [words.slice(0, at).join(" "), words.slice(at).join(" ") || part]; };
    setState({ listening: "speaking" });
    emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "started", turn_id: turn, started_at: startedAt }));
    if (pause || cutOff) {
      const [first, rest] = half(text);
      await talk(first);
      if (cutOff) {
        // The end of turn decided too soon: the turn goes to be recognised, and the person goes on.
        await world.delay(silence);
        mark.end_ms = at();
        setState({ recognising: 1 });
        await world.delay(400);
        const cut = turn;
        turn = `turn-${++turns}`;
        mark = opened();
        emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "started", turn_id: turn, started_at: world.now() }));
        emit("turn", /** @type {VoiceTurnEvent} */ ({ phase: "cancelled", turn_id: cut, merged: true }));
        setState({ recognising: 0 });
      } else {
        const paused = at();
        await world.delay(Math.round(silence * 0.6));
        mark.pauses.push({ from_ms: paused, to_ms: at() });
      }
      await talk(rest);
    } else await talk(text);
    await world.delay(silence);
    mark.end_ms = at();
    setState({ recognising: 1 });
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
      started_at: startedAt, ended_at: endedAt, merged: cutOff,
      timings: { audio_ms: endedAt - startedAt, endpoint_silence_ms: silence, recognition_ms: 500 },
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
  /** Plugs the headset in or out: a chosen headset device that goes is lost, the default in use from then on. With
   *  nothing chosen, the headset was the system's default: while the voice runs, its output going is said
   *  (`defaultLost`, which @sidevoice/voice does not have yet), and its microphone going ends the call
   *  (`microphone-lost`), as the default microphone going away does. */
  function plugHeadset(plugged) {
    const unplugged = devices.headset && !plugged;
    const defaults = { input: unplugged && started && devices.input === null, output: unplugged && started && devices.output === null };
    devices.headset = plugged;
    const lost = {};
    if (!plugged && devices.input === "mic-headset") { lost.input = devices.input; devices.input = null; }
    if (!plugged && devices.output === "out-headset") { lost.output = devices.output; devices.output = null; }
    emit("devices", { ...deviceList(Object.keys(lost).length ? lost : undefined), ...(defaults.output ? { defaultLost: { output: true } } : {}) });
    if (defaults.input) fail("microphone-lost");
  }
  /** The page's leave to use the microphone taken back while the voice runs: the call ends. */
  function revokeMicrophone() {
    if (started) fail("microphone-denied");
  }
  /** The call ends for a reason of the microphone's (`code`), said to the page. */
  function fail(code) {
    started = false;
    setState({ listening: "idle", recognising: 0, playback: "idle" });
    emit("error", { code });
  }
  /** Whether the speaker can be chosen (a browser without setSinkId cannot). */
  function outputSelectable(selectable) {
    devices.outputSelectable = selectable;
    if (!selectable) devices.output = null;
    emit("devices", deviceList());
  }

  return { host, speak, plugHeadset, revokeMicrophone, outputSelectable, get devices() { return { ...devices }; }, get state() { return { ...state, started }; } };
}
