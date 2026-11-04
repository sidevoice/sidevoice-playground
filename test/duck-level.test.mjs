// The duck-level design sheet: its options are the ones decided on, the level row exists only for Lower, and the page
// is served beside the shell with the VARIANTS panel's choice as its input.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DUCK_LEVEL_PATH, MOCK_FILE, mockFile } from "../preview/proxy.mjs";
import { VARIANTS } from "../preview/mock/shell.mjs";
import { DEFAULT_LEVEL, MODES, OPTIONS, OPTION_IDS, TODAY, percent, rowFor, stepOf } from "../preview/mock/duck-level-data.mjs";

const variant = VARIANTS.find((each) => each.name === "duckLevel");

test("the panel's duckLevel choice offers exactly the sheet's options, in order, with the sheet to look at", () => {
  assert.deepEqual(variant.values.map((value) => value.value), OPTION_IDS);
  assert.deepEqual(variant.values.map((value) => value.label[0]), ["A", "B", "C"]);
  assert.equal(variant.sheet, DUCK_LEVEL_PATH);
  assert.match(variant.values[2].label, /Windows/, "C is labelled as the Windows-style option");
});

test("A: three presets at 50 / 25 / 0 %, the default being Mucho", () => {
  const a = OPTIONS.presets;
  assert.deepEqual(a.steps.map((step) => [step.label, step.level]), [["Un poco", 50], ["Mucho", 25], ["Silenciar", 0]]);
  assert.equal(a.steps[stepOf(a, a.start)].label, "Mucho");
  assert.equal(a.start, DEFAULT_LEVEL);
  assert.match(a.hint, /50 %[^]*25 %/, "the row says which percentages the presets are");
});

test("B: a slider from 0 to 100 % that starts at the decided 25 %", () => {
  const b = OPTIONS.slider;
  assert.deepEqual([b.range.min, b.range.max], [0, 100]);
  assert.equal(b.start, DEFAULT_LEVEL);
  assert.ok((b.start - b.range.min) % b.range.step === 0, "the default is on a step");
  assert.equal(b.steps, undefined);
});

test("C: Windows' four as reductions; the decided 25 % is not one of its stops", () => {
  const c = OPTIONS.windows;
  assert.deepEqual(c.steps.map((step) => step.label), ["Silenciar", percent(80), percent(50), "Nada"]);
  assert.deepEqual(c.steps.map((step) => step.level), [0, 20, 50, 100], "an 80 % reduction leaves 20 %");
  assert.equal(stepOf(c, DEFAULT_LEVEL), -1);
  assert.equal(c.steps[stepOf(c, c.start)].label, percent(80), "it starts at the nearest one, Windows' own default");
});

test("only Lower has a level row; Pause on macOS says only Music and Spotify can be paused", () => {
  for (const id of OPTION_IDS) {
    const lower = rowFor(id, "lower");
    assert.equal(lower.level.label, OPTIONS[id].label);
    assert.equal(lower.level.level, OPTIONS[id].start);
    assert.equal(lower.hint, TODAY.hint);
    assert.equal(rowFor(id, "pause").level, null);
    assert.equal(rowFor(id, "off").level, null);
    assert.equal(rowFor(id, "pause").hint, TODAY.hintPauseMac);
    assert.equal(rowFor(id, "off").hint, TODAY.hint);
  }
  assert.match(TODAY.hintPauseMac, /Música y Spotify/);
  assert.deepEqual(MODES.map((mode) => mode.value), ["lower", "pause", "off"], "Lower first: it is the default mode");
});

test("the sheet is served beside the shell, with every file it loads", async () => {
  const page = await mockFile(DUCK_LEVEL_PATH);
  assert.equal(page.type, "text/html; charset=utf-8");
  const html = String(page.body);
  const loaded = [...html.matchAll(/(?:href|src)="\/preview-mock\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(loaded.sort(), ["duck-level-web.css", "duck-level.css", "duck-level.mjs"]);
  for (const name of [...loaded, "duck-level-data.mjs"]) {
    assert.match(name, MOCK_FILE, `${name} is a file the shell may load`);
    assert.ok(await mockFile(`/preview-mock/${name}`), `${name} is served`);
  }
  assert.equal(await mockFile("/preview-mock/duck-level.html"), null, "the page is its route's, not a file of mock/");
});

test("the sheet's styles are copies of the web's, with the typeface left where a web build serves it", async () => {
  const css = String((await mockFile("/preview-mock/duck-level-web.css")).body);
  assert.match(css, /COPIED from sidevoice-web@[0-9a-f]{40} apps\/web\/src\/components\/ui\/ui\.css by scripts\/duck-level-styles\.mjs/);
  for (const rule of [".ui-row-label", ".ui-segmented--sm", ".voice-speed", '[data-theme="dark"]']) assert.ok(css.includes(rule), rule);
  assert.ok(css.includes('url("/voice/fonts/DMSans-Variable-latin.woff2")'));
});

test("the sheet only reads the panel's choice: it never writes sidevoice.variants", async () => {
  const code = await readFile(new URL("../preview/mock/duck-level.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /setItem|removeItem/);
  assert.match(code, /sidevoice\.variants/);
});
