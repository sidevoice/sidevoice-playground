// Loads a real engine web build from GitHub Releases and creates an engine in Node, as the page does. Network only:
// PLAYGROUND_NETWORK=1 (CI sets it). The engine's web build is the wasm skeleton (a few hundred KB); no model is
// downloaded or run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "../web/engine/load.mjs";
import { parseSpec } from "../web/engine/spec.mjs";

const fetchers = {
  fetchBytes: async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  fetchJson: async (url) => (await fetch(url)).json(),
};

test("the nightly web build loads and creates an engine", { skip: !process.env.PLAYGROUND_NETWORK }, async () => {
  const loaded = await loadEngine(parseSpec(process.env.PLAYGROUND_ENGINE ?? "nightly"), fetchers);
  const host = { capabilities: async () => ({ os: "web", arch: "wasm32", accelerators: ["wasm"] }) };
  const engine = await loaded.module.WebEngine.create(host);
  const backends = engine.backends();
  console.log(JSON.stringify({ tag: loaded.tag, version: loaded.version, sha256: loaded.sha256, backends }));
  assert.ok(backends.length > 0);
  assert.ok(Array.isArray(engine.offers("stt")));
});
