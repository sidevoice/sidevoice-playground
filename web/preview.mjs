// The Web preview section: the real sidevoice-web at a picked commit, on the real core and connector of a picked
// release, in a scenario (the server's preview/: built by checkout, run per scenario, served on an origin of its own).
// This page picks, starts and stops; the preview itself opens in its own tab. Not in the macOS app, which has no
// server to build or run anything.

import { archiveChoices, buildChoices, webChoices } from "./preview/choices.mjs";

const $ = (selector) => document.querySelector(selector);

/** @returns {{ show: () => void }} what the page calls each time the section is shown */
export function previewSection({ inApp }) {
  let options = null;
  let polling = null;

  const status = (selector, text, error = false) => {
    const line = $(selector);
    line.textContent = text;
    line.classList.toggle("error", error);
  };
  const fill = (select, choices) => {
    const chosen = select.value;
    select.replaceChildren(...choices.map((c) => new Option(c.label, c.value)));
    if (choices.some((c) => c.value === chosen)) select.value = chosen;
  };
  const scenario = () => options?.scenarios.find((s) => s.id === $("#preview-scenario").value) ?? null;

  async function ask(path, body) {
    const res = await fetch(path, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
    return res.json();
  }

  function renderScenario() {
    const picked = scenario();
    $("#preview-summary").textContent = picked
      ? `${picked.summary}${picked.state === "kept" ? (picked.kept ? " Its kept state is there." : " Nothing kept yet.") : ""}`
      : "";
    $("#preview-steps").replaceChildren(...(picked?.steps ?? []).map((step) => Object.assign(document.createElement("li"), { textContent: step })));
    $("#preview-forget").hidden = picked?.state !== "kept";
  }

  async function list() {
    status("#preview-status", "Listing what there is to pick…");
    try {
      const [listed, engines, voices] = await Promise.all([
        ask("/preview/options"),
        ask("/engine-builds").catch(() => null),
        ask("/voice-builds").catch(() => null),
      ]);
      options = listed;
      fill($("#preview-web"), webChoices(listed.web));
      fill($("#preview-core"), archiveChoices(listed.core, "nightly"));
      fill($("#preview-connector"), archiveChoices(listed.connector, "release"));
      fill($("#preview-engine"), buildChoices(engines));
      fill($("#preview-voice"), buildChoices(voices));
      fill($("#preview-scenario"), listed.scenarios.map((s) => ({ value: s.id, label: s.title })));
      renderScenario();
      status("#preview-status", "");
    } catch (error) {
      status("#preview-status", `Could not list: ${error.message}`, true);
    }
  }

  function render({ job, log, current, link }) {
    const log$ = $("#preview-log");
    log$.hidden = !log.length;
    log$.textContent = log.join("\n");
    log$.scrollTop = log$.scrollHeight;
    if (job.state === "starting") status("#preview-status", "Starting…");
    else if (job.state === "failed") status("#preview-status", job.error, true);
    else if (current) status("#preview-status", "");
    else status("#preview-status", "Nothing running.");
    $("#preview-start").disabled = job.state === "starting";
    $("#preview-live").hidden = !current;
    if (current) {
      $("#preview-running").textContent = `${current.scenario}: web ${current.web}, core ${current.core}, connector ${current.connector}.`;
      $("#preview-open").href = link;
    }
    if (job.state !== "starting") stopPolling();
  }

  async function poll() {
    try {
      render(await ask("/preview/status"));
    } catch (error) {
      status("#preview-status", error.message, true);
      stopPolling();
    }
  }
  function startPolling() {
    stopPolling();
    polling = setInterval(poll, 1500);
    poll();
  }
  function stopPolling() {
    if (polling) clearInterval(polling);
    polling = null;
  }

  $("#preview-scenario").onchange = renderScenario;
  $("#preview-start").onclick = async () => {
    $("#preview-code").hidden = true;
    try {
      await ask("/preview/start", {
        web: $("#preview-web").value,
        core: $("#preview-core").value,
        connector: $("#preview-connector").value,
        engine: $("#preview-engine").value || null,
        voice: $("#preview-voice").value || null,
        scenario: $("#preview-scenario").value,
      });
      startPolling();
    } catch (error) {
      status("#preview-status", error.message, true);
    }
  };
  $("#preview-stop").onclick = async () => {
    try {
      await ask("/preview/stop", {});
      poll();
    } catch (error) {
      status("#preview-status", error.message, true);
    }
  };
  $("#preview-forget").onclick = async () => {
    try {
      await ask("/preview/forget", { scenario: $("#preview-scenario").value });
      await list();
      poll();
    } catch (error) {
      status("#preview-status", error.message, true);
    }
  };
  $("#preview-pair").onclick = async () => {
    status("#preview-code-status", "Asking the connector for a code…");
    try {
      const { code, expires_in } = await ask("/preview/pair", {});
      $("#preview-code").textContent = code;
      $("#preview-code").hidden = false;
      status("#preview-code-status", `Valid ${Math.round(expires_in / 60)} minutes: paste it where the preview asks for a code.`);
    } catch (error) {
      status("#preview-code-status", error.message, true);
    }
  };

  return {
    show() {
      if (inApp) {
        status("#preview-status", "The Web preview needs the playground's server: open the web playground.", true);
        return;
      }
      if (!options) list();
      poll();
    },
  };
}
