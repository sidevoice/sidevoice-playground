const $ = (id) => document.getElementById(id);
let previewOrigin = null;
let connected = false;
let autoConnecting = false;
let attemptedAutoConnect = false;
let pairingSent = false;
let joinedThread = null;
let scripts = {};
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
  const config = await ask("/preview/turn-lab/config");
  $("pins").replaceChildren(...Object.entries(config).filter(([key]) => ["core", "connector", "web", "voice", "engine"].includes(key)).flatMap(([key, value]) => {
    const name = document.createElement("dt"), sha = document.createElement("dd"); name.textContent = key; sha.textContent = value ?? "pending"; return [name, sha];
  }));
  $("pin-note").textContent = Object.values(config.notes ?? {}).join(" · ");
  scripts = await ask("/preview/turn-lab/scripts");
  $("script").replaceChildren(...Object.entries(scripts).map(([id, script]) => new Option(`${id} · ${script.title}`, id)));
  $("script").onchange = () => $("instruction").textContent = scripts[$("script").value].instruction ?? "Speak naturally.";
  $("script").onchange();
  const status = await ask("/preview/status");
  previewOrigin = new URL(status.link).origin;
  if (status.job.state !== "starting" && (status.job.state !== "running" || status.current?.scenario !== "turn-lab")) {
    await ask("/preview/turn-lab/start", {});
  }
  setStatus(status.job.state === "running" && status.current?.scenario === "turn-lab"
    ? "Resuming the real room."
    : "Building pinned core, connector, web and voice. This can take several minutes on first use.");
}

async function poll() {
  try {
    const state = await ask("/preview/turn-lab/events");
    if (state.job.state === "failed") setStatus(`Build failed: ${state.job.error}`);
    if (state.job.state === "running") {
      if ($("room").hidden) {
        const status = await ask("/preview/status");
        const url = new URL(status.link); url.pathname = "/voice/";
        $("room").src = url.href;
        joinedThread = null;
        $("room").hidden = false;
        $("room-wait").hidden = true;
        $("connect").disabled = false;
      }
      setStatus("Real room ready. Allow microphone access and wait for local models to download; then speak or choose a script.");
      if (!connected && !autoConnecting && !attemptedAutoConnect) {
        attemptedAutoConnect = true;
        autoConnecting = true;
        void ask("/preview/turn-lab/connect", { mode: $("mode").value }).then(() => { connected = true; void poll(); })
          .catch((error) => { $("agent-status").textContent = `Connect failed: ${error.message}`; })
          .finally(() => { autoConnecting = false; });
      }
    }
    $("epoch").textContent = state.evidence.currentEpoch ?? "—";
    const browser = state.events.filter((event) => event.kind === "browser-ready" || event.kind === "browser-error");
    $("preflight").replaceChildren(...(browser.length ? browser.slice(-7).map((event) => item(preflightText(event))) : [item("Waiting for the real browser room") ]));
    $("fates").replaceChildren(...state.evidence.fates.map((fate) => item(`${short(fate.utterance_id)}: ${fate.fate}${fate.heard_chars == null ? "" : ` at ${fate.heard_chars}`} ${fate.reason ?? ""}${fate.heard != null ? ` · heard: “${fate.heard}” · unheard: “${fate.unheard}”` : ""}`)));
    $("notices").replaceChildren(...state.evidence.notes.map((notice) => item(`${notice.kind}: ${notice.instruction ?? ""}`)));
    $("checks").replaceChildren(...Object.entries(state.evidence.checks).map(([id, check]) => {
      const div = document.createElement("div"); div.className = `check ${check.state}`; div.textContent = `${id} ${check.state.toUpperCase()}`; div.title = check.reason; return div;
    }));
    $("events").replaceChildren(...state.events.slice(-100).reverse().map((event) => item(`${new Date(event.at).toLocaleTimeString()} ${event.kind} ${JSON.stringify(event.data).slice(0, 600)}`)));
    connected = Boolean(state.agent?.ready);
    if (connected && !$("room").hidden) $("room").contentWindow.postMessage({ type: "turn-lab-thread", thread: state.agent.conversation }, previewOrigin);
    $("run").disabled = !connected || joinedThread !== state.agent?.conversation;
    $("agent-status").textContent = connected ? `Connected · ${state.agent.inputMode}` : "Agent not connected";
    if (connected && joinedThread === state.agent?.conversation) setStatus("Ready. Speak in the room or choose a script; the real browser voice and scripted agent are connected.");
  } catch (error) { setStatus(`Lab status: ${error.message}`); }
}

$("connect").onclick = async () => {
  $("connect").disabled = true;
  joinedThread = null;
  try { await ask("/preview/turn-lab/connect", { mode: $("mode").value }); connected = true; await poll(); }
  catch (error) { $("agent-status").textContent = error.message; }
  finally { $("connect").disabled = false; }
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
