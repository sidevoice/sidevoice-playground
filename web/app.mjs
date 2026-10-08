// The page: pick engines by name, load them side by side, and use the active one. An engine whose WebEngine has the
// model interface (`models`, `install`, `uninstall`, `load`) speaks, transcribes and runs the round trip here, in the
// browser; for an older one, each panel says what it does expose.

import { record, decodeToPcm, toWav } from "./audio.mjs";
import { browserHost } from "./engine/host.mjs";
import { listReleases, loadEngine, loadServedEngine } from "./engine/load.mjs";
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

/**
 * label → { loaded, engine, backends, methods, offers?, catalog?, memory, voices }: `catalog` is what `models()` last
 * said, for an engine with the model interface; `memory` holds its loaded models by `model|build`; `voices`, by
 * model, what a loaded model said of its voices when the catalogue lists none.
 */
const engines = new Map();
let active = null;
let clip = null; // the recording or upload to transcribe: { samples, rate }
let busy = false;
/** What server.mjs says of its local build (`--engine-tarball`), if it has one. */
let localBuild = null;

function status(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

async function fillReleases() {
  const list = $("#engine-releases");
  try {
    const res = await fetch("/local-engine.json");
    if (res.ok) {
      localBuild = await res.json();
      list.append(new Option("local", localBuild.label));
      $("#engine-input").value = "local";
      status($("#engine-status"), `This server offers ${localBuild.label}: type "local" (already filled in) and Load.`);
    }
  } catch (error) {
    console.warn("could not ask for a local build", error);
  }
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
  const wantsLocal = input.trim() === "local";
  if (wantsLocal && !localBuild) return status(line, "This server has no local build (server.mjs --engine-tarball).", true);
  if (wantsLocal && engines.has(localBuild.label)) {
    active = localBuild.label;
    return render();
  }
  let spec;
  if (!wantsLocal) {
    try {
      spec = parseSpec(input);
    } catch (error) {
      return status(line, error.message, true);
    }
  }
  status(line, `Loading ${wantsLocal ? localBuild.label : spec.label}…`);
  try {
    let loaded;
    if (wantsLocal) loaded = await loadServedEngine(localBuild);
    else if (spec.kind === "ref") {
      status(line, `Fetching the CI build of ${spec.label} (the first time, the server downloads and installs it)…`);
      const info = await refBuild(spec.ref);
      if (engines.has(info.label)) {
        active = info.label;
        status(line, `Already loaded: ${info.label}.`);
        return render();
      }
      loaded = await loadServedEngine(info);
    } else loaded = await loadEngine(spec, fetchers);
    const engine = await loaded.module.WebEngine.create(browserHost());
    const methods = Object.getOwnPropertyNames(loaded.module.WebEngine.prototype).filter(
      (name) => name !== "constructor" && name !== "free",
    );
    const entry = { loaded, engine, backends: engine.backends(), methods, memory: new Map(), voices: new Map() };
    if (typeof engine.models === "function") entry.catalog = await engine.models();
    else if (typeof engine.offers === "function") entry.offers = offersOf(engine);
    engines.set(loaded.label, entry);
    active = loaded.label;
    status(line, `Loaded ${loaded.label}: version ${loaded.version}.`);
    render();
  } catch (error) {
    console.error(error);
    const unresolved = /resolve module specifier/i.test(String(error?.message));
    status(line, unresolved ? `${describe(error)}: reload the page and load it again (this browser takes one import map only)` : describe(error), true);
  }
}

/**
 * The CI build of `ref`, installed by the server (refs.mjs), with its dependencies' names added to the page's import
 * map under its own scope. A page holds the import map it started with only in browsers that merge several (Chrome
 * 133 on); elsewhere, reloading the page brings the scope in from the server.
 */
async function refBuild(ref) {
  const res = await fetch(`/ref-build?ref=${encodeURIComponent(ref)}`);
  if (!res.ok) throw new Error(await res.text());
  const info = await res.json();
  const known = [...document.querySelectorAll('script[type="importmap"]')].some((s) => s.textContent.includes(info.prefix));
  if (!known) {
    const script = Object.assign(document.createElement("script"), { type: "importmap" });
    script.textContent = JSON.stringify({ scopes: { [info.prefix]: info.imports } });
    document.head.append(script);
  }
  if (!info.verified) console.warn(`${info.label}: the artifact has no digest to check it against`);
  return info;
}

function offersOf(engine) {
  const offers = {};
  for (const task of ["stt", "tts"]) {
    try {
      offers[task] = engine.offers(task);
    } catch (error) {
      offers[task] = { error: String(error?.message ?? error) };
    }
  }
  return offers;
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
    paragraph("Package sha256: ", code(current.loaded.sha256)),
    ...(current.offers ? [offersTable(current.offers)] : []),
  );
  renderModels(current);
  renderRuns(current);
}

// --- Models: what models() says, and install / uninstall / load / unload by hand.

function renderModels(current) {
  const catalog = current.catalog ?? [];
  $("#models-table").replaceChildren(catalog.length ? modelsTable(catalog) : paragraph("This engine has no models() to list."));
  keepSelection($("#models-pick"), () => catalog.map((m) => new Option(`${m.id}${m.installed ? " (installed)" : ""}`, m.id)));
  renderBuilds(current);
  fillBuilds("#tts-model", catalog, "tts");
  fillBuilds("#stt-model", catalog, "stt");
  renderVoices(current);
}

function renderBuilds(current) {
  const model = (current.catalog ?? []).find((m) => m.id === $("#models-pick").value);
  keepSelection($("#models-build"), () => (model ? model.builds.map((b) => buildOption(model, b)) : []));
}

function modelsTable(catalog) {
  const table = document.createElement("table");
  table.innerHTML =
    "<tr><th>Model</th><th>Does</th><th>Params</th><th>Build</th><th>Precision</th><th>Download</th><th>Memory</th><th>Runs here</th><th>Installed</th></tr>";
  for (const model of catalog) {
    for (const build of model.builds) {
      const recommended = build.id === model.recommendedBuild ? " ★" : "";
      table.append(
        row(
          model.id,
          model.capabilities.join(", "),
          `${model.parametersM} M`,
          `${build.id}${recommended}`,
          `${build.precision}${build.accelerator ? ` · ${build.accelerator}` : ""}`,
          megabytes(build.downloadBytes),
          `${build.memoryMb} MB`,
          build.available ? "yes" : `no: ${reasons(build)}`,
          build.installed ? "yes" : "",
        ),
      );
    }
  }
  return table;
}

function buildOption(model, build) {
  const marks = [build.id === model.recommendedBuild && "recommended", build.installed && "installed"].filter(Boolean);
  const text = `${build.id} · ${build.precision} · ${megabytes(build.downloadBytes)}${marks.length ? ` (${marks.join(", ")})` : ""}`;
  const option = new Option(build.available ? text : `${text} — does not run here: ${reasons(build)}`, build.id);
  option.disabled = !build.available;
  return option;
}

/** Every build of every model that does `task`, as `model|build` options; those that do not run here disabled. */
function fillBuilds(selector, catalog, task) {
  keepSelection($(selector), () =>
    catalog
      .filter((m) => m.capabilities.includes(task))
      .flatMap((m) => m.builds.map((b) => Object.assign(buildOption(m, b), { value: `${m.id}|${b.id}` })))
      .sort((a, b) => a.disabled - b.disabled),
  );
}

function renderVoices(current) {
  const [modelId] = $("#tts-model").value.split("|");
  const model = (current.catalog ?? []).find((m) => m.id === modelId);
  const voices = model?.voices.length ? model.voices : current.voices.get(modelId) ?? [];
  keepSelection($("#tts-voice"), () =>
    voices.map((v) => new Option(`${v.id} (${[...v.languages, v.gender].filter(Boolean).join(", ")})`, v.id)),
  );
  fillLanguage(model, voices);
}

function fillLanguage(model, voices) {
  const voice = voices.find((v) => v.id === $("#tts-voice").value);
  $("#tts-language").value = voice?.languages[0] ?? model?.languages[0] ?? "";
}

/** Refills `select` with `options()`, keeping what was chosen when it is still there. */
function keepSelection(select, options) {
  const chosen = select.value;
  select.replaceChildren(...options());
  const keep = [...select.options].find((o) => o.value === chosen && !o.disabled);
  const first = [...select.options].find((o) => !o.disabled);
  if (keep ?? first) select.value = (keep ?? first).value;
}

async function refreshCatalog(current) {
  if (!current?.catalog) return;
  current.catalog = await current.engine.models();
  if (engines.get(active) === current) renderModels(current);
}

// --- Running: one operation at a time, with progress, a Cancel button, and the engine's error codes.

const RUNS = ["models-install", "models-uninstall", "models-load", "models-free", "tts-run", "stt-run", "roundtrip-run"];

function renderRuns(current) {
  const usable = Boolean(current?.catalog) && !busy;
  for (const id of RUNS) $(`#${id}`).disabled = !usable;
  if (current && !current.catalog && !busy) {
    const why = `Not wired: this engine's WebEngine exposes ${current.methods.join(", ")}, not the model interface (models, install, load).`;
    for (const id of ["models", "tts", "stt", "roundtrip"]) status($(`#${id} .run-status`), why);
  }
}

async function run(panel, work) {
  const current = engines.get(active);
  if (!current?.catalog || busy) return;
  const section = $(`#${panel}`);
  const line = section.querySelector(".run-status");
  const cancel = section.querySelector(".cancel");
  const controller = new AbortController();
  cancel.onclick = () => controller.abort();
  cancel.disabled = false;
  busy = true;
  renderRuns(current);
  const context = {
    current,
    signal: controller.signal,
    say: (text) => status(line, text),
    onProgress: (progress) => status(line, progressText(progress)),
  };
  try {
    await work(context);
  } catch (error) {
    console.error(error);
    status(line, describe(error), true);
  } finally {
    cancel.disabled = true;
    busy = false;
    renderRuns(current);
    await refreshCatalog(current).catch((error) => console.warn("models() failed", error));
  }
}

/** The loaded model for `key` (`model|build`), loading it (and installing it first if need be) when it is not. */
async function loadedModel({ current, signal, say, onProgress }, key) {
  if (current.memory.has(key)) return current.memory.get(key);
  const [model, build] = key.split("|");
  say(`Loading ${build}…`);
  const start = performance.now();
  const loaded = await current.engine.load(model, build, onProgress, signal);
  current.memory.set(key, loaded);
  say(`Loaded ${build} in ${seconds(start)}.`);
  return loaded;
}

function freeModel(current, model) {
  for (const [key, loaded] of current.memory) {
    if (model && !key.startsWith(`${model}|`)) continue;
    loaded.free();
    current.memory.delete(key);
  }
}

async function speak(context) {
  const key = $("#tts-model").value;
  if (!key) throw new Error("Pick a text-to-speech model.");
  const tts = (await loadedModel(context, key)).asTts();
  try {
    // Some models list no voices in the catalogue: the loaded model says which it has.
    if (!$("#tts-voice").value) {
      context.current.voices.set(key.split("|")[0], await tts.voices());
      renderVoices(context.current);
    }
    const language = $("#tts-language").value.trim() || undefined;
    context.say(`Speaking with ${key.split("|")[1]}…`);
    const start = performance.now();
    const audio = await tts.speak($("#tts-text").value, $("#tts-voice").value, language);
    const length = audio.samples.length / audio.sampleRate;
    context.say(`Spoke ${length.toFixed(1)} s at ${audio.sampleRate} Hz in ${seconds(start)}.`);
    return { ...audio, language };
  } finally {
    tts.free();
  }
}

async function transcribe(context, samples, rate, language) {
  const key = $("#stt-model").value;
  if (!key) throw new Error("Pick a speech-to-text model.");
  const stt = (await loadedModel(context, key)).asStt();
  try {
    context.say(`Transcribing with ${key.split("|")[1]}…`);
    const start = performance.now();
    const text = await stt.transcribe(samples, rate, language);
    context.say(`Transcribed ${(samples.length / rate).toFixed(1)} s of audio in ${seconds(start)}.`);
    return text;
  } finally {
    stt.free();
  }
}

function play(selector, samples, rate) {
  const audio = $(selector);
  audio.src = URL.createObjectURL(toWav(samples, rate));
  audio.hidden = false;
  audio.play().catch(() => {});
}

$("#models-pick").onchange = () => renderBuilds(engines.get(active));
$("#tts-model").onchange = () => renderVoices(engines.get(active));
$("#tts-voice").onchange = () => {
  const [modelId] = $("#tts-model").value.split("|");
  const current = engines.get(active);
  const model = current?.catalog?.find((m) => m.id === modelId);
  fillLanguage(model, model?.voices.length ? model.voices : current?.voices.get(modelId) ?? []);
};

$("#models-install").onclick = () =>
  run("models", async ({ current, signal, say, onProgress }) => {
    const [model, build] = [$("#models-pick").value, $("#models-build").value];
    say(`Installing ${build}…`);
    const start = performance.now();
    await current.engine.install(model, build || undefined, onProgress, signal);
    say(`Installed ${build} in ${seconds(start)}.`);
  });

$("#models-uninstall").onclick = () =>
  run("models", async ({ current, say }) => {
    const model = $("#models-pick").value;
    freeModel(current, model);
    await current.engine.uninstall(model);
    say(`Uninstalled ${model}.`);
  });

$("#models-load").onclick = () =>
  run("models", (context) => loadedModel(context, `${$("#models-pick").value}|${$("#models-build").value}`));

$("#models-free").onclick = () =>
  run("models", async ({ current, say }) => {
    const count = current.memory.size;
    freeModel(current);
    say(`Unloaded ${count} model${count === 1 ? "" : "s"}.`);
  });

$("#tts-run").onclick = () =>
  run("tts", async (context) => {
    const audio = await speak(context);
    play("#tts-audio", audio.samples, audio.sampleRate);
  });

$("#stt-run").onclick = () =>
  run("stt", async (context) => {
    if (!clip) throw new Error("Record or upload a clip first.");
    const language = $("#stt-language").value.trim() || undefined;
    $("#stt-text").textContent = await transcribe(context, clip.samples, clip.rate, language);
  });

$("#roundtrip-run").onclick = () =>
  run("roundtrip", async (context) => {
    const said = $("#tts-text").value;
    const audio = await speak(context);
    play("#roundtrip-audio", audio.samples, audio.sampleRate);
    const heard = await transcribe(context, audio.samples, audio.sampleRate, audio.language);
    $("#roundtrip-text").textContent = `said:  ${said}\nheard: ${heard}\nword error rate: ${(wer(said, heard) * 100).toFixed(0)}%`;
    context.say(`Round trip done: ${$("#tts-model").value.split("|")[1]} → ${$("#stt-model").value.split("|")[1]}.`);
  });

// --- Formatting.

/** An engine error rejects with an `Error` whose `code` is stable and whose `params` say more; others as they are. */
function describe(error) {
  if (error?.code === "cancelled") return "Cancelled.";
  if (error?.code) {
    const params = error.params && Object.keys(error.params).length ? ` ${JSON.stringify(error.params)}` : "";
    return `Engine error: ${error.code}${params} (the browser console may say more)`;
  }
  return String(error?.message ?? error);
}

function reasons(build) {
  return (build.reasons ?? [])
    .map((r) => {
      const params = Object.entries(r.params ?? {}).map(([k, v]) => `${k} ${v}`);
      return params.length ? `${r.code} (${params.join(", ")})` : r.code;
    })
    .join("; ");
}

function progressText({ files, done, received, size }) {
  const of = size ? ` of ${megabytes(size)}` : "";
  return `Downloading: ${done}/${files} files done, ${megabytes(received)}${of} received…`;
}

function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

function seconds(start) {
  return `${((performance.now() - start) / 1000).toFixed(1)} s`;
}

/** Word error rate of `heard` against `said`: word edits over the words said, case and punctuation aside. */
function wer(said, heard) {
  const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const [a, b] = [words(said), words(heard)];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(previous[j] + 1, next[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return a.length ? previous[b.length] / a.length : b.length ? 1 : 0;
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
