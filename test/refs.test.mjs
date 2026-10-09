import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RefError, refBuilds, validRef, VOICES_PREFIX } from "../refs.mjs";
import { VOICE } from "../web/sources.mjs";
import { zip } from "./zip-fixture.mjs";

const SHA = "efa1d6d42715ed713605fb009f72538e90c6cfc7";
const REPO = "https://api.github.com/repos/sidevoice/sidevoice-engine";
const TOKEN = "test-token";
const ARCHIVE = "https://api.github.com/artifact/1/zip";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A GitHub that answers `routes` (URL → JSON, or a Uint8Array for a download), checking the token on each call. */
function github(routes) {
  const calls = [];
  const fetch = async (url, { headers } = {}) => {
    calls.push(url);
    assert.equal(headers?.authorization, `Bearer ${TOKEN}`, url);
    const body = routes[url];
    if (body === undefined) return new Response("", { status: 404 });
    return body instanceof Uint8Array ? new Response(body) : Response.json(body);
  };
  return { fetch, calls };
}

const artifact = (over = {}) => ({
  name: `engine-npm-${SHA}`, expired: false, created_at: "2026-10-08T10:00:00Z",
  archive_download_url: ARCHIVE, workflow_run: { id: 7, head_sha: SHA }, ...over,
});
const run = (over = {}) => ({ id: 7, status: "completed", conclusion: "success", html_url: "https://github.com/run/7", ...over });
const artifacts = (...list) => ({ [`${REPO}/actions/artifacts?name=engine-npm-${SHA}&per_page=100`]: { artifacts: list } });
const runs = (...list) => ({ [`${REPO}/actions/runs?head_sha=${SHA}&per_page=20`]: { workflow_runs: list } });
const pr = { [`${REPO}/pulls/41`]: { head: { sha: SHA } } };

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof RefError, String(error));
    return error;
  }
  assert.fail("it did not fail");
}

test("refs are pull requests, branches and commits, nothing that climbs out of the API path", () => {
  for (const ref of ["pull/41/head", "feat/web", SHA, "efa1d6d"]) assert.ok(validRef(ref), ref);
  for (const ref of ["../x", "/abs", "a b", "feat/", null, "x?y=1"]) assert.ok(!validRef(ref), String(ref));
});

test("a pull request's build: its head commit's artifact, checked against its digest, unzipped and installed", async () => {
  const tarball = new TextEncoder().encode("the npm package");
  const archive = zip({ "sidevoice-engine-0.1.0.tgz": tarball });
  const { fetch, calls } = github({
    ...pr, ...artifacts(artifact({ digest: `sha256:${sha256(archive)}` })),
    [`${REPO}/actions/runs/7`]: run(), [ARCHIVE]: archive,
    [`${REPO}/commits/${SHA}`]: { sha: SHA },
  });
  const installs = [];
  const install = async (path, options) => {
    installs.push({ bytes: await readFile(path), ...options });
    return { ...options, version: "0.1.0", site: "/scratch", entry: `${options.prefix}node_modules/x.js`, imports: {} };
  };
  const builds = refBuilds({ token: TOKEN, fetch, install });

  const build = await builds.get("pull/41/head");
  assert.equal(build.label, "#41 @ efa1d6d");
  assert.equal(build.sha, SHA);
  assert.equal(build.prefix, `/engines/${SHA}/`);
  assert.equal(build.sha256, sha256(tarball));
  assert.equal(build.verified, true);
  assert.deepEqual([...installs[0].bytes], [...tarball]);
  assert.equal(builds.installed(SHA).sha, SHA);
  assert.equal(builds.all().length, 1);

  // Asked again, by another name for the same commit: downloaded and installed once.
  const commit = await builds.get(SHA);
  assert.equal(commit.label, "efa1d6d");
  assert.equal(installs.length, 1);
  assert.equal(calls.filter((url) => url === ARCHIVE).length, 1);
});

test("a download that does not match the artifact's digest is refused", async () => {
  const archive = zip({ "sidevoice-engine-0.1.0.tgz": "x" });
  const { fetch } = github({ ...pr, ...artifacts(artifact({ digest: `sha256:${"0".repeat(64)}` })), [`${REPO}/actions/runs/7`]: run(), [ARCHIVE]: archive });
  const error = await failure(refBuilds({ token: TOKEN, fetch, install: assert.fail }).get("pull/41/head"));
  assert.equal(error.status, 502);
  assert.match(error.message, /digest says 0{64}/);
});

test("no build yet, expired, or failed: each says so", async () => {
  const cases = [
    [{ ...artifacts(), ...runs() }, 404, /no CI run for efa1d6d yet/],
    [{ ...artifacts(), ...runs(run({ status: "in_progress", conclusion: null })) }, 409, /still running \(https:\/\/github.com\/run\/7\)/],
    [{ ...artifacts(), ...runs(run({ conclusion: "failure" })) }, 409, /its CI run ended failure/],
    [{ ...artifacts(), ...runs(run()) }, 404, /uploaded no engine-npm-efa1d6d/],
    [{ ...artifacts(artifact({ expired: true })) }, 410, /has expired \(CI keeps it 7 days\)/],
    [{ ...artifacts(artifact()), [`${REPO}/actions/runs/7`]: run({ conclusion: "failure" }) }, 409, /its CI run ended failure/],
  ];
  for (const [routes, status, message] of cases) {
    const { fetch } = github({ ...pr, ...routes });
    const error = await failure(refBuilds({ token: TOKEN, fetch, install: assert.fail }).get("pull/41/head"));
    assert.equal(error.status, status, error.message);
    assert.match(error.message, message);
  }
});

test("unknown refs, bad refs and a missing token are refused before anything is downloaded", async () => {
  const { fetch } = github({});
  assert.equal((await failure(refBuilds({ token: TOKEN, fetch }).get("pull/999/head"))).status, 404);
  assert.match((await failure(refBuilds({ token: TOKEN, fetch }).get("no-such-branch"))).message, /no branch or commit no-such-branch/);
  assert.equal((await failure(refBuilds({ token: TOKEN, fetch }).get("../etc"))).status, 400);
  assert.equal((await failure(refBuilds({ token: null, fetch }).get("feat/web"))).status, 503);
});

test("the voice module's builds: its own repository's `voice-npm-<sha>` artifacts, served under /voices/", async () => {
  const VOICE_REPO = "https://api.github.com/repos/sidevoice/sidevoice-voice";
  const tarball = new TextEncoder().encode("the voice package");
  const archive = zip({ "sidevoice-voice-0.1.0.tgz": tarball });
  const { fetch } = github({
    [`${VOICE_REPO}/pulls/7`]: { head: { sha: SHA } },
    [`${VOICE_REPO}/actions/artifacts?name=voice-npm-${SHA}&per_page=100`]: {
      artifacts: [artifact({ name: `voice-npm-${SHA}`, digest: `sha256:${sha256(archive)}` })],
    },
    [`${VOICE_REPO}/actions/runs/7`]: run(), [ARCHIVE]: archive,
    [`${VOICE_REPO}/commits/${SHA}`]: { sha: SHA },
  });
  const install = async (path, options) => ({ ...options, version: "0.1.0", site: "/scratch", entry: "x.js", imports: {} });
  const builds = refBuilds({ token: TOKEN, fetch, install, source: VOICE, prefix: VOICES_PREFIX });

  const build = await builds.get("pull/7/head");
  assert.equal(build.sha, SHA);
  assert.equal(build.prefix, `/voices/${SHA}/`);
  assert.equal(build.sha256, sha256(tarball));
});
