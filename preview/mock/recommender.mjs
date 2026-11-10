// The model recommender design sheet's page (recommender.html): Transcripción and Voz, in Settings and in the first-run
// setup, as the app draws them (the classes of recommender-web.css, copied from sidevoice-web: Select, Badge, Row and
// Group, the model block with its Advanced and spec sheet, the setup's dialog), with the recommendation on them: the
// recommended model is the one selected, and the app's own «Recomendado» tag marks it: at the end of Modelo's label row
// while it is the one selected (the Field's aside), and on its entry in the open list; the recommended family's entry in
// the open Familia list. Nothing else is said about it. EXAMPLE devices and data (recommender-data.mjs); the rules are
// recommender-logic.mjs. The controls work: pick a family or a model, open "Avanzado", press Descargar.
//
// A model that does not run here is left out of the lists, as the app does today (ModelPickers: only models that run,
// and the one in use); its reason is the app's «No funciona aquí: …», in "Avanzado" for the builds of the model shown.
//
//   ?device=mac|windows|iphone   the example device (default mac)
//   ?lang=es|it                  the person's language (default es)
//   ?theme=light|dark            the frames' theme (default light)
//   ?open=closed|model|family    which list every screen has open (default closed, as the app loads)
import { CATALOGUE_SOURCE, COPY, DEVICES, DEVICE_IDS, LANGUAGES, TASKS } from "./recommender-data.mjs";
import { budgetMb, evaluate, familyName, languagePrimary, languageSupported, orderLanguages } from "./recommender-logic.mjs";
import { buildSizes, describeBuild, engineOf, fmt, hardware, languageName, mb } from "./recommender-format.mjs";

const root = document.getElementById("sheet");
const query = new URLSearchParams(location.search);
const one = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const state = {
  device: one(query.get("device"), DEVICE_IDS, "mac"),
  language: one(query.get("lang"), Object.keys(LANGUAGES), "es"),
  theme: one(query.get("theme"), ["light", "dark"], "light"),
  lists: one(query.get("open"), ["closed", "model", "family"], "closed"),
  /** The screens' own state, by frame key: what was picked, what is open, what is on disk. Reset with the device or language. */
  frames: {},
};
let timer = null;

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const t = (key, params) => fmt(COPY[key], params);

const hardwareText = (label) => `${esc(label.main)}${label.name ? `<span class="model-hardware-name"> · ${esc(label.name)}</span>` : ""}`;
const reasonText = (code) => COPY[`voice.unfit.${code}`];
/** A message with a {reasons} slot, the slot filled with the reasons, the rest escaped. */
const withReasons = (key, codes) => { const [before, after] = COPY[key].split("{reasons}"); return esc(before) + codes.map((code) => esc(reasonText(code))).join("; ") + esc(after); };

// ----- the app's small components, as markup -----

const ICON = {
  chevron: '<path d="m6 9 6 6 6-6"/>', back: '<path d="m15 18-6-6 6-6"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  alert: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.4v5.4M12 16.6h.01"/>',
};
const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const mark = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="1.5" y="9" width="3" height="6" rx="1.5"/><rect x="6" y="6" width="3" height="12" rx="1.5"/><rect x="10.5" y="1.5" width="3" height="21" rx="1.5"/><rect x="15" y="6" width="3" height="12" rx="1.5" style="fill:var(--sv-voice)"/><rect x="19.5" y="9" width="3" height="6" rx="1.5"/></svg>`;

const badge = (text, tone = "neutral", dot = false, tag = false) => `<span class="ui-badge" data-tone="${tone}"${tag ? " data-tag" : ""}>${dot ? '<span class="ui-badge-dot" aria-hidden="true"></span>' : ""}${text}</span>`;
/** The app's «Recomendado» tag (runtime.recommended): the one way the recommendation is said, in one single variant (the Badge's
 *  compact `tag`, with its quiet border) in every place it is: Modelo's label row, the model list, the family list. "Avanzado" keeps
 *  its own plain badge (not this sheet's to change). */
const recommended = () => badge(esc(COPY["runtime.recommended"]), "accent", false, true);
const button = ({ label, variant = "secondary", tone, size, id, act, extra = "", disabled = false, cls = "" }) =>
  `<button type="button" class="ui-button ui-button--${variant}${tone ? ` ui-button--${tone}` : ""}${size ? ` ui-button--${size}` : " ui-button--md"}${cls ? ` ${cls}` : ""}"${act ? ` data-act="${act}"` : ""}${id ? ` data-key="${id}"` : ""}${extra}${disabled ? " disabled" : ""}><span class="ui-button-content">${label}</span></button>`;
const row = ({ label, control = "", block = false }) =>
  `<div class="ui-row${block ? " ui-row--block" : ""}"><div class="ui-row-text"><span class="ui-row-label">${esc(label)}</span></div><div class="ui-row-control">${control}</div></div>`;
/** The app's Field: its label, and at the label's end an `aside` (a node), then the control. */
const field = (label, control, aside = "") => `<div class="ui-field"><div class="ui-field-head"><span class="ui-field-label">${esc(label)}</span>${aside ? `<span class="ui-field-aside">${aside}</span>` : ""}</div><div class="ui-field-control">${control}</div></div>`;

/**
 * The Select as the app draws it: its box, and its list when open, floating under the box. `items`: options.
 */
function select({ frame, which, label, value, items, open, disabled }) {
  const chosen = items.find((option) => option.value === value);
  const itemHtml = (option) => {
    const checked = option.value === value;
    return `<div class="ui-select-item" role="option" aria-selected="${checked}" tabindex="0" data-state="${checked ? "checked" : "unchecked"}"${checked ? ' data-highlighted=""' : ""} data-act="pick-${which}" data-frame="${frame}" data-value="${esc(option.value)}">
<span class="ui-select-item-text"><span>${esc(option.label)}</span>${option.description ? `<span class="ui-select-item-description">${option.description}</span>` : ""}${option.soft ? `<span class="ui-select-item-reason" data-soft>${option.soft}</span>` : ""}</span>
${option.badge ? `<span class="ui-select-item-badge">${option.badge}</span>` : ""}<span class="ui-select-item-check">${checked ? icon("check", 16) : ""}</span></div>`;
  };
  const list = open ? `<div class="ui-select-content" data-size="md" data-which="${which}" role="listbox" aria-label="${esc(label)}"><div class="ui-select-viewport">${items.map(itemHtml).join("")}</div></div>` : "";
  return `<div class="rec-select"><button type="button" role="combobox" class="ui-select" aria-label="${esc(label)}" aria-expanded="${!!open}" data-state="${open ? "open" : "closed"}" data-act="toggle" data-frame="${frame}" data-which="${which}" data-key="${frame}-${which}"${disabled ? " disabled" : ""}>
<span class="ui-select-value"><span class="ui-select-value-text">${esc(chosen?.label ?? "")}</span></span><span class="ui-select-chevron">${icon("chevron", 16)}</span></button>${list}</div>`;
}

// ----- one screen's model block -----

const frameState = (key) => (state.frames[key] ??= { model: null, build: null, open: undefined, advanced: false, langs: false, installed: {}, download: null });
const openOf = (f, which) => (f.open === undefined ? state.lists === which : f.open === which);

/** A model of the Modelo list as the app lists it: its download size at the end of the name's line, its hardware under it
 *  (model-facts.tsx listedOption); «Recomendado» on the recommended one (the same tag everywhere), before the size at the end of the line; a model that does not speak the language says so quietly under it (the app's «No admite …»), and stays
 *  selectable. */
function modelItem(model, e) {
  const label = hardware(model.best);
  const size = mb(model.best.downloadMb);
  const isRecommended = model.id === e.recommended;
  const sizeHtml = `<span class="model-list-size" aria-hidden="true">${esc(size)}</span>`;
  return {
    value: model.id, label: model.id,
    badge: isRecommended ? `<span class="rec-badges">${recommended()}${sizeHtml}</span>` : sizeHtml,
    description: `<span class="sr-only">${esc(size)} · </span>${label ? hardwareText(label) : ""}`,
    soft: model.soft ? esc(fmt(COPY["voice.languages.unsupported"], { language: languageName(state.language) })) : "",
  };
}

/** The models of a family that run here, in the order of the ranking (those that cannot be recommended after the rest). */
const modelItems = (e, familyId) => e.models.filter((model) => model.family === familyId && model.available).map((model) => modelItem(model, e));

/** The families with a model that runs here, the recommended one first and marked (only the open list shows it). */
const familyItems = (e) => e.families.filter((family) => family.available).map((family) => ({
  value: family.id, label: familyName(family.id), badge: family.recommended ? recommended() : "",
}));

/** What the person has now on this screen: the model (never one that cannot run here), its family, and the build it runs as. */
function selection(e, f) {
  const model = e.byId[f.model && e.byId[f.model]?.available ? f.model : e.recommended];
  const family = e.families.find((each) => each.id === model.family);
  const chosen = f.build ? model.builds.find((build) => build.id === f.build && build.available) : null;
  return { model, family, build: chosen ?? model.best, chosen };
}

function languagesLine(model, f, frame) {
  const ordered = orderLanguages(model.languages, ["es", state.language]);
  const inUse = state.language;
  const named = (tag) => languagePrimary(tag) === languagePrimary(inUse) ? `<strong>${esc(languageName(tag))}</strong>` : esc(languageName(tag));
  const n = ordered.length - 4;
  const more = n > 0 ? ` <span class="rec-pop"><button type="button" class="model-languages-more" data-act="langs" data-frame="${frame}" aria-expanded="${f.langs}">${esc(fmt(n === 1 ? "+{n} idioma más" : COPY["voice.languages.more"], { n }))}</button>${f.langs
    ? `<div class="ui-popover model-languages-popover"><p class="ui-popover-title">${esc(fmt(COPY["voice.languages.title"], { n: ordered.length }))}</p><ul class="model-languages-list">${ordered.map((tag) => `<li>${named(tag)}</li>`).join("")}</ul></div>` : ""}</span>` : "";
  const text = ordered.slice(0, 4).map(named).join(", ") + more;
  const unsupported = languageSupported(model.languages, inUse) ? ""
    : `<div class="model-prepare-notice" aria-live="polite">${icon("alert", 16)}<span>${esc(fmt(COPY["voice.languages.unsupported"], { language: languageName(inUse) }))}</span></div>`;
  return { text, unsupported };
}

/** "Avanzado: cómo se ejecuta": the builds of the model shown, each that does not run here with its «No funciona aquí: …». */
function runtimeBlock(sel, f, frame, locked) {
  const option = (value, title, detail, badges, available = true, why = "") => {
    const checked = value === null ? !sel.chosen : !!sel.chosen && sel.chosen.id === value;
    return `<label class="model-runtime-option"${checked ? ' data-checked=""' : ""}${!available || locked ? ' data-disabled=""' : ""}><input type="radio" name="${frame}-build"${checked ? " checked" : ""}${!available || locked ? " disabled" : ""} data-act="build" data-frame="${frame}" data-value="${value ?? ""}">
<span class="model-runtime-copy"><span class="model-runtime-title">${esc(title)}${badges.join("")}</span><span class="model-runtime-detail">${esc(detail)}</span>${why ? `<span class="model-runtime-why">${why}</span>` : ""}</span></label>`;
  };
  const builds = sel.model.builds.map((build) => option(build.id, describeBuild(build), buildSizes(build),
    [...(build.id === sel.model.best.id ? [badge(esc(COPY["runtime.recommended"]), "accent")] : []), ...(f.installed[build.id] ? [badge(esc(COPY["runtime.onDisk"]), "positive")] : [])],
    build.available, build.available ? "" : withReasons("runtime.notHere", build.reasons)));
  return `<div class="model-runtime"><div class="model-runtime-head"><button type="button" class="model-runtime-toggle" aria-expanded="${f.advanced}" data-act="advanced" data-frame="${frame}" data-key="${frame}-advanced">
<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${f.advanced ? "model-runtime-chevron-open" : ""}">${ICON.chevron}</svg>${esc(COPY["runtime.advanced"])}</button><span class="model-runtime-summary">${esc(engineOf(sel.build))}</span></div>
${f.advanced ? `<div class="model-runtime-panel"><p class="model-runtime-info">${esc(COPY["runtime.info"])}</p><fieldset class="model-runtime-options"><legend class="sr-only">${esc(COPY["runtime.title"])}</legend>
${option(null, COPY["runtime.auto"], `${describeBuild(sel.model.best)} · ${buildSizes(sel.model.best)}`, [])}${builds.join("")}</fieldset>${locked ? `<p class="model-runtime-device">${esc(COPY["voice.prepare.lockedHint"])}</p>` : ""}</div>` : ""}</div>`;
}

function sheet(sel, f, frame) {
  const { text, unsupported } = languagesLine(sel.model, f, frame);
  const label = hardware(sel.build);
  const ready = !!f.installed[sel.build.id];
  const downloading = f.download && f.download.model === sel.build.id;
  const sizes = ready ? [fmt(COPY["voice.prepare.onDevice"], { size: mb(sel.build.downloadMb) }), fmt(COPY["runtime.memory"], { memory: mb(sel.build.memoryMb) })].join(" · ") : buildSizes(sel.build);
  const percent = downloading ? Math.round(f.download.fraction * 100) : 0;
  const state_ = ready ? badge(esc(COPY["voice.prepare.badge.ready"]), "positive", true)
    : downloading ? `<strong data-progress-text="${frame}">${esc(fmt(COPY["voice.prepare.downloadingAt"], { percent }))}</strong>` : badge(esc(COPY["voice.prepare.badge.absent"]));
  const footer = ready ? "" : downloading
    ? `<div class="model-prepare-progress"><div class="model-prepare-progress-line"><span class="model-prepare-note" data-progress-note="${frame}">${esc(fmt(COPY["voice.prepare.progress"], { done: mb(sel.build.downloadMb * f.download.fraction), size: mb(sel.build.downloadMb) }))}</span></div>
<div class="ui-progress" role="progressbar" aria-label="${esc(COPY["voice.prepare.downloading"])}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span class="ui-progress-fill" data-progress-fill="${frame}" style="width:${percent}%"></span></div></div>${button({ label: esc(COPY["voice.prepare.cancel"]), variant: "ghost", tone: "neutral", size: "sm", act: "cancel", extra: ` data-frame="${frame}"` })}`
    : button({ label: `${icon("download", 16)}${esc(COPY["voice.prepare.download"])}`, size: "sm", act: "download", extra: ` data-frame="${frame}"`, id: `${frame}-download` });
  return `<div class="model-prepare-sheet"><dl class="model-sheet">
<dt>${esc(COPY["runtime.fact.languages"])}</dt><dd class="model-sheet-languages"><span>${text}</span>${unsupported}</dd>
${label ? `<dt>${esc(COPY["runtime.fact.runsOn"])}</dt><dd><span class="ui-badge model-hardware" data-tone="accent">${hardwareText(label)}</span></dd>` : ""}
<dt>${esc(COPY["runtime.fact.size"])}</dt><dd class="model-sheet-size">${esc(sizes)}</dd>
<dt>${esc(COPY["runtime.fact.status"])}</dt><dd><div class="model-sheet-state" role="status" aria-live="polite">${state_}</div></dd></dl>
${footer ? `<div class="model-sheet-footer">${footer}</div>` : ""}</div>`;
}

/** The Origen and Modelo rows: what Settings and the setup both show for a slot. */
function slotGroup(task, frame) {
  const e = evals[task];
  const f = frameState(frame);
  const sel = selection(e, f);
  const locked = !!f.download;
  // «Recomendado» at the end of Modelo's label row (the Field's aside) while the model shown is the recommended one.
  const isRecommended = sel.model.id === e.recommended;
  const pickers = field(COPY["voice.family"], select({ frame, which: "family", label: COPY["voice.family"], value: sel.family.id, items: familyItems(e), open: openOf(f, "family"), disabled: locked }))
    + field(COPY["voice.model"], select({ frame, which: "model", label: COPY["voice.model"], value: sel.model.id, items: modelItems(e, sel.family.id), open: openOf(f, "model"), disabled: locked }), isRecommended ? recommended() : "");
  const model = `<div class="model-prepare" data-status="${f.installed[sel.build.id] ? "ready" : f.download ? "downloading" : "absent"}"><div class="model-prepare-pickers">${pickers}</div>
${locked ? `<p class="model-prepare-meta">${esc(COPY["voice.prepare.lockedHint"])}</p>` : ""}
${runtimeBlock(sel, f, frame, locked)}${sheet(sel, f, frame)}</div>`;
  const origin = row({ label: COPY["voice.source"], control: `<button type="button" role="combobox" class="ui-select" aria-label="${esc(COPY["voice.source"])}" aria-expanded="false"><span class="ui-select-value"><span class="ui-select-value-text">${esc(COPY["voice.source.local"])}</span></span><span class="ui-select-chevron">${icon("chevron", 16)}</span></button>` });
  return { html: `<div class="ui-group"><div class="ui-group-card">${origin}${row({ label: COPY["voice.model"], control: model, block: true })}</div></div>`, sel, f };
}

// ----- the two screens -----

const SECTION = { stt: { title: "settings.section.transcription", hint: "settings.transcription.description", wizard: "wizard.title.stt", intro: "wizard.sttIntro", group: "wizard.group.transcription", step: 5 },
  tts: { title: "settings.section.voice", hint: "settings.voice.description", wizard: "wizard.title.tts", intro: "wizard.ttsIntro", group: "wizard.group.voice", step: 6 } };

function settingsFrame(task, width) {
  const { html } = slotGroup(task, `settings-${task}`);
  const s = SECTION[task];
  return `<div class="sheet-window" style="--window:${width}px"><b>Settings · ${esc(t(s.title))}</b><div class="rec-window" data-theme="${state.theme}"${width < 500 ? " data-phone" : ""}><div class="settings-column">
<section class="ui-section"><header class="ui-section-head"><div><h2 class="ui-section-title">${esc(t(s.title))}</h2><p class="ui-section-description">${esc(t(s.hint))}</p></div></header><div class="ui-section-body">${html}</div></section></div></div></div>`;
}

function setupFrame(task, width) {
  const { html, sel, f } = slotGroup(task, `setup-${task}`);
  const s = SECTION[task];
  const ready = !!f.installed[sel.build.id];
  const steps = Array.from({ length: 8 }, (_, index) => `<li data-state="${index + 1 < s.step ? "done" : index + 1 === s.step ? "current" : "next"}"${index + 1 === s.step ? ' aria-current="step"' : ""}></li>`).join("");
  const footer = `${button({ label: `${icon("back", 16)}<span class="wizard-back-label">${esc(t("wizard.back"))}</span>`, variant: "ghost", tone: "neutral", cls: "wizard-back" })}
${ready ? button({ label: esc(t("wizard.continueWithoutTrying")), variant: "ghost", tone: "neutral", cls: "wizard-quiet" }) : button({ label: esc(t("wizard.skip.later")), variant: "ghost", tone: "neutral", cls: "wizard-quiet" })}
${button({ label: esc(t("try.tryIt")), variant: "primary", disabled: !ready })}`;
  return `<div class="sheet-window" style="--window:${width}px"><b>First-run setup · ${esc(t(s.group))}</b><div class="rec-wizard" data-theme="${state.theme}"${width < 500 ? " data-phone" : ""}><div class="wizard-dialog" open data-step="${task === "stt" ? "W4" : "W4v"}">
<header class="wizard-head"><span class="wizard-brand">${mark}${esc(t("wizard.eyebrow"))}</span></header>
<div class="wizard-stepper"><p class="wizard-stepper-label">${esc(fmt(COPY["wizard.stepOf"], { n: s.step, total: 8, group: t(s.group) }))}</p><ol class="wizard-steps" aria-label="${esc(t("wizard.progress"))}">${steps}</ol></div>
<h2 class="wizard-title">${esc(t(s.wizard))}</h2>
<div class="wizard-body"><section class="wizard-stage-step"><p>${esc(t(s.intro))}</p><div class="wizard-stage">${html}</div></section></div>
<footer class="wizard-actions" data-model-step="">${footer}</footer></div></div></div>`;
}

// ----- the sheet's own chrome -----

const bar = (title, choices) => `<span class="bar-group"><b>${title}</b><span class="bar-choice" role="radiogroup" aria-label="${title}">${choices.join("")}</span></span>`;
const choice = (title, value, on, text) => `<button type="button" role="radio" aria-checked="${on}" data-bar="${title}" data-value="${value}" data-key="bar-${title}-${value}">${text}</button>`;

function deviceCard() {
  const d = DEVICES[state.device];
  return `<p class="rec-device"><b>${esc(d.name)}</b> · memory: ${esc(d.memoryNote)}; the voice set may take 60 % = ${esc(mb(budgetMb(d)))}, with the end-of-turn model (${esc(mb(50))}) inside. ${esc(d.facts)}</p>`;
}

function whyTables() {
  const table = (task, name) => {
    const e = evals[task];
    const rows = e.models.map((model, index) => {
      const verdict = !model.available ? `<span class="rec-hard">not in the lists</span> ${esc(model.reasons.map(reasonText).join("; "))}` : model.soft ? `<span class="rec-soft-tag">not recommended</span> no ${esc(languageName(state.language))}` : model.id === e.recommended ? "<b>recommended</b>" : "";
      const best = model.best ? `${esc(describeBuild(model.best))} · ${esc(mb(model.best.memoryMb))}${model.best.comfortable ? "" : " · <i>not comfortable</i>"}` : "";
      return `<tr><td>${index + 1}</td><td><code>${esc(model.id)}</code></td><td>${verdict}</td><td>${best}</td></tr>`;
    }).join("");
    return `<div><h3>${name}</h3><table><thead><tr><th>#</th><th>model</th><th>verdict</th><th>its best build here</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  return `<section class="rec-why-sheet"><h2>Why: the ranking behind the screens · ${esc(DEVICES[state.device].short)}, ${esc(LANGUAGES[state.language])}</h2>
<p>Hard filters, as the app leaves a model out of its lists: engine in this build, GPU builds off where not allowed, fits memory. Soft: the language (selectable, never recommended). Then ORDER BY comfortable, quality (hand-written list), accelerator class, catalogue order; the joint (transcription, voice) pair closest to (1st, 1st) inside the memory budget. EXAMPLE data from ${esc(CATALOGUE_SOURCE)}; devices, budgets and comfort hints are invented.</p>
<div class="rec-why-tables">${table("stt", "Transcripción")}${table("tts", "Voz")}</div></section>`;
}

let evals = {};

function screens() {
  const width = DEVICES[state.device].frame;
  return `<section class="sheet-block"><h2>Settings</h2><p class="why">Settings › Transcripción and Settings › Voz.</p><div class="sheet-windows">${TASKS.map((task) => settingsFrame(task, width)).join("")}</div></section>
<section class="sheet-block"><h2>First-run setup</h2><p class="why">The setup's transcription and voice steps: the same block, nothing downloaded until Descargar.</p><div class="sheet-windows">${TASKS.map((task) => setupFrame(task, width)).join("")}</div></section>`;
}

function draw() {
  evals = Object.fromEntries(TASKS.map((task) => [task, evaluate(task, state.device, state.language)]));
  const focus = document.activeElement?.dataset?.key;
  root.innerHTML = `<header class="sheet-bar"><h1>Model recommender · preview</h1>
${bar("Device", DEVICE_IDS.map((id) => choice("device", id, state.device === id, esc(DEVICES[id].short))))}
${bar("Language", Object.entries(LANGUAGES).map(([id, name]) => choice("language", id, state.language === id, esc(name))))}
${bar("Theme", [choice("theme", "light", state.theme === "light", "Light"), choice("theme", "dark", state.theme === "dark", "Dark")])}
${bar("Open every list", [choice("lists", "closed", state.lists === "closed", "None"), choice("lists", "model", state.lists === "model", "Modelo"), choice("lists", "family", state.lists === "family", "Familia")])}</header>
<div class="sheet-intro"><p>Transcripción and Voz as the app draws them (its own stylesheets and markup, Spanish as in its catalogue), with the model recommender decided on 2026-11-10: the recommended model is the one selected, and the app's «Recomendado» tag marks it: at the end of Modelo's label row while it is the one selected, and on its entry in the open list (the recommended family's too, in the open Familia list). Each family comes with its own best model for the device. A model that does not run here is left out of the lists, as today; one that does not speak the language stays selectable and says so quietly. Pick things: they work.</p>
<p class="rec-example"><b>EXAMPLE devices and data.</b> Models, builds, sizes and languages mirror the engine's catalogue; the devices, their memory, the comfort hints and the ranking they give are invented for this preview, nothing is measured.</p>${deviceCard()}</div>
${screens()}${whyTables()}`;
  if (focus) root.querySelector(`[data-key="${focus}"]`)?.focus();
  history.replaceState(null, "", `?${new URLSearchParams({ device: state.device, lang: state.language, theme: state.theme, open: state.lists })}`);
}

// ----- the controls -----

/** A new device or language is a new world: what was picked on the old one goes. */
const reset = () => { clearInterval(timer); timer = null; state.frames = {}; };

/** Closes every open list, but `except`'s own (a list closes when another thing is pressed, as in the app). */
function closeLists(except) {
  let closed = false;
  for (const [key, f] of Object.entries(state.frames)) {
    if (key !== except && (openOf(f, "family") || openOf(f, "model"))) { f.open = null; closed = true; }
  }
  // Frames not touched yet follow the bar's choice: they close too.
  for (const task of TASKS) for (const screen of ["settings", "setup"]) {
    const key = `${screen}-${task}`;
    if (key !== except && !state.frames[key] && state.lists !== "closed") { frameState(key).open = null; closed = true; }
  }
  return closed;
}

function startDownload(frame) {
  const f = state.frames[frame];
  const task = frame.split("-")[1];
  const sel = selection(evals[task], f);
  f.download = { model: sel.build.id, fraction: 0, started: Date.now() };
  draw();
  clearInterval(timer);
  timer = setInterval(() => {
    const total = 1800;
    let running = false;
    for (const [key, other] of Object.entries(state.frames)) {
      if (!other.download) continue;
      other.download.fraction = Math.min(1, (Date.now() - other.download.started) / total);
      if (other.download.fraction >= 1) { other.installed[other.download.model] = true; other.download = null; draw(); }
      else {
        running = true;
        const percent = Math.round(other.download.fraction * 100);
        const fill = root.querySelector(`[data-progress-fill="${key}"]`);
        if (fill) { fill.style.width = `${percent}%`; fill.parentElement.setAttribute("aria-valuenow", String(percent)); }
        const text = root.querySelector(`[data-progress-text="${key}"]`);
        if (text) text.textContent = fmt(COPY["voice.prepare.downloadingAt"], { percent });
        const note = root.querySelector(`[data-progress-note="${key}"]`);
        const build = selection(evals[key.split("-")[1]], other).build;
        if (note) note.textContent = fmt(COPY["voice.prepare.progress"], { done: mb(build.downloadMb * other.download.fraction), size: mb(build.downloadMb) });
      }
    }
    if (!running) { clearInterval(timer); timer = null; }
  }, 120);
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-bar],[data-act]");
  if (!target || target.disabled) {
    if (!event.target.closest(".rec-select") && closeLists()) draw();
    return;
  }
  if (target.dataset.bar) {
    const { bar: group, value } = target.dataset;
    if (group === "device") { state.device = value; reset(); }
    else if (group === "language") { state.language = value; reset(); }
    else if (group === "theme") state.theme = value;
    else if (group === "lists") { state.lists = value; for (const f of Object.values(state.frames)) f.open = undefined; }
    draw();
    return;
  }
  const { act, frame, which, value } = target.dataset;
  const task = frame?.split("-")[1];
  if (act !== "toggle" && !target.closest(".rec-select")) closeLists(frame);
  else if (act === "toggle") closeLists(frame);
  const f = frame ? frameState(frame) : null;
  if (act === "toggle") f.open = openOf(f, which) ? null : which;
  else if (act === "pick-family") { f.model = evals[task].families.find((family) => family.id === value)?.pick ?? f.model; f.build = null; f.open = null; }
  else if (act === "pick-model") { f.model = value; f.build = null; f.open = null; }
  else if (act === "advanced") f.advanced = !f.advanced;
  else if (act === "langs") f.langs = !f.langs;
  else if (act === "build") f.build = value || null;
  else if (act === "download") return startDownload(frame);
  else if (act === "cancel") f.download = null;
  else return;
  draw();
});

addEventListener("keydown", (event) => { if (event.key === "Escape" && closeLists()) draw(); });

draw();
