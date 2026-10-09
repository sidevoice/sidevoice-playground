import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChoice,
  buildInfo,
  describeError,
  familiesFor,
  familyOf,
  modelLabel,
  preferredBuild,
  progressText,
  wer,
} from "../web/catalog.mjs";

const build = (id, over = {}) => ({
  id, backend: "transformers-js", precision: "fp16", accelerator: "webgpu", downloadBytes: 79e6, memoryMb: 100,
  available: true, reasons: [], installed: false, ...over,
});
const notHere = { available: false, accelerator: undefined, reasons: [{ code: "backend-not-in-this-build", params: {} }] };

// Shaped like models() of sidevoice-engine #41 on a web host, plus a desktop backend the web build lacks.
const catalog = [
  { id: "fastconformer-es-large", capabilities: ["stt"], parametersM: 114, voices: [], installed: false,
    builds: [build("fastconformer-es-large/sherpa-onnx-int8", { backend: "sherpa-onnx", precision: "int8", ...notHere })] },
  { id: "kokoro-82m-v1.0", capabilities: ["tts"], parametersM: 82, installed: false,
    recommendedBuild: "kokoro-82m-v1.0/transformers-js-fp16",
    builds: [build("kokoro-82m-v1.0/transformers-js-fp16"), build("kokoro-82m-v1.0/transformers-js-q8", { precision: "q8" })] },
  { id: "whisper-tiny", capabilities: ["stt"], parametersM: 39, installed: true,
    recommendedBuild: "whisper-tiny/transformers-js-fp16",
    builds: [
      build("whisper-tiny/transformers-js-fp16"),
      build("whisper-tiny/transformers-js-q8", { precision: "q8", installed: true }),
      build("whisper-tiny/mlx-fp16", { backend: "mlx", ...notHere }),
    ] },
  { id: "whisper-small", capabilities: ["stt"], parametersM: 244, installed: false,
    recommendedBuild: "whisper-small/whisper-cpp-q5_1",
    builds: [
      build("whisper-small/whisper-cpp-q5_1", { backend: "whisper-cpp", precision: "q5_1", ...notHere }),
      build("whisper-small/transformers-js-q8", { precision: "q8" }),
    ] },
];

test("families come from the catalogue per capability, each with only its models of that capability", () => {
  assert.deepEqual(
    familiesFor(catalog, "stt").map((f) => [f.id, f.models.map((m) => m.id)]),
    [["fastconformer", ["fastconformer-es-large"]], ["whisper", ["whisper-tiny", "whisper-small"]]],
  );
  assert.deepEqual(familiesFor(catalog, "tts").map((f) => f.id), ["kokoro"]);
  assert.equal(familyOf({ id: "kokoro-82m-v1.0" }), "kokoro");
  assert.equal(familyOf({ id: "kokoro-82m-v1.0", family: "styletts" }), "styletts", "the engine's own family wins");
});

test("the preselected build is the recommended one when it runs here, else the first that does", () => {
  assert.equal(preferredBuild(catalog[2]).id, "whisper-tiny/transformers-js-fp16");
  assert.equal(preferredBuild(catalog[3]).id, "whisper-small/transformers-js-q8", "recommended whisper.cpp is not in the web build");
  assert.equal(preferredBuild(catalog[0]), null);
});

test("builds read the same whatever their backend: what they are, what they cost, or why they do not run", () => {
  assert.deepEqual(buildChoice(catalog[2], catalog[2].builds[1]), {
    id: "whisper-tiny/transformers-js-q8", title: "transformers-js · q8 · webgpu",
    detail: "79 MB download · about 100 MB in memory · installed", available: true,
  });
  assert.deepEqual(buildChoice(catalog[2], catalog[2].builds[2]), {
    id: "whisper-tiny/mlx-fp16", title: "mlx · fp16", detail: "Does not run here: backend-not-in-this-build", available: false,
  });
  assert.match(buildChoice(catalog[2], catalog[2].builds[0]).detail, /recommended/);
  assert.equal(
    buildInfo(catalog[1], catalog[1].builds[0]),
    "transformers-js · fp16 · webgpu · 79 MB download · about 100 MB in memory · runs here · recommended",
  );
  const reasoned = build("x/y", { available: false, reasons: [{ code: "not-enough-memory", params: { needs: 3000, has: 2048 } }] });
  assert.equal(buildChoice({ id: "x" }, reasoned).detail, "Does not run here: not-enough-memory (needs 3000, has 2048)");
});

test("labels, progress and errors in words", () => {
  assert.equal(modelLabel(catalog[2]), "whisper-tiny · 39 M params (installed)");
  assert.equal(modelLabel(catalog[0]), "fastconformer-es-large · 114 M params (no build runs here)");
  assert.equal(progressText({ files: 3, done: 1, received: 5e6, size: 79e6 }), "Downloading: 1/3 files done, 5.0 MB of 79 MB received…");
  assert.equal(describeError(Object.assign(new Error("cancelled"), { code: "cancelled" })), "Cancelled.");
  assert.match(describeError(Object.assign(new Error("x"), { code: "model-in-use", params: {} })), /^Engine error: model-in-use \(/);
  assert.equal(describeError(new Error("plain")), "plain");
});

test("the round trip's word error rate ignores case and punctuation", () => {
  assert.equal(wer("The quick brown fox.", "the quick brown fox"), 0);
  assert.equal(wer("one two three four", "one too three"), 0.5);
  assert.equal(wer("", ""), 0);
});
