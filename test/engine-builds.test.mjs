import { test } from "node:test";
import assert from "node:assert/strict";
import { engineBuilds, TTL_MS } from "../engine-builds.mjs";

const REPO = "https://api.github.com/repos/sidevoice/sidevoice-engine";
const TOKEN = "test-token";
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const asset = (name) => ({ name });
const routes = {
  [`${REPO}/releases?per_page=50`]: [
    { tag_name: "nightly", draft: false, prerelease: true, published_at: "2026-10-07T18:44:21Z", assets: [asset("sidevoice-engine-nightly.tgz")] },
    { tag_name: "v0.2.0", draft: false, prerelease: false, published_at: "2026-10-01T09:00:00Z", assets: [asset("sidevoice-engine-0.2.0.tgz")] },
    { tag_name: "v0.1.0", draft: false, prerelease: false, published_at: "2026-09-01T09:00:00Z", assets: [] },
  ],
  [`${REPO}/releases/latest`]: { tag_name: "v0.2.0", prerelease: false, published_at: "2026-10-01T09:00:00Z" },
  [`${REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100&page=1`]: [
    { number: 41, title: "feat(web)", user: { login: "rubasace" }, draft: false, updated_at: "2026-10-08T00:00:00Z", head: { label: "sidevoice:feat/web", sha: A } },
    { number: 37, title: "spike", user: { login: "rubasace" }, draft: true, updated_at: "2026-10-01T00:00:00Z", head: { label: "sidevoice:spike", sha: B } },
    { number: 13, title: "release", user: { login: "github-actions[bot]" }, draft: false, updated_at: "2026-09-30T00:00:00Z", head: { label: "sidevoice:rp", sha: C } },
  ],
  [`${REPO}/actions/artifacts?name=engine-npm-${A}&per_page=100`]: {
    artifacts: [
      { expired: true, expires_at: "2026-10-03T00:00:00Z" },
      { expired: false, expires_at: "2026-10-15T00:00:00Z" },
    ],
  },
  [`${REPO}/actions/artifacts?name=engine-npm-${B}&per_page=100`]: { artifacts: [{ expired: true, expires_at: "2026-10-08T00:00:00Z" }] },
  [`${REPO}/actions/artifacts?name=engine-npm-${C}&per_page=100`]: { artifacts: [] },
  [`${REPO}/branches?per_page=100&page=1`]: Array.from({ length: 100 }, (_, i) => ({ name: `b${i}`, commit: { sha: A } })),
  [`${REPO}/branches?per_page=100&page=2`]: [{ name: "main", commit: { sha: B } }],
};

function github(answers = routes) {
  const calls = [];
  const fetch = async (url, { headers } = {}) => {
    calls.push(url);
    assert.equal(headers?.authorization, `Bearer ${TOKEN}`, url);
    const body = answers[url];
    if (body === undefined) return new Response("", { status: 404 });
    if (body instanceof Response) return body;
    return Response.json(body);
  };
  return { fetch, calls };
}

test("the listing: releases with a web build and the newest, open pull requests with their build's state, branches", async () => {
  const { fetch } = github();
  const listing = await engineBuilds({ token: TOKEN, fetch, now: () => Date.parse("2026-10-09T12:00:00Z") }).get();
  assert.equal(listing.listed, "2026-10-09T12:00:00.000Z");
  assert.deepEqual(listing.errors, []);
  assert.deepEqual(listing.releases.map((r) => r.tag), ["nightly", "v0.2.0"]);
  assert.deepEqual(listing.latest, { tag: "v0.2.0", prerelease: false, published: "2026-10-01T09:00:00Z" });
  assert.deepEqual(listing.pulls[0], {
    number: 41, title: "feat(web)", author: "rubasace", draft: false, updated: "2026-10-08T00:00:00Z",
    head: { label: "sidevoice:feat/web", sha: A }, build: { state: "available", expires: "2026-10-15T00:00:00Z" },
  });
  assert.deepEqual(listing.pulls[1].build, { state: "expired", expires: "2026-10-08T00:00:00Z" });
  assert.deepEqual(listing.pulls[2].build, { state: "none" });
  assert.equal(listing.branches.length, 101);
  assert.deepEqual(listing.branches.at(-1), { name: "main", sha: B });
  assert.ok(!JSON.stringify(listing).includes(TOKEN));
});

test("a listing is kept TTL_MS, unless a fresh one is asked for", async () => {
  const { fetch, calls } = github();
  let clock = 0;
  const builds = engineBuilds({ token: TOKEN, fetch, now: () => clock });
  await Promise.all([builds.get(), builds.get()]);
  const once = calls.length;
  clock = TTL_MS - 1;
  await builds.get();
  assert.equal(calls.length, once);
  await builds.get({ fresh: true });
  assert.equal(calls.length, 2 * once);
  clock = 2 * TTL_MS;
  await builds.get();
  assert.equal(calls.length, 3 * once);
});

test("what fails is said, what does not is listed, and a listing with errors is not kept", async () => {
  const { fetch, calls } = github({ ...routes, [`${REPO}/branches?per_page=100&page=1`]: new Response("", { status: 500 }) });
  const builds = engineBuilds({ token: TOKEN, fetch, now: () => 0 });
  const listing = await builds.get();
  assert.deepEqual(listing.errors, ["GitHub API /repos/sidevoice/sidevoice-engine/branches: HTTP 500"]);
  assert.deepEqual(listing.branches, []);
  assert.equal(listing.pulls.length, 3);
  const once = calls.length;
  await builds.get();
  assert.ok(calls.length > once);
});

test("without a token nothing is asked of GitHub, and the listing says why", async () => {
  const { fetch, calls } = github();
  const listing = await engineBuilds({ token: null, fetch }).get();
  assert.equal(calls.length, 0);
  assert.equal(listing.errors.length, 1);
  assert.match(listing.errors[0], /no GitHub token/);
});

test("a commit by the name of a tag, a branch or a pull request; GitHub's API without a token says its limit", async () => {
  const { commitOf, publicApi } = await import("../web/engine/listing.mjs");
  const api = async (path) =>
    ({
      "/repos/sidevoice/sidevoice-engine/pulls/41": { head: { sha: A } },
      "/repos/sidevoice/sidevoice-engine/commits/nightly": { sha: B },
    })[path] ?? null;
  assert.equal(await commitOf(api, "pull/41/head"), A);
  assert.equal(await commitOf(api, "nightly"), B);
  await assert.rejects(commitOf(api, "v9.9.9"), /no tag, branch or commit v9.9.9/);

  const seen = [];
  const fetch = async (url, { headers }) => {
    seen.push(url);
    assert.equal(headers.authorization, undefined);
    return url.endsWith("/limited") ? new Response("", { status: 403 }) : Response.json({ ok: 1 });
  };
  assert.deepEqual(await publicApi(fetch)("/repos/x"), { ok: 1 });
  assert.equal(seen[0], "https://api.github.com/repos/x");
  await assert.rejects(publicApi(fetch)("/limited"), /HTTP 403 \(the hourly limit without a token\?\)/);
});

test("a pull request whose head has no build yet offers its newest earlier commit that has one", async () => {
  const [D, E, F] = ["d", "e", "f"].map((c) => c.repeat(40));
  const live = { artifacts: [{ expired: false, expires_at: "2026-10-16T00:00:00Z" }] };
  const answers = {
    ...routes,
    // #13's head is C (no build). Its commits, oldest first: F (built), E (expired), D (no build), then C.
    [`${REPO}/pulls/13/commits?per_page=100&page=1`]: [F, E, D, C].map((sha) => ({ sha })),
    [`${REPO}/actions/artifacts?name=engine-npm-${D}&per_page=100`]: { artifacts: [] },
    [`${REPO}/actions/artifacts?name=engine-npm-${E}&per_page=100`]: { artifacts: [{ expired: true, expires_at: "2026-10-01T00:00:00Z" }] },
    [`${REPO}/actions/artifacts?name=engine-npm-${F}&per_page=100`]: live,
  };
  const { fetch, calls } = github(answers);
  const listing = await engineBuilds({ token: TOKEN, fetch }).get();
  const [built, expiredOnly, building] = listing.pulls;
  assert.equal(built.fallback, undefined, "a head with its build needs none");
  assert.ok(!calls.includes(`${REPO}/pulls/41/commits?per_page=100&page=1`), "nor looks for one");
  assert.equal(expiredOnly.fallback, undefined, "no commit of #37 has a build: as before");
  assert.deepEqual(building.build, { state: "none" });
  assert.deepEqual(building.fallback, { sha: F, behind: 3, expires: "2026-10-16T00:00:00Z" });

  // Once the head's own build is there, it is the one.
  const ready = await engineBuilds({
    token: TOKEN,
    fetch: github({ ...answers, [`${REPO}/actions/artifacts?name=engine-npm-${C}&per_page=100`]: live }).fetch,
  }).get();
  assert.deepEqual(ready.pulls[2].build, { state: "available", expires: "2026-10-16T00:00:00Z" });
  assert.equal(ready.pulls[2].fallback, undefined);
});
