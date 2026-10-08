// An engine's web build, loaded at run time from a GitHub Release of sidevoice-engine: the npm package tarball the
// release carries, checked against the release's SHA256SUMS, unpacked in memory and imported as a module. Several
// versions can be loaded side by side; each import is its own module instance with its own wasm memory.
//
// The bytes come through `fetchBytes`, because github.com sends no CORS headers: the page cannot download a release
// asset by itself. Each shell supplies one (server.mjs for the web, the Tauri side later).

import { assetFor, assetUrl, ENGINE_REPO } from "./spec.mjs";
import { untgz } from "./tar.mjs";

/**
 * @typedef {{ fetchBytes: (url: string) => Promise<Uint8Array>, fetchJson: (url: string) => Promise<any> }} Fetchers
 * @typedef {{ label: string, tag: string, version: string, sha256: string, module: any }} LoadedEngine
 */

/**
 * @param {import("./spec.mjs").EngineSpec} spec
 * @param {Fetchers} fetchers
 * @returns {Promise<LoadedEngine>}
 */
export async function loadEngine(spec, { fetchBytes, fetchJson }) {
  if (spec.kind === "ref") {
    throw new Error(
      `${spec.label} is a git ref, not a release: it has no prebuilt web build yet (DESIGN.md, "Arbitrary refs")`,
    );
  }
  const { tag, asset, label } = spec.kind === "latest" ? await latest(fetchJson) : spec;

  const [tgz, sums] = await Promise.all([
    fetchBytes(assetUrl(tag, asset)),
    fetchBytes(assetUrl(tag, "SHA256SUMS")),
  ]);
  const expected = parseSums(new TextDecoder().decode(sums)).get(asset);
  if (!expected) throw new Error(`${tag}: SHA256SUMS does not list ${asset}`);
  const sha256 = await sha256Hex(tgz);
  if (sha256 !== expected) throw new Error(`${tag}: ${asset} is ${sha256}, SHA256SUMS says ${expected}`);

  const { version, js, wasm } = readPackage(await untgz(tgz));
  const module = await import(dataUrl(js));
  await module.default({ module_or_path: wasm });
  return { label, tag, version, sha256, module };
}

/**
 * The local build server.mjs serves (`--engine-tarball`), as `/local-engine.json` describes it: imported from the
 * server, where the page's import map resolves its dependencies, and its wasm fetched beside it. Unlike a release
 * build it is one module instance, loaded once.
 * @param {{ label: string, version: string, sha256: string, entry: string }} info
 * @returns {Promise<LoadedEngine>}
 */
export async function loadLocalEngine(info) {
  const module = await import(info.entry);
  await module.default();
  return { label: info.label, tag: "local", version: info.version, sha256: info.sha256, module };
}

/** The engine's releases that carry a web build, newest first, for the picker. */
export async function listReleases(fetchJson) {
  const releases = await fetchJson(`https://api.github.com/repos/${ENGINE_REPO}/releases?per_page=50`);
  return releases
    .filter((release) => !release.draft)
    .filter((release) => {
      try {
        return release.assets.some((a) => a.name === assetFor(release.tag_name));
      } catch {
        return false;
      }
    })
    .map((release) => ({ tag: release.tag_name, prerelease: release.prerelease, published: release.published_at }));
}

async function latest(fetchJson) {
  const release = await fetchJson(`https://api.github.com/repos/${ENGINE_REPO}/releases/latest`);
  return { tag: release.tag_name, asset: assetFor(release.tag_name), label: `latest (${release.tag_name})` };
}

/** `<hex>  <name>` per line, as `sha256sum` writes it. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (match) sums.set(match[2], match[1]);
  }
  return sums;
}

/** The entry module and its wasm, found through the package's own package.json. */
export function readPackage(files) {
  const manifest = files.get("package/package.json");
  if (!manifest) throw new Error("not an npm package: no package/package.json");
  const pkg = JSON.parse(new TextDecoder().decode(manifest));
  const exported = typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."] ?? pkg.main;
  if (typeof exported !== "string") throw new Error("the package names no entry point");
  const entry = `package/${exported.replace(/^\.\//, "")}`;
  const js = files.get(entry);
  if (!js) throw new Error(`the package's entry point ${entry} is missing`);
  const dir = entry.slice(0, entry.lastIndexOf("/") + 1);
  const wasmPath = [...files.keys()].find((path) => path.startsWith(dir) && path.endsWith("_bg.wasm"));
  if (!wasmPath) throw new Error(`no *_bg.wasm beside ${entry}`);
  return { version: pkg.version, js, wasm: files.get(wasmPath) };
}

export async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A data: URL imports in browsers, the Tauri webview and Node alike. wasm-bindgen's `--target web` glue imports
// nothing relative when given its wasm, so it runs from there.
function dataUrl(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:text/javascript;base64,${btoa(binary)}`;
}
