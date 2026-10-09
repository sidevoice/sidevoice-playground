// An engine's web build, loaded at run time, two ways:
// - `loadServedEngine`: installed and served by server.mjs, with the import map its npm dependencies need, as
//   `/local-engine.json`, `/ref-build` or `/release-build` describes it. Any build loads this way.
// - `loadEngine`: from a GitHub Release of sidevoice-engine, where there is no server (the macOS app): the npm package
//   tarball the release carries, checked against the release's SHA256SUMS, unpacked in memory and imported as a
//   module. Only a package that imports nothing loads this way: one with npm dependencies or its own modules
//   (`dist/snippets/`, sidevoice-engine#41 on) cannot be resolved from memory, and is refused saying so. Each import
//   is its own module instance with its own wasm memory. The bytes come through `fetchBytes`, because github.com
//   sends no CORS headers: the page cannot download a release asset by itself.

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
      `${spec.label} is a git ref, not a release: its CI build is fetched by the server (/ref-build), not here`,
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
 * A build server.mjs serves installed (served-engine.mjs): the local one, a CI build of a git ref, or a release's, as
 * `/local-engine.json`, `/ref-build` or `/release-build` describes it. Imported from the server, where the page's
 * import map resolves its dependencies, with its wasm fetched beside it: one module instance per build.
 * @param {{ label: string, version: string, sha256: string, entry: string, sha?: string, tag?: string }} info
 * @returns {Promise<LoadedEngine>}
 */
export async function loadServedEngine(info) {
  const module = await import(info.entry);
  await module.default();
  return { label: info.label, tag: info.sha ?? info.tag ?? "local", version: info.version, sha256: info.sha256, module };
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
  const needs = Object.keys(pkg.dependencies ?? {});
  if ([...files.keys()].some((path) => path.includes("/snippets/"))) needs.push("its own modules (dist/snippets/)");
  if (needs.length) {
    throw new Error(
      `this build imports ${needs.join(", ")}, which cannot be resolved from memory: it loads installed, through the web playground's server, or natively in the macOS app`,
    );
  }
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
