// The avatar customiser exploration (customiser.html): the creature's canvas, as the call's stage shows it, and a
// character-creator panel behind its brush button. Everything is drawn by sidevoice-web's bichos engine, bundled as
// customiser/bichos.mjs (scripts/customiser-engine.mjs), and moved by the web's own CSS (customiser/bichos.css,
// customiser/call.css). What the person picks is one crew member (customiser/crew.mjs), kept in local storage.
import {
  BACKDROPS, BODIES, DESK_PROPS, DESK_TOPS, FAMILIES, MEMBERS, SLOTS, SOURCE, SWATCHES, backdropSvg, deskSvg, idlesFor, idsIn,
  memberSpec, partsIn, renderSpec, withBody, withPart, worksFor,
} from "./customiser/bichos.mjs";
import { MAX_DESK_PROPS, crewMember, memberFromSeed, memberJson } from "./customiser/crew.mjs";

const $ = (id) => document.getElementById(id);
const STORE = "sidevoice-customiser:member";

// ---------- icons (Lucide-style strokes) ----------

const ICONS = {
  brush: '<path d="m14.6 3.4 6 6-8.9 8.9-6-6Z"/><path d="M5.7 12.3 3 21l8.7-2.7"/><path d="m11 7 6 6"/>',
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  shuffle: '<path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
  blob: '<path d="M12 3c5 0 8 4 8 9s-3 9-8 9-8-3.5-8-8.5S7 3 12 3Z"/>',
  face: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  crown: '<path d="m2 6 4 11h12l4-11-6 5-4-7-4 7Z"/><path d="M6 21h12"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2Z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
};
const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
const fillIcons = (root) => { for (const el of root.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon); };

// ---------- names: the engine's labels are Spanish data; this page is English, so it names things by their ids ----------

const human = (id) => { const text = String(id).replace(/[-_]/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };
const SLOT_NAMES = { top: "Head top", eyes: "Eyes", mouth: "Mouth", arms: "Arms", legs: "Feet", tail: "Tail", back: "Back",
  pattern: "Patterns", cheeks: "Cheeks", marks: "Markings", nose: "Nose", neckwear: "Neck", headgear: "Hats", earwear: "Ear gear",
  pins: "Split pins", eyewear: "Eyewear", held: "In hand" };
const FAMILY_NAMES = { monsters: "Monsters", furry: "Furries", birds: "Birds", pond: "Pond", bots: "Robots", sprouts: "Sprouts",
  snacks: "Snacks", sea: "Sea", bugs: "Bugs", spirits: "Spirits", elementals: "Elementals" };
const WORK_NAMES = { crank: "Crank", hammer: "Hammer", read: "Book", type: "Laptop" };
const IDLE_NAMES = { quiet: "Quiet", juggle: "Juggling", soup: "Soup", water: "Watering", fish: "Fishing", bubbles: "Bubbles",
  music: "Music", stretch: "Stretching", nap: "Nap" };
const slotName = (id) => SLOT_NAMES[id] ?? human(id);

// ---------- drawing ----------

let copies = 0;
/** The markup with ids of its own (as the web's withOwnIds): two copies never share a gradient. */
const ownIds = (html) => { const salt = `cz${(copies += 1).toString(36)}-`; return html.replace(/(\bid="|url\(#|href="#)/g, `$1${salt}`); };

/** An avatar root as the web's CharacterAvatar renders it. */
function avatarHtml(figure, { size = "stage", mood, work, idle, desk } = {}) {
  const attrs = [`data-style="bichos"`, `data-size="${size}"`, mood && `data-mood="${mood}"`, work && `data-work="${work}"`,
    idle && `data-idle="${idle}"`, desk && "data-desk"].filter(Boolean).join(" ");
  return `<span class="sv-avatar" ${attrs}>${ownIds(renderSpec(figure, size === "stage" ? "stage" : "sidebar").html)}</span>`;
}

/** The call's stage tile (the web's StageScene): backdrop, creature, desk; `height` sets its scale, else a resize does. */
function stageHtml(member, { mood = "idle", figure = member.figure, scene = member.scene, height, work, idle } = {}) {
  const tone = renderSpec(figure, "sidebar").tone;
  const [, top, topDeep, front, frontDeep] = DESK_TOPS[scene.desk.top] ?? DESK_TOPS.wood;
  const k = height ? `style="--k:${height / 440}"` : "";
  return `<div class="stage-tile" data-mood="${mood}" ${k}><div class="stage-scene">
<div class="stage-backdrop">${ownIds(backdropSvg(scene.backdrop, tone, "dark"))}</div>
<div class="stage-agent">${avatarHtml(figure, { mood, work, idle, desk: mood === "working" })}</div>
<div class="stage-desk" style="--desk-top:${top};--desk-top-deep:${topDeep};--desk-front:${front};--desk-front-deep:${frontDeep}">${ownIds(deskSvg(scene.desk))}</div></div></div>`;
}

/** Keeps a stage tile's --k (its height over the scene's 440) as its box resizes. */
const scaler = new ResizeObserver((entries) => { for (const e of entries) e.target.style.setProperty("--k", String(e.contentRect.height / 440)); });

// ---------- the moods a stage can act out, and the rotation the app would run ----------

const MOODS = [["idle", "Idle"], ["speaking", "Speaking"], ["listening", "Listening"], ["working", "Working"]];
let clock = 0;
setInterval(() => { clock += 1; }, 6000);
/** The work or idle style a stage shows: the member's pinned one, else the app's rotation over what it can do. */
const workOf = (member) => member.moves.work ?? (worksFor(member.figure)[clock % Math.max(1, worksFor(member.figure).length)] || "crank");
const idleOf = (member) => member.moves.idle ?? (idlesFor(member.figure)[clock % Math.max(1, idlesFor(member.figure).length)] || "quiet");

function moodSeg(el, current, onPick) {
  el.innerHTML = MOODS.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === current}" data-mood="${id}" tabindex="${id === current ? 0 : -1}">${label}</button>`).join("");
  el.onclick = (event) => { const b = event.target.closest("[data-mood]"); if (b) onPick(b.dataset.mood); };
  el.onkeydown = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault(); event.stopPropagation();
    const i = (MOODS.findIndex(([id]) => id === current) + step + MOODS.length) % MOODS.length;
    onPick(MOODS[i][0]);
    el.querySelector(`[data-mood="${MOODS[i][0]}"]`)?.focus();
  };
}

/** Speaking: a word every 180–420 ms (data-beat a/b), a pause now and then, as the lab's cadence. */
function speak(root) {
  let beat = "a";
  const tick = () => {
    for (const av of root.querySelectorAll('.sv-avatar[data-mood="speaking"]')) {
      if (Math.random() < 0.12) av.removeAttribute("data-beat"); else av.setAttribute("data-beat", beat);
    }
    beat = beat === "a" ? "b" : "a";
    setTimeout(tick, 180 + Math.random() * 240);
  };
  tick();
}

// ---------- the saved member and the main canvas ----------

const load = () => { try { const raw = localStorage.getItem(STORE); return raw ? crewMember(JSON.parse(raw)) : null; } catch { return null; } };
let saved = load() ?? memberFromSeed("Refactor del relay");
let canvasMood = "speaking";

function drawCanvas() {
  const canvas = $("canvas");
  canvas.innerHTML = stageHtml(saved, { mood: canvasMood, work: workOf(saved), idle: idleOf(saved) });
  scaler.observe(canvas.firstElementChild);
  $("canvas-name").textContent = saved.name;
  $("canvas-traits").textContent = describe(saved);
  moodSeg($("canvas-moods"), canvasMood, (mood) => { canvasMood = mood; drawCanvas(); });
}

const describe = (member) => [human(member.figure.body) + " body", (member.scene.backdrop === "tone" ? "its colour" : human(member.scene.backdrop).toLowerCase()) + " backdrop",
  member.moves.work ? `works with the ${(WORK_NAMES[member.moves.work] ?? member.moves.work).toLowerCase()}` : "", member.moves.idle ? `idles: ${(IDLE_NAMES[member.moves.idle] ?? member.moves.idle).toLowerCase()}` : ""].filter(Boolean).join(" · ");

// ---------- the customiser: tabs, sections, tiles ----------

/** A section: what its tiles are and what picking one does. Each option: { key, label, selected, preview, apply, swaps,
 *  disabled, badge }. `kind` "radio" picks one (selection follows the arrow keys), "check" toggles several. */
const partSection = (slot) => {
  const def = SLOTS.find((s) => s.id === slot);
  return {
    id: slot, label: slotName(slot), kind: def?.multi ? "check" : "radio",
    note: def?.multi ? `Up to ${def.max ?? "several"}; the oldest one goes when you add another.` : def?.required ? "Always one." : "",
    options(m) {
      const have = idsIn(m.figure, slot);
      const list = [];
      if (!def?.required && !def?.multi) list.push({ key: "none", label: "None", selected: have.length === 0, figure: withPart(m.figure, slot, null) });
      for (const part of partsIn(slot)) {
        const figure = withPart(m.figure, slot, part.id);
        list.push({ key: part.id, label: human(part.id), selected: have.includes(part.id), figure, rarity: part.rarity,
          swaps: have.includes(part.id) ? [] : lost(m.figure, figure, slot) });
      }
      return list.map((o) => ({ ...o, apply: (mm) => ({ ...mm, figure: o.figure }) }));
    },
  };
};
/** The parts a pick takes off, in other slots ("Hats: crown"). */
function lost(before, after, slot) {
  const out = [];
  for (const s of SLOTS) if (s.id !== slot) for (const id of idsIn(before, s.id)) if (!idsIn(after, s.id).includes(id)) out.push(`${slotName(s.id)}: ${human(id)}`);
  return out;
}

const TABS = [
  { id: "species", label: "Species", icon: "paw", zoom: "full", sections: FAMILIES.map((f) => ({
    id: `family-${f.id}`, label: FAMILY_NAMES[f.id] ?? human(f.id), kind: "radio",
    note: "Start from a species: its body, parts and colours replace the current ones. The dice tile rolls any of this kind.",
    options(m) {
      const members = MEMBERS.filter((x) => x.family === f.id);
      return [{ key: "any", label: `Any ${(FAMILY_NAMES[f.id] ?? f.id).toLowerCase()}`, dice: true, selected: false,
        figure: memberSpec(f.id, members[0]?.id, m.seed), apply: (mm) => { const pick = members[Math.floor(Math.random() * members.length)]; return { ...mm, figure: memberSpec(f.id, pick.id, randomSeed()) }; } },
      ...members.map((x) => { const figure = memberSpec(f.id, x.id, m.seed); return { key: x.id, label: human(x.id), selected: false, figure, apply: (mm) => ({ ...mm, figure }) }; })];
    },
  })) },
  { id: "body", label: "Body", icon: "blob", zoom: "full", sections: [{ id: "body", label: "Shape", kind: "radio", note: "Parts that don't fit the new shape come off.",
    options: (m) => BODIES.map((b) => { const figure = withBody(m.figure, b.id); return { key: b.id, label: human(b.id), selected: m.figure.body === b.id, figure, swaps: m.figure.body === b.id ? [] : lost(m.figure, figure, ""), apply: (mm) => ({ ...mm, figure }) }; }) }] },
  { id: "face", label: "Face", icon: "face", zoom: "face", sections: ["eyes", "mouth", "nose", "cheeks", "marks"].map(partSection) },
  { id: "head", label: "Head", icon: "crown", zoom: "head", sections: ["top", "headgear", "earwear", "eyewear"].map(partSection) },
  { id: "limbs", label: "Limbs", icon: "hand", zoom: "full", sections: ["arms", "legs", "tail", "back"].map(partSection) },
  { id: "extras", label: "Extras", icon: "gem", zoom: "full", sections: ["pattern", "neckwear", "held", "pins"].map(partSection) },
  { id: "colour", label: "Colour", icon: "palette", zoom: "full", sections: [
    { id: "swatch", label: "Coat", kind: "radio", note: "Ready-made coats; fine-tune them in Tune.",
      options: (m) => SWATCHES.map(([id, hue, sat, light]) => { const figure = { ...m.figure, color: { ...m.figure.color, hue, sat, light }, shiny: undefined };
        const c = m.figure.color; return { key: id, label: SWATCH_NAMES[id] ?? human(id), selected: !m.figure.shiny && c.hue === hue && c.sat === sat && c.light === light, figure, apply: (mm) => ({ ...mm, figure }) }; }) },
    { id: "tune", label: "Tune", kind: "tune", note: "Hue, saturation and lightness of the coat, and the accent its spots and patterns take." },
  ] },
  { id: "scene", label: "Scene", icon: "mountain", zoom: "scene", proposed: true, sections: [
    { id: "backdrop", label: "Backdrop", kind: "radio", proposed: true,
      options: (m) => Object.keys(BACKDROPS).map((id) => ({ key: id, label: id === "tone" ? "Its colour" : human(id), selected: m.scene.backdrop === id, scene: { ...m.scene, backdrop: id }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, backdrop: id } }) })) },
    { id: "desk", label: "Desk", kind: "radio", proposed: true, mood: "working",
      options: (m) => Object.keys(DESK_TOPS).map((id) => ({ key: id, label: human(id), selected: m.scene.desk.top === id, scene: { ...m.scene, desk: { ...m.scene.desk, top: id } }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, top: id } } }) })) },
    { id: "props", label: "On the desk", kind: "check", proposed: true, note: `Up to ${MAX_DESK_PROPS}, left, right, then left again: the number is its place.`,
      options: (m) => Object.keys(DESK_PROPS).map((id) => { const props = m.scene.desk.props; const at = props.indexOf(id);
        return { key: id, label: human(id), selected: at >= 0, badge: at >= 0 ? String(at + 1) : "", prop: id,
          apply: (mm) => { const list = mm.scene.desk.props; const next = list.includes(id) ? list.filter((p) => p !== id) : [...list, id].slice(-MAX_DESK_PROPS); return { ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, props: next } } }; } }; }) },
  ] },
  { id: "moves", label: "Moves", icon: "zap", zoom: "scene", proposed: true, sections: [
    { id: "work", label: "While working", kind: "radio", proposed: true, mood: "working", live: true,
      options: (m) => [{ key: "rotate", label: "Take turns", selected: m.moves.work === null, apply: (mm) => ({ ...mm, moves: { ...mm.moves, work: null } }), work: workOf(m) },
        ...worksFor(m.figure).map((id) => ({ key: id, label: WORK_NAMES[id] ?? human(id), selected: m.moves.work === id, work: id, apply: (mm) => ({ ...mm, moves: { ...mm.moves, work: id } }) }))] },
    { id: "idle", label: "While idle", kind: "radio", proposed: true, mood: "idle", live: true,
      options: (m) => [{ key: "rotate", label: "Take turns", selected: m.moves.idle === null, apply: (mm) => ({ ...mm, moves: { ...mm.moves, idle: null } }), idle: idleOf(m) },
        ...idlesFor(m.figure).map((id) => ({ key: id, label: IDLE_NAMES[id] ?? human(id), selected: m.moves.idle === id, idle: id, apply: (mm) => ({ ...mm, moves: { ...mm.moves, idle: id } }) }))] },
  ] },
];
const SWATCH_NAMES = { mostaza: "Mustard", terracota: "Terracotta", "verde azulado": "Teal", salvia: "Sage", ciruela: "Plum", "añil": "Indigo",
  frambuesa: "Raspberry", naranja: "Orange", lima: "Lime", cielo: "Sky", chicle: "Bubblegum", nube: "Cloud" };

// Any slot a newer engine adds and no tab names yet still gets a section, in Extras.
{
  const named = new Set(TABS.flatMap((t) => t.sections.map((s) => s.id)));
  for (const s of SLOTS) if (!named.has(s.id)) TABS.find((t) => t.id === "extras").sections.push(partSection(s.id));
}

const PROPOSED_NOTE = { scene: "Proposed: the app rolls the scene from the conversation's title today; a crew member would keep its own.",
  moves: "Proposed: the app takes turns between every style the creature can do; a crew member could keep one." };

// ---------- the customiser's state ----------

const ui = { member: saved, opened: saved, history: [], tab: 0, section: Object.fromEntries(TABS.map((t) => [t.id, 0])), previewMood: "idle", gridKey: "" };
const tab = () => TABS[ui.tab];
const section = () => tab().sections[ui.section[tab().id]];
const randomSeed = () => `crew-${Math.random().toString(36).slice(2, 8)}`;

function change(next, { keepGrid = false } = {}) {
  ui.history.push(ui.member);
  if (ui.history.length > 100) ui.history.shift();
  ui.member = crewMember(next);
  draw({ keepGrid });
}

function open() {
  ui.member = ui.opened = saved;
  ui.history = [];
  const dialog = $("customiser");
  dialog.showModal();
  draw();
  focusGrid();
}

function draw({ keepGrid = false } = {}) {
  // Redrawing replaces the focused button: put the focus back on its successor (the same tab, section or tile).
  const had = document.activeElement;
  const where = had?.closest("#tabs") ? "tabs" : had?.closest("#sections") ? "sections" : had?.closest("#grid") ? "grid" : null;
  const key = had?.dataset?.key;
  drawTabs();
  drawSections();
  if (keepGrid) refreshGrid(); else drawGrid();
  drawPreview();
  if (document.activeElement === had && had?.isConnected) return;
  if (where === "tabs") $(`tab-${tab().id}`).focus();
  else if (where === "sections") $("sections").querySelector('[aria-selected="true"]')?.focus();
  else if ($("customiser").open) focusGrid(key);
}

function drawTabs() {
  $("tabs").innerHTML = TABS.map((t, i) => `<button type="button" role="tab" id="tab-${t.id}" class="${t.proposed ? "proposed" : ""}" aria-selected="${i === ui.tab}" tabindex="${i === ui.tab ? 0 : -1}" data-tab="${i}" title="${t.label} (${i + 1})">
${icon(t.icon, 20)}<span>${t.label}</span>${t.proposed ? '<em class="proposed-dot" aria-label="proposed addition"></em>' : ""}</button>`).join("");
}

function drawSections() {
  const t = tab();
  $("sections").hidden = t.sections.length < 2;
  $("sections").innerHTML = t.sections.map((s, i) => `<button type="button" role="tab" aria-selected="${i === ui.section[t.id]}" tabindex="${i === ui.section[t.id] ? 0 : -1}" data-section="${i}">${s.label}</button>`).join("");
  const s = section();
  const notes = [s.proposed && PROPOSED_NOTE[t.id], s.note].filter(Boolean);
  $("section-note").innerHTML = notes.map((n, i) => `<span class="${i === 0 && s.proposed ? "proposed-note" : ""}">${n}</span>`).join(" ");
}

function tilePreview(option, s) {
  const m = ui.member;
  if (option.prop) return `<svg class="prop-thumb" viewBox="-40 -80 80 86" aria-hidden="true">${ownIds(DESK_PROPS[option.prop][1])}</svg>`;
  if (tab().zoom === "scene") {
    return stageHtml(m, { mood: s.mood ?? "idle", scene: option.scene ?? m.scene, height: 110, work: option.work ?? workOf(m), idle: option.idle ?? idleOf(m) });
  }
  return avatarHtml(option.figure ?? m.figure);
}

function drawGrid() {
  const s = section(), t = tab();
  const grid = $("grid");
  ui.gridKey = `${t.id}/${s.id}`;
  grid.dataset.zoom = t.zoom;
  grid.dataset.kind = s.kind;
  grid.toggleAttribute("data-live", Boolean(s.live));
  grid.setAttribute("aria-labelledby", `tab-${t.id}`);
  if (s.kind === "tune") { grid.setAttribute("role", "group"); grid.innerHTML = tuneHtml(); bindTune(); return; }
  grid.setAttribute("role", s.kind === "check" ? "group" : "radiogroup");
  grid.setAttribute("aria-label", s.label);
  const options = s.options(ui.member);
  const focusAt = Math.max(0, options.findIndex((o) => o.selected));
  grid.innerHTML = options.map((o, i) => tileHtml(o, s, i === focusAt)).join("");
}

function tileHtml(o, s, focusable) {
  const role = s.kind === "check" ? "checkbox" : "radio";
  const swaps = o.swaps?.length ? `<i class="swap" title="Takes off ${o.swaps.join(", ")}">⇄</i>` : "";
  const title = [o.label, o.rarity && `(${o.rarity})`, o.swaps?.length && `takes off ${o.swaps.join(", ")}`].filter(Boolean).join(" · ");
  return `<button type="button" class="tile${o.dice ? " dice" : ""}${o.rarity ? ` ${o.rarity}` : ""}" role="${role}" aria-checked="${o.selected}" tabindex="${focusable ? 0 : -1}" data-key="${o.key}" title="${title}">
<span class="thumb">${tilePreview(o, s)}${o.dice ? `<span class="dice-mark">${icon("dice", 22)}</span>` : ""}</span>
<span class="tile-label">${o.label}</span>${swaps}${o.rarity ? `<i class="rarity">${o.rarity === "rare" ? "★" : "◆"}</i>` : ""}${o.badge ? `<i class="badge">${o.badge}</i>` : ""}<i class="tick">${icon("check", 14)}</i></button>`;
}

/** After a pick inside the same section: the tiles' previews stand (they differ only in this slot), their state moves. */
function refreshGrid() {
  const s = section();
  if (s.kind === "tune") return syncTune();
  const options = s.options(ui.member);
  const grid = $("grid");
  for (const o of options) {
    const tile = grid.querySelector(`[data-key="${CSS.escape(o.key)}"]`);
    if (!tile) continue;
    tile.setAttribute("aria-checked", String(o.selected));
    const badge = tile.querySelector(".badge");
    if (o.badge && !badge) tile.insertAdjacentHTML("beforeend", `<i class="badge">${o.badge}</i>`);
    else if (badge) { if (o.badge) badge.textContent = o.badge; else badge.remove(); }
    const swap = tile.querySelector(".swap");
    if (o.swaps?.length) { if (swap) swap.title = `Takes off ${o.swaps.join(", ")}`; else tile.insertAdjacentHTML("beforeend", `<i class="swap" title="Takes off ${o.swaps.join(", ")}">⇄</i>`); }
    else swap?.remove();
  }
}

function tuneHtml() {
  const c = ui.member.figure.color;
  const slider = (id, label, max, value, track) => `<label class="tune-row"><span>${label}<output id="out-${id}">${Math.round(value)}</output></span>
<input type="range" id="tune-${id}" min="0" max="${max}" value="${Math.round(value)}" style="--track:${track}"></label>`;
  const hues = Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} ${c.sat}% ${c.light}%)`).join(",");
  return `<div class="tune">
${slider("hue", "Hue", 359, c.hue, `linear-gradient(90deg,${hues})`)}
${slider("sat", "Saturation", 100, c.sat, `linear-gradient(90deg,hsl(${c.hue} 0% ${c.light}%),hsl(${c.hue} 100% ${c.light}%))`)}
${slider("light", "Lightness", 100, c.light, `linear-gradient(90deg,#000,hsl(${c.hue} ${c.sat}% 50%),#fff)`)}
${slider("spot", "Accent", 359, c.spot, `linear-gradient(90deg,${Array.from({ length: 13 }, (_, i) => `hsl(${(c.hue + i * 30) % 360} 80% 68%)`).join(",")})`)}
<button type="button" class="tile shiny" role="switch" aria-checked="${Boolean(ui.member.figure.shiny)}" id="tune-shiny" title="The legendary gold coat">
<span class="thumb">${avatarHtml({ ...ui.member.figure, shiny: true })}</span><span class="tile-label">Shiny</span><i class="tick">${icon("check", 14)}</i></button></div>`;
}
function bindTune() {
  for (const key of ["hue", "sat", "light", "spot"]) {
    const input = $(`tune-${key}`);
    input.addEventListener("pointerdown", () => { ui.history.push(ui.member); });
    input.addEventListener("keydown", (e) => { if (e.key.startsWith("Arrow")) e.stopPropagation(); });
    input.addEventListener("input", () => {
      const figure = { ...ui.member.figure, color: { ...ui.member.figure.color, [key]: Number(input.value) } };
      ui.member = crewMember({ ...ui.member, figure });
      $(`out-${key}`).textContent = input.value;
      drawPreview();
    });
    input.addEventListener("change", () => syncTune());
  }
  $("tune-shiny").onclick = () => change({ ...ui.member, figure: { ...ui.member.figure, shiny: !ui.member.figure.shiny } });
}
function syncTune() {
  const focused = document.activeElement?.id;
  $("grid").innerHTML = tuneHtml();
  bindTune();
  if (focused && $(focused)) $(focused).focus();
}

function drawPreview() {
  const m = ui.member;
  const preview = $("preview");
  preview.innerHTML = stageHtml(m, { mood: ui.previewMood, work: workOf(m), idle: idleOf(m) });
  scaler.observe(preview.firstElementChild);
  $("preview-row").innerHTML = avatarHtml(m.figure, { size: "sidebar", mood: ui.previewMood === "speaking" ? "speaking" : "idle" });
  $("preview-rail").innerHTML = avatarHtml(m.figure, { size: "sidebar" });
  for (const el of document.querySelectorAll(".pv-name")) el.textContent = m.name;
  if (document.activeElement !== $("name")) $("name").value = m.name;
  $("traits").textContent = describe(m);
  $("config").textContent = memberJson(m);
  moodSeg($("preview-moods"), ui.previewMood, (mood) => { ui.previewMood = mood; drawPreview(); });
}

// ---------- picking ----------

function pick(key) {
  const s = section();
  const o = s.options(ui.member).find((x) => x.key === key);
  if (!o) return;
  if (s.kind === "radio" && o.selected && !o.dice) return;
  if (s.mood) ui.previewMood = s.mood;
  // Species and body picks change every other tile's preview: redraw the grid; a part pick only moves the state.
  const sameShape = !tab().id.match(/species|body/) && !o.dice;
  change(o.apply(ui.member), { keepGrid: sameShape && tab().zoom !== "scene" });
  if (!sameShape || tab().zoom === "scene") focusGrid(key);
}

function shuffleSection() {
  const s = section();
  if (s.kind === "tune") {
    const c = ui.member.figure.color;
    return change({ ...ui.member, figure: { ...ui.member.figure, shiny: undefined, color: { ...c, hue: Math.random() * 360, sat: 30 + Math.random() * 55, light: 45 + Math.random() * 25, spot: Math.floor(Math.random() * 360) } } });
  }
  const options = s.options(ui.member).filter((o) => !o.selected && !o.dice);
  if (!options.length) return;
  const o = options[Math.floor(Math.random() * options.length)];
  change(o.apply(ui.member));
  focusGrid(o.key);
}

function randomise() {
  const seed = randomSeed();
  const rolled = memberFromSeed(seed, ui.member.name);
  change({ ...rolled, name: ui.member.name });
}

function focusGrid(key) {
  const grid = $("grid");
  const tile = (key && grid.querySelector(`[data-key="${CSS.escape(key)}"]`)) || grid.querySelector('[tabindex="0"]') || grid.querySelector("button, input");
  tile?.focus({ preventScroll: false });
}

function setTab(i) { ui.tab = (i + TABS.length) % TABS.length; draw(); $(`tab-${tab().id}`).focus(); }
function setSection(i) { const t = tab(); ui.section[t.id] = (i + t.sections.length) % t.sections.length; draw(); focusGrid(); }

// Arrow keys over the tiles: a 2-D roving focus; in a radio grid the selection follows it, as a game's picker does.
function gridKeys(event) {
  const tiles = [...$("grid").querySelectorAll(".tile:not(.shiny)")];
  const i = tiles.indexOf(document.activeElement);
  if (i < 0) return false;
  const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: tiles.length - 1 }[event.key];
  if (to === undefined) return false;
  event.preventDefault();
  const next = tiles[Math.min(tiles.length - 1, Math.max(0, to))];
  for (const t of tiles) t.tabIndex = t === next ? 0 : -1;
  next.focus();
  if (section().kind === "radio" && !next.classList.contains("dice")) pick(next.dataset.key);
  return true;
}

function rovingTabs(event, list, current, set) {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -current, End: list.length - 1 - current }[event.key];
  if (step === undefined) return false;
  event.preventDefault();
  set(current + step);
  return true;
}

function save() {
  saved = ui.member;
  localStorage.setItem(STORE, JSON.stringify(saved));
  $("customiser").close("save");
  drawCanvas();
}

const RUN = {
  undo: () => { const prev = ui.history.pop(); if (prev) { ui.member = prev; draw(); } },
  reset: () => change(ui.opened),
  shuffle: shuffleSection,
  random: randomise,
  close: () => $("customiser").close(),
  save,
  copy: async () => { await navigator.clipboard?.writeText(memberJson(ui.member)).catch(() => {}); },
};

function bind() {
  fillIcons(document);
  $("source").textContent = SOURCE;
  $("open").innerHTML = icon("brush", 20);
  $("open").onclick = open;
  const dialog = $("customiser");
  dialog.addEventListener("click", (event) => {
    const run = event.target.closest("[data-run]");
    if (run) { event.preventDefault(); RUN[run.dataset.run](); return; }
    const t = event.target.closest("[data-tab]");
    if (t) return setTab(Number(t.dataset.tab));
    const s = event.target.closest("[data-section]");
    if (s) return setSection(Number(s.dataset.section));
    const tile = event.target.closest("#grid .tile[data-key]");
    if (tile) pick(tile.dataset.key);
  });
  $("name").addEventListener("input", (e) => { ui.member = { ...ui.member, name: e.target.value || ui.member.seed }; drawPreview(); });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open) return;
    const inText = event.target.matches("input[type=text]");
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); return save(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !inText) { event.preventDefault(); return RUN.undo(); }
    if (inText || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest("#tabs") && rovingTabs(event, TABS, ui.tab, setTab)) return;
    if (event.target.closest("#sections") && rovingTabs(event, tab().sections, ui.section[tab().id], setSection)) return;
    if (event.target.closest("#grid") && gridKeys(event)) return;
    const key = event.key;
    if (key === "q" || key === "Q") return setTab(ui.tab - 1);
    if (key === "e" || key === "E") return setTab(ui.tab + 1);
    if (key === "[") return setSection(ui.section[tab().id] - 1);
    if (key === "]") return setSection(ui.section[tab().id] + 1);
    if (key === "R") return shuffleSection();
    if (key === "r") return randomise();
    if (key === "z" || key === "Z") return RUN.undo();
    if (key === "Backspace") { event.preventDefault(); return RUN.reset(); }
    if (/^[1-9]$/.test(key) && Number(key) <= TABS.length) return setTab(Number(key) - 1);
  });
  document.addEventListener("keydown", (event) => {
    if (dialog.open || event.target.matches("input, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "c" || event.key === "C") { event.preventDefault(); open(); }
  });
  drawCanvas();
  speak(document);
  // The app's rotation moves on: redraw what shows it.
  setInterval(() => { if (canvasMood === "working" || canvasMood === "idle") drawCanvas(); if (dialog.open && (ui.previewMood === "working" || ui.previewMood === "idle")) drawPreview(); }, 6000);
  // ?open[&tab=<id>][&section=<id>]: open the customiser there (for screenshots and links).
  const query = new URLSearchParams(location.search);
  if (query.has("open")) {
    ui.tab = Math.max(0, TABS.findIndex((t) => t.id === query.get("tab")));
    const at = tab().sections.findIndex((s) => s.id === query.get("section"));
    if (at >= 0) ui.section[tab().id] = at;
    if (query.get("mood")) ui.previewMood = query.get("mood");
    open();
  }
}
bind();

// ---------- live reload: a saved edit to this page's files reloads it ----------

const WATCHED = ["/customiser.html", "/customiser.mjs", "/customiser.css", "/customiser/crew.mjs"];
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
