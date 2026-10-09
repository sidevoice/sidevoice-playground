// What engine builds exist to pick from, listed for the page by the server through the GitHub API with its token
// (refs.mjs's client): the releases that carry a web build and the newest one, the open pull requests with whether
// their head commit's CI build (`engine-npm-<sha>`) is there or has expired, and the branches. Kept for a short while,
// so opening the picker does not cost the token's rate limit each time. Only what the listing says reaches the page;
// the token does not.

import { artifactsPath, githubApi } from "./refs.mjs";
import { listReleases } from "./web/engine/load.mjs";
import { ENGINE_REPO } from "./web/engine/spec.mjs";

const REPO = `/repos/${ENGINE_REPO}`;
/** How long a listing is kept. */
export const TTL_MS = 60_000;
const PER_PAGE = 100;
const MAX_PAGES = 5;

/**
 * @typedef {{ tag: string, prerelease: boolean, published: string }} Release
 * @typedef {{ state: "available" | "expired" | "none", expires?: string }} BuildState
 * @typedef {{ number: number, title: string, author: string, draft: boolean, updated: string,
 *   head: { label: string, sha: string }, build: BuildState }} Pull
 * @typedef {{ name: string, sha: string }} Branch
 * @typedef {{ listed: string, releases: Release[], latest: Release | null, pulls: Pull[], branches: Branch[],
 *   errors: string[] }} Listing
 */

/**
 * The listing, kept TTL_MS (a listing that hit an error is not kept). `fetch` and `now` are replaceable for tests.
 * @param {{ token: string | null, fetch?: typeof globalThis.fetch, now?: () => number }} options
 */
export function engineBuilds({ token, fetch = globalThis.fetch, now = Date.now }) {
  const { api } = githubApi({ token, fetch });
  let kept = null; // { at, listing: Promise<Listing> }

  async function pages(path) {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const items = (await api(`${path}${path.includes("?") ? "&" : "?"}per_page=${PER_PAGE}&page=${page}`)) ?? [];
      all.push(...items);
      if (items.length < PER_PAGE) break;
    }
    return all;
  }

  /** @returns {Promise<BuildState>} */
  async function buildOf(sha) {
    const { artifacts = [] } = (await api(artifactsPath(sha))) ?? {};
    const newest = [...artifacts].sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)));
    const live = newest.find((a) => !a.expired);
    if (live) return { state: "available", expires: live.expires_at };
    if (newest.length) return { state: "expired", expires: newest[0].expires_at };
    return { state: "none" };
  }

  async function list() {
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
        pages(`${REPO}/pulls?state=open&sort=updated&direction=desc`).then((open) =>
          Promise.all(
            open.map(async (pull) => ({
              number: pull.number,
              title: pull.title,
              author: pull.user?.login ?? "",
              draft: Boolean(pull.draft),
              updated: pull.updated_at,
              head: { label: pull.head.label, sha: pull.head.sha },
              build: await buildOf(pull.head.sha),
            })),
          ),
        ),
        [],
      ),
      part(pages(`${REPO}/branches`).then((all) => all.map((b) => ({ name: b.name, sha: b.commit.sha }))), []),
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

  return {
    /** The listing, from what is kept unless it is older than TTL_MS or `fresh` asks for a new one. */
    async get({ fresh = false } = {}) {
      if (fresh || !kept || now() - kept.at >= TTL_MS) {
        const listing = list();
        kept = { at: now(), listing };
        listing.then(
          (result) => result.errors.length && kept?.listing === listing && (kept = null),
          () => kept?.listing === listing && (kept = null),
        );
      }
      return kept.listing;
    },
  };
}
