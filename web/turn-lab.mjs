const $ = (id) => document.getElementById(id);
let previewOrigin = null;
let connected = false;
let autoConnecting = false;
let reconnecting = false;
let autoConnectAttempts = 0;
let nextAutoConnectAt = 0;
let pairingSent = false;
let joinedThread = null;
let scripts = {};
let config = null;
let modeInitialized = false;
let activeRunId = null;
let secondConversation = null;
let observingSecond = false;
let startRequested = false;
let polling = false;
const matchesCandidate = (current) => current?.mode === "real" && current.scenario === "turn-lab" &&
  ["core", "connector", "web", "voice", "engine"].every((key) => current.identity?.[key] === config?.[key]);
const ask = async (path, body) => {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
const setStatus = (message) => { $("status").textContent = message; };
const item = (value) => { const li = document.createElement("li"); li.textContent = value; return li; };
const short = (value) => typeof value === "string" ? value.slice(0, 11) : "—";
const preflightText = (event) => {
  const data = event.data ?? {};
  if (event.kind === "browser-error") return `Needs attention: ${Object.values(data).join(" · ")}`;
  if (data.voice === "joined") return "Call joined to the scripted agent";
  if (data.voice === "starting") return "Joining the real room";
  if (data.tracks != null) return `Microphone ready (${data.tracks} audio track${data.tracks === 1 ? "" : "s"})`;
  if (data.paired === true) return `Paired to ${data.host ?? "the real core"}`;
  if (data.paired === false) return "Pairing browser to the real core";
  if (data.model) return `Downloading ${data.model}`;
  if (data.modelStep) return `Local voice setup ${data.modelStep} ready`;
  if (data.selected) return "Agent conversation selected";
  if (data.state === "selecting") return "Selecting agent conversation";
  return "Real browser room loaded";
};

async function boot() {
  showConfig(await ask("/preview/turn-lab/config"));
  scripts = await ask("/preview/turn-lab/scripts");
  $("script").replaceChildren(...Object.entries(scripts).map(([id, script]) => new Option(`${id} · ${script.title}`, id)));
  $("script").onchange = () => $("instruction").textContent = scripts[$("script").value].instruction ?? "Speak naturally.";
  $("script").onchange();
  const status = await ask("/preview/status");
  previewOrigin = new URL(status.link).origin;
  setStatus("Checking the pinned room. First source builds can take several minutes.");
  await poll();
}

function showConfig(next) {
  config = next;
  $("pins").replaceChildren(...Object.entries(config).filter(([key]) => ["core", "connector", "web", "voice", "engine"].includes(key)).flatMap(([key, value]) => {
    const name = document.createElement("dt"), sha = document.createElement("dd"); name.textContent = key; sha.textContent = value ?? "pending"; return [name, sha];
  }));
  $("pin-note").textContent = Object.values(config.notes ?? {}).join(" · ");
}

async function poll() {
  if (polling || !config || !previewOrigin) return;
  polling = true;
  try {
    const state = await ask("/preview/turn-lab/events");
    if (state.job.state === "running" && !matchesCandidate(state.current)) {
      const latest = await ask("/preview/turn-lab/config");
      if (JSON.stringify(latest) !== JSON.stringify(config)) showConfig(latest);
    }
    if (!matchesCandidate(state.current) || state.job.state !== "running") {
      $("room").hidden = true;
      $("room-wait").hidden = false;
      $("run").disabled = true;
      $("connect").disabled = true;
      if (state.job.state === "failed") setStatus(`Build failed: ${state.job.error}. Click Restart room to retry.`);
      else if (state.job.state === "starting") setStatus("Waiting for the current build; the pinned room starts when it finishes.");
      else if (!startRequested) {
        startRequested = true;
        await ask("/preview/turn-lab/start", {});
        setStatus("Building the pinned room. This can take several minutes on first use.");
      }
      return;
    }
    if (state.job.state === "running") {
      if (activeRunId !== state.current.runId || $("room").hidden) {
        const status = await ask("/preview/status");
        const url = new URL(status.link); url.pathname = "/voice/";
        $("room").src = url.href;
        activeRunId = state.current.runId;
        joinedThread = null;
        secondConversation = null;
        observingSecond = false;
        pairingSent = false;
        autoConnectAttempts = 0;
        nextAutoConnectAt = 0;
        $("room").hidden = false;
        $("room-wait").hidden = true;
        $("connect").disabled = false;
      }
      setStatus("Real room ready. Allow microphone access and wait for local models to download; then speak or choose a script.");
      connected = Boolean(state.agent?.ready);
      secondConversation = state.secondAgent?.ready ? state.secondAgent.conversation : null;
      $("switch-conversation").hidden = !secondConversation;
      if (connected && !modeInitialized) { $("mode").value = state.agent.inputMode; modeInitialized = true; }
      if (!connected && !autoConnecting && !reconnecting && autoConnectAttempts < 3 && Date.now() >= nextAutoConnectAt) {
        autoConnectAttempts++;
        autoConnecting = true;
        void ask("/preview/turn-lab/connect", { mode: $("mode").value }).then(() => { connected = true; void poll(); })
          .catch((error) => {
            nextAutoConnectAt = Date.now() + 2000;
            $("agent-status").textContent = autoConnectAttempts < 3 ? `Connection delayed; retrying (${autoConnectAttempts}/3): ${error.message}` : `Connect failed: ${error.message}. Click Reconnect agent.`;
          })
          .finally(() => { autoConnecting = false; });
      }
    }
    $("epoch").textContent = state.evidence.currentEpoch ?? "—";
    const browser = state.events.filter((event) => event.kind === "browser-ready" || event.kind === "browser-error");
    $("preflight").replaceChildren(...(browser.length ? browser.slice(-7).map((event) => item(preflightText(event))) : [item("Waiting for the real browser room") ]));
    $("fates").replaceChildren(...state.evidence.fates.map((fate) => item(`${short(fate.utterance_id)}: ${fate.fate}${fate.hearing_unconfirmed ? " (unconfirmed)" : ""}${fate.heard_chars == null ? "" : ` at ${fate.heard_chars}`} · audio: ${fate.audio ?? "pending"}${fate.heard != null ? ` · heard: “${fate.heard}” · unheard: “${fate.unheard}”` : ""}`)));
    $("notices").replaceChildren(...state.evidence.notes.map((notice) => item(`${notice.kind}: ${notice.instruction ?? ""}${(notice.unheard ?? []).map((reply) => { const chars = [...(reply.text ?? "")]; const n = reply.heard_chars ?? 0; return ` · ${short(reply.utterance_id)} ${reply.fate} at ${n}: heard “${chars.slice(0, n).join("")}”, unheard “${chars.slice(n).join("")}"`; }).join("")}${(notice.heard ?? []).map((reply) => { const text = state.evidence.fates.find((row) => row.utterance_id === reply.utterance_id)?.text; const chars = [...(text ?? "")], n = reply.heard_chars ?? 0; return ` · ${short(reply.utterance_id)} ${reply.fate} at ${n}${text == null ? "" : `: heard “${chars.slice(0, n).join("")}”, unheard “${chars.slice(n).join("")}"`}`; }).join("")}`)));
    $("checks").replaceChildren(...Object.entries(state.evidence.checks).map(([id, check]) => {
      const div = document.createElement("div"); div.className = `check ${check.state}`; div.textContent = `${id} ${check.state.replaceAll("-", " ").toUpperCase()}`; div.title = check.reason; return div;
    }));
    $("events").replaceChildren(...state.events.slice(-100).reverse().map((event) => item(`${new Date(event.at).toLocaleTimeString()} ${event.kind} ${JSON.stringify(event.data).slice(0, 600)}`)));
    const selectedThread = observingSecond && secondConversation ? secondConversation : state.agent?.conversation;
    if (connected && !$("room").hidden) $("room").contentWindow.postMessage({ type: "turn-lab-thread", thread: selectedThread }, previewOrigin);
    $("run").disabled = reconnecting || !connected || joinedThread !== state.agent?.conversation;
    $("agent-status").textContent = connected ? `Connected · ${state.agent.inputMode}` :
      autoConnectAttempts < 3 ? `Connecting scripted agent (attempt ${Math.max(autoConnectAttempts, 1)}/3)…` : "Agent not connected. Click Reconnect agent.";
    if (connected && joinedThread === state.agent?.conversation) setStatus("Ready. Speak in the room or choose a script; the real browser voice and scripted agent are connected.");
  } catch (error) { if (String(error.message).includes("409")) startRequested = false; setStatus(`Lab status: ${error.message}`); }
  finally { polling = false; }
}

$("connect").onclick = async () => {
  if (autoConnecting) return;
  reconnecting = true;
  $("connect").disabled = true;
  $("run").disabled = true;
  connected = false;
  joinedThread = null;
  setStatus("Reconnecting the scripted agent. Wait for the room to join its new conversation.");
  try { const requestedMode = $("mode").value; await ask("/preview/turn-lab/connect", { mode: requestedMode }); connected = true; $("mode").value = requestedMode; modeInitialized = true; await poll(); }
  catch (error) { $("agent-status").textContent = error.message; }
  finally { reconnecting = false; $("connect").disabled = false; void poll(); }
};
$("recover").onclick = async () => {
  $("recover").disabled = true;
  try {
    showConfig(await ask("/preview/turn-lab/config"));
    await ask("/preview/turn-lab/recover", {});
    activeRunId = null; joinedThread = null; autoConnectAttempts = 0; nextAutoConnectAt = 0; connected = false;
    $("run").disabled = true;
    $("connect").disabled = true;
    $("room").hidden = true;
    $("room-wait").hidden = false;
    setStatus("Restarting the pinned room. Run the case again after it joins.");
  } catch (error) { setStatus(`Restart failed: ${error.message}`); }
  finally { $("recover").disabled = false; }
};
$("switch-conversation").onclick = () => {
  observingSecond = !observingSecond;
  joinedThread = null;
  $("switch-conversation").textContent = observingSecond ? "Return to first conversation" : "Switch T11 conversation";
  void poll();
};
$("run").onclick = async () => {
  $("run").disabled = true;
  try { await ask("/preview/turn-lab/choose", { id: $("script").value }); }
  catch (error) { $("agent-status").textContent = error.message; }
  finally { await poll(); }
};
$("export").onclick = async () => {
  const trace = await ask("/preview/turn-lab/export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `turn-lab-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("message", (event) => {
  if (event.source !== $("room").contentWindow || event.origin !== previewOrigin || event.data?.source !== "turn-lab-browser") return;
  if (event.data.kind === "browser-ready" && event.data.data?.voice === "joined") joinedThread = event.data.data.thread;
  if (event.data.kind === "browser-ready" && event.data.data?.paired === false && !pairingSent) {
    pairingSent = true;
    void ask("/preview/pair", {}).then(({ code }) => $("room").contentWindow.postMessage({ type: "turn-lab-pair", code }, previewOrigin)).catch((error) => setStatus(`Pairing: ${error.message}`));
  }
  void ask("/preview/turn-lab/event", { kind: event.data.kind, data: event.data.data }).catch(() => {});
});
void boot().catch((error) => setStatus(`Could not start: ${error.message}`));
setInterval(poll, 1000);
