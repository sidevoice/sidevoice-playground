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

// What earlier rounds of this page stored (sizes laid out for other layouts) is dropped once: no compatibility.
const STORE_VERSION = "14";
if (localStorage.getItem("sidevoice.callcard.version") !== STORE_VERSION) {
  for (const key of Object.keys(localStorage)) if (key.startsWith("sidevoice.callcard.")) localStorage.removeItem(key);
  localStorage.setItem("sidevoice.callcard.version", STORE_VERSION);
}
const { source, creatures: ALL_CREATURES, marks: MARKS } = await (await fetch("/callcard/creatures.json")).json();
/** The conversations' avatars (the generated set also has the person holding the microphone, unused here). */
const CREATURES = ALL_CREATURES.filter((each) => !each.id.startsWith("person:"));

// Today's card answers the system's light or dark (call-card.css, prefers-color-scheme): here, the simulated
// desktop's. The copy is loaded with that query turned into the card window's [data-scheme=light] (CSS nesting).
{
  const css = await (await fetch("/callcard/call-card.css")).text();
  const style = document.createElement("style");
  style.textContent = css.replaceAll("@media (prefers-color-scheme: light) {", ":is(#card-window, .cc-card-picture)[data-scheme=light] {");
  document.head.append(style);
}

// ---------- what is picked: the address's hash ----------

/** Captions are on unless turned off; the choice is kept across sessions (the app: with the card's settings). */
const CAPTIONS_KEY = "sidevoice.callcard.captions";
const DEFAULTS = { env: "windows", card: "1", format: "pip", size: "m", captions: localStorage.getItem(CAPTIONS_KEY) ?? "1", always: "0", x: "", y: "", state: "speaking",
  cycle: "0", unread: "1", c1Layout: "card", creature: CREATURES[0].id, theme: "", motion: "full", panel: "1", view: "", lang: "en", a1Head: "corner", settingsPlace: "call", listFrom: "element", startCorner: "tr", pipIcons: "hover", c1Style: "minimal", pipBar: "always", pipActions: "header", pipTitle: "bottom", pipLayout: "meet" };
const pick = { ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) };
// Choices decided on 2026-10-20 leave the address: the unread cue (now "!"), and what C1's handle opens (the card).
delete pick.unreadCue;
delete pick.c1Actions;
const save = () => {
  const changed = Object.entries(pick).filter(([key, value]) => value !== DEFAULTS[key]);
  history.replaceState(null, "", "#" + new URLSearchParams(changed).toString());
};
const env = () => DESKTOPS[pick.env] ?? DESKTOPS.windows;
/** Whose avatar a card shows (the card, the card shown after a change, Settings' previews): the active conversation's; with
 *  none active, the first conversation in the list's; with no conversation at all, the default creature (Sidevoice's). */
const DEFAULT_CREATURE = ALL_CREATURES.find((each) => each.id === "mascot:sidevoice");
const CONVERSATION_LIST = CREATURES.filter((each) => each !== DEFAULT_CREATURE);
/** The avatar drawn: the picked conversation's, or another for a while (withCreature: the settings' real previews). */
let drawing = null;
const creature = () => drawing ?? CREATURES.find((each) => each.id === pick.creature) ?? CONVERSATION_LIST[0] ?? DEFAULT_CREATURE;
const withCreature = (c, draw) => { const was = drawing; drawing = c; try { return draw(); } finally { drawing = was; } };
/** The settings the card is drawn from: the stored shape (formats.mjs SETTING_DEFAULTS), read from the address. */
const settings = () => cardSettings({ enabled: pick.card !== "0", format: pick.format, size: pick.size, captions: pick.captions === "1", alwaysShown: pick.always === "1", place: pick.x !== "" && pick.y !== "" ? { x: Number(pick.x), y: Number(pick.y) } : null });
const format = () => FORMATS.find((each) => each.id === settings().format);
/** The person is speaking: listening, or held recording (the mock state). */
const hearing = () => call.state === "listening" || call.state === "recording";
const words = (key) => COPY[key][pick.lang] ?? COPY[key].en;

// ---------- the mock call ----------

/** The room's conversations, as the card's picker lists them (ParticipantView: machine, model, reach, working). */
const CONVERSATIONS = {
  "Orquestador Sidevoice": { machine: "MacBook-Pro", model: "opus · high", reach: "listening", working: true },
  "Refactor del relay": { machine: "build-server", model: "gpt-5 · medium", reach: "listening" },
  "Landing nueva": { machine: "MacBook-Pro", model: "sonnet", reach: "holding" },
  "Tests de la voz": { machine: "linux-box", model: "opus", reach: "offline" },
  // A long title, to check where the title line truncates; and a short one, which shows whole (operator, 2026-10-20).
  "Actualización del servicio desktop 67": { machine: "MacBook-Pro", model: "opus · high", reach: "listening", unread: 2 },
  "Pulir nightly": { machine: "build-server", model: "gpt-5 · medium", reach: "listening", unread: 1 },
  "mascot:sidevoice": { machine: "MacBook-Pro", model: "opus · high", reach: "listening" },
};
const facts = (c = creature()) => CONVERSATIONS[c.id] ?? CONVERSATIONS["Orquestador Sidevoice"];
/** Whether a conversation has replies you haven't seen (the web's hasUnread: never the one on the call). The mock's
 *  unread replies can be turned off in the panel. */
const unread = (c) => pick.unread === "1" && (facts(c).unread ?? 0) > 0 && c.id !== creature().id;
const unreadCount = () => CREATURES.filter(unread).length;
const call = {
  state: pick.state in STATES ? pick.state : "speaking",
  title: () => creature().seed === "Sidevoice" ? "Sidevoice" : creature().seed,
  get machine() { return facts().machine; },
  get model() { return facts().model; },
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
  // The captions' toggle: lucide's Captions (a rounded screen with two short lines of text, the CC kind), crossed out by
  // CaptionsOff; the set the web's Icons.tsx draws with, at its stroke. The web has no captions mark yet (sidevoice-web#239).
  captions: '<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
  captionsOff: '<path d="M10.5 5H19a2 2 0 0 1 2 2v8.5"/><path d="M17 11h-.5"/><path d="M19 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2"/><path d="m2 2 20 20"/><path d="M7 11h4"/><path d="M7 15h2.5"/>',
  machine: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  conversations: '<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/>',
  chevronsUpDown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  moreH: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
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

const STAGE_MOOD = { listening: "listening", recording: "listening", speaking: "speaking", working: "working", muted: "idle", idle: "idle" };
const TAILS = { agent: "M16 1C16 12 22 24 30 31Q36 36 38 30C40 22 38 12 38 1", person: "M24 1C24 14 40 28 64 36C52 26 46 14 46 1" };
function tail(shape) {
  const ink = TAILS[shape], start = /^M([\d.]+) /.exec(ink)[1], end = /([\d.]+) 1$/.exec(ink)[1];
  return `<svg class="balloon-tail" data-tail="${shape}" viewBox="0 0 72 40" aria-hidden="true"><path class="tail-fill" d="M${start} 0L${ink.slice(1)}L${end} 0Z"/><path class="tail-ink" d="${ink}"/></svg>`;
}
/** The room's stage tile, `height` px tall: the conversation's name and machine in its corner, the avatar on its backdrop
 *  with its desk, and the slots the balloons go in — the agent's over its head, the person's at the tile's foot. */
function stage(height, { slots = true, nameExtra = "", name = true } = {}) {
  const c = creature(), d = c.deskColours;
  return `<div class="stage-tile" data-theme="dark" data-mood="${STAGE_MOOD[call.state]}" style="--k:${height / 440};--av-color:${c.tone}">
<div class="stage-canvas"><div class="stage-scene"><div class="stage-backdrop" aria-hidden="true">${ownIds(c.backdrop)}</div>${avatar("stage", "stage-agent")}
<div class="stage-desk" aria-hidden="true" style="--desk-top:${d.top};--desk-top-deep:${d.topDeep};--desk-front:${d.front};--desk-front-deep:${d.frontDeep}">${ownIds(c.desk)}</div></div></div>
${name ? "" : "<!--"}<div class="stage-name" translate="no"><h2><span class="stage-heading"><span class="stage-heading-name"><span>${call.title()}</span></span><span class="stage-machine">${svg("machine", 12)}<span>${call.machine}</span></span></span></h2>${nameExtra}</div>${name ? "" : "-->"}
${slots ? '<div class="stage-top cc-agent-slot"></div>' : ""}<div class="stage-tags">${badge()}</div>${slots ? '<div class="person-turns"></div>' : ""}</div>`;
}
/** The agent's harness, model and effort at the tile's foot (CallStage AgentBadge; Icons.tsx HarnessIcon's mark). */
const badge = () => `<span class="stage-tag stage-badge"><span class="ui-logo" style="display:inline-block;flex:none;width:12px;height:12px;line-height:0" aria-hidden="true">${MARKS.claude.replace("<svg ", '<svg width="100%" height="100%" ')}</span><span>${call.model}</span></span>`;
/** The agent's balloon (AgentBubble): three lines a page (PagedText), its words lit as they are said (KaraokeText). */
const agentBalloon = () => `<div class="speech-bubble stage-bubble" data-visible="" aria-hidden="true" translate="no"><span class="paged-text" data-turn="page" style="--paged-lines:3"><span class="paged-text-run"><span class="karaoke-text" data-playback="playing" data-progress="true"><span class="karaoke-played"></span><span class="karaoke-upcoming">${SAYS}</span></span></span></span><svg class="balloon-shine" viewBox="0 0 40 20" aria-hidden="true"><path d="M3 17Q5 4 24 3"/></svg>${tail("agent")}</div>`;
/** The person's balloon while they speak and while it is transcribed (LiveVoiceBalloon): the voice's bars. */
/** The room's way to take the turn back while it is recorded or transcribed (PersonTurn: Button ghost, neutral, small,
 *  "cancel-input", stage.cancelTurn), where the room has it: in your own balloon, under the bars. */
const cancelTurn = () => `<button type="button" class="ui-button ui-button--ghost ui-button--neutral ui-button--sm cancel-input" data-run="cancel-turn" title="${words("stage.cancelTurn")}"><span class="ui-button-content">${words("stage.cancelTurn")}</span></button>`;
const liveBalloon = (phase) => `<div class="speech-bubble person-bubble" data-live="" translate="no"><span class="voice-wave" data-phase="${phase}" role="status"><canvas aria-hidden="true"></canvas></span><div class="person-live-actions">${cancelTurn()}</div>${tail("person")}</div>`;
/** What was sent, for its moment (PersonTurn SentBubble). */
const sentBalloon = () => `<div class="speech-bubble person-bubble" data-sent="" translate="no"><span class="person-said">${HEARS}</span>${tail("person")}</div>`;
/** A card's captions, opening below or above it (data-open, place()): for the avatar, the room's balloons, the agent's
 *  at the left and yours at the right; for the title card, plain lines as a transcript reads (.cc-lines). */
const balloonCaptions = () => `<div class="cc-captions cc-balloons" data-theme="dark"><div class="cc-agent-slot"></div><div class="person-turns"></div></div>`;
const lineCaptions = () => `<div class="cc-captions call-card cc-lines" data-theme="${scheme()}"></div>`;

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

/** The room's call bar (CallToolbar, CallIndicators, AudioDevices): the microphone's pill with its level and devices,
 *  skip and the call, centred (not ⋮: nothing of it belongs on a picture); the captions' toggle beside skip, the room's
 *  own to come (a later web change). */
const roomBar = () => `<footer class="call-bar pip-bar"><div class="controls" id="call-controls"><div class="call-actions">
<div id="mic-control" class="mic-control" data-muted="false"><button type="button" class="audio-devices-toggle" aria-label="Microphone and speaker"><span class="mic-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>${svg("chevron", 18).replace("<svg ", '<svg class="audio-chevron" ')}</button><button type="button" id="mute" class="ui-button ui-button--ghost call-button" data-run="mute"></button></div>
<button type="button" class="ui-button ui-button--ghost call-button card-captions" data-run="captions"></button>
<button type="button" id="skip-reply" class="ui-button ui-button--ghost call-button card-skip" data-run="skip"></button>
<button type="button" id="connect" class="ui-button ui-button--primary call-button joined" data-run="hangup" title="Hang up" aria-label="Hang up">${svg("hangup", 22)}</button></div></div></footer>`;

// ---------- the conversation picker (call-controls/card-shell.tsx ConversationPicker; room/ConversationRows.tsx) ----------

let pickerOpen = false;
const REACH = { holding: { en: "can't receive", es: "no puede recibir" }, offline: { en: "offline", es: "sin conexión" } };
/** The room's conversations, a row each: its avatar and state, its title, its machine and model (and why it can't be
 *  reached); the one on the card selected. Picking one moves the call (and the card) to it. */
/** The harness's mark beside its model, as the web's HarnessIcon draws it (Icons.tsx logo(): Codex's at 1.6). */
function harnessMark(model) {
  const codex = /^gpt/.test(model), scale = codex ? 1.6 : 1, inset = ((scale - 1) / 2) * -100;
  const mark = MARKS[codex ? "codex" : "claude"].replace("<svg ", `<svg width="${scale * 100}%" height="${scale * 100}%" style="margin:${inset}%" `);
  return `<span class="ui-logo" style="display:inline-block;flex:none;width:11px;height:11px;line-height:0" aria-hidden="true">${mark}</span>`;
}
function picker() {
  const rows = CREATURES.map((c) => {
    const f = facts(c), selected = c.id === creature().id, title = c.seed === "Sidevoice" ? "Sidevoice" : c.seed;
    const reach = REACH[f.reach]?.[pick.lang] ?? REACH[f.reach]?.en;
    const face = withCreature(c, () => avatar("small")).replace('data-style="bichos"', `data-style="bichos" data-mood="idle" data-idle="quiet"${unread(c) ? " data-unread" : ""}`);
    return `<div class="participant-row" data-thread="${c.id}"${selected ? " data-selected" : ""}><button type="button" class="person" data-reach="${f.reach}" aria-pressed="${selected}" data-conversation="${c.id}" title="${title}"${f.reach === "offline" ? " disabled" : ""}>
<span class="cc-row-face" aria-hidden="true">${face}</span><span class="person-state" data-state="${f.reach}"${f.working ? " data-working" : ""}><span class="dot"></span></span>
<span class="participant-copy"><span class="person-name" translate="no">${title}</span><span class="person-sub muted"><span class="person-machine">${svg("machine", 11)} ${f.machine}</span><span class="person-harness">${harnessMark(f.model)} ${f.model}</span>${reach ? `<span class="person-reach"> · ${reach}</span>` : ""}</span></span></button>${unread(c) ? '<span class="card-unread" role="img" aria-label="Unread message"></span>' : ""}</div>`;
  }).join("");
  return `<div class="call-card cc-picker" role="dialog" aria-label="Conversations"><div class="card-panel conversations"><div class="card-conversations">${rows}</div></div></div>`;
}
/** C1: its name reveals the row of conversations (a click), and hides it again. */
let c1RowOpen = false;
/** The title's ▾ opens what the call runs on, as in the room (CallDetails), never the list. */
let detailsOpen = false;
const titleAttrs = () => `data-run="switch" aria-haspopup="dialog" aria-expanded="${pickerOpen}" title="Switch conversation"`;
const switchAttrs = () => `data-run="switch" aria-haspopup="dialog" aria-expanded="${pickerOpen}"`;
function details() {
  const f = facts();
  const row = (label, value) => `<div class="cc-detail"><dt>${label}</dt><dd>${value}</dd></div>`;
  return `<div class="call-card cc-details" role="dialog" aria-label="Call details"><dl>${row("Machine", f.machine)}${row("Agent", "Claude Code · " + f.model)}${row("Transcription", "whisper-small")}${row("Voice", "Kokoro · Alba")}${row("End of turn", "Smart")}</dl></div>`;
}
/** The phone's way to the conversations (RoomHeader, header-row.ts), compact: a few avatars (the one on the call marked,
 *  kept in the row), "+" for a new one, and the chevron with how many are not in the row, which drops the whole list. */
/** The phone's switcher (RoomHeader, header-row.ts, room.css): the conversations' avatars, the one on the call marked,
 *  one tap to move the call; then its own chevron, ▾ and ▴ while the list is down, which drops them all. Apart from the
 *  title, which opens nothing. As the room narrows the avatars go first; the chevron always stays. */
function switcher(slots = 3) {
  const current = creature();
  if (slots <= 0) return `<div class="cc-switcher header-conversations"><button type="button" class="conversations-toggle" ${switchAttrs()} aria-label="All conversations (${CREATURES.length})" title="All conversations">${svg("chevron", 16)}</button></div>`;
  const first = CREATURES.slice(0, slots);
  const row = first.includes(current) ? first : [...CREATURES.filter((c) => c !== current).slice(0, slots - 1), current];
  const face = (c) => withCreature(c, () => avatar("small")).replace('data-style="bichos"', 'data-style="bichos" data-mood="idle" data-idle="quiet"');
  return `<div class="cc-switcher header-conversations">${row.map((c) => { const f = facts(c), title = c.seed === "Sidevoice" ? "Sidevoice" : c.seed;
    return `<button type="button" class="header-avatar" data-conversation="${c.id}" aria-pressed="${c === current}" title="${title}" aria-label="${title}"${f.reach === "offline" ? ' aria-disabled="true"' : ""}><span class="conversation-avatar" style="--tone:${c.tone}">${face(c)}<span class="person-state" data-state="${f.reach}"${f.working ? " data-working" : ""}><span class="dot"></span></span></span></button>`; }).join("")}<button type="button" class="conversations-toggle" ${switchAttrs()} aria-label="All conversations (${CREATURES.length})" title="All conversations">${svg("chevron", 16)}</button></div>`;
}
function switchRow(slots = 3) {
  const current = creature();
  const first = CREATURES.slice(0, slots);
  const row = first.includes(current) ? first : [...CREATURES.filter((c) => c !== current).slice(0, slots - 1), current];
  const rest = CREATURES.length - row.length;
  const face = (c) => withCreature(c, () => avatar("small")).replace('data-style="bichos"', 'data-style="bichos" data-mood="idle" data-idle="quiet"');
  return `<div class="cc-switch-row header-conversations">${row.map((c) => { const f = facts(c), title = c.seed === "Sidevoice" ? "Sidevoice" : c.seed;
    return `<button type="button" class="header-avatar" data-conversation="${c.id}" aria-pressed="${c === current}" title="${title}" aria-label="${title}"${f.reach === "offline" ? ' aria-disabled="true"' : ""}><span class="conversation-avatar" style="--tone:${c.tone}">${face(c)}<span class="person-state" data-state="${f.reach}"${f.working ? " data-working" : ""}><span class="dot"></span></span></span></button>`; }).join("")}
<button type="button" class="header-new" title="New conversation" aria-label="New conversation">${svg("plus", 15)}</button>
<button type="button" class="conversations-toggle cc-more" ${switchAttrs()} aria-label="All conversations (${CREATURES.length}${rest ? `, ${rest} more` : ""})" title="All conversations">${svg("moreH", 16)}</button></div>`;
}

// ---------- the formats ----------

/** How many avatars A1's switcher shows by its size: the chevron alone at Small (its face shows the one on the call). */
const A1_AVATARS = { s: 0, m: 2, l: 3 };
/** The system's theme as the card sees it (the desktop's, or the panel's pick): the room's tokens follow it. */
const scheme = () => (pick.theme || env().theme) === "light" ? "light" : "dark";
const DRAW = {
  // A1: the row and the two actions on a top line, near the pointer; the title's ▾ opens the call's details.
  card: () => `<div class="cc"><div class="call-card cc-a1" data-head="${pick.a1Head === "inline" ? "inline" : "corner"}"><div class="card-row"><span class="cc-face" style="--tone:${creature().tone}">${avatar("small")}</span>
<div class="card-who"><span class="card-title"><span class="card-title-text" title="${call.title()}">${call.title()}</span>${conversationsButton()}</span>
<span class="card-sub"><span class="card-machine">${svg("machine", 11)} <span>${call.machine}</span></span><span aria-hidden="true">·</span><span class="card-harness"><span>${call.model}</span></span></span>
<span class="cc-state"><i class="cc-dot"></i><span class="cc-state-text"></span></span></div>
${yourWave()}</div>${controls()}<span class="a1-corner">${frameActions()}</span></div>${settings().captions ? lineCaptions() : ""}</div>`,
  pip: (box) => DRAW.pipMeet(box),
  // B1, stacked: the room's header (the name ▾, the row, the two actions), the stage, the room's call bar.
  pipMeet: (box) => {
    const canvas = Math.round((box.w - 20) * 9 / 16), corner = false, sized = customHeight();
    return `<div class="cc cc-pip-stacked cc-pip-meet" data-theme="${scheme()}" data-icons="${pick.pipIcons === "always" ? "always" : "hover"}" data-bar="${pick.pipBar === "hover" ? "hover" : "always"}"${sized ? ` data-sized style="height:${sized}px"` : ""}>${pipHead2(!corner)}<div class="pip-canvas"${sized ? "" : ` style="height:${canvas}px"`}>${stage(canvas, { name: false })}${corner ? `<span class="pip-frame-actions stage-tag">${frameActions()}</span>` : ""}</div><div class="pip-bar-below">${roomBar()}</div></div>`;
  },
  // C1: on nothing; near the pointer, its name (a pill of the controls' width, or none), its controls and its row.
  // C1 (a) minimal: at rest the avatar alone; near the pointer, a slim pill over it (its name, which shows the row of
  // conversations, and the two actions) and the room's call bar under it. (b) a base: the avatar stands on a small
  // plinth with its name and machine; the call bar comes out of it near the pointer.
  // C1: the avatar floating on nothing, and one stack going out from it toward the middle of the screen (below it in the
  // upper half, above it in the lower), in one order: the avatar, its balloons, then the dock. The window is the avatar's
  // box alone, so nothing grows into it: the avatar never moves, and the dock, at the stack's far end, never pushes the
  // balloons. The dock is B1's top bar and call bar on one card (the same parts, the same look), near the pointer.
  // C1 (operator's pick, A): the dock is its own piece, not the stack's end: below (or above) the avatar when nothing is
  // said, and beside it, on its open side and level with it, while a balloon is up, so the two never pile up.
  mascot: () => `<div class="cc c1x"><span class="m-figure">${avatar("stage")}</span><div class="c1x-stack">${settings().captions ? balloonCaptions() : ""}</div>${c1Handle()}<div id="c1-controls" class="cc-pip-stacked cc-pip-meet c1-dock" data-theme="${scheme()}" data-icons="hover" data-bar="always">${pipHead2(true)}<div class="pip-bar-below">${roomBar()}</div></div></div>`,
};
/** The picture's three actions: back to the call, its settings, and hiding it for this call. */
const frameActions = () => `<button type="button" class="cc-action" data-run="open" title="Back to the call" aria-label="Back to the call">${svg("open", 15)}</button><button type="button" class="cc-action" data-run="card-settings" title="Floating card settings" aria-label="Floating card settings">${svg("settings", 15)}</button><button type="button" class="cc-action pip-close" data-run="dismiss" title="Hide the picture for this call" aria-label="Hide the picture for this call">${svg("close", 15)}</button>`;
/** The picture's header, on two lines: the name ▾ (and the three actions), then its machine, never cut, and the row. */
const pipHead2 = (withActions) => `<header class="stage-title pip-head pip-head-1" translate="no" style="--av-color:${creature().tone}"><h2><span class="stage-heading"><span class="stage-heading-name"><span class="pip-title" title="${call.title()}">${call.title()}</span>${conversationsButton()}</span><span class="stage-machine">${svg("machine", 12)}<span>${call.machine}</span></span></span></h2>${withActions ? (pick.pipIcons === "always" ? `<span class="pip-head-actions">${frameActions()}</span>` : `<span class="pip-hover-icons">${frameActions().replace(/<button[^>]*pip-close[\s\S]*$/, "")}</span><span class="pip-head-x">${frameActions().match(/<button[^>]*pip-close[\s\S]*$/)[0]}</span>`) : ""}</header>`;
/** The picture's way to the other conversations: one small button, the web's conversations mark and how many there
 *  are; it drops the list. No faces: in a small picture they were noise. */
const conversationsButton = () => {
  const n = unreadCount(), said = n ? `, ${n} with unread replies` : "";
  return `<button type="button" class="cc-convs" ${switchAttrs()} aria-label="Conversations (${CREATURES.length})${said}" title="Conversations${said}">${svg("conversations", 15)}<span>${CREATURES.length}</span>${svg("chevron", 12).replace("<svg ", '<svg class="cc-convs-chevron" ')}${n ? unreadMark() : ""}</button>`;
};
/** The header's unread cue (DECIDED, operator 2026-10-20): the list's own "!" (the avatars' tag, bichos .bang: yellow, its
 *  dark outline and a heavy "!") on the conversations control's corner. Decorative: the control's name says it. */
const unreadMark = () => '<span class="cc-unread-bang" aria-hidden="true"><svg viewBox="-10.5 -13.5 21 27"><rect x="-9" y="-12" width="18" height="24" rx="6"/><text y="7" text-anchor="middle">!</text></svg></span>';
/** The picture's header: the name with its ▾ (and its machine), the row, and, stacked, the two actions. */

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
  const s = settings(), f = format(), win = $("card-window");
  const custom = customWidth(f.id);
  const box = custom ? { w: custom, ...(f.id === "pip" ? { h: Math.round(custom * 9 / 16) } : {}) } : f.sizes[s.size];
  Object.assign(win.dataset, { theme: "dark", format: f.id, size: s.size, captions: s.captions ? "on" : "off",
    scheme: pick.theme || env().theme });
  win.style.setProperty("--w", box.w + "px");
  if (box.h) win.style.setProperty("--h", box.h + "px"); else win.style.removeProperty("--h");
  win.style.setProperty("--margin", PLACEMENT.margin + "px");
  // In front of the room the card hides (unless always shown); while Settings changes it, it shows a moment (preview()).
  // Turned off in Settings, no card at all during the call (not even the moment a setting change shows).
  win.hidden = !s.enabled || ((call.dismissed || (call.appOpen && !s.alwaysShown)) && Date.now() >= previewUntil);
  $("dismissed-note").hidden = !s.enabled || !call.dismissed || Date.now() < previewUntil;
  $("off-note").hidden = s.enabled;
  win.innerHTML = call.ended
    ? `<div class="call-card cc-ended"><span>Call ended</span><button type="button" data-run="again">Call again</button></div>`
    : DRAW[f.id](box) + (pickerOpen ? picker() : "") + (detailsOpen ? details() : "")
      + (f.id === "pip" ? `<span class="cc-resize cc-grip" data-edge="se" aria-hidden="true"></span>` : "");
  win.toggleAttribute("data-picker", pickerOpen || detailsOpen);
  win.dataset.listFrom = "element";
  if (f.id !== "mascot") { win.removeAttribute("data-peek"); c1Aim = null; }
  if (f.id === "mascot") win.dataset.c1Layout = c1Layout(); else delete win.dataset.c1Layout;
  win.toggleAttribute("data-c1-arc", c1Arc());
  // Drawn again, the card keeps its controls out if they were (and the picker holds them out).
  // Always shown (Settings), the controls stay out; else they come near the pointer (as today's card: alwaysExpanded).
  if (pickerOpen || s.alwaysShown) win.toggleAttribute("data-expanded", true);
  // Else they keep whatever the pointer left them at: expand() takes them in, after its delay, once the person is done.
  for (const el of win.querySelectorAll(".call-card")) el.toggleAttribute("data-expanded", win.hasAttribute("data-expanded"));
  $("blurb").textContent = f.blurb;
  place();
  fitPip();
  animator.restart();
}

/** Each format's size as the person left it (resized by an edge or a corner), kept across calls: here in localStorage,
 *  in the app beside its place. Not a zoom: the card is laid out again at its new width (the picture's stage keeps 16:9,
 *  its header and bar take what they need). Settings' size is where it starts; resized, Settings says "Custom"; a size
 *  picked there, or "Reset size and position", forgets it. */
/** The picture's smallest; its largest is the screen's work area (the screen less the taskbar, dock or menu bar). */
const RANGE = { pip: [350, Infinity] }; // its least: a stage tall enough for two readable lines of the agent's balloon
const widthKey = (format) => "sidevoice.callcard.width." + format;
const customWidth = (format) => { const w = Number(localStorage.getItem(widthKey(format))), [lo, hi] = RANGE[format] ?? [0, 0]; return w >= lo && w <= hi ? w : 0; };
const HEIGHT_KEY = "sidevoice.callcard.height.pip", HEIGHT_RANGE = [330, Infinity]; // with the switcher's band, the smallest that still shows the avatar on its stage
/** The picture's height as the person left it: the window is sized freely, its stage keeps 16:9 inside (fitPip). */
let previewing = false;
const customHeight = () => { const h = Number(localStorage.getItem(HEIGHT_KEY)); return !previewing && format().id === "pip" && h >= HEIGHT_RANGE[0] && h <= HEIGHT_RANGE[1] ? h : 0; };
const forgetWidths = () => { Object.keys(RANGE).forEach((format) => localStorage.removeItem(widthKey(format))); localStorage.removeItem(HEIGHT_KEY); };
let resizing = null;
document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest(".cc-resize");
  if (!handle) return;
  event.stopPropagation(); event.preventDefault();
  const win = $("card-window"), w = parseFloat(getComputedStyle(win).getPropertyValue("--w"));
  const card = win.querySelector(".cc-pip-meet");
  resizing = { edge: handle.dataset.edge, x: event.clientX, y: event.clientY, w, left: win.offsetLeft, top: win.offsetTop, h: win.offsetHeight, ch: card?.offsetHeight ?? 0, format: format().id };
  handle.setPointerCapture(event.pointerId);
  win.classList.add("resizing");
}, true);
document.addEventListener("pointermove", (event) => {
  if (!resizing) return;
  const r = resizing, win = $("card-window"), dx = event.clientX - r.x, dy = event.clientY - r.y, [lo] = RANGE[r.format];
  // As large as the work area allows, its shadow margin included.
  const work = workSize(), margin = 2 * PLACEMENT.margin, hi = work.width - margin, hiH = work.height - margin;
  const grow = r.edge.includes("e") ? dx : r.edge.includes("w") ? -dx : 0;
  const growY = r.edge.includes("s") ? dy : r.edge.includes("n") ? -dy : 0;
  // Free in both directions: the window takes any shape, its stage keeps 16:9 inside it.
  const w = Math.round(Math.min(hi, Math.max(lo, r.w + grow)));
  const h = Math.round(Math.min(hiH, Math.max(HEIGHT_RANGE[0], r.ch + growY)));
  setWidth(w, h);
  // The opposite corner stays where it was.
  if (r.edge.includes("w")) win.style.left = r.left + r.w - w + "px";
  if (r.edge.includes("n")) win.style.top = r.top + r.h - win.offsetHeight + "px";
});
document.addEventListener("pointerup", () => {
  if (!resizing) return;
  touched();
  const win = $("card-window"), w = Math.round(parseFloat(win.style.getPropertyValue("--w")) || resizing.w);
  localStorage.setItem(widthKey(resizing.format), String(w));
  const card = win.querySelector(".cc-pip-meet");
  if (card?.hasAttribute("data-sized")) localStorage.setItem(HEIGHT_KEY, String(Math.round(card.offsetHeight)));
  resizing = null;
  win.classList.remove("resizing");
  const at = dropAt({ x: win.offsetLeft, y: win.offsetTop }, cardSize(), workSize());
  pick.x = String(Math.round(at.x)); pick.y = String(Math.round(at.y));
  drawCard(); drawPanel(); if (pick.view === "settings") drawApp(); save();
}, true);
/** The card at width `w`, live while it is resized: laid out again, the picture's stage at its new scale. */
function setWidth(w, h) {
  const win = $("card-window");
  win.style.setProperty("--w", w + "px");
  const card = win.querySelector(".cc-pip-meet"), area = win.querySelector(".pip-canvas");
  if (card && area && h) { card.setAttribute("data-sized", ""); card.style.height = h + "px"; area.style.height = ""; }
  fitPip();
}
/** The picture's stage keeps 16:9 inside whatever room its window leaves it, centred on the room's stage background
 *  (as the room's slot fits its tile: StageScene fitCanvas); unsized, the room is exactly 16:9. */
/** fitPip without its label pass (the label pass calls it back after moving the machine). */
function fitPipOnly() { fitting = true; try { fitPip(); } finally { fitting = false; } }
let fitting = false;
function fitPip() {
  for (const area of document.querySelectorAll("#card-window .cc-pip-meet .pip-canvas")) {
    const tile = area.querySelector(".stage-tile");
    if (!tile) continue;
    const width = area.clientWidth, height = area.clientHeight;
    const fitted = width / height > 16 / 9 ? { width: height * 16 / 9, height } : { width, height: width * 9 / 16 };
    Object.assign(tile.style, { width: fitted.width + "px", height: fitted.height + "px", left: (width - fitted.width) / 2 + "px", top: (height - fitted.height) / 2 + "px" });
    tile.style.setProperty("--k", String(fitted.height / 440));
  }
  if (!fitting) noStubs();
}
/** A label of an icon and words never shows as its icon alone: with fewer than about three characters of its words in
 *  view, it goes whole (the stage's model badge, the header's machine). */
function noStubs() {
  for (const label of document.querySelectorAll("#card-window .stage-badge")) {
    label.style.visibility = "";
    const text = label.querySelector(":scope > span:last-child");
    if (!text || getComputedStyle(label).display === "none") continue;
    const ch = parseFloat(getComputedStyle(text).fontSize) * 0.55 * 3;
    if (text.clientWidth < Math.min(ch, text.scrollWidth)) label.style.visibility = "hidden";
  }
}

/** Where the list (or the details) drops from: the button that opened it (its edge, on the screen's side), or the card's
 *  own edge (panel: "Where the list drops from"). */
function dropFrom() {
  const win = $("card-window"), panel = win.querySelector(".cc-picker, .cc-details");
  if (!panel) return;
  const opener = win.querySelector(pickerOpen ? "[data-run=switch]" : "[data-run=details]");
  panel.style.top = panel.style.bottom = panel.style.left = panel.style.right = "";
  if (win.dataset.listFrom !== "element" || !opener) return;
  const w = win.getBoundingClientRect(), o = opener.getBoundingClientRect();
  if (win.dataset.open === "down") panel.style.top = o.bottom - w.top + 6 + "px"; else panel.style.bottom = w.bottom - o.top + 6 + "px";
  if (win.dataset.side === "right") panel.style.right = Math.max(0, w.right - o.right) + "px"; else panel.style.left = Math.max(0, o.left - w.left) + "px";
}

/** The card's box as last placed: what a change of format keeps its edge from. */
let lastRect = null;
/** A change of format (or size) keeps the card on the side it was: flush right stays flush right, flush left stays
 *  flush left; its height on the screen stays (on the bottom edge, it stays on it); with no stored place it stays in its first place (top right). */
function keepAnchor(change) {
  const before = lastRect, stored = settings().place;
  change();
  drawCard();
  if (!before || !stored || $("card-window").hidden) return;
  const work = workSize(), size = cardSize();
  // Across: the nearer edge. Down: its top stays, unless it sat on the bottom edge (then that edge stays).
  const right = before.x + before.w / 2 > work.width / 2, bottom = before.y + before.h >= work.height - 1;
  const at = dropAt({ x: right ? before.x + before.w - size.width : before.x, y: bottom ? before.y + before.h - size.height : before.y }, size, work);
  pick.x = String(Math.round(at.x));
  pick.y = String(Math.round(at.y));
  place();
}

/** Settings changed the card: it shows on the screen for a moment, as it now is, then hides again (the settings are
 *  set where the card cannot be seen). */
const PREVIEW_MS = 4000;
let previewUntil = 0, previewTimer = 0;
function preview() {
  previewUntil = Date.now() + PREVIEW_MS;
  clearTimeout(previewTimer);
  const end = () => {
    // Never while the person is at it: it goes PREVIEW_MS after they are done with it.
    // Never while the person is at it, nor until PREVIEW_MS after they last touched it.
    if (interacting() || Date.now() - lastTouch < PREVIEW_MS) { previewUntil = Date.now() + 1000; previewTimer = setTimeout(end, 1000); return; }
    drawCard();
  };
  previewTimer = setTimeout(end, PREVIEW_MS + 20);
}
/** Whether the person is using the card: the pointer on it, a drag or a resize, its list or details open, focus in it. */
let lastTouch = 0;
// C1's balloons are not the card's controls: the pointer moving over one is not using the card (only its button is).
const touched = (event) => { if (event?.type === "pointermove" && format().id === "mascot" && !event.target.closest?.(".c1-handle, .c1-dock")) return; lastTouch = Date.now(); };
function interacting() {
  const win = $("card-window");
  if (Date.now() - lastTouch < 600) return true;
  return !!(drag || resizing || pickerOpen || detailsOpen || hoverZone() || win.matches(":focus-within"));
}

/** Balloons that open below the avatar point their tails up at it (proposed-web.css: .balloon--tail-up). */
function tailsToward() {
  const up = $("card-window").dataset.open === "down";
  for (const balloon of $("card-window").querySelectorAll(":is(.cc-mascot, .c1x) .cc-captions .speech-bubble")) balloon.classList.toggle("balloon--tail-up", up);
  c1TitleSpot();
}

// ---------- C1: the expanded layout (OPEN, 2026-10-20: the variant "c1Layout") ----------

/** OPEN (variant "c1Layout"): how C1's controls lie out once the handle opens. "card" is the decided one for now. The
 *  others are the arc (the room's round call buttons fanning out around the creature on its open side, as before) with
 *  the title line (title, conversations with its "!", open, settings, ×) above or below it, from the creature's
 *  screen-edge side toward its open side, so it never spreads far sideways:
 *  - "past" (A): on the balloons' side, past the arc's tip, or past the balloon while one is up (it moves with it);
 *  - "near" (C): on the balloons' side, by the arc's tip; the balloons make way past it while the controls are out;
 *  - "free" (B): on the side the balloons never use, past the arc's tip; near the screen's edge the creature keeps that
 *    much room from it (in this layout only), so nothing moves when it opens. */
const C1_LAYOUTS = { card: "Original card (decided for now)", past: "Arc + title past the balloons (A)", near: "Arc + title by the creature, balloons past it (C)", free: "Arc + title on the free side (B)" };
const c1Layout = () => (pick.c1Layout in C1_LAYOUTS ? pick.c1Layout : "card");
const c1Arc = () => format().id === "mascot" && c1Layout() !== "card";
/** The arc as callcard.css draws it: radius the creature's half plus 30 px, buttons 34 px, two steps out at most. */
const ARC_STEP = { s: 28, m: 23, l: 18 }, TITLE_GAP = 8, TITLE_H = 34;
const avatarSide = () => FORMATS.find((each) => each.id === "mascot").sizes[settings().size].w;
const arcReach = () => { const w = avatarSide(); return Math.max(w / 2, (w / 2 + 30) * Math.sin((2 * ARC_STEP[settings().size] * Math.PI) / 180) + 17); };
/** The title's side (above or below the creature) and its near edge's distance from the creature's middle; for "near",
 *  how far the balloons step out while the controls are out. */
function c1TitleSpot() {
  const win = $("card-window");
  if (!c1Arc()) return;
  const layout = c1Layout(), balloonsDown = win.dataset.open === "down", below = layout === "free" ? !balloonsDown : balloonsDown;
  let y = arcReach() + TITLE_GAP;
  if (layout === "past") {
    const stack = win.querySelector(".c1x-stack"), figure = win.querySelector(".c1x .m-figure");
    if (stack?.querySelector(".speech-bubble") && figure) {
      const r = stack.getBoundingClientRect(), f = figure.getBoundingClientRect(), mid = f.top + f.height / 2;
      y = Math.max(y, (below ? r.bottom - mid : mid - r.top) + TITLE_GAP);
    }
  }
  win.dataset.c1Title = below ? "below" : "above";
  win.style.setProperty("--c1-title-y", Math.round(y) + "px");
  // The stack starts 0.42 of the creature from its middle (callcard.css .c1x-stack): past the title, while it is out.
  const step = Math.max(0, arcReach() + TITLE_GAP + TITLE_H + TITLE_GAP - 0.42 * avatarSide());
  win.style.setProperty("--c1-stack-step", (balloonsDown ? step : -step) + "px");
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
  const rest = dropAt(settings().place ?? firstPlace(work, size, pick.startCorner || "tr"), size, work);
  const at = fit(rest, size, work);
  // C1's balloons go above the avatar when a three-line balloon fits there, else below (operator, 2026-10-19); the other
  // formats' captions open toward the screen's middle.
  const BALLOON_ROOM = { s: 130, m: 150, l: 180 };
  win.dataset.open = format().id === "mascot" ? (at.y >= (BALLOON_ROOM[settings().size] ?? 150) ? "up" : "down") : opensDown(at, size, work) ? "down" : "up";
  // C1, the arc's title on the free side (B): the creature keeps the title's room from that screen edge, at rest too, so
  // nothing moves when the controls open.
  if (c1Arc() && c1Layout() === "free") {
    const room = Math.ceil(arcReach() + TITLE_GAP + TITLE_H - avatarSide() / 2 - PLACEMENT.margin);
    if (win.dataset.open === "down") at.y = Math.max(at.y, room);
    else at.y = Math.min(at.y, Math.max(0, work.height - size.height - room));
  }
  win.style.left = at.x + "px";
  win.style.top = at.y + "px";
  lastRect = { x: at.x, y: at.y, w: size.width, h: size.height };
  tailsToward();
  win.dataset.side = at.x + size.width / 2 > work.width / 2 ? "right" : "left";
  // The picture's grip: the corner towards the middle of the screen (away from the edges it sits by).
  const grip = win.querySelector(".cc-grip");
  if (grip) grip.dataset.edge = (opensDown(at, size, work) ? "s" : "n") + (win.dataset.side === "right" ? "w" : "e");
  // The avatar's name pill and controls centre under it, or keep to the screen's edge when it is against one.
  win.toggleAttribute("data-flush", at.x <= 0 || at.x + size.width >= work.width - 1);
  dropFrom();
  // The avatar's name pill is as wide as its controls, whatever the name.
  const pill = win.querySelector(".cc-name-pill"), strip = win.querySelector(".cc-mascot > .cc-strip");
  if (pill && strip) pill.style.width = strip.offsetWidth + "px";
  // The avatar's name pill goes over it, or under its controls where the screen ends above it.
  win.toggleAttribute("data-pill-down", at.y < 40);
}
addEventListener("resize", () => place());

// The card's controls show near the pointer, as today's (card-shell.tsx: after 120 ms in, until 500 ms out); its window
// grows with them and moves in if it has to.
let hoverTimer = 0;
// C1: the dock comes out for the avatar itself (and stays while on it), never for its balloons (coordinator, 2026-10-19).
const hoverZone = () => { const win = $("card-window"); return format().id === "mascot" ? c1Aim === "card" : win.matches(":hover"); };
// A1: its captions are neutral: over them the card neither opens nor closes, so the line under the pointer (and its
// cancel button) never moves away from it.
$("card-window").addEventListener("pointerover", (event) => {
  const id = format().id;
  if (id === "card") { clearTimeout(hoverTimer); if (!event.target.closest(".cc-captions")) hoverTimer = setTimeout(() => expand(true), 120); return; }
  if (id === "mascot") c1Aimed(c1ZoneAt(event));
});
$("card-window").addEventListener("pointerenter", () => { if (format().id === "mascot" || format().id === "card") return; clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(true), 120); });
$("card-window").addEventListener("pointerleave", (event) => { if (format().id === "mascot") { c1Aimed(c1ZoneAt(event)); return; } clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(false), 500); });
// Done dragging or resizing away from the card: the controls go after the same delay as leaving it.
addEventListener("pointerup", (event) => {
  if (format().id === "mascot") { c1Aim = null; c1Aimed(c1ZoneAt(event)); return; }
  clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(false), 500);
});
// ---------- C1: its controls behind a handle (operator, 2026-10-20) ----------

/** C1's controls in three steps, all within the card's own window (the pointer outside it is never read; operator,
 *  2026-10-20): at rest, nothing; the pointer on the creature, a small handle beside it, on its open side, that says
 *  "this unfolds" (⋯ and a chevron toward where it opens); the pointer on the handle (or Enter on it), the handle itself
 *  unfolds into the controls card as it has always been (B1's title line over the room's call bar), and folds back into
 *  it (callcard.css). Stepping up waits the usual 120 ms, stepping back down the usual 500 ms. A balloon is not the
 *  creature: on one, things step back down. */
const C1_STEPS = ["rest", "peek", "open"];
const C1_FOLD_MS = 240;
let c1Aim = null, c1FoldTimer = 0;
/** What the pointer is on: the handle or what it opened ("card"), the creature, or neither. */
const c1Zone = (target) => target?.closest?.(".c1-handle, .c1-dock") ? "card" : target?.closest?.(".c1x .m-figure") ? "creature" : "none";
/** Once open, C1's controls hold while the pointer is anywhere in their hull: the box around the handle and everything
 *  it opened (the card, or the arc's buttons and title) and the gaps between them, C1_HULL_PX wider all round. Crossing a
 *  gap never folds them; leaving the hull does, after the usual 500 ms (operator, 2026-10-20). */
const C1_HULL_PX = 16;
function c1Hull() {
  const parts = [...$("card-window").querySelectorAll(".c1x .c1-handle, .c1x .c1-dock button, .c1x .c1-dock > .pip-head-1, #card-window:not([data-c1-arc]) .c1x .c1-dock")]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!parts.length) return null;
  return { left: Math.min(...parts.map((r) => r.left)) - C1_HULL_PX, right: Math.max(...parts.map((r) => r.right)) + C1_HULL_PX,
    top: Math.min(...parts.map((r) => r.top)) - C1_HULL_PX, bottom: Math.max(...parts.map((r) => r.bottom)) + C1_HULL_PX };
}
/** What the pointer is on, for C1: inside the opened controls' hull it is on them; else what is under it. */
function c1ZoneAt(event) {
  if ($("card-window").hasAttribute("data-expanded") && Number.isFinite(event?.clientX)) {
    const h = c1Hull();
    if (h && event.clientX >= h.left && event.clientX <= h.right && event.clientY >= h.top && event.clientY <= h.bottom) return "card";
  }
  return c1Zone(event?.target);
}
// The pointer moving inside the window's own area (no cursor outside it is ever read): the hull is checked as it moves.
addEventListener("pointermove", (event) => { if (format().id === "mascot" && !drag && !resizing && event.pointerType === "mouse") c1Aimed(c1ZoneAt(event)); });
const c1Step = () => { const win = $("card-window"); return win.hasAttribute("data-expanded") ? "open" : win.hasAttribute("data-peek") ? "peek" : "rest"; };
const c1Wanted = () => (c1Aim === "card" ? "open" : c1Aim === "creature" ? "peek" : "rest");
/** Only a change of what the pointer is on restarts the delay (a balloon's words changing under a still pointer fire
 *  pointerover again and again). */
function c1Aimed(zone) {
  if (zone === c1Aim) return;
  c1Aim = zone;
  const want = c1Wanted();
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => c1Go(want), C1_STEPS.indexOf(want) > C1_STEPS.indexOf(c1Step()) ? 120 : 500);
}
/** What holds the opened controls: their list open, a drag, focus in them, Settings' "always". */
const c1Held = () => settings().alwaysShown || pickerOpen || detailsOpen || !!drag || !!$("card-window").querySelector(".c1x .c1-dock:focus-within");
function c1Go(want, force = false) {
  const win = $("card-window"), handle = win.querySelector(".c1-handle"), was = c1Step();
  if (!force && want !== "open" && was === "open" && c1Held()) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => c1Go(c1Wanted()), 500); return; }
  win.toggleAttribute("data-peek", want !== "rest" || settings().alwaysShown);
  // Folding back: the card shrinks into the handle, which shows again once it has (data-c1-folding, callcard.css).
  if (was === "open" && want !== "open") { win.setAttribute("data-c1-folding", ""); clearTimeout(c1FoldTimer); c1FoldTimer = setTimeout(() => win.removeAttribute("data-c1-folding"), C1_FOLD_MS); }
  const handleFocused = document.activeElement === handle;
  expand(want === "open", true);
  handle?.setAttribute("aria-expanded", String(win.hasAttribute("data-expanded")));
  // The handle becomes the card: focus on it goes into the card (to its first control), never left on a covered handle.
  if (want === "open" && handleFocused) win.querySelector(".c1-dock button:not(:disabled)")?.focus();
}
/** The handle: a small pill in the card's chrome, the more mark and a chevron toward where it opens. A real button:
 *  Tab reaches it (it shows when focused), Enter unfolds it into the card, focus inside. */
const c1Handle = () => `<button type="button" class="c1-handle" data-run="c1-open" data-theme="${scheme()}" aria-controls="c1-controls" aria-expanded="${$("card-window").hasAttribute("data-expanded")}" aria-label="${words("card.controls")}" title="${words("card.controls")}">${svg("moreH", 16)}${svg("chevron", 12).replace("<svg ", '<svg class="c1-handle-chevron" ')}</button>`;
$("card-window").addEventListener("focusout", (event) => {
  if (format().id !== "mascot" || event.relatedTarget?.closest?.(".c1x :is(.c1-handle, .c1-dock), .cc-picker")) return;
  // Focus gone: back to what the pointer says.
  setTimeout(() => { const win = $("card-window"); c1Aim = null; c1Aimed(win.querySelector(".c1-handle:hover, .c1-dock:hover") ? "card" : win.querySelector(".c1x .m-figure:hover") ? "creature" : "none"); });
});

function expand(on, force = false) {
  const win = $("card-window");
  if (!on && settings().alwaysShown) return;
  if (force) { if (on !== win.hasAttribute("data-expanded")) { win.toggleAttribute("data-expanded", on); if (on) guardUntil = Date.now() + CLICK_GUARD_MS; for (const el of win.querySelectorAll(".call-card")) el.toggleAttribute("data-expanded", on); if (!drag) place(); noStubs(); } return; }
  if (!on && (pickerOpen || detailsOpen)) return; // open, the picker holds the controls out, as today's panels do
  // Mid-interaction (dragging, resizing, the pointer back on it, focus in it), they stay out; asked again after it.
  if (!on && interacting()) { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => expand(false), 500); return; }
  if (on === win.hasAttribute("data-expanded")) return;
  win.toggleAttribute("data-expanded", on);
  if (on) guardUntil = Date.now() + CLICK_GUARD_MS;
  for (const el of win.querySelectorAll(".call-card")) el.toggleAttribute("data-expanded", on);
  if (!drag) place();
  noStubs();
}

// ---------- the Sidevoice window: the room, or Settings ----------

function drawApp() {
  const win = $("app-window");
  win.hidden = !call.appOpen;
  if (!call.appOpen) { win.innerHTML = ""; return; }
  const settingsView = pick.view === "settings";
  win.innerHTML = `<header><span class="w-title">Sidevoice</span><span class="w-btns"><button type="button" data-run="minimise" title="Minimise">—</button></span></header>
<div class="app-body" data-theme="${scheme()}">${settingsView ? settingsScreen() : `<nav><b>Conversations</b>${CREATURES.filter((c) => c.seed !== "Sidevoice").map((c) => `<span${c.id === creature().id ? ' class="on"' : ""}>${c.seed}</span>`).join("")}</nav>
<section class="app-stage">${stage(330)}<p>The room, in front: the card hides while Sidevoice's window is in front (unless it is always shown). Minimise it to bring the card back.</p></section>`}</div>`;
  if (!settingsView) animator.restart();
  else requestAnimationFrame(fitPreviews);
}

/** Settings → Call, with the floating card's group, as sidevoice-web's settings screen draws it (SettingsDialog,
 *  components/ui/Card: Section, Group, Row, ChoiceCard, Switch; ui.css, settings.css). Its controls set the same settings
 *  the card is drawn from. */
/** Settings' sections as sidevoice-web's settings screen lists them today (SettingsDialog SECTIONS, their catalogue
 *  names and Icons.tsx marks): in variant B the floating card gets a section of its own, after Call. */
const NAV_ICONS = {"SlidersHorizontal":"<path d=\"M10 5H3\"/><path d=\"M12 19H3\"/><path d=\"M14 3v4\"/><path d=\"M16 17v4\"/><path d=\"M21 12h-9\"/><path d=\"M21 19h-5\"/><path d=\"M21 5h-7\"/><path d=\"M8 10v4\"/><path d=\"M8 12H3\"/>","Mic":"<path d=\"M12 19v3\"/><path d=\"M19 10v2a7 7 0 0 1-14 0v-2\"/><rect x=\"9\" y=\"2\" width=\"6\" height=\"13\" rx=\"3\"/>","AudioWaveform":"<path d=\"M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2\"/>","Phone":"<path d=\"M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384\"/>","ShieldCheck":"<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\"/><path d=\"m9 12 2 2 4-4\"/>","Keyboard":"<path d=\"M10 8h.01\"/><path d=\"M12 12h.01\"/><path d=\"M14 8h.01\"/><path d=\"M16 12h.01\"/><path d=\"M18 8h.01\"/><path d=\"M6 8h.01\"/><path d=\"M7 16h10\"/><path d=\"M8 12h.01\"/><rect width=\"20\" height=\"16\" x=\"2\" y=\"4\" rx=\"2\"/>","KeyRound":"<path d=\"M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z\"/><circle cx=\"16.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\"/>","Laptop":"<path d=\"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z\"/><path d=\"M20.054 15.987H3.946\"/>","Monitor":"<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\"/><line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\"/><line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\"/>","RefreshCcwDot":"<path d=\"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\"/><path d=\"M3 3v5h5\"/><path d=\"M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16\"/><path d=\"M16 16h5v5\"/><circle cx=\"12\" cy=\"12\" r=\"1\"/>","Wrench":"<path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\"/>","PictureInPicture2":"<path d=\"M21 9V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h4\"/><rect width=\"10\" height=\"7\" x=\"12\" y=\"13\" rx=\"2\"/>"};
const SECTIONS = [
  ["general", { en: "General", es: "General" }, "SlidersHorizontal"], ["transcription", { en: "Transcription", es: "Transcripción" }, "Mic"],
  ["voice", { en: "Voice", es: "Voz" }, "AudioWaveform"], ["call", { en: "Call", es: "Llamada" }, "Phone"],
  ["card", { en: "Floating card", es: "Tarjeta flotante" }, "PictureInPicture2"],
  ["permissions", { en: "Permissions", es: "Permisos" }, "ShieldCheck"], ["shortcuts", { en: "Shortcuts", es: "Atajos" }, "Keyboard"],
  ["providers", { en: "Providers", es: "Proveedores" }, "KeyRound"], ["this-computer", { en: "This device", es: "Este dispositivo" }, "Laptop"],
  ["machines", { en: "Machines", es: "Máquinas" }, "Monitor"], ["updates", { en: "Updates", es: "Actualizaciones" }, "RefreshCcwDot"],
  ["advanced", { en: "Advanced", es: "Avanzado" }, "Wrench"],
];
const navIcon = (name, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[name]}</svg>`;

/** Where a new card first appears: a corner of the work area (a small screen with four spots). */
function cornerPicker(s) {
  const corner = pick.startCorner || "tr";
  return `<div class="cc-corners" role="radiogroup" aria-label="${words("settings.callCard.startCorner")}">${["tl", "tr", "bl", "br"].map((c) => `<button type="button" role="radio" class="cc-corner" data-corner="${c}" aria-checked="${c === corner}" data-setting="corner" data-value="${c}" aria-label="${words("settings.callCard.corner." + c)}" title="${words("settings.callCard.corner." + c)}"></button>`).join("")}</div>`;
}
function settingsScreen() {
  const s = settings(), own = true; // a section of its own, after Call (decided)
  const current = own ? "card" : "call";
  const nav = SECTIONS.filter(([id]) => own || id !== "card")
    .map(([id, name, icon]) => `<button type="button" class="ui-nav-item"${id === current ? ' aria-current="page"' : ""}>${navIcon(icon, id === "this-computer" || id === "updates" ? 18 : 16)}<span>${name[pick.lang] ?? name.en}</span></button>`).join("");
  const row = (label, hint, control, block = false) => `<div class="ui-row${block ? " ui-row--block" : ""}"><div class="ui-row-text"><span class="ui-row-label">${label}</span>${hint ? `<p class="ui-row-description">${hint}</p>` : ""}</div>${control ? `<div class="ui-row-control">${control}</div>` : ""}</div>`;
  const toggle = (name, on, label = "") => `<button type="button" role="switch" aria-checked="${on}" class="ui-switch" data-setting="${name}"${label ? ` aria-label="${label}"` : ""}><span class="ui-switch-thumb" aria-hidden="true"></span></button>`;
  const segmented = (name, options, value) => `<div class="ui-segmented ui-segmented--sm" role="radiogroup">${Object.entries(options).map(([id, label]) => `<button type="button" role="radio" class="ui-segment" aria-checked="${id === value}" data-setting="${name}" data-value="${id}">${label}</button>`).join("")}</div>`;
  const choice = (id) => `<button type="button" role="radio" aria-checked="${s.format === id}" class="ui-card ui-card--padded ui-card--interactive cc-choice" ${s.format === id ? " data-selected" : ""} data-setting="format" data-value="${id}">
${s.format === id ? `<span class="ui-card-check" aria-hidden="true">${svg("check", 14)}</span>` : ""}<span class="cc-preview" data-preview="simple" data-format="${id}">${desktopPreview(id)}</span>
<strong>${words(`settings.callCard.format.${id}`)}</strong><small>${words(`settings.callCard.format.${id}Hint`)}</small></button>`;
  // Off, the card's other settings stay in view, inactive (the app's way: a control that can't act now is disabled, its
  // row saying why; nothing in Settings hides rows behind a switch), so turning it on again moves nothing.
  const dependent = (html) => s.enabled ? html : html.replace(/<button\b/g, "<button disabled");
  return `<div class="settings-layout cc-settings"><nav class="settings-nav ui-nav">${nav}</nav><div class="settings-content"><div class="settings-column">
<section class="ui-section"><header class="ui-section-head"><div><h2 class="ui-section-title">${own ? words("settings.callCard.title") : words("settings.section.call")}</h2><p class="ui-section-description">${own ? words("settings.callCard.hint") : words("settings.call.description")}</p></div></header>
<div class="ui-section-body"><div class="ui-group cc-card-master"><div class="ui-group-card">
${row(words("settings.callCard.enabled"), words(s.enabled ? "settings.callCard.enabledOnHint" : "settings.callCard.enabledOffHint"), toggle("enabled", s.enabled, words("settings.callCard.enabled")))}
</div></div>
${dependent(`<div class="ui-group cc-card-group"${s.enabled ? "" : " data-off"}>${own ? "" : `<h3 class="ui-group-title">${words("settings.callCard.title")}</h3>`}<div class="ui-group-card">
${row(words("settings.callCard.format"), words("settings.callCard.previewNote"), `<div class="cc-choices" role="radiogroup">${FORMATS.map((f) => choice(f.id)).join("")}</div>`, true)}
${row(words("settings.callCard.sizeTitle"), s.format === "pip" ? words("settings.callCard.sizeHint") : "", segmented("size", { s: words("settings.callCard.size.s"), m: words("settings.callCard.size.m"), l: words("settings.callCard.size.l"), ...(customWidth(s.format) ? { custom: words("settings.callCard.size.custom") } : {}) }, customWidth(s.format) ? "custom" : s.size))}
${row(words("settings.callCard.startCorner"), words("settings.callCard.startCornerHint"), cornerPicker(s))}
${row(words("settings.desktop.alwaysShown"), words("settings.desktop.alwaysShownHint"), toggle("always", s.alwaysShown))}
${row("", "", `<button type="button" class="ui-button ui-button--secondary ui-button--sm" data-setting="reset"${s.place || customWidth(s.format) ? "" : " disabled"}><span class="ui-button-content">${words("settings.callCard.positionReset")}</span></button>`)}
</div></div>`)}</div></section></div></div></div>`;
}

/** A format's real card, as it is (the person holding the microphone, onboarding's, and a sample name), still and
 *  inert: its buttons and ids made plain, so it is a picture of the card inside the choice. */
/** The sizes the previews draw each format at, fixed whatever is set: the card and the avatar large, the picture small,
 *  so the three read together. */
const PREVIEW_SIZE = { card: "l", pip: "s", mascot: "l" };
function cardPicture(id) {
  const box = FORMATS.find((f) => f.id === id).sizes[PREVIEW_SIZE[id]];
  const was = { captions: pick.captions, state: call.state }, wasOpen = pickerOpen;
  pickerOpen = false; previewing = true;
  const html = withCreature(creature() ?? DEFAULT_CREATURE, () => DRAW[id](box));
  pickerOpen = wasOpen; previewing = false;
  // A still of a real moment: the agent speaking, its last words in its balloon, the card saying so.
  const said = pick.lang === "es" ? "¿Lo quito y hago commit?" : "Shall I remove it and commit?";
  const balloon = `<div class="speech-bubble stage-bubble" data-visible="" aria-hidden="true"><span class="paged-text" style="--paged-lines:3"><span class="paged-text-run"><span class="karaoke-text"><span class="karaoke-played">${said}</span><span class="karaoke-upcoming"></span></span></span></span><svg class="balloon-shine" viewBox="0 0 40 20" aria-hidden="true"><path d="M3 17Q5 4 24 3"/></svg>${tail("agent")}</div>`;
  // Its buttons drawn as they stand (the animator, which paints them on the live card, leaves the previews alone).
  const painted = html
    .replaceAll('data-run="mute"></button>', `data-run="mute">${svg("mic", 22)}</button>`)
    .replaceAll('data-run="captions"></button>', `data-run="captions">${svg("captions", 22)}</button>`)
    .replaceAll('data-run="skip"></button>', `data-run="skip">${svg("skip", 22)}</button>`);
  const flat = painted
    .replaceAll('data-style="bichos"', 'data-style="bichos" data-mood="idle" data-idle="quiet"')
    .replace(/<button\b/g, "<span").replace(/<\/button>/g, "</span>").replace(/<(\/?)(details|summary)\b/g, "<$1span")
    .replace(/\sdata-run="[^"]*"/g, "")
    .replace('<div class="stage-top cc-agent-slot"></div>', `<div class="stage-top">${balloon}</div>`)
    .replace(/(<div class="c1x-stack"><div class="cc-captions cc-balloons" data-theme="dark">)<div class="cc-agent-slot"><\/div>/, `$1<div class="cc-still-slot">${balloon}</div>`)
    .replace(/(class="stage-tile" data-theme="dark" data-mood=")[a-z]+"/, '$1speaking"')
    .replace('<span class="cc-state-text"></span>', `<span class="cc-state-text">${STATES.speaking.line}</span>`)
    .replace('<i class="cc-dot"></i>', '<i class="cc-dot" style="background:var(--sv-voice, #e0a82e)"></i>')
    .replaceAll("cc-agent-slot", "cc-slot-off").replaceAll('"person-turns"', '"cc-slot-off"').replaceAll("cc-lines", "cc-slot-off");
  void was;
  return `<span class="cc-card-picture" data-scheme="${scheme()}" data-format="${id}" data-size="${PREVIEW_SIZE[id]}" style="--w:${box.w}px${box.h ? `;--h:${box.h}px` : ""}">${flat}</span>`;
}
/** Variant B: the real card in context, on a small copy of this computer's desktop (the page's desktop, as the app
 *  would detect it), where it first sits (the work area's top right), at the screen's own scale; the screen's top right
 *  quarter shown. */
function desktopPreview(id) {
  // A soft, neutral corner of a screen, no window or bar of any system: the card alone, as it sits there, still.
  return `<span class="cc-mini cc-simple" data-format="${id}"><span class="cc-mini-screen"><span class="cc-mini-work" style="inset:0"><span class="cc-mini-card">${cardPicture(id)}</span></span></span></span>`;
}
/** Scales each real card into its choice: as large as fits with a margin, centred. */
function fitPreviews() {
  // The screen's top right, 640 of its pixels across the frame, the same for the three: their cards at their true sizes.
  // The title card a little closer, so its words read (operator, 2026-10-19).
  for (const mini of document.querySelectorAll(".cc-mini")) mini.style.setProperty("--mini-k", String(mini.clientWidth / (mini.dataset.format === "card" ? 540 : 640)));
  for (const box of document.querySelectorAll(".cc-real-box")) {
    const frame = box.parentElement, card = box.firstElementChild;
    // The avatar alone is as tall as the others' cards are wide in their frames: about half the frame.
    const most = box.closest("[data-format=mascot]") ? .5 : 1;
    const scale = Math.min((frame.clientWidth - 24) / card.offsetWidth, (frame.clientHeight - 20) / card.offsetHeight, most);
    box.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
}

function draw() { drawDesktop(); drawCard(); drawApp(); drawPanel(); save(); }

// ---------- what the buttons do ----------

/** As today's card: a click within CLICK_GUARD_MS of the controls appearing (or the card changing size) runs nothing, so
 *  a click meant for what was under the pointer never hits a button that just moved there. */
const CLICK_GUARD_MS = 350;
let guardUntil = 0, cancelledAt = 0;
/** Opens or closes the conversation picker, focus on the selected row when it opens and back on its opener when it closes. */
function togglePicker(open) {
  pickerOpen = open;
  drawCard();
  const win = $("card-window");
  if (open) { win.toggleAttribute("data-expanded", true); (win.querySelector(".cc-picker [aria-pressed=true]") ?? win.querySelector(".cc-picker .person:not(:disabled)"))?.focus(); }
  else win.querySelector("[data-run=switch]")?.focus();
}
document.addEventListener("click", (event) => {
  const chosen = event.target.closest("[data-conversation]");
  if (chosen && chosen.getAttribute("aria-disabled") === "true") return;
  if (chosen) { pick.creature = chosen.dataset.conversation; pickerOpen = false; drawCard(); drawPanel(); save(); $("card-window").querySelector("[data-run=switch]")?.focus(); return; }
  // A click anywhere else closes it (as today's card's panels close on a click outside).
  if (pickerOpen && !event.target.closest(".cc-picker, [data-run=switch]")) { pickerOpen = false; drawCard(); }
  if (detailsOpen && !event.target.closest(".cc-details, [data-run=details]")) { detailsOpen = false; drawCard(); }
});
// Keyboard: Escape closes it; the arrows move between its rows.
addEventListener("keydown", (event) => {
  // C1: Escape inside the card folds it back into the handle, focus on the handle.
  if (event.key === "Escape" && !pickerOpen && format().id === "mascot" && document.activeElement?.closest(".c1x .c1-dock")) {
    event.preventDefault(); c1Go("peek", true); $("card-window").querySelector(".c1-handle")?.focus(); return;
  }
  if (detailsOpen && event.key === "Escape") { detailsOpen = false; drawCard(); $("card-window").querySelector("[data-run=details]")?.focus(); return; }
  if (!pickerOpen) return;
  if (event.key === "Escape") { event.preventDefault(); togglePicker(false); return; }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = [...$("card-window").querySelectorAll(".cc-picker .person:not(:disabled)")];
  const at = rows.indexOf(document.activeElement);
  event.preventDefault();
  rows[(at + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length]?.focus();
});
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-run], [data-setting]");
  if (!target) return;
  const run = target.dataset.run, setting = target.dataset.setting;
  // The guard spares "Cancel sending" (it comes with your balloon, never with the controls) and the keyboard (Enter and
  // Space are never a click meant for something else: spec §2.4).
  if (target.closest("#card-window") && Date.now() < guardUntil && run !== "cancel-turn" && event.detail !== 0) return;
  if (run === "mute") setState(muted() ? "listening" : "muted");
  if (run === "skip") setState("idle");
  // Taking the turn back: what was being said is dropped, its balloon (or line) goes, and the call listens again.
  // Its balloon goes with it. Pressed with the pointer, nothing of the card keeps focus (it would hold the controls out);
  // from the keyboard, focus goes to the microphone, the call's nearest control.
  if (run === "cancel-turn") {
    const keyboard = event.detail === 0;
    cancelledAt = Date.now(); setState("listening");
    if (keyboard) $("card-window").querySelector("[data-run=mute]")?.focus(); else document.activeElement?.blur();
    return;
  }
  // The handle: it opens (never closes: a click right after the hover opened it must not shut it); from the keyboard,
  // when already open, it takes focus into what it opened.
  if (run === "c1-open") { if (c1Step() !== "open") c1Go("open", true); return; }
  if (run === "c1-row") { c1RowOpen = !c1RowOpen; drawCard(); $("card-window").toggleAttribute("data-expanded", true); for (const el of $("card-window").querySelectorAll(".call-card")) el.toggleAttribute("data-expanded", true); return; }
  if (run === "switch") { detailsOpen = false; togglePicker(!pickerOpen); return; }
  if (run === "details") { pickerOpen = false; detailsOpen = !detailsOpen; drawCard(); if (detailsOpen) $("card-window").toggleAttribute("data-expanded", true); return; }
  if (run === "captions") { pick.captions = settings().captions ? "0" : "1"; localStorage.setItem(CAPTIONS_KEY, pick.captions); refresh(); }
  if (run === "hangup") { call.ended = true; drawCard(); }
  if (run === "again") { call.ended = false; call.dismissed = false; call.since = Date.now(); drawCard(); }
  if (run === "open") { call.appOpen = true; call.dismissed = false; pick.view = ""; drawCard(); drawApp(); }
  if (run === "dismiss") { call.dismissed = true; drawCard(); return; }
  if (run === "show-card") { call.dismissed = false; drawCard(); return; }
  if (run === "minimise") { call.appOpen = false; drawCard(); drawApp(); }
  // The picture's gear: straight to Settings → Call → Floating call card.
  if (run === "card-settings") { call.appOpen = true; call.dismissed = false; pick.view = "settings"; draw(); $("app-window").querySelector(".cc-card-group")?.scrollIntoView({ block: "start" }); }
  // The card on or off: turned on, it shows a moment, as any other change here does; off, it goes at once.
  if (setting === "enabled") { pick.card = settings().enabled ? "0" : "1"; if (pick.card === "1") preview(); }
  if (setting === "always") pick.always = settings().alwaysShown ? "0" : "1";
  if (setting === "size" && target.dataset.value === "custom") return;
  if (setting === "format" || setting === "size") { preview(); keepAnchor(() => { if (setting === "size") forgetWidths(); pick[setting] = target.dataset.value; }); }
  if (setting === "reset") { pick.x = pick.y = ""; forgetWidths(); }
  if (setting === "corner") { pick.startCorner = target.dataset.value; pick.x = pick.y = ""; preview(); }
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
$("card-window").addEventListener("focusin", () => noStubs());
$("card-window").addEventListener("focusout", () => setTimeout(noStubs));
$("card-window").addEventListener("pointerdown", (event) => {
  // C1's balloons are inert, as the room's are: a press on one moves nothing (its one button acts).
  if (event.button !== 0 || event.target.closest("button:not(.card-title)") || event.target.closest(".c1x .speech-bubble")) return;
  const win = $("card-window");
  drag = { x: event.clientX, y: event.clientY, dx: event.clientX - win.offsetLeft, dy: event.clientY - win.offsetTop, moved: false, id: event.pointerId };
});
for (const type of ["pointerdown", "pointermove", "pointerup", "keydown"]) $("card-window").addEventListener(type, touched, true);
addEventListener("pointermove", (event) => {
  if (resizing) touched();
  if (!drag || drag.id !== event.pointerId) return;
  touched();
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
  touched();
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
  // Everything the animator moves, but never the settings' previews: those are still pictures.
  const all = (selector) => scope().flatMap((root) => [...root.querySelectorAll(selector)]).filter((el) => !el.closest(".cc-card-picture"));
  const balloonUp = () => call.state === "speaking";

  /** The avatar's root attributes, as CharacterAvatar sets them. */
  function paint() {
    const st = STATES[call.state], c = creature();
    $("card-window").dataset.state = call.state;
    const working = st.mood === "working" && c.works.length ? work : undefined;
    const idle = st.mood === "idle" ? (bored && idleStep ? idleStep.idle : "quiet") : undefined;
    for (const el of all(".sv-avatar")) {
      if (el.closest(".cc-real, .cc-picker, .cc-switch-row, .cc-card-picture")) continue;
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
    for (const btn of all("#mute")) { btn.innerHTML = svg(muted() ? "micOff" : "mic", 22); btn.title = btn.ariaLabel = muted() ? "Unmute" : "Mute"; btn.setAttribute("aria-pressed", String(muted())); }
    for (const mic of all("#mic-control")) mic.dataset.muted = String(muted());
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
      // Which line the voice is on, counted from the said words' own line boxes: a count, so the page turning (a transform,
      // mid-transition) never moves the measure. Before, the measure was taken against the moving page itself, so each
      // word read a different page while the last turn was still sliding, and the words jumped up and down.
      const tops = [];
      for (const rect of played.getClientRects()) if (rect.width && !tops.some((top) => Math.abs(top - rect.top) < line / 2)) tops.push(rect.top);
      // Lines a page: three, two in a small picture (its stage has room for no more).
      const tile = bubble.closest(".stage-tile"), per = tile && tile.offsetHeight < 200 ? 2 : 3;
      bubble.querySelector(".paged-text").style.setProperty("--paged-lines", String(per));
      const page = Math.max(0, Math.floor((tops.length - 1) / per));
      if (run.dataset.page === String(page)) continue;
      run.dataset.page = String(page);
      run.style.transform = `translateY(${-page * per * line}px)`;
    }
  }
  /** The balloons for the state: the agent's while it speaks, the person's while they do (bars, then what was sent). */
  function balloons() {
    for (const slot of all(".cc-agent-slot")) slot.innerHTML = call.state === "speaking" ? agentBalloon() : "";
    for (const turns of all(".person-turns")) {
      turns.dataset.theme = scheme();
      turns.innerHTML = !hearing() || personStep > 2 ? "" : personStep === 0 ? liveBalloon("listening") : personStep === 1 ? liveBalloon("transcribing") : sentBalloon();
    }
    for (const lines of all(".cc-lines")) lines.innerHTML = transcriptLines();
    markTurn();
    tailsToward();
    if (call.state === "speaking") karaoke(SAYS.split(" ").slice(0, word).join(" "));
  }
  /** The title card's captions: what is being said as a transcript reads, a line per speaker, its name over it. */
  function transcriptLines() {
    if (call.state === "speaking") return `<p class="cc-line" data-role="assistant"><b>${call.title()}</b><span class="karaoke-text"><span class="karaoke-played"></span><span class="karaoke-upcoming">${SAYS}</span></span></p>`;
    if (hearing() && personStep <= 2) return `<p class="cc-line" data-role="user"><b>${words("card.you")}</b>${personStep === 2 ? `<span>${HEARS}</span>` : `<span class="cc-line-live"><span class="voice-wave" data-phase="${personStep === 1 ? "transcribing" : "listening"}" role="status"><canvas aria-hidden="true"></canvas></span>${cancelTurn()}</span>`}</p>`;
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
  /** Whether the person's turn can still be taken back: while recorded or transcribed (the cancel button shows). */
  function markTurn() {
    const win = $("card-window"); if (!win) return;
    const turn = hearing() && !muted() && personStep < 2 ? (personStep === 1 ? "transcribing" : "recording") : "";
    if (turn) win.dataset.turn = turn; else delete win.dataset.turn;
  }
  /** The person's turn: speaking 3.5 s (the bars move), transcribed 1 s (they hold and blink), sent 2.5 s (PAGE_MS-ish). */
  function personTurn() {
    markTurn();
    if (personStep === 1) for (const wave of all('.voice-wave[data-phase="listening"]')) wave.dataset.phase = "transcribing";
    else balloons();
    if (personStep === 0) { heardSince = performance.now(); columns.length = 0; }
    // Held recording (the mock state), it stays there.
    if (call.state === "recording" && personStep === 0) return;
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
      // Your voice's bars in the very colour of the microphone's level bars beside them (the card's, the room's), in the card's own theme.
      // A1's line: the colour of the microphone's level bars beside it. A balloon's: the room's own (call-view.css, the person's ink).
      const micBar = !canvas.closest(".person-bubble") && $("card-window")?.querySelector(".your-wave i, .mic-wave i");
      const micColour = micBar ? getComputedStyle(micBar).backgroundColor : getComputedStyle(canvas).color;
      while (columns.length > capacity) columns.shift();
      context.clearRect(0, 0, width, height);
      context.fillStyle = micColour;
      context.beginPath();
      for (let slot = 0; slot < capacity; slot += 1) {
        const bar = Math.max(2, (columns[columns.length - 1 - slot] ?? 0) * (height - 2));
        context.roundRect(width - 3 - slot * 6, height / 2 - bar / 2, 3, bar, 1.5);
      }
      context.fill();
    }
    // The room's microphone pill draws its level from --mic-fill (room-session-controller.js voiceLevel).
    for (const mic of all("#mic-control")) mic.style.setProperty("--mic-fill", hearing() && !muted() ? Math.round(speechLevel(now - heardSince, 0.7) * 100) + "%" : "0%");
    // Your microphone's wave in today's card (useWave): the level while you speak.
    for (const w of all(".your-wave")) {
      [...w.children].forEach((bar, i) => {
        const live = hearing() && !muted();
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
      // Just taken back: nothing of yours shows until you speak again.
      if (call.state === "listening" && Date.now() - cancelledAt < 1000) { personStep = 3; balloons(); later(() => { personStep = 0; personTurn(); }, 3000); }
      else if (call.state === "listening") later(() => { personStep = 1; personTurn(); }, 3500);
      markTurn();
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
    `<label class="check"><input type="checkbox" data-pick="card"${s.enabled ? " checked" : ""}> Floating card on (Settings' first switch)</label>`,
    select("format", "Format", FORMATS.map((f) => [f.id, f.label]), s.format),
    select("size", "Size", Object.entries(SIZES), s.size),
    `<label class="check"><input type="checkbox" data-pick="captions"${s.captions ? " checked" : ""}> Captions (as the card's own button)</label>`,
    s.format === "pip" ? select("pipBar", "Picture's call bar", [["always", "Under it, always"], ["hover", "Under it, near the pointer"]], pick.pipBar) : "",
    s.format === "pip" ? select("pipIcons", "Picture's header icons", [["hover", "Near the pointer (and focus)"], ["always", "Always"]], pick.pipIcons === "always" ? "always" : "hover") : "",
    s.format === "card" ? select("a1Head", "Title card's header", [["corner", "Buttons in the corner (new)"], ["inline", "Buttons beside the wave (before)"]], pick.a1Head) : "",
        `<fieldset class="panel-open"><legend>Open questions</legend>${select("c1Layout", "C1 · expanded layout", Object.entries(C1_LAYOUTS), c1Layout())}</fieldset>`,
    select("spot", "Put the card", [["", "Where it is"], ["tl", "Top left"], ["tr", "Top right"], ["ml", "Middle left"], ["mr", "Middle right"], ["bl", "Bottom left"], ["br", "Bottom right"]], ""),
    `<label class="check"><input type="checkbox" data-pick="always"${s.alwaysShown ? " checked" : ""}> Keep the controls out (Settings' "Always show")</label>`,
    `<label class="check"><input type="checkbox" data-pick="unread"${pick.unread === "1" ? " checked" : ""}> Other conversations have unread replies (mock)</label>`,
    select("state", "Call state", Object.entries(STATES).map(([id, st]) => [id, st.label]), call.state),
    `<label class="check"><input type="checkbox" data-pick="cycle"${pick.cycle === "1" ? " checked" : ""}> Cycle through the states</label>`,
    select("creature", "Conversation", CREATURES.map((c) => [c.id, c.seed === "Sidevoice" ? "Sidevoice mascot" : c.seed]), creature().id),
    select("theme", "System theme", [["", `The desktop's (${env().theme})`], ["dark", "Dark"], ["light", "Light"]], pick.theme),
    `<label class="check"><input type="checkbox" data-pick="motion"${pick.motion === "reduced" ? " checked" : ""}> Reduced motion</label>`,
    `<div class="place"><span>Place: ${s.place ? `${s.place.x}, ${s.place.y} px` : "first place (top right)"}</span><button type="button" data-action="place-reset"${s.place ? "" : " disabled"}>Reset</button></div>`,
    `<div class="panel-settings"><button type="button" data-action="settings">Open the settings mock</button>${select("lang", "Its language", [["en", "English"], ["es", "Español"]], pick.lang)}</div>`,
    `<details class="panel-map"><summary>The settings, as stored</summary><pre>${JSON.stringify({ callControls: { alwaysShown: s.alwaysShown, places: s.place ? { "<display>": s.place } : {}, card: { enabled: s.enabled, format: s.format, size: s.size, captions: s.captions } } }, null, 2)}</pre>
<p><code>alwaysShown</code> and <code>places</code> are the desktop app's today; <code>card</code> is new. Settings sets <code>enabled</code>, <code>format</code> and <code>size</code>; only the card's own button sets <code>captions</code>.</p></details>`,
  ].join("");
}

$("controls").addEventListener("change", (event) => {
  const name = event.target.dataset.pick;
  if (!name) return;
  if (name === "cycle") pick.cycle = event.target.checked ? "1" : "0";
  else if (name === "card") pick.card = event.target.checked ? "1" : "0";
  else if (name === "unread") pick.unread = event.target.checked ? "1" : "0";
  else if (name === "always") pick.always = event.target.checked ? "1" : "0";
  else if (name === "spot") {
    // A corner or the middle of a side of the work area, for the card's window as it is now.
    const work = workSize(), size = cardSize(), spot = event.target.value;
    pick.x = String(Math.round(spot.endsWith("l") ? 0 : work.width - size.width));
    pick.y = String(Math.round(spot.startsWith("t") ? 0 : spot.startsWith("b") ? work.height - size.height : (work.height - size.height) / 2));
  }
  else if (name === "captions") { pick.captions = event.target.checked ? "1" : "0"; localStorage.setItem(CAPTIONS_KEY, pick.captions); }
  else if (name === "motion") pick.motion = event.target.checked ? "reduced" : "full";
  else if (name === "format" || name === "size") { const value = event.target.value; keepAnchor(() => { if (name === "size") forgetWidths(); pick[name] = value; }); }
  else pick[name] = event.target.value;
  // Picking C1's layout shows C1.
  if (name === "c1Layout" && pick.format !== "mascot") keepAnchor(() => { pick.format = "mascot"; });
  if (name === "state") { const was = call.state; call.state = pick.state; pick.cycle = "0"; animator.entered(was); }
  if (name === "creature" || name === "env") call.appOpen = false;
  document.body.classList.toggle("reduce-motion", pick.motion === "reduced");
  draw();
});
$("controls").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "place-reset") { pick.x = pick.y = ""; forgetWidths(); refresh(); }
  if (action === "settings") { call.appOpen = true; call.dismissed = false; pick.view = "settings"; draw(); }
});

const panel = $("panel");
const togglePanel = (open = panel.classList.contains("closed")) => { panel.classList.toggle("closed", !open); pick.panel = open ? "1" : "0"; save(); };
panel.querySelector(".panel-header").addEventListener("click", () => togglePanel());
addEventListener("keydown", (event) => { if (event.altKey && event.shiftKey && event.code === "KeyC") togglePanel(); });
panel.classList.toggle("closed", pick.panel === "0");
document.body.classList.toggle("reduce-motion", pick.motion === "reduced");
call.appOpen = pick.view === "settings";

draw();
// Started: the page's boot watch (callcard.html) stands down.
window.callcardBooted = true;
