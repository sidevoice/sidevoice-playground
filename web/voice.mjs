// The Voice section: a call on `@sidevoice/voice` (`VoiceCall.create`) with the engine the Engine section has
// active, this browser's microphone and speaker, and this page standing in for the room. It loads a CI build of the
// voice module through the server (/voice-builds, /voice-build), offers the active engine's models for each stage,
// shows what the call reports (its state, the microphone's level, its turns, where the reader of a reply is) and sends
// it replies to speak.

import { loadServedEngine } from "./engine/load.mjs";
import { karaoke, modelsFor, reply, turnLine, voiceChoices, voiceConfig, voicesOf } from "./voice/call.mjs";

const $ = (selector) => document.querySelector(selector);

/**
 * Sets the section up. `currentEngine()` is the Engine section's active entry (`{ loaded, engine, catalog }`) or
 * null; `servedBuild(path)` fetches what the server describes at `path` and adds its import map; `inApp` is whether
 * the page runs in the macOS app, which has no server to fetch a voice build through.
 * @returns {{ show: () => void }} what the page calls each time the section is shown
 */
export function voiceSection({ currentEngine, servedBuild, inApp }) {
  let module = null; // the loaded voice build's module
  let call = null;
  let engineLabel = null; // the engine the call runs on
  let listed = false;
  let replies = 0;
  let lastRevision = 0;
  let lastLanguage = null;
  const spoken = new Map(); // utterance_id → its text

  const status = (selector, text, error = false) => {
    const line = $(selector);
    line.textContent = text;
    line.classList.toggle("error", error);
  };

  async function list() {
    const select = $("#voice-build");
    select.replaceChildren(new Option("Listing…", ""));
    try {
      const res = await fetch("/voice-builds");
      if (!res.ok) throw new Error(await res.text());
      const choices = voiceChoices(await res.json());
      select.replaceChildren(
        ...(choices.length
          ? choices.map((choice) => Object.assign(new Option(choice.label, choice.value), { disabled: !choice.usable, title: choice.detail }))
          : [new Option("No open pull requests or branches", "")]),
      );
      const detail = () => {
        $("#voice-build-detail").textContent = choices.find((choice) => choice.value === select.value)?.detail ?? "";
      };
      select.onchange = detail;
      detail();
      listed = true;
    } catch (error) {
      select.replaceChildren(new Option("Could not list", ""));
      status("#voice-status", `Could not list the voice module's builds: ${error.message}`, true);
    }
  }

  async function loadBuild(ref) {
    if (!ref) return;
    status("#voice-status", `Fetching the voice CI's build of ${ref} (the first time, the server downloads and installs it)…`);
    try {
      const info = await servedBuild(`/voice-build?ref=${encodeURIComponent(ref)}`);
      stopCall();
      ({ module } = await loadServedEngine(info));
      status("#voice-status", `Loaded ${info.label}.`);
      renderConfig();
    } catch (error) {
      console.error(error);
      status("#voice-status", String(error?.message ?? error), true);
    }
  }

  function fill(selector, options, empty) {
    const select = $(selector);
    const chosen = select.value;
    select.replaceChildren(...(options.length ? options.map((o) => new Option(o.label, o.value)) : [new Option(empty, "")]));
    if (options.some((o) => o.value === chosen)) select.value = chosen;
    select.disabled = !options.length;
  }

  /** The stages' choices from the active engine's catalogue. */
  function renderConfig() {
    const current = currentEngine();
    $("#voice-config").hidden = !module;
    if (!module) return;
    if (!current) {
      status("#voice-call-status", "Load an engine under Engine first: the call runs on its models.", true);
      $("#voice-start").disabled = true;
      return;
    }
    const { catalog } = current;
    fill("#voice-vad", modelsFor(catalog, "vad"), "The engine has no voice activity model");
    fill("#voice-stt", modelsFor(catalog, "stt"), "The engine has no speech to text model");
    fill("#voice-tts", modelsFor(catalog, "tts"), "The engine has no text to speech model");
    renderVoices();
    $("#voice-end").querySelector('[value="smart-turn"]').disabled = !modelsFor(catalog, "end-of-turn").length;
    $("#voice-start").disabled = Boolean(call);
    if (!call) status("#voice-call-status", `On ${current.loaded.label}.`);
  }

  function renderVoices() {
    const voices = voicesOf(currentEngine()?.catalog, $("#voice-tts").value);
    fill("#voice-voice", [{ value: "", label: "the model's default" }, ...voices], "");
  }

  function config() {
    return voiceConfig({
      vad: $("#voice-vad").value,
      stt: $("#voice-stt").value,
      language: $("#voice-language").value,
      tts: $("#voice-tts").value,
      voice: $("#voice-voice").value,
      endOfTurn: $("#voice-end").value,
      patience: $("#voice-patience").value,
    });
  }

  function start() {
    const current = currentEngine();
    try {
      call = module.VoiceCall.create(current.engine, config(), { echoCancellation: $("#voice-aec").checked });
    } catch (error) {
      call = null;
      return status("#voice-call-status", String(error?.message ?? error), true);
    }
    engineLabel = current.loaded.label;
    call.onEvent(receive);
    call.setOnline(true);
    call.start();
    $("#voice-live").hidden = false;
    $("#voice-turns").replaceChildren();
    $("#voice-karaoke").replaceChildren();
    setRunning(true);
    status("#voice-call-status", `Calling on ${engineLabel}: speak.`);
  }

  function stopCall() {
    if (!call) return;
    call.stop();
    call.free?.();
    call = null;
    setRunning(false);
    $("#voice-level").value = 0;
    status("#voice-call-status", "Stopped.");
  }

  function setRunning(running) {
    $("#voice-start").disabled = running;
    $("#voice-stop").disabled = !running;
    $("#voice-mute").disabled = !running;
    $("#voice-reply").disabled = !running;
    $("#voice-aec").disabled = running;
    $("#voice-mute").textContent = "Mute";
    $("#voice-mute").setAttribute("aria-pressed", "false");
  }

  /** One event of the call, `{type, data}`. */
  function receive({ type, data }) {
    if (type === "level") $("#voice-level").value = data;
    else if (type === "state") {
      const { listening, recognising, playback, online } = data;
      $("#voice-state").textContent =
        `Microphone: ${listening} · recognising: ${recognising} · speaker: ${playback}${online ? "" : " · offline"}`;
    } else if (type === "karaoke") showKaraoke(data);
    else if (type === "error") log(`error: ${data.code}`, true);
    else if (type === "room-message") roomMessage(data);
  }

  /** What the call sends the room: its turns, which this page logs and may answer, and how replies played. */
  function roomMessage({ type, data }) {
    if (type === "voice-user-turn") {
      log(turnLine(data));
      if (data.phase !== "finished") return;
      lastRevision = data.revision;
      lastLanguage = data.language ?? null;
      if ($("#voice-echo").checked && data.text) send(`You said: ${data.text}`);
    } else if (type === "voice-playback") {
      log(`reply ${data.utterance_id} ${data.status}, ${data.heard_chars} characters heard${data.reason ? ` (${data.reason})` : ""}`);
    }
  }

  function send(text) {
    if (!call || !text.trim()) return;
    const message = reply(text, { number: ++replies, revision: lastRevision, language: lastLanguage });
    spoken.set(message.data.utterance_id, text);
    call.roomEvent(message);
  }

  function showKaraoke(data) {
    const text = spoken.get(data.utterance_id) ?? "";
    const parts = karaoke(text, data);
    $("#voice-karaoke").replaceChildren(
      ...Object.entries(parts).map(([part, words]) => Object.assign(document.createElement("span"), { className: part, textContent: words })),
    );
  }

  function log(text, error = false) {
    const item = Object.assign(document.createElement("li"), { textContent: `${new Date().toLocaleTimeString()} ${text}` });
    item.classList.toggle("error", error);
    $("#voice-turns").prepend(item);
  }

  $("#voice-build-form").addEventListener("submit", (event) => {
    event.preventDefault();
    loadBuild($("#voice-build").value);
  });
  $("#voice-tts").addEventListener("change", renderVoices);
  $("#voice-start").addEventListener("click", start);
  $("#voice-stop").addEventListener("click", stopCall);
  $("#voice-mute").addEventListener("click", (event) => {
    const muted = event.currentTarget.getAttribute("aria-pressed") !== "true";
    call?.mute(muted);
    event.currentTarget.setAttribute("aria-pressed", String(muted));
    event.currentTarget.textContent = muted ? "Unmute" : "Mute";
  });
  $("#voice-reply").addEventListener("click", () => send($("#voice-reply-text").value));
  for (const selector of ["#voice-vad", "#voice-stt", "#voice-language", "#voice-tts", "#voice-voice", "#voice-end", "#voice-patience"]) {
    $(selector).addEventListener("change", () => {
      if (!call) return;
      try {
        call.setConfig(config());
      } catch (error) {
        status("#voice-call-status", String(error?.message ?? error), true);
      }
    });
  }

  return {
    show() {
      if (inApp) {
        $("#voice-build-form").hidden = true;
        status("#voice-status", "The voice module's builds are CI artifacts the web playground's server fetches: use the web playground for this section.");
        return;
      }
      if (!listed) list();
      if (call && currentEngine()?.loaded.label !== engineLabel) stopCall();
      renderConfig();
    },
  };
}
