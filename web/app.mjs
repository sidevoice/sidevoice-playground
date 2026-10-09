// The page: pick an engine, load it (several side by side), then use the active one on a screen per capability.
// Text to speech and speech to text each offer, in cascade, the families that have a model for their task, then that
// family's models; picking a model installs and loads it right there, with progress and a Cancel button, in its
// recommended build unless another is picked under Advanced. The round trip uses what both have loaded.
//
// In the macOS app (src-tauri/) the page also offers the native engine, compiled into the app, through the same
// interface (engine/native.mjs); there, release assets come through the app instead of server.mjs.

import { record, decodeToPcm, toWav } from "./audio.mjs";
import {
  buildChoice,
  buildInfo,
  describeError,
  familiesFor,
  modelLabel,
  preferredBuild,
  progressText,
  wer,
} from "./catalog.mjs";
import { engineAbilities, engineChoices, OTHER } from "./engine/choices.mjs";
import { browserHost } from "./engine/host.mjs";
import { listReleases, loadEngine, loadServedEngine } from "./engine/load.mjs";
import { NATIVE, NATIVE_METHODS, nativeEngine, nativeInfo, tauri } from "./engine/native.mjs";
import { parseSpec } from "./engine/spec.mjs";

const $ = (selector) => document.querySelector(selector);
const CAPABILITIES = ["tts", "stt"];

/** The macOS app's Tauri API, or null in a browser tab. */
const app = tauri();

// The shell supplies the bytes: in the browser, server.mjs's /fetch (github.com sends no CORS headers); in the app,
// its fetch_release_asset command (src-tauri/src/release.rs).
const fetchers = {
  fetchBytes: async (url) => {
    if (app) return new Uint8Array(await app.core.invoke("fetch_release_asset", { url }));
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
 * label → { loaded, engine, abilities, catalog, sections }: `catalog` is what `models()` last said, for an engine
 * with the model interface; `sections` holds, per capability, the family, model and build picked on its screen and, once
 * loaded, the loaded model, its `Tts` or `Stt` handle, the install's controller and (for speech) its voices.
 */
const engines = new Map();
let active = null;
let screen = "tts";
let clip = null; // the recording or upload to transcribe: { samples, rate }
let running = false;
/** What server.mjs says of its local build (`--engine-tarball`), if it has one. */
let localBuild = null;
/** What the app says of its native engine (`nativeInfo`), in the app. */
let native = null;
let choices = [];

function status(element, text, error = false) {
  delete element.dataset.hint;
  element.classList.remove("ok");
  element.textContent = text;
  element.classList.toggle("error", error);
}

/** A status line's advice on what to do next: `text`, or, when there is none, cleared if the line still shows advice. */
function hint(element, text) {
  if (text) {
    status(element, text);
    element.dataset.hint = "1";
  } else if (element.dataset.hint) {
    status(element, "");
  }
}

// --- The engine picker.

async function fillChoices() {
  if (app) {
    $(".subtitle").textContent = "Try an engine by hand: the native one this app was built with, or a web build.";
    try {
      native = await nativeInfo(app);
    } catch (error) {
      console.error("could not ask the app for its native engine", error);
    }
  } else {
    try {
      const res = await fetch("/local-engine.json");
      if (res.ok) localBuild = await res.json();
    } catch (error) {
      console.warn("could not ask for a local build", error);
    }
  }
  renderChoices();
  try {
    renderChoices(await listReleases(fetchers.fetchJson));
  } catch (error) {
    console.warn("could not list releases", error);
  }
}

function renderChoices(releases = []) {
  const select = $("#engine-choice");
  const chosen = select.value;
  choices = engineChoices({ native, local: localBuild, releases });
  select.replaceChildren(...choices.map((choice) => new Option(choice.label, choice.value)));
  select.value = choices.some((choice) => choice.value === chosen) ? chosen : choices[0].value;
  renderHint();
}

function renderHint() {
  const other = $("#engine-choice").value === OTHER;
  $("#engine-other-field").hidden = !other;
  $("#engine-other").required = other;
  $("#engine-hint").textContent = choices.find((choice) => choice.value === $("#engine-choice").value)?.hint ?? "";
}

async function load(input) {
  const line = $("#engine-status");
  if (input === NATIVE) return loadNative(line);
  const wantsLocal = input === "local";
  if (wantsLocal && engines.has(localBuild?.label)) return activate(localBuild.label);
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
      if (app) throw new Error(`${spec.label} is a git ref: its CI build loads in the web playground (npm start), not in the app`);
      status(line, `Fetching the CI build of ${spec.label} (the first time, the server downloads and installs it)…`);
      const info = await refBuild(spec.ref);
      if (engines.has(info.label)) return activate(info.label);
      loaded = await loadServedEngine(info);
    } else loaded = await loadEngine(spec, fetchers);
    const engine = await loaded.module.WebEngine.create(browserHost());
    const methods = Object.getOwnPropertyNames(loaded.module.WebEngine.prototype).filter(
      (name) => name !== "constructor" && name !== "free",
    );
    const abilities = engineAbilities(methods);
    const entry = { loaded, engine, abilities, catalog: [], sections: { tts: {}, stt: {} } };
    if (abilities.usable) entry.catalog = await engine.models();
    engines.set(loaded.label, entry);
    status(line, `Loaded ${loaded.label}, version ${loaded.version}.`);
    activate(loaded.label);
    if (abilities.usable) $("#engine").open = false;
  } catch (error) {
    console.error(error);
    const unresolved = /resolve module specifier/i.test(String(error?.message));
    const why = describeError(error);
    status(line, unresolved ? `${why}: reload the page and load it again (this browser takes one import map only)` : why, true);
  }
}

/**
 * The engine compiled into the app, through the same interface as a web build's (engine/native.mjs). Its "digest"
 * in the list is the engine's commit.
 */
async function loadNative(line) {
  if (!native) return status(line, "The app did not say which native engine it has: see the console.", true);
  if (engines.has(native.label)) return activate(native.label);
  if (native.error) return status(line, `The native engine could not start: ${native.error}`, true);
  status(line, `Loading ${native.label}…`);
  try {
    const engine = nativeEngine(app);
    const loaded = { label: native.label, tag: NATIVE, version: native.version, sha256: native.rev, module: null };
    const entry = { loaded, engine, abilities: engineAbilities(NATIVE_METHODS), catalog: [], sections: { tts: {}, stt: {} } };
    entry.catalog = await engine.models();
    engines.set(loaded.label, entry);
    status(line, `Loaded ${loaded.label}, built into this app. Models are kept in ${native.dataDir}.`);
    activate(loaded.label);
    $("#engine").open = false;
  } catch (error) {
    console.error(error);
    status(line, describeError(error), true);
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

function activate(label) {
  active = label;
  renderEngines();
  renderScreens();
}

function renderEngines() {
  $("#engine-list").replaceChildren(
    ...[...engines.keys()].map((label) => {
      const { loaded } = engines.get(label);
      const radio = Object.assign(document.createElement("input"), { type: "radio", name: "active", checked: label === active });
      radio.onchange = () => activate(label);
      const item = document.createElement("li");
      const row = document.createElement("label");
      row.append(radio, `${label} — version ${loaded.version} `, code(loaded.sha256.slice(0, 12)));
      item.append(row);
      return item;
    }),
  );
  const current = engines.get(active);
  $("#engine-summary").textContent = current ? `${active} · ${current.loaded.version}` : "none loaded";
  status($("#engine-details"), current?.abilities.text ?? "", current ? !current.abilities.usable : false);
}

// --- Screens: text to speech, speech to text, the round trip.

function renderScreens() {
  const current = engines.get(active);
  const usable = Boolean(current?.abilities.usable);
  $("#screens").hidden = !usable;
  for (const button of document.querySelectorAll("#screens button")) {
    button.setAttribute("aria-pressed", String(button.dataset.screen === screen));
  }
  for (const id of ["tts", "stt", "roundtrip"]) $(`#${id}`).hidden = !usable || id !== screen;
  if (!usable) return;
  for (const capability of CAPABILITIES) renderPicker(current, capability);
  renderVoices(current);
  renderRuns(current);
}

for (const button of document.querySelectorAll("#screens button")) {
  button.onclick = () => {
    screen = button.dataset.screen;
    renderScreens();
  };
}

/** A screen's pickers, in cascade from the catalogue: family, then model, then (under Advanced) the build. */
function renderPicker(current, capability) {
  const section = current.sections[capability];
  const root = $(`#${capability}`);
  const families = familiesFor(current.catalog, capability);
  const familySelect = root.querySelector(".family");
  familySelect.replaceChildren(
    new Option(families.length ? "Pick a family…" : "This engine has no such model", ""),
    ...families.map((family) => {
      const option = new Option(`${family.id} (${family.models.length} model${family.models.length === 1 ? "" : "s"})`, family.id);
      option.disabled = !family.models.some(preferredBuild);
      return option;
    }),
  );
  familySelect.value = section.family ?? "";

  const models = families.find((family) => family.id === section.family)?.models ?? [];
  const modelSelect = root.querySelector(".model");
  modelSelect.replaceChildren(
    new Option(section.family ? "Pick a model…" : "Pick a family first", ""),
    ...models.map((model) => {
      const option = new Option(modelLabel(model), model.id);
      option.disabled = !preferredBuild(model);
      return option;
    }),
  );
  modelSelect.value = section.model ?? "";
  modelSelect.disabled = !models.length;

  const model = models.find((m) => m.id === section.model);
  const builds = root.querySelector(".builds");
  builds.replaceChildren(
    builds.querySelector("legend"),
    ...(model?.builds ?? []).map((build) => buildOption(capability, model, build, build.id === section.build)),
  );
  root.querySelector(".advanced").hidden = !model;
  const build = model?.builds.find((b) => b.id === section.build);
  root.querySelector(".build-info").textContent = build ? buildInfo(model, build) : "";
  root.querySelector(".cancel").hidden = !section.controller;
  root.querySelector(".remove").hidden = !model?.installed || Boolean(section.controller);
}

/** One of the model's builds as a radio: those that do not run here disabled, with their reason. */
function buildOption(capability, model, build, checked) {
  const choice = buildChoice(model, build);
  const label = Object.assign(document.createElement("label"), { className: "build-option" });
  label.classList.toggle("unavailable", !choice.available);
  const radio = Object.assign(document.createElement("input"), {
    type: "radio",
    name: `${capability}-build`,
    value: choice.id,
    checked,
    disabled: !choice.available,
  });
  radio.onchange = () => pickerChanged(capability, "build", choice.id);
  const text = document.createElement("span");
  text.append(
    Object.assign(document.createElement("strong"), { textContent: choice.title }),
    Object.assign(document.createElement("small"), { textContent: choice.detail }),
  );
  label.append(radio, text);
  return label;
}

/**
 * A pick on a screen: a family clears the model; a model takes its preferred build (the recommended one when it runs
 * here); a model or a build installs and loads it there.
 */
function pickerChanged(capability, which, value) {
  const current = engines.get(active);
  const section = current.sections[capability];
  const root = $(`#${capability}`);
  if (which === "family") {
    section.family = root.querySelector(".family").value || null;
    section.model = section.build = null;
  } else if (which === "model") {
    section.model = root.querySelector(".model").value || null;
    const model = current.catalog.find((m) => m.id === section.model);
    section.build = model ? preferredBuild(model)?.id ?? null : null;
  } else {
    section.build = value;
  }
  if (section.model && section.build) return loadSection(current, capability);
  section.controller?.abort();
  section.controller = null;
  unloadSection(current, capability);
  status(root.querySelector(".model-status"), "");
  renderScreens();
}

for (const capability of CAPABILITIES) {
  const root = $(`#${capability}`);
  root.querySelector(".family").onchange = () => pickerChanged(capability, "family");
  root.querySelector(".model").onchange = () => pickerChanged(capability, "model");
  root.querySelector(".cancel").onclick = () => engines.get(active)?.sections[capability].controller?.abort();
  root.querySelector(".remove").onclick = () => removeDownload(engines.get(active), capability);
}

/** Installs (if need be) and loads the section's pick, in place of what the section had loaded. */
async function loadSection(current, capability) {
  const section = current.sections[capability];
  const root = $(`#${capability}`);
  const line = root.querySelector(".model-status");
  const bar = root.querySelector(".progress");
  section.controller?.abort();
  unloadSection(current, capability);
  const controller = new AbortController();
  section.controller = controller;
  const { model, build } = section;
  renderScreens();
  const installed = current.catalog.find((m) => m.id === model)?.builds.find((b) => b.id === build)?.installed;
  status(line, installed ? `Loading ${build}…` : `Installing ${build}…`);
  bar.removeAttribute("value");
  bar.hidden = false;
  const onProgress = (progress) => {
    status(line, progressText(progress));
    if (progress.size) {
      bar.max = progress.size;
      bar.value = Math.min(progress.received, progress.size);
    }
  };
  const start = performance.now();
  try {
    const loaded = await current.engine.load(model, build, onProgress, controller.signal);
    if (section.controller !== controller) return loaded.free(); // something else was picked meanwhile
    section.loaded = loaded;
    section.handle = capability === "tts" ? loaded.asTts() : loaded.asStt();
    if (capability === "tts") section.voices = await section.handle.voices();
    status(line, `Ready: ${build}, loaded in ${seconds(start)}.`);
    line.classList.add("ok");
  } catch (error) {
    if (section.controller === controller) {
      console.error(error);
      status(line, describeError(error), error?.code !== "cancelled");
    }
  } finally {
    if (section.controller === controller) {
      section.controller = null;
      bar.hidden = true;
    }
    await refreshCatalog(current);
  }
}

function unloadSection(current, capability) {
  const section = current.sections[capability];
  section.handle?.free();
  section.loaded?.free();
  section.handle = section.loaded = section.voices = null;
  $(`#${capability} .model-status`).classList.remove("ok");
}

async function removeDownload(current, capability) {
  const section = current.sections[capability];
  const line = $(`#${capability} .model-status`);
  const model = section.model;
  unloadSection(current, capability);
  section.model = section.build = null;
  try {
    await current.engine.uninstall(model);
    status(line, `Removed ${model}'s download. Pick it again to install it.`);
  } catch (error) {
    status(line, describeError(error), true);
  }
  await refreshCatalog(current);
}

async function refreshCatalog(current) {
  try {
    current.catalog = await current.engine.models();
  } catch (error) {
    console.warn("models() failed", error);
  }
  if (engines.get(active) === current) renderScreens();
}

/** The voices the loaded model says it has (`tts.voices()`); none until a model is loaded. */
function renderVoices(current) {
  const voices = current.sections.tts.voices ?? [];
  const select = $("#tts-voice");
  const chosen = select.value;
  select.replaceChildren(
    ...(voices.length
      ? voices.map((v) => new Option(`${v.id} · ${[...v.languages, v.gender].filter(Boolean).join(", ")}`, v.id))
      : [new Option(current.sections.tts.model ? "Loading the model…" : "Pick a model first", "")]),
  );
  select.disabled = !voices.length;
  if (voices.some((v) => v.id === chosen)) select.value = chosen;
  if (select.value !== chosen) fillLanguage(current);
}

/** The language follows the voice: its first, else the model's first. */
function fillLanguage(current) {
  const section = current.sections.tts;
  const model = current.catalog.find((m) => m.id === section.model);
  const voice = (section.voices ?? []).find((v) => v.id === $("#tts-voice").value);
  $("#tts-language").value = voice?.languages[0] ?? model?.languages[0] ?? "";
}

$("#tts-voice").onchange = () => fillLanguage(engines.get(active));
$("#tts-speed").oninput = () => ($("#tts-speed-value").value = `${Number($("#tts-speed").value).toFixed(1)}×`);

// --- Speaking, transcribing, and the round trip.

function renderRuns(current) {
  const { tts, stt } = current.sections;
  $("#tts-run").disabled = running || !tts.handle;
  $("#stt-run").disabled = running || !stt.handle || !clip;
  $("#roundtrip-run").disabled = running || !tts.handle || !stt.handle;
  if (running) return;
  const missing = [!tts.handle && "a text-to-speech model", !stt.handle && "a speech-to-text model"].filter(Boolean);
  const pick = "Pick a model above: it installs and loads here.";
  hint($("#tts .run-status"), tts.handle ? null : pick);
  hint($("#stt .run-status"), !stt.handle ? pick : clip ? null : "Record or upload a clip.");
  hint($("#roundtrip .run-status"), missing.length ? `Load ${missing.join(" and ")} on its screen first.` : null);
}

async function run(id, work) {
  const current = engines.get(active);
  const line = $(`#${id} .run-status`);
  running = true;
  renderRuns(current);
  try {
    await work(current, (text) => status(line, text));
  } catch (error) {
    console.error(error);
    status(line, describeError(error), true);
  } finally {
    running = false;
    renderRuns(current);
  }
}

async function speak(current, say) {
  const { handle, build } = current.sections.tts;
  const language = $("#tts-language").value.trim() || undefined;
  const speed = Number($("#tts-speed").value);
  say(`Speaking with ${build}…`);
  const start = performance.now();
  const audio = await handle.speak($("#tts-text").value, $("#tts-voice").value, language, speed);
  const length = audio.samples.length / audio.sampleRate;
  say(`Spoke ${length.toFixed(1)} s at ${audio.sampleRate} Hz in ${seconds(start)}.`);
  return { ...audio, language };
}

async function transcribe(current, say, samples, rate, language) {
  const { handle, build } = current.sections.stt;
  say(`Transcribing with ${build}…`);
  const start = performance.now();
  const text = await handle.transcribe(samples, rate, language);
  say(`Transcribed ${(samples.length / rate).toFixed(1)} s of audio in ${seconds(start)}.`);
  return text;
}

function play(selector, samples, rate) {
  const audio = $(selector);
  audio.src = URL.createObjectURL(toWav(samples, rate));
  audio.hidden = false;
  audio.play().catch(() => {});
}

function show(selector, text) {
  const element = $(selector);
  element.textContent = text;
  element.hidden = false;
}

$("#tts-run").onclick = () =>
  run("tts", async (current, say) => {
    const audio = await speak(current, say);
    play("#tts-audio", audio.samples, audio.sampleRate);
  });

$("#stt-run").onclick = () =>
  run("stt", async (current, say) => {
    const language = $("#stt-language").value.trim() || undefined;
    show("#stt-text", await transcribe(current, say, clip.samples, clip.rate, language));
  });

$("#roundtrip-run").onclick = () =>
  run("roundtrip", async (current, say) => {
    const said = $("#tts-text").value;
    const audio = await speak(current, say);
    play("#roundtrip-audio", audio.samples, audio.sampleRate);
    const heard = await transcribe(current, say, audio.samples, audio.sampleRate, audio.language);
    show("#roundtrip-text", `Said: ${said}\nHeard: ${heard}\nWord error rate: ${(wer(said, heard) * 100).toFixed(0)}%`);
    say(`Done: ${current.sections.tts.build} → ${current.sections.stt.build}.`);
  });

// --- Recording and uploads.

function showClip(next) {
  clip = next;
  const audio = $("#stt-audio");
  audio.src = URL.createObjectURL(toWav(clip.samples, clip.rate));
  audio.hidden = false;
  status($("#stt .run-status"), `Clip ready: ${(clip.samples.length / clip.rate).toFixed(1)} s.`);
  const current = engines.get(active);
  if (current?.abilities.usable) renderRuns(current);
}

let recording = null;
$("#stt-record").onclick = async () => {
  const button = $("#stt-record");
  const idle = () => {
    recording = null;
    button.textContent = "Record";
    button.setAttribute("aria-pressed", "false");
  };
  try {
    if (!recording) {
      recording = await record();
      button.textContent = "Stop recording";
      button.setAttribute("aria-pressed", "true");
    } else {
      const stopping = recording;
      idle();
      showClip(await stopping.stop());
    }
  } catch (error) {
    idle();
    status($("#stt .run-status"), String(error?.message ?? error), true);
  }
};

$("#stt-file").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    showClip(await decodeToPcm(await file.arrayBuffer()));
  } catch (error) {
    status($("#stt .run-status"), `Could not read ${file.name}: ${error?.message ?? error}`, true);
  }
};

// --- Small things.

function seconds(start) {
  return `${((performance.now() - start) / 1000).toFixed(1)} s`;
}

function code(text) {
  return Object.assign(document.createElement("code"), { textContent: text });
}

$("#engine-choice").onchange = renderHint;
$("#engine-form").onsubmit = (event) => {
  event.preventDefault();
  const value = $("#engine-choice").value;
  load(value === OTHER ? $("#engine-other").value.trim() : value);
};

fillChoices();
