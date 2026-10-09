// The page: pick an engine, load it (several side by side), then use the active one on a screen per capability.
// Text to speech and speech to text each offer, in cascade, the families that have a model for their task, then that
// family's models; picking a model installs and loads it right there, with progress and a Cancel button, in its
// recommended build unless another is picked under Advanced. The round trip uses what both have loaded.
//
// In the macOS app (src-tauri/) any engine commit picked can also run natively: built on this Mac and run as a child
// process, through the same interface (engine/native.mjs). There, the lists come from GitHub's API directly and
// release assets through the app, as there is no server.mjs.

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
import { engineAbilities, engineChoices, KINDS } from "./engine/choices.mjs";
import { browserHost } from "./engine/host.mjs";
import { commitOf, listEngineBuilds, publicApi } from "./engine/listing.mjs";
import { loadEngine, loadServedEngine } from "./engine/load.mjs";
import { NATIVE, NATIVE_METHODS, nativeEngine, onNativeExit, prepareNative, tauri } from "./engine/native.mjs";
import { parseSpec } from "./engine/spec.mjs";
import { connectorSection } from "./connector.mjs";
import { voiceSection } from "./voice.mjs";

const $ = (selector) => document.querySelector(selector);
const CAPABILITIES = ["tts", "stt"];

/** The macOS app's Tauri API, or null in a browser tab. */
const app = tauri();
/** GitHub's API as the page reaches it with no token, for the app, which has no server to list builds. */
const github = publicApi();

// In the app, which has no server, a release's web build is imported from memory (engine/load.mjs): its bytes come
// through the app's fetch_release_asset command (src-tauri/src/release.rs), as github.com sends no CORS headers.
const fetchers = {
  fetchBytes: async (url) => new Uint8Array(await app.core.invoke("fetch_release_asset", { url })),
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
/** What there is to pick (engine/listing.mjs): `releases`, `latest`, `pulls`, `branches`; from server.mjs in a browser. */
let listed = {};
/** Each dropdown's choices (`engineChoices`). */
let choices = {};

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

async function fillChoices({ fresh = false } = {}) {
  if (!app && !localBuild) {
    try {
      const res = await fetch("/local-engine.json");
      if (res.ok) localBuild = await res.json();
    } catch (error) {
      console.warn("could not ask for a local build", error);
    }
  }
  renderChoices();
  const line = $("#engine-hint");
  status(line, "Listing releases, pull requests and branches…");
  $("#engine-refresh").disabled = true;
  try {
    if (app) listed = await listEngineBuilds(github);
    else {
      const res = await fetch(`/engine-builds${fresh ? "?fresh=1" : ""}`);
      if (!res.ok) throw new Error(await res.text());
      listed = await res.json();
    }
    const errors = listed.errors ?? [];
    status(line, errors.length ? `Some lists are incomplete: ${errors.join("; ")}` : `Listed at ${listed.listed.slice(11, 16)} UTC.`, errors.length > 0);
  } catch (error) {
    console.warn("could not list engine builds", error);
    status(line, `Could not list engine builds: ${error.message}`, true);
  } finally {
    $("#engine-refresh").disabled = false;
  }
  renderChoices();
}

/** Each dropdown from what is listed, keeping what was picked in it when it is still there. */
function renderChoices() {
  choices = engineChoices({ local: localBuild, ...listed });
  for (const kind of KINDS) {
    const select = $(`#engine-${kind}`);
    const chosen = select.value;
    const list = choices[kind];
    const empty = { pull: "No open pull requests", branch: "No branches" }[kind];
    select.replaceChildren(
      ...(list === undefined
        ? [new Option("Listing…", "")]
        : list.length
          ? list.map((choice) => Object.assign(new Option(choice.label, choice.value), { disabled: choice.state === "none" && kind === "version" }))
          : [new Option(empty, "")]),
    );
    if (list?.some((choice) => choice.value === chosen)) select.value = chosen;
    select.disabled = !list?.length;
    select.form.querySelector("button").disabled = !list?.length || serverOnly(kind);
    renderDetail(kind);
  }
}

/** Whether a kind's web builds load only through server.mjs, which the app does not run: pull requests and branches. */
function serverOnly(kind) {
  return Boolean(app) && kind !== "version" && $("#engine-runtime").value !== NATIVE;
}

function renderDetail(kind) {
  const detail = $(`#engine-${kind}-detail`);
  const choice = choices[kind]?.find((c) => c.value === $(`#engine-${kind}`).value);
  const note = serverOnly(kind) ? " Its web build loads in the web playground only: run it natively here." : "";
  detail.textContent = choice ? `${choice.detail}${note}` : "";
  if (choice?.state) detail.dataset.state = choice.state;
  else delete detail.dataset.state;
}

async function load(input, choice) {
  if (app && $("#engine-runtime").value === NATIVE) return loadNative(input, choice);
  const line = $("#engine-status");
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
      if (app) throw new Error(`${spec.label}'s web build is fetched by the web playground's server: run it natively here (Run: native)`);
      status(line, `Fetching the CI build of ${spec.label} (the first time, the server downloads and installs it)…`);
      const info = await servedBuild(`/ref-build?ref=${encodeURIComponent(spec.ref)}`);
      if (engines.has(info.label)) return activate(info.label);
      loaded = await loadServedEngine(info);
    } else if (app) loaded = await loadEngine(spec, fetchers);
    else {
      status(line, `Fetching ${spec.label} from GitHub Releases (the first time, the server downloads, checks and installs it)…`);
      const info = await servedBuild(`/release-build?name=${encodeURIComponent(input)}`);
      if (engines.has(info.label)) return activate(info.label);
      loaded = await loadServedEngine(info);
    }
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
 * The native engine at the engine commit `choice` names, in the macOS app: built on this Mac the first time (its
 * output in the build log, Cancel killing it), then run as a child process and reached through the same interface as
 * a web build's (engine/native.mjs). Its "digest" in the list is the engine's commit.
 */
async function loadNative(input, choice) {
  const line = $("#engine-status");
  const controller = new AbortController();
  const log = $("#engine-build-log");
  try {
    const { name, sha } = await nativeCommit(input, choice);
    const label = `native ${name} @ ${sha.slice(0, 7)}`;
    if (engines.has(label)) return activate(label);
    status(line, `Preparing ${label}: the first time, the native runner is built on this Mac (minutes); then it is kept.`);
    log.textContent = "";
    $("#engine-build").hidden = false;
    $("#engine-cancel").hidden = false;
    $("#engine-cancel").onclick = () => controller.abort();
    const hello = await prepareNative(app, sha, { onLine: (text) => appendLog(log, text), signal: controller.signal });
    const engine = nativeEngine(app, sha);
    const loaded = { label, tag: NATIVE, version: hello.engine, sha256: sha, module: null };
    const entry = { loaded, engine, abilities: engineAbilities(NATIVE_METHODS), catalog: [], sections: { tts: {}, stt: {} }, sha };
    entry.catalog = await engine.models();
    engines.set(label, entry);
    status(line, `Loaded ${label}, version ${hello.engine}, running on this Mac. Models are kept in ${hello.dataDir}.`);
    activate(label);
    $("#engine").open = false;
  } catch (error) {
    console.error(error);
    const runner = typeof error?.code === "string" && error.code.startsWith("runner-");
    status(line, runner ? `${error.message} (the build log below says more)` : describeError(error), error?.code !== "cancelled");
  } finally {
    $("#engine-cancel").hidden = true;
  }
}

/** The engine commit a choice names, and what to call it: a listed pull request or branch carries it. */
async function nativeCommit(input, choice) {
  const spec = parseSpec(input);
  if (choice?.sha) return { name: spec.label, sha: choice.sha };
  if (spec.kind === "latest") {
    const tag = listed.latest?.tag;
    if (!tag) throw new Error("No release is published yet.");
    return { name: `latest (${tag})`, sha: await commitOf(github, tag) };
  }
  return { name: spec.label, sha: await commitOf(github, spec.kind === "ref" ? spec.ref : spec.tag) };
}

/** A line of the build's output at the end of the log, which keeps its last lines only. */
function appendLog(log, text) {
  const lines = `${log.textContent}${text}\n`.split("\n");
  log.textContent = lines.slice(-400).join("\n");
  log.scrollTop = log.scrollHeight;
}

/** A native engine whose runner exited on its own (a crash in the engine, say) is dropped, and the page says why. */
function nativeExited({ sha, message }) {
  for (const [label, entry] of engines) {
    if (entry.sha !== sha) continue;
    engines.delete(label);
    if (active === label) active = null;
    status($("#engine-status"), `${label} stopped: ${message}. Load it again to start it again.`, true);
    $("#engine").open = true;
  }
  renderEngines();
  renderScreens();
}

/**
 * A build the server installs and describes at `path` (`/ref-build`, refs.mjs; `/release-build`, release-builds.mjs),
 * with its dependencies' names added to the page's import map under its own scope. A page holds the import map it
 * started with only in browsers that merge several (Chrome 133 on); elsewhere, reloading the page brings the scope in
 * from the server.
 */
async function servedBuild(path) {
  const res = await fetch(path);
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

for (const kind of KINDS) {
  $(`#engine-${kind}`).onchange = () => renderDetail(kind);
  $(`#engine-${kind}-form`).onsubmit = (event) => {
    event.preventDefault();
    const value = $(`#engine-${kind}`).value;
    if (value) load(value, choices[kind]?.find((choice) => choice.value === value));
  };
}
$("#engine-refresh").onclick = () => fillChoices({ fresh: true });
if (app) {
  $(".subtitle").textContent = "Try Sidevoice's parts by hand: an engine build (its web build, or its native build, built on this Mac) and the connector's bench. The voice module loads in the web playground.";
  $("#engine-runtime-field").hidden = false;
  $("#engine-runtime").onchange = renderChoices;
  onNativeExit(app, nativeExited);
}

fillChoices();

// --- The sections: Engine above, Voice (voice.mjs) and Connector (connector.mjs).

const sections = {
  voice: voiceSection({ currentEngine: () => engines.get(active) ?? null, servedBuild, inApp: Boolean(app) }),
  connector: connectorSection({ inApp: Boolean(app) }),
};
for (const button of document.querySelectorAll("#sections button")) {
  button.onclick = () => {
    const shown = button.dataset.section;
    for (const other of document.querySelectorAll("#sections button")) {
      other.setAttribute("aria-pressed", String(other === button));
      $(`#section-${other.dataset.section}`).hidden = other !== button;
    }
    sections[shown]?.show();
  };
}
