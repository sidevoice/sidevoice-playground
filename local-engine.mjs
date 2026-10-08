// A local engine build for the web shell: an npm tarball made by `cargo xtask npm` in a sidevoice-engine checkout,
// for a build no release carries (a pull request, a branch). server.mjs installs it as a consumer installs it, with
// its dependencies (transformers.js, eSpeak NG), and serves the installed packages under /local-engine/ with an
// import map for the names the package imports, the way the engine's own web e2e serves its page
// (xtask/web-e2e/run.mjs in sidevoice-engine).
//
// No SHA256SUMS comes with a local build: its digest is shown in the page, and checked against `--engine-sha256`
// when one is given.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { sha256Hex } from "./web/engine/load.mjs";

export const PREFIX = "/local-engine/";

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
 * Installs `tarball` into a scratch directory and says how the page reaches it.
 * @returns {Promise<{ label: string, version: string, sha256: string, site: string, entry: string, imports: Record<string, string> }>}
 */
export async function installLocalEngine({ tarball, label, sha256 }) {
  const path = resolve(tarball);
  const digest = await sha256Hex(await readFile(path));
  if (sha256 && digest !== sha256.toLowerCase()) throw new Error(`${path} is ${digest}, --engine-sha256 says ${sha256}`);

  const site = await mkdtemp(join(tmpdir(), "sidevoice-playground-engine-"));
  await writeFile(join(site, "package.json"), '{ "private": true, "type": "module" }\n');
  await promisify(execFile)("npm", ["install", "--no-audit", "--no-fund", path], { cwd: site });

  const imports = importMap(site);
  const entry = imports["@sidevoice/engine"];
  if (!entry) throw new Error(`${path}: the installed @sidevoice/engine names no entry point`);
  const { version } = await readJson(join(site, "node_modules/@sidevoice/engine/package.json"));
  return { label: label ?? `local build (${basename(path)})`, version, sha256: digest, site, entry, imports };
}

/** Each specifier the installed packages in `site` resolve for a browser, as a URL path under PREFIX. */
export function importMap(site, read = (file) => readFileSync(file, "utf8")) {
  const imports = {};
  for (const specifier of SPECIFIERS) {
    const resolved = resolveSpecifier(site, specifier, read);
    if (resolved) imports[specifier] = `${PREFIX}node_modules/${resolved}`;
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

