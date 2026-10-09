// What engine builds exist to pick from, listed for the page by the server through the GitHub API with its token
// (refs.mjs's client). Kept for a short while, so opening the picker does not cost the token's rate limit each time.
// Only what the listing says reaches the page; the token does not.

import { githubApi } from "./refs.mjs";
import { listEngineBuilds } from "./web/engine/listing.mjs";

/** How long a listing is kept. */
export const TTL_MS = 60_000;

/**
 * The listing (web/engine/listing.mjs), kept TTL_MS (a listing that hit an error is not kept). `fetch` and `now` are
 * replaceable for tests.
 * @param {{ token: string | null, fetch?: typeof globalThis.fetch, now?: () => number }} options
 */
export function engineBuilds({ token, fetch = globalThis.fetch, now = Date.now }) {
  const { api } = githubApi({ token, fetch });
  let kept = null; // { at, listing: Promise<Listing> }

  return {
    /** The listing, from what is kept unless it is older than TTL_MS or `fresh` asks for a new one. */
    async get({ fresh = false } = {}) {
      if (fresh || !kept || now() - kept.at >= TTL_MS) {
        const listing = listEngineBuilds(api, now);
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
