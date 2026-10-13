import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIANTS } from "../preview/mock/shell.mjs";

// The VARIANTS panel's open questions on a machine's state and on "new" (sidevoice-web feat/onboarding): one entry per
// question, its values as the web names them, the web's default first.

const values = (name) => VARIANTS.find((variant) => variant.name === name)?.values.map((option) => option.value);

test("machine-state: a dot (the default), a dot with a tooltip, a word only while not connected", () => {
  assert.deepEqual(values("machine-state"), ["dot", "dot-tip", "word-off"]);
});

test("machine-state-this-device: shown (the default) or hidden", () => {
  assert.deepEqual(values("machine-state-this-device"), ["show", "hide"]);
});

test("section-new: a New pill (the default), a count, a dot; it replaces new-mark, which the panel no longer offers", () => {
  assert.deepEqual(values("section-new"), ["pill", "count", "dot"]);
  assert.equal(values("new-mark"), undefined);
});

test("one entry per variant", () => {
  const names = VARIANTS.map((variant) => variant.name);
  assert.equal(new Set(names).size, names.length);
});
