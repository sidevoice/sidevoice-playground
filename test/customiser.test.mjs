import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE, normalizeSpec } from "../web/customiser/bichos.mjs";
import { MAX_DESK_PROPS, crewMember, memberFromSeed } from "../web/customiser/crew.mjs";

test("the customiser's engine is a named sidevoice-web commit", () => {
  assert.match(SOURCE, /^sidevoice-web@[0-9a-f]{40}$/);
});

test("a seed's crew member is the app's default creature, and reads back as itself", () => {
  const member = memberFromSeed("Refactor del relay");
  assert.deepEqual(member.figure, normalizeSpec(member.figure));
  assert.deepEqual(crewMember(JSON.parse(JSON.stringify(member))), member);
  assert.deepEqual(member.moves, { work: null, idle: null });
});

test("a broken crew member falls back field by field to what its seed rolls", () => {
  const base = memberFromSeed("x");
  const member = crewMember({ seed: "x", scene: { backdrop: "nope", desk: { top: "lava", props: ["mug", "mug", "nope", "plant", "duck", "lamp"] } }, moves: { work: "dance", idle: "nap" } });
  assert.equal(member.name, "x");
  assert.deepEqual(member.figure, base.figure);
  assert.equal(member.scene.backdrop, base.scene.backdrop);
  assert.equal(member.scene.desk.top, base.scene.desk.top);
  assert.deepEqual(member.scene.desk.props, ["mug", "plant", "duck"].slice(0, MAX_DESK_PROPS));
  assert.deepEqual(member.moves, { work: null, idle: "nap" });
  assert.equal(crewMember(null).seed, "Sidevoice");
});
