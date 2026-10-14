const $ = (id) => document.getElementById(id);
let previewOrigin = null;
let connected = false;
let scripts = {};
const ask = async (path, body) => {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};
const setStatus = (message) => { $("status").textContent = message; };
const item = (value) => { const li = document.createElement("li"); li.textContent = value; return li; };
const short = (value) => typeof value === "string" ? value.slice(0, 11) : "—";

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
  await ask("/preview/turn-lab/start", {});
  setStatus("Building pinned core, connector, web and voice. This can take several minutes on first use.");
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
        $("room").hidden = false;
        $("room-wait").hidden = true;
        $("connect").disabled = false;
      }
      setStatus("Real room ready. Allow its microphone, finish local model setup, then speak. Run a script to test its reply.");
    }
    $("epoch").textContent = state.evidence.currentEpoch ?? "—";
    $("fates").replaceChildren(...state.evidence.fates.map((fate) => item(`${short(fate.utterance_id)}: ${fate.fate}${fate.heard_chars == null ? "" : ` at ${fate.heard_chars}`} ${fate.reason ?? ""}`)));
    $("notices").replaceChildren(...state.evidence.notes.map((notice) => item(`${notice.kind}: ${notice.instruction ?? ""}`)));
    $("checks").replaceChildren(...Object.entries(state.evidence.checks).map(([id, check]) => {
      const div = document.createElement("div"); div.className = `check ${check.state}`; div.textContent = `${id} ${check.state.toUpperCase()}`; div.title = check.reason; return div;
    }));
    $("events").replaceChildren(...state.events.slice(-100).reverse().map((event) => item(`${new Date(event.at).toLocaleTimeString()} ${event.kind} ${JSON.stringify(event.data).slice(0, 600)}`)));
    connected = Boolean(state.agent?.ready);
    $("run").disabled = !connected;
    $("agent-status").textContent = connected ? `Connected · ${state.agent.inputMode}` : "Agent not connected";
  } catch (error) { setStatus(`Lab status: ${error.message}`); }
}

$("connect").onclick = async () => {
  $("connect").disabled = true;
  try { await ask("/preview/turn-lab/connect", { mode: $("mode").value }); connected = true; await poll(); }
  catch (error) { $("agent-status").textContent = error.message; }
  finally { $("connect").disabled = false; }
};
$("run").onclick = async () => {
  $("run").disabled = true;
  try { await ask("/preview/turn-lab/choose", { id: $("script").value }); }
  catch (error) { $("agent-status").textContent = error.message; }
  finally { $("run").disabled = !connected; await poll(); }
};
$("export").onclick = async () => {
  const trace = await ask("/preview/turn-lab/export");
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `turn-lab-${Date.now()}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("message", (event) => {
  if (event.origin !== previewOrigin || event.data?.source !== "turn-lab-browser") return;
  void ask("/preview/turn-lab/event", { kind: event.data.kind, data: event.data.data }).catch(() => {});
});
void boot().catch((error) => setStatus(`Could not start: ${error.message}`));
setInterval(poll, 1000);
