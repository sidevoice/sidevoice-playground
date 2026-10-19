import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COPY, FORMATS, PLACEMENT, SETTING_DEFAULTS, cardSettings, dropAt, firstPlace, fit, opensDown } from "../web/callcard/formats.mjs";

test("the three formats kept, each at medium and large, a picture with its height", () => {
  assert.deepEqual(FORMATS.map((format) => format.id), ["card", "pip", "mascot"]);
  for (const format of FORMATS) {
    for (const size of ["m", "l"]) {
      assert.ok(format.sizes[size].w > 0, `${format.id} ${size}`);
      if (format.id === "pip") assert.ok(format.sizes[size].h > 0, `${format.id} ${size} height`);
    }
  }
});

test("settings are filled from the defaults, and unknown values fall back", () => {
  assert.deepEqual(cardSettings(), SETTING_DEFAULTS);
  assert.deepEqual(cardSettings({ format: "pip-tall", size: "s", captionPlace: "above", place: { x: "a", y: 1 } }), SETTING_DEFAULTS);
  assert.deepEqual(cardSettings({ format: "mascot", size: "m", captions: false, place: { x: 10, y: 20 } }).place, { x: 10, y: 20 });
});

test("the card goes where it was dropped, kept inside, against an edge near one, as the desktop app places it", () => {
  const work = { width: 1000, height: 800 }, size = { width: 300, height: 100 };
  assert.deepEqual(firstPlace(work, size), { x: 700, y: 0 });
  assert.deepEqual(dropAt({ x: 400, y: 300 }, size, work), { x: 400, y: 300 });
  assert.deepEqual(dropAt({ x: PLACEMENT.magnet - 1, y: 1000 }, size, work), { x: 0, y: 700 });
  assert.deepEqual(fit({ x: 400, y: 650 }, { width: 300, height: 200 }, work), { x: 400, y: 600 });
});

test("every setting's words are there in English and Spanish", () => {
  for (const [key, words] of Object.entries(COPY)) assert.ok(words.en && words.es, key);
});

test("the creatures are drawn at both sizes, with their scene", async () => {
  const { source, creatures } = JSON.parse(await readFile(new URL("../web/callcard/creatures.json", import.meta.url), "utf8"));
  assert.match(source, /^sidevoice-web@[0-9a-f]{40}$/);
  for (const creature of creatures) {
    for (const key of ["stage", "small", "backdrop", "desk"]) assert.match(creature[key], /^<svg/, `${creature.id} ${key}`);
  }
});

test("captions open below a card in the upper half of the screen, above it in the lower half", () => {
  const work = { width: 1000, height: 800 }, size = { width: 160, height: 160 };
  assert.equal(opensDown({ x: 840, y: 0 }, size, work), true);
  assert.equal(opensDown({ x: 0, y: 640 }, size, work), false);
});
