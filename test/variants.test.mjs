import { test } from "node:test";
import assert from "node:assert/strict";
import { VARIANTS } from "../preview/mock/shell.mjs";
import { CONVERSATION_SAMPLES, sampleLabel } from "../preview/mock/card.mjs";

const values = (name) => VARIANTS.find((variant) => variant.name === name)?.values.map((option) => option.value);

test("the panel offers the chat's palettes and how a sent turn shows, the page's default first", () => {
  assert.deepEqual(values("chat-colors"), ["today", "soft", "filled"]);
  assert.deepEqual(values("sent-text"), ["tail", "clamp", "shrink", "line"]);
  assert.deepEqual(values("sent-repeat"), ["replace", "stack", "leave"]);
});

test("each variant is offered once, every value once and labelled", () => {
  assert.equal(new Set(VARIANTS.map((variant) => variant.name)).size, VARIANTS.length);
  for (const variant of VARIANTS) {
    assert.ok(variant.label && variant.note, variant.name);
    assert.equal(new Set(variant.values.map((option) => option.value)).size, variant.values.length, variant.name);
    for (const option of variant.values) assert.ok(option.label, `${variant.name} ${option.value}`);
  }
});

test("“You say” has a long dictated turn, offered by a short label so the card keeps its width", () => {
  const long = CONVERSATION_SAMPLES.user.find((text) => text.length > 400);
  assert.ok(long, "a long sample");
  assert.ok((long.match(/[.!?](\s|$)/g) ?? []).length >= 4, "several sentences");
  assert.ok(sampleLabel(long).length <= 80);
  assert.match(sampleLabel(long), /^Okay, so here's what.*… \(long, \d+ characters\)$/);
  assert.equal(sampleLabel(CONVERSATION_SAMPLES.user[0]), CONVERSATION_SAMPLES.user[0]);
});
