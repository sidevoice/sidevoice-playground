// Loaded after the real web's target.js. Observe only; the room and voice module own all behavior.
(() => {
  // Start the first browser visit at the remote machine and model steps. The web still
  // performs its own pairing, model installation and voice call; no transcripts are injected.
  try {
    if (!localStorage.getItem("sidevoice.onboarding")) localStorage.setItem("sidevoice.onboarding", JSON.stringify({
      version: 1, basics_done: true, choice: "remote", agents_done: true, turn_done: false,
      deferred_at: null, completed_at: null, trials: {}, chosen: {}, baseline_release: 0, features: {},
    }));
  } catch {}
  const report = (kind, data) => {
    try { parent.postMessage({ source: "turn-lab-browser", kind, data }, "*"); } catch {}
  };
  let paired = false;
  try { paired = (JSON.parse(localStorage.getItem("sidevoice.pairings") || "{}").pairings ?? []).length > 0; } catch {}
  report("browser-ready", { path: location.pathname, microphone: Boolean(navigator.mediaDevices?.getUserMedia), paired });
  const readyAction = async () => {
    for (let i = 0; i < 100 && !window.sidevoiceActions?.pairDevice; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (!window.sidevoiceActions?.pairDevice) throw new Error("Web pairing action did not load");
    return window.sidevoiceActions;
  };
  window.addEventListener("message", async (event) => {
    if (event.source !== parent || event.origin !== new URL(document.referrer).origin || event.data?.type !== "turn-lab-pair") return;
    try {
      const actions = await readyAction();
      const result = await actions.pairDevice(event.data.code, "Turn Lab browser", location.origin);
      paired = true;
      report("browser-ready", { paired: true, host: result?.host });
    } catch (error) { report("browser-error", { pairing: String(error?.message ?? error) }); }
  });
  const clicked = new Set();
  setInterval(() => {
    const wizard = document.getElementById("wizard");
    const step = wizard?.getAttribute("data-step");
    if (wizard?.open && step) {
      const downloadId = step === "W4" ? "stt-model-download" : step === "W4v" ? "tts-model-download" : step === "W5" ? "turn-model-download" : null;
      const download = downloadId && document.getElementById(downloadId);
      if (download && !clicked.has(downloadId)) { clicked.add(downloadId); download.click(); report("browser-ready", { model: downloadId, state: "downloading" }); }
      const next = document.getElementById("wizard-stage-action");
      if (next && !next.disabled && !clicked.has(`${step}:continue`)) { clicked.add(`${step}:continue`); next.click(); report("browser-ready", { modelStep: step, state: "ready" }); }
      if (step === "W6" && !clicked.has("enter")) { clicked.add("enter"); wizard.querySelector(".wizard-enter")?.click(); }
    } else if (paired) {
      const person = [...document.querySelectorAll(".participant-row button.person")].find((button) => button.textContent?.includes("Turn Lab"));
      if (person && !clicked.has("select")) { clicked.add("select"); person.click(); return; }
      const join = document.getElementById("connect");
      if (join && !join.classList.contains("joined") && !clicked.has("join") && !join.disabled) {
        clicked.add("join"); join.click(); report("browser-ready", { voice: "starting" });
      }
    }
  }, 500);
  const safe = (value) => {
    if (typeof value !== "string") return null;
    try {
      const wire = value.startsWith("42") ? JSON.parse(value.slice(2)) : JSON.parse(value);
      const parsed = Array.isArray(wire) ? { type: wire[0], data: wire[1] } : wire;
      const data = parsed.data ?? parsed;
      return { type: parsed.type ?? parsed.event ?? data.type, event: parsed.event, epoch: data.epoch, utterance_id: data.utterance_id, utterance_ids: data.utterance_ids, heard_chars: data.heard_chars, status: data.status, reason: data.reason, text: data.text, data: { epoch: data.epoch, utterance_id: data.utterance_id, utterance_ids: data.utterance_ids, heard_chars: data.heard_chars, status: data.status, reason: data.reason } };
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
      if (path.startsWith("/api/presentation/") && response.ok) {
        const body = await response.clone().json();
        const rows = body.rows ?? body.messages ?? body.history ?? [];
        if (Array.isArray(rows)) for (const row of rows) report("room-frame", { type: "history", epoch: row.epoch, utterance_id: row.utterance_id, status: row.status, heard_chars: row.heard_chars, reason: row.audio_reason, text: row.text });
      }
    } catch {}
    return response;
  };
  if (navigator.mediaDevices?.getUserMedia) {
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      try { const stream = await capture(...args); report("browser-ready", { microphone: true, tracks: stream.getAudioTracks().length }); return stream; }
      catch (error) { report("browser-error", { microphone: String(error?.name ?? error) }); throw error; }
    };
  }
})();
