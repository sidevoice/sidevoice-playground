// The card's "Updates elsewhere": this computer's Sidevoice and the first paired machine, behind or current, in every
// scenario, as the page reads them (the bridge's `version()`, a machine's `GET /api/host/status`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import {
  SERVICE_VERSION, UPDATE_COMMAND, answer, directUrl, firstPaired, hostStatus, makeIdentities, mintCode, nextMinor, remoteBehind, setRemoteBehind,
} from "../preview/mock/machines.mjs";
import { LOCAL_VERSION, desktopHost, localBehind, setLocalBehind } from "../preview/mock/bridge.mjs";
import { localUpdateLine, remoteUpdateLine } from "../preview/mock/card.mjs";

const PAGE = "https://preview.example";
const instant = { tick: () => new Promise((r) => setImmediate(r)) };

async function setup(scenario) {
  const world = createWorld(scenario, {}, instant);
  const identities = await makeIdentities(world.state);
  /** Machine `id`'s status, asked as the page asks it: directly, with this device's token. */
  const status = async (id) => (await answer(world, identities, {
    pageOrigin: PAGE, url: `${directUrl(id)}/api/host/status`, headers: { authorization: `Bearer ${identities[id].token}` },
  })).body;
  return { world, identities, status };
}

test("a version a minor on", () => {
  assert.equal(nextMinor("0.3.0"), "0.4.0");
  assert.equal(nextMinor("0.8.1"), "0.9.0");
  assert.equal(nextMinor("1.12.3-beta.1"), "1.13.0");
  assert.equal(nextMinor(null), "0.9.0", "none said counts from the service's version");
  assert.equal(nextMinor(LOCAL_VERSION), "0.9.0");
  assert.equal(nextMinor(SERVICE_VERSION), "0.9.0", "this computer's service and every machine's count alike");
});

test("a machine behind names the documented update command, never a placeholder", () => {
  // The connector's README: `npx sidevoice install` installs or updates; @latest, the newest package rather than a cached one.
  assert.equal(UPDATE_COMMAND, "npx sidevoice@latest install");
  assert.doesNotMatch(UPDATE_COMMAND, /#|mock/i);
});

test("this computer's Sidevoice is behind or current in every scenario, in the Desktop app view", async () => {
  for (const scenario of await loadMockScenarios()) {
    const { world, identities } = await setup(scenario);
    // The Desktop app view gives every scenario a local host: its own, or one not installed yet.
    const local = desktopHost(world, identities).localHost;
    const installed = world.state.local.version ?? LOCAL_VERSION;
    assert.equal(setLocalBehind(world, true), true, scenario.id);
    assert.equal(localBehind(world), true, scenario.id);
    const behind = await local.version();
    assert.equal(behind.update, "available", scenario.id);
    assert.equal(behind.bundled.version, nextMinor(installed), scenario.id);
    if (behind.installed) assert.equal(behind.installed.version, installed, scenario.id);
    assert.match(localUpdateLine(world), new RegExp(`behind: the app bundles ${nextMinor(installed).replaceAll(".", "\\.")}`), scenario.id);

    assert.equal(setLocalBehind(world, false), true, scenario.id);
    assert.equal(localBehind(world), false, scenario.id);
    const current = await local.version();
    assert.equal(current.update, "current", scenario.id);
    assert.equal(current.bundled.version, installed, scenario.id);
    assert.match(localUpdateLine(world), /, current \(/, scenario.id);
    assert.match(localUpdateLine(world, "browser"), /Seen in the Desktop app view only\.$/, scenario.id);
  }
});

test("updating this machine from the page leaves it current, and the card's toggle follows", async () => {
  const scenario = (await loadMockScenarios()).find((s) => s.id === "desktop-local-host");
  const { world, identities } = await setup(scenario);
  const local = desktopHost(world, identities).localHost;
  setLocalBehind(world, true);
  await local.update();
  assert.equal(localBehind(world), false);
  assert.deepEqual([(await local.version()).update, (await local.version()).installed.version], ["current", "0.9.0"]);
  assert.equal(local.state().core.version, "0.9.0");
  // One number for the service wherever it is said: its status's product version is the one installed.
  assert.equal(local.state().product_version, "0.9.0");
});

test("the card's line says a build offers no update of this computer's service only where the app has no updater", async () => {
  const scenario = (await loadMockScenarios()).find((s) => s.id === "desktop-local-host");
  const { world } = await setup(scenario);
  for (const channel of ["release", "nightly"]) {
    world.patch({ "app.channel": channel });
    assert.doesNotMatch(localUpdateLine(world), /offers no update/, channel);
  }
  world.patch({ "app.channel": "dev" });
  assert.match(localUpdateLine(world), /A dev build offers no update of it: pick a release or nightly build\.$/);
});

test("without a local host, the toggle makes none up", async () => {
  const scenario = (await loadMockScenarios()).find((s) => s.id === "paired-machines");
  const { world } = await setup(scenario);
  assert.equal(world.state.local ?? null, null, "the browser view of a scenario with no local host");
  assert.equal(setLocalBehind(world, true), false);
  assert.equal(world.state.local ?? null, null);
  assert.equal(localBehind(world), false);
  assert.match(localUpdateLine(world), /^No Sidevoice on this computer here/);
});

test("the first paired machine's status says it is behind, with the latest and the mock command, in every scenario", async () => {
  for (const scenario of await loadMockScenarios()) {
    const { world, identities, status } = await setup(scenario);
    let id = firstPaired(world.state);
    if (!id) {
      // A scenario that pairs none: the person pairs one in the page, with a code; then it is the first paired.
      const target = Object.keys(world.state.machines)[0];
      const secret = JSON.parse(Buffer.from(mintCode(world, identities, target).slice(4), "base64url")).secret;
      const paired = await answer(world, identities, {
        pageOrigin: PAGE, method: "POST", url: `${directUrl(target)}/api/device/pair`, body: JSON.stringify({ secret, name: "Mac de Ana" }),
      });
      assert.equal(paired.status, 200, scenario.id);
      id = firstPaired(world.state);
      assert.equal(id, target, scenario.id);
    }
    const version = world.state.machines[id].productVersion ?? null;
    assert.deepEqual(await status(id), { version }, `${scenario.id}: current as written`);
    assert.equal(remoteBehind(world), false, scenario.id);

    assert.equal(setRemoteBehind(world, true), id, scenario.id);
    assert.equal(remoteBehind(world), true, scenario.id);
    assert.deepEqual(await status(id), { version, update: { latest: nextMinor(version), command: UPDATE_COMMAND } }, scenario.id);
    assert.match(remoteUpdateLine(world), new RegExp(`behind: ${nextMinor(version).replaceAll(".", "\\.")}`), scenario.id);
    // Only the first paired machine: the others answer as they did.
    for (const other of Object.keys(world.state.machines).filter((m) => m !== id)) {
      assert.equal(hostStatus(world.state.machines[other]).update, undefined, `${scenario.id}: ${other}`);
    }

    assert.equal(setRemoteBehind(world, false), id, scenario.id);
    assert.equal(remoteBehind(world), false, scenario.id);
    assert.deepEqual(await status(id), { version }, `${scenario.id}: current again`);
    assert.match(remoteUpdateLine(world), /, current\./, scenario.id);
  }
});

test("a machine that does not know its version is still behind, and the first paired one skips a revoked one", async () => {
  const scenario = {
    id: "s", title: "S", summary: "s", options: [],
    world: { machines: {
      pi: { host: "Pi", reach: "direct", paired: true, revoked: true, devices: [] },
      nuc: { host: "NUC", reach: "offline", paired: true, productVersion: null, devices: [] },
    } },
  };
  const { world } = await setup(scenario);
  assert.equal(firstPaired(world.state), "nuc");
  setRemoteBehind(world, true);
  assert.deepEqual(hostStatus(world.state.machines.nuc), { version: null, update: { latest: "0.9.0", command: UPDATE_COMMAND } });
  assert.match(remoteUpdateLine(world), /^NUC: no version, behind: 0\.9\.0\. It does not answer now/);
  world.patch({ "machines.nuc.revoked": true });
  assert.equal(firstPaired(world.state), null);
  assert.equal(setRemoteBehind(world, true), null);
  assert.match(remoteUpdateLine(world), /No machine is paired yet/);
});
