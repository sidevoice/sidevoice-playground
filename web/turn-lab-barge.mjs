// Interruption lab: tune what decides a turn and how speech cuts the agent's reply, and see each attempt as evidence.
//
// Every number is the web app's own `turn` setting (sidevoice-web services/voice-settings.js, TURN_TUNING), handed to
// @sidevoice/voice, and changed here live through the room's `sidevoiceActions.editVoice({ turn })`. Nothing is forked.

export const ATTEMPTS_KEPT = 20;
export const ONSET_LEVEL = 15;

/** The app's defaults today (web TURN_TUNING), and the bounds the voice accepts. */
export const DEFAULTS = {
  listening_bar: { quiet: 0.5, playing: 0.65 },
  barge_in_min_speech: 0.6, barge_in_window: 2.5, vad_confidence: 0.6, speech_start_ms: 400, pre_roll_ms: 1000, audio_grace_ms: 1000, fade_ms: 30,
};

export const PARAMS = [
  { key: "barge_in_min_speech", label: "Speech that cuts a reply", unit: "s", min: 0.1, max: 3, step: 0.05, hint: "seconds of speech over the playing bar before the reply is cut" },
  { key: "barge_in_window", label: "Window for that speech", unit: "x", min: 1, max: 10, step: 0.5, hint: "times as long; bursts with gaps add up inside it" },
  { key: "playing", bar: true, label: "Loudness bar while it plays", unit: "", min: 0.3, max: 0.95, step: 0.01, hint: "0 to 1, -110 to -10 LUFS; lower hears quieter speech (and the speaker)" },
  { key: "quiet", bar: true, label: "Loudness bar when silent", unit: "", min: 0.2, max: 0.95, step: 0.01, hint: "the same scale, while nothing plays" },
  { key: "vad_confidence", label: "Detector confidence", unit: "", min: 0.2, max: 0.95, step: 0.05, hint: "from which a window counts as speech" },
  { key: "speech_start_ms", label: "Speech to start a turn", unit: "ms", min: 0, max: 1500, step: 50, hint: "in silence, how long speech goes on before a turn opens" },
  { key: "pre_roll_ms", label: "Audio kept before a turn", unit: "ms", min: 0, max: 3000, step: 100, hint: "heard before speech was detected" },
  { key: "audio_grace_ms", label: "Wait before a reply", unit: "ms", min: 0, max: 5000, step: 100, hint: "after a turn ends" },
  { key: "fade_ms", label: "Fade when cut", unit: "ms", min: 0, max: 500, step: 5, hint: "the speaker's fade-out" },
];

const clone = (turn) => ({ ...turn, listening_bar: { ...turn.listening_bar } });
const valueOf = (turn, param) => param.bar ? turn.listening_bar[param.key] : turn[param.key];
const setValue = (turn, param, value) => { if (param.bar) turn.listening_bar[param.key] = value; else turn[param.key] = value; };

export const PRESETS = {
  A: { turn: clone(DEFAULTS), rationale: "Today: the app's own numbers." },
  B: { turn: { ...clone(DEFAULTS), listening_bar: { quiet: 0.45, playing: 0.55 }, barge_in_min_speech: 0.3, barge_in_window: 3, vad_confidence: 0.5, speech_start_ms: 300, audio_grace_ms: 600, fade_ms: 15 },
    rationale: "Eager: a lower bar and 0.3 s of speech cut the reply, the detector believes 0.5, it answers sooner; a cough or the speaker can cut it too." },
  C: { turn: { ...clone(DEFAULTS), listening_bar: { quiet: 0.5, playing: 0.75 }, barge_in_min_speech: 1.0, barge_in_window: 2, vad_confidence: 0.7, speech_start_ms: 500, audio_grace_ms: 1200, fade_ms: 60 },
    rationale: "Tolerant: a higher bar and 1.0 s of denser speech, so \"mm-hm\", a cough or a bump never cut; you have to mean it." },
};
export const turnsEqual = (a, b) => PARAMS.every((param) => valueOf(a, param) === valueOf(b, param));

// What the page cannot change: the browser's own capture processing. There is no backchannel concept in the library.
export const FIXED = [
  { name: "Echo / self-voice", value: "the browser's echoCancellation, noiseSuppression, autoGainControl", where: "voice js/web-audio-io.js, js/shared-web-audio-io.js (CAPTURE)" },
  { name: "Backchannel vs interruption", value: "no such concept: only the amount and loudness of speech decide", where: "voice src/turns.rs" },
];

const GAP_MS = 250;
const SETTLE_MS = 800;
const NO_AUDIO_MS = 15_000;
const TIMEOUT_MS = 150_000;

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Turns the room's signals (microphone level, call state, reply hearing) into one record per Play. */
export function createTracker({ onset = ONSET_LEVEL, emit }) {
  let counter = 0, current = null, listening = "idle";
  const threshold = { onset };

  const finish = (t, outcome, reason) => {
    const a = current; current = null;
    const rel = (value) => value == null || a.onset == null ? null : Math.round(value - a.onset);
    const record = {
      id: a.id, at: a.playAt, preset: a.preset, seconds: a.seconds, turn: a.turn, outcome, reason,
      onsetMs: a.onset == null ? null : Math.round(a.onset - a.agentStart),
      detectedMs: rel(a.detected), stoppedMs: rel(a.stopped),
      feltMs: a.stopped != null && a.onset != null ? Math.round(a.stopped - a.onset) : null,
      voiceMs: a.stopped != null && a.detected != null ? Math.round(a.stopped - a.detected) : null,
      longestSpeechMs: Math.round(a.longest), peakLevel: a.peak, hearing: a.hearing,
    };
    emit(record);
  };

  const conclude = (t) => {
    const a = current;
    const cut = a.stopped != null && (a.detected != null || a.hearing === "partial");
    if (cut && a.detected != null) {
      const real = a.onset != null && a.onset <= a.detected + 200;
      return finish(t, real ? "interrupted" : "false", real ? "" : "the voice heard speech, the microphone meter did not");
    }
    if (cut) return finish(t, "false", "the agent stopped with no speech heard");
    if (a.longest >= (a.seconds + 1) * 1000) return finish(t, "missed", `speech for ${(a.longest / 1000).toFixed(1)} s and the agent went on`);
    return finish(t, a.onset != null ? "ignored" : "through", a.onset != null ? "speech heard but the agent went on, as asked" : "");
  };

  return {
    threshold,
    get active() { return current; },
    play(preset, seconds, t, turn = null) {
      if (current) finish(t, "through", "replaced by a new Play");
      current = { id: ++counter, playAt: t, preset, seconds, turn, agentStart: null, onset: null, burstStart: null, lastVoiced: null,
        longest: 0, peak: 0, detected: null, stopped: null, hearing: null, settleAt: null };
    },
    mic(level, t) {
      const a = current;
      if (!a || a.agentStart == null || a.stopped != null) return;
      a.peak = Math.max(a.peak, Math.round(level));
      if (level < threshold.onset) return;
      if (a.lastVoiced == null || t - a.lastVoiced > GAP_MS) a.burstStart = t;
      a.lastVoiced = t;
      if (a.onset == null) a.onset = a.burstStart;
      a.longest = Math.max(a.longest, t - a.burstStart);
      if (a.detected == null && a.longest >= (a.seconds + 1) * 1000) conclude(t);
    },
    state({ listening: next, playback }, t) {
      const before = listening; listening = next;
      const a = current;
      if (!a) return;
      if (playback === "playing" && a.agentStart == null) a.agentStart = t;
      if (next === "speaking" && before !== "speaking" && a.agentStart != null && (a.stopped == null || t - a.stopped <= 400) && a.detected == null) a.detected = t;
      if (playback !== "playing" && a.agentStart != null && a.stopped == null) { a.stopped = t; a.settleAt = t + SETTLE_MS; }
    },
    hearing(outcome) { if (current) current.hearing = outcome; },
    tick(t) {
      const a = current;
      if (!a) return;
      if (a.settleAt != null && t >= a.settleAt) conclude(t);
      else if (a.agentStart == null && t - a.playAt > NO_AUDIO_MS) finish(t, "none", "the agent never started to speak");
      else if (a.agentStart != null && t - a.agentStart > TIMEOUT_MS) conclude(t);
    },
  };
}

/** Per-preset totals of the attempts kept, for comparing presets. */
export function summarise(attempts) {
  const rows = {};
  for (const a of attempts) {
    const row = rows[a.preset] ??= { n: 0, interrupted: 0, false: 0, missed: 0, felt: [] };
    row.n++;
    if (a.outcome === "interrupted") { row.interrupted++; if (a.feltMs != null) row.felt.push(a.feltMs); }
    if (a.outcome === "false") row.false++;
    if (a.outcome === "missed") row.missed++;
  }
  return Object.fromEntries(Object.entries(rows).map(([preset, row]) => [preset, { n: row.n, interrupted: row.interrupted, false: row.false, missed: row.missed, medianFeltMs: median(row.felt) }]));
}

const LABEL = { interrupted: "INTERRUPTED", false: "FALSE TRIGGER", missed: "MISSED", ignored: "IGNORED (backchannel)", through: "PLAYED THROUGH", none: "NO AUDIO" };
const CLASS = { interrupted: "pass", false: "fail", missed: "fail", ignored: "manual", through: "pending", none: "pending" };
export const describe = (a) => {
  const ms = (value) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value} ms`;
  return `#${a.id} ${a.preset} ${a.seconds.toFixed(1)} s · ${LABEL[a.outcome]}` +
    (a.outcome === "interrupted" || a.outcome === "false" ? ` · speech ${a.onsetMs == null ? "not seen" : "seen"} · voice heard ${ms(a.detectedMs)} · agent stopped ${ms(a.stoppedMs)}${a.feltMs == null ? "" : ` (${a.feltMs} ms after you started)`}` : "") +
    (a.peakLevel != null && a.outcome !== "interrupted" ? ` · mic peaked at ${a.peakLevel} while the agent spoke` : "") +
    (a.reason ? ` · ${a.reason}` : "");
};
export const outcomeClass = (outcome) => CLASS[outcome] ?? "pending";

// ---- the page ----------------------------------------------------------------------------------------------------

function mount(doc, win) {
  const $ = (id) => doc.getElementById(id);
  const KEY = "turn-lab.bargein.turn";
  const store = (() => { try { return win.localStorage; } catch { return null; } })();
  const saved = (() => { try { return JSON.parse(store?.getItem(KEY) ?? "null") ?? {}; } catch { return {}; } })();
  let attempts = Array.isArray(saved.attempts) ? saved.attempts.slice(-ATTEMPTS_KEPT) : [];
  let roomCustom = saved.roomCustom === true;
  let turn = saved.turn && PARAMS.every((param) => Number.isFinite(valueOf(saved.turn.listening_bar ? saved.turn : DEFAULTS, param))) ? clone(saved.turn) : clone(DEFAULTS);
  let joined = false, applied = null, micLevel = 0,  peak = 0, peakAt = 0, micStep = "waiting for the room", timer = null;
  const trace = [];
  const mark = (text) => { trace.push(`${new Date().toLocaleTimeString()} ${text}`); if (trace.length > 30) trace.shift(); };
  const presetName = () => Object.keys(PRESETS).find((key) => turnsEqual(PRESETS[key].turn, turn)) ?? "custom";
  const persist = () => { try { store?.setItem(KEY, JSON.stringify({ attempts, turn, roomCustom })); } catch { /* storage is optional */ } };
  const now = () => win.performance.timeOrigin + win.performance.now();

  const tracker = createTracker({ emit(record) {
    attempts = [...attempts, record].slice(-ATTEMPTS_KEPT); persist(); render();
  } });
  tracker.threshold.onset = Number(saved.onset) || ONSET_LEVEL;

  const room = () => $("room");
  const origin = () => { try { return new URL(room().src).origin; } catch { return null; } };
  const send = (message) => { const to = origin(); if (to && room().contentWindow) room().contentWindow.postMessage(message, to); };
  // The room is left alone while everything is the app's own: nothing is sent until a number differs, and once the room
  // has been given other numbers, the defaults are sent once to put it back (its device settings outlive a reload).
  const sendSetting = () => {
    if (!joined) return;
    const custom = !turnsEqual(turn, DEFAULTS);
    if (!custom && !roomCustom) { applied = true; render(); return; }
    roomCustom = custom; persist();
    send({ type: "turn-lab-barge", turn });
  };
  const changed = () => { persist(); render(); applied = null; win.clearTimeout(timer); timer = win.setTimeout(sendSetting, 150); };

  const rows = PARAMS.map((param) => {
    const label = doc.createElement("label"), name = doc.createElement("span"), input = doc.createElement("input"), out = doc.createElement("output"), def = doc.createElement("small");
    input.type = "range"; input.min = String(param.min); input.max = String(param.max); input.step = String(param.step); input.title = param.hint;
    name.textContent = param.label;
    input.oninput = () => { setValue(turn, param, Number(input.value)); changed(); };
    label.append(name, input, out, def);
    return { param, input, out, def, label };
  });
  $("barge-params").replaceChildren(...rows.map((row) => row.label));

  function render() {
    for (const { param, input, out, def } of rows) {
      const value = valueOf(turn, param), base = valueOf(DEFAULTS, param);
      input.value = String(value);
      out.textContent = `${value}${param.unit}`;
      def.textContent = value === base ? `default` : `default ${base}${param.unit}`;
    }
    const name = presetName();
    for (const key of Object.keys(PRESETS)) $(`barge-${key}`).classList.toggle("on", name === key);
    $("barge-rationale").textContent = PRESETS[name]?.rationale ?? "Custom values.";
    $("barge-applied").textContent = !joined ? "Waiting for the room to join; the settings are sent when it does." :
      applied === "error" ? "The room did not take the settings; see the room state below." : applied == null ? "Sending to the room…" : "Applied in the room.";
    $("barge-diag").textContent = `Microphone: ${micStep} · meter ${micLevel}, peak ${peak} in the last 10 s`;
    $("barge-trace").replaceChildren(...[...trace].reverse().map((text) => { const li = doc.createElement("li"); li.textContent = text; return li; }));
    $("barge-mic").textContent = `Microphone meter ${micLevel}; counts as speech from`;
    const live = tracker.active;
    $("barge-live").textContent = live ? (live.agentStart == null ? "Waiting for the agent to start speaking…" : live.stopped == null ? "Agent speaking: try to interrupt it." : "Agent stopped.") : "Press Play, then interrupt the agent.";
    $("barge-play").disabled = !joined;
    $("barge-skip").disabled = !joined;
    $("barge-attempts").replaceChildren(...[...attempts].reverse().map((a) => {
      const li = doc.createElement("li"); li.className = `check ${outcomeClass(a.outcome)}`; li.textContent = describe(a);
      if (a.outcome === "interrupted") {
        const flip = doc.createElement("button"); flip.textContent = "wasn't me"; flip.className = "link";
        flip.onclick = () => { a.outcome = "false"; a.reason = "marked: not the operator's voice"; persist(); render(); };
        li.append(" ", flip);
      }
      return li;
    }));
    $("barge-summary").replaceChildren(...Object.entries(summarise(attempts)).sort().map(([key, row]) => {
      const li = doc.createElement("li");
      li.textContent = `${key}: ${row.n} tries · ${row.interrupted} interrupted · ${row.false} false · ${row.missed} missed · median ${row.medianFeltMs ?? "—"} ms`;
      return li;
    }));
  }

  for (const key of Object.keys(PRESETS)) $(`barge-${key}`).onclick = () => { turn = clone(PRESETS[key].turn); changed(); };
  $("barge-reset").onclick = () => { turn = clone(DEFAULTS); changed(); };
  $("barge-onset").value = String(tracker.threshold.onset);
  $("barge-onset").onchange = () => { tracker.threshold.onset = Math.max(1, Number($("barge-onset").value) || ONSET_LEVEL); persist(); };
  $("barge-play").onclick = async () => {
    $("barge-live").textContent = "Asking the agent to speak…";
    try {
      const response = await win.fetch("/preview/turn-lab/play", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(await response.text());
      const reply = await response.json().catch(() => ({}));
      if (reply.status === "rejected") throw new Error(reply.instruction ?? reply.reason ?? "the reply was refused");
      tracker.play(presetName(), turn.barge_in_min_speech, now(), clone(turn));
    } catch (error) { $("barge-live").textContent = `Play failed: ${error.message}`; return; }
    render();
  };
  $("barge-skip").onclick = () => send({ type: "turn-lab-skip" });
  $("barge-clear").onclick = () => { attempts = []; persist(); render(); };
  $("barge-export").onclick = () => {
    const body = { at: new Date().toISOString(), defaults: DEFAULTS, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, p.turn])), current: turn,
      onsetLevel: tracker.threshold.onset, attempts, summary: summarise(attempts), fixedInLibrary: FIXED };
    const url = win.URL.createObjectURL(new win.Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const anchor = doc.createElement("a"); anchor.href = url; anchor.download = `turn-lab-bargein-${Date.now()}.json`; anchor.click();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
  };
  $("barge-fixed").replaceChildren(...FIXED.flatMap((row) => {
    const dt = doc.createElement("dt"), dd = doc.createElement("dd");
    dt.textContent = row.name; dd.textContent = `${row.value} · ${row.where}`;
    return [dt, dd];
  }));

  win.addEventListener("message", (event) => {
    if (event.source !== room().contentWindow || event.origin !== origin() || event.data?.source !== "turn-lab-browser") return;
    const { kind, data = {} } = event.data;
    const t = now();
    if (kind === "browser-ready") {
      if (data.tracks != null) { micStep = `allowed, ${data.tracks} track${data.tracks === 1 ? "" : "s"}`; mark(micStep.replace("allowed", "microphone allowed")); }
      if (data.voice) mark(`call ${data.voice}`);
      if (data.modelStep) mark(`setup step ${data.modelStep} ${data.state ?? "done"}`);
    }
    if (kind === "browser-error") { mark(`error ${Object.values(data).join(" ")}`); micStep = `error: ${Object.values(data).join(" ")}`; }
    if (kind === "room-frame" && ["voice-user-turn", "voice-input-receipt"].includes(data.type)) mark(`room: ${data.type} ${data.phase ?? data.status ?? ""}`.trim());
    if (kind === "browser-action" && data.type === "voice-user-turn") mark(`page: turn ${data.phase}`);
    if (kind === "browser-ready" && data.voice === "joined") { joined = true; applied = null; sendSetting(); render(); }
    else if (kind === "barge-mic") { micLevel = Math.round(data.level); if (data.t - peakAt > 10_000 || data.level >= peak) { peak = Math.round(data.level); peakAt = data.t; } tracker.mic(data.level, data.t ?? t); $("barge-mic").textContent = `Microphone meter ${micLevel}; counts as speech from`; }
    else if (kind === "barge-state") { tracker.state(data, data.t ?? t); mark(`listening ${data.listening ?? "?"}, playback ${data.playback ?? "?"}, mic ${data.mic ?? "?"}${data.phase ? `, ${data.phase}` : ""}, room turn ${data.turn ?? "?"}${data.working ? ", agent working" : ""}${data.rec ? `, transcribing ${data.rec}` : ""}${data.error ? `, ERROR ${data.error}` : ""}`); render(); }
    else if (kind === "barge-jserror") mark(`room ${data.what}: ${data.text}`);
    else if (kind === "barge-applied") { applied = true; mark(`room kept ${JSON.stringify(data.turn)}`); render(); }
    else if (kind === "barge-error") { applied = "error"; mark(`settings not taken: ${data.message}`); render(); }
    else if (kind === "browser-action" && data.type === "reply-hearing") tracker.hearing(data.outcome);
  });
  win.setInterval(() => { tracker.tick(now()); }, 250);
  render();
}

if (typeof document !== "undefined" && document.getElementById("barge-play")) mount(document, window);
