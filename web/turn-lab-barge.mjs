// Interruption lab: tune how much speech cuts the agent's reply, and see each attempt as evidence.
//
// What can be set from here: the voice module's `barge_in_min_speech` (seconds of continuous speech above the playing
// bar before sounding audio is cut), through the pinned web room's own `sidevoiceActions.editVoice`. Everything else
// that decides an interruption is fixed inside the library (FIXED below); nothing here forks or patches it.

export const APP_DEFAULT_SECONDS = 1.0;
export const ATTEMPTS_KEPT = 20;
export const ONSET_LEVEL = 15;

export const PRESETS = {
  A: { seconds: 1.0, rationale: "Today: the app sets nothing, so the voice module's own 1.0 s applies." },
  B: { seconds: 0.4, rationale: "Eager: 0.4 s of continuous speech cuts the reply, about one short word (the same length speech needs to start in silence)." },
  C: { seconds: 1.6, rationale: "Tolerant: 1.6 s, so \"mm-hm\", \"yes\", a cough or a bump never cut; only a deliberate sentence does." },
};

// Pinned voice 73fb627 (v0.5.0), the build the Turn Lab runs. Not settable from the page: the voice's JS host
// forwards only `barge_in_min_speech` (js/voice-host.js:144), and the web room never sets even that.
export const FIXED = [
  { name: "Loudness bar while the agent plays", value: "0.8 (-30 LUFS); 0.5 when silent", where: "src/config.rs:149-155 (ListeningBar), applied src/turns.rs:191-199" },
  { name: "Detector confidence for speech", value: "0.6", where: "src/turns.rs:38" },
  { name: "Speech must be continuous", value: "a quiet gap restarts the count", where: "src/turns.rs:202-207" },
  { name: "Grace after a turn before the agent speaks", value: "1000 ms", where: "src/config.rs:158-160, src/call.rs:690" },
  { name: "Fade-out when it stops", value: "30 ms", where: "js/web-audio-io.js:21, js/shared-web-audio-io.js:4" },
  { name: "Echo / self-voice", value: "the browser's echoCancellation, noiseSuppression, autoGainControl", where: "js/web-audio-io.js:26-30, src/echo/web.rs:1-3" },
  { name: "Backchannel vs interruption", value: "no such concept: only length and loudness decide", where: "src/turns.rs:197-215" },
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
      id: a.id, at: a.playAt, preset: a.preset, seconds: a.seconds, outcome, reason,
      onsetMs: a.onset == null ? null : Math.round(a.onset - a.agentStart),
      detectedMs: rel(a.detected), stoppedMs: rel(a.stopped),
      feltMs: a.stopped != null && a.onset != null ? Math.round(a.stopped - a.onset) : null,
      voiceMs: a.stopped != null && a.detected != null ? Math.round(a.stopped - a.detected) : null,
      longestSpeechMs: Math.round(a.longest), hearing: a.hearing,
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
    play(preset, seconds, t) {
      if (current) finish(t, "through", "replaced by a new Play");
      current = { id: ++counter, playAt: t, preset, seconds, agentStart: null, onset: null, burstStart: null, lastVoiced: null,
        longest: 0, detected: null, stopped: null, hearing: null, settleAt: null };
    },
    mic(level, t) {
      const a = current;
      if (!a || a.agentStart == null || a.stopped != null) return;
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
    (a.reason ? ` · ${a.reason}` : "");
};
export const outcomeClass = (outcome) => CLASS[outcome] ?? "pending";

// ---- the page ----------------------------------------------------------------------------------------------------

function mount(doc, win) {
  const $ = (id) => doc.getElementById(id);
  const KEY = "turn-lab.bargein";
  const store = (() => { try { return win.localStorage; } catch { return null; } })();
  const saved = (() => { try { return JSON.parse(store?.getItem(KEY) ?? "null") ?? {}; } catch { return {}; } })();
  let attempts = Array.isArray(saved.attempts) ? saved.attempts.slice(-ATTEMPTS_KEPT) : [];
  let preset = saved.preset in PRESETS || saved.preset === "custom" ? saved.preset : "A";
  let seconds = Number.isFinite(saved.seconds) ? saved.seconds : PRESETS.A.seconds;
  let override = saved.override !== false; // false: the app's own default, nothing sent
  let joined = false, applied = null, micLevel = 0, audioStates = [];
  const persist = () => { try { store?.setItem(KEY, JSON.stringify({ attempts, preset, seconds, override })); } catch { /* storage is optional */ } };
  const now = () => win.performance.timeOrigin + win.performance.now();

  const tracker = createTracker({ emit(record) {
    attempts = [...attempts, record].slice(-ATTEMPTS_KEPT); persist(); render();
  } });
  tracker.threshold.onset = Number(saved.onset) || ONSET_LEVEL;

  const room = () => $("room");
  const origin = () => { try { return new URL(room().src).origin; } catch { return null; } };
  const send = (message) => { const to = origin(); if (to && room().contentWindow) room().contentWindow.postMessage(message, to); };
  const sendSetting = () => { if (joined) send({ type: "turn-lab-barge", seconds: override ? seconds : null }); };

  const shown = () => override ? `${seconds.toFixed(1)} s` : `${APP_DEFAULT_SECONDS.toFixed(1)} s (app default)`;
  function render() {
    $("barge-seconds").value = String(seconds);
    $("barge-seconds-out").textContent = shown();
    for (const key of Object.keys(PRESETS)) $(`barge-${key}`).classList.toggle("on", preset === key && override);
    $("barge-reset").classList.toggle("on", !override);
    $("barge-rationale").textContent = override ? (PRESETS[preset]?.rationale ?? "Custom value.") : "No override: the app sets nothing, the voice module's own 1.0 s applies.";
    $("barge-applied").textContent = !joined ? "Waiting for the room to join; the setting is sent when it does." :
      applied === "error" ? "The room did not take the setting; see the event log." : applied == null ? "Sending to the room…" : `Applied in the room: ${applied}.`;
    $("barge-mic").textContent = `Microphone meter ${micLevel}; counts as speech from`;
    const live = tracker.active;
    $("barge-live").textContent = live ? (live.agentStart == null ? "Waiting for the agent to start speaking…" : live.stopped == null ? "Agent speaking: try to interrupt it." : "Agent stopped.") : "Press Play, then interrupt the agent.";
    const stuck = audioStates.find((state) => state !== "running");
    $("barge-audio").textContent = stuck ? `The room's audio is ${stuck}, so it cannot hear you. Click once anywhere inside the room.` : "";
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
    const totals = summarise(attempts);
    $("barge-summary").replaceChildren(...Object.entries(totals).sort().map(([key, row]) => {
      const li = doc.createElement("li");
      li.textContent = `${key}: ${row.n} tries · ${row.interrupted} interrupted · ${row.false} false · ${row.missed} missed · median ${row.medianFeltMs ?? "—"} ms`;
      return li;
    }));
  }

  function choose(key) { preset = key; seconds = PRESETS[key].seconds; override = true; persist(); render(); sendSetting(); }
  for (const key of Object.keys(PRESETS)) $(`barge-${key}`).onclick = () => choose(key);
  $("barge-reset").onclick = () => { preset = "A"; seconds = APP_DEFAULT_SECONDS; override = false; applied = null; persist(); render(); sendSetting(); };
  $("barge-seconds").oninput = () => {
    seconds = Number($("barge-seconds").value); override = true;
    preset = Object.entries(PRESETS).find(([, p]) => p.seconds === seconds)?.[0] ?? "custom";
    persist(); render(); sendSetting();
  };
  $("barge-onset").value = String(tracker.threshold.onset);
  $("barge-onset").onchange = () => { tracker.threshold.onset = Math.max(1, Number($("barge-onset").value) || ONSET_LEVEL); persist(); };
  $("barge-play").onclick = async () => {
    $("barge-live").textContent = "Asking the agent to speak…";
    try {
      const response = await win.fetch("/preview/turn-lab/play", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(await response.text());
      const reply = await response.json().catch(() => ({}));
      if (reply.status === "rejected") throw new Error(reply.instruction ?? reply.reason ?? "the reply was refused");
      tracker.play(override ? preset : "A", override ? seconds : APP_DEFAULT_SECONDS, now());
    } catch (error) { $("barge-live").textContent = `Play failed: ${error.message}`; return; }
    render();
  };
  $("barge-skip").onclick = () => send({ type: "turn-lab-skip" });
  $("barge-clear").onclick = () => { attempts = []; persist(); render(); };
  $("barge-export").onclick = () => {
    const body = { at: new Date().toISOString(), setting: "barge_in_min_speech (seconds)", appDefault: APP_DEFAULT_SECONDS, presets: PRESETS,
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
    if (kind === "browser-ready" && data.voice === "joined") { joined = true; applied = null; sendSetting(); render(); }
    else if (kind === "barge-mic") { micLevel = Math.round(data.level); tracker.mic(data.level, data.t ?? t); $("barge-mic").textContent = `Microphone meter ${micLevel}; counts as speech from`; }
    else if (kind === "barge-state") { tracker.state(data, data.t ?? t); render(); }
    else if (kind === "barge-audio") { audioStates = data.states ?? []; render(); }
    else if (kind === "barge-applied") { applied = data.seconds == null ? "app default (1.0 s)" : `${Number(data.seconds).toFixed(1)} s`; render(); }
    else if (kind === "barge-error") { applied = "error"; render(); }
    else if (kind === "browser-action" && data.type === "reply-hearing") tracker.hearing(data.outcome);
  });
  win.setInterval(() => { tracker.tick(now()); }, 250);
  render();
}

if (typeof document !== "undefined" && document.getElementById("barge-play")) mount(document, window);
