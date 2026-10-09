// The Turn detection screen of the Engine section: the voice module's chain, step by step, on the active engine. The
// microphone feeds the engine's voice activity detector as a stream (`asVad().stream(options)`); its frames draw the
// speech probability where the backend gives one, and its events mark where speech starts and ends. At each end of
// speech the chain (turns/chain.mjs) decides as a call would: with `smart-turn`, the end-of-turn model
// (`asEndOfTurn().probability`) is asked about the turn so far and its P(end) cuts the turn or keeps listening; with
// `silence`, the patience's timer runs. An engine without a model of either capability says so, and a runtime whose
// loaded models have no VAD stream (the native runner) says that too.

import { describeError, progressText } from "./catalog.mjs";
import { createResampler, createTurnChain, END_OF_TURN_LIKELY, turnModelChoices, VAD_DEFAULTS } from "./turns/chain.mjs";
import { logLine } from "./turns-text.mjs";

const $ = (selector) => document.querySelector(selector);
const SHOWN_MS = 10000; // how much of the past the graph shows
const KEPT_MS = 30000; // how much audio is kept for the end-of-turn model, which hears only its last seconds anyway

/** The microphone as mono chunks at the audio context's rate. */
async function openMicrophone(onChunk) {
  const media = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(media);
  // A ScriptProcessor, deprecated but in every engine the playground runs on, keeps this file free of a worklet module.
  const node = context.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (event) => onChunk(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(context.destination); // it writes nothing: the output stays silent
  return {
    rate: context.sampleRate,
    close() {
      node.disconnect();
      source.disconnect();
      media.getTracks().forEach((track) => track.stop());
      context.close();
    },
  };
}

/**
 * Sets the screen up. `currentEngine()` is the Engine section's active entry (`{ engine, catalog }`) or null.
 * @returns {{ render: () => void, stop: () => void }} `render` when the screen is shown or the engine changes
 */
export function turnsScreen({ currentEngine }) {
  let entry = null; // the engine entry the screen holds models of
  const slots = { vad: null, "end-of-turn": null }; // per capability: { id, loaded, handle }
  let run = null; // the running chain: microphone, stream, clock, frames, audio
  const chain = createTurnChain({});

  const status = (selector, text, error = false) => {
    const line = $(selector);
    line.textContent = text;
    line.classList.toggle("error", error);
  };
  const vadOptions = () => ({
    threshold: Number($("#turns-threshold").value),
    minSilenceMs: Number($("#turns-min-silence").value),
    minSpeechMs: Number($("#turns-min-speech").value),
  });
  const chainSettings = () => ({
    mode: $("#turns-smart").checked ? "smart-turn" : "silence",
    patience: $("#turns-patience").value,
    threshold: Number($("#turns-eot-threshold").value),
  });

  function log(entries) {
    const list = $("#turns-log");
    for (const item of entries) list.prepend(Object.assign(document.createElement("li"), { textContent: logLine(item), className: item.kind }));
    while (list.children.length > 200) list.lastChild.remove();
    for (const item of entries) if (item.kind === "ask") askModel(item);
  }

  function free(capability) {
    const slot = slots[capability];
    slot?.handle?.free?.();
    slot?.loaded?.free?.();
    slots[capability] = null;
  }

  /** Loads the picked model of `capability`, unless it is the one loaded already; null when nothing usable is picked. */
  async function ensure(capability) {
    const select = $(capability === "vad" ? "#turns-vad" : "#turns-eot");
    const choice = turnModelChoices(entry.catalog, capability).find((c) => c.id === select.value);
    if (!choice || choice.disabled) return null;
    if (slots[capability]?.id === choice.id) return slots[capability].handle;
    free(capability);
    const line = "#turns-models";
    status(line, `Loading ${choice.build}…`);
    const loaded = await entry.engine.load(choice.id, choice.build, (progress) => status(line, progressText(progress)));
    const handle = capability === "vad" ? loaded.asVad?.() : loaded.asEndOfTurn?.();
    if (!handle) {
      loaded.free?.();
      throw new Error(
        typeof loaded.asVad !== "function"
          ? "This runtime's loaded models have no voice-activity stream or end-of-turn call (the native runner): load the engine's web build."
          : `${choice.id} is not a ${capability} model here.`,
      );
    }
    slots[capability] = { id: choice.id, loaded, handle };
    status(line, `Ready: ${choice.build}.`);
    return handle;
  }

  function renderPickers() {
    const catalog = entry?.catalog ?? [];
    for (const [capability, selector, none] of [
      ["vad", "#turns-vad", "This engine has no voice-activity model"],
      ["end-of-turn", "#turns-eot", "This engine has no end-of-turn model: load sidevoice-engine main (8aa89d1, #78) or later"],
    ]) {
      const select = $(selector);
      const chosen = select.value;
      const choices = turnModelChoices(catalog, capability);
      select.replaceChildren(
        ...(choices.length
          ? choices.map((c) => Object.assign(new Option(c.label, c.id), { disabled: c.disabled }))
          : [new Option(none, "")]),
      );
      select.disabled = !choices.length;
      if (choices.some((c) => c.id === chosen)) select.value = chosen;
    }
    const smart = turnModelChoices(catalog, "end-of-turn").some((c) => !c.disabled);
    $("#turns-smart").disabled = !smart;
    if (!smart) $("#turns-smart").checked = false;
    $("#turns-eot-threshold").disabled = !smart;
    $("#turns-start").disabled = Boolean(run) || !turnModelChoices(catalog, "vad").some((c) => !c.disabled);
    $("#turns-stop").disabled = !run;
    chain.configure(chainSettings());
  }

  async function start() {
    if (run) return;
    $("#turns-start").disabled = true;
    try {
      const vad = await ensure("vad");
      if (!vad) throw new Error("Pick a voice-activity model that runs here.");
      if ($("#turns-smart").checked && !(await ensure("end-of-turn"))) throw new Error("Pick an end-of-turn model, or turn smart-turn off.");
      const stream = await vad.stream(vadOptions());
      const state = { stream, rate: stream.sampleRate, fed: 0, offset: 0, frames: [], audio: [], queue: Promise.resolve(), mic: null };
      run = state;
      chain.configure(chainSettings());
      state.mic = await openMicrophone((chunk) => {
        state.queue = state.queue.then(() => feed(state, chunk)).catch((error) => fail(error));
      });
      state.resample = createResampler(state.mic.rate, state.rate);
      log([{ kind: "note", at: 0, message: `listening: the microphone at ${state.mic.rate} Hz into ${slots.vad.id} at ${state.rate} Hz` }]);
      status("#turns-status", "Listening. Speak, pause, speak again.");
      draw();
    } catch (error) {
      console.error(error);
      stop();
      status("#turns-status", describeError(error), true);
    }
    renderPickers();
  }

  function fail(error) {
    console.error(error);
    status("#turns-status", describeError(error), true);
    stop();
  }

  const ms = (state, samples) => (samples / state.rate) * 1000;

  async function feed(state, chunk) {
    if (run !== state) return;
    const samples = state.resample(chunk);
    const { frames, events } = await state.stream.accept(samples);
    if (run !== state) return;
    const startMs = ms(state, state.fed);
    state.fed += samples.length;
    state.audio.push({ at: startMs, samples });
    while (state.audio.length && ms(state, state.fed) - state.audio[0].at > KEPT_MS) state.audio.shift();
    for (const frame of frames) state.frames.push({ at: ms(state, state.offset + frame.end), probability: frame.probability, speech: frame.speech });
    while (state.frames.length && ms(state, state.fed) - state.frames[0].at > SHOWN_MS) state.frames.shift();
    for (const event of events) {
      if (event.type === "speech-start") log(chain.speechStart(ms(state, state.offset + event.at)));
      else log(chain.speechEnd(ms(state, state.offset + event.end)));
    }
    log(chain.tick(ms(state, state.fed)));
  }

  /** The turn's audio from `from` ms to now, as the end-of-turn model hears it. */
  function audioSince(state, from) {
    const parts = state.audio.filter((part) => part.at + ms(state, part.samples.length) > from);
    const out = new Float32Array(parts.reduce((total, part) => total + part.samples.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part.samples, at);
      at += part.samples.length;
    }
    const skip = parts.length ? Math.max(0, Math.round(((from - parts[0].at) / 1000) * state.rate)) : 0;
    return out.subarray(skip);
  }

  async function askModel(asked) {
    const state = run;
    const model = slots["end-of-turn"]?.handle;
    if (!state || !model) return log([{ kind: "error", at: asked.at, message: "no end-of-turn model loaded" }]);
    const started = performance.now();
    try {
      const probability = await model.probability(audioSince(state, asked.from), state.rate);
      if (run !== state) return;
      const took = performance.now() - started;
      log([{ kind: "note", at: ms(state, state.fed), message: `the model answered in ${took.toFixed(0)} ms (it hears the last ${model.seconds} s)` }]);
      log(chain.answer(ms(state, state.fed), probability, asked.turn));
    } catch (error) {
      log([{ kind: "error", at: asked.at, message: describeError(error) }]);
    }
  }

  function stop() {
    const state = run;
    run = null;
    state?.mic?.close();
    state?.stream?.free?.();
    if (state) status("#turns-status", "Stopped.");
    renderPickers();
  }

  /** The graph: the detector's probability (or its speech flag) over the last seconds, its threshold, the timer. */
  function draw() {
    const state = run;
    const canvas = $("#turns-graph");
    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    if (state) {
      const now = ms(state, state.fed);
      const x = (at) => width - ((now - at) / SHOWN_MS) * width;
      context.fillStyle = "rgba(120, 200, 160, 0.18)";
      for (const frame of state.frames) if (frame.speech) context.fillRect(x(frame.at) - 2, 0, 4, height);
      const threshold = Number($("#turns-threshold").value);
      context.strokeStyle = "rgba(255, 255, 255, 0.35)";
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(0, height * (1 - threshold));
      context.lineTo(width, height * (1 - threshold));
      context.stroke();
      context.setLineDash([]);
      const measured = state.frames.filter((frame) => frame.probability != null);
      if (measured.length) {
        context.strokeStyle = "#8ecbff";
        context.beginPath();
        measured.forEach((frame, index) => {
          const y = height * (1 - frame.probability);
          if (index) context.lineTo(x(frame.at), y);
          else context.moveTo(x(frame.at), y);
        });
        context.stroke();
      }
      $("#turns-graph-note").textContent = measured.length || !state.frames.length
        ? "Speech probability per window, the detector's threshold dashed, speech shaded."
        : "This backend gives no probability: speech shaded where the detector says so.";
      const next = chain.next(now);
      $("#turns-timer").textContent = next
        ? next.what === "ask"
          ? `Asks the end-of-turn model in ${(Math.max(0, next.in) / 1000).toFixed(1)} s unless speech resumes.`
          : `Cuts the turn in ${(Math.max(0, next.in) / 1000).toFixed(1)} s unless speech resumes.`
        : chain.turn ? "Speaking." : "No turn open.";
      requestAnimationFrame(draw);
    } else {
      $("#turns-timer").textContent = "";
    }
  }

  // Detector options take effect on a new stream: while listening, the stream starts over from here.
  async function restartStream() {
    const state = run;
    if (!state) return;
    const stream = await slots.vad.handle.stream(vadOptions());
    if (run !== state) return stream.free?.();
    state.queue = state.queue.then(() => {
      state.stream.free?.();
      state.stream = stream;
      state.offset = state.fed;
      log([{ kind: "note", at: ms(state, state.fed), message: `detector options now ${JSON.stringify(vadOptions())}` }]);
    });
  }

  $("#turns-start").onclick = start;
  $("#turns-stop").onclick = stop;
  for (const id of ["#turns-threshold", "#turns-min-silence", "#turns-min-speech"]) {
    $(id).onchange = () => restartStream().catch(fail);
  }
  $("#turns-threshold").oninput = () => ($("#turns-threshold-value").value = Number($("#turns-threshold").value).toFixed(2));
  $("#turns-eot-threshold").oninput = () => {
    $("#turns-eot-threshold-value").value = Number($("#turns-eot-threshold").value).toFixed(2);
    chain.configure(chainSettings());
  };
  $("#turns-patience").onchange = () => chain.configure(chainSettings());
  $("#turns-smart").onchange = async () => {
    chain.configure(chainSettings());
    if ($("#turns-smart").checked && run) {
      try {
        if (!(await ensure("end-of-turn"))) throw new Error("Pick an end-of-turn model.");
      } catch (error) {
        $("#turns-smart").checked = false;
        chain.configure(chainSettings());
        status("#turns-models", describeError(error), true);
      }
    }
  };
  $("#turns-vad").onchange = () => {
    if (run) stop();
    free("vad");
  };
  $("#turns-eot").onchange = () => free("end-of-turn");
  $("#turns-threshold").value = VAD_DEFAULTS.threshold;
  $("#turns-min-silence").value = VAD_DEFAULTS.minSilenceMs;
  $("#turns-min-speech").value = VAD_DEFAULTS.minSpeechMs;
  $("#turns-eot-threshold").value = END_OF_TURN_LIKELY;
  $("#turns-threshold").oninput();
  $("#turns-eot-threshold-value").value = END_OF_TURN_LIKELY.toFixed(2);

  return {
    render() {
      const current = currentEngine();
      if (current !== entry) {
        stop();
        free("vad");
        free("end-of-turn");
        entry = current;
        status("#turns-models", "");
        status("#turns-status", "");
      }
      renderPickers();
    },
    stop,
  };
}
