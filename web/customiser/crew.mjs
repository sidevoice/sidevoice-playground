// A crew member: one creature as the person customised it, as a small data object. The customiser edits nothing
// else, so this is what the app's settings would store as the "crew" configuration (sidevoice-web#145) once that
// integration is done; here it lives in local storage only.
//
//   { v: 1,
//     name:   "Refactor del relay",                  what it is called (a conversation's title, or the person's choice)
//     seed:   "Refactor del relay",                  the roll it started from: what "Randomise" replaces
//     figure: { body, parts, color, shape, name, shiny? },   the bichos engine's own Spec, resolved (bichos/spec.ts)
//     scene:  { backdrop, desk: { top, props } },    PROPOSED: the app rolls these from the seed today, no override
//     moves:  { work, idle } }                       PROPOSED: null = the app's rotation; else the one style it keeps
//
// The figure is stored whole, not as the seed plus overrides: a change to the engine's roller would move a seeded
// default, and it must not move a creature somebody made.
import { BACKDROPS, DESK_PROPS, DESK_TOPS, IDLE_STYLES, WORKS, backdropFromSeed, deskFromSeed, normalizeSpec, specFromSeed } from "./bichos.mjs";

export const CREW_VERSION = 1;
export const MAX_DESK_PROPS = 3;

/** The member a seed rolls: the app's default creature, scene and moves for it. */
export function memberFromSeed(seed, name = seed) {
  return { v: CREW_VERSION, name, seed, figure: specFromSeed(seed), scene: { backdrop: backdropFromSeed(seed), desk: deskFromSeed(seed) },
    moves: { work: null, idle: null } };
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
      backdrop: scene.backdrop in BACKDROPS ? scene.backdrop : base.scene.backdrop,
      desk: {
        top: desk.top in DESK_TOPS ? desk.top : base.scene.desk.top,
        props: Array.isArray(desk.props) ? [...new Set(desk.props.filter((p) => p in DESK_PROPS))].slice(0, MAX_DESK_PROPS) : base.scene.desk.props,
      },
    },
    moves: { work: WORKS.includes(moves.work) ? moves.work : null, idle: IDLE_STYLES.includes(moves.idle) ? moves.idle : null },
  };
}

/** The member as JSON, its fields in the documented order. */
export const memberJson = (member) => JSON.stringify(crewMember(member), null, 2);
