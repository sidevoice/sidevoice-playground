import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE, idsIn, normalizeSpec, withPart } from "../web/customiser/bichos.mjs";
import { MAX_DESK_PROPS, crewMember, isSpecies, memberFromSeed, sideChanges, speciesOf, withSpecies } from "../web/customiser/crew.mjs";
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "../web/customiser/colour.mjs";

test("the customiser's engine is a named sidevoice-web commit", () => {
  assert.match(SOURCE, /^sidevoice-web@[0-9a-f]{40}$/);
});

test("a seed's crew member is the app's default creature, and reads back as itself", () => {
  const member = memberFromSeed("Refactor del relay");
  assert.deepEqual(member.figure, normalizeSpec(member.figure));
  assert.deepEqual(crewMember(JSON.parse(JSON.stringify(member))), member);
  assert.deepEqual(member.moves, { works: null, idles: null });
  assert.equal(member.scene.tint, null);
});

test("a broken crew member falls back field by field to what its seed rolls", () => {
  const base = memberFromSeed("x");
  const member = crewMember({ seed: "x", scene: { backdrop: "nope", tint: { hue: 400, sat: 50, light: 50 }, desk: { top: "lava", props: ["mug", "mug", "nope", "plant", "duck", "lamp"] } },
    moves: { works: ["dance"], idles: ["nap", "nap", "juggle"] } });
  assert.equal(member.name, "x");
  assert.deepEqual(member.figure, base.figure);
  assert.equal(member.scene.backdrop, base.scene.backdrop);
  assert.deepEqual(member.scene.tint, { hue: 40, sat: 50, light: 50 });
  assert.equal(member.scene.desk.top, base.scene.desk.top);
  assert.deepEqual(member.scene.desk.props, ["mug", "plant", "duck"].slice(0, MAX_DESK_PROPS));
  assert.deepEqual(member.moves, { works: null, idles: ["nap", "juggle"] });
  assert.equal(crewMember({ seed: "x", scene: { backdrop: "fade" } }).scene.backdrop, "fade");
  assert.equal(crewMember(null).seed, "Sidevoice");
});

test("changing species keeps the colour and the other picks, and takes the old species' own parts away", () => {
  let figure = withPart(memberFromSeed("Refactor del relay").figure, "headgear", "tophat");
  figure = { ...figure, color: { ...figure.color, hue: 300 } };
  const cat = withSpecies(figure, "furry", "cat");
  assert.ok(isSpecies(cat, "furry", "cat"));
  assert.deepEqual(speciesOf(cat), { family: "furry", member: "cat" });
  assert.equal(cat.color.hue, 300);
  assert.deepEqual(idsIn(cat, "headgear"), ["tophat"]);
  assert.deepEqual(withSpecies(cat, "furry", "cat"), cat, "the same species again changes nothing: no re-roll");
  const robot = withSpecies(cat, "bots", "robot");
  assert.ok(isSpecies(robot, "bots", "robot"));
  assert.deepEqual(idsIn(robot, "marks"), [], "the cat's whiskers went with the cat");
  assert.deepEqual(idsIn(robot, "headgear"), ["tophat"]);
  assert.ok(Array.isArray(sideChanges(cat, robot)));
});

test("the coat converts between HSL, RGB and hex both ways", () => {
  assert.deepEqual(hslToRgb({ hue: 0, sat: 100, light: 50 }), [255, 0, 0]);
  assert.equal(rgbToHex([108, 188, 177]), "#6cbcb1");
  assert.deepEqual(hexToRgb("#fa0"), [255, 170, 0]);
  assert.equal(hexToRgb("nope"), null);
  const back = hslToRgb(rgbToHsl([108, 188, 177]));
  assert.deepEqual(back, [108, 188, 177]);
});
