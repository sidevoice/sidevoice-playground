// Engine builds from sidevoice-engine's GitHub Releases (a version, `nightly`, `latest`), served installed as
// served-engine.mjs serves them, under /engines/<sha256 of the tarball>/: the release's npm tarball and its
// SHA256SUMS are downloaded, the tarball checked against it, then installed as a consumer installs it, with its npm
// dependencies, so the package's own modules (`dist/snippets/`) and the names it imports resolve in the page. A
// tarball is installed once, by its digest; `nightly`, whose tarball changes, is checked against its SHA256SUMS each
// time it is asked for.
//
// Release assets need no token. `latest` is resolved through the GitHub API (`api`, the server's).

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RefError, ENGINES_PREFIX } from "./refs.mjs";
import { installEngine } from "./served-engine.mjs";
import { parseSums, sha256Hex } from "./web/engine/load.mjs";
import { assetFor, assetUrl, ENGINE_REPO, parseSpec } from "./web/engine/spec.mjs";

/**
 * The release builds this server serves, by tarball digest. `api(path)` is the GitHub API's JSON at `path` (null on
 * a 404); `fetch` and `install` are replaceable for tests.
 * @param {{ api: (path: string) => Promise<any>, fetch?: typeof globalThis.fetch,
 *   install?: typeof installEngine }} options
 */
export function releaseBuilds({ api, fetch = globalThis.fetch, install = installEngine }) {
  /** digest → Promise<ServedEngine>: a tarball is downloaded and installed once, however often it is asked for. */
  const builds = new Map();
  /** digest → ServedEngine, once installed. */
  const installed = new Map();

  async function download(url) {
    const res = await fetch(url, { redirect: "follow" });
    if (res.status === 404) return null;
    if (!res.ok) throw new RefError(502, `${url}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** The release `name` names now: its tag, and how to call it. */
  async function release(name) {
    let spec;
    try {
      spec = parseSpec(name ?? "");
    } catch (error) {
      throw new RefError(400, error.message);
    }
    if (spec.kind === "ref") throw new RefError(400, `${name} is not a release: a version, nightly or latest`);
    if (spec.kind === "release") return { tag: spec.tag, label: spec.tag === "nightly" ? "nightly" : spec.tag };
    const latest = await api(`/repos/${ENGINE_REPO}/releases/latest`);
    if (!latest) throw new RefError(404, `${ENGINE_REPO} has published no release yet`);
    return { tag: latest.tag_name, label: `latest (${latest.tag_name})` };
  }

  async function build(tag, asset, digest, tarball) {
    const dir = await mkdtemp(join(tmpdir(), "sidevoice-playground-release-"));
    await writeFile(join(dir, asset), tarball);
    const served = await install(join(dir, asset), { label: tag, sha256: digest, prefix: `${ENGINES_PREFIX}${digest}/` });
    const result = { ...served, tag, verified: true };
    installed.set(digest, result);
    return result;
  }

  return {
    /** The served build of release `name`, downloaded, checked and installed the first time its tarball is seen. */
    async get(name) {
      const { tag, label } = await release(name);
      const asset = assetFor(tag);
      const sums = await download(assetUrl(tag, "SHA256SUMS"));
      if (!sums) throw new RefError(404, `${tag}: no such release, or it carries no SHA256SUMS (a draft is not published yet)`);
      const digest = parseSums(new TextDecoder().decode(sums)).get(asset);
      if (!digest) throw new RefError(404, `${tag}: SHA256SUMS lists no ${asset}, so the release has no web build`);
      if (!builds.has(digest)) {
        const pending = (async () => {
          const tarball = await download(assetUrl(tag, asset));
          if (!tarball) throw new RefError(404, `${tag}: no ${asset} asset`);
          const actual = await sha256Hex(tarball);
          if (actual !== digest) throw new RefError(502, `${tag}: ${asset} is ${actual}, SHA256SUMS says ${digest}`);
          return build(tag, asset, digest, tarball);
        })();
        builds.set(digest, pending);
        pending.catch(() => builds.delete(digest));
      }
      // A nightly is one of many under the same name: its digest tells them apart.
      const named = tag === "nightly" ? `nightly (${digest.slice(0, 7)})` : label;
      return { ...(await builds.get(digest)), label: named };
    },
    /** The installed build whose tarball is `digest`, served under /engines/<digest>/, if any. */
    installed: (digest) => installed.get(digest) ?? null,
    /** Every installed build, for the page's import map. */
    all: () => [...installed.values()],
  };
}
