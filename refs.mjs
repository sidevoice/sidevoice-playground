// Engine builds of git refs (pull requests, branches, commits), from sidevoice-engine's CI (DESIGN.md, "Arbitrary
// refs", R1): every CI run uploads the npm package as an Actions artifact named `engine-npm-<full commit sha>`, kept 7
// days. The server resolves the ref to its head commit, finds that commit's artifact from a successful run, downloads
// it (Actions artifacts need a token, even on a public repository), checks it against the digest the API gives,
// unzips the tarball and serves it as served-engine.mjs does, under /engines/<sha>/.
//
// The token is read from a file by the server and goes to api.github.com only: never to the page, never to a log.

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installEngine } from "./served-engine.mjs";
import { ENGINE_REPO } from "./web/engine/spec.mjs";
import { artifactName, artifactsPath } from "./web/engine/listing.mjs";
import { sha256Hex } from "./web/engine/load.mjs";
import { unzip } from "./zip.mjs";

const API = "https://api.github.com";
export const ENGINES_PREFIX = "/engines/";

/** A failure the page should read as it is, with the HTTP status the server answers it with. */
export class RefError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * sidevoice-engine's GitHub API with the server's token: `api(path)` is the JSON at `path` (null on a 404),
 * `headers()` what every request to GitHub carries. Without a token every call fails with a 503.
 * @param {{ token: string | null, fetch?: typeof globalThis.fetch }} options
 */
export function githubApi({ token, fetch = globalThis.fetch }) {
  function headers() {
    if (!token) throw new RefError(503, "this server has no GitHub token, which Actions artifacts need (--github-token-file)");
    return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  }

  async function api(path) {
    const res = await fetch(`${API}${path}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new RefError(502, `GitHub API ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  }

  return { api, headers };
}

/** What spec.mjs makes of a ref: `pull/<n>/head`, or a branch or commit name. */
export function validRef(ref) {
  if (typeof ref !== "string") return false;
  if (/^pull\/\d+\/head$/.test(ref)) return true;
  return /^[\w.\/-]+$/.test(ref) && !ref.includes("..") && !ref.startsWith("/") && !ref.endsWith("/");
}

/**
 * The ref builds this server serves, by commit. `token` is GitHub's (read-only use); `fetch` and `install` are
 * replaceable for tests.
 * @param {{ token: string | null, fetch?: typeof globalThis.fetch, install?: typeof installEngine }} options
 */
export function refBuilds({ token, fetch = globalThis.fetch, install = installEngine }) {
  /** sha → Promise<ServedEngine>: a build is fetched and installed once, however often it is asked for. */
  const builds = new Map();
  /** sha → ServedEngine, once installed. */
  const installed = new Map();

  const { api, headers } = githubApi({ token, fetch });

  /** The commit `ref` names now, and how to call it. */
  async function resolve(ref) {
    const pr = ref.match(/^pull\/(\d+)\/head$/);
    if (pr) {
      const pull = await api(`/repos/${ENGINE_REPO}/pulls/${pr[1]}`);
      if (!pull) throw new RefError(404, `${ENGINE_REPO} has no pull request #${pr[1]}`);
      return { sha: pull.head.sha, name: `#${pr[1]}` };
    }
    const commit = await api(`/repos/${ENGINE_REPO}/commits/${encodeURIComponent(ref)}`);
    if (!commit) throw new RefError(404, `${ENGINE_REPO} has no branch or commit ${ref}`);
    return { sha: commit.sha, name: commit.sha.startsWith(ref) ? null : ref };
  }

  /** The artifact of a successful run for `sha`, or why there is none. */
  async function artifactFor(sha) {
    const short = sha.slice(0, 7);
    const name = artifactName(sha);
    const { artifacts = [] } = (await api(artifactsPath(sha))) ?? {};
    const newest = [...artifacts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const live = newest.filter((a) => !a.expired);
    const runs = [];
    for (const artifact of live) {
      const run = await api(`/repos/${ENGINE_REPO}/actions/runs/${artifact.workflow_run?.id}`);
      if (run?.conclusion === "success") return artifact;
      if (run) runs.push(run);
    }
    if (runs.length) throw notReady(short, runs);
    if (newest.length) {
      throw new RefError(410, `the build of ${short} has expired (CI keeps it 7 days): re-run the engine's CI on it to build it again`);
    }
    const { workflow_runs = [] } = (await api(`/repos/${ENGINE_REPO}/actions/runs?head_sha=${sha}&per_page=20`)) ?? {};
    if (!workflow_runs.length) throw new RefError(404, `no CI run for ${short} yet, so no build of it`);
    const going = workflow_runs.filter((run) => run.status !== "completed");
    if (going.length) throw notReady(short, going);
    if (workflow_runs.every((run) => run.conclusion !== "success")) throw notReady(short, workflow_runs);
    throw new RefError(404, `CI on ${short} uploaded no ${name} artifact (a run older than the upload step?)`);
  }

  function notReady(short, runs) {
    const run = runs.find((r) => r.status !== "completed") ?? runs[0];
    if (run.status !== "completed") {
      return new RefError(409, `no build of ${short} yet: CI is still running (${run.html_url}); try again when it is done`);
    }
    return new RefError(409, `no build of ${short}: its CI run ended ${run.conclusion} (${run.html_url})`);
  }

  async function build(sha, label) {
    const artifact = await artifactFor(sha);
    const res = await fetch(artifact.archive_download_url, { headers: headers(), redirect: "follow" });
    if (!res.ok) throw new RefError(502, `downloading the build of ${sha.slice(0, 7)}: HTTP ${res.status}`);
    const zip = new Uint8Array(await res.arrayBuffer());

    // The API gives the zip's digest for artifacts uploaded with upload-artifact v4 and later.
    const digest = await sha256Hex(zip);
    const expected = typeof artifact.digest === "string" ? artifact.digest.replace(/^sha256:/, "") : null;
    if (expected && digest !== expected) {
      throw new RefError(502, `the build of ${sha.slice(0, 7)} is ${digest}, the artifact's digest says ${expected}`);
    }

    const tarballs = [...unzip(zip)].filter(([name]) => name.endsWith(".tgz"));
    if (tarballs.length !== 1) throw new RefError(502, `the artifact ${artifact.name} holds ${tarballs.length} tarballs, not one`);
    const [[name, tarball]] = tarballs;
    const dir = await mkdtemp(join(tmpdir(), "sidevoice-playground-ref-"));
    await writeFile(join(dir, name), tarball);
    const served = await install(join(dir, name), {
      label,
      sha256: await sha256Hex(tarball),
      prefix: `${ENGINES_PREFIX}${sha}/`,
    });
    const result = { ...served, sha, verified: Boolean(expected) };
    installed.set(sha, result);
    return result;
  }

  return {
    /** The served build for `ref`, fetched and installed the first time its commit is asked for. */
    async get(ref) {
      if (!validRef(ref)) throw new RefError(400, `not a git ref: ${ref}`);
      const { sha, name } = await resolve(ref);
      const label = name ? `${name} @ ${sha.slice(0, 7)}` : sha.slice(0, 7);
      if (!builds.has(sha)) {
        const pending = build(sha, label);
        builds.set(sha, pending);
        pending.catch(() => builds.delete(sha));
      }
      return { ...(await builds.get(sha)), label };
    },
    /** The installed build of commit `sha`, served under /engines/<sha>/, if any. */
    installed: (sha) => installed.get(sha) ?? null,
    /** Every installed build, for the page's import map. */
    all: () => [...installed.values()],
  };
}
