// The avatar customiser exploration (customiser.html): the creature's canvas, as the call's stage shows it, and a
// character creator behind its palette button. Everything is drawn by sidevoice-web's bichos engine, bundled as
// customiser/bichos.mjs (scripts/customiser-engine.mjs), and moved by the web's own CSS (customiser/bichos.css,
// customiser/call.css). What the person picks is one crew member (customiser/crew.mjs), kept in local storage; every
// name shown is in customiser/names.mjs.
// Two layouts of the same choices, switched by ?layout= (or L): "creator" (the default: a plain list of sections, the
// creature large in the middle, the selected section's options beside it) and "overview" (every section a row with
// its current pick, each opening a strip of options).
import {
  BACKDROPS, BODIES, DESK_PROPS, DESK_TOPS, SLOTS, SOURCE, SWATCHES, deskSvg, idlesFor, idsIn, partsIn, renderSpec, withBody, withPart,
  worksFor,
} from "./customiser/bichos.mjs";
import {
  LEFT_OUT, MAX_DESK_PROPS, crewMember, memberFromSeed, memberJson, parseMember, sideChanges, speciesOf, speciesSlots, withSpecies,
} from "./customiser/crew.mjs";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "./customiser/colour.mjs";
import { COLOUR_BACKDROPS, sceneBackdropSvg } from "./customiser/backdrops.mjs";
import * as NAMES from "./customiser/names.mjs";

const $ = (id) => document.getElementById(id);
const STORE = "sidevoice-customiser:member";

// ---------- icons (Lucide-style strokes, in currentColor) ----------

const ICONS = {
  dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  swap: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  creator: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16"/>',
  rows: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9Z"/>',
};
const icon = (name, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ""}</svg>`;
const fillIcons = (root) => { for (const el of root.querySelectorAll("[data-icon]")) el.innerHTML = icon(el.dataset.icon); };
/** The customise button's mark: a painter's palette, in the UI's own ink. */
const PALETTE = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
<path d="M12 3C6.9 3 3 6.8 3 11.5 3 16.6 7 21 11.6 21c1.5 0 2.2-.9 2.2-1.9 0-1.3-1.1-1.7-1.1-2.8 0-1 .8-1.6 1.8-1.6h2.3c2.6 0 4.2-2 4.2-4.4C21 6.3 17 3 12 3Z"/>
<circle cx="7.6" cy="11.3" r="1.3" fill="currentColor" stroke="none"/><circle cx="9.6" cy="7.4" r="1.3" fill="currentColor" stroke="none"/>
<circle cx="14.2" cy="6.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="9.6" r="1.3" fill="currentColor" stroke="none"/></svg>`;

// ---------- names (customiser/names.mjs) ----------

const partName = (slot, id) => NAMES.PARTS[slot]?.[id] ?? id;
const slotName = (id) => NAMES.SLOTS[id]?.[0] ?? id;
const memberKey = (sp) => sp && `${sp.family}/${sp.member}`;
/** The kind and variant the figure is, if it is one ({ kind, variant, key }). */
const creatureOf = (figure) => { const key = memberKey(speciesOf(figure)); const k = key && NAMES.kindOf(key); return k ? { ...k, key } : null; };

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
  const [, top, topDeep, front, frontDeep] = DESK_TOPS[scene.desk.top] ?? DESK_TOPS.wood;
  const k = height ? `style="--k:${height / 440}"` : "";
  return `<div class="stage-tile" data-mood="${mood}" ${k}><div class="stage-scene">
<div class="stage-backdrop">${ownIds(sceneBackdropSvg(scene, figure.color))}</div>
<div class="stage-agent">${avatarHtml(figure, { mood, work, idle, desk: mood === "working" })}</div>
<div class="stage-desk" style="--desk-top:${top};--desk-top-deep:${topDeep};--desk-front:${front};--desk-front-deep:${frontDeep}">${ownIds(deskSvg(scene.desk))}</div></div></div>`;
}

/** Keeps a stage tile's --k (its height over the scene's 440) as its box resizes. */
const scaler = new ResizeObserver((entries) => { for (const e of entries) e.target.style.setProperty("--k", String(e.contentRect.height / 440)); });

/** Where a slot sits on the figure, [x, y, zoom] in its 120 box, from its body's frame: tiles show that close-up. */
function regionOf(slot, figure) {
  const f = BODIES.find((b) => b.id === figure.body)?.frame ?? { top: 40, eyeY: 60, mouthY: 77, armY: 76, half: 31, bottom: 97 };
  const face = (f.eyeY + f.mouthY) / 2;
  return {
    top: [60, f.top - 12, 1.45], headgear: [60, f.top - 10, 1.5], earwear: [60, f.top + 8, 1.6], eyes: [60, f.eyeY, 2.2],
    eyewear: [60, f.eyeY, 2.1], marks: [60, f.eyeY + 3, 1.9], nose: [60, face, 2.4], mouth: [60, f.mouthY, 2.4],
    cheeks: [60, face + 3, 2], neckwear: [60, f.mouthY + 9, 1.8], arms: [60, f.armY, 1.3], held: [60 + f.half, f.armY - 4, 1.6],
    legs: [60, f.bottom - 1, 2], tail: [60 + f.half - 2, f.bottom - 14, 1.5], back: [60, f.armY - 8, 1.2], pattern: [60, f.armY + 4, 1.35],
  }[slot] ?? [60, 66, 1];
}
const crop = (html, slot, figure) => { const [x, y, z] = regionOf(slot, figure); return `<span class="crop" style="--cx:${x};--cy:${y};--z:${z}">${html}</span>`; };

// ---------- moods ----------

const MOODS = [["idle", "Idle"], ["speaking", "Speaking"], ["listening", "Listening"], ["working", "Working"]];
let clock = 0;
setInterval(() => { clock += 1; }, 6000);
/** The styles a member may take: its picks among what it can do, or all of them. */
const allowed = (list, can) => { const kept = (list ?? can).filter((x) => can.includes(x)); return kept.length ? kept : can; };
const workOf = (m) => { const list = allowed(m.moves.works, worksFor(m.figure)); return list[clock % list.length] || "crank"; };
const idleOf = (m) => { const list = allowed(m.moves.idles, idlesFor(m.figure)); return list[clock % list.length] || "quiet"; };

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

function describe(m) {
  const c = creatureOf(m.figure);
  return [c ? `${c.kind.name}${c.variant === "Classic" ? "" : ` · ${c.variant}`}` : "Custom creature", `${NAMES.BODIES[m.figure.body] ?? m.figure.body} body`,
    `${NAMES.BACKDROPS[m.scene.backdrop] ?? m.scene.backdrop} backdrop`].join(" · ");
}

function drawCanvas() {
  const canvas = $("canvas");
  canvas.innerHTML = stageHtml(saved, { mood: canvasMood, work: workOf(saved), idle: idleOf(saved) });
  scaler.observe(canvas.firstElementChild);
  $("canvas-name").textContent = saved.name;
  $("canvas-traits").textContent = describe(saved);
  moodSeg($("canvas-moods"), canvasMood, (mood) => { canvasMood = mood; drawCanvas(); });
}

// ---------- the choices: sections ----------

/** A section: one set of choices. `choices(m)` lists them cheaply ({ key, label, selected, theme? }); `options(m)`
 *  adds what a tile needs (the figure or scene wearing it, what else it changes) and `apply`. `kind`: "radio" picks one
 *  (selection follows the arrow keys), "check" toggles several, "colour" is the colour editor. */
const sideText = (changes) => changes.map((c) => `${slotName(c.slot)}: ${c.from.map((x) => partName(c.slot, x)).join(" + ") || "none"} → ${c.to.map((x) => partName(c.slot, x)).join(" + ") || "none"}`);
/** What else a pick changes, in words: the line under a tile ("replaces Crown") and its full tooltip. */
function sides(before, after, except = []) {
  const list = sideChanges(before, after, except);
  if (!list.length) return {};
  let line = `changes ${list.length} parts`;
  if (list.length === 1) {
    const [c] = list;
    const gone = c.from.filter((x) => !c.to.includes(x)), come = c.to.filter((x) => !c.from.includes(x));
    line = gone.length ? `takes off ${partName(c.slot, gone[0])}` : `adds ${partName(c.slot, come[0])}`;
  }
  return { swaps: sideText(list), swapLine: line };
}

/** The theme the current kind's own options are under: those come first in every grid. */
const kindTheme = (m) => creatureOf(m.figure)?.kind.theme;

const partSection = (slot) => {
  const def = SLOTS.find((s) => s.id === slot);
  const optional = !def?.required && !def?.multi;
  return {
    id: slot, label: slotName(slot), hint: NAMES.SLOTS[slot]?.[1] ?? "", kind: def?.multi ? "check" : "radio", region: slot,
    note: def?.multi ? `Up to ${def.max ?? "several"}; the oldest one goes when you add another.` : def?.required ? "" : "",
    choices(m) {
      const have = idsIn(m.figure, slot);
      const first = kindTheme(m);
      const parts = partsIn(slot).filter((p) => !(`${slot}:${p.id}` in LEFT_OUT)).map((p) => ({ key: p.id, label: partName(slot, p.id), selected: have.includes(p.id), rarity: p.rarity, theme: NAMES.THEMES[p.file] ?? "More" }));
      const order = [...new Set(["Classic", first, ...parts.map((p) => p.theme)])].filter(Boolean);
      parts.sort((a, b) => order.indexOf(a.theme) - order.indexOf(b.theme));
      return [...(optional ? [{ key: "none", label: "None", selected: have.length === 0, theme: "Classic" }] : []), ...parts];
    },
    options(m) {
      return this.choices(m).map((c) => {
        const figure = withPart(m.figure, slot, c.key === "none" ? null : c.key);
        return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure, [slot])), apply: (mm) => ({ ...mm, figure: withPart(mm.figure, slot, c.key === "none" ? null : c.key) }) };
      });
    },
  };
};

const SPECIES_NOTE = "Changing it keeps your colour and every other pick; only what can't go with it changes, and the tile says what.";
const anyOf = (keys) => (mm) => { const [family, member] = keys[Math.floor(Math.random() * keys.length)].split("/"); return { ...mm, figure: withSpecies(mm.figure, family, member) }; };
const toSpecies = (key) => (mm) => { const [family, member] = key.split("/"); return { ...mm, figure: withSpecies(mm.figure, family, member) }; };
const ALL_MEMBERS = NAMES.KINDS.flatMap((k) => Object.keys(k.variants));

const S = {
  kind: { id: "kind", label: "Kind", hint: "What it is: a monster, a cat, a robot…", kind: "radio", region: "creature", note: SPECIES_NOTE, random: (m) => anyOf(ALL_MEMBERS)(m), dice: "Any kind",
    choices(m) { const now = creatureOf(m.figure); return NAMES.KINDS.map((k) => ({ key: k.id, label: k.name, selected: now?.kind.id === k.id, theme: k.shelf })); },
    options(m) {
      const old = speciesOf(m.figure);
      return this.choices(m).map((c) => {
        const first = Object.keys(NAMES.KINDS.find((k) => k.id === c.key).variants)[0];
        const [family, member] = first.split("/");
        const figure = withSpecies(m.figure, family, member, old);
        return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure, [...speciesSlots(family, member), ...(old ? speciesSlots(old.family, old.member) : [])])), apply: toSpecies(first) };
      });
    } },
  variant: { id: "variant", label: "Variant", kind: "radio", region: "creature", note: SPECIES_NOTE,
    get hint() { const c = creatureOf(ui.member.figure); return c ? `The ${c.kind.name.toLowerCase()} kind's variants` : "Pick a kind first"; },
    random: (m) => { const c = creatureOf(m.figure); return c ? anyOf(Object.keys(c.kind.variants))(m) : anyOf(ALL_MEMBERS)(m); },
    choices(m) {
      const c = creatureOf(m.figure);
      if (!c) return [];
      return Object.entries(c.kind.variants).map(([key, label]) => ({ key, label, selected: key === c.key }));
    },
    options(m) {
      const old = speciesOf(m.figure);
      return this.choices(m).map((c) => {
        const [family, member] = c.key.split("/");
        const figure = withSpecies(m.figure, family, member, old);
        return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure, [...speciesSlots(family, member), ...(old ? speciesSlots(old.family, old.member) : [])])), apply: toSpecies(c.key) };
      });
    } },
  body: { id: "body", label: "Body shape", hint: "The silhouette; parts that can't fit come off", kind: "radio", region: "creature",
    choices: (m) => BODIES.map((b) => ({ key: b.id, label: NAMES.BODIES[b.id] ?? b.id, selected: m.figure.body === b.id })),
    options(m) { return this.choices(m).map((c) => { const figure = withBody(m.figure, c.key); return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure)), apply: (mm) => ({ ...mm, figure: withBody(mm.figure, c.key) }) }; }); } },
  swatch: { id: "swatch", label: "Coat", hint: "A ready-made coat, or any colour below", kind: "radio", region: "coat", editor: "coat",
    choices: (m) => SWATCHES.map(([id, hue, sat, light]) => ({ key: id, label: NAMES.COATS[id] ?? id, hsl: { hue, sat, light },
      selected: !m.figure.shiny && m.figure.color.hue === hue && m.figure.color.sat === sat && m.figure.color.light === light })),
    options(m) { return this.choices(m).map((c) => { const recolour = (mm) => ({ ...mm, figure: { ...mm.figure, color: { ...mm.figure.color, ...c.hsl }, shiny: undefined } });
      return { ...c, figure: recolour(m).figure, apply: recolour }; }); } },
  colour: { id: "colour", label: "Coat colour", hint: "Any colour, in HSL, RGB or hex; and the accent of its spots", kind: "colour", target: "coat", region: "coat" },
  backdrop: { id: "backdrop", label: "Backdrop", hint: "Behind it on the call's stage; the colour ones take the colour below", kind: "radio", region: "backdrop", stage: true, editor: "tint",
    choices: (m) => [...Object.keys(BACKDROPS), ...Object.keys(COLOUR_BACKDROPS)].map((id) => ({ key: id, label: NAMES.BACKDROPS[id] ?? id, selected: m.scene.backdrop === id,
      theme: id in COLOUR_BACKDROPS || id === "tone" || id === "plain" ? "Colours" : "Scenes" })).sort((a, b) => (a.theme === b.theme ? 0 : a.theme === "Colours" ? -1 : 1)),
    options(m) { return this.choices(m).map((c) => ({ ...c, scene: { ...m.scene, backdrop: c.key }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, backdrop: c.key } }) })); } },
  tint: { id: "tint", label: "Backdrop colour", hint: "The colour of Its colour, Flat colour, Fade and Two-tone", kind: "colour", target: "tint", region: "tint" },
  desk: { id: "desk", label: "Desk", hint: "The desk it works at", kind: "radio", region: "desk", stage: true, mood: "working",
    choices: (m) => Object.keys(DESK_TOPS).map((id) => ({ key: id, label: NAMES.DESKS[id] ?? id, selected: m.scene.desk.top === id })),
    options(m) { return this.choices(m).map((c) => ({ ...c, scene: { ...m.scene, desk: { ...m.scene.desk, top: c.key } }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, top: c.key } } }) })); } },
  props: { id: "props", label: "On the desk", hint: `Up to ${MAX_DESK_PROPS} things; the number is where it stands`, kind: "check", region: "props", mood: "working",
    choices: (m) => Object.keys(DESK_PROPS).map((id) => { const at = m.scene.desk.props.indexOf(id); return { key: id, label: NAMES.DESK_PROPS[id] ?? id, selected: at >= 0, badge: at >= 0 ? String(at + 1) : "", prop: id }; }),
    options(m) { return this.choices(m).map((c) => ({ ...c, apply: (mm) => { const list = mm.scene.desk.props; const next = list.includes(c.key) ? list.filter((p) => p !== c.key) : [...list, c.key].slice(-MAX_DESK_PROPS); return { ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, props: next } } }; } })); } },
  work: movesSection("work", "While working", "What it does when the agent works; it takes turns", "works", worksFor, NAMES.WORKS, "working"),
  idle: movesSection("idle", "While idle", "What it does while it waits; it takes turns", "idles", idlesFor, NAMES.IDLES, "idle"),
};
for (const slot of SLOTS) S[slot.id] = partSection(slot.id);

/** Moves: the styles it may take, several at once and at least one; it takes turns between them. */
function movesSection(id, label, hint, key, can, names, mood) {
  return {
    id, label, hint, kind: "check", region: "moves", stage: true, mood, live: true, note: "At least one stays on.",
    choices: (m) => { const all = can(m.figure); return all.map((x) => ({ key: x, label: names[x] ?? x, selected: allowed(m.moves[key], all).includes(x) })); },
    options(m) {
      return this.choices(m).map((c) => ({ ...c, [id]: c.key, apply: (mm) => {
        const all = can(mm.figure), on = allowed(mm.moves[key], all);
        const next = on.includes(c.key) ? on.filter((x) => x !== c.key) : [...on, c.key];
        return next.length ? { ...mm, moves: { ...mm.moves, [key]: next.length === all.length ? null : next } } : mm;
      } }));
    },
    random: (m) => { const all = can(m.figure); const pick = all.filter(() => Math.random() < 0.5); return { ...m, moves: { ...m.moves, [key]: pick.length ? pick : [all[Math.floor(Math.random() * all.length)]] } }; },
  };
}

/** The sections, grouped: the creator's list and the overview's rows. */
const GROUPS = [
  { id: "creature", label: "Creature", rows: ["kind", "variant", "body"] },
  { id: "face", label: "Face", rows: ["eyes", "mouth", "nose", "cheeks", "marks"] },
  { id: "head", label: "Head", rows: ["top", "headgear", "earwear", "eyewear"] },
  { id: "body", label: "Body", rows: ["arms", "legs", "tail", "back", "pattern"] },
  { id: "extras", label: "Accessories", rows: ["neckwear", "held", "pins"] },
  { id: "colour", label: "Colour", rows: ["swatch"] },
  { id: "scene", label: "Scene", rows: ["backdrop", "desk", "props"] },
  { id: "moves", label: "Moves", rows: ["work", "idle"] },
];
// Any slot a newer engine adds and no group names yet still gets a place, in Accessories.
{
  const named = new Set(GROUPS.flatMap((g) => g.rows));
  for (const s of SLOTS) if (!named.has(s.id)) GROUPS.find((g) => g.id === "extras").rows.push(s.id);
}
const ORDER = GROUPS.flatMap((g) => g.rows);
const zoomOf = (s) => (s.stage ? "scene" : s.region === "props" ? "props" : s.region === "creature" || s.region === "coat" ? "full" : "part");

// ---------- the customiser's state ----------

const LAYOUTS = [["creator", "Creator", "creator"], ["overview", "Overview", "rows"]];
const ui = { member: saved, opened: saved, history: [], future: [], layout: "creator", optionsMode: "right", drilled: false, active: "kind", open: null,
  previewMood: "idle", colourMode: "hsl", colourBase: null };

function change(next, opts = {}) {
  ui.history.push(ui.member);
  if (ui.history.length > 100) ui.history.shift();
  ui.future = [];
  ui.member = crewMember(next);
  draw(opts);
}
const undo = () => { const prev = ui.history.pop(); if (!prev) return; ui.future.push(ui.member); ui.member = prev; draw(); };
const redo = () => { const next = ui.future.pop(); if (!next) return; ui.history.push(ui.member); ui.member = next; draw(); };

function open() {
  ui.member = ui.opened = saved;
  ui.history = [];
  ui.future = [];
  $("customiser").showModal();
  $("open").setAttribute("aria-expanded", "true");
  draw();
  focusFirst();
}

/** The creator's sub-option: options beside the creature ("right") or in the menu itself ("drill"). */
function setOptions(id) {
  ui.optionsMode = id === "drill" ? "drill" : "right";
  ui.drilled = false;
  const url = new URL(location.href);
  if (ui.optionsMode === "right") url.searchParams.delete("options"); else url.searchParams.set("options", "drill");
  history.replaceState(null, "", url);
  draw();
  focusFirst();
}

function setLayout(id) {
  ui.layout = LAYOUTS.some(([l]) => l === id) ? id : "creator";
  const url = new URL(location.href);
  if (ui.layout === "creator") url.searchParams.delete("layout"); else url.searchParams.set("layout", ui.layout);
  history.replaceState(null, "", url);
  draw();
  focusFirst();
}

/** Everything that shows the member, in the layout in use; the focus is put back on the redrawn twin of what had it. */
function draw({ keepTiles = false } = {}) {
  const had = document.activeElement;
  const memo = had && { id: had.id, key: had.dataset?.key, slot: had.dataset?.slot, go: had.dataset?.go, in: had.closest("[data-tiles]")?.dataset.tiles };
  $("customiser").dataset.layout = ui.layout;
  $("options-mode").hidden = ui.layout !== "creator";
  $("options-mode").innerHTML = [["right", "Beside the creature"], ["drill", "In the menu"]].map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === ui.optionsMode}" tabindex="${id === ui.optionsMode ? 0 : -1}" data-set-options="${id}" title="Options: ${label.toLowerCase()}">${label}</button>`).join("");
  $("layouts").innerHTML = LAYOUTS.map(([id, label, ic]) => `<button type="button" role="radio" aria-checked="${id === ui.layout}" tabindex="${id === ui.layout ? 0 : -1}" data-set-layout="${id}" title="${label} layout (L)">${icon(ic, 15)}<span>${label}</span></button>`).join("");
  if (ui.layout === "creator") drawCreator(keepTiles); else drawOverview(keepTiles);
  syncActions();
  if (document.activeElement === had && had?.isConnected) return;
  restoreFocus(memo);
}

function syncActions() {
  for (const b of $("customiser").querySelectorAll('[data-run="undo"]')) b.disabled = !ui.history.length;
  for (const b of $("customiser").querySelectorAll('[data-run="redo"]')) b.disabled = !ui.future.length;
  if (document.activeElement !== $("name")) $("name").value = ui.member.name;
  $("config").textContent = memberJson(ui.member);
}

function restoreFocus(memo) {
  if (!memo || !$("customiser").open) return;
  if (memo.in) { const box = document.querySelector(`[data-tiles="${memo.in}"]`); if (box) return focusTiles(box, memo.key); }
  if (memo.go) return document.querySelector(`[data-go="${memo.go}"]`)?.focus();
  if (memo.slot) return document.querySelector(`.slot[data-slot="${memo.slot}"]`)?.focus();
  if (memo.id && $(memo.id)) return $(memo.id).focus();
  focusFirst();
}
function focusFirst() {
  if (ui.layout === "creator") return document.querySelector(`[data-go="${ui.active}"]`)?.focus();
  const slot = (ui.open && document.querySelector(`.slot[data-slot="${ui.open}"]`)) || document.querySelector("#alt .slot");
  slot?.focus();
}

function stageInto(box) {
  const m = ui.member;
  box.innerHTML = stageHtml(m, { mood: ui.previewMood, work: workOf(m), idle: idleOf(m) });
  scaler.observe(box.firstElementChild);
}
const moodsInto = (el) => moodSeg(el, ui.previewMood, (mood) => { ui.previewMood = mood; draw(); });

// ---------- tiles ----------

function tilePreview(o, s) {
  const m = ui.member;
  if (o.prop) return `<svg class="prop-thumb" viewBox="-40 -80 80 86" aria-hidden="true">${ownIds(DESK_PROPS[o.prop][1])}</svg>`;
  if (s.stage) return stageHtml(m, { mood: s.mood ?? "idle", scene: o.scene ?? m.scene, height: 120, work: o.work ?? workOf(m), idle: o.idle ?? idleOf(m) });
  const figure = o.figure ?? m.figure;
  return zoomOf(s) === "part" ? crop(avatarHtml(figure), s.region, figure) : avatarHtml(figure);
}

function tileHtml(o, s, focusable) {
  const role = s.kind === "check" ? "checkbox" : "radio";
  const swaps = o.swapLine ? `<span class="tile-warn" title="Also changes ${o.swaps.join("; ")}">${icon("swap", 11)}${o.swapLine}</span>` : "";
  const title = [o.label, o.rarity && `(${o.rarity})`, o.swaps?.length && `also changes ${o.swaps.join("; ")}`].filter(Boolean).join(" · ");
  return `<button type="button" class="tile${o.dice ? " dice" : ""}${o.rarity ? ` ${o.rarity}` : ""}" role="${role}" aria-checked="${o.selected}" tabindex="${focusable ? 0 : -1}" data-key="${o.key}" title="${title}">
<span class="thumb">${tilePreview(o, s)}</span>
<span class="tile-label">${o.label}</span>${swaps}${o.rarity ? `<i class="rarity" title="${o.rarity}">${o.rarity === "rare" ? "★" : "◆"}</i>` : ""}${o.badge ? `<i class="badge">${o.badge}</i>` : ""}<i class="tick">${icon("check", 14)}</i></button>`;
}

/** A box of tiles for section `s`, under its themes' headings: the creator's grid, or an overview row's strip. */
function tilesInto(box, s, { focusKey } = {}) {
  box.dataset.tiles = s.id;
  box.dataset.zoom = zoomOf(s);
  box.dataset.kind = s.kind;
  box.toggleAttribute("data-live", Boolean(s.live));
  box.setAttribute("aria-label", s.label);
  if (s.kind === "colour") { box.dataset.target = s.target; box.setAttribute("role", "group"); box.innerHTML = colourHtml(s.target); syncColour(box); return; }
  box.setAttribute("role", s.kind === "check" ? "group" : "radiogroup");
  const options = s.options(ui.member);
  if (!options.length) { box.innerHTML = `<p class="empty">${s.hint}</p>`; return; }
  const at = Math.max(0, options.findIndex((o) => (focusKey ? o.key === focusKey : o.selected)));
  const themes = new Set(options.map((o) => o.theme).filter(Boolean));
  let last = null;
  box.innerHTML = options.map((o, i) => {
    const head = themes.size > 1 && o.theme !== last ? `<h4 class="tile-theme">${o.theme === kindTheme(ui.member) && o.theme !== "Classic" ? `For a ${creatureOf(ui.member.figure).kind.name.toLowerCase()}` : o.theme}</h4>` : "";
    last = o.theme;
    return head + tileHtml(o, s, i === at);
  }).join("");
  // A section with a colour editor (coat, backdrop) shows it under its tiles; an overview strip, under the strip.
  const host = box.closest(".ov-row") ?? box;
  host.querySelector(".inline-editor")?.remove();
  if (s.editor) {
    host.insertAdjacentHTML("beforeend", `<div class="inline-editor" data-target="${s.editor}"><h4 class="tile-theme">${s.editor === "tint" ? "Backdrop colour" : "Any colour"}</h4>${colourHtml(s.editor)}</div>`);
    syncColour(host.querySelector(".inline-editor"));
  }
}

/** After a pick inside the same box: the tiles' pictures stand (they differ in this slot only), their state moves. */
function refreshTiles(box, s) {
  if (s.kind === "colour") return syncColour(box);
  const editor = (box.closest(".ov-row") ?? box).querySelector(".inline-editor");
  if (editor) syncColour(editor);
  for (const o of s.options(ui.member)) {
    const tile = box.querySelector(`[data-key="${CSS.escape(o.key)}"]`);
    if (!tile) continue;
    tile.setAttribute("aria-checked", String(o.selected));
    const badge = tile.querySelector(".badge");
    if (o.badge && !badge) tile.insertAdjacentHTML("beforeend", `<i class="badge">${o.badge}</i>`);
    else if (badge) { if (o.badge) badge.textContent = o.badge; else badge.remove(); }
    tile.querySelector(".tile-warn")?.remove();
    if (o.swapLine) tile.querySelector(".tile-label").insertAdjacentHTML("afterend", `<span class="tile-warn" title="Also changes ${o.swaps.join("; ")}">${icon("swap", 11)}${o.swapLine}</span>`);
  }
}

function focusTiles(box, key) {
  const tile = (key && box.querySelector(`[data-key="${CSS.escape(key)}"]`)) || box.querySelector('.tile[tabindex="0"]') || box.querySelector("button, input");
  tile?.focus();
}

/** A pick: picks that change the whole figure draw the tiles again (their pictures change); others only move state. */
function pickIn(s, key) {
  const o = s.options(ui.member).find((x) => x.key === key);
  if (!o) return;
  if (s.kind === "radio" && o.selected) return;
  const next = o.apply(ui.member);
  if (next === ui.member) return;
  if (s.mood) ui.previewMood = s.mood;
  const reshapes = ["kind", "variant", "body", "swatch"].includes(s.id) || s.stage;
  change(next, { keepTiles: !reshapes });
}

/** ‹ › on an overview row: the next or previous choice of a radio section. */
function cycle(s, step) {
  if (s.kind !== "radio") return;
  const list = s.choices(ui.member);
  if (!list.length) return;
  const at = list.findIndex((c) => c.selected);
  const next = list[(at + step + list.length) % list.length];
  if (s.mood) ui.previewMood = s.mood;
  change(s.options(ui.member).find((x) => x.key === next.key).apply(ui.member));
}

/** Arrow keys over tiles: a 2-D roving focus by position; in a radio box the selection follows. */
function tileKeys(event, box) {
  const tiles = [...box.querySelectorAll(".tile:not(.shiny)")];
  const here = document.activeElement;
  const i = tiles.indexOf(here);
  if (i < 0) return false;
  let next;
  if (event.key === "ArrowRight") next = tiles[i + 1];
  else if (event.key === "ArrowLeft") next = tiles[i - 1];
  else if (event.key === "Home") next = tiles[0];
  else if (event.key === "End") next = tiles.at(-1);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const r = here.getBoundingClientRect(), down = event.key === "ArrowDown";
    let best = null, score = Infinity;
    for (const t of tiles) {
      const q = t.getBoundingClientRect();
      const dy = down ? q.top - r.top : r.top - q.top;
      if (dy < 8) continue;
      const d = dy * 4 + Math.abs(q.left - r.left);
      if (d < score) { score = d; best = t; }
    }
    next = best;
  } else return false;
  if (!next) return event.key === "ArrowLeft" || event.key === "ArrowUp" ? false : (event.preventDefault(), true);
  event.preventDefault();
  for (const t of tiles) t.tabIndex = t === next ? 0 : -1;
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  const s = S[box.dataset.tiles];
  if (s.kind === "radio") pickIn(s, next.dataset.key);
  return true;
}

// ---------- the colour editor: HSL, RGB or hex, kept in sync; the picker is the platform's ----------

const COLOUR_MODES = [["hsl", "HSL"], ["rgb", "RGB"], ["hex", "Hex"]];
const colourOf = (target, m = ui.member) => (target === "tint" ? m.scene.tint ?? m.figure.color : m.figure.color);
const coatHex = (c) => rgbToHex(hslToRgb(c));
function withColour(target, m, c) {
  return target === "tint" ? { ...m, scene: { ...m.scene, tint: { hue: c.hue, sat: c.sat, light: c.light } } }
    : { ...m, figure: { ...m.figure, color: c, shiny: undefined } };
}
function colourHtml(target) {
  const c = colourOf(target);
  const [r, g, b] = hslToRgb(c);
  const slider = (key, label, max, value) => `<label class="tune-row"><span>${label}<output data-out="${key}">${Math.round(value)}</output></span>
<input type="range" data-col="${key}" min="0" max="${max}" value="${Math.round(value)}"></label>`;
  const mode = ui.colourMode;
  const fields = mode === "hsl" ? slider("hue", "Hue", 359, c.hue) + slider("sat", "Saturation", 100, c.sat) + slider("light", "Lightness", 100, c.light)
    : mode === "rgb" ? slider("r", "Red", 255, r) + slider("g", "Green", 255, g) + slider("b", "Blue", 255, b)
    : `<div class="hex-row"><input type="color" data-col="picker" value="${rgbToHex([r, g, b])}" aria-label="Pick a colour">
<label>Hex <input type="text" data-col="hex" value="${rgbToHex([r, g, b])}" maxlength="7" spellcheck="false" autocomplete="off"></label></div>`;
  return `<div class="tune" data-mode="${mode}">
<div class="seg colour-modes" role="radiogroup" aria-label="Colour as">${COLOUR_MODES.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === mode}" data-colmode="${id}">${label}</button>`).join("")}</div>
<span class="coat-chip" title="The colour"></span>
${fields}${target === "coat" ? `${slider("spot", "Accent (spots and patterns)", 359, c.spot)}
<button type="button" class="tile shiny" role="switch" aria-checked="${Boolean(ui.member.figure.shiny)}" data-run="shiny" title="The legendary gold coat">
<span class="thumb">${avatarHtml({ ...ui.member.figure, shiny: true })}</span><span class="tile-label">Shiny gold</span><i class="tick">${icon("check", 14)}</i></button>`
  : `<button type="button" class="act own-colour" data-run="untint" ${ui.member.scene.tint ? "" : "disabled"}>Use its own colour</button>`}</div>`;
}

/** The editor's fields from the member, without drawing them again (a slider being dragged keeps its grip). */
function syncColour(box) {
  const c = { spot: ui.member.figure.color.spot, ...colourOf(box.dataset.target) };
  const rgb = hslToRgb(c), hex = rgbToHex(rgb);
  const values = { hue: c.hue, sat: c.sat, light: c.light, spot: c.spot, r: rgb[0], g: rgb[1], b: rgb[2], picker: hex, hex };
  for (const input of box.querySelectorAll("[data-col]")) {
    if (input === document.activeElement && input.type === "text") continue;
    const v = values[input.dataset.col];
    input.value = typeof v === "number" ? Math.round(v) : v;
  }
  for (const out of box.querySelectorAll("[data-out]")) out.textContent = Math.round(values[out.dataset.out]);
  const tracks = { hue: `linear-gradient(90deg,${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} ${c.sat}% ${c.light}%)`)})`,
    sat: `linear-gradient(90deg,hsl(${c.hue} 0% ${c.light}%),hsl(${c.hue} 100% ${c.light}%))`, light: `linear-gradient(90deg,#000,hsl(${c.hue} ${c.sat}% 50%),#fff)`,
    r: `linear-gradient(90deg,rgb(0 ${rgb[1]} ${rgb[2]}),rgb(255 ${rgb[1]} ${rgb[2]}))`, g: `linear-gradient(90deg,rgb(${rgb[0]} 0 ${rgb[2]}),rgb(${rgb[0]} 255 ${rgb[2]}))`,
    b: `linear-gradient(90deg,rgb(${rgb[0]} ${rgb[1]} 0),rgb(${rgb[0]} ${rgb[1]} 255))`,
    spot: `linear-gradient(90deg,${Array.from({ length: 13 }, (_, i) => `hsl(${(c.hue + i * 30) % 360} 80% 68%)`)})` };
  for (const input of box.querySelectorAll("input[type=range]")) input.style.setProperty("--track", tracks[input.dataset.col]);
  const chip = box.querySelector(".coat-chip");
  if (chip) chip.style.background = hex;
  box.querySelector("[data-run=shiny]")?.setAttribute("aria-checked", String(Boolean(ui.member.figure.shiny)));
  const own = box.querySelector("[data-run=untint]");
  if (own) own.disabled = !ui.member.scene.tint;
}

/** One edit from the editor: the first of a drag is one undo step; the preview follows every move. */
function colourInput(input, committed) {
  const key = input.dataset.col;
  const box = input.closest("[data-target]");
  const target = box.dataset.target;
  const c = { spot: ui.member.figure.color.spot, ...colourOf(target) };
  let next;
  if (["hue", "sat", "light", "spot"].includes(key)) next = { ...c, [key]: Number(input.value) };
  else if (["r", "g", "b"].includes(key)) { const rgb = hslToRgb(c); rgb["rgb".indexOf(key)] = Number(input.value); next = { ...c, ...rgbToHsl(rgb) }; }
  else { const rgb = hexToRgb(input.value); if (!rgb) { if (committed) syncColour(box); return; } next = { ...c, ...rgbToHsl(rgb) }; }
  if (!ui.colourBase) { ui.colourBase = ui.member; ui.history.push(ui.member); ui.future = []; }
  ui.member = crewMember(key === "spot" ? { ...ui.member, figure: { ...ui.member.figure, color: next } } : withColour(target, ui.member, next));
  if (committed) { ui.colourBase = null; draw({ keepTiles: true }); return; }
  syncColour(box);
  previewOnly();
}
/** The stage and the small views, while a slider moves. */
function previewOnly() {
  const stage = $("cz-stage");
  if (stage) stageInto(stage);
  syncActions();
}

// ---------- layout 1: creator (list | creature | options) ----------

function drawCreator(keepTiles) {
  const alt = $("alt");
  const s = S[ui.active];
  const drill = ui.optionsMode === "drill";
  const grid = alt.querySelector("#cr-grid");
  if (keepTiles && grid && grid.dataset.tiles === s.id && alt.dataset.layout === "creator" && alt.dataset.options === ui.optionsMode) {
    refreshTiles(grid, s);
    stageInto($("cz-stage"));
    $("cr-traits").textContent = describe(ui.member);
    return;
  }
  const i = ORDER.indexOf(s.id);
  const prev = S[ORDER[(i - 1 + ORDER.length) % ORDER.length]], next = S[ORDER[(i + 1) % ORDER.length]];
  alt.dataset.layout = "creator";
  alt.dataset.options = ui.optionsMode;
  const list = `<nav class="cr-list" aria-label="What to edit">${GROUPS.map((g) => `<div class="cr-group"><h3>${g.label}</h3>
${g.rows.map((id) => `<button type="button" class="cr-item" data-go="${id}" ${id === ui.active ? 'aria-current="true" tabindex="0"' : 'tabindex="-1"'}>${S[id].label}${drill ? `<span aria-hidden="true">${icon("next", 14)}</span>` : ""}</button>`).join("")}</div>`).join("")}</nav>`;
  const options = `<section class="cr-options" aria-labelledby="cr-title">
${drill ? `<button type="button" class="cr-back" data-run="back" title="Back to the list (Esc)">${icon("prev", 16)}All parts</button>` : ""}
<header class="cr-head"><button type="button" class="step" data-go="${prev.id}" data-step tabindex="-1" title="${prev.label} (Q or Page Up)" aria-label="Previous section: ${prev.label}">${icon("prev", 18)}</button>
<div class="cr-title"><h3 id="cr-title">${s.label}</h3><small>${s.hint ?? ""}</small></div>
<button type="button" class="step" data-go="${next.id}" data-step tabindex="-1" title="${next.label} (E or Page Down)" aria-label="Next section: ${next.label}">${icon("next", 18)}</button></header>
<div class="cr-tools">${s.kind === "colour" ? "" : diceButton(s)}${s.note ? `<p class="cr-note">${s.note}</p>` : ""}</div>
<div id="cr-grid" class="grid"></div>
<p class="cr-keys">${drill ? "<kbd>Esc</kbd> back to the list" : "<kbd>↑</kbd><kbd>↓</kbd> section · <kbd>→</kbd>/<kbd>Enter</kbd> into the options · <kbd>Esc</kbd> back"} · <kbd>Q</kbd><kbd>E</kbd> step</p></section>`;
  // The creature is the hero: the stage fills its card, with the edit tools floating over it and the moods under it.
  const tool = (run, ic, label, keys) => `<button type="button" class="tool" data-run="${run}" title="${label} (${keys})" aria-label="${label}">${icon(ic, 18)}</button>`;
  const stage = `<section class="cr-stage" aria-label="Your creature"><div id="cz-stage" class="preview-stage"></div>
<div class="cr-toolbar" role="toolbar" aria-label="Edit">${tool("undo", "undo", "Undo", "Z")}${tool("redo", "redo", "Redo", "Shift+Z")}<span class="sep"></span>${tool("reset", "reset", "Reset", "Backspace")}
<button type="button" class="tool wide" data-run="random" title="A whole new creature (R)">${icon("dice", 17)}<span>Randomise all</span></button></div>
<div class="cr-bottom"><div class="seg" id="cz-moods" role="radiogroup" aria-label="Preview as"></div><p class="traits" id="cr-traits">${describe(ui.member)}</p></div></section>`;
  alt.innerHTML = drill ? `<div class="cr-panel${ui.drilled ? " in" : ""}">${ui.drilled ? options : list}</div>${stage}` : list + stage + options;
  if (!drill || ui.drilled) tilesInto($("cr-grid"), s);
  stageInto($("cz-stage"));
  moodsInto($("cz-moods"));
}

/** Shows another section's options; `into` puts the focus on them, else on its list entry. */
function go(id, { into = false } = {}) {
  if (!S[id]) return;
  ui.active = id;
  if (ui.layout !== "creator") return;
  if (ui.optionsMode === "drill") ui.drilled = into || ui.drilled && Boolean(document.activeElement?.closest(".cr-options"));
  drawCreator(false);
  syncActions();
  if (into && $("cr-grid")) focusTiles($("cr-grid"));
  else document.querySelector(`.cr-item[data-go="${id}"]`)?.focus();
}
/** The drill-in menu's back arrow: the list again, on the section it came from. */
function back() { ui.drilled = false; drawCreator(false); document.querySelector(`.cr-item[data-go="${ui.active}"]`)?.focus(); }
const step = (n) => { const i = ORDER.indexOf(ui.active); go(ORDER[(i + n + ORDER.length) % ORDER.length], { into: Boolean(document.activeElement?.closest("#cr-grid")) || (ui.optionsMode === "drill" && ui.drilled) }); };

// ---------- layout 2: overview (every section a row; one row opens its strip of options) ----------

/** What a section holds now: its label, and a picture of it. */
function slotNow(s, m, figureHtml) {
  const picked = s.kind === "colour" ? [] : s.choices(m).filter((c) => c.selected);
  let label = picked.map((c) => c.label).join(" + ");
  if (s.kind === "colour") label = s.target === "tint" && !m.scene.tint ? "Its own colour" : coatHex(colourOf(s.target, m));
  else if (!label) label = s.id === "swatch" ? (m.figure.shiny ? "Shiny gold" : "Custom colour") : s.id === "kind" || s.id === "variant" ? "Custom" : "None";
  let pic;
  if (s.region === "coat") pic = `<span class="dot" style="background:${m.figure.shiny ? "linear-gradient(135deg,#f6d36b,#c99a2e)" : coatHex(m.figure.color)}"></span>`;
  else if (s.region === "backdrop") pic = `<span class="crop scene-crop">${ownIds(sceneBackdropSvg(m.scene, m.figure.color))}</span>`;
  else if (s.region === "tint") pic = `<span class="dot" style="background:${coatHex(m.scene.tint ?? m.figure.color)}"></span>`;
  else if (s.region === "desk") pic = `<span class="dot" style="background:linear-gradient(${DESK_TOPS[m.scene.desk.top]?.[1]},${DESK_TOPS[m.scene.desk.top]?.[4]})"></span>`;
  else if (s.region === "props") pic = `<span class="crop prop-crop">${m.scene.desk.props[0] ? `<svg viewBox="-40 -80 80 86" aria-hidden="true">${ownIds(DESK_PROPS[m.scene.desk.props[0]][1])}</svg>` : ""}</span>`;
  else if (s.region === "moves") pic = `<span class="dot glyph">${icon("zap", 16)}</span>`;
  else pic = crop(ownIds(figureHtml), s.region === "creature" ? "" : s.region, m.figure);
  return { label, pic };
}

function drawOverview(keepTiles) {
  const m = ui.member;
  const alt = $("alt");
  const strip = alt.querySelector(".strip[data-tiles]");
  if (keepTiles && strip && strip.dataset.tiles === ui.open && alt.dataset.layout === "overview") {
    refreshTiles(strip, S[ui.open]);
    fillRows(alt, m);
    stageInto($("cz-stage"));
    return;
  }
  alt.dataset.layout = "overview";
  alt.innerHTML = `<section class="ov-preview" aria-label="Your creature"><div id="cz-stage" class="preview-stage"></div><div class="seg" id="cz-moods" role="radiogroup" aria-label="Preview as"></div>
<p class="traits"></p><p class="ov-help"><kbd>↑</kbd><kbd>↓</kbd> section · <kbd>←</kbd><kbd>→</kbd> cycle · <kbd>Enter</kbd> all options · <kbd>Q</kbd><kbd>E</kbd> group</p></section>
<section class="ov-list" aria-label="Every section">${GROUPS.map((g) => `<div class="ov-group"><h3>${g.label}</h3>
${g.rows.map((id) => `<div class="ov-row${ui.open === id ? " open" : ""}"><div class="slot" tabindex="-1" data-slot="${id}" role="group" aria-label="${S[id].label}"></div>
${ui.open === id ? `<div class="strip" data-tiles></div>${S[id].note ? `<p class="strip-note">${S[id].note}</p>` : ""}` : ""}</div>`).join("")}</div>`).join("")}</section>`;
  fillRows(alt, m);
  if (ui.open) tilesInto(alt.querySelector(".strip"), S[ui.open]);
  stageInto($("cz-stage"));
  moodsInto($("cz-moods"));
  const slots = [...alt.querySelectorAll(".slot[data-slot]")];
  const at = slots.find((x) => x.dataset.slot === ui.open) ?? slots[0];
  for (const x of slots) x.tabIndex = x === at ? 0 : -1;
}

/** Each row's face: its picture, its name, its value, its arrows and its dice. */
function fillRows(root, m) {
  const figureHtml = avatarHtml(m.figure);
  for (const el of root.querySelectorAll(".slot[data-slot]")) {
    const s = S[el.dataset.slot];
    const now = slotNow(s, m, figureHtml);
    el.innerHTML = `<span class="slot-pic">${now.pic}</span><span class="slot-text"><small>${s.label}</small><b>${now.label}</b></span>
${s.kind === "radio" ? `<span class="cyc"><button type="button" tabindex="-1" data-cycle="-1" aria-label="Previous ${s.label}">‹</button><button type="button" tabindex="-1" data-cycle="1" aria-label="Next ${s.label}">›</button></span>` : ""}
${s.kind === "colour" ? "" : diceButton(s, { small: true })}<span class="more" aria-hidden="true">${ui.open === s.id ? "▴" : "▾"}</span>`;
    el.setAttribute("aria-expanded", String(ui.open === s.id));
    el.classList.toggle("active", ui.open === s.id);
  }
  const traits = root.querySelector(".traits");
  if (traits) traits.textContent = describe(m);
}

function openRow(id) {
  ui.open = ui.open === id ? null : id;
  draw();
  const box = document.querySelector("#alt .strip[data-tiles]");
  if (ui.open && box) focusTiles(box);
  else document.querySelector(`.slot[data-slot="${id}"]`)?.focus();
}

function slotKeys(event, el) {
  const slots = [...document.querySelectorAll("#alt .slot[data-slot]")];
  const i = slots.indexOf(el);
  // (rows of the overview)
  const s = S[el.dataset.slot];
  const move = (to) => { const next = slots[(to + slots.length) % slots.length]; for (const x of slots) x.tabIndex = x === next ? 0 : -1; next.focus(); next.scrollIntoView({ block: "nearest" }); };
  switch (event.key) {
    case "ArrowDown": move(i + 1); break;
    case "ArrowUp": move(i - 1); break;
    case "ArrowRight": cycle(s, 1); break;
    case "ArrowLeft": cycle(s, -1); break;
    case "Enter": case " ": openRow(s.id); break;
    case "Home": move(0); break;
    case "End": move(slots.length - 1); break;
    default: return false;
  }
  event.preventDefault();
  return true;
}

/** Q / E in the overview: the first row of the previous or next group. */
function jumpGroup(n) {
  const slots = [...document.querySelectorAll("#alt .slot[data-slot]")];
  const id = document.activeElement?.closest(".slot")?.dataset.slot ?? document.activeElement?.closest("[data-tiles]")?.dataset.tiles ?? slots[0]?.dataset.slot;
  const g = GROUPS.findIndex((x) => x.rows.includes(id));
  const target = GROUPS[(g + n + GROUPS.length) % GROUPS.length];
  const el = slots.find((x) => target.rows.includes(x.dataset.slot));
  if (el) { for (const x of slots) x.tabIndex = x === el ? 0 : -1; el.focus(); el.scrollIntoView({ block: "nearest" }); }
}

// ---------- randomise, one section or all ----------

/** Re-rolls one section and nothing else: one body, one coat, a few patterns, any kind… */
function randomIn(s) {
  if (!s) return;
  const m = ui.member;
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  let next;
  if (s.random) next = s.random(m);
  else if (s.kind === "colour") next = withColour(s.target, m, { ...m.figure.color, hue: Math.round(Math.random() * 360), sat: Math.round(30 + Math.random() * 55), light: Math.round(40 + Math.random() * 30) });
  else if (s.id === "props") next = { ...m, scene: { ...m.scene, desk: { ...m.scene.desk, props: Object.keys(DESK_PROPS).sort(() => Math.random() - 0.5).slice(0, 2 + Math.round(Math.random())) } } };
  else if (s.kind === "check") {
    const max = SLOTS.find((x) => x.id === s.id)?.max ?? 2;
    let figure = withPart(m.figure, s.id, null);
    for (const p of partsIn(s.id).filter((p) => !(`${s.id}:${p.id}` in LEFT_OUT)).sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * (max + 1)))) figure = withPart(figure, s.id, p.id);
    next = { ...m, figure };
  } else {
    const options = s.options(m).filter((o) => !o.selected);
    if (!options.length) return;
    next = any(options).apply(m);
  }
  if (s.mood) ui.previewMood = s.mood;
  change(next);
}
/** The section in hand: what Shift+R re-rolls. */
const focusedSection = () => S[document.activeElement?.closest(".slot")?.dataset.slot ?? document.activeElement?.closest("[data-tiles]")?.dataset.tiles
  ?? (ui.layout === "creator" ? ui.active : ui.open)];
const diceButton = (s, { small = false } = {}) => {
  const label = s.dice ?? `Random ${s.label.toLowerCase()}`;
  return `<button type="button" class="${small ? "dice-mini" : "act dice-btn"}" data-dice="${s.id}" ${small ? 'tabindex="-1"' : ""} title="${label}: re-rolls only this (Shift+R)" aria-label="${label}">${icon("dice", small ? 14 : 15)}${small ? "" : `<span>${label}</span>`}</button>`;
};
const randomSeed = () => `crew-${Math.random().toString(36).slice(2, 8)}`;
const randomise = () => change({ ...memberFromSeed(randomSeed()), name: ui.member.name });

// ---------- the crew member: save, export, import ----------

function save() {
  saved = ui.member;
  localStorage.setItem(STORE, JSON.stringify(saved));
  $("customiser").close("save");
  drawCanvas();
}

function exportFile() {
  const blob = new Blob([memberJson(ui.member) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(ui.member.name || "crew-member").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "crew-member"}.crew.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  note("Downloaded.");
}
async function copyJson() {
  try { await navigator.clipboard.writeText(memberJson(ui.member)); note("Copied to the clipboard."); }
  catch { note("The browser didn't allow the clipboard here: use Download.", true); }
}
/** Imports a crew member from JSON text: one undoable change, or a message saying what is wrong. */
function importText(text) {
  const { member, error } = parseMember(text);
  if (error) return note(error, true);
  change(member);
  note(`Imported "${member.name}". Undo (Z) brings back the one before.`);
  $("paste-box").hidden = true;
}
function note(text, bad = false) { const el = $("io-note"); el.textContent = text; el.classList.toggle("bad", bad); }

const RUN = {
  undo, redo, back,
  reset: () => change(ui.opened),
  random: randomise,
  close: () => $("customiser").close(),
  save,
  download: exportFile,
  copy: copyJson,
  "import-file": () => $("import-file").click(),
  "import-paste": () => { $("paste-box").hidden = false; $("paste-text").focus(); },
  "paste-apply": () => importText($("paste-text").value),
  "paste-cancel": () => { $("paste-box").hidden = true; note(""); },
  untint: () => change({ ...ui.member, scene: { ...ui.member.scene, tint: null } }, { keepTiles: true }),
  shiny: () => change({ ...ui.member, figure: { ...ui.member.figure, shiny: !ui.member.figure.shiny } }, { keepTiles: true }),
};

function bind() {
  fillIcons(document);
  $("source").textContent = SOURCE;
  $("open").innerHTML = PALETTE;
  $("open").setAttribute("aria-expanded", "false");
  $("open").onclick = open;
  const dialog = $("customiser");
  dialog.addEventListener("close", () => $("open").setAttribute("aria-expanded", "false"));
  dialog.addEventListener("click", (event) => {
    const t = event.target;
    const run = t.closest("[data-run]");
    if (run) { event.preventDefault(); RUN[run.dataset.run](); return; }
    const dice = t.closest("[data-dice]");
    if (dice) return randomIn(S[dice.dataset.dice]);
    const opts = t.closest("[data-set-options]");
    if (opts) return setOptions(opts.dataset.setOptions);
    const layout = t.closest("[data-set-layout]");
    if (layout) return setLayout(layout.dataset.setLayout);
    const mode = t.closest("[data-colmode]");
    if (mode) { ui.colourMode = mode.dataset.colmode; draw(); return dialog.querySelector(`[data-colmode="${ui.colourMode}"]`)?.focus(); }
    const tile = t.closest("[data-tiles] .tile[data-key]");
    if (tile) return pickIn(S[tile.closest("[data-tiles]").dataset.tiles], tile.dataset.key);
    const target = t.closest("[data-go]");
    if (target) return go(target.dataset.go, { into: ui.optionsMode === "drill" ? !target.hasAttribute("data-step") || ui.drilled : target.hasAttribute("data-step") && Boolean(document.activeElement?.closest("#cr-grid")) });
    const cyc = t.closest("[data-cycle]");
    if (cyc) { const slot = cyc.closest(".slot").dataset.slot; cycle(S[slot], Number(cyc.dataset.cycle)); return document.querySelector(`.slot[data-slot="${slot}"]`)?.focus(); }
    const slot = t.closest(".slot[data-slot]");
    if (slot) return openRow(slot.dataset.slot);
  });
  dialog.addEventListener("input", (event) => { if (event.target.matches("[data-col]") && event.target.dataset.col !== "hex") colourInput(event.target, false); });
  dialog.addEventListener("change", (event) => { if (event.target.matches("[data-col]")) colourInput(event.target, true); });
  $("import-file").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 64 * 1024) return note("That file is too big for a crew member (over 64 KB).", true);
    importText(await file.text());
  });
  $("name").addEventListener("input", (e) => { ui.member = { ...ui.member, name: e.target.value || ui.member.seed }; syncActions(); });
  // Esc inside the options goes back to the section; only from elsewhere does it close the customiser.
  dialog.addEventListener("cancel", (event) => { if (ui.escapeHandled) { event.preventDefault(); ui.escapeHandled = false; } });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open) return;
    const target = event.target;
    const inText = target.matches("input[type=text], textarea");
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "Enter") { event.preventDefault(); return save(); }
    if (!inText && mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); return redo(); }
    if (!inText && mod && event.key.toLowerCase() === "z") { event.preventDefault(); return undo(); }
    if (event.key === "Escape") {
      const box = target.closest("#alt [data-tiles]");
      if (box) {
        event.preventDefault(); ui.escapeHandled = true;
        if (ui.layout === "creator") return ui.optionsMode === "drill" ? back() : document.querySelector(`.cr-item[data-go="${ui.active}"]`)?.focus();
        const id = ui.open; ui.open = null; draw();
        return document.querySelector(`.slot[data-slot="${id}"]`)?.focus();
      }
      if (!$("paste-box").hidden && target.closest("#paste-box")) { event.preventDefault(); ui.escapeHandled = true; return RUN["paste-cancel"](); }
    }
    if (inText || mod || event.altKey) return;
    if (event.key === "PageUp" && ui.layout === "creator") { event.preventDefault(); return step(-1); }
    if (event.key === "PageDown" && ui.layout === "creator") { event.preventDefault(); return step(1); }
    if (target.closest("#layouts") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault(); setLayout(ui.layout === "creator" ? "overview" : "creator"); return $("layouts").querySelector('[aria-checked="true"]')?.focus();
    }
    // The creator's list: ↑/↓ moves through the sections (their options follow), →/Enter goes into them.
    if (target.matches(".cr-item")) {
      const items = [...document.querySelectorAll(".cr-item")];
      const i = items.indexOf(target);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[event.key];
      if (to !== undefined) {
        event.preventDefault();
        const id = items[(to + items.length) % items.length].dataset.go;
        if (ui.optionsMode === "drill") { ui.active = id; for (const x of items) { x.toggleAttribute("aria-current", x.dataset.go === id); x.tabIndex = x.dataset.go === id ? 0 : -1; } return document.querySelector(`.cr-item[data-go="${id}"]`).focus(); }
        return go(id);
      }
      if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") { event.preventDefault(); return go(target.dataset.go, { into: true }); }
    }
    const box = target.closest("[data-tiles]");
    if (box && box.dataset.kind !== "colour" && tileKeys(event, box)) return;
    if (box && ui.layout === "creator" && event.key === "ArrowLeft" && box.dataset.kind !== "colour") {
      event.preventDefault(); return ui.optionsMode === "drill" ? back() : document.querySelector(`.cr-item[data-go="${ui.active}"]`)?.focus();
    }
    if (box && ui.layout === "overview" && (event.key === "ArrowUp" || event.key === "ArrowDown") && box.dataset.kind !== "colour") {
      event.preventDefault(); return document.querySelector(`.slot[data-slot="${box.dataset.tiles}"]`)?.focus();
    }
    if (target.matches(".slot[data-slot]") && slotKeys(event, target)) return;
    if (target.matches("input[type=range]")) return;
    const key = event.key;
    if (key === "l" || key === "L") return setLayout(ui.layout === "creator" ? "overview" : "creator");
    if (key === "q" || key === "Q") return ui.layout === "creator" ? step(-1) : jumpGroup(-1);
    if (key === "e" || key === "E") return ui.layout === "creator" ? step(1) : jumpGroup(1);
    if (key === "R") return randomIn(focusedSection());
    if (key === "r") return randomise();
    if (key === "Z") return redo();
    if (key === "z") return undo();
    if (key === "Backspace") { event.preventDefault(); return RUN.reset(); }
  });
  document.addEventListener("keydown", (event) => {
    if (dialog.open || event.target.matches("input, textarea") || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "c" || event.key === "C") { event.preventDefault(); open(); }
  });
  drawCanvas();
  speak(document);
  // The app's rotation moves on: redraw what shows it.
  setInterval(() => {
    if (canvasMood === "working" || canvasMood === "idle") drawCanvas();
    if (dialog.open && (ui.previewMood === "working" || ui.previewMood === "idle") && !ui.colourBase) previewOnly();
  }, 6000);
  // ?layout=creator|overview[&options=right|drill]; ?open[&section=<id>][&mood=…][&colour=hsl|rgb|hex] opens it there.
  const query = new URLSearchParams(location.search);
  ui.layout = LAYOUTS.some(([l]) => l === query.get("layout")) ? query.get("layout") : "creator";
  if (query.get("colour")) ui.colourMode = query.get("colour");
  ui.optionsMode = query.get("options") === "drill" ? "drill" : "right";
  if (ui.optionsMode === "drill" && query.get("section")) ui.drilled = true;
  const section = query.get("section") ?? query.get("slot");
  if (section && S[section]) { ui.active = section; ui.open = section; }
  if (query.get("mood")) ui.previewMood = query.get("mood");
  if (query.has("open")) open();
}

bind();

// ---------- live reload: a saved edit to this page's files reloads it ----------

const WATCHED = ["/customiser.html", "/customiser.mjs", "/customiser.css", "/customiser/crew.mjs", "/customiser/colour.mjs", "/customiser/names.mjs", "/customiser/backdrops.mjs"];
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
