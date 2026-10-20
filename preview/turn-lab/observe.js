// Loaded after the real web's target.js. Observe the room and relay Lab-only output test controls.
(() => {
  // Start the first browser visit at the remote machine and model steps. The web still
  // performs its own pairing, model installation and voice call; no transcripts are injected.
  try {
    if (!localStorage.getItem("sidevoice.onboarding")) localStorage.setItem("sidevoice.onboarding", JSON.stringify({
      version: 1, basics_done: true, choice: "remote", agents_done: true, turn_done: false,
      deferred_at: null, completed_at: null, trials: {}, chosen: {}, baseline_release: 0, features: {},
    }));
  } catch {}
  const turnTargets = new Map();
  const report = (kind, data) => {
    try {
      const turnKey = data?.turn_id ? `${data.session_id ?? ""}:${data.turn_id}` : null;
      if (turnKey && data.type === "voice-user-turn" && data.phase === "started" && data.thread_id)
        turnTargets.set(turnKey, { thread_id: data.thread_id, binding_id: data.binding_id });
      if (turnTargets.size > 512) turnTargets.delete(turnTargets.keys().next().value);
      const target = turnKey ? turnTargets.get(turnKey) : null;
      const thread = data?.type === "history" ? data.row?.thread_id ?? data.row?.thread : data?.thread_id ?? target?.thread_id ?? wantedThread;
      const observed = (kind === "room-frame" || kind === "browser-action") ?
        { ...data, binding_id: data?.binding_id ?? target?.binding_id, conversation: thread, observed_at: Date.now() } : data;
      parent.postMessage({ source: "turn-lab-browser", kind, data: observed }, "*");
    } catch {}
  };
  // Every Turn Lab run has a fresh core identity. Keep downloaded browser models,
  // but discard the previous room's pairing before the web app starts.
  let paired = false;
  let wantedThread = null;
  try { localStorage.removeItem("sidevoice.pairings"); localStorage.removeItem("sidevoice.local-host-selected"); } catch {}
  report("browser-ready", { path: location.pathname, microphone: Boolean(navigator.mediaDevices?.getUserMedia), paired });
  const readyAction = async () => {
    for (let i = 0; i < 100 && !window.sidevoiceActions?.pairDevice; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!window.sidevoiceActions?.pairDevice) throw new Error("Web pairing action did not load");
    return window.sidevoiceActions;
  };
  window.addEventListener("message", async (event) => {
    if (event.source !== parent || event.origin !== new URL(document.referrer).origin) return;
    if (event.data?.type === "turn-lab-thread" && typeof event.data.thread === "string") {
      if (wantedThread !== event.data.thread) report("browser-ready", { thread: event.data.thread, state: "requested" });
      wantedThread = event.data.thread;
      return;
    }
    if (event.data?.type === "turn-lab-skip") { try { (await readyAction()).skipReply?.(); } catch {} return; }
    if (event.data?.type === "turn-lab-barge") {
      // The interruption lab: the web's own `turn` settings (when a turn starts, what cuts a reply, how it fades).
      const turn = event.data.turn, bar = turn?.listening_bar;
      const numbers = [bar?.quiet, bar?.playing, ...["barge_in_min_speech", "barge_in_window", "vad_confidence", "speech_start_ms", "pre_roll_ms", "audio_grace_ms", "fade_ms"].map((key) => turn?.[key])];
      if (!numbers.every(Number.isFinite)) return;
      try {
        const actions = await readyAction();
        if (typeof actions.editVoice !== "function") throw new Error("Web voice settings action did not load");
        actions.editVoice({ turn });
        await new Promise((resolve) => setTimeout(resolve, 800));
        const facts = window.sidevoiceUI?.store?.facts;
        if (facts?.settingsError) throw new Error(String(facts.settingsError?.message ?? facts.settingsError));
        const kept = facts?.voiceSettings?.turn;
        if (JSON.stringify(kept) !== JSON.stringify({ ...turn, listening_bar: { ...bar } })) throw new Error(`the room kept ${JSON.stringify(kept)}`);
        report("barge-applied", { turn: kept });
      } catch (error) { report("barge-error", { message: String(error?.message ?? error) }); }
      return;
    }
    if (event.data?.type === "turn-lab-output") {
      if (!["on", "agents_muted", "voice_off"].includes(event.data.output)) return;
      try {
        const actions = await readyAction();
        if (typeof actions.setSpeechOutput !== "function") throw new Error("Web output action did not load");
        actions.setSpeechOutput(event.data.output);
        report("browser-ready", { output: event.data.output });
      } catch (error) { report("browser-error", { output: String(error?.message ?? error) }); }
      return;
    }
    if (event.data?.type !== "turn-lab-pair") return;
    try {
      const actions = await readyAction();
      const result = await actions.pairDevice(event.data.code, "Turn Lab browser", location.origin);
      paired = true;
      report("browser-ready", { paired: true, host: result?.host });
    } catch (error) { report("browser-error", { pairing: String(error?.message ?? error) }); }
  });
  // Errors the room hits (a voice host failing silently shows up here), for the Lab's room state log.
  let jsErrors = 0;
  const reportError = (what, text) => { if (jsErrors++ < 40) report("barge-jserror", { what, text: String(text).slice(0, 200), t: bargeStamp() }); };
  window.addEventListener("error", (event) => reportError("error", event.message));
  window.addEventListener("unhandledrejection", (event) => reportError("rejection", event.reason?.message ?? event.reason));
  const nativeError = console.error.bind(console);
  console.error = (...args) => { reportError("console.error", args.map(String).join(" ")); nativeError(...args); };
  // The interruption lab's signals: the microphone level, and whether the person speaks and the agent plays.
  let bargeWired = false;
  const bargeStamp = () => performance.timeOrigin + performance.now();
  const wireBarge = () => {
    const ui = window.sidevoiceUI;
    if (bargeWired || !ui?.store?.subscribe || !ui.micLevel?.subscribe) return;
    bargeWired = true;
    ui.micLevel.subscribe((level) => report("barge-mic", { level, t: bargeStamp() }));
    let last = "";
    const state = () => {
      const facts = ui.store.facts, voice = facts.voiceState;
      const mic = facts.micEnabled === false ? "off" : "on", phase = facts.pendingPhase || "";
      // What the room itself believes: a turn it keeps open, an agent it calls working, the voice's pending transcriptions.
      const turn = facts.userTurn ? "open" : "none", working = Object.values(facts.harness || {}).some(Boolean) ? "working" : "";
      const rec = voice?.recognising ?? 0, error = String(ui.store.getState?.().bootError ?? "").slice(0, 120);
      const key = `${voice?.listening}|${voice?.playback}|${mic}|${phase}|${turn}|${working}|${rec}|${error}`;
      if (key === last) return;
      last = key;
      report("barge-state", { listening: voice?.listening, playback: voice?.playback, mic, phase, turn, working, rec, error, t: bargeStamp() });
    };
    ui.store.subscribe(state);
    state();
  };
  const clicked = new Set();
  setInterval(() => {
    wireBarge();
    const wizard = document.getElementById("wizard");
    const step = wizard?.getAttribute("data-step");
    if (wizard?.open && step) {
      const downloadId = step === "W4" ? "stt-model-download" : step === "W4v" ? "tts-model-download" : step === "W5" ? "turn-model-download" : null;
      const download = downloadId && document.getElementById(downloadId);
      if (download && !clicked.has(downloadId)) { clicked.add(downloadId); download.click(); report("browser-ready", { model: downloadId, state: "downloading" }); }
      // The permissions step (W4m) has its own Continue; it is enabled once the microphone is allowed.
      // Asks for the microphone once; the browser's own prompt (or the permission already given) answers.
      const ask = document.getElementById("wizard-mic-action");
      if (step === "W4m" && ask && !ask.disabled && !clicked.has("W4m:ask")) { clicked.add("W4m:ask"); ask.click(); report("browser-ready", { modelStep: "W4m", state: "asking" }); }
      const mic = document.getElementById("wizard-mic-continue");
      if (step === "W4m" && mic && !mic.disabled && mic.getAttribute("aria-disabled") !== "true" && !clicked.has("W4m:continue")) {
        clicked.add("W4m:continue"); mic.click(); report("browser-ready", { modelStep: "W4m", state: "ready" });
      }
      const next = document.getElementById("wizard-stage-action");
      if (next && !next.disabled && !clicked.has(`${step}:continue`)) { clicked.add(`${step}:continue`); next.click(); report("browser-ready", { modelStep: step, state: "ready" }); }
      if (step === "W6" && !clicked.has("enter")) { clicked.add("enter"); wizard.querySelector(".wizard-enter")?.click(); }
    } else if (paired && wantedThread) {
      const participant = window.sidevoiceUI?.store?.getState?.().participants?.find((row) => row.threadId?.endsWith(`|${wantedThread}`));
      if (!participant) return;
      if (!clicked.has(`selecting:${wantedThread}`)) {
        clicked.add(`selecting:${wantedThread}`);
        window.sidevoiceActions?.selectParticipant?.(participant.threadId);
        report("browser-ready", { thread: wantedThread, state: "selecting" });
        return;
      }
      // The room marks a participant selected only after the call binds to it.
      // The selection action sets the next join target while still out of a call.
      if (participant.selected && !clicked.has(`selected:${wantedThread}`)) { clicked.add(`selected:${wantedThread}`); report("browser-ready", { thread: wantedThread, selected: true }); }
      const join = document.getElementById("connect");
      if (join && !join.classList.contains("joined") && !clicked.has("join") && !join.disabled) {
        clicked.add("join"); join.click(); report("browser-ready", { voice: "starting" });
      }
      if (participant.selected && join?.classList.contains("joined") && !clicked.has(`joined:${wantedThread}`)) {
        clicked.add(`joined:${wantedThread}`);
        setTimeout(() => report("browser-ready", { voice: "joined", thread: wantedThread }), 1500);
      }
    }
  }, 500);
  const safe = (value) => {
    if (typeof value !== "string") return null;
    try {
      const wire = value.startsWith("42") ? JSON.parse(value.slice(2)) : JSON.parse(value);
      const parsed = Array.isArray(wire) ? { type: wire[0], data: wire[1] } : wire;
      const data = parsed.data ?? parsed;
      return { type: parsed.type ?? parsed.event ?? data.type, event: parsed.event, epoch: data.epoch, utterance_id: data.utterance_id, utterance_ids: data.utterance_ids, history_id: data.history_id, heard_chars: data.heard_chars, outcome: data.outcome, client_msg_id: data.client_msg_id, key: data.key, hearing: data.hearing, hearing_unconfirmed: data.hearing_unconfirmed, status: data.status, fate: data.fate, reason: data.reason, cut: data.cut, globally_heard: data.globally_heard, working: data.working, on: data.on, text: data.text,
        phase: data.phase, turn_id: data.turn_id, thread_id: data.thread_id, binding_id: data.binding_id, session_id: data.session_id, revision: data.revision, message_id: data.message_id, seq: data.seq,
        data: { epoch: data.epoch, utterance_id: data.utterance_id, utterance_ids: data.utterance_ids, history_id: data.history_id, heard_chars: data.heard_chars, outcome: data.outcome, client_msg_id: data.client_msg_id, key: data.key, hearing: data.hearing, hearing_unconfirmed: data.hearing_unconfirmed, status: data.status, fate: data.fate, reason: data.reason, cut: data.cut, working: data.working, on: data.on, phase: data.phase, turn_id: data.turn_id, thread_id: data.thread_id, binding_id: data.binding_id, session_id: data.session_id, revision: data.revision, message_id: data.message_id, seq: data.seq } };
    } catch { return null; }
  };
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = new Proxy(NativeWebSocket, { construct(Target, args) {
    const socket = new Target(...args);
    socket.addEventListener("message", (event) => { const frame = safe(event.data); if (frame?.type) report("room-frame", frame); });
    const send = socket.send.bind(socket);
    socket.send = (value) => { const frame = safe(value); if (frame?.type) report("browser-action", frame); return send(value); };
    return socket;
  } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const path = new URL(typeof args[0] === "string" ? args[0] : args[0].url, location.href).pathname;
      if (path === "/api/presentation/text") {
        const receipt = response.ok ? await response.clone().json().catch(() => ({})) : {};
        report("browser-action", { type: "typed-message", status: response.status, epoch: receipt.epoch });
      }
      if (path === "/api/presentation/select") {
        const selected = JSON.parse(args[1]?.body ?? "{}");
        report("browser-action", { type: "focus-selection", thread_id: selected.thread_id, status: response.status });
      }
      if (path.startsWith("/api/presentation/") && response.ok) {
        const body = await response.clone().json();
        const rows = [...(body.rows ?? body.messages ?? body.history ?? []), ...(body.resolved ?? [])];
        if (Array.isArray(rows)) for (const row of rows) report("room-frame", { type: "history", row });
      }
    } catch {}
    return response;
  };
  document.addEventListener("click", (event) => {
    const control = event.target?.closest?.("#call-controls button, #call-menu button, #connect, #skip-reply, #mute");
    if (control) report("browser-action", { type: "ui-click", control: control.id || control.getAttribute("aria-label") || control.textContent?.trim().slice(0, 50) });
  }, true);
  if (navigator.mediaDevices?.getUserMedia) {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      try { const stream = await capture(...args); report("browser-ready", { microphone: true, tracks: stream.getAudioTracks().length }); return stream; }
      catch (error) { report("browser-error", { microphone: String(error?.name ?? error) }); throw error; }
    };
  }
})();
