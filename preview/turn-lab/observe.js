// Loaded after the real web's target.js. Observe only; the room and voice module own all behavior.
(() => {
  const report = (kind, data) => {
    try { parent.postMessage({ source: "turn-lab-browser", kind, data }, "*"); } catch {}
  };
  report("browser-ready", { path: location.pathname, microphone: Boolean(navigator.mediaDevices?.getUserMedia) });
  const safe = (value) => {
    if (typeof value !== "string") return null;
    try {
      const parsed = JSON.parse(value);
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
