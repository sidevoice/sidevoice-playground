// The avatar customiser exploration (customiser.html): the creature's canvas, as the call's stage shows it, and a
// character-creator panel behind its brush button. Everything is drawn by sidevoice-web's bichos engine, bundled as
// customiser/bichos.mjs (scripts/customiser-engine.mjs), and moved by the web's own CSS (customiser/bichos.css,
// customiser/call.css). What the person picks is one crew member (customiser/crew.mjs), kept in local storage.
// Three layouts of the same choices, switched by ?layout= (or L): "tabs" (a tab per category), "overview" (every slot
// as a row around the preview, each opening a strip of tiles) and "loadout" (an equipment screen: slot cards around
// the creature, its parts clickable, one picker under it).
import {
  BACKDROPS, BODIES, DESK_PROPS, DESK_TOPS, FAMILIES, MEMBERS, SLOTS, SOURCE, SWATCHES, backdropSvg, deskSvg, idlesFor, idsIn,
  partsIn, renderSpec, withBody, withPart, worksFor,
} from "./customiser/bichos.mjs";
import {
  MAX_DESK_PROPS, crewMember, isSpecies, memberFromSeed, memberJson, sideChanges, speciesOf, speciesSlots, withSpecies,
} from "./customiser/crew.mjs";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "./customiser/colour.mjs";
import { COLOUR_BACKDROPS, sceneBackdropSvg } from "./customiser/backdrops.mjs";

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
  swap: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  tabs: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v6"/>',
  rows: '<path d="M3 5h18M3 12h18M3 19h18"/>',
  loadout: '<rect x="8" y="6" width="8" height="12" rx="3"/><path d="M3 6h2M3 12h2M3 18h2M19 6h2M19 12h2M19 18h2"/>',
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
const BACKDROP_NAMES = { tone: "Its colour", flat: "Flat", fade: "Fade", duo: "Duo" };
/** The customise button's mark: a painter's palette with its blobs of paint. */
const PALETTE = `<svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><path d="M16 3C8.3 3 3 8.6 3 15.2 3 22.4 8.6 29 15.3 29c2.2 0 3.2-1.3 3.2-2.8 0-1.9-1.6-2.4-1.6-4 0-1.4 1.1-2.3 2.6-2.3h3.3C26.5 19.9 29 17 29 13.6 29 7.8 23.4 3 16 3Z" fill="#e9c58f" stroke="#1b1428" stroke-width="2" stroke-linejoin="round"/>
<circle cx="9.5" cy="15" r="2.6" fill="#e5483a"/><circle cx="12" cy="9" r="2.6" fill="#ffd23f"/><circle cx="18.5" cy="7.6" r="2.6" fill="#4fa3ff"/><circle cx="24" cy="12" r="2.6" fill="#58b368"/><circle cx="11" cy="22" r="2.3" fill="#c9b6ec"/></svg>`;

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
function stageHtml(member, { mood = "idle", figure = member.figure, scene = member.scene, height, work, idle, over = "" } = {}) {
  const [, top, topDeep, front, frontDeep] = DESK_TOPS[scene.desk.top] ?? DESK_TOPS.wood;
  const k = height ? `style="--k:${height / 440}"` : "";
  return `<div class="stage-tile" data-mood="${mood}" ${k}><div class="stage-scene">
<div class="stage-backdrop">${ownIds(sceneBackdropSvg(scene, figure.color))}</div>
<div class="stage-agent">${avatarHtml(figure, { mood, work, idle, desk: mood === "working" })}${over}</div>
<div class="stage-desk" style="--desk-top:${top};--desk-top-deep:${topDeep};--desk-front:${front};--desk-front-deep:${frontDeep}">${ownIds(deskSvg(scene.desk))}</div></div></div>`;
}

/** Keeps a stage tile's --k (its height over the scene's 440) as its box resizes. */
const scaler = new ResizeObserver((entries) => { for (const e of entries) e.target.style.setProperty("--k", String(e.contentRect.height / 440)); });

// ---------- the moods a stage can act out, and the rotation the app would run ----------

const MOODS = [["idle", "Idle"], ["speaking", "Speaking"], ["listening", "Listening"], ["working", "Working"]];
let clock = 0;
setInterval(() => { clock += 1; }, 6000);
/** The work or idle style a stage shows: the member's pinned one, else the app's rotation over what it can do. */
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

function drawCanvas() {
  const canvas = $("canvas");
  canvas.innerHTML = stageHtml(saved, { mood: canvasMood, work: workOf(saved), idle: idleOf(saved) });
  scaler.observe(canvas.firstElementChild);
  $("canvas-name").textContent = saved.name;
  $("canvas-traits").textContent = describe(saved);
  moodSeg($("canvas-moods"), canvasMood, (mood) => { canvasMood = mood; drawCanvas(); });
}

const describe = (member) => { const sp = speciesOf(member.figure); return [sp ? human(sp.member) : "Custom", human(member.figure.body) + " body", (member.scene.backdrop === "tone" ? "its colour" : human(member.scene.backdrop).toLowerCase()) + " backdrop",
  member.moves.works ? `works: ${member.moves.works.map((w) => (WORK_NAMES[w] ?? w).toLowerCase()).join(", ")}` : "", member.moves.idles ? `idles: ${member.moves.idles.map((w) => (IDLE_NAMES[w] ?? w).toLowerCase()).join(", ")}` : ""].filter(Boolean).join(" · "); };


// ---------- close-ups: where each slot sits on the figure, to crop a thumbnail of the live creature there ----------

/** [x, y, zoom] in the figure's 120 box, from its body's frame (bichos kit: top, eyeY, mouthY, armY, half, bottom). */
function regionOf(slot, figure) {
  const f = BODIES.find((b) => b.id === figure.body)?.frame ?? { top: 40, eyeY: 60, mouthY: 77, armY: 76, half: 31, bottom: 97 };
  const face = (f.eyeY + f.mouthY) / 2;
  return {
    top: [60, f.top - 6, 2], headgear: [60, f.top - 6, 1.9], earwear: [60, f.top + 6, 1.7], eyes: [60, f.eyeY, 2.3],
    eyewear: [60, f.eyeY, 2.2], marks: [60, f.eyeY + 2, 2], nose: [60, face, 2.6], mouth: [60, f.mouthY, 2.6],
    cheeks: [60, face + 3, 2.1], neckwear: [60, f.mouthY + 9, 1.9], arms: [60, f.armY, 1.35], held: [60 + f.half + 4, f.armY + 2, 1.9],
    legs: [60, f.bottom - 4, 1.9], tail: [60 + f.half, f.bottom - 14, 1.7], back: [60, f.armY - 6, 1.25],
  }[slot] ?? [60, 68, 1.05];
}
/** A close-up of `html` (one avatar's markup) on `slot`. */
const crop = (html, slot, figure) => { const [x, y, z] = regionOf(slot, figure); return `<span class="crop" style="--cx:${x};--cy:${y};--z:${z}">${ownIds(html)}</span>`; };

// ---------- the choices: sections ----------

/** A section: one set of choices. `choices(m)` lists them cheaply ({ key, label, selected }); `options(m)` adds what a
 *  tile needs (the figure or scene wearing it, the side changes) and `apply`. `kind`: "radio" picks one (selection
 *  follows the arrow keys), "check" toggles several, "colour" is the colour editor. */
/** What else a pick changes, said in words: the line under a tile ("replaces Crown") and its full tooltip. */
const sideText = (changes) => changes.map((c) => `${slotName(c.slot)}: ${c.from.map(human).join(" + ") || "none"} → ${c.to.map(human).join(" + ") || "none"}`);
function sideLine(changes) {
  if (!changes.length) return "";
  if (changes.length > 1) return `changes ${changes.length} parts`;
  const [c] = changes;
  const gone = c.from.filter((x) => !c.to.includes(x)), come = c.to.filter((x) => !c.from.includes(x));
  return gone.length ? `replaces ${human(gone[0])}` : `adds ${human(come[0])}`;
}
const sides = (before, after, except) => { const list = sideChanges(before, after, except); return { swaps: sideText(list), swapLine: sideLine(list) }; };

const partSection = (slot) => {
  const def = SLOTS.find((s) => s.id === slot);
  const optional = !def?.required && !def?.multi;
  return {
    id: slot, label: slotName(slot), kind: def?.multi ? "check" : "radio", region: slot,
    note: def?.multi ? `Up to ${def.max ?? "several"}; the oldest one goes when you add another.` : def?.required ? "Always one." : "",
    choices(m) {
      const have = idsIn(m.figure, slot);
      return [...(optional ? [{ key: "none", label: "None", selected: have.length === 0 }] : []),
        ...partsIn(slot).map((p) => ({ key: p.id, label: human(p.id), selected: have.includes(p.id), rarity: p.rarity }))];
    },
    options(m) {
      return this.choices(m).map((c) => {
        const figure = withPart(m.figure, slot, c.key === "none" ? null : c.key);
        return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure, [slot])), apply: (mm) => ({ ...mm, figure: withPart(mm.figure, slot, c.key === "none" ? null : c.key) }) };
      });
    },
  };
};

const SPECIES_NOTE = "Changes the species only: its body and its own parts come in, your colour and other picks stay. The amber line under a tile says what else would change.";
const anyOf = (members) => (mm) => { const x = members[Math.floor(Math.random() * members.length)]; return { ...mm, figure: withSpecies(mm.figure, x.family, x.id) }; };
const speciesSection = (id, label, members) => ({
  id, label, kind: "radio", region: "species", note: SPECIES_NOTE, random: (m) => anyOf(members)(m),
  dice: id === "species" ? "Any species" : `Any ${label.toLowerCase()}`,
  choices(m) {
    const now = speciesOf(m.figure);
    return members.map((x) => ({ key: `${x.family}/${x.id}`, label: human(x.id), sub: FAMILY_NAMES[x.family] ?? human(x.family),
      selected: now ? now.family === x.family && now.member === x.id : false }));
  },
  options(m) {
    const old = speciesOf(m.figure);
    const dice = id === "species" ? [] : [{ key: "any", label: this.dice, dice: true, selected: false, figure: withSpecies(m.figure, members[0].family, members[0].id, old), apply: anyOf(members) }];
    return [...dice, ...this.choices(m).map((c) => {
      const [family, member] = c.key.split("/");
      const figure = withSpecies(m.figure, family, member, old);
      return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure, [...speciesSlots(family, member), ...(old ? speciesSlots(old.family, old.member) : [])])),
        apply: (mm) => ({ ...mm, figure: withSpecies(mm.figure, family, member) }) };
    })];
  },
});

const SWATCH_NAMES = { mostaza: "Mustard", terracota: "Terracotta", "verde azulado": "Teal", salvia: "Sage", ciruela: "Plum", "añil": "Indigo",
  frambuesa: "Raspberry", naranja: "Orange", lima: "Lime", cielo: "Sky", chicle: "Bubblegum", nube: "Cloud" };
const coatHex = (c) => rgbToHex(hslToRgb(c));

const S = {
  species: speciesSection("species", "Species", MEMBERS),
  body: { id: "body", label: "Shape", kind: "radio", region: "body", note: "Parts that don't fit the new shape come off: ⇄ says which.",
    choices: (m) => BODIES.map((b) => ({ key: b.id, label: human(b.id), selected: m.figure.body === b.id })),
    options(m) { return this.choices(m).map((c) => { const figure = withBody(m.figure, c.key); return { ...c, figure, ...(c.selected ? {} : sides(m.figure, figure)), apply: (mm) => ({ ...mm, figure: withBody(mm.figure, c.key) }) }; }); } },
  swatch: { id: "swatch", label: "Coat", kind: "radio", region: "coat", note: "Ready-made coats; fine-tune in HSL, RGB or hex.",
    choices: (m) => SWATCHES.map(([id, hue, sat, light]) => ({ key: id, label: SWATCH_NAMES[id] ?? human(id), hsl: { hue, sat, light },
      selected: !m.figure.shiny && m.figure.color.hue === hue && m.figure.color.sat === sat && m.figure.color.light === light })),
    options(m) { return this.choices(m).map((c) => { const recolour = (mm) => ({ ...mm, figure: { ...mm.figure, color: { ...mm.figure.color, ...c.hsl }, shiny: undefined } });
      return { ...c, figure: recolour(m).figure, apply: recolour }; }); } },
  colour: { id: "colour", label: "Tune", kind: "colour", target: "coat", region: "coat", note: "The coat in HSL, RGB or hex (kept in sync), and the accent its spots and patterns take." },
  backdrop: { id: "backdrop", label: "Backdrop", kind: "radio", region: "backdrop", stage: true, note: "Scenes, and colour backdrops painted in the Backdrop colour.",
    choices: (m) => [...Object.keys(BACKDROPS), ...Object.keys(COLOUR_BACKDROPS)].map((id) => ({ key: id, label: BACKDROP_NAMES[id] ?? human(id), selected: m.scene.backdrop === id })),
    options(m) { return this.choices(m).map((c) => ({ ...c, scene: { ...m.scene, backdrop: c.key }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, backdrop: c.key } }) })); } },
  desk: { id: "desk", label: "Desk", kind: "radio", region: "desk", stage: true, mood: "working",
    choices: (m) => Object.keys(DESK_TOPS).map((id) => ({ key: id, label: human(id), selected: m.scene.desk.top === id })),
    options(m) { return this.choices(m).map((c) => ({ ...c, scene: { ...m.scene, desk: { ...m.scene.desk, top: c.key } }, apply: (mm) => ({ ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, top: c.key } } }) })); } },
  props: { id: "props", label: "On the desk", kind: "check", region: "props", mood: "working", note: `Up to ${MAX_DESK_PROPS}, left, right, then left again: the number is its place.`,
    choices: (m) => Object.keys(DESK_PROPS).map((id) => { const at = m.scene.desk.props.indexOf(id); return { key: id, label: human(id), selected: at >= 0, badge: at >= 0 ? String(at + 1) : "", prop: id }; }),
    options(m) { return this.choices(m).map((c) => ({ ...c, apply: (mm) => { const list = mm.scene.desk.props; const next = list.includes(c.key) ? list.filter((p) => p !== c.key) : [...list, c.key].slice(-MAX_DESK_PROPS); return { ...mm, scene: { ...mm.scene, desk: { ...mm.scene.desk, props: next } } }; } })); } },
  tint: { id: "tint", label: "Backdrop colour", kind: "colour", target: "tint", region: "tint",
    note: "The colour the colour backdrops (Its colour, Flat, Fade, Duo) are painted in; by default the creature's own." },
  work: movesSection("work", "While working", "works", worksFor, WORK_NAMES, "working"),
  idle: movesSection("idle", "While idle", "idles", idlesFor, IDLE_NAMES, "idle"),
};
/** Moves: the styles it may take, several at once and at least one; it takes turns between them. */
function movesSection(id, label, key, can, names, mood) {
  return {
    id, label, kind: "check", region: id, stage: true, mood, live: true, note: "Every one picked is in its rotation; at least one stays on.",
    choices: (m) => { const all = can(m.figure); return all.map((x) => ({ key: x, label: names[x] ?? human(x), selected: allowed(m.moves[key], all).includes(x) })); },
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
for (const slot of SLOTS) S[slot.id] = partSection(slot.id);
const FAMILY_SECTIONS = FAMILIES.map((f) => speciesSection(`family-${f.id}`, FAMILY_NAMES[f.id] ?? human(f.id), MEMBERS.filter((x) => x.family === f.id)));
for (const s of FAMILY_SECTIONS) S[s.id] = s;

/** The categories: tabs in the tabbed layout, groups of rows or cards in the others. */
const GROUPS = [
  { id: "species", label: "Species", icon: "paw", zoom: "full", tabs: FAMILY_SECTIONS.map((s) => s.id), rows: ["species"] },
  { id: "body", label: "Body", icon: "blob", zoom: "full", rows: ["body"] },
  { id: "face", label: "Face", icon: "face", zoom: "face", rows: ["eyes", "mouth", "nose", "cheeks", "marks"] },
  { id: "head", label: "Head", icon: "crown", zoom: "head", rows: ["top", "headgear", "earwear", "eyewear"] },
  { id: "limbs", label: "Limbs", icon: "hand", zoom: "full", rows: ["arms", "legs", "tail", "back"] },
  { id: "extras", label: "Extras", icon: "gem", zoom: "full", rows: ["pattern", "neckwear", "held", "pins"] },
  { id: "colour", label: "Colour", icon: "palette", zoom: "full", rows: ["swatch", "colour"] },
  { id: "scene", label: "Scene", icon: "mountain", zoom: "scene", rows: ["backdrop", "tint", "desk", "props"] },
  { id: "moves", label: "Moves", icon: "zap", zoom: "scene", rows: ["work", "idle"] },
];
// Any slot a newer engine adds and no group names yet still gets a place, in Extras.
{
  const named = new Set(GROUPS.flatMap((g) => g.rows));
  for (const s of SLOTS) if (!named.has(s.id)) GROUPS.find((g) => g.id === "extras").rows.push(s.id);
}
const groupOf = (sectionId) => GROUPS.find((g) => g.rows.includes(sectionId) || g.tabs?.includes(sectionId));
const zoomOf = (s) => (s.stage ? "scene" : s.prop ? "props" : groupOf(s.id)?.zoom ?? "full");
const tabSections = (g) => (g.tabs ?? g.rows).map((id) => S[id]);

// ---------- the customiser's state ----------

const LAYOUTS = [["tabs", "Tabs", "tabs"], ["overview", "Overview", "rows"], ["loadout", "Loadout", "loadout"]];
const ui = { member: saved, opened: saved, history: [], future: [], layout: "tabs", tab: 0, section: Object.fromEntries(GROUPS.map((g) => [g.id, 0])),
  previewMood: "idle", colourMode: "hsl", colourBase: null, active: null };
const group = () => GROUPS[ui.tab];
const section = () => tabSections(group())[ui.section[group().id]];

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
  draw();
  focusFirst();
}

function setLayout(id) {
  ui.layout = LAYOUTS.some(([l]) => l === id) ? id : "tabs";
  const url = new URL(location.href);
  if (ui.layout === "tabs") url.searchParams.delete("layout"); else url.searchParams.set("layout", ui.layout);
  history.replaceState(null, "", url);
  draw();
  focusFirst();
}

/** Everything that shows the member, in the layout in use; the focus is put back on the redrawn twin of what had it. */
function draw({ keepTiles = false } = {}) {
  const had = document.activeElement;
  const memo = had && { id: had.id, key: had.dataset?.key, slot: had.dataset?.slot, in: had.closest("[data-tiles]")?.dataset.tiles,
    where: had.closest("#tabs") ? "tabs" : had.closest("#sections") ? "sections" : null };
  const dialog = $("customiser");
  dialog.dataset.layout = ui.layout;
  $("layouts").innerHTML = LAYOUTS.map(([id, label, ic]) => `<button type="button" role="radio" aria-checked="${id === ui.layout}" tabindex="${id === ui.layout ? 0 : -1}" data-set-layout="${id}" title="${label} layout (L)">${icon(ic, 15)}<span>${label}</span></button>`).join("");
  $("tabs-layout").hidden = ui.layout !== "tabs";
  $("alt").hidden = ui.layout === "tabs";
  if (ui.layout === "tabs") drawTabsLayout(keepTiles); else if (ui.layout === "overview") drawOverview(keepTiles); else drawLoadout(keepTiles);
  syncActions();
  if (document.activeElement === had && had?.isConnected) return;
  restoreFocus(memo);
}

function syncActions() {
  dialogButton("undo").disabled = !ui.history.length;
  dialogButton("redo").disabled = !ui.future.length;
  if (document.activeElement !== $("name")) $("name").value = ui.member.name;
  $("config").textContent = memberJson(ui.member);
}
const dialogButton = (run) => $("customiser").querySelector(`.cz-head [data-run="${run}"]`);

function restoreFocus(memo) {
  if (!memo || !$("customiser").open) return;
  if (memo.where === "tabs") return $(`tab-${group().id}`)?.focus();
  if (memo.where === "sections") return $("sections").querySelector('[aria-selected="true"]')?.focus();
  if (memo.in) { const box = document.querySelector(`[data-tiles="${memo.in}"]`); if (box) return focusTiles(box, memo.key); }
  if (memo.slot) return document.querySelector(`.slot[data-slot="${memo.slot}"]`)?.focus();
  if (memo.id && $(memo.id)) return $(memo.id).focus();
  focusFirst();
}
function focusFirst() {
  if (ui.layout === "tabs") return focusTiles($("grid"));
  const slot = (ui.active && document.querySelector(`.slot[data-slot="${ui.active}"]`)) || document.querySelector("#alt .slot");
  slot?.focus();
}

// ---------- the stage preview (every layout) ----------

function stageInto(box, { over = "" } = {}) {
  const m = ui.member;
  box.innerHTML = stageHtml(m, { mood: ui.previewMood, work: workOf(m), idle: idleOf(m), over });
  scaler.observe(box.firstElementChild);
}
const moodsInto = (el) => moodSeg(el, ui.previewMood, (mood) => { ui.previewMood = mood; draw(); });

// ---------- tiles (every layout) ----------

function tilePreview(o, s) {
  const m = ui.member;
  if (o.prop) return `<svg class="prop-thumb" viewBox="-40 -80 80 86" aria-hidden="true">${ownIds(DESK_PROPS[o.prop][1])}</svg>`;
  if (s.stage) return stageHtml(m, { mood: s.mood ?? "idle", scene: o.scene ?? m.scene, height: 110, work: o.work ?? workOf(m), idle: o.idle ?? idleOf(m) });
  return avatarHtml(o.figure ?? m.figure);
}

function tileHtml(o, s, focusable) {
  const role = s.kind === "check" ? "checkbox" : "radio";
  const swaps = o.swapLine ? `<span class="tile-warn" title="Also changes ${o.swaps.join("; ")}">${icon("swap", 11)}${o.swapLine}</span>` : "";
  const title = [o.label, o.sub, o.rarity && `(${o.rarity})`, o.swaps?.length && `also changes ${o.swaps.join("; ")}`].filter(Boolean).join(" · ");
  return `<button type="button" class="tile${o.dice ? " dice" : ""}${o.rarity ? ` ${o.rarity}` : ""}" role="${role}" aria-checked="${o.selected}" tabindex="${focusable ? 0 : -1}" data-key="${o.key}" title="${title}">
<span class="thumb">${tilePreview(o, s)}${o.dice ? `<span class="dice-mark">${icon("dice", 22)}</span>` : ""}</span>
<span class="tile-label">${o.label}</span>${swaps}${o.rarity ? `<i class="rarity">${o.rarity === "rare" ? "★" : "◆"}</i>` : ""}${o.badge ? `<i class="badge">${o.badge}</i>` : ""}<i class="tick">${icon("check", 14)}</i></button>`;
}

/** A box of tiles for section `s`: the grid of the tabbed layout, a row's strip, the loadout's picker. */
function tilesInto(box, s, { focusKey } = {}) {
  box.dataset.tiles = s.id;
  box.dataset.zoom = zoomOf(s);
  box.dataset.kind = s.kind;
  box.toggleAttribute("data-live", Boolean(s.live));
  box.setAttribute("aria-label", s.label);
  if (s.kind === "colour") { box.dataset.target = s.target ?? "coat"; box.setAttribute("role", "group"); box.innerHTML = colourHtml(box.dataset.target); syncColour(box); return; }
  box.setAttribute("role", s.kind === "check" ? "group" : "radiogroup");
  const options = s.options(ui.member);
  const at = Math.max(0, options.findIndex((o) => (focusKey ? o.key === focusKey : o.selected)));
  box.innerHTML = options.map((o, i) => tileHtml(o, s, i === at)).join("");
}

/** After a pick inside the same box: the tiles' pictures stand (they differ in this slot only), their state moves. */
function refreshTiles(box, s) {
  if (s.kind === "colour") return syncColour(box);
  const options = s.options(ui.member);
  for (const o of options) {
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
  const tile = (key && box.querySelector(`[data-key="${CSS.escape(key)}"]`)) || box.querySelector('[tabindex="0"]') || box.querySelector("button, input");
  tile?.focus();
}

/** A pick: species, body and colour picks change every tile's picture, so their box is drawn again; others only move. */
function pickIn(s, key) {
  const o = s.options(ui.member).find((x) => x.key === key);
  if (!o) return;
  if (s.kind === "radio" && o.selected) return;
  const next = o.apply(ui.member);
  if (next === ui.member) return;
  if (s.mood) ui.previewMood = s.mood;
  const reshapes = /^(species|family-|body|swatch)/.test(s.id) || s.stage;
  change(next, { keepTiles: !reshapes });
}

/** ‹ › on a row or a card: the next or previous choice of a radio section. */
function cycle(s, step) {
  if (s.kind !== "radio") return;
  const list = s.choices(ui.member).filter((c) => !c.dice);
  const at = list.findIndex((c) => c.selected);
  const next = list[(at + step + list.length) % list.length];
  if (s.mood) ui.previewMood = s.mood;
  const o = s.options(ui.member).find((x) => x.key === next.key);
  change(o.apply(ui.member));
}

// ---------- the colour editor: HSL, RGB or hex, kept in sync; the picker is the platform's ----------

const COLOUR_MODES = [["hsl", "HSL"], ["rgb", "RGB"], ["hex", "Hex"]];
const colourOf = (target, m = ui.member) => (target === "tint" ? m.scene.tint ?? m.figure.color : m.figure.color);
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
<span class="coat-chip" style="background:${rgbToHex([r, g, b])}" title="The coat"></span>
${fields}${target === "coat" ? `${slider("spot", "Accent", 359, c.spot)}
<button type="button" class="tile shiny" role="switch" aria-checked="${Boolean(ui.member.figure.shiny)}" data-run="shiny" title="The legendary gold coat">
<span class="thumb">${avatarHtml({ ...ui.member.figure, shiny: true })}</span><span class="tile-label">Shiny</span><i class="tick">${icon("check", 14)}</i></button>`
  : `<button type="button" class="act own-colour" data-run="untint" ${ui.member.scene.tint ? "" : "disabled"}>Use its own colour</button>`}</div>`;
}

/** The editor's fields from the member, without drawing them again (a slider being dragged keeps its grip). */
function syncColour(box) {
  const c = { spot: 0, ...colourOf(box.dataset.target) };
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
  const shiny = box.querySelector("[data-run=shiny]");
  if (shiny) shiny.setAttribute("aria-checked", String(Boolean(ui.member.figure.shiny)));
  const own = box.querySelector("[data-run=untint]");
  if (own) own.disabled = !ui.member.scene.tint;
}

/** One edit from the editor: the first of a drag is one undo step; the preview follows every move. */
function colourInput(input, committed) {
  const key = input.dataset.col;
  const target = input.closest("[data-target]").dataset.target;
  const c = { spot: ui.member.figure.color.spot, ...colourOf(target) };
  let next;
  if (["hue", "sat", "light", "spot"].includes(key)) next = { ...c, [key]: Number(input.value) };
  else if (["r", "g", "b"].includes(key)) { const rgb = hslToRgb(c); rgb["rgb".indexOf(key)] = Number(input.value); next = { ...c, ...rgbToHsl(rgb) }; }
  else { const rgb = hexToRgb(input.value); if (!rgb) { if (committed) syncColour(input.closest("[data-tiles]")); return; } next = { ...c, ...rgbToHsl(rgb) }; }
  if (!ui.colourBase) { ui.colourBase = ui.member; ui.history.push(ui.member); ui.future = []; }
  ui.member = crewMember(key === "spot" ? { ...ui.member, figure: { ...ui.member.figure, color: next } } : withColour(target, ui.member, next));
  if (committed) { ui.colourBase = null; draw({ keepTiles: true }); return; }
  syncColour(input.closest("[data-tiles]"));
  previewOnly();
}
/** The stage and the small views, while a slider moves. */
function previewOnly() {
  const stage = document.querySelector(ui.layout === "tabs" ? "#preview" : "#alt-stage");
  if (stage) stageInto(stage, { over: ui.layout === "loadout" ? hotspotsHtml() : "" });
  if (ui.layout === "tabs") drawSmallPreviews();
  syncActions();
}

// ---------- layout 1: tabs ----------

function drawTabsLayout(keepTiles) {
  $("tabs").innerHTML = GROUPS.map((g, i) => `<button type="button" role="tab" id="tab-${g.id}" aria-selected="${i === ui.tab}" tabindex="${i === ui.tab ? 0 : -1}" data-tab="${i}" title="${g.label} (${i + 1})">
${icon(g.icon, 20)}<span>${g.label}</span></button>`).join("");
  const list = tabSections(group());
  $("sections").hidden = list.length < 2;
  $("sections").innerHTML = list.map((s, i) => `<button type="button" role="tab" aria-selected="${i === ui.section[group().id]}" tabindex="${i === ui.section[group().id] ? 0 : -1}" data-section="${i}">${s.label}</button>`).join("");
  $("section-note").textContent = section().note ?? "";
  $("section-tools").innerHTML = (section().kind === "colour" ? "" : diceButton(section())) + (group().id === "species" ? diceButton(S.species) : "")
    + (section().kind === "colour" ? diceButton(section(), { label: section().target === "tint" ? "Random backdrop colour" : "Random coat" }) : "");
  const grid = $("grid");
  if (keepTiles && grid.dataset.tiles === section().id) refreshTiles(grid, section()); else tilesInto(grid, section());
  stageInto($("preview"));
  moodsInto($("preview-moods"));
  drawSmallPreviews();
}
function drawSmallPreviews() {
  const m = ui.member;
  $("preview-row").innerHTML = avatarHtml(m.figure, { size: "sidebar", mood: ui.previewMood === "speaking" ? "speaking" : "idle" });
  $("preview-rail").innerHTML = avatarHtml(m.figure, { size: "sidebar" });
  for (const el of document.querySelectorAll(".pv-name")) el.textContent = m.name;
  $("traits").textContent = describe(m);
}
function setTab(i) { ui.tab = (i + GROUPS.length) % GROUPS.length; draw(); $(`tab-${group().id}`).focus(); }
function setSection(i) { const n = tabSections(group()).length; ui.section[group().id] = (i + n) % n; draw(); focusTiles($("grid")); }

// ---------- the slots' current values (overview rows and loadout cards) ----------

/** What a slot holds now: its label, and a picture of it. */
function slotNow(s, m, figureHtml) {
  const picked = s.kind === "colour" ? [] : s.choices(m).filter((c) => c.selected);
  const label = s.kind === "colour" ? (s.target === "tint" && !m.scene.tint ? "Its own colour" : coatHex(colourOf(s.target, m))) : picked.map((c) => c.label).join(" + ") || (s.kind === "check" ? "None" : s.id.startsWith("species") ? "Custom" : s.id === "swatch" ? (m.figure.shiny ? "Shiny" : coatHex(m.figure.color)) : "—");
  let pic;
  if (s.region === "coat") pic = `<span class="dot" style="background:${m.figure.shiny ? "linear-gradient(135deg,#f6d36b,#c99a2e)" : coatHex(m.figure.color)}"></span>`;
  else if (s.region === "backdrop") pic = `<span class="crop scene-crop">${ownIds(sceneBackdropSvg(m.scene, m.figure.color))}</span>`;
  else if (s.region === "tint") pic = `<span class="dot" style="background:${coatHex(m.scene.tint ?? m.figure.color)}"></span>`;
  else if (s.region === "desk") pic = `<span class="dot" style="background:linear-gradient(${DESK_TOPS[m.scene.desk.top]?.[1]},${DESK_TOPS[m.scene.desk.top]?.[4]})"></span>`;
  else if (s.region === "props") pic = `<span class="crop prop-crop">${m.scene.desk.props[0] ? `<svg viewBox="-40 -80 80 86" aria-hidden="true">${ownIds(DESK_PROPS[m.scene.desk.props[0]][1])}</svg>` : ""}</span>`;
  else if (s.region === "work" || s.region === "idle") pic = `<span class="dot glyph">${icon("zap", 16)}</span>`;
  else pic = crop(figureHtml, s.region === "species" || s.region === "body" ? "" : s.region, m.figure);
  return { label, pic };
}
const ROW_IDS = GROUPS.flatMap((g) => g.rows);

// ---------- layout 2: overview (every slot a row; one row opens its strip of tiles) ----------

function drawOverview(keepTiles) {
  const m = ui.member;
  const alt = $("alt");
  const strip = alt.querySelector(".strip[data-tiles]");
  if (keepTiles && strip && strip.dataset.tiles === ui.active && alt.dataset.layout === "overview") {
    refreshTiles(strip, S[ui.active]);
    fillRows(alt, m);
    stageInto($("alt-stage"));
    return;
  }
  alt.dataset.layout = "overview";
  alt.innerHTML = `<section class="ov-preview" aria-label="Preview"><div id="alt-stage" class="preview-stage"></div><div class="seg" id="alt-moods" role="radiogroup" aria-label="Preview as"></div>
<p class="traits">${describe(m)}</p><p class="ov-help"><kbd>↑</kbd><kbd>↓</kbd> slot · <kbd>←</kbd><kbd>→</kbd> cycle · <kbd>Enter</kbd> all options · <kbd>Q</kbd><kbd>E</kbd> group</p></section>
<section class="ov-list" aria-label="Every slot">${GROUPS.map((g) => `<div class="ov-group"><h3 data-group="${g.id}">${icon(g.icon, 15)}${g.label}</h3>
${g.rows.map((id) => `<div class="ov-row${ui.active === id ? " open" : ""}" data-row="${id}"><div class="slot" tabindex="-1" data-slot="${id}" role="group" aria-label="${S[id].label}"></div>
${ui.active === id ? `<div class="strip" data-tiles></div>${S[id].note ? `<p class="strip-note">${S[id].note}</p>` : ""}` : ""}</div>`).join("")}</div>`).join("")}</section>`;
  fillRows(alt, m);
  if (ui.active) { const box = alt.querySelector(".strip"); tilesInto(box, S[ui.active]); }
  stageInto($("alt-stage"));
  moodsInto($("alt-moods"));
  rove(alt);
}

/** Each row's (or card's) face: its picture, its name, its value and its arrows. */
function fillRows(root, m) {
  const figureHtml = avatarHtml(m.figure);
  for (const el of root.querySelectorAll(".slot[data-slot]")) {
    const s = S[el.dataset.slot];
    const now = slotNow(s, m, figureHtml);
    const arrows = s.kind === "radio";
    el.innerHTML = `<span class="slot-pic">${now.pic}</span><span class="slot-text"><small>${s.label}</small><b>${now.label}</b></span>
${arrows ? `<span class="cyc"><button type="button" tabindex="-1" data-cycle="-1" aria-label="Previous ${s.label}">‹</button><button type="button" tabindex="-1" data-cycle="1" aria-label="Next ${s.label}">›</button></span>` : ""}
${diceButton(s, { small: true })}<span class="more" aria-hidden="true">${ui.active === s.id ? "▴" : "▾"}</span>`;
    el.setAttribute("aria-expanded", String(ui.active === s.id));
    el.classList.toggle("active", ui.active === s.id);
  }
  const traits = root.querySelector(".traits");
  if (traits) traits.textContent = describe(m);
}
function rove(root) {
  const slots = [...root.querySelectorAll(".slot[data-slot]")];
  const at = slots.find((s) => s.dataset.slot === ui.active) ?? slots[0];
  for (const s of slots) s.tabIndex = s === at ? 0 : -1;
}

function openSlot(id, { focus = true } = {}) {
  ui.active = ui.active === id && ui.layout === "overview" ? null : id;
  draw();
  const box = document.querySelector("#alt [data-tiles]");
  if (focus && ui.active && box) focusTiles(box);
  else document.querySelector(`.slot[data-slot="${id}"]`)?.focus();
}

// ---------- layout 3: loadout (an equipment screen: cards around the creature, its parts clickable) ----------

const LOADOUT = {
  left: ["top", "headgear", "earwear", "eyewear", "eyes", "mouth", "nose", "cheeks", "marks"],
  right: ["species", "body", "arms", "legs", "tail", "back", "neckwear", "held", "pattern", "pins"],
  bottom: ["swatch", "backdrop", "desk", "props", "work", "idle"],
};
{
  const placed = new Set(Object.values(LOADOUT).flat());
  for (const s of SLOTS) if (!placed.has(s.id)) LOADOUT.right.push(s.id);
}
/** The parts of the creature a click opens, where they sit on it. */
const HOTSPOTS = ["top", "headgear", "eyes", "mouth", "neckwear", "arms", "held", "legs", "tail", "pattern"];
function hotspotsHtml() {
  const fig = ui.member.figure;
  const spots = HOTSPOTS.map((slot) => {
    let [x, y] = regionOf(slot, fig);
    const half = BODIES.find((b) => b.id === fig.body)?.frame.half ?? 31;
    if (slot === "headgear") x += 16;
    if (slot === "arms") x = 60 - half - 2;
    if (slot === "pattern") y = (regionOf("arms", fig)[1] + regionOf("legs", fig)[1]) / 2;
    return `<button type="button" class="hotspot${ui.active === slot ? " on" : ""}" tabindex="-1" data-hot="${slot}" style="left:${(x / 120) * 100}%;top:${(y / 120) * 100}%"
aria-label="Edit ${S[slot].label}"><span>${S[slot].label}</span></button>`;
  }).join("");
  return `<div class="hotspots">${spots}</div>`;
}

function drawLoadout(keepTiles) {
  const m = ui.member;
  const alt = $("alt");
  const picker = alt.querySelector(".picker [data-tiles]");
  if (keepTiles && picker && picker.dataset.tiles === ui.active && alt.dataset.layout === "loadout") {
    refreshTiles(picker, S[ui.active]);
    fillRows(alt, m);
    stageInto($("alt-stage"), { over: hotspotsHtml() });
    return;
  }
  alt.dataset.layout = "loadout";
  const cards = (ids) => ids.map((id) => `<div class="slot card" tabindex="-1" data-slot="${id}" role="group" aria-label="${S[id].label}"></div>`).join("");
  const s = ui.active && S[ui.active];
  alt.innerHTML = `<section class="lo-col lo-left" aria-label="Head and face">${cards(LOADOUT.left)}</section>
<section class="lo-centre"><div class="lo-stage-wrap"><div id="alt-stage" class="preview-stage"></div><div class="seg lo-moods" id="alt-moods" role="radiogroup" aria-label="Preview as"></div>
<p class="lo-hint">Click a part of the creature, or a card. <kbd>↑</kbd><kbd>↓</kbd> card · <kbd>←</kbd><kbd>→</kbd> cycle · <kbd>Enter</kbd> all options</p></div>
${s ? `<div class="picker"><header><b>${S[ui.active].label}</b><small>${s.note ?? ""}</small>${diceButton(s)}${ui.active === "species" ? "" : ""}<button type="button" class="act icon-only" data-close-picker aria-label="Close the options">${icon("close", 16)}</button></header><div class="strip" data-tiles></div></div>` : ""}</section>
<section class="lo-col lo-right" aria-label="Body and gear">${cards(LOADOUT.right)}</section>
<section class="lo-bottom" aria-label="Colour, scene and moves">${cards(LOADOUT.bottom)}</section>`;
  fillRows(alt, m);
  if (s) tilesInto(alt.querySelector(".picker [data-tiles]"), s);
  stageInto($("alt-stage"), { over: hotspotsHtml() });
  moodsInto($("alt-moods"));
  rove(alt);
}

// ---------- keyboard: grids of tiles ----------

/** Arrow keys over tiles: a 2-D roving focus (a strip is one row); in a radio box the selection follows. */
function tileKeys(event, box) {
  const tiles = [...box.querySelectorAll(".tile:not(.shiny)")];
  const i = tiles.indexOf(document.activeElement);
  if (i < 0) return false;
  const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + cols, ArrowUp: i - cols, Home: 0, End: tiles.length - 1 }[event.key];
  if (to === undefined) return false;
  // Leaving a strip upwards (or out of a one-row strip) goes back to its slot.
  if (ui.layout !== "tabs" && (to < 0 || (event.key === "ArrowDown" && to >= tiles.length))) return false;
  event.preventDefault();
  const next = tiles[Math.min(tiles.length - 1, Math.max(0, to))];
  for (const t of tiles) t.tabIndex = t === next ? 0 : -1;
  next.focus();
  next.scrollIntoView({ block: "nearest", inline: "nearest" });
  const s = S[box.dataset.tiles];
  if (s.kind === "radio" && !next.classList.contains("dice")) pickIn(s, next.dataset.key);
  return true;
}

function slotKeys(event, el) {
  const slots = [...document.querySelectorAll("#alt .slot[data-slot]")];
  const i = slots.indexOf(el);
  const s = S[el.dataset.slot];
  const move = (to) => { const next = slots[(to + slots.length) % slots.length]; for (const x of slots) x.tabIndex = x === next ? 0 : -1; next.focus(); next.scrollIntoView({ block: "nearest" }); };
  switch (event.key) {
    case "ArrowDown": move(i + 1); break;
    case "ArrowUp": move(i - 1); break;
    case "ArrowRight": cycle(s, 1); break;
    case "ArrowLeft": cycle(s, -1); break;
    case "Enter": case " ": openSlot(s.id); break;
    case "Home": move(0); break;
    case "End": move(slots.length - 1); break;
    default: return false;
  }
  event.preventDefault();
  return true;
}

/** Q / E in the overview and the loadout: the first slot of the previous or next group. */
function jumpGroup(step) {
  const slots = [...document.querySelectorAll("#alt .slot[data-slot]")];
  const here = document.activeElement?.closest(".slot, [data-tiles]");
  const id = here?.dataset.slot ?? here?.dataset.tiles ?? slots[0]?.dataset.slot;
  const g = GROUPS.findIndex((x) => x.rows.includes(id));
  for (let k = 1; k <= GROUPS.length; k += 1) {
    const next = GROUPS[(g + step * k + GROUPS.length * k) % GROUPS.length];
    const el = slots.find((x) => next.rows.includes(x.dataset.slot));
    if (el) { for (const x of slots) x.tabIndex = x === el ? 0 : -1; el.focus(); el.scrollIntoView({ block: "nearest" }); return; }
  }
}

// ---------- actions ----------

/** Re-rolls one section and nothing else: one body, one coat, a few patterns, any species… */
function randomIn(s) {
  if (!s) return;
  const m = ui.member;
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  let next;
  if (s.random) next = s.random(m);
  else if (s.kind === "colour") {
    const c = { hue: Math.round(Math.random() * 360), sat: Math.round(30 + Math.random() * 55), light: Math.round(40 + Math.random() * 30) };
    next = withColour(s.target, m, { ...m.figure.color, ...c });
  } else if (s.id === "props") {
    const pool = Object.keys(DESK_PROPS).sort(() => Math.random() - 0.5);
    next = { ...m, scene: { ...m.scene, desk: { ...m.scene.desk, props: pool.slice(0, 2 + Math.round(Math.random())) } } };
  } else if (s.kind === "check") {
    const slot = s.id, max = SLOTS.find((x) => x.id === slot)?.max ?? 2;
    let figure = withPart(m.figure, slot, null);
    for (const p of partsIn(slot).sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * (max + 1)))) figure = withPart(figure, slot, p.id);
    next = { ...m, figure };
  } else {
    const options = s.options(m).filter((o) => !o.selected && !o.dice);
    if (!options.length) return;
    next = any(options).apply(m);
  }
  if (s.mood) ui.previewMood = s.mood;
  change(next);
}
/** The section the focus is in (or the open one): what Shift+R re-rolls. */
const focusedSection = () => (ui.layout === "tabs" ? section()
  : S[document.activeElement?.closest(".slot")?.dataset.slot ?? document.activeElement?.closest("[data-tiles]")?.dataset.tiles ?? ui.active]);
const diceButton = (s, { label = s.dice ?? `Randomise ${s.label.toLowerCase()}`, small = false } = {}) =>
  `<button type="button" class="${small ? "dice-mini" : "act dice-btn"}" data-dice="${s.id}" ${small ? 'tabindex="-1"' : ""} title="${label} (only this; Shift+R)" aria-label="${label}">${icon("dice", small ? 14 : 15)}${small ? "" : `<span>${label}</span>`}</button>`;

const randomSeed = () => `crew-${Math.random().toString(36).slice(2, 8)}`;
const randomise = () => change({ ...memberFromSeed(randomSeed()), name: ui.member.name });

function save() {
  saved = ui.member;
  localStorage.setItem(STORE, JSON.stringify(saved));
  $("customiser").close("save");
  drawCanvas();
}

const RUN = {
  undo, redo,
  reset: () => change(ui.opened),
  random: randomise,
  close: () => $("customiser").close(),
  save,
  untint: () => change({ ...ui.member, scene: { ...ui.member.scene, tint: null } }, { keepTiles: true }),
  shiny: () => change({ ...ui.member, figure: { ...ui.member.figure, shiny: !ui.member.figure.shiny } }, { keepTiles: true }),
  copy: async () => { await navigator.clipboard?.writeText(memberJson(ui.member)).catch(() => {}); },
};

function bind() {
  fillIcons(document);
  $("source").textContent = SOURCE;
  $("open").innerHTML = PALETTE;
  $("open").onclick = open;
  const dialog = $("customiser");
  dialog.addEventListener("click", (event) => {
    const t = event.target;
    const run = t.closest("[data-run]");
    if (run) { event.preventDefault(); RUN[run.dataset.run](); return; }
    const dice = t.closest("[data-dice]");
    if (dice) { const id = dice.dataset.dice; randomIn(S[id]); return document.querySelector(`.slot[data-slot="${id}"]`)?.focus(); }
    const layout = t.closest("[data-set-layout]");
    if (layout) return setLayout(layout.dataset.setLayout);
    const mode = t.closest("[data-colmode]");
    if (mode) { ui.colourMode = mode.dataset.colmode; draw(); return dialog.querySelector(`[data-colmode="${ui.colourMode}"]`)?.focus(); }
    const tab = t.closest("[data-tab]");
    if (tab) return setTab(Number(tab.dataset.tab));
    const sec = t.closest("[data-section]");
    if (sec) return setSection(Number(sec.dataset.section));
    const tile = t.closest("[data-tiles] .tile[data-key]");
    if (tile) return pickIn(S[tile.closest("[data-tiles]").dataset.tiles], tile.dataset.key);
    const cyc = t.closest("[data-cycle]");
    if (cyc) { const slot = cyc.closest(".slot").dataset.slot; cycle(S[slot], Number(cyc.dataset.cycle)); return document.querySelector(`.slot[data-slot="${slot}"]`)?.focus(); }
    const hot = t.closest("[data-hot]");
    if (hot) return openSlot(hot.dataset.hot);
    if (t.closest("[data-close-picker]")) { const id = ui.active; ui.active = null; draw(); return document.querySelector(`.slot[data-slot="${id}"]`)?.focus(); }
    const slot = t.closest(".slot[data-slot]");
    if (slot) return openSlot(slot.dataset.slot);
  });
  dialog.addEventListener("input", (event) => { if (event.target.matches("[data-col]") && event.target.dataset.col !== "hex") colourInput(event.target, false); });
  dialog.addEventListener("change", (event) => { if (event.target.matches("[data-col]")) colourInput(event.target, true); });
  $("name").addEventListener("input", (e) => { ui.member = { ...ui.member, name: e.target.value || ui.member.seed }; syncActions(); if (ui.layout === "tabs") drawSmallPreviews(); });
  // Esc inside a strip or the picker goes back to its slot; only from elsewhere does it close the customiser.
  dialog.addEventListener("cancel", (event) => { if (ui.escapeHandled) { event.preventDefault(); ui.escapeHandled = false; } });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open) return;
    const target = event.target;
    const inText = target.matches("input[type=text]");
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key === "Enter") { event.preventDefault(); return save(); }
    if (!inText && mod && (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) { event.preventDefault(); return redo(); }
    if (!inText && mod && event.key.toLowerCase() === "z") { event.preventDefault(); return undo(); }
    if (event.key === "Escape" && ui.layout !== "tabs") {
      const box = target.closest("#alt [data-tiles]");
      if (box || (ui.layout === "loadout" && ui.active)) {
        event.preventDefault(); ui.escapeHandled = true;
        const id = ui.active; ui.active = null; draw();
        return document.querySelector(`.slot[data-slot="${id}"]`)?.focus();
      }
    }
    if (inText || mod || event.altKey) return;
    if (target.closest("#tabs") && rovingTabs(event, GROUPS, ui.tab, setTab)) return;
    if (target.closest("#sections") && rovingTabs(event, tabSections(group()), ui.section[group().id], setSection)) return;
    if (target.closest("#layouts") && rovingTabs(event, LAYOUTS, LAYOUTS.findIndex(([l]) => l === ui.layout), (i) => { setLayout(LAYOUTS[(i + 3) % 3][0]); $("layouts").querySelector('[aria-checked="true"]')?.focus(); })) return;
    const box = target.closest("[data-tiles]");
    if (box && box.dataset.kind !== "colour" && tileKeys(event, box)) return;
    if (box && ui.layout !== "tabs" && (event.key === "ArrowUp" || event.key === "ArrowDown") && box.dataset.kind !== "colour") {
      event.preventDefault();
      return document.querySelector(`.slot[data-slot="${box.dataset.tiles}"]`)?.focus();
    }
    if (target.matches(".slot[data-slot]") && slotKeys(event, target)) return;
    if (target.matches("input[type=range]")) return;
    const key = event.key;
    if (key === "l" || key === "L") return setLayout(LAYOUTS[(LAYOUTS.findIndex(([l]) => l === ui.layout) + 1) % LAYOUTS.length][0]);
    if (ui.layout === "tabs") {
      if (key === "q" || key === "Q") return setTab(ui.tab - 1);
      if (key === "e" || key === "E") return setTab(ui.tab + 1);
      if (key === "[") return setSection(ui.section[group().id] - 1);
      if (key === "]") return setSection(ui.section[group().id] + 1);
      if (/^[1-9]$/.test(key) && Number(key) <= GROUPS.length) return setTab(Number(key) - 1);
    } else {
      if (key === "q" || key === "Q") return jumpGroup(-1);
      if (key === "e" || key === "E") return jumpGroup(1);
    }
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
  // ?layout=tabs|overview|loadout; ?open[&tab=<group>][&section=<id>][&slot=<id>][&mood=…][&colour=hsl|rgb|hex] opens it there.
  const query = new URLSearchParams(location.search);
  ui.layout = LAYOUTS.some(([l]) => l === query.get("layout")) ? query.get("layout") : "tabs";
  if (query.get("colour")) ui.colourMode = query.get("colour");
  if (query.has("open")) {
    ui.tab = Math.max(0, GROUPS.findIndex((g) => g.id === query.get("tab")));
    const at = tabSections(group()).findIndex((s) => s.id === query.get("section"));
    if (at >= 0) ui.section[group().id] = at;
    if (query.get("slot") && S[query.get("slot")]) ui.active = query.get("slot");
    if (query.get("mood")) ui.previewMood = query.get("mood");
    open();
  }
}

function rovingTabs(event, list, current, set) {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -current, End: list.length - 1 - current }[event.key];
  if (step === undefined) return false;
  event.preventDefault();
  set(current + step);
  return true;
}

bind();

// ---------- live reload: a saved edit to this page's files reloads it ----------

const WATCHED = ["/customiser.html", "/customiser.mjs", "/customiser.css", "/customiser/crew.mjs", "/customiser/colour.mjs"];
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
