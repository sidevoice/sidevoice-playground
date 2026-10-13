import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVERSATION_SAMPLES, sampleLabel } from "../preview/mock/card.mjs";

test("“You say” has a long dictated turn, offered by a short label so the card keeps its width", () => {
  const long = CONVERSATION_SAMPLES.user.find((text) => text.length > 400);
  assert.ok(long, "a long sample");
  assert.ok((long.match(/[.!?](\s|$)/g) ?? []).length >= 4, "several sentences");
  assert.ok(sampleLabel(long).length <= 80);
  assert.match(sampleLabel(long), /^Okay, so here's what.*… \(long, \d+ characters\)$/);
  assert.equal(sampleLabel(CONVERSATION_SAMPLES.user[0]), CONVERSATION_SAMPLES.user[0]);
});
