import { test } from "node:test";
import assert from "node:assert/strict";
import { assetFor, parseSpec } from "../web/engine/spec.mjs";

const release = (tag, asset) => ({ kind: "release", tag, asset });
const strip = ({ label, ...rest }) => rest;

test("versions, however typed, name a release and its package asset", () => {
  for (const input of ["0.2.0", "v0.2.0", "@sidevoice/engine@0.2.0", "npm:@sidevoice/engine@0.2.0",
    "https://github.com/sidevoice/sidevoice-engine/releases/tag/v0.2.0"]) {
    assert.deepEqual(strip(parseSpec(input)), release("v0.2.0", "sidevoice-engine-0.2.0.tgz"), input);
  }
  assert.deepEqual(strip(parseSpec("0.2.0-rc.1")), release("v0.2.0-rc.1", "sidevoice-engine-0.2.0-rc.1.tgz"));
});

test("nightly has its fixed asset name; latest is resolved later", () => {
  assert.deepEqual(strip(parseSpec(" nightly ")), release("nightly", "sidevoice-engine-nightly.tgz"));
  assert.deepEqual(strip(parseSpec("github.com/sidevoice/sidevoice-engine/releases/tag/nightly")),
    release("nightly", "sidevoice-engine-nightly.tgz"));
  assert.equal(parseSpec("latest").kind, "latest");
});

test("pull requests, branches and commits are refs", () => {
  const ref = (input) => strip(parseSpec(input));
  assert.deepEqual(ref("#27"), { kind: "ref", ref: "pull/27/head" });
  assert.deepEqual(ref("https://github.com/sidevoice/sidevoice-engine/pull/27/files"), { kind: "ref", ref: "pull/27/head" });
  assert.deepEqual(ref("https://github.com/sidevoice/sidevoice-engine/tree/feat/installer"), { kind: "ref", ref: "feat/installer" });
  assert.deepEqual(ref("https://github.com/sidevoice/sidevoice-engine/commit/d23dd31"), { kind: "ref", ref: "d23dd31" });
  assert.deepEqual(ref("feat/sherpa-onnx"), { kind: "ref", ref: "feat/sherpa-onnx" });
  assert.deepEqual(ref("d23dd314505a03aa664cd5d9ec8165490516bda3"), { kind: "ref", ref: "d23dd314505a03aa664cd5d9ec8165490516bda3" });
});

test("anything else is refused", () => {
  for (const input of ["", "  ", "https://github.com/someone/else/releases/tag/v1.0.0", "two words"]) {
    assert.throws(() => parseSpec(input), undefined, input);
  }
  assert.throws(() => assetFor("main"));
});
