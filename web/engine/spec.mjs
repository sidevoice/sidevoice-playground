// What the operator types to name an engine, read into where its web build comes from.
//
// Two kinds come back:
// - `release`: a GitHub Release of sidevoice-engine, which carries the npm package as an asset (RELEASING.md,
//   "Assets"): a version (`0.2.0`, `v0.2.0`, `@sidevoice/engine@0.2.0`, a release URL), `nightly`, or `latest`
//   (resolved later, against the GitHub API).
// - `ref`: any other git ref (a branch, a commit, a pull request). Its package is the engine CI's artifact for the
//   ref's head commit, which only the server can download (refs.mjs; DESIGN.md, "Arbitrary refs").

export const ENGINE_REPO = "sidevoice/sidevoice-engine";

const VERSION = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const SHA = /^[0-9a-f]{7,40}$/;
const REPO_URL = new RegExp(`^(?:https?://)?github\\.com/${ENGINE_REPO}/(.+?)/?$`);

/**
 * @typedef {{ kind: "release", tag: string, asset: string, label: string }
 *   | { kind: "latest", label: string }
 *   | { kind: "ref", ref: string, label: string }} EngineSpec
 */

/**
 * @param {string} input
 * @returns {EngineSpec}
 */
export function parseSpec(input) {
  const text = input.trim();
  if (text === "") throw new Error("empty engine name");

  if (text === "nightly") return nightly();
  if (text === "latest") return { kind: "latest", label: "latest" };

  const npm = text.match(/^(?:npm:)?@sidevoice\/engine@(.+)$/);
  if (npm) return version(npm[1], text);

  const url = text.match(REPO_URL);
  if (url) return fromRepoPath(url[1], text);

  const pr = text.match(/^#(\d+)$/);
  if (pr) return { kind: "ref", ref: `pull/${pr[1]}/head`, label: text };

  if (VERSION.test(text)) return version(text, text);
  if (SHA.test(text)) return { kind: "ref", ref: text, label: text };
  if (/^[\w./-]+$/.test(text)) return { kind: "ref", ref: text, label: text };
  throw new Error(`not an engine name: ${text}`);
}

/** The asset name a release tag carries the npm package under (RELEASING.md, "Assets"). */
export function assetFor(tag) {
  if (tag === "nightly") return "sidevoice-engine-nightly.tgz";
  const match = tag.match(VERSION);
  if (!match) throw new Error(`not a release tag: ${tag}`);
  return `sidevoice-engine-${match[1]}.tgz`;
}

/** Where a release's asset is downloaded from. */
export function assetUrl(tag, asset) {
  return `https://github.com/${ENGINE_REPO}/releases/download/${tag}/${asset}`;
}

function nightly() {
  return { kind: "release", tag: "nightly", asset: assetFor("nightly"), label: "nightly" };
}

function version(text, label) {
  const match = text.match(VERSION);
  if (!match) throw new Error(`not a version: ${text}`);
  const tag = `v${match[1]}`;
  return { kind: "release", tag, asset: assetFor(tag), label };
}

function fromRepoPath(path, label) {
  let m;
  if ((m = path.match(/^releases\/tag\/(.+)$/))) {
    return m[1] === "nightly" ? nightly() : version(m[1], label);
  }
  if ((m = path.match(/^pull\/(\d+)(?:\/.*)?$/))) return { kind: "ref", ref: `pull/${m[1]}/head`, label };
  if ((m = path.match(/^(?:tree|commit)\/(.+)$/))) return { kind: "ref", ref: m[1], label };
  throw new Error(`not an engine link: ${label}`);
}
