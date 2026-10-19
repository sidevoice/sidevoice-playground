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

test("every part, body and creature has an English name, and every creature a kind", async () => {
  const E = await import("../web/customiser/bichos.mjs");
  const N = await import("../web/customiser/names.mjs");
  for (const slot of E.SLOTS) {
    assert.ok(N.SLOTS[slot.id], `slot ${slot.id}`);
    for (const part of E.partsIn(slot.id)) {
      assert.ok(N.PARTS[slot.id]?.[part.id], `${slot.id}:${part.id}`);
      assert.ok(N.THEMES[part.file], `theme ${part.file}`);
    }
  }
  for (const body of E.BODIES) assert.ok(N.BODIES[body.id], `body ${body.id}`);
  for (const m of E.MEMBERS) assert.ok(N.kindOf(`${m.family}/${m.id}`), `member ${m.family}/${m.id}`);
});

test("an import says what is wrong, and reads a good crew member", async () => {
  const { parseMember } = await import("../web/customiser/crew.mjs");
  assert.match(parseMember("{x").error, /isn't JSON/);
  assert.match(parseMember("[]").error, /isn't a crew member/);
  assert.match(parseMember('{"v":2,"figure":{"body":"round"}}').error, /version 2/);
  assert.match(parseMember('{"figure":{"body":"cube"}}').error, /Unknown body "cube"/);
  assert.equal(parseMember('{"name":"A","figure":{"body":"round"}}').member.name, "A");
});
