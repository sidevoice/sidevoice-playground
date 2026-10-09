import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RefError } from "../refs.mjs";
import { releaseBuilds } from "../release-builds.mjs";

const DOWNLOAD = "https://github.com/sidevoice/sidevoice-engine/releases/download";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytes = (text) => new TextEncoder().encode(text);

/** GitHub's release downloads, `assets` by URL; `latest` is the API's newest release. */
function github(assets, latest = null) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const body = assets[url];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body);
  };
  const api = async (path) => (path.endsWith("/releases/latest") ? latest : null);
  return { fetch, api, calls };
}

function release(tag, asset, tarball, listed = sha256(tarball)) {
  return {
    [`${DOWNLOAD}/${tag}/${asset}`]: tarball,
    [`${DOWNLOAD}/${tag}/SHA256SUMS`]: bytes(`${listed}  ${asset}\n`),
  };
}

function installer() {
  const installs = [];
  const install = async (path, options) => {
    installs.push({ bytes: await readFile(path), ...options });
    return { ...options, version: "0.2.0", site: "/scratch", entry: `${options.prefix}node_modules/x.js`, imports: {} };
  };
  return { install, installs };
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof RefError, String(error));
    return error;
  }
  assert.fail("it did not fail");
}

test("a release's tarball, checked against its SHA256SUMS, installed once and served under its digest", async () => {
  const tarball = bytes("the v0.2.0 package");
  const { fetch, api, calls } = github(release("v0.2.0", "sidevoice-engine-0.2.0.tgz", tarball), { tag_name: "v0.2.0" });
  const { install, installs } = installer();
  const builds = releaseBuilds({ api, fetch, install });

  const build = await builds.get("0.2.0");
  const digest = sha256(tarball);
  assert.equal(build.label, "v0.2.0");
  assert.equal(build.tag, "v0.2.0");
  assert.equal(build.prefix, `/engines/${digest}/`);
  assert.equal(build.sha256, digest);
  assert.equal(build.verified, true);
  assert.deepEqual([...installs[0].bytes], [...tarball]);
  assert.equal(builds.installed(digest).tag, "v0.2.0");
  assert.equal(builds.all().length, 1);

  // `latest` names the same release: the same tarball, not downloaded or installed again.
  const latest = await builds.get("latest");
  assert.equal(latest.label, "latest (v0.2.0)");
  assert.equal(installs.length, 1);
  assert.equal(calls.filter((url) => url.endsWith(".tgz")).length, 1);
});

test("a nightly is told apart by its digest, and a new one is installed beside the old", async () => {
  const assets = release("nightly", "sidevoice-engine-nightly.tgz", bytes("monday"));
  const { fetch, api } = github(assets);
  const { install, installs } = installer();
  const builds = releaseBuilds({ api, fetch, install });
  const monday = await builds.get("nightly");
  assert.equal(monday.label, `nightly (${sha256(bytes("monday")).slice(0, 7)})`);

  Object.assign(assets, release("nightly", "sidevoice-engine-nightly.tgz", bytes("tuesday")));
  const tuesday = await builds.get("nightly");
  assert.notEqual(tuesday.prefix, monday.prefix);
  assert.equal(installs.length, 2);
  assert.equal(builds.all().length, 2);
});

test("a tarball that does not match SHA256SUMS is refused before it is installed", async () => {
  const { fetch, api } = github(release("v0.2.0", "sidevoice-engine-0.2.0.tgz", bytes("tampered"), "0".repeat(64)));
  const { install, installs } = installer();
  const error = await failure(releaseBuilds({ api, fetch, install }).get("v0.2.0"));
  assert.equal(error.status, 502);
  assert.match(error.message, /SHA256SUMS says 0000/);
  assert.equal(installs.length, 0);
});

test("what is not a published release with a web build says so", async () => {
  const { fetch, api } = github({});
  const builds = releaseBuilds({ api, fetch, install: installer().install });
  assert.match((await failure(builds.get("v9.9.9"))).message, /a draft is not published yet/);
  assert.equal((await failure(builds.get("latest"))).status, 404);
  assert.equal((await failure(builds.get("#41"))).status, 400);
  assert.equal((await failure(builds.get("not a name!"))).status, 400);
  const listless = github({ [`${DOWNLOAD}/v0.2.0/SHA256SUMS`]: bytes(`${"a".repeat(64)}  other.tgz\n`) });
  const error = await failure(releaseBuilds({ ...listless, install: installer().install }).get("v0.2.0"));
  assert.match(error.message, /lists no sidevoice-engine-0.2.0.tgz/);
});
