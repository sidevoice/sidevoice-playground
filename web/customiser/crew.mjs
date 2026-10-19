// A crew member: one creature as the person customised it, as a small data object. The customiser edits nothing
// else, so this is what the app's settings would store as the "crew" configuration (sidevoice-web#145) once that
// integration is done; here it lives in local storage only.
//
//   { v: 1,
//     name:   "Refactor del relay",                  what it is called (a conversation's title, or the person's choice)
//     seed:   "Refactor del relay",                  the roll it started from: what "Randomise" replaces
//     figure: { body, parts, color, shape, name, shiny? },   the bichos engine's own Spec, resolved (bichos/spec.ts)
//     scene:  { backdrop, tint, desk: { top, props } },   its own stage: a backdrop (the engine's, or a colour one in
//                                                          backdrops.mjs), the colour those take (null: its coat), the desk
//     moves:  { works, idles } }                     the styles it takes turns between while working and while idle;
//                                                      null: every one it can do (the app's rotation today)
//
// The figure is stored whole, not as the seed plus overrides: a change to the engine's roller would move a seeded
// default, and it must not move a creature somebody made.
import {
  BACKDROPS, DESK_PROPS, DESK_TOPS, IDLE_STYLES, MEMBERS, SLOTS, WORKS, backdropFromSeed, deskFromSeed, idsIn, memberSpec, normalizeSpec,
  BODIES, specFromSeed, withBody, withPart,
} from "./bichos.mjs";
import { COLOUR_BACKDROPS } from "./backdrops.mjs";

export const CREW_VERSION = 1;
export const MAX_DESK_PROPS = 3;
const BODY_IDS = () => BODIES.map((b) => b.id);

/** The member a seed rolls: the app's default creature, scene and moves for it. */
export function memberFromSeed(seed, name = seed) {
  return { v: CREW_VERSION, name, seed, figure: specFromSeed(seed), scene: { backdrop: backdropFromSeed(seed), tint: null, desk: deskFromSeed(seed) },
    moves: { works: null, idles: null } };
}

/** Any input made a valid member: unknown or missing fields fall back to what its seed rolls, the figure is resolved
 *  by the engine (a part that cannot be worn is dropped, a required one filled). */
export function crewMember(input) {
  const raw = input && typeof input === "object" ? input : {};
  const seed = typeof raw.seed === "string" && raw.seed ? raw.seed : "Sidevoice";
  const base = memberFromSeed(seed, typeof raw.name === "string" && raw.name ? raw.name : seed);
  const scene = raw.scene && typeof raw.scene === "object" ? raw.scene : {};
  const desk = scene.desk && typeof scene.desk === "object" ? scene.desk : {};
  const moves = raw.moves && typeof raw.moves === "object" ? raw.moves : {};
  return {
    ...base,
    figure: raw.figure && typeof raw.figure === "object" ? normalizeSpec(raw.figure) : base.figure,
    scene: {
      backdrop: scene.backdrop in BACKDROPS || scene.backdrop in COLOUR_BACKDROPS ? scene.backdrop : base.scene.backdrop,
      tint: colour(scene.tint),
      desk: {
        top: desk.top in DESK_TOPS ? desk.top : base.scene.desk.top,
        props: Array.isArray(desk.props) ? [...new Set(desk.props.filter((p) => p in DESK_PROPS))].slice(0, MAX_DESK_PROPS) : base.scene.desk.props,
      },
    },
    moves: { works: some(moves.works, WORKS), idles: some(moves.idles, IDLE_STYLES) },
  };
}

const some = (list, known) => { const kept = Array.isArray(list) ? [...new Set(list.filter((x) => known.includes(x)))] : []; return kept.length ? kept : null; };
const colour = (c) => (c && typeof c === "object" && [c.hue, c.sat, c.light].every(Number.isFinite)
  ? { hue: ((c.hue % 360) + 360) % 360, sat: Math.min(100, Math.max(0, c.sat)), light: Math.min(100, Math.max(0, c.light)) } : null);

/** The member as JSON, its fields in the documented order. */
export const memberJson = (member) => JSON.stringify(crewMember(member), null, 2);

// ---------- species ----------

/** The parts that make a species what it is: its member's fixed slots (bichos parts files, `fixed`). */
export const speciesSlots = (family, member) => Object.keys(MEMBERS.find((m) => m.family === family && m.id === member)?.fixed ?? {});
/** The species as its member draws it, always the same one (its own id is the seed). */
const species = new Map();
export function speciesFigure(family, member) {
  const key = `${family}/${member}`;
  if (!species.has(key)) species.set(key, memberSpec(family, member, key));
  return species.get(key);
}

/** `figure` turned into another species, once and without rolling: the species' body and its defining parts come in,
 *  every other pick and the colour stay; only a pick that cannot go with them is taken off or refitted (resolved by
 *  the engine). The old species' own parts, where they are still as it had them, go with it: a cat turned robot loses
 *  its whiskers, unless the robot has some. A multi slot (patterns) keeps its picks and adds the species' own. */
export function withSpecies(figure, family, member, old = speciesOf(figure)) {
  const species = speciesFigure(family, member);
  const defining = speciesSlots(family, member);
  const parts = { ...figure.parts };
  if (old) {
    const was = speciesFigure(old.family, old.member);
    for (const slot of speciesSlots(old.family, old.member)) {
      if (defining.includes(slot) || idsIn(figure, slot).join() !== idsIn(was, slot).join()) continue;
      if (idsIn(species, slot).length) parts[slot] = species.parts[slot]; else delete parts[slot];
    }
  }
  for (const slot of defining) if (!SLOTS.find((s) => s.id === slot)?.multi) delete parts[slot];
  let next = withBody(normalizeSpec({ ...figure, parts }), species.body);
  for (const slot of defining) for (const id of idsIn(species, slot)) if (!idsIn(next, slot).includes(id)) next = withPart(next, slot, id);
  return { ...next, name: species.name };
}

/** Whether `figure` is that species: its body and every defining part. */
export function isSpecies(figure, family, member) {
  const species = speciesFigure(family, member);
  return figure.body === species.body && speciesSlots(family, member).every((slot) => idsIn(species, slot).every((id) => idsIn(figure, slot).includes(id)));
}

/** The species `figure` is, if any: the member whose body and defining parts it has (the most specific one). */
export function speciesOf(figure) {
  let best = null;
  for (const m of MEMBERS) {
    if (!isSpecies(figure, m.family, m.id)) continue;
    const n = speciesSlots(m.family, m.id).length;
    if (!best || n > best.n) best = { family: m.family, member: m.id, n };
  }
  return best && { family: best.family, member: best.member };
}

/** What a change did to the slots outside `except` (the ones it meant to change): [{ slot, from, to }]. */
export function sideChanges(before, after, except = []) {
  const out = [];
  for (const s of SLOTS) {
    if (except.includes(s.id)) continue;
    const from = idsIn(before, s.id), to = idsIn(after, s.id);
    if (from.join() !== to.join()) out.push({ slot: s.id, from, to });
  }
  return out;
}

// ---------- import ----------

/** A crew member from pasted or loaded JSON: { member } when it is one, else { error } saying what is wrong, in words.
 *  Strict where a mistake would silently become another creature (the body, the figure's shape); lenient where the
 *  customiser has a sane default (a missing scene or moves, an unknown part, which the engine drops). */
export function parseMember(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { return { error: `That isn't JSON (${e.message.replace(/^JSON\.parse: /, "")}).` }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "That JSON isn't a crew member: expected an object like { \"v\": 1, \"figure\": { … } }." };
  if (raw.v !== undefined && raw.v !== CREW_VERSION) return { error: `This crew member is version ${JSON.stringify(raw.v)}; this customiser reads version ${CREW_VERSION}.` };
  const fig = raw.figure;
  if (!fig || typeof fig !== "object") return { error: "It has no \"figure\": the creature itself is missing." };
  if (typeof fig.body !== "string" || !BODY_IDS().includes(fig.body)) return { error: `Unknown body ${JSON.stringify(fig.body)}. Known: ${BODY_IDS().join(", ")}.` };
  if (fig.parts !== undefined && (typeof fig.parts !== "object" || Array.isArray(fig.parts))) return { error: "\"figure.parts\" must be an object of slot → part." };
  const c = fig.color;
  if (c !== undefined && (typeof c !== "object" || ![c.hue, c.sat, c.light].every((v) => typeof v === "number" && Number.isFinite(v)))) {
    return { error: "\"figure.color\" must have numeric hue, sat and light." };
  }
  if (raw.name !== undefined && typeof raw.name !== "string") return { error: "\"name\" must be text." };
  return { member: crewMember(raw) };
}
