// What builds exist to pick from, from a source repository's GitHub API (sources.mjs: the engine's by default): the
// releases that carry a web build and the newest one (the engine's), the open pull requests with whether their head
// commit's CI build (`engine-npm-<sha>`, `voice-npm-<sha>`) is there or has expired (and, when it is not there, the newest earlier commit of the pull request whose build is), and the
// branches with their head commits. The API is the caller's (`api(path)`: the JSON at `path`
// under https://api.github.com, null on a 404, a rejection on any other failure), so a caller with a token and one
// without list alike. No DOM here.

import { listReleases } from "./load.mjs";
import { ENGINE } from "../sources.mjs";

const REPO = (source) => `/repos/${source.repo}`;
const PER_PAGE = 100;
const MAX_PAGES = 5;
/** How many of a pull request's earlier commits are looked at for a build, newest first. */
const MAX_BEHIND = 20;

/**
 * @typedef {(path: string) => Promise<any>} Api
 * @typedef {{ tag: string, prerelease: boolean, published: string }} Release
 * @typedef {{ state: "available" | "expired" | "none", expires?: string }} BuildState
 * @typedef {{ sha: string, behind: number, expires: string }} Fallback the newest earlier commit with a live build,
 *   `behind` commits before the head
 * @typedef {{ number: number, title: string, author: string, draft: boolean, updated: string,
 *   head: { label: string, sha: string }, build: BuildState, fallback?: Fallback }} Pull
 * @typedef {{ name: string, sha: string }} Branch
 * @typedef {{ listed: string, releases: Release[], latest: Release | null, pulls: Pull[], branches: Branch[],
 *   errors: string[] }} Listing
 */

/** The name of the artifact a source's CI uploads the npm package of commit `sha` as. */
export const artifactName = (sha, source = ENGINE) => source.artifact(sha);

/** The API path that lists commit `sha`'s artifacts in a source, expired ones included. */
export const artifactsPath = (sha, source = ENGINE) =>
  `${REPO(source)}/actions/artifacts?name=${artifactName(sha, source)}&per_page=100`;

/**
 * Everything there is to pick in `source` (the engine by default). A part that fails leaves the others listed and says
 * why in `errors`. A source with no releases lists none.
 * @param {Api} api
 * @param {() => number} [now]
 * @param {import("../sources.mjs").Source} [source]
 * @returns {Promise<Listing>}
 */
export async function listEngineBuilds(api, now = Date.now, source = ENGINE) {
  const repo = REPO(source);
  const errors = [];
  const part = (promise, fallback) =>
    promise.catch((error) => {
      errors.push(error.message);
      return fallback;
    });
  const [releases, latest, pulls, branches] = await Promise.all([
    source.releases ? part(listReleases((url) => api(url.replace(/^https:\/\/api\.github\.com/, ""))), []) : [],
    source.releases ? part(api(`${repo}/releases/latest`), null) : null,
    part(
      pages(api, `${repo}/pulls?state=open&sort=updated&direction=desc`).then((open) =>
        Promise.all(
          open.map(async (pull) => {
            const build = await buildOf(api, pull.head.sha, source);
            const fallback =
              build.state === "available" ? null : await fallbackOf(api, pull.number, pull.head.sha, source);
            return {
              number: pull.number,
              title: pull.title,
              author: pull.user?.login ?? "",
              draft: Boolean(pull.draft),
              updated: pull.updated_at,
              head: { label: pull.head.label, sha: pull.head.sha },
              build,
              ...(fallback && { fallback }),
            };
          }),
        ),
      ),
      [],
    ),
    part(pages(api, `${repo}/branches`).then((all) => all.map((b) => ({ name: b.name, sha: b.commit.sha }))), []),
  ]);
  return {
    listed: new Date(now()).toISOString(),
    releases,
    latest: latest && { tag: latest.tag_name, prerelease: latest.prerelease, published: latest.published_at },
    pulls,
    branches,
    errors: [...new Set(errors)],
  };
}

/**
 * The commit a release tag, branch or pull request (`pull/<n>/head`) of `source` names now.
 * @param {Api} api
 */
export async function commitOf(api, ref, source = ENGINE) {
  const pr = ref.match(/^pull\/(\d+)\/head$/);
  if (pr) {
    const pull = await api(`${REPO(source)}/pulls/${pr[1]}`);
    if (!pull) throw new Error(`${source.repo} has no pull request #${pr[1]}`);
    return pull.head.sha;
  }
  const commit = await api(`${REPO(source)}/commits/${encodeURIComponent(ref)}`);
  if (!commit) throw new Error(`${source.repo} has no tag, branch or commit ${ref}`);
  return commit.sha;
}

/**
 * GitHub's API with no token, as a page reaches it (it allows CORS): enough for a public repository, at 60 requests
 * an hour.
 * @returns {Api}
 */
export function publicApi(fetch = globalThis.fetch) {
  return async (path) => {
    const res = await fetch(`https://api.github.com${path}`, { headers: { accept: "application/vnd.github+json" } });
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      throw new Error(`GitHub API ${path.split("?")[0]}: HTTP ${res.status} (the hourly limit without a token?)`);
    }
    if (!res.ok) throw new Error(`GitHub API ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  };
}

async function pages(api, path) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = (await api(`${path}${path.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`)) ?? [];
    all.push(...items);
    if (items.length < PER_PAGE) break;
  }
  return all;
}

/**
 * The newest commit of pull request `number` before its head `head` whose CI build is there, or null: its commits
 * listed oldest first, looked at from the newest down, at most MAX_BEHIND of them.
 * @returns {Promise<Fallback | null>}
 */
async function fallbackOf(api, number, head, source) {
  const commits = (await pages(api, `${REPO(source)}/pulls/${number}/commits`)).map((commit) => commit.sha);
  const at = commits.lastIndexOf(head);
  const before = (at === -1 ? commits : commits.slice(0, at)).reverse().slice(0, MAX_BEHIND);
  for (const [index, sha] of before.entries()) {
    const build = await buildOf(api, sha, source);
    if (build.state === "available") return { sha, behind: index + 1, expires: build.expires };
  }
  return null;
}

/** @returns {Promise<BuildState>} */
async function buildOf(api, sha, source) {
  const { artifacts = [] } = (await api(artifactsPath(sha, source))) ?? {};
  const newest = [...artifacts].sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
  const live = newest.find((a) => !a.expired);
  if (live) return { state: "available", expires: live.expires_at };
  if (newest.length) return { state: "expired", expires: newest[0].expires_at };
  return { state: "none" };
}
