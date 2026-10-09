// A build served by server.mjs rather than imported from memory, of the engine or of the voice module: an npm tarball (made by `cargo xtask npm`)
// installed as a consumer installs it, with its dependencies (transformers.js, eSpeak NG), into a scratch directory,
// and served under a prefix of its own with an import map for the names the package imports, the way the engine's
// own web e2e serves its page (xtask/web-e2e/run.mjs in sidevoice-engine). Two kinds are served: the local build
// (`--engine-tarball`, under /local-engine/) and CI builds of git refs (refs.mjs, under /engines/<sha>/). The voice module
// (`@sidevoice/voice`) imports nothing by name: the page hands it the engine it loaded, so only its own entry is mapped.
//
// A build from a release is still imported in the page (web/engine/load.mjs). From sidevoice-engine#41 on, the
// package imports npm dependencies, which only a served build resolves.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256Hex } from "./web/engine/load.mjs";

export const LOCAL_PREFIX = "/local-engine/";

// The names the engine package imports, directly or through its dependencies.
const SPECIFIERS = [
  "@sidevoice/engine",
  "@huggingface/transformers",
  "onnxruntime-web",
  "onnxruntime-web/webgpu",
  "onnxruntime-common",
  "espeak-ng",
];
// A browser's conditions, as a bundler targeting one would resolve `exports`.
const CONDITIONS = new Set(["browser", "import", "module", "default"]);

/**
 * @typedef {{ label: string, version: string, sha256: string, prefix: string, site: string, entry: string,
 *   imports: Record<string, string> }} ServedEngine
 */

/**
 * The local build: `tarball`, checked against `sha256` when given (no SHA256SUMS comes with it), served under
 * LOCAL_PREFIX.
 * @returns {Promise<ServedEngine>}
 */
export async function installLocalEngine({ tarball, label, sha256 }) {
  const path = resolve(tarball);
  const digest = await sha256Hex(await readFile(path));
  if (sha256 && digest !== sha256.toLowerCase()) throw new Error(`${path} is ${digest}, --engine-sha256 says ${sha256}`);
  return installEngine(path, { label: label ?? `local build (${basename(path)})`, sha256: digest, prefix: LOCAL_PREFIX });
}

/**
 * Installs the tarball at `path` into a scratch directory and says how the page reaches it under `prefix`.
 * @returns {Promise<ServedEngine>}
 */
export function installEngine(path, { label, sha256, prefix }) {
  return installPackage(path, { label, sha256, prefix, name: "@sidevoice/engine", specifiers: SPECIFIERS });
}

/**
 * The voice module's tarball at `path`, installed and served under `prefix` like an engine build. Its peer, the
 * engine, is not installed: the page passes the engine it loaded.
 * @returns {Promise<ServedEngine>}
 */
export function installVoice(path, { label, sha256, prefix }) {
  const name = "@sidevoice/voice";
  return installPackage(path, { label, sha256, prefix, name, specifiers: [name], npmArgs: ["--legacy-peer-deps"] });
}

/**
 * Installs package `name` from the tarball at `path` into a scratch directory and says how the page reaches it under
 * `prefix`: its entry, and the import map of `specifiers`.
 * @returns {Promise<ServedEngine>}
 */
async function installPackage(path, { label, sha256, prefix, name, specifiers, npmArgs = [] }) {
  const site = await mkdtemp(join(tmpdir(), "sidevoice-playground-build-"));
  await writeFile(join(site, "package.json"), '{ "private": true, "type": "module" }\n');
  await promisify(execFile)("npm", ["install", "--no-audit", "--no-fund", ...npmArgs, path], { cwd: site });

  const imports = importMap(site, prefix, undefined, specifiers);
  const entry = imports[name];
  if (!entry) throw new Error(`${path}: the installed ${name} names no entry point`);
  const { version } = await readJson(join(site, "node_modules", name, "package.json"));
  return { label, version, sha256, prefix, site, entry, imports };
}

/** Each of `specifiers` the installed packages in `site` resolve for a browser, as a URL path under `prefix`. */
export function importMap(site, prefix, read = (file) => readFileSync(file, "utf8"), specifiers = SPECIFIERS) {
  const imports = {};
  for (const specifier of specifiers) {
    const resolved = resolveSpecifier(site, specifier, read);
    if (resolved) imports[specifier] = `${prefix}node_modules/${resolved}`;
  }
  return imports;
}

/** `<package>/<entry>` for `specifier`, from the package's `exports` (or `browser`, `module`, `main`), or null. */
export function resolveSpecifier(site, specifier, read) {
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  const sub = "." + specifier.slice(name.length);
  let manifest;
  try {
    manifest = JSON.parse(read(join(site, "node_modules", name, "package.json")));
  } catch {
    return null;
  }
  let entry;
  if (manifest.exports) {
    const exports = manifest.exports;
    const keyed = typeof exports === "object" && Object.keys(exports).some((key) => key.startsWith("."));
    entry = pick(keyed ? exports[sub] : sub === "." ? exports : null);
  } else if (sub === ".") {
    entry = typeof manifest.browser === "string" ? manifest.browser : manifest.module ?? manifest.main ?? "index.js";
  }
  return entry ? `${name}/${entry.replace(/^\.\//, "")}` : null;
}

function pick(target) {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  for (const [key, value] of Object.entries(target)) {
    if (CONDITIONS.has(key)) {
      const picked = pick(value);
      if (picked) return picked;
    }
  }
  return null;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

