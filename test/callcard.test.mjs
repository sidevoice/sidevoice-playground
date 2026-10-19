import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CORNERS, FAMILIES, FORMATS, STATES, cardSettings } from "../web/callcard/formats.mjs";

test("every call-card format has a family, the three sizes, and a picture's height where it is one", () => {
  for (const format of FORMATS) {
    assert.ok(FAMILIES[format.family], format.id);
    for (const size of ["s", "m", "l"]) {
      assert.ok(format.sizes[size].w > 0, `${format.id} ${size}`);
      if (format.family === "pip") assert.ok(format.sizes[size].h > 0, `${format.id} ${size} height`);
    }
  }
  assert.deepEqual(new Set(FORMATS.map((format) => format.family)), new Set(Object.keys(FAMILIES)));
});

test("a card setting is filled from its format's defaults, and unknown values fall back", () => {
  assert.deepEqual(cardSettings({ format: "pip" }), { format: "pip", size: "m", corner: "br", controls: "hover" });
  assert.deepEqual(cardSettings({ format: "nope", size: "xl", corner: "middle", controls: "always" }),
    { format: "card", size: "m", corner: "br", controls: "always" });
  assert.equal(Object.keys(CORNERS).length, 4);
  for (const state of ["listening", "speaking", "working", "muted"]) assert.ok(STATES[state], state);
});

test("the creatures are drawn at both sizes, with their scene", async () => {
  const { source, creatures } = JSON.parse(await readFile(new URL("../web/callcard/creatures.json", import.meta.url), "utf8"));
  assert.match(source, /^sidevoice-web@[0-9a-f]{40}$/);
  for (const creature of creatures) {
    for (const key of ["stage", "small", "backdrop", "desk"]) assert.match(creature[key], /^<svg/, `${creature.id} ${key}`);
  }
});
