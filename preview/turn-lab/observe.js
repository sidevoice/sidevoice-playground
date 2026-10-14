// Loaded after the real web's target.js. Observe only; the room and voice module own all behavior.
(() => {
  const report = (kind, data) => {
    try { parent.postMessage({ source: "turn-lab-browser", kind, data }, "*"); } catch {}
  };
  let paired = false;
  try { paired = (JSON.parse(localStorage.getItem("sidevoice.pairings") || "{}").pairings ?? []).length > 0; } catch {}
  report("browser-ready", { path: location.pathname, microphone: Boolean(navigator.mediaDevices?.getUserMedia), paired });
  window.addEventListener("message", async (event) => {
    if (event.source !== parent || event.origin !== new URL(document.referrer).origin || event.data?.type !== "turn-lab-pair" || paired) return;
    try {
      const { redeemPairingCode, readPairingState, withPairing, writePairings } = await import("/voice/turn-lab-modules/device-pairing.js");
      const { pairing } = await redeemPairingCode(event.data.code, { origin: location.origin, target: location.origin, address: location.origin, name: "Turn Lab browser" });
      if (!writePairings(localStorage, withPairing(readPairingState(localStorage), pairing))) throw new Error("Could not save pairing");
      paired = true;
      report("browser-ready", { paired: true, host: pairing.host });
      location.reload();
    } catch (error) { report("browser-error", { pairing: String(error?.message ?? error) }); }
  });
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
