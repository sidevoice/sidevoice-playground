import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { loadEngine, parseSums, readPackage, sha256Hex } from "../web/engine/load.mjs";
import { parseSpec } from "../web/engine/spec.mjs";
import { untgz } from "../web/engine/tar.mjs";

const bytes = (text) => new TextEncoder().encode(text);

/** A ustar archive of `files` (path → bytes), as npm pack writes one. */
function tar(files) {
  const blocks = [];
  for (const [path, data] of Object.entries(files)) {
    const header = new Uint8Array(512);
    header.set(bytes(path), 0);
    header.set(bytes("0000644\0"), 100);
    header.set(bytes(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    header.set(bytes("        "), 148);
    header[156] = "0".charCodeAt(0);
    header.set(bytes("ustar\0" + "00"), 257);
    const sum = header.reduce((a, b) => a + b, 0);
    header.set(bytes(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  return gzipSync(Buffer.concat(blocks));
}

const pkg = {
  "package/package.json": bytes(JSON.stringify({ version: "0.2.0", exports: { ".": "./dist/sidevoice_engine.js" } })),
  "package/dist/sidevoice_engine.js": bytes("export default async function init(o) { globalThis.__init = o; }\nexport const WebEngine = 1;"),
  "package/dist/sidevoice_engine_bg.wasm": new Uint8Array([0, 97, 115, 109]),
};

test("untgz reads every regular file by path", async () => {
  const files = await untgz(new Uint8Array(tar(pkg)));
  assert.deepEqual([...files.keys()], Object.keys(pkg));
  assert.deepEqual(files.get("package/dist/sidevoice_engine_bg.wasm"), pkg["package/dist/sidevoice_engine_bg.wasm"]);
});

test("readPackage finds the entry through package.json, and its wasm beside it", () => {
  const { version, js, wasm } = readPackage(new Map(Object.entries(pkg)));
  assert.equal(version, "0.2.0");
  assert.equal(js, pkg["package/dist/sidevoice_engine.js"]);
  assert.equal(wasm, pkg["package/dist/sidevoice_engine_bg.wasm"]);
  assert.throws(() => readPackage(new Map()), /no package\/package.json/);
});

test("parseSums reads sha256sum's format", () => {
  const sums = parseSums(`${"a".repeat(64)}  sidevoice-engine-0.2.0.tgz\n${"b".repeat(64)} *attestation.sigstore.json\n`);
  assert.equal(sums.get("sidevoice-engine-0.2.0.tgz"), "a".repeat(64));
  assert.equal(sums.get("attestation.sigstore.json"), "b".repeat(64));
});

function fakeRelease(tgz, sum) {
  const urls = [];
  return {
    urls,
    fetchJson: async () => assert.fail("no API call expected"),
    fetchBytes: async (url) => {
      urls.push(url);
      if (url.endsWith("/SHA256SUMS")) return bytes(`${sum}  sidevoice-engine-0.2.0.tgz\n`);
      return tgz;
    },
  };
}

test("a release is downloaded, checked against SHA256SUMS, unpacked and initialised with its wasm", async () => {
  const tgz = new Uint8Array(tar(pkg));
  const fetchers = fakeRelease(tgz, await sha256Hex(tgz));
  const loaded = await loadEngine(parseSpec("0.2.0"), fetchers);
  assert.equal(loaded.tag, "v0.2.0");
  assert.equal(loaded.version, "0.2.0");
  assert.equal(loaded.module.WebEngine, 1);
  assert.deepEqual(globalThis.__init.module_or_path, pkg["package/dist/sidevoice_engine_bg.wasm"]);
  assert.deepEqual(fetchers.urls.sort(), [
    "https://github.com/sidevoice/sidevoice-engine/releases/download/v0.2.0/SHA256SUMS",
    "https://github.com/sidevoice/sidevoice-engine/releases/download/v0.2.0/sidevoice-engine-0.2.0.tgz",
  ]);
});

test("a tarball that does not match SHA256SUMS is refused before it is imported", async () => {
  const tgz = new Uint8Array(tar(pkg));
  await assert.rejects(loadEngine(parseSpec("0.2.0"), fakeRelease(tgz, "0".repeat(64))), /SHA256SUMS says/);
});

test("a git ref is not loaded in the page: the server fetches its CI build", async () => {
  await assert.rejects(loadEngine(parseSpec("#27"), fakeRelease()), /fetched by the server/);
});
