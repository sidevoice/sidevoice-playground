import { test } from "node:test";
import assert from "node:assert/strict";
import { filterOptions, marks, move, words } from "../web/combobox/filter.mjs";

const options = [
  { label: "main @ 2641b94" },
  { label: "release nightly (pre-release)" },
  { label: "#126 feat(turns): honor conversation epochs @ e69a364" },
  { label: "#133 feat(agents): Show Cursor Desktop Bridge setup @ 1778df1", disabled: true },
  { label: "feat/r2-r3-settings-agents @ a0436e1" },
];
const labels = (list) => list.map((option) => option.label);

test("a query's words, lowercased, blanks dropped", () => {
  assert.deepEqual(words("  Feat   AGENTS "), ["feat", "agents"]);
  assert.deepEqual(words(""), []);
  assert.deepEqual(words("   "), []);
});

test("no query keeps every option, in order", () => {
  assert.deepEqual(filterOptions(options, ""), options);
  assert.deepEqual(filterOptions(options, "  "), options);
});

test("the filter matches anywhere in the label, whatever the case", () => {
  assert.deepEqual(labels(filterOptions(options, "NIGHT")), ["release nightly (pre-release)"]);
  assert.deepEqual(labels(filterOptions(options, "2641")), ["main @ 2641b94"]);
  assert.deepEqual(labels(filterOptions(options, "#12")), ["#126 feat(turns): honor conversation epochs @ e69a364"]);
  assert.deepEqual(labels(filterOptions(options, "desktop BRIDGE")), ["#133 feat(agents): Show Cursor Desktop Bridge setup @ 1778df1"]);
});

test("every word must be there, in any order; disabled options are kept, as the select shows them", () => {
  assert.deepEqual(labels(filterOptions(options, "agents feat")), [
    "#133 feat(agents): Show Cursor Desktop Bridge setup @ 1778df1",
    "feat/r2-r3-settings-agents @ a0436e1",
  ]);
  assert.deepEqual(filterOptions(options, "feat nightly"), []);
  assert.deepEqual(filterOptions(options, "zzz"), []);
});

test("the options kept are the caller's own objects, with what it keeps on them", () => {
  const kept = filterOptions([{ label: "v0.2.0", index: 4, title: "Release" }], "0.2");
  assert.deepEqual(kept, [{ label: "v0.2.0", index: 4, title: "Release" }]);
});

test("marks: the matched parts of a label, every occurrence of every word, joining back to the label", () => {
  assert.deepEqual(marks("feat/r2-r3-settings-agents", "AGENT feat"), [
    { text: "feat", match: true },
    { text: "/r2-r3-settings-", match: false },
    { text: "agent", match: true },
    { text: "s", match: false },
  ]);
  assert.deepEqual(marks("r2-r3", "r"), [
    { text: "r", match: true },
    { text: "2-", match: false },
    { text: "r", match: true },
    { text: "3", match: false },
  ]);
  // Overlapping words mark one run.
  assert.deepEqual(marks("nightly", "nigh ghtl"), [{ text: "nightl", match: true }, { text: "y", match: false }]);
  for (const [label, query] of [["main @ 2641b94", "41"], ["Fresh install", "zzz"], ["", "a"], ["release", ""]]) {
    assert.equal(marks(label, query).map((part) => part.text).join(""), label);
  }
  assert.deepEqual(marks("Fresh install", ""), [{ text: "Fresh install", match: false }]);
});

test("marks: a label whose lowercase changes length is left plain rather than marked out of place", () => {
  assert.deepEqual(marks("İstanbul", "stan"), [{ text: "İstanbul", match: false }]);
});

test("move: down and up skip disabled options and go round the ends", () => {
  const list = [{}, { disabled: true }, {}, {}, { disabled: true }];
  assert.equal(move(list, -1, 1), 0); // nothing active: down goes to the first enabled
  assert.equal(move(list, -1, -1), 3); // and up to the last enabled
  assert.equal(move(list, 0, 1), 2);
  assert.equal(move(list, 2, -1), 0);
  assert.equal(move(list, 3, 1), 0);
  assert.equal(move(list, 0, -1), 3);
});

test("move: the only enabled option stays put; none enabled, or none at all, is -1", () => {
  assert.equal(move([{ disabled: true }, {}, { disabled: true }], 1, 1), 1);
  assert.equal(move([{ disabled: true }, {}, { disabled: true }], 1, -1), 1);
  assert.equal(move([{ disabled: true }, { disabled: true }], -1, 1), -1);
  assert.equal(move([], -1, 1), -1);
  assert.equal(move([], 0, -1), -1);
});

test("move: an index past the list, as after the list shrank, starts again from its end", () => {
  assert.equal(move([{}, {}], 5, 1), 0);
  assert.equal(move([{}, {}], 5, -1), 1);
});
