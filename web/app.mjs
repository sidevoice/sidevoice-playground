// The page: pick engines by name, load them side by side, and see what each offers. Speaking and transcribing are
// wired when an engine's web build exposes them; until then each panel says what the active engine does expose.

import { record, decodeToPcm, toWav } from "./audio.mjs";
import { browserHost } from "./engine/host.mjs";
import { listReleases, loadEngine } from "./engine/load.mjs";
import { parseSpec } from "./engine/spec.mjs";

const $ = (selector) => document.querySelector(selector);

// The shell supplies the bytes: in the browser, server.mjs's /fetch (github.com sends no CORS headers).
const fetchers = {
  fetchBytes: async (url) => {
    const res = await fetch(`/fetch?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(await res.text());
    return new Uint8Array(await res.arrayBuffer());
  },
  fetchJson: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  },
};

/** label → { loaded, engine, backends, offers: { stt, tts }, methods } */
const engines = new Map();
let active = null;
let clip = null; // the recording or upload to transcribe: { samples, rate }

function status(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

async function fillReleases() {
  const list = $("#engine-releases");
  for (const name of ["nightly", "latest"]) list.append(new Option(name));
  try {
    for (const { tag, prerelease } of await listReleases(fetchers.fetchJson)) {
      if (tag !== "nightly") list.append(new Option(tag, prerelease ? `${tag} (pre-release)` : tag));
    }
  } catch (error) {
    console.warn("could not list releases", error);
  }
}

async function load(input) {
  const line = $("#engine-status");
  let spec;
  try {
    spec = parseSpec(input);
  } catch (error) {
    return status(line, error.message, true);
  }
  status(line, `Loading ${spec.label}…`);
  try {
    const loaded = await loadEngine(spec, fetchers);
    const engine = await loaded.module.WebEngine.create(browserHost());
    const offers = {};
    for (const task of ["stt", "tts"]) {
      try {
        offers[task] = engine.offers(task);
      } catch (error) {
        offers[task] = { error: String(error?.message ?? error) };
      }
    }
    const methods = Object.getOwnPropertyNames(loaded.module.WebEngine.prototype).filter(
      (name) => name !== "constructor" && name !== "free",
    );
    engines.set(loaded.label, { loaded, engine, backends: engine.backends(), offers, methods });
    active = loaded.label;
    status(line, `Loaded ${loaded.label}: version ${loaded.version}.`);
    render();
  } catch (error) {
    console.error(error);
    status(line, String(error?.message ?? error), true);
  }
}

function render() {
  const list = $("#engine-list");
  list.replaceChildren(
    ...[...engines.keys()].map((label) => {
      const item = document.createElement("li");
      const radio = Object.assign(document.createElement("input"), { type: "radio", name: "active", checked: label === active });
      radio.onchange = () => {
        active = label;
        render();
      };
      const { loaded } = engines.get(label);
      item.append(radio, ` ${label} — ${loaded.version} `, code(loaded.sha256.slice(0, 12)));
      return item;
    }),
  );

  const current = engines.get(active);
  const details = $("#engine-details");
  if (!current) return details.replaceChildren();
  details.replaceChildren(
    paragraph("Backends in this build: ", code(current.backends.join(", ") || "none")),
    paragraph("WebEngine exposes: ", code(current.methods.join(", "))),
    offersTable(current.offers),
  );
  fillModels("#tts-model", current.offers.tts);
  fillModels("#stt-model", current.offers.stt);
  renderRuns(current);
}

// Running a model needs the engine's web build to prepare, speak and transcribe; none does yet (DESIGN.md).
function renderRuns(current) {
  const why = `Not wired: this engine's WebEngine exposes ${current.methods.join(", ")}, nothing that runs a model yet.`;
  for (const id of ["tts", "stt", "roundtrip"]) {
    $(`#${id}-run`).disabled = true;
    status($(`#${id} .run-status`), why);
  }
}

function fillModels(selector, offers) {
  const select = $(selector);
  const offered = Array.isArray(offers) ? offers.filter((o) => o.offered) : [];
  select.replaceChildren(...offered.map((o) => new Option(`${o.model} · ${o.build}`, `${o.model}|${o.build}`)));
}

function offersTable(offers) {
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Task</th><th>Model</th><th>Build</th><th>Offered</th><th>Why not</th></tr>";
  for (const [task, rows] of Object.entries(offers)) {
    if (!Array.isArray(rows)) {
      table.append(row(task, "—", "—", "—", rows.error));
      continue;
    }
    if (rows.length === 0) table.append(row(task, "none", "", "", ""));
    for (const o of rows) table.append(row(task, o.model, o.build, o.offered ? "yes" : "no", o.why ?? ""));
  }
  return table;
}

function row(...cells) {
  const tr = document.createElement("tr");
  for (const cell of cells) tr.append(Object.assign(document.createElement("td"), { textContent: cell }));
  return tr;
}

function code(text) {
  return Object.assign(document.createElement("code"), { textContent: text });
}

function paragraph(...children) {
  const p = document.createElement("p");
  p.append(...children);
  return p;
}

function showClip(next) {
  clip = next;
  const audio = $("#stt-audio");
  audio.src = URL.createObjectURL(toWav(clip.samples, clip.rate));
  audio.hidden = false;
}

let recording = null;
$("#stt-record").onclick = async () => {
  const button = $("#stt-record");
  try {
    if (!recording) {
      recording = await record();
      button.textContent = "Stop";
    } else {
      const stopping = recording;
      recording = null;
      button.textContent = "Record";
      showClip(await stopping.stop());
    }
  } catch (error) {
    recording = null;
    button.textContent = "Record";
    status($("#stt .run-status"), String(error?.message ?? error), true);
  }
};

$("#stt-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (file) showClip(await decodeToPcm(await file.arrayBuffer()));
};

$("#engine-form").onsubmit = (event) => {
  event.preventDefault();
  load($("#engine-input").value);
};

fillReleases();
