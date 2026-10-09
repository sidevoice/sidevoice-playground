// What engine builds exist to pick from, from sidevoice-engine's GitHub API: the releases that carry a web build and
// the newest one, the open pull requests with whether their head commit's CI build (`engine-npm-<sha>`) is there or
// has expired, and the branches with their head commits. The API is the caller's (`api(path)`: the JSON at `path`
// under https://api.github.com, null on a 404, a rejection on any other failure), so a caller with a token and one
// without list alike. No DOM here.

import { listReleases } from "./load.mjs";
import { ENGINE_REPO } from "./spec.mjs";

const REPO = `/repos/${ENGINE_REPO}`;
const PER_PAGE = 100;
const MAX_PAGES = 5;

/**
 * @typedef {(path: string) => Promise<any>} Api
 * @typedef {{ tag: string, prerelease: boolean, published: string }} Release
 * @typedef {{ state: "available" | "expired" | "none", expires?: string }} BuildState
 * @typedef {{ number: number, title: string, author: string, draft: boolean, updated: string,
 *   head: { label: string, sha: string }, build: BuildState }} Pull
 * @typedef {{ name: string, sha: string }} Branch
 * @typedef {{ listed: string, releases: Release[], latest: Release | null, pulls: Pull[], branches: Branch[],
 *   errors: string[] }} Listing
 */

/** The name of the artifact sidevoice-engine's CI uploads the npm package of commit `sha` as. */
export const artifactName = (sha) => `engine-npm-${sha}`;

/** The API path that lists commit `sha`'s artifacts, expired ones included. */
export const artifactsPath = (sha) => `${REPO}/actions/artifacts?name=${artifactName(sha)}&per_page=100`;

/**
 * Everything there is to pick. A part that fails leaves the others listed and says why in `errors`.
 * @param {Api} api
 * @returns {Promise<Listing>}
 */
export async function listEngineBuilds(api, now = Date.now) {
  const errors = [];
  const part = (promise, fallback) =>
    promise.catch((error) => {
      errors.push(error.message);
      return fallback;
    });
  const [releases, latest, pulls, branches] = await Promise.all([
    part(listReleases((url) => api(url.replace(/^https:\/\/api\.github\.com/, ""))), []),
    part(api(`${REPO}/releases/latest`), null),
    part(
      pages(api, `${REPO}/pulls?state=open&sort=updated&direction=desc`).then((open) =>
        Promise.all(
          open.map(async (pull) => ({
            number: pull.number,
            title: pull.title,
            author: pull.user?.login ?? "",
            draft: Boolean(pull.draft),
            updated: pull.updated_at,
            head: { label: pull.head.label, sha: pull.head.sha },
            build: await buildOf(api, pull.head.sha),
          })),
        ),
      ),
      [],
    ),
    part(pages(api, `${REPO}/branches`).then((all) => all.map((b) => ({ name: b.name, sha: b.commit.sha }))), []),
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
 * The commit a release tag, branch or pull request (`pull/<n>/head`) names now.
 * @param {Api} api
 */
export async function commitOf(api, ref) {
  const pr = ref.match(/^pull\/(\d+)\/head$/);
  if (pr) {
    const pull = await api(`${REPO}/pulls/${pr[1]}`);
    if (!pull) throw new Error(`${ENGINE_REPO} has no pull request #${pr[1]}`);
    return pull.head.sha;
  }
  const commit = await api(`${REPO}/commits/${encodeURIComponent(ref)}`);
  if (!commit) throw new Error(`${ENGINE_REPO} has no tag, branch or commit ${ref}`);
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

/** @returns {Promise<BuildState>} */
async function buildOf(api, sha) {
  const { artifacts = [] } = (await api(artifactsPath(sha))) ?? {};
  const newest = [...artifacts].sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
  const live = newest.find((a) => !a.expired);
  if (live) return { state: "available", expires: live.expires_at };
  if (newest.length) return { state: "expired", expires: newest[0].expires_at };
  return { state: "none" };
}
