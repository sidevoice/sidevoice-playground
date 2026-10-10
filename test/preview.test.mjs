import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveChoices, buildChoices, webChoices } from "../web/preview/choices.mjs";
import { listArchives, sumFor, versionOf } from "../preview/archives.mjs";
import { listWeb, validStart } from "../preview/index.mjs";
import { coreRoute, resetPage, sitePath } from "../preview/proxy.mjs";
import { connectorEnv, coreLaunch, loadScenarios, profileOf, runs, validScenario } from "../preview/runs.mjs";
import { ourPins, plannedPins } from "../preview/web-build.mjs";

test("the web picker puts main first, then releases, pull requests and branches", () => {
  const choices = webChoices({
    releases: [{ tag: "v0.3.0", prerelease: true }],
    pulls: [{ number: 63, title: "Voice API", draft: false, sha: "4349ed8aaaa" }],
    branches: [{ name: "feat/x", sha: "1111111bbbb" }, { name: "main", sha: "463bc42cccc" }],
  });
  assert.deepEqual(choices.map((c) => c.value), ["main", "v0.3.0", "pull/63/head", "feat/x"]);
  assert.equal(choices[0].label, "main @ 463bc42");
});

test("an archive picker puts the preferred release first", () => {
  const releases = [{ tag: "nightly" }, { tag: "v0.7.1" }, { tag: "v0.7.0" }];
  assert.deepEqual(archiveChoices(releases, "nightly").map((c) => c.value), ["nightly", "v0.7.1", "v0.7.0"]);
  assert.deepEqual(archiveChoices(releases, "release").map((c) => c.value), ["v0.7.1", "nightly", "v0.7.0"]);
  assert.deepEqual(archiveChoices([], "release"), []);
});

test("a build picker offers none, and only pull requests with a build", () => {
  assert.deepEqual(buildChoices(null), [{ value: "", label: "none" }]);
  const choices = buildChoices({
    releases: [{ tag: "v0.1.0" }],
    pulls: [{ number: 2, title: "a", build: { state: "available" } }, { number: 3, title: "b", build: { state: "running" } }],
    branches: [{ name: "main", sha: "abcdef0123" }],
  });
  assert.deepEqual(choices.map((c) => c.value), ["", "v0.1.0", "pull/2/head", "main"]);
});

test("archives: versions, sums and what is listed", async () => {
  assert.equal(versionOf("nightly"), "nightly");
  assert.equal(versionOf("v0.7.1"), "0.7.1");
  const digest = "a".repeat(64);
  assert.equal(sumFor(`${digest}  x.tar.zst\n${"b".repeat(64)} *y.tar.zst\n`, "x.tar.zst"), digest);
  assert.equal(sumFor(`${"b".repeat(64)} *y.tar.zst`, "y.tar.zst"), "b".repeat(64));
  assert.equal(sumFor("nonsense x.tar.zst", "x.tar.zst"), null);
  const api = async () => [
    { tag_name: "nightly", draft: false, prerelease: true, assets: [{ name: "sidevoice-core-nightly-linux-x86_64.tar.zst" }] },
    { tag_name: "v0.2.1", draft: false, prerelease: false, assets: [{ name: "sidevoice-core-0.2.1-darwin-arm64.tar.zst" }] },
    { tag_name: "v0.3.0", draft: true, prerelease: false, assets: [{ name: "sidevoice-core-0.3.0-linux-x86_64.tar.zst" }] },
  ];
  assert.deepEqual((await listArchives(api, "core")).map((r) => r.tag), ["nightly"]);
});

test("web builds replace only the pins npm lacks, and say which have no build picked", async () => {
  const manifest = { dependencies: { "@sidevoice/voice": "0.1.0", "@sidevoice/engine": "0.4.0", "@sidevoice/ui": "*", react: "19" } };
  const pins = ourPins(manifest, ["@sidevoice/ui"]);
  assert.deepEqual(pins.map(([name]) => name), ["@sidevoice/voice", "@sidevoice/engine"]);
  const published = async (name) => name === "@sidevoice/engine";
  assert.deepEqual(await plannedPins(pins, published, { voice: "/c/voice.tgz" }), {
    replace: { "@sidevoice/voice": "file:/c/voice.tgz" },
    missing: [],
  });
  assert.deepEqual(await plannedPins(pins, published, {}), { replace: {}, missing: ["@sidevoice/voice@0.1.0"] });
});

test("a start names a web, a core, a connector and a known scenario", () => {
  const scenarios = [{ id: "fresh-install" }];
  const pick = validStart({ web: "pull/63/head", core: "nightly", connector: "v0.7.1", engine: null, scenario: "fresh-install" }, scenarios);
  assert.equal(pick.scenario, scenarios[0]);
  assert.throws(() => validStart({ web: "../x", core: "nightly", connector: "v0.7.1", scenario: "fresh-install" }, scenarios), /web/);
  assert.throws(() => validStart({ web: "main", core: "a b", connector: "v0.7.1", scenario: "fresh-install" }, scenarios), /core/);
  assert.throws(() => validStart({ web: "main", core: "nightly", connector: "v0.7.1", scenario: "nope" }, scenarios), /scenario/);
});

test("the web listing keeps releases that are not drafts", async () => {
  const api = async (path) =>
    path.includes("/releases") ? [{ tag_name: "v1", prerelease: false, draft: false }, { tag_name: "v2", draft: true }]
    : path.includes("/pulls") ? [{ number: 1, title: "t", draft: false, head: { sha: "s" } }]
    : [{ name: "main", commit: { sha: "m" } }];
  assert.deepEqual(await listWeb(api), {
    releases: [{ tag: "v1", prerelease: false }],
    pulls: [{ number: 1, title: "t", draft: false, sha: "s" }],
    branches: [{ name: "main", sha: "m" }],
  });
});

test("the scenarios shipped are valid, fresh install first", async () => {
  const scenarios = await loadScenarios();
  assert.deepEqual(scenarios.map((s) => [s.id, s.state]), [["fresh-install", "fresh"], ["paired", "kept"]]);
  assert.equal(validScenario({ id: "Bad id", title: "x", state: "fresh", steps: [] }), false);
});

test("the core answers the preview origin, and the connector runs in the profile", () => {
  const profile = profileOf("/c/profiles/p");
  const launch = coreLaunch("/c/core/bin/core", profile, "https://preview.example:8443");
  assert.deepEqual(launch.args.slice(0, 4), ["--data-dir", "/c/profiles/p/sidevoice/core", "--port", "0"]);
  assert.equal(launch.env.SIDEVOICE_ALLOWED_HOSTS, "preview.example:8443");
  assert.equal(launch.env.SIDEVOICE_ALLOWED_ORIGINS, "https://preview.example:8443");
  const env = connectorEnv(profile);
  assert.equal(env.SIDEVOICE_DATA_DIR, "/c/profiles/p/sidevoice");
  assert.equal(env.SIDEVOICE_SERVICE_MANAGER, "none");
  assert.equal(env.HOME, "/c/profiles/p/home");
});

test("the preview origin serves the site, its routes and nothing outside it", () => {
  assert.deepEqual(sitePath("/s", "/"), { redirect: "/voice/" });
  assert.deepEqual(sitePath("/s", "/voice/target.js"), { path: "/s/voice/target.js" });
  assert.deepEqual(sitePath("/s", "/voice/settings"), { path: "/s/voice/index.html", fallback: true });
  assert.deepEqual(sitePath("/s", "/%2e%2e/etc/passwd"), { forbidden: true });
  assert.ok(coreRoute("/api/rendezvous") && coreRoute("/api") && !coreRoute("/apix"));
  assert.match(resetPage("/voice/?a=1"), /location\.replace\("\/voice\/\?a=1"\)/);
});

/** A process that writes the core's ready file when spawned, and exits on SIGTERM. */
function fakeSpawn(calls, { port = 4321, answer = { ok: true, code: "ABCD-1234", expires_in: 600, reach: "local-only" } } = {}) {
  return (command, args, options) => {
    calls.push({ command, args, env: options.env });
    const child = new EventEmitter();
    child.exitCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      child.exitCode = 0;
      child.emit("exit", 0);
    };
    const ready = args[args.indexOf("--ready-file") + 1];
    if (args.includes("--ready-file")) writeFile(ready, JSON.stringify({ port }));
    else setImmediate(() => {
      child.stdout.emit("data", JSON.stringify(args[0] === "pair-device" ? answer : { ok: true }));
      child.emit("close", 0);
    });
    return child;
  };
}

test("a run starts the core in its scenario's profile, pairs through the connector, and stops both", async () => {
  const cache = await mkdtemp(join(tmpdir(), "preview-runs-"));
  try {
    const calls = [];
    const manager = runs({ cache, origin: "http://127.0.0.1:5175", spawnProcess: fakeSpawn(calls), wait: () => new Promise(setImmediate) });
    const fresh = { id: "fresh-install", title: "Fresh", state: "fresh", steps: [] };
    const kept = { id: "paired", title: "Paired", state: "kept", steps: [] };
    const archive = (tag, program) => ({ tag, program });
    // A fresh scenario's profile is emptied; a kept one's is not.
    const old = join(cache, "profiles/fresh-install/leftover");
    await mkdir(old, { recursive: true });
    const current = await manager.start({ scenario: fresh, web: { label: "main", site: "/s" }, core: archive("nightly", "core"), connector: archive("v0.7.1", "conn") });
    assert.equal(current.port, 4321);
    assert.equal(current.reset, true);
    assert.equal(await import("node:fs/promises").then((fs) => fs.stat(old).then(() => true, () => false)), false);
    manager.resetDone();
    assert.equal(manager.current.reset, false);

    assert.deepEqual(await manager.pairingCode(), { code: "ABCD-1234", expires_in: 600, reach: "local-only" });
    assert.deepEqual(calls.at(-1).args, ["pair-device", "--json"]);

    await manager.start({ scenario: kept, web: { label: "main", site: "/s" }, core: archive("nightly", "core"), connector: archive("v0.7.1", "conn") });
    assert.ok(calls.some((c) => c.args[0] === "service" && c.args[1] === "stop"), "the connector stops before the next run");
    assert.equal(manager.current.reset, false);
    assert.equal(await manager.kept(kept), false);
    await manager.stop();
    assert.equal(manager.current, null);
    await assert.rejects(manager.pairingCode(), /no preview is running/);
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
});
