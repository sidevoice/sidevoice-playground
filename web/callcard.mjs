// The call-card exploration (callcard.html): the desktop app's floating call card in the three formats kept
// (callcard/formats.mjs) over a simulated desktop (callcard/desktops.mjs), in each of the call's states, and a mock of
// the settings that pick it. Nothing of the app is redrawn here: the avatars are the web's drawings
// (callcard/creatures.json) moved by the web's CSS and the engine's own picks (callcard/motion.mjs); the balloons, the
// stage, today's controls card and the settings screen are the web's markup on copies of its stylesheets
// (scripts/callcard-creatures.mjs). This page only plays a mock call through them.
import { COPY, FORMATS, PLACEMENT, SIZES, STATES, cardSettings, dropAt, firstPlace, fit, opensDown } from "./callcard/formats.mjs";
import { DESKTOPS } from "./callcard/desktops.mjs";
import { ENTER_MS, createPlaybackLevelChannel, enterFrom, nextIdle, nextWork, smoothPlaybackLevel, workTurn } from "./callcard/motion.mjs";
// The voice the mocked room speaks and hears with (preview/mock/voice.mjs, linked here): its level while a voice sounds.
import { speechLevel } from "./callcard/mock/voice.mjs";

const { source, creatures: ALL_CREATURES, marks: MARKS } = await (await fetch("/callcard/creatures.json")).json();
/** The conversations' avatars; the person holding the microphone (onboarding's) is the settings previews' alone. */
const CREATURES = ALL_CREATURES.filter((each) => !each.id.startsWith("person:"));
const SAMPLE = ALL_CREATURES.find((each) => each.id === "person:microphone");

// Today's card answers the system's light or dark (call-card.css, prefers-color-scheme): here, the simulated
// desktop's. The copy is loaded with that query turned into the card window's [data-scheme=light] (CSS nesting).
{
  const css = await (await fetch("/callcard/call-card.css")).text();
  const style = document.createElement("style");
  style.textContent = css.replaceAll("@media (prefers-color-scheme: light) {", "#card-window[data-scheme=light] {");
  document.head.append(style);
}

// ---------- what is picked: the address's hash ----------

const DEFAULTS = { env: "windows", format: "card", size: "l", captions: "1", always: "0", x: "", y: "", state: "speaking",
  cycle: "0", creature: CREATURES[0].id, theme: "", motion: "full", panel: "1", view: "", lang: "en", previews: "small", pipTitle: "bottom" };
const pick = { ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) };
const save = () => {
  const changed = Object.entries(pick).filter(([key, value]) => value !== DEFAULTS[key]);
  history.replaceState(null, "", "#" + new URLSearchParams(changed).toString());
};
const env = () => DESKTOPS[pick.env] ?? DESKTOPS.windows;
/** The avatar drawn: the picked conversation's, or another for a while (withCreature: the settings' real previews). */
let drawing = null;
const creature = () => drawing ?? CREATURES.find((each) => each.id === pick.creature) ?? CREATURES[0];
const withCreature = (c, draw) => { const was = drawing; drawing = c; try { return draw(); } finally { drawing = was; } };
/** The settings the card is drawn from: the stored shape (formats.mjs SETTING_DEFAULTS), read from the address. */
const settings = () => cardSettings({ format: pick.format, size: pick.size, captions: pick.captions === "1", alwaysShown: pick.always === "1", place: pick.x !== "" && pick.y !== "" ? { x: Number(pick.x), y: Number(pick.y) } : null });
const format = () => FORMATS.find((each) => each.id === settings().format);
const words = (key) => COPY[key][pick.lang] ?? COPY[key].en;

// ---------- the mock call ----------

const call = {
  state: pick.state in STATES ? pick.state : "speaking",
  title: () => creature() === SAMPLE ? words("settings.callCard.sampleName") : creature().seed,
  machine: "MacBook-Pro",
  model: "opus · high",
  since: Date.now() - 12 * 60_000 - 4_000,
  ended: false,
  appOpen: false,
};
const SAYS = "He terminado el cambio del relay. Los tests pasan, pero clippy avisa de un import sin usar. ¿Lo quito y hago commit?";
const HEARS = "Vale, quítalo y haz el commit con un mensaje corto.";
const clock = () => { const s = Math.floor((Date.now() - call.since) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const muted = () => call.state === "muted";

// ---------- the app's marks (sidevoice-web components/ui/Icons.tsx: lucide's drawings, ISC, at stroke 1.8) ----------

const ICONS = {
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  micOff: '<path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>',
  hangup: '<path d="M10.1 13.9a14 14 0 0 0 3.732 2.668 1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2 18 18 0 0 1-12.728-5.272"/><path d="M22 2 2 22"/><path d="M4.76 13.582A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 .244.473"/>',
  skip: '<path d="M21 4v16"/><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  captions: '<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
  captionsOff: '<path d="M10.5 5H19a2 2 0 0 1 2 2v8.5"/><path d="M17 11h-.5"/><path d="M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/><path d="m2 2 20 20"/><path d="M7 11h4"/><path d="M7 15h2.5"/>',
  machine: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
};
const svg = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

let copies = 0;
/** The drawing's markup with ids of its own (as the web's withOwnIds): two copies never share a gradient. */
const ownIds = (html) => { const salt = `cc${(copies += 1).toString(36)}-`; return html.replace(/(\bid="|url\(#|href="#)/g, `$1${salt}`); };

/** An avatar root as the web's CharacterAvatar renders it: the stage's follows the voice's output level (its mouth
 *  "playback"), a small one the voice's word beats; the animator keeps the rest of its attributes. */
const avatar = (size, cls = "") => `<span class="sv-avatar ${cls}" data-style="bichos" data-size="${size === "stage" ? "stage" : "sidebar"}" data-mouth="${size === "stage" ? "playback" : "voice"}">${ownIds(size === "stage" ? creature().stage : creature().small)}</span>`;

// ---------- the room's stage and balloons (sidevoice-web features/call: CallStage, BalloonTail, LiveVoiceBalloon) ----------

const STAGE_MOOD = { listening: "listening", speaking: "speaking", working: "working", muted: "idle", idle: "idle" };
const TAILS = { agent: "M16 1C16 12 22 24 30 31Q36 36 38 30C40 22 38 12 38 1", person: "M24 1C24 14 40 28 64 36C52 26 46 14 46 1" };
function tail(shape) {
  const ink = TAILS[shape], start = /^M([\d.]+) /.exec(ink)[1], end = /([\d.]+) 1$/.exec(ink)[1];
  return `<svg class="balloon-tail" data-tail="${shape}" viewBox="0 0 72 40" aria-hidden="true"><path class="tail-fill" d="M${start} 0L${ink.slice(1)}L${end} 0Z"/><path class="tail-ink" d="${ink}"/></svg>`;
}
/** The room's stage tile, `height` px tall: the conversation's name and machine in its corner, the avatar on its backdrop
 *  with its desk, and the slots the balloons go in — the agent's over its head, the person's at the tile's foot. */
function stage(height, { slots = true, nameExtra = "" } = {}) {
  const c = creature(), d = c.deskColours;
  return `<div class="stage-tile" data-theme="dark" data-mood="${STAGE_MOOD[call.state]}" style="--k:${height / 440};--av-color:${c.tone}">
<div class="stage-canvas"><div class="stage-scene"><div class="stage-backdrop" aria-hidden="true">${ownIds(c.backdrop)}</div>${avatar("stage", "stage-agent")}
<div class="stage-desk" aria-hidden="true" style="--desk-top:${d.top};--desk-top-deep:${d.topDeep};--desk-front:${d.front};--desk-front-deep:${d.frontDeep}">${ownIds(c.desk)}</div></div></div>
<div class="stage-name" translate="no"><h2><span class="stage-heading"><span class="stage-heading-name"><span>${call.title()}</span></span><span class="stage-machine">${svg("machine", 12)}<span>${call.machine}</span></span></span></h2>${nameExtra}</div>
${slots ? '<div class="stage-top cc-agent-slot"></div>' : ""}<div class="stage-tags">${badge()}</div>${slots ? '<div class="person-turns"></div>' : ""}</div>`;
}
/** The agent's harness, model and effort at the tile's foot (CallStage AgentBadge; Icons.tsx HarnessIcon's mark). */
const badge = () => `<span class="stage-tag stage-badge"><span class="ui-logo" style="display:inline-block;flex:none;width:12px;height:12px;line-height:0" aria-hidden="true">${MARKS.claude.replace("<svg ", '<svg width="100%" height="100%" ')}</span><span>${call.model}</span></span>`;
/** The agent's balloon (AgentBubble): three lines a page (PagedText), its words lit as they are said (KaraokeText). */
const agentBalloon = () => `<div class="speech-bubble stage-bubble" data-visible="" aria-hidden="true" translate="no"><span class="paged-text" data-turn="page" style="--paged-lines:3"><span class="paged-text-run"><span class="karaoke-text" data-playback="playing" data-progress="true"><span class="karaoke-played"></span><span class="karaoke-upcoming">${SAYS}</span></span></span></span><svg class="balloon-shine" viewBox="0 0 40 20" aria-hidden="true"><path d="M3 17Q5 4 24 3"/></svg>${tail("agent")}</div>`;
/** The person's balloon while they speak and while it is transcribed (LiveVoiceBalloon): the voice's bars. */
const liveBalloon = (phase) => `<div class="speech-bubble person-bubble" data-live="" translate="no"><span class="voice-wave" data-phase="${phase}" role="status"><canvas aria-hidden="true"></canvas></span><div class="person-live-actions"></div>${tail("person")}</div>`;
/** What was sent, for its moment (PersonTurn SentBubble). */
const sentBalloon = () => `<div class="speech-bubble person-bubble" data-sent="" translate="no"><span class="person-said">${HEARS}</span>${tail("person")}</div>`;
/** A card's captions, opening below or above it (data-open, place()): for the avatar, the room's balloons, the agent's
 *  at the left and yours at the right; for the title card, plain lines as a transcript reads (.cc-lines). */
const balloonCaptions = () => `<div class="cc-captions cc-balloons" data-theme="dark"><div class="cc-agent-slot"></div><div class="person-turns"></div></div>`;
const lineCaptions = () => `<div class="cc-captions call-card cc-lines"></div>`;

// ---------- today's call controls card (sidevoice-web call-controls/CallCard.tsx) ----------

const yourWave = () => `<span class="your-wave" role="img" aria-label="Your microphone">${"<i></i>".repeat(11)}</span>`;
const captionsButton = () => `<button type="button" class="card-skip card-captions" data-run="captions"></button>`;
/** Today's controls row: the microphone with its devices, skip, hang up; the captions' toggle beside skip, in its look. */
const controls = () => `<div class="card-controls"><span class="card-mic"><button type="button" class="card-devices" title="Microphone and speaker" aria-label="Microphone and speaker">${svg("chevron", 13)}</button><button type="button" class="card-mute" data-run="mute"></button></span>
${captionsButton()}<button type="button" class="card-skip" data-run="skip"></button><button type="button" class="card-hangup" data-run="hangup" title="Hang up" aria-label="Hang up">${svg("hangup", 18)}</button></div>`;
/** The card's two actions, the same on every format: its settings (Settings → Call → Floating call card) and back to
 *  Sidevoice. A1 has them in its header, B1 over the picture, C1 by the avatar's top corner near the pointer. */
const actions = () => `<span class="cc-actions"><button type="button" class="cc-action" data-run="card-settings" title="Floating card settings" aria-label="Floating card settings">${svg("settings", 15)}</button><button type="button" class="cc-action" data-run="open" title="Open Sidevoice" aria-label="Open Sidevoice">${svg("open", 15)}</button></span>`;
/** Today's card holding only its controls row (and, under the avatar, "open Sidevoice"): near the pointer. */
const strip = () => `<div class="call-card cc-strip">${controls()}</div>`;

// ---------- the formats ----------

const DRAW = {
  card: () => `<div class="cc"><div class="call-card cc-a1"><div class="card-row"><span class="cc-face" style="--tone:${creature().tone}">${avatar("small")}</span>
<div class="card-who"><button type="button" class="card-title"><span class="card-title-text">${call.title()}</span><span class="card-title-chevron" aria-hidden="true">${svg("chevron", 13)}</span></button>
<span class="card-sub"><span class="card-machine">${svg("machine", 11)} <span>${call.machine}</span></span><span aria-hidden="true">·</span><span class="card-harness"><span>${call.model}</span></span></span>
<span class="cc-state"><i class="cc-dot"></i><span class="cc-state-text"></span><span aria-hidden="true">·</span><span class="card-clock"></span></span></div>
${actions()}${yourWave()}</div>${controls()}</div>${settings().captions ? lineCaptions() : ""}</div>`,
  // The room's stage; its name at the top right, clear of the agent's balloon, with the picture's two buttons under it.
  pip: (box) => `<div class="cc cc-pip" data-title="${pick.pipTitle === "top" ? "top" : "bottom"}">${stage(box.h)}${actions()}<div class="pip-strip">${strip()}</div></div>`,
  mascot: () => `<div class="cc cc-mascot"><span class="m-figure">${avatar("stage")}</span>${actions()}${strip()}${settings().captions ? balloonCaptions() : ""}</div>`,
};

// ---------- the screen ----------

const $ = (id) => document.getElementById(id);

function drawDesktop() {
  const desk = env();
  $("screen").dataset.env = pick.env;
  $("desktop").innerHTML = desk.html;
  const area = $("work-area").style;
  for (const side of ["top", "right", "bottom", "left"]) area[side] = desk.inset[side] + "px";
}

function drawCard() {
  const s = settings(), f = format(), box = f.sizes[s.size];
  const win = $("card-window");
  Object.assign(win.dataset, { theme: "dark", format: f.id, size: s.size, captions: s.captions ? "on" : "off",
    scheme: pick.theme || env().theme });
  win.style.setProperty("--w", box.w + "px");
  if (box.h) win.style.setProperty("--h", box.h + "px"); else win.style.removeProperty("--h");
  win.style.setProperty("--margin", PLACEMENT.margin + "px");
  // In front of the room the card hides (unless always shown); while Settings changes it, it shows a moment (preview()).
  win.hidden = call.appOpen && !s.alwaysShown && Date.now() >= previewUntil;
  win.innerHTML = call.ended
    ? `<div class="call-card cc-ended"><span>Call ended</span><button type="button" data-run="again">Call again</button></div>`
    : DRAW[f.id](box);
  $("blurb").textContent = f.blurb;
  place();
  animator.restart();
}

/** Settings changed the card: it shows on the screen for a moment, as it now is, then hides again (the settings are
 *  set where the card cannot be seen). */
const PREVIEW_MS = 4000;
let previewUntil = 0, previewTimer = 0;
function preview() {
  previewUntil = Date.now() + PREVIEW_MS;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => drawCard(), PREVIEW_MS + 20);
}

/** Balloons that open below the avatar point their tails up at it (proposed-web.css: .balloon--tail-up). */
function tailsToward() {
  const up = $("card-window").dataset.open === "down";
  for (const balloon of $("card-window").querySelectorAll(".cc-mascot .cc-captions .speech-bubble")) balloon.classList.toggle("balloon--tail-up", up);
}

/** The work area's size, and the card window's (the card and its shadow margin). */
const workSize = () => { const r = $("work-area").getBoundingClientRect(); return { width: r.width, height: r.height }; };
const cardSize = () => { const w = $("card-window"); return { width: w.offsetWidth, height: w.offsetHeight }; };

/** Puts the card where it rests (its stored place kept inside the work area, or its first place), moved in just enough
 *  while it is grown (its controls out) to fit, as the desktop app does. */
function place() {
  const win = $("card-window");
  if (win.hidden) return;
  const work = workSize(), size = cardSize();
  const rest = dropAt(settings().place ?? firstPlace(work, size), size, work);
  const at = fit(rest, size, work);
  win.style.left = at.x + "px";
  win.style.top = at.y + "px";
  win.dataset.open = opensDown(at, size, work) ? "down" : "up";
  tailsToward();
  win.dataset.side = at.x + size.width / 2 > work.width / 2 ? "right" : "left";
}
addEventListener("resize", () => place());

// The card's controls show near the pointer, as today's (card-shell.tsx: after 120 ms in, until 500 ms out); its window
// grows with them and moves in if it has to.
let hoverTimer = 0;
$("card-window").addEventListener("pointerenter", () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(true), 120); });
$("card-window").addEventListener("pointerleave", () => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(false), 500); });
function expand(on) {
  const win = $("card-window");
  if (on === win.hasAttribute("data-expanded")) return;
  win.toggleAttribute("data-expanded", on);
  if (on) guardUntil = Date.now() + CLICK_GUARD_MS;
  for (const el of win.querySelectorAll(".call-card")) el.toggleAttribute("data-expanded", on);
  if (!drag) place();
}

// ---------- the Sidevoice window: the room, or Settings ----------

function drawApp() {
  const win = $("app-window");
  win.hidden = !call.appOpen;
  if (!call.appOpen) { win.innerHTML = ""; return; }
  const settingsView = pick.view === "settings";
  win.innerHTML = `<header><span class="w-title">Sidevoice</span><span class="w-btns"><button type="button" data-run="minimise" title="Minimise">—</button></span></header>
<div class="app-body" data-theme="dark">${settingsView ? settingsScreen() : `<nav><b>Conversations</b>${CREATURES.filter((c) => c.seed !== "Sidevoice").map((c) => `<span${c.id === creature().id ? ' class="on"' : ""}>${c.seed}</span>`).join("")}</nav>
<section class="app-stage">${stage(330)}<p>The room, in front: the card hides while Sidevoice's window is in front (unless it is always shown). Minimise it to bring the card back.</p></section>`}</div>`;
  if (!settingsView) animator.restart();
}

/** Settings → Call, with the floating card's group, as sidevoice-web's settings screen draws it (SettingsDialog,
 *  components/ui/Card: Section, Group, Row, ChoiceCard, Switch; ui.css, settings.css). Its controls set the same settings
 *  the card is drawn from. */
function settingsScreen() {
  const s = settings();
  const nav = ["General", "Transcription", "Voice", "Call", "Shortcuts", "Integrations", "This computer", "Updates", "Advanced"]
    .map((name) => `<button type="button" class="ui-nav-item"${name === "Call" ? ' aria-current="page"' : ""}>${name}</button>`).join("");
  const row = (label, hint, control, block = false) => `<div class="ui-row${block ? " ui-row--block" : ""}"><div class="ui-row-text"><span class="ui-row-label">${label}</span>${hint ? `<p class="ui-row-description">${hint}</p>` : ""}</div>${control ? `<div class="ui-row-control">${control}</div>` : ""}</div>`;
  const toggle = (name, on) => `<button type="button" role="switch" aria-checked="${on}" class="ui-switch" data-setting="${name}"><span class="ui-switch-thumb" aria-hidden="true"></span></button>`;
  const segmented = (name, options, value) => `<div class="ui-segmented ui-segmented--sm" role="radiogroup">${Object.entries(options).map(([id, label]) => `<button type="button" role="radio" class="ui-segment" aria-checked="${id === value}" data-setting="${name}" data-value="${id}">${label}</button>`).join("")}</div>`;
  const choice = (id) => `<button type="button" role="radio" aria-checked="${s.format === id}" class="ui-card ui-card--padded ui-card--interactive cc-choice" data-selected="${s.format === id || ""}" data-setting="format" data-value="${id}">
${s.format === id ? `<span class="ui-card-check" aria-hidden="true">${svg("check", 14)}</span>` : ""}<span class="cc-preview" data-preview="${pick.previews}" data-format="${id}">${pick.previews === "real" ? realPreview(id) : smallPreview(id)}</span>
<strong>${words(`settings.callCard.format.${id}`)}</strong><small>${words(`settings.callCard.format.${id}Hint`)}</small></button>`;
  return `<div class="settings-layout cc-settings"><nav class="settings-nav ui-nav">${nav}</nav><div class="settings-content"><div class="settings-column">
<section class="ui-section"><header class="ui-section-head"><div><h2 class="ui-section-title">${words("settings.section.call")}</h2><p class="ui-section-description">${words("settings.call.description")}</p></div></header>
<div class="ui-section-body"><div class="ui-group cc-card-group"><h3 class="ui-group-title">${words("settings.callCard.title")}</h3><div class="ui-group-card">
${row(words("settings.desktop.alwaysShown"), words("settings.desktop.alwaysShownHint"), toggle("always", s.alwaysShown))}
${row(words("settings.callCard.format"), words("settings.callCard.previewNote"), `<div class="cc-choices" role="radiogroup">${FORMATS.map((f) => choice(f.id)).join("")}</div>`, true)}
${row(words("settings.callCard.size"), "", segmented("size", { m: words("settings.callCard.size.m"), l: words("settings.callCard.size.l") }, s.size))}
${row(words("settings.callCard.position"), words("settings.callCard.positionHint"), `<button type="button" class="ui-button ui-button--secondary ui-button--sm" data-setting="reset"${s.place ? "" : " disabled"}><span class="ui-button-content">${words("settings.callCard.positionReset")}</span></button>`)}
</div></div><p class="settings-note muted">${pick.lang === "es" ? "El atajo para silenciar sigue en Atajos." : "The mute shortcut stays in Shortcuts."}</p></div></section></div></div></div>`;
}

/** A format's real card, small, with the person holding the microphone (onboarding's) and a sample conversation name:
 *  drawn still, at medium size, scaled into the choice. */
function realPreview(id) {
  const box = FORMATS.find((f) => f.id === id).sizes.m;
  const html = withCreature(SAMPLE, () => id === "card"
    ? `<div class="call-card cc-a1" style="--w:${box.w}px"><div class="card-row"><span class="cc-face" style="--tone:${SAMPLE.tone}">${avatar("small")}</span><div class="card-who"><span class="card-title"><span class="card-title-text">${call.title()}</span></span><span class="card-sub"><span class="card-machine">${svg("machine", 11)} <span>${call.machine}</span></span></span><span class="cc-state"><i class="cc-dot"></i><span>${pick.lang === "es" ? "Tu turno" : "Your turn"}</span></span></div>${yourWave()}</div></div>`
    : id === "pip" ? `<div class="cc-pip" style="--w:${box.w}px;--h:${box.h}px">${stage(box.h, { slots: false })}</div>`
      : `<span class="m-figure" style="--w:${box.w}px">${avatar("stage")}</span>`);
  // Its avatar holds still, awake and quiet: the animator leaves the previews alone.
  const still = html.replaceAll('data-style="bichos"', 'data-style="bichos" data-mood="idle" data-idle="quiet"');
  const scale = id === "mascot" ? 96 / box.w : 184 / box.w;
  return `<span class="cc-real" data-format="${id}"><span class="cc-real-box" style="transform:translate(-50%, -50%) scale(${scale})">${still}</span></span>`;
}

/** A format's small picture: the shapes of it, in the avatar's colour. */
function smallPreview(id) {
  const tone = creature().tone;
  if (id === "card") return `<i class="pv-card"><b style="background:${tone}"></b><i></i><i></i></i>`;
  if (id === "pip") return `<i class="pv-pip"><b style="background:${tone}"></b></i>`;
  return `<i class="pv-mascot"><b style="background:${tone}"></b></i>`;
}

function draw() { drawDesktop(); drawCard(); drawApp(); drawPanel(); save(); }

// ---------- what the buttons do ----------

/** As today's card: a click within CLICK_GUARD_MS of the controls appearing (or the card changing size) runs nothing, so
 *  a click meant for what was under the pointer never hits a button that just moved there. */
const CLICK_GUARD_MS = 350;
let guardUntil = 0;
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-run], [data-setting]");
  if (!target) return;
  if (target.closest("#card-window") && Date.now() < guardUntil) return;
  const run = target.dataset.run, setting = target.dataset.setting;
  if (run === "mute") setState(muted() ? "listening" : "muted");
  if (run === "skip") setState("idle");
  if (run === "captions") { pick.captions = settings().captions ? "0" : "1"; refresh(); }
  if (run === "hangup") { call.ended = true; drawCard(); }
  if (run === "again") { call.ended = false; call.since = Date.now(); drawCard(); }
  if (run === "open") { call.appOpen = true; pick.view = ""; drawCard(); drawApp(); }
  if (run === "minimise") { call.appOpen = false; drawCard(); drawApp(); }
  // The picture's gear: straight to Settings → Call → Floating call card.
  if (run === "card-settings") { call.appOpen = true; pick.view = "settings"; draw(); $("app-window").querySelector(".cc-card-group")?.scrollIntoView({ block: "start" }); }
  if (setting === "always") pick.always = settings().alwaysShown ? "0" : "1";
  if (setting === "format" || setting === "size") pick[setting] = target.dataset.value;
  if (setting === "reset") pick.x = pick.y = "";
  if (setting === "format" || setting === "size" || setting === "reset") preview();
  if (setting) refresh();
});
function refresh() { drawCard(); if (pick.view === "settings") drawApp(); drawPanel(); save(); }

function setState(state) {
  const was = call.state;
  call.state = state;
  pick.state = state;
  pick.cycle = "0";
  animator.entered(was);
  drawCard();
  drawPanel();
  save();
}

// Dragging the card: it follows the pointer anywhere; dropped, it stays where it was let go, kept inside the work area
// and against an edge when dropped near one (the desktop app's "free with magnet"). Its place is the setting it keeps.
let drag = null;
/** As today's card (card-shell.tsx): a press moves the card only past DRAG_THRESHOLD_PX, and only then is the pointer
 *  captured, so a click (a little jitter included) never moves it and never holds the pointer; the title counts as card. */
const DRAG_THRESHOLD_PX = 4;
$("card-window").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("button:not(.card-title)")) return;
  const win = $("card-window");
  drag = { x: event.clientX, y: event.clientY, dx: event.clientX - win.offsetLeft, dy: event.clientY - win.offsetTop, moved: false, id: event.pointerId };
});
addEventListener("pointermove", (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  const win = $("card-window");
  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) <= DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    win.setPointerCapture(event.pointerId);
    win.classList.add("dragging");
  }
  win.style.left = event.clientX - drag.dx + "px";
  win.style.top = event.clientY - drag.dy + "px";
});
$("card-window").addEventListener("pointercancel", () => { drag = null; $("card-window").classList.remove("dragging"); place(); });
// Released anywhere (a press that left the card before it moved ends too).
addEventListener("pointerup", () => {
  if (!drag) return;
  const win = $("card-window"), moved = drag.moved;
  drag = null;
  win.classList.remove("dragging");
  if (!moved) return;
  const at = dropAt({ x: win.offsetLeft, y: win.offsetTop }, cardSize(), workSize());
  pick.x = String(Math.round(at.x));
  pick.y = String(Math.round(at.y));
  place();
  drawPanel();
  if (pick.view === "settings") drawApp();
  save();
});

// ---------- the animator: what the app's avatar, balloons and card do between renders ----------

/** How long the avatar rests, quiet, before a pastime (sidevoice-web CharacterAvatar.tsx BORED_AFTER_MS). */
const BORED_AFTER_MS = 10_000;
const CYCLE = [["listening", 8000], ["working", 7000], ["speaking", 12000], ["idle", 14000], ["muted", 4000]];
const animator = (() => {
  let timers = [], raf = 0;
  let word = 0, beat = "a", work = null, workUntil = 0, idleStep = null, bored = false, enter = null, mouth = 0, personStep = 0;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const every = (fn, ms) => timers.push(setInterval(fn, ms));
  const scope = () => [$("card-window"), $("app-window")];
  const all = (selector) => scope().flatMap((root) => [...root.querySelectorAll(selector)]);
  const balloonUp = () => call.state === "speaking";

  /** The avatar's root attributes, as CharacterAvatar sets them. */
  function paint() {
    const st = STATES[call.state], c = creature();
    $("card-window").dataset.state = call.state;
    const working = st.mood === "working" && c.works.length ? work : undefined;
    const idle = st.mood === "idle" ? (bored && idleStep ? idleStep.idle : "quiet") : undefined;
    for (const el of all(".sv-avatar")) {
      if (el.closest(".cc-real")) continue;
      el.dataset.mood = st.mood;
      el.dataset.avatarState = st.mood;
      if (working) el.dataset.work = working; else delete el.dataset.work;
      if (idle) el.dataset.idle = idle; else delete el.dataset.idle;
      if (enter) el.dataset.enter = enter; else delete el.dataset.enter;
      if (st.mood !== "speaking") delete el.dataset.beat;
      el.toggleAttribute("data-desk", el.classList.contains("stage-agent") && st.mood === "working");
    }
    for (const tile of all(".stage-tile")) tile.dataset.mood = STAGE_MOOD[call.state];
    for (const text of all(".cc-state-text")) text.textContent = st.line;
    for (const btn of all(".card-mute")) {
      const label = muted() ? "Unmute" : "Mute";
      btn.innerHTML = svg(muted() ? "micOff" : "mic", 17);
      btn.title = btn.ariaLabel = label;
      btn.setAttribute("aria-pressed", String(muted()));
    }
    for (const mic of all(".card-mic")) mic.toggleAttribute("data-muted", muted());
    for (const skip of all('.card-skip[data-run="skip"]')) {
      skip.innerHTML = svg("skip", 17);
      skip.disabled = call.state !== "speaking";
      skip.title = skip.ariaLabel = "Skip reply";
    }
    const on = settings().captions;
    for (const btn of all(".card-captions")) {
      btn.innerHTML = svg(on ? "captions" : "captionsOff", 17);
      btn.title = btn.ariaLabel = words(on ? "card.captions.hide" : "card.captions.show");
      btn.setAttribute("aria-pressed", String(on));
    }
    for (const w of all(".your-wave")) { w.toggleAttribute("data-muted", muted()); w.toggleAttribute("data-still", false); }
    tickClock();
  }
  function tickClock() { for (const el of all(".card-clock")) el.textContent = clock(); }

  /** The agent's balloon's words: those said lit, the page turned so the line being said shows (PagedText). */
  function karaoke(said) {
    for (const line of all('.cc-line[data-role="assistant"]')) {
      line.querySelector(".karaoke-played").textContent = said;
      line.querySelector(".karaoke-upcoming").textContent = SAYS.slice(said.length);
    }
    for (const bubble of all(".stage-bubble")) {
      bubble.querySelector(".karaoke-played").textContent = said;
      bubble.querySelector(".karaoke-upcoming").textContent = SAYS.slice(said.length);
      const run = bubble.querySelector(".paged-text-run"), played = bubble.querySelector(".karaoke-played");
      const line = parseFloat(getComputedStyle(run).lineHeight) || 1;
      const shift = Number(run.dataset.shift || 0);
      const rects = played.getClientRects(), top = run.getBoundingClientRect().top + shift;
      const last = rects.length ? rects[rects.length - 1].bottom - top : 0;
      const page = Math.max(0, Math.floor((last - 1) / (3 * line)));
      run.dataset.shift = String(page * 3 * line);
      run.style.transform = `translateY(${-page * 3 * line}px)`;
    }
  }
  /** The balloons for the state: the agent's while it speaks, the person's while they do (bars, then what was sent). */
  function balloons() {
    for (const slot of all(".cc-agent-slot")) slot.innerHTML = call.state === "speaking" ? agentBalloon() : "";
    for (const turns of all(".person-turns")) {
      turns.innerHTML = call.state !== "listening" ? "" : personStep === 0 ? liveBalloon("listening") : personStep === 1 ? liveBalloon("transcribing") : sentBalloon();
    }
    for (const lines of all(".cc-lines")) lines.innerHTML = transcriptLines();
    tailsToward();
    if (call.state === "speaking") karaoke(SAYS.split(" ").slice(0, word).join(" "));
  }
  /** The title card's captions: what is being said as a transcript reads, a line per speaker, its name over it. */
  function transcriptLines() {
    if (call.state === "speaking") return `<p class="cc-line" data-role="assistant"><b>${call.title()}</b><span class="karaoke-text"><span class="karaoke-played"></span><span class="karaoke-upcoming">${SAYS}</span></span></p>`;
    if (call.state === "listening") return `<p class="cc-line" data-role="user"><b>${words("card.you")}</b>${personStep === 2 ? `<span>${HEARS}</span>` : `<span class="voice-wave" data-phase="${personStep === 1 ? "transcribing" : "listening"}" role="status"><canvas aria-hidden="true"></canvas></span>`}</p>`;
    return "";
  }
  /** The output level, as the room's voice publishes it while a reply sounds (preview/mock/voice.mjs: every 80 ms,
   *  speechLevel, one silent slice in five; 0 between sentences), on the web's own channel (state/playback-level.ts). */
  const playback = createPlaybackLevelChannel();
  let sounding = false, soundingSince = 0, says = 0;
  setInterval(() => {
    if (!sounding) return;
    const elapsed = Date.now() - soundingSince;
    playback.publish(Math.floor(elapsed / 80) % 5 === 4 ? 0 : speechLevel(elapsed, says * 1.7), "call");
  }, 80);
  /** The stage avatars' mouths, as CharacterAvatar's "playback" effect follows the channel: each sample smoothed
   *  (smoothPlaybackLevel), a sample older than 300 ms read as silence, and back to rest 300 ms after the last. */
  let shown = 0, stale = 0;
  playback.subscribe(function paintMouth(sample) {
    let level = call.state === "speaking" && sample.threadId === "call" ? sample.level : 0;
    if (level > 0 && Date.now() - sample.receivedAt >= 300) level = 0;
    shown = smoothPlaybackLevel(shown, level);
    for (const el of all('.sv-avatar[data-mouth="playback"]')) {
      el.style.setProperty("--mouth", String(shown));
      if (shown > 0) el.setAttribute("data-mouth-active", ""); else el.removeAttribute("data-mouth-active");
    }
    clearTimeout(stale);
    if (shown > 0) stale = setTimeout(() => paintMouth({ threadId: "call", level: 0, receivedAt: Date.now() }), Math.max(0, sample.receivedAt + 300 - Date.now()));
  });
  function speak() {
    const all_ = SAYS.split(" ");
    if (word >= all_.length) { sounding = false; playback.publish(0, "call"); later(() => { word = 0; balloons(); speak(); }, 2600); return; }
    if (!sounding) { sounding = true; soundingSince = Date.now(); says += 1; }
    word += 1;
    beat = beat === "a" ? "b" : "a";
    for (const el of all('.sv-avatar[data-mouth="voice"]')) el.dataset.beat = beat;
    karaoke(all_.slice(0, word).join(" "));
    // Between sentences the voice is silent (the mock's quiet() between chunks).
    if (/[.?!]$/.test(all_[word - 1])) { sounding = false; playback.publish(0, "call"); later(() => { sounding = true; soundingSince = Date.now(); speak(); }, 650); }
    else later(speak, /,$/.test(all_[word - 1]) ? 650 : 180 + Math.random() * 240);
  }
  /** The person's turn: speaking 3.5 s (the bars move), transcribed 1 s (they hold and blink), sent 2.5 s (PAGE_MS-ish). */
  function personTurn() {
    if (personStep === 1) for (const wave of all('.voice-wave[data-phase="listening"]')) wave.dataset.phase = "transcribing";
    else balloons();
    if (personStep === 0) { heardSince = performance.now(); columns.length = 0; }
    later(() => { personStep = (personStep + 1) % 3; personTurn(); }, [3500, 1000, 2500][personStep]);
  }
  /** The voice's bars as VoiceWaveform paints them on the stage (pitch 6, bar 3): newest at the right, a column every
   *  55 ms, silences adding none; frozen while transcribed. */
  const columns = [];
  let lastColumn = 0, heardSince = performance.now();
  function frame(now) {
    for (const canvas of all('.voice-wave[data-phase="listening"] canvas')) {
      const ratio = devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
      if (!width || !height) continue;
      if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
      if (now - lastColumn >= 55) {
        lastColumn = now;
        // The microphone's level as the mocked room's voice reports it while you speak (speechLevel); silence adds none.
        const value = speechLevel(now - heardSince, 0.7);
        if (value >= 0.04) columns.push(value);
      }
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const capacity = Math.max(1, Math.floor(width / 6));
      while (columns.length > capacity) columns.shift();
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;
      context.beginPath();
      for (let slot = 0; slot < capacity; slot += 1) {
        const bar = Math.max(2, (columns[columns.length - 1 - slot] ?? 0) * (height - 2));
        context.roundRect(width - 3 - slot * 6, height / 2 - bar / 2, 3, bar, 1.5);
      }
      context.fill();
    }
    // Your microphone's wave in today's card (useWave): the level while you speak.
    for (const w of all(".your-wave")) {
      [...w.children].forEach((bar, i) => {
        const live = call.state === "listening" && !muted();
        bar.style.height = live ? Math.max(3, Math.round((20 + Math.random() * 80) * (1 - Math.abs(i - 5) / 7) * 0.16)) + "px" : "";
      });
    }
    raf = requestAnimationFrame(frame);
  }
  /** The work in hand and the idle step, as rotation.ts picks them (the engine's nextWork/workTurn, nextIdle). */
  function rotate() {
    const c = creature(), now = Date.now();
    if (STATES[call.state].mood === "working" && c.works.length && (!work || now >= workUntil)) {
      work = nextWork(work, c.works);
      workUntil = now + workTurn(work);
      paint();
    }
    if (bored && c.idles.length && (!idleStep || now >= idleStep.until)) {
      const next = nextIdle(idleStep, c.idles);
      idleStep = { ...next, until: now + next.ms };
      paint();
    }
  }
  return {
    /** The startle into listening (enterFrom), for ENTER_MS. */
    entered(was) {
      enter = enterFrom(STATES[was]?.mood, STATES[call.state].mood);
      if (enter) setTimeout(() => { enter = null; paint(); }, ENTER_MS);
    },
    restart() {
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      timers = [];
      cancelAnimationFrame(raf);
      word = 0; personStep = 0; bored = false; idleStep = null; sounding = false; playback.publish(0, "call"); heardSince = performance.now(); columns.length = 0;
      if (STATES[call.state].mood !== "working") work = null;
      paint();
      balloons();
      raf = requestAnimationFrame(frame);
      every(tickClock, 1000);
      every(rotate, 500);
      rotate();
      if (call.state === "speaking") speak();
      if (call.state === "listening") later(() => { personStep = 1; personTurn(); }, 3500);
      // Resting, it is quiet BORED_AFTER_MS before a pastime; under a balloon it holds still.
      if (STATES[call.state].mood === "idle" && !balloonUp()) later(() => { bored = true; rotate(); }, BORED_AFTER_MS);
      if (pick.cycle === "1") {
        const at = CYCLE.findIndex(([state]) => state === call.state);
        const [, ms] = CYCLE[at] ?? CYCLE[0];
        later(() => { const was = call.state; call.state = CYCLE[(at + 1) % CYCLE.length][0]; pick.state = call.state; animator.entered(was); save(); drawCard(); drawPanel(); }, ms);
      }
    },
  };
})();

// ---------- the panel ----------

function select(name, label, options, value) {
  return `<label>${label}<select data-pick="${name}">${options.map(([v, text]) => `<option value="${v}"${v === value ? " selected" : ""}>${text}</option>`).join("")}</select></label>`;
}

function drawPanel() {
  const s = settings();
  $("source").textContent = source.replace(/@(\w{7})\w+/, "@$1");
  $("controls").innerHTML = [
    select("env", "Desktop", Object.entries(DESKTOPS).map(([id, d]) => [id, d.label]), pick.env),
    select("format", "Format", FORMATS.map((f) => [f.id, f.label]), s.format),
    select("size", "Size", Object.entries(SIZES), s.size),
    `<label class="check"><input type="checkbox" data-pick="captions"${s.captions ? " checked" : ""}> Captions (as the card's own button)</label>`,
    select("state", "Call state", Object.entries(STATES).map(([id, st]) => [id, st.label]), call.state),
    `<label class="check"><input type="checkbox" data-pick="cycle"${pick.cycle === "1" ? " checked" : ""}> Cycle through the states</label>`,
    select("creature", "Conversation", CREATURES.map((c) => [c.id, c.seed === "Sidevoice" ? "Sidevoice mascot" : c.seed]), creature().id),
    select("theme", "System theme", [["", `The desktop's (${env().theme})`], ["dark", "Dark"], ["light", "Light"]], pick.theme),
    `<label class="check"><input type="checkbox" data-pick="motion"${pick.motion === "reduced" ? " checked" : ""}> Reduced motion</label>`,
    `<div class="place"><span>Place: ${s.place ? `${s.place.x}, ${s.place.y} px` : "first place (top right)"}</span><button type="button" data-action="place-reset"${s.place ? "" : " disabled"}>Reset</button></div>`,
    `<div class="panel-settings"><button type="button" data-action="settings">Open the settings mock</button>${select("lang", "Its language", [["en", "English"], ["es", "Español"]], pick.lang)}${select("pipTitle", "Picture's title", [["bottom", "Bottom left"], ["top", "One line at the top"]], pick.pipTitle)}${select("previews", "Its style previews", [["small", "(a) Small pictures"], ["real", "(b) The real card"]], pick.previews)}</div>`,
    `<details class="panel-map"><summary>The settings, as stored</summary><pre>${JSON.stringify({ callControls: { alwaysShown: s.alwaysShown, places: s.place ? { "<display>": s.place } : {}, card: { format: s.format, size: s.size, captions: s.captions } } }, null, 2)}</pre>
<p><code>alwaysShown</code> and <code>places</code> are the desktop app's today; <code>card</code> is new. Settings sets <code>format</code> and <code>size</code>; only the card's own button sets <code>captions</code>.</p></details>`,
  ].join("");
}

$("controls").addEventListener("change", (event) => {
  const name = event.target.dataset.pick;
  if (!name) return;
  if (name === "cycle") pick.cycle = event.target.checked ? "1" : "0";
  else if (name === "captions") pick.captions = event.target.checked ? "1" : "0";
  else if (name === "motion") pick.motion = event.target.checked ? "reduced" : "full";
  else pick[name] = event.target.value;
  if (name === "state") { const was = call.state; call.state = pick.state; pick.cycle = "0"; animator.entered(was); }
  if (name === "creature" || name === "env") call.appOpen = false;
  document.body.classList.toggle("reduce-motion", pick.motion === "reduced");
  draw();
});
$("controls").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "place-reset") { pick.x = pick.y = ""; refresh(); }
  if (action === "settings") { call.appOpen = true; pick.view = "settings"; draw(); }
});

const panel = $("panel");
const togglePanel = (open = panel.classList.contains("closed")) => { panel.classList.toggle("closed", !open); pick.panel = open ? "1" : "0"; save(); };
panel.querySelector(".panel-header").addEventListener("click", () => togglePanel());
addEventListener("keydown", (event) => { if (event.altKey && event.shiftKey && event.code === "KeyC") togglePanel(); });
panel.classList.toggle("closed", pick.panel === "0");
document.body.classList.toggle("reduce-motion", pick.motion === "reduced");
call.appOpen = pick.view === "settings";

draw();
