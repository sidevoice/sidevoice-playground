// The model recommender design sheet's page (recommender.html): Transcripción and Voz, in Settings and in the first-run
// setup, as the app draws them (the classes of recommender-web.css, copied from sidevoice-web: Select, Badge, Row and
// Group, the model block with its Advanced and spec sheet, the setup's dialog), with the recommendation on them.
// EXAMPLE devices and data (recommender-data.mjs); the rules are recommender-logic.mjs. The controls work: pick a
// family or a model, go back to the recommended one, open "Avanzado", press Descargar.
//
//   ?device=mac|windows|iphone   the example device (default mac)
//   ?lang=es|it                  the person's language (default es)
//   ?theme=light|dark            the frames' theme (default light)
//   ?open=model|family|closed    which list is drawn open (default model); open lists are drawn in flow, so the line
//                                under them stays in sight (in the app they float over it)
//   ?new=on|off                  mark the strings that are NEW (default on)
//   ?soft=a|b  ?family=a|b       the two open decisions (default a)
//   ?compare=soft|family         the decision's two options side by side (default: none)
import { CATALOGUE_SOURCE, COPY, DECISIONS, DEVICES, DEVICE_IDS, LANGUAGES, NEW_COPY, NEW_KEYS, TASKS } from "./recommender-data.mjs";
import { budgetMb, evaluate, familyName, languagePrimary, languageSupported, orderLanguages } from "./recommender-logic.mjs";
import { buildSizes, describeBuild, engineOf, fmt, hardware, languageName, mb } from "./recommender-format.mjs";

const root = document.getElementById("sheet");
const query = new URLSearchParams(location.search);
const one = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const state = {
  device: one(query.get("device"), DEVICE_IDS, "mac"),
  language: one(query.get("lang"), Object.keys(LANGUAGES), "es"),
  theme: one(query.get("theme"), ["light", "dark"], "light"),
  lists: one(query.get("open"), ["model", "family", "closed"], "model"),
  marks: query.get("new") !== "off",
  soft: one(query.get("soft"), ["a", "b"], "a"),
  family: one(query.get("family"), ["a", "b"], "a"),
  compare: one(query.get("compare"), ["soft", "family"], null),
  /** The screens' own state, by frame key: what was picked, what is open, what is on disk. Reset with the device or language. */
  frames: {},
};
let timer = null;

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const t = (key, params) => fmt(COPY[key], params);
/** A NEW string: the words, marked (the sheet's bar turns the marks off). */
const nw = (key, params) => `<span class="rec-new">${esc(fmt(NEW_COPY[key].text, params))}</span>`;
const nwText = (key, params) => fmt(NEW_COPY[key].text, params);

const hardwareText = (label) => `${esc(label.main)}${label.name ? `<span class="model-hardware-name"> · ${esc(label.name)}</span>` : ""}`;
const reasonText = (code) => (COPY[`voice.unfit.${code}`] ?? NEW_COPY[`voice.unfit.${code}`]?.text);
/** A message with a {reasons} slot, the slot filled with the reasons (a NEW reason marked), the rest escaped. */
const withReasons = (key, codes) => { const [before, after] = COPY[key].split("{reasons}"); return esc(before) + reasonsHtml(codes) + esc(after); };
const reasonsHtml = (codes) => codes.map((code) => (COPY[`voice.unfit.${code}`] ? esc(COPY[`voice.unfit.${code}`]) : nw(`voice.unfit.${code}`))).join("; ");

// ----- the app's small components, as markup -----

const ICON = {
  chevron: '<path d="m6 9 6 6 6-6"/>', back: '<path d="m15 18-6-6 6-6"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  alert: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7.4v5.4M12 16.6h.01"/>',
};
const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const mark = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="1.5" y="9" width="3" height="6" rx="1.5"/><rect x="6" y="6" width="3" height="12" rx="1.5"/><rect x="10.5" y="1.5" width="3" height="21" rx="1.5"/><rect x="15" y="6" width="3" height="12" rx="1.5" style="fill:var(--sv-voice)"/><rect x="19.5" y="9" width="3" height="6" rx="1.5"/></svg>`;

const badge = (text, tone = "neutral", dot = false) => `<span class="ui-badge" data-tone="${tone}">${dot ? '<span class="ui-badge-dot" aria-hidden="true"></span>' : ""}${text}</span>`;
const button = ({ label, variant = "secondary", tone, size, id, act, extra = "", disabled = false, cls = "" }) =>
  `<button type="button" class="ui-button ui-button--${variant}${tone ? ` ui-button--${tone}` : ""}${size ? ` ui-button--${size}` : " ui-button--md"}${cls ? ` ${cls}` : ""}"${act ? ` data-act="${act}"` : ""}${id ? ` data-key="${id}"` : ""}${extra}${disabled ? " disabled" : ""}><span class="ui-button-content">${label}</span></button>`;
const row = ({ label, control = "", block = false }) =>
  `<div class="ui-row${block ? " ui-row--block" : ""}"><div class="ui-row-text"><span class="ui-row-label">${esc(label)}</span></div><div class="ui-row-control">${control}</div></div>`;
const field = (label, control) => `<div class="ui-field"><div class="ui-field-head"><span class="ui-field-label">${esc(label)}</span></div><div class="ui-field-control">${control}</div></div>`;

/** The Select as the app draws it: its box, and (`selectList`) its list when open. `items`: options, or groups with a label. */
function selectBox({ frame, which, label, value, items, open, disabled }) {
  const chosen = items.flatMap((item) => item.options ?? [item]).find((option) => option.value === value);
  return `<div class="rec-select"><button type="button" role="combobox" class="ui-select" aria-label="${esc(label)}" aria-expanded="${!!open}" data-state="${open ? "open" : "closed"}" data-act="toggle" data-frame="${frame}" data-which="${which}" data-key="${frame}-${which}"${disabled ? " disabled" : ""}>
<span class="ui-select-value"><span class="ui-select-value-text">${esc(chosen?.label ?? "")}</span></span><span class="ui-select-chevron">${icon("chevron", 16)}</span></button></div>`;
}
function selectList({ frame, which, label, value, items }) {
  const itemHtml = (option) => {
    const checked = option.value === value;
    const reason = option.disabled && option.reason ? `<span class="ui-select-item-reason">${option.reason}</span>` : "";
    return `<div class="ui-select-item" role="option" aria-selected="${checked}" tabindex="${option.disabled ? -1 : 0}" data-state="${checked ? "checked" : "unchecked"}"${option.disabled ? ' data-disabled=""' : ""}${option.disabled ? "" : ` data-act="pick-${which}" data-frame="${frame}" data-value="${esc(option.value)}"`} data-value-of="${esc(option.value)}">
<span class="ui-select-item-text"><span>${esc(option.label)}</span>${option.description ? `<span class="ui-select-item-description">${option.description}</span>` : ""}${option.soft ? `<span class="ui-select-item-reason" data-soft>${option.soft}</span>` : ""}${reason}</span>
${option.badge ? `<span class="ui-select-item-badge">${option.badge}</span>` : ""}<span class="ui-select-item-check">${checked ? icon("check", 16) : ""}</span></div>`;
  };
  return `<div class="rec-list" data-which="${which}"><div class="ui-select-content" data-size="md" role="listbox" aria-label="${esc(label)}"><div class="ui-select-viewport">${items.map((item, index) => item.options
    ? `<div class="ui-select-group" role="group">${index > 0 ? '<div class="ui-select-separator"></div>' : ""}<div class="ui-select-label">${item.label}</div>${item.options.map(itemHtml).join("")}</div>`
    : itemHtml(item)).join("")}</div></div></div>`;
}

// ----- one screen's model block -----

const frameState = (key) => (state.frames[key] ??= { model: null, build: null, open: undefined, advanced: false, langs: false, installed: {}, download: null });
const openOf = (f, which, forced) => (forced ? forced === which : f.open === undefined ? state.lists === which : f.open === which);

/** A model of the Modelo list as the app lists it: its download size at the end of the name's line, its hardware under it
 *  (model-facts.tsx listedOption), «Recomendado» before the size on the recommended one; a model that does not run is
 *  disabled with why (the app's «no funciona aquí: …»), with no facts. */
function modelItem(model, e, soft) {
  if (!model.available) {
    return { value: model.id, label: model.id, disabled: true, reason: withReasons("voice.model.unfit", model.reasons) };
  }
  const label = hardware(model.best);
  const size = mb(model.best.downloadMb);
  const sizeHtml = `<span class="model-list-size" aria-hidden="true">${esc(size)}</span>`;
  return {
    value: model.id, label: model.id,
    badge: model.id === e.recommended ? `<span class="rec-badges">${badge(esc(COPY["runtime.recommended"]), "accent")}${sizeHtml}</span>` : sizeHtml,
    description: `<span class="sr-only">${esc(size)} · </span>${label ? hardwareText(label) : ""}`,
    soft: soft && model.soft ? esc(fmt(COPY["voice.languages.unsupported"], { language: languageName(state.language) })) : "",
  };
}

function modelItems(e, familyId, variants) {
  const mine = e.models.filter((model) => model.family === familyId);
  const runnable = mine.filter((model) => model.available && !model.soft).map((model) => modelItem(model, e, false));
  const soft = mine.filter((model) => model.available && model.soft).map((model) => modelItem(model, e, true));
  const hard = mine.filter((model) => !model.available).map((model) => modelItem(model, e, false));
  const items = [...runnable];
  if (soft.length) items.push(...(variants.soft === "b" ? [{ label: nw("recommend.notRecommended"), options: soft }] : soft));
  if (hard.length) items.push({ label: nw("recommend.unavailable"), options: hard });
  return items;
}

function familyItems(e, variants) {
  const item = (family) => ({
    value: family.id, label: familyName(family.id), disabled: !family.available,
    badge: variants.family === "a" && family.recommended ? badge(esc(COPY["runtime.recommended"]), "accent") : "",
    reason: !family.available ? esc(fmt(COPY["voice.model.unfitUnknown"])) : "",
  });
  const runs = e.families.filter((family) => family.available).map(item);
  const not = e.families.filter((family) => !family.available).map(item);
  return not.length ? [...runs, { label: nw("recommend.unavailable"), options: not }] : runs;
}

/** What the person has now on this screen: the model, the build it runs as, and how it differs from the recommendation. */
function selection(e, f) {
  const model = e.byId[f.model && e.byId[f.model]?.available ? f.model : e.recommended];
  const family = e.families.find((each) => each.id === model.family);
  const chosen = f.build ? model.builds.find((build) => build.id === f.build && build.available) : null;
  const build = chosen ?? model.best;
  const recommended = e.byId[e.recommended];
  const differs = model.id !== e.recommended || (!!chosen && chosen.id !== recommended.best.id);
  return { model, family, build, chosen, differs };
}

/** The line under the pickers: the recommendation, and the way back to it while the selection differs. */
function recommendationLine(e, sel, frame) {
  const lead = sel.model.id === e.recommended
    ? `${badge(esc(COPY["runtime.recommended"]), "accent")}<span>${nw("recommend.why")}</span>`
    : sel.model.id === sel.family.pick ? `<span>${nw("recommend.whyFamily", { family: familyName(sel.family.id) })}</span>` : "";
  const back = sel.differs ? button({ label: nw("recommend.back"), variant: "ghost", size: "sm", act: "back", extra: ` data-frame="${frame}"` }) : "";
  return lead || back ? `<div class="rec-line">${lead ? `<p class="model-prepare-meta rec-why">${lead}</p>` : ""}${back}</div>` : "";
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

function runtimeBlock(e, sel, f, frame, locked) {
  const summary = engineOf(sel.build);
  const option = (value, title, detail, badges, available = true, why = "") => {
    const checked = value === null ? !sel.chosen : !!sel.chosen && sel.chosen.id === value;
    return `<label class="model-runtime-option"${checked ? ' data-checked=""' : ""}${!available || locked ? ' data-disabled=""' : ""}><input type="radio" name="${frame}-build"${checked ? " checked" : ""}${!available || locked ? " disabled" : ""} data-act="build" data-frame="${frame}" data-value="${value ?? ""}">
<span class="model-runtime-copy"><span class="model-runtime-title">${esc(title)}${badges.join("")}</span><span class="model-runtime-detail">${esc(detail)}</span>${why ? `<span class="model-runtime-why">${why}</span>` : ""}</span></label>`;
  };
  const builds = sel.model.builds.map((build) => option(build.id, describeBuild(build), buildSizes(build),
    [...(build.id === sel.model.best.id ? [badge(esc(COPY["runtime.recommended"]), "accent")] : []), ...(f.installed[build.id] ? [badge(esc(COPY["runtime.onDisk"]), "positive")] : [])],
    build.available, build.available ? "" : withReasons("runtime.notHere", build.reasons)));
  return `<div class="model-runtime"><div class="model-runtime-head"><button type="button" class="model-runtime-toggle" aria-expanded="${f.advanced}" data-act="advanced" data-frame="${frame}" data-key="${frame}-advanced">
<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${f.advanced ? "model-runtime-chevron-open" : ""}">${ICON.chevron}</svg>${esc(COPY["runtime.advanced"])}</button><span class="model-runtime-summary">${esc(summary)}</span></div>
${f.advanced ? `<div class="model-runtime-panel"><p class="model-runtime-info">${esc(COPY["runtime.info"])}</p><fieldset class="model-runtime-options"><legend class="sr-only">${esc(COPY["runtime.title"])}</legend>
${option(null, COPY["runtime.auto"], `${describeBuild(sel.model.best)} · ${buildSizes(sel.model.best)}`, [])}${builds.join("")}</fieldset>${locked ? `<p class="model-runtime-device">${esc(COPY["voice.prepare.lockedHint"])}</p>` : ""}</div>` : ""}</div>`;
}

function sheet(e, sel, f, frame) {
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
function slotGroup(task, frame, variants, forced) {
  const e = evals[task];
  const f = frameState(frame);
  const sel = selection(e, f);
  const locked = !!f.download;
  const familyOpen = openOf(f, "family", forced);
  const modelOpen = openOf(f, "model", forced);
  const boxes = {
    family: { frame, which: "family", label: COPY["voice.family"], value: sel.family.id, items: familyItems(e, variants), open: familyOpen, disabled: locked },
    model: { frame, which: "model", label: COPY["voice.model"], value: sel.model.id, items: modelItems(e, sel.family.id, variants), open: modelOpen, disabled: locked },
  };
  const pickers = field(COPY["voice.family"], selectBox(boxes.family)) + field(COPY["voice.model"], selectBox(boxes.model));
  const list = familyOpen ? selectList(boxes.family) : modelOpen ? selectList(boxes.model) : "";
  const model = `<div class="model-prepare" data-status="${f.installed[sel.build.id] ? "ready" : f.download ? "downloading" : "absent"}"><div class="model-prepare-pickers">${pickers}</div>${list}
${locked ? `<p class="model-prepare-meta">${esc(COPY["voice.prepare.lockedHint"])}</p>` : ""}
${recommendationLine(e, sel, frame)}${runtimeBlock(e, sel, f, frame, locked)}${sheet(e, sel, f, frame)}</div>`;
  const origin = row({ label: COPY["voice.source"], control: `<button type="button" role="combobox" class="ui-select" aria-label="${esc(COPY["voice.source"])}" aria-expanded="false"><span class="ui-select-value"><span class="ui-select-value-text">${esc(COPY["voice.source.local"])}</span></span><span class="ui-select-chevron">${icon("chevron", 16)}</span></button>` });
  return { html: `<div class="ui-group"><div class="ui-group-card">${origin}${row({ label: COPY["voice.model"], control: model, block: true })}</div></div>`, sel, f };
}

// ----- the two screens -----

const SECTION = { stt: { title: "settings.section.transcription", hint: "settings.transcription.description", wizard: "wizard.title.stt", intro: "wizard.sttIntro", group: "wizard.group.transcription", step: 5, wait: "settings.save.waitTranscription" },
  tts: { title: "settings.section.voice", hint: "settings.voice.description", wizard: "wizard.title.tts", intro: "wizard.ttsIntro", group: "wizard.group.voice", step: 6, wait: "settings.save.waitVoice" } };

function settingsFrame(task, key, variants, forced, width) {
  const { html } = slotGroup(task, `settings-${task}-${key}`, variants, forced);
  const s = SECTION[task];
  return `<div class="sheet-window" style="--window:${width}px"><b>Settings · ${esc(t(s.title))}</b><div class="rec-window" data-theme="${state.theme}" ${width < 500 ? " data-phone" : ""}><div class="settings-column">
<section class="ui-section"><header class="ui-section-head"><div><h2 class="ui-section-title">${esc(t(s.title))}</h2><p class="ui-section-description">${esc(t(s.hint))}</p></div></header><div class="ui-section-body">${html}</div></section></div></div></div>`;
}

function setupFrame(task, key, variants, forced, width) {
  const { html, sel, f } = slotGroup(task, `setup-${task}-${key}`, variants, forced);
  const s = SECTION[task];
  const ready = !!f.installed[sel.build.id];
  const steps = Array.from({ length: 8 }, (_, index) => `<li data-state="${index + 1 < s.step ? "done" : index + 1 === s.step ? "current" : "next"}"${index + 1 === s.step ? ' aria-current="step"' : ""}></li>`).join("");
  const footer = `${button({ label: `${icon("back", 16)}<span class="wizard-back-label">${esc(t("wizard.back"))}</span>`, variant: "ghost", tone: "neutral", cls: "wizard-back" })}
${ready ? button({ label: esc(t("wizard.continueWithoutTrying")), variant: "ghost", tone: "neutral", cls: "wizard-quiet" }) : button({ label: esc(t("wizard.skip.later")), variant: "ghost", tone: "neutral", cls: "wizard-quiet" })}
${button({ label: esc(t("try.tryIt")), variant: "primary", disabled: !ready })}`;
  return `<div class="sheet-window" style="--window:${width}px"><b>First-run setup · ${esc(t(s.group))}</b><div class="rec-wizard" data-theme="${state.theme}"><div class="wizard-dialog" open data-step="${task === "stt" ? "W4" : "W4v"}">
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
  const budget = budgetMb(d);
  return `<p class="rec-device"><b>${esc(d.name)}</b> · memory: ${esc(d.memoryNote)}; the voice set may take 60 % = ${esc(mb(budget))}, with the end-of-turn model (${esc(mb(50))}) inside. ${esc(d.facts)}</p>`;
}

function decisionCard(id) {
  const decision = DECISIONS[id];
  const on = state.compare === id ? "compare" : state[id];
  const buttons = [...Object.entries(decision.options).map(([value, option]) => choice(`decision-${id}`, value, on === value, esc(option.label))), choice(`decision-${id}`, "compare", on === "compare", "Side by side")];
  const text = Object.entries(decision.options).map(([value, option]) => `<li><b>${value.toUpperCase()}</b> ${esc(option.text)}</li>`).join("");
  return `<article class="rec-decision"><h3><span class="rec-tag">Decision for Rubén</span>${esc(decision.title)}</h3><p>${esc(decision.question)}</p><ul>${text}</ul><p class="rec-try"><b>Try:</b> ${esc(decision.try)}</p><span class="bar-choice" role="radiogroup" aria-label="${esc(decision.title)}">${buttons.join("")}</span></article>`;
}

function legend() {
  const rows = NEW_KEYS.map((key) => `<tr><td><span class="rec-new">${esc(nwText(key, { family: "{familia}" }))}</span></td><td><code>${esc(key)}</code></td><td>${esc(NEW_COPY[key].where)}</td></tr>`).join("");
  const reused = ["runtime.recommended", "voice.model.unfit", "voice.languages.unsupported", "voice.family", "voice.model", "voice.source", "runtime.advanced", "runtime.auto", "voice.prepare.download"].map((key) => `<tr><td>${esc(COPY[key])}</td><td><code>${esc(key)}</code></td></tr>`).join("");
  return `<section class="rec-legend"><h2>Legend · strings</h2><p>A string marked <span class="rec-new">NEW</span> has no key in the app's Spanish catalogue today; the proposed key is next to it. Everything else on the screens is the app's own copy and components (copied from sidevoice-web), reused as they are.</p>
<table><thead><tr><th>NEW string</th><th>proposed key</th><th>where</th></tr></thead><tbody>${rows}</tbody></table>
<details><summary>Existing strings reused</summary><table><tbody>${reused}</tbody></table></details></section>`;
}

function whyTables() {
  const table = (task, name) => {
    const e = evals[task];
    const rows = e.models.map((model, index) => {
      const verdict = !model.available ? `<span class="rec-hard">can't run here</span> ${esc(model.reasons.map(reasonText).join("; "))}` : model.soft ? `<span class="rec-soft-tag">not recommended</span> no ${esc(languageName(state.language))}` : model.id === e.recommended ? "<b>recommended</b>" : "";
      const best = model.best ? `${esc(describeBuild(model.best))} · ${esc(mb(model.best.memoryMb))}${model.best.comfortable ? "" : " · <i>not comfortable</i>"}` : "";
      return `<tr><td>${index + 1}</td><td><code>${esc(model.id)}</code></td><td>${verdict}</td><td>${best}</td></tr>`;
    }).join("");
    return `<div><h3>${name}</h3><table><thead><tr><th>#</th><th>model</th><th>verdict</th><th>its best build here</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  return `<section class="rec-why-sheet"><h2>Why: the ranking behind the screens · ${esc(DEVICES[state.device].short)}, ${esc(LANGUAGES[state.language])}</h2>
<p>Hard filters: engine in this build, GPU builds off where not allowed, fits memory. Soft: the language. Then ORDER BY comfortable, quality (hand-written list), accelerator class, catalogue order; the joint (transcription, voice) pair closest to (1st, 1st) inside the memory budget. EXAMPLE data from ${esc(CATALOGUE_SOURCE)}; devices, budgets and comfort hints are invented.</p>
<div class="rec-why-tables">${table("stt", "Transcripción")}${table("tts", "Voz")}</div></section>`;
}

let evals = {};

function screens() {
  const variants = { soft: state.soft, family: state.family };
  const forced = null;
  const width = DEVICES[state.device].frame;
  const settings = (key, v, w = width) => `<div class="sheet-windows">${TASKS.map((task) => settingsFrame(task, key, v, forced, w)).join("")}</div>`;
  const setup = (key, v, w = width) => `<div class="sheet-windows">${TASKS.map((task) => setupFrame(task, key, v, forced, w)).join("")}</div>`;
  if (state.compare) {
    const id = state.compare;
    // Soft: the Piper family of Voz, which has a model that is not recommended in Spanish (both are, in Italian). Family: both lists, the family one open.
    const tasks = id === "soft" ? ["tts"] : TASKS;
    const columns = Object.keys(DECISIONS[id].options).map((value) => {
      const v = { ...variants, [id]: value };
      const frames = tasks.map((task) => {
        const key = `${id}-${value}`;
        if (id === "soft") frameState(`settings-${task}-${key}`).model ??= evals[task].families.find((family) => family.id === "piper")?.pick ?? null;
        return settingsFrame(task, key, v, id === "family" ? "family" : null, Math.min(width, 640));
      });
      return `<div class="rec-column"><h3>${esc(DECISIONS[id].options[value].label)}</h3>${frames.join("")}</div>`;
    });
    return `<section class="sheet-block"><h2>Side by side · ${esc(DECISIONS[id].title)}</h2><p class="why">${esc(DECISIONS[id].compareNote)}</p><div class="rec-compare">${columns.join("")}</div></section>`;
  }
  return `<section class="sheet-block"><h2>Settings</h2><p class="why">Settings › Transcripción and Settings › Voz.</p>${settings("a", variants)}</section>
<section class="sheet-block"><h2>First-run setup</h2><p class="why">The setup's transcription and voice steps: the same block, nothing downloaded until Descargar.</p>${setup("a", variants)}</section>`;
}

function draw() {
  document.body.dataset.new = state.marks ? "on" : "off";
  evals = Object.fromEntries(TASKS.map((task) => [task, evaluate(task, state.device, state.language)]));
  const focus = document.activeElement?.dataset?.key;
  root.innerHTML = `<header class="sheet-bar"><h1>Model recommender · preview</h1>
${bar("Device", DEVICE_IDS.map((id) => choice("device", id, state.device === id, esc(DEVICES[id].short))))}
${bar("Language", Object.entries(LANGUAGES).map(([id, name]) => choice("language", id, state.language === id, esc(name))))}
${bar("Theme", [choice("theme", "light", state.theme === "light", "Light"), choice("theme", "dark", state.theme === "dark", "Dark")])}
${bar("List open", [choice("lists", "model", state.lists === "model", "Modelo"), choice("lists", "family", state.lists === "family", "Familia"), choice("lists", "closed", state.lists === "closed", "None")])}
${bar("NEW marks", [choice("marks", "on", state.marks, "On"), choice("marks", "off", !state.marks, "Off")])}</header>
<div class="sheet-intro"><p>Transcripción and Voz as the app draws them (its own stylesheets and markup, Spanish as in its catalogue), with the model recommender decided on 2026-11-10: the recommended model preselected with «Recomendado» and a line of why, a way back to it, each family's own pick, and two kinds of exclusion. Pick things: they work.</p>
<p class="rec-example"><b>EXAMPLE devices and data.</b> Models, builds, sizes and languages mirror the engine's catalogue; the devices, their memory, the comfort hints and the ranking they give are invented for this preview, nothing is measured. Open lists are drawn in flow so the line under them stays in sight.</p>${deviceCard()}</div>
<section class="rec-decisions">${decisionCard("soft")}${decisionCard("family")}</section>
${screens()}${legend()}${whyTables()}`;
  if (focus) root.querySelector(`[data-key="${focus}"]`)?.focus();
  history.replaceState(null, "", `?${new URLSearchParams({ device: state.device, lang: state.language, theme: state.theme, open: state.lists, new: state.marks ? "on" : "off", soft: state.soft, family: state.family, ...(state.compare ? { compare: state.compare } : {}) })}`);
}

// ----- the controls -----

/** A new device or language is a new world: what was picked on the old one goes. */
const reset = () => { clearInterval(timer); timer = null; state.frames = {}; };

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
        const task = key.split("-")[1];
        const build = selection(evals[task], other).build;
        if (note) note.textContent = fmt(COPY["voice.prepare.progress"], { done: mb(build.downloadMb * other.download.fraction), size: mb(build.downloadMb) });
      }
    }
    if (!running) { clearInterval(timer); timer = null; }
  }, 120);
}

root.addEventListener("click", (event) => {
  const target = event.target.closest("[data-bar],[data-act]");
  if (!target || target.disabled) return;
  if (target.dataset.bar) {
    const { bar: group, value } = target.dataset;
    if (group === "device") { state.device = value; reset(); }
    else if (group === "language") { state.language = value; reset(); }
    else if (group === "theme") state.theme = value;
    else if (group === "lists") { state.lists = value; for (const f of Object.values(state.frames)) f.open = undefined; }
    else if (group === "marks") state.marks = value === "on";
    else if (group.startsWith("decision-")) {
      const id = group.slice("decision-".length);
      if (value === "compare") state.compare = id;
      else { state[id] = value; if (state.compare === id) state.compare = null; }
    }
    draw();
    return;
  }
  const { act, frame, which, value } = target.dataset;
  const f = frame ? frameState(frame) : null;
  const task = frame?.split("-")[1];
  if (act === "toggle") f.open = openOf(f, which) ? null : which;
  else if (act === "pick-family") { f.model = evals[task].families.find((family) => family.id === value)?.pick ?? f.model; f.build = null; f.open = null; }
  else if (act === "pick-model") { f.model = value; f.build = null; f.open = null; }
  else if (act === "back") { f.model = null; f.build = null; }
  else if (act === "advanced") f.advanced = !f.advanced;
  else if (act === "langs") f.langs = !f.langs;
  else if (act === "build") f.build = value || null;
  else if (act === "download") return startDownload(frame);
  else if (act === "cancel") f.download = null;
  else return;
  draw();
});

draw();
