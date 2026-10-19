// The call-card exploration (callcard.html): the desktop app's floating call card, in each format of
// callcard/formats.mjs, over a simulated desktop (callcard/desktops.mjs), in each of the call's states. The creatures
// are the web's own drawings (callcard/creatures.json, scripts/callcard-creatures.mjs) moved by the web's own CSS
// (callcard/bichos.css, callcard/call.css): this page only sets the attributes the app sets on an avatar's root.
import { CORNER_GAP, CORNERS, FAMILIES, FORMATS, SIZES, STATES, cardSettings } from "./callcard/formats.mjs";
import { DESKTOPS, SIDEVOICE_ICON } from "./callcard/desktops.mjs";

const { source, creatures: CREATURES } = await (await fetch("/callcard/creatures.json")).json();

// ---------- what is picked: the address's hash ----------

const DEFAULTS = { env: "windows", format: "card", size: "m", corner: "", state: "speaking", cycle: "0", creature: CREATURES[0].id,
  controls: "", theme: "", motion: "full", panel: "1" };
const pick = { ...DEFAULTS, ...Object.fromEntries(new URLSearchParams(location.hash.slice(1))) };
const save = () => {
  const changed = Object.entries(pick).filter(([key, value]) => value !== DEFAULTS[key]);
  history.replaceState(null, "", "#" + new URLSearchParams(changed).toString());
};
const env = () => DESKTOPS[pick.env] ?? DESKTOPS.windows;
const creature = () => CREATURES.find((each) => each.id === pick.creature) ?? CREATURES[0];
const format = () => FORMATS.find((each) => each.id === pick.format) ?? FORMATS[1];
const settings = () => cardSettings({ format: pick.format, size: pick.size, corner: pick.corner || env().corner, controls: pick.controls || undefined });

// ---------- the mock call ----------

const call = {
  state: pick.state in STATES ? pick.state : "speaking",
  title: () => creature().seed === "Sidevoice" ? "Sidevoice" : creature().seed,
  machine: "MacBook-Pro",
  harness: "Claude Code · opus",
  since: Date.now() - 12 * 60_000 - 4_000,
  ended: false,
  appOpen: false,
};
const SAYS = "He terminado el cambio del relay. Los tests pasan, pero clippy avisa de un import sin usar. ¿Lo quito y hago commit?";
const HEARS = "Vale, quítalo y haz el commit con un mensaje corto.";
const WORKS_ON = ["Running cargo test -p relay", "Editing src/relay/session.rs", "Reading room/epoch.rs"];
const clock = () => { const s = Math.floor((Date.now() - call.since) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const muted = () => call.state === "muted";

// ---------- small parts ----------

const ICONS = {
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3"/>',
  micOff: '<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 5.1 2.1M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 10.7 5.9M12 18v3M3 3l18 18"/>',
  hangup: '<path d="M3.5 14.5c4.7-4 12.3-4 17 0l-1.6 2.6a1.2 1.2 0 0 1-1.5.5l-2.6-1.1a1.2 1.2 0 0 1-.7-1.1v-1.8a12 12 0 0 0-4.2 0v1.8a1.2 1.2 0 0 1-.7 1.1l-2.6 1.1a1.2 1.2 0 0 1-1.5-.5Z" fill="currentColor" stroke="none"/>',
  open: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  skip: '<path d="M6 5l9 7-9 7Z" fill="currentColor"/><path d="M18 5v14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
};
const svg = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

let copies = 0;
/** The drawing's markup with ids of its own (as the web's withOwnIds): two copies never share a gradient. */
const ownIds = (html) => { const salt = `cc${(copies += 1).toString(36)}-`; return html.replace(/(\bid="|url\(#|href="#)/g, `$1${salt}`); };

/** An avatar root as the web's CharacterAvatar renders it; the animator keeps its attributes. */
function avatar(size) {
  const c = creature();
  return `<span class="sv-avatar" data-style="bichos" data-size="${size === "stage" ? "stage" : "sidebar"}" data-mouth="voice">${ownIds(size === "stage" ? c.stage : c.small)}</span>`;
}

const PIP_MOOD = { listening: "listening", speaking: "speaking", working: "working", muted: "idle", idle: "idle" };
/** The room's stage tile (the web's StageScene): the backdrop, the creature and its desk, scaled from the lab's 440px. */
function stage(height) {
  const c = creature(), d = c.deskColours;
  return `<div class="stage-tile" data-mood="${PIP_MOOD[call.state]}"><div class="stage-scene" style="--k:${height / 440}">
<div class="stage-backdrop">${ownIds(c.backdrop)}</div><div class="stage-agent">${avatar("stage")}</div>
<div class="stage-desk" style="--desk-top:${d.top};--desk-top-deep:${d.topDeep};--desk-front:${d.front};--desk-front-deep:${d.frontDeep}">${ownIds(c.desk)}</div></div></div>`;
}

const WAVE_BARS = { s: 9, m: 11, l: 13 };
const wave = (size) => `<span class="cc-wave" role="img" aria-label="Your microphone">${"<i></i>".repeat(WAVE_BARS[size])}</span>`;
const micButton = (devices = true) => `<span class="cc-mic">${devices ? `<button type="button" class="cc-devices" title="Microphone and speaker">${svg("chevron", 13)}</button>` : ""}<button type="button" class="cc-mute" data-run="mute"></button></span>`;
const button = (run, icon, label, cls = "") => `<button type="button" class="cc-btn ${cls}" data-run="${run}" title="${label}" aria-label="${label}">${svg(icon)}</button>`;
const stateLine = (withClock = true) => `<span class="cc-state"><i class="cc-dot"></i><span class="cc-state-text"></span><span class="cc-state-detail"></span>${withClock ? '<span class="cc-clock-sep" aria-hidden="true">·</span><span class="cc-clock"></span>' : ""}</span>`;
const sub = () => `<span class="cc-sub"><span>${call.machine}</span><span aria-hidden="true">·</span><span>${call.harness}</span></span>`;
/** Words to light one by one (the reply as it sounds, or what it hears). */
const words = (text) => text.split(" ").map((word) => `<span class="w">${word}</span>`).join(" ");
const caption = () => `<p class="cc-caption" data-for="speaking">${words(SAYS)}</p><p class="cc-caption" data-for="listening"><b>You</b> ${words(HEARS)}</p>
<p class="cc-caption" data-for="working"><span class="cc-work"></span></p><p class="cc-caption" data-for="muted">Your microphone is off. Unmute to talk.</p>
<p class="cc-caption" data-for="idle">It has answered. Talk when you're ready.</p>`;

// ---------- the formats ----------

const DRAW = {
  today: () => `<div class="cc cc-today"><div class="row">
<span class="today-mark">${SIDEVOICE_ICON}</span><span class="who"><b class="cc-title">${call.title()}</b>${sub()}</span>
${button("open", "open", "Open Sidevoice", "today-open")}${wave("s")}</div>
<div class="cc-controls">${micButton()}${button("skip", "skip", "Skip reply", "cc-skip")}${button("hangup", "hangup", "Hang up", "cc-hangup")}</div></div>`,

  card: (size) => `<div class="cc cc-card"><div class="row"><span class="cc-face">${avatar("small")}</span>
<span class="who"><b class="cc-title">${call.title()}</b>${sub()}${stateLine()}</span>${button("open", "open", "Open Sidevoice", "cc-open")}</div>
<div class="cc-controls">${micButton()}${wave(size)}<span class="grow"></span>${button("skip", "skip", "Skip reply", "cc-skip")}${button("hangup", "hangup", "Hang up", "cc-hangup")}</div></div>`,

  "card-caption": (size) => `<div class="cc cc-card cc-captioned"><div class="row"><span class="cc-face tile" style="--tone:${creature().tone}">${avatar("stage")}</span>
<span class="who"><b class="cc-title">${call.title()}</b>${sub()}${stateLine()}</span>${button("open", "open", "Open Sidevoice", "cc-open")}</div>
<div class="cc-captions">${caption()}</div>
<div class="cc-controls">${micButton()}${wave(size)}<span class="grow"></span>${button("skip", "skip", "Skip reply", "cc-skip")}${button("hangup", "hangup", "Hang up", "cc-hangup")}</div></div>`,

  pip: (size, box) => `<div class="cc cc-pip">${stage(box.h)}
<div class="pip-top"><span class="who"><b class="cc-title">${call.title()}</b><span class="cc-clock"></span></span>${stateLine(false)}</div>
<div class="pip-captions">${caption()}</div>
<div class="pip-bottom"><span class="pip-wave">${wave("s")}</span><span class="cc-controls">${micButton(false)}${button("skip", "skip", "Skip reply", "cc-skip")}${button("hangup", "hangup", "Hang up", "cc-hangup")}</span>${button("open", "open", "Open Sidevoice", "cc-open")}</div></div>`,

  "pip-tall": (size, box) => DRAW.pip(size, box).replace('class="cc cc-pip"', 'class="cc cc-pip tall"'),

  mascot: (size) => `<div class="cc cc-mascot"><span class="m-tag"><b class="cc-title">${call.title()}</b><span class="cc-clock"></span></span>
<span class="m-figure">${avatar("stage")}<span class="m-badge" title="Muted">${svg("micOff", 14)}</span></span><span class="m-ground"></span>
<div class="m-bubble">${caption()}</div>
<div class="cc-controls">${micButton(false)}${wave("s")}${button("hangup", "hangup", "Hang up", "cc-hangup")}${button("open", "open", "Open Sidevoice", "cc-open")}</div></div>`,

  "mascot-perch": (size) => `<div class="cc cc-perch"><span class="m-figure">${avatar("stage")}</span>
<div class="m-bubble">${caption()}</div>
<div class="perch-bar"><span class="who"><b class="cc-title">${call.title()}</b>${stateLine()}</span>${wave("s")}
<span class="cc-controls">${micButton(false)}${button("hangup", "hangup", "Hang up", "cc-hangup")}${button("open", "open", "Open Sidevoice", "cc-open")}</span></div></div>`,
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
  win.dataset.format = f.id;
  win.dataset.family = f.family;
  win.dataset.size = s.size;
  win.dataset.corner = s.corner;
  win.dataset.controls = s.controls;
  win.dataset.theme = pick.theme || env().theme;
  win.style.setProperty("--w", box.w + "px");
  if (box.h) win.style.setProperty("--h", box.h + "px"); else win.style.removeProperty("--h");
  win.style.setProperty("--gap", CORNER_GAP + "px");
  win.hidden = call.appOpen;
  win.innerHTML = call.ended
    ? `<div class="cc cc-ended"><span>Call ended</span><button type="button" data-run="again">Call again</button></div>`
    : DRAW[f.id](s.size, box);
  $("blurb").textContent = f.blurb;
  animator.restart();
}

function drawApp() {
  const win = $("app-window");
  win.hidden = !call.appOpen;
  win.dataset.env = pick.env;
  win.innerHTML = call.appOpen ? `<header><span class="w-title">Sidevoice</span><span class="w-btns"><button type="button" data-run="minimise" title="Minimise">—</button></span></header>
<div class="app-body"><nav><b>Conversations</b>${CREATURES.filter((c) => c.seed !== "Sidevoice").map((c) => `<span${c.id === creature().id ? ' class="on"' : ""}>${c.seed}</span>`).join("")}</nav>
<section class="app-stage">${stage(330)}<p>The room, in front: the card hides while Sidevoice's window is in front. Minimise it to bring the card back.</p></section></div>` : "";
}

function draw() { drawDesktop(); drawCard(); drawApp(); drawPanel(); save(); }

// ---------- what the card's buttons do ----------

document.addEventListener("click", (event) => {
  const run = event.target.closest("[data-run]")?.dataset.run;
  if (!run) return;
  if (run === "mute") setState(muted() ? "listening" : "muted");
  if (run === "skip") setState("idle");
  if (run === "hangup") { call.ended = true; drawCard(); }
  if (run === "again") { call.ended = false; call.since = Date.now(); drawCard(); }
  if (run === "open") { call.appOpen = true; drawCard(); drawApp(); }
  if (run === "minimise") { call.appOpen = false; drawCard(); drawApp(); }
});

function setState(state) {
  call.state = state;
  pick.state = state;
  pick.cycle = "0";
  drawCard();
  drawPanel();
  save();
}

// Dragging the card: it follows the pointer, then snaps to the nearest corner (the corner it keeps, a setting).
let drag = null;
$("card-window").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("button")) return;
  const win = $("card-window"), box = win.getBoundingClientRect();
  drag = { dx: event.clientX - box.left, dy: event.clientY - box.top, moved: false };
  win.setPointerCapture(event.pointerId);
});
$("card-window").addEventListener("pointermove", (event) => {
  if (!drag) return;
  const win = $("card-window"), area = $("work-area").getBoundingClientRect();
  drag.moved = true;
  win.classList.add("dragging");
  win.style.left = event.clientX - area.left - drag.dx + "px";
  win.style.top = event.clientY - area.top - drag.dy + "px";
});
$("card-window").addEventListener("pointerup", () => {
  if (!drag) return;
  const win = $("card-window"), area = $("work-area").getBoundingClientRect(), box = win.getBoundingClientRect();
  const moved = drag.moved;
  drag = null;
  win.classList.remove("dragging");
  win.style.left = win.style.top = "";
  if (!moved) return;
  const right = box.left + box.width / 2 > area.left + area.width / 2, bottom = box.top + box.height / 2 > area.top + area.height / 2;
  pick.corner = (bottom ? "b" : "t") + (right ? "r" : "l");
  drawCard();
  drawPanel();
  save();
});

// ---------- the animator: what the app's avatar and the card do between renders ----------

const CYCLE = [["listening", 4500], ["working", 6000], ["speaking", 7000], ["idle", 5000], ["muted", 3500]];
const animator = (() => {
  let timers = [];
  let word = 0, heard = 0, beat = "a", workIndex = 0, idleStep = "quiet";
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const every = (fn, ms) => timers.push(setInterval(fn, ms));
  const card = () => $("card-window");
  const avatars = () => card().querySelectorAll(".sv-avatar");

  function paint() {
    const st = STATES[call.state], c = creature(), win = card();
    win.dataset.state = call.state;
    for (const el of avatars()) {
      el.dataset.mood = st.mood;
      el.dataset.avatarState = st.mood;
      if (call.state === "working" && c.works.length) el.dataset.work = c.works[workIndex % c.works.length]; else delete el.dataset.work;
      if (st.mood === "idle") el.dataset.idle = idleStep; else delete el.dataset.idle;
      if (call.state !== "speaking") delete el.dataset.beat;
    }
    for (const tile of win.querySelectorAll(".stage-tile")) tile.dataset.mood = PIP_MOOD[call.state];
    for (const text of win.querySelectorAll(".cc-state-text")) text.textContent = st.line;
    for (const text of win.querySelectorAll(".cc-state-detail")) text.textContent = call.state === "working" ? ` · ${WORKS_ON[workIndex % WORKS_ON.length]}` : "";
    for (const text of win.querySelectorAll(".cc-work")) text.textContent = WORKS_ON[workIndex % WORKS_ON.length] + "…";
    for (const btn of win.querySelectorAll(".cc-mute")) {
      btn.innerHTML = svg(muted() ? "micOff" : "mic", 17);
      btn.title = btn.ariaLabel = muted() ? "Unmute" : "Mute";
      btn.setAttribute("aria-pressed", String(muted()));
    }
    for (const mic of win.querySelectorAll(".cc-mic")) mic.toggleAttribute("data-muted", muted());
    for (const skip of win.querySelectorAll(".cc-skip")) skip.disabled = call.state !== "speaking";
    tickClock();
  }
  function tickClock() { for (const el of card().querySelectorAll(".cc-clock")) el.textContent = clock(); }
  function light(selector, upTo) {
    for (const p of card().querySelectorAll(selector)) [...p.querySelectorAll(".w")].forEach((w, i) => w.classList.toggle("said", i < upTo));
  }
  function speak() {
    const total = SAYS.split(" ").length;
    if (word >= total) { later(() => { word = 0; light('[data-for="speaking"]', 0); speak(); }, 2200); return; }
    word += 1;
    beat = beat === "a" ? "b" : "a";
    for (const el of avatars()) el.dataset.beat = beat;
    light('[data-for="speaking"]', word);
    const last = SAYS.split(" ")[word - 1];
    later(speak, /[.?!,]$/.test(last) ? 650 : 180 + Math.random() * 240);
  }
  function hear() {
    const total = HEARS.split(" ").length;
    heard = heard >= total ? 0 : heard + 1;
    light('[data-for="listening"]', heard);
    later(hear, heard >= total ? 2000 : 260 + Math.random() * 200);
  }
  let level = 0.4;
  function waveTick() {
    const live = call.state === "listening";
    for (const w of card().querySelectorAll(".cc-wave")) {
      w.toggleAttribute("data-muted", muted());
      const bars = [...w.children];
      if (!live) { bars.forEach((b) => (b.style.height = "")); continue; }
      level = Math.min(1, Math.max(0.1, level + (Math.random() - 0.5) * 0.5));
      bars.forEach((b, i) => {
        const shape = 1 - Math.abs(i - (bars.length - 1) / 2) / bars.length;
        b.style.height = Math.max(3, Math.round(level * shape * 22 * (0.6 + Math.random() * 0.6))) + "px";
      });
    }
  }
  return {
    restart() {
      timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
      timers = [];
      word = 0; heard = 0; idleStep = "quiet";
      paint();
      every(tickClock, 1000);
      every(waveTick, 90);
      if (call.state === "speaking") speak();
      if (call.state === "listening") hear();
      if (call.state === "working") every(() => { workIndex += 1; paint(); }, 6500);
      if (STATES[call.state].mood === "idle" && creature().idles.length > 1) {
        // As the app: it rests quiet a while after anything happened, then takes up a pastime, one after another.
        const pastimes = creature().idles.filter((each) => each !== "quiet");
        later(() => { let i = 0; const next = () => { idleStep = pastimes[i++ % pastimes.length]; paint(); }; next(); every(next, 9000); }, 6000);
      }
      if (pick.cycle === "1") {
        const at = CYCLE.findIndex(([state]) => state === call.state);
        const [, ms] = CYCLE[at] ?? CYCLE[0];
        later(() => { call.state = CYCLE[(at + 1) % CYCLE.length][0]; pick.state = call.state; save(); drawCard(); drawPanel(); }, ms);
      }
    },
  };
})();

// ---------- the panel ----------

function select(name, label, options, value, groups) {
  const opts = (list) => list.map(([v, text]) => `<option value="${v}"${v === value ? " selected" : ""}>${text}</option>`).join("");
  const body = groups
    ? Object.entries(groups).map(([group, glabel]) => `<optgroup label="${glabel}">${opts(options.filter(([, , g]) => g === group))}</optgroup>`).join("")
    : opts(options);
  return `<label>${label}<select data-pick="${name}">${body}</select></label>`;
}

function drawPanel() {
  const s = settings();
  $("source").textContent = source.replace(/@(\w{7})\w+/, "@$1");
  $("controls").innerHTML = [
    select("env", "Desktop", Object.entries(DESKTOPS).map(([id, d]) => [id, d.label]), pick.env),
    select("format", "Format", FORMATS.map((f) => [f.id, f.label, f.family]), format().id, FAMILIES),
    select("size", "Size", Object.entries(SIZES), s.size),
    select("corner", "Corner", Object.entries(CORNERS), s.corner),
    select("state", "Call state", Object.entries(STATES).map(([id, st]) => [id, st.label]), call.state),
    `<label class="check"><input type="checkbox" data-pick="cycle"${pick.cycle === "1" ? " checked" : ""}> Cycle through the states</label>`,
    select("creature", "Conversation", CREATURES.map((c) => [c.id, c.seed === "Sidevoice" ? "Sidevoice mascot" : c.seed]), creature().id),
    select("controls", "Controls", [["hover", "Near the pointer"], ["always", "Always shown"]], s.controls),
    select("theme", "Card theme", [["", `As the system (${env().theme})`], ["dark", "Dark"], ["light", "Light"]], pick.theme),
    `<label class="check"><input type="checkbox" data-pick="motion"${pick.motion === "reduced" ? " checked" : ""}> Reduced motion</label>`,
  ].join("");
}

$("controls").addEventListener("change", (event) => {
  const name = event.target.dataset.pick;
  if (!name) return;
  if (name === "cycle") pick.cycle = event.target.checked ? "1" : "0";
  else if (name === "motion") pick.motion = event.target.checked ? "reduced" : "full";
  else pick[name] = event.target.value;
  if (name === "state") { call.state = pick.state; pick.cycle = "0"; }
  if (name === "format") pick.controls = ""; // each format comes with its own default
  if (name === "env") pick.corner = "";
  if (name === "creature" || name === "env") call.appOpen = false;
  document.body.classList.toggle("reduce-motion", pick.motion === "reduced");
  draw();
});

const panel = $("panel");
const togglePanel = (open = panel.classList.contains("closed")) => { panel.classList.toggle("closed", !open); pick.panel = open ? "1" : "0"; save(); };
panel.querySelector(".panel-header").addEventListener("click", () => togglePanel());
addEventListener("keydown", (event) => { if (event.altKey && event.shiftKey && event.code === "KeyC") togglePanel(); });
panel.classList.toggle("closed", pick.panel === "0");
document.body.classList.toggle("reduce-motion", pick.motion === "reduced");

draw();

// ---------- live reload: a saved edit to this page's files reloads it ----------

const WATCHED = ["/callcard.html", "/callcard.mjs", "/callcard.css", "/callcard/formats.mjs", "/callcard/desktops.mjs", "/callcard/creatures.json"];
const seen = new Map();
setInterval(async () => {
  for (const path of WATCHED) {
    try {
      const text = await (await fetch(path, { cache: "no-store" })).text();
      if (seen.has(path) && seen.get(path) !== text) location.reload();
      seen.set(path, text);
    } catch { /* the server restarting: try again next time */ }
  }
}, 1500);
