import { test } from "node:test";
import assert from "node:assert/strict";
import { allowed } from "../server.mjs";

test("/fetch takes sidevoice-engine release assets only", () => {
  assert.ok(allowed("https://github.com/sidevoice/sidevoice-engine/releases/download/nightly/SHA256SUMS"));
  assert.ok(!allowed("https://github.com/sidevoice/sidevoice-engine/archive/main.zip"));
  assert.ok(!allowed("https://github.com/sidevoice/sidevoice-engine/releases/download/../../x"));
  assert.ok(!allowed("https://example.com/"));
  assert.ok(!allowed(null));
});
