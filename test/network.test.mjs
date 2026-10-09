// Loads a real engine web build from GitHub Releases as the server serves it to the page (release-builds.mjs): the
// tarball checked against SHA256SUMS and installed with its npm dependencies, then its entry imported (its own
// modules, dist/snippets/, resolving beside it) and an engine created in Node. Network only: PLAYGROUND_NETWORK=1 (CI
// sets it); PLAYGROUND_ENGINE names the release (`nightly` by default). The engine's web build is a few hundred KB,
// its dependencies are installed but not run, and no model is downloaded or run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseBuilds } from "../release-builds.mjs";
import { publicApi } from "../web/engine/listing.mjs";

test("a release's web build, installed as the server serves it, loads and creates an engine", { skip: !process.env.PLAYGROUND_NETWORK }, async () => {
  const build = await releaseBuilds({ api: publicApi() }).get(process.env.PLAYGROUND_ENGINE ?? "nightly");
  const entry = join(build.site, build.entry.slice(build.prefix.length));
  const wasm = (await readdir(dirname(entry))).find((name) => name.endsWith("_bg.wasm"));
  const module = await import(pathToFileURL(entry));
  await module.default({ module_or_path: await readFile(join(dirname(entry), wasm)) });
  const host = { capabilities: async () => ({ os: "web", arch: "wasm32", accelerators: ["wasm"] }) };
  const engine = await module.WebEngine.create(host);
  const backends = engine.backends();
  console.log(JSON.stringify({ label: build.label, version: build.version, sha256: build.sha256, backends }));
  assert.ok(backends.length > 0);
  assert.ok(build.imports["@huggingface/transformers"], "the import map names transformers.js");
});
