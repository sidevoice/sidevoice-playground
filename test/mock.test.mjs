import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockFile, loadMockScenarios } from "../preview/proxy.mjs";
import { changedCount, choicesFor, createWorld, deepSet, stateFor, validMockScenario } from "../preview/mock/world.mjs";
import {
  LOCAL_ID, LOCAL_URL, ROOM_URL, agentRows, agentsOf, answer, directUrl, makeIdentities, mintCode, placeOf, seededStorage,
} from "../preview/mock/machines.mjs";
import { desktopHost, localStatus } from "../preview/mock/bridge.mjs";
import { readParams, writeParams } from "../preview/mock/shell.mjs";

const PAGE = "https://preview.example";
const nonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const instant = { tick: () => new Promise((r) => setImmediate(r)) };

const scenario = {
  id: "s", title: "S", summary: "s",
  world: {
    page: "room",
    machines: {
      nuc: { host: "NUC", reach: "direct", paired: true, inUse: true, devices: [], participants: [{ title: "Claude", reach: "listening" }] },
      ws: { host: "WS", reach: "room", paired: false, devices: [], participants: [] },
    },
    local: { computerName: "Mac", state: "absent", installed: false, reach: "local-only", install: "ok" },
  },
  options: [
    { id: "nucReach", label: "NUC", group: "M", values: [
      { value: "direct", label: "d", set: { "machines.nuc.reach": "direct" } },
      { value: "offline", label: "o", set: { "machines.nuc.reach": "offline" } },
    ] },
    { id: "inUse", label: "In use", group: "M", reload: true, values: [
      { value: "nuc", label: "n", set: { "machines.nuc.inUse": true } },
      { value: "none", label: "-", set: { "machines.nuc.inUse": false } },
    ] },
  ],
};

async function setup(chosen = {}) {
  const world = createWorld(scenario, chosen, instant);
  const identities = await makeIdentities(world.state);
  const ask = (url, init = {}) => answer(world, identities, { pageOrigin: PAGE, url, ...init });
  return { world, identities, ask };
}

test("a world is its scenario with the chosen values set over it", () => {
  const target = {};
  deepSet(target, "a.b.c", [1]);
  assert.deepEqual(target, { a: { b: { c: [1] } } });
  assert.deepEqual(choicesFor(scenario, { nucReach: "offline", inUse: "nope" }), { nucReach: "offline", inUse: "nuc" });
  assert.equal(stateFor(scenario, choicesFor(scenario, { nucReach: "offline" })).machines.nuc.reach, "offline");
  const world = createWorld(scenario, {}, instant);
  let heard = 0;
  world.subscribe(() => heard++);
  assert.equal(world.choose("nucReach", "offline"), false, "a live option");
  assert.equal(world.state.machines.nuc.reach, "offline");
  assert.equal(world.choose("inUse", "none"), true, "a reload option");
  assert.equal(world.choose("inUse", "unknown"), false);
  assert.equal(heard, 2);
  assert.equal(changedCount(scenario, world.choices), 2);
});

test("a world's delays follow its speed, and hold at 0", async () => {
  let ticked = 0;
  const world = createWorld(scenario, {}, { tick: () => new Promise((r) => setImmediate(() => r(ticked++))) });
  world.speed = 4;
  await world.delay(400);
  assert.equal(ticked, 2, "400 ms at ×4: two steps of 50 ms");
  world.speed = 0;
  const held = world.delay(100);
  await new Promise((r) => setTimeout(r, 20));
  const before = ticked;
  world.speed = 1;
  await held;
  assert.ok(before > 2 && ticked > before);
});

test("the page loads with the pairings the world says it has", async () => {
  const { world, identities } = await setup();
  const local = seededStorage(world.state, identities, Date.parse("2026-10-11T00:00:00Z"));
  const stored = JSON.parse(local["sidevoice.pairings"]);
  assert.equal(stored.in_use, identities.nuc.fingerprint);
  assert.deepEqual(stored.pairings.map((p) => p.host), ["NUC"]);
  assert.deepEqual(stored.pairings[0].urls, [directUrl("nuc")]);
  assert.deepEqual(stored.pairings[0].rv, { url: ROOM_URL, node: "nuc" });
  assert.equal(local["sidevoice.local-host-selected"], undefined);
  world.state.local.inUse = true;
  world.state.language = "en";
  const desktop = seededStorage(world.state, identities, 0, { desktop: true });
  assert.equal(JSON.parse(desktop["sidevoice.pairings"]).in_use, identities[LOCAL_ID].fingerprint);
  assert.equal(desktop["sidevoice.local-host-selected"], "true");
  assert.equal(desktop["sidevoice.settings"], '{"ui_language":"en"}');
});

test("a world whose first-run setup is done opens the page on the room; any other leaves the setup to run", async () => {
  const { world, identities } = await setup();
  const now = Date.parse("2026-10-11T00:00:00Z");
  assert.equal(seededStorage(world.state, identities, now)["sidevoice.onboarding"], undefined);
  world.state.setup = "done";
  const record = JSON.parse(seededStorage(world.state, identities, now)["sidevoice.onboarding"]);
  assert.equal(record.version, 1);
  assert.equal(record.agents_done, true);
  assert.ok(record.completed_at > 0 && record.completed_at < now);
  // Done on the release before this one: what came since is new.
  world.state.setup = "earlier";
  const earlier = JSON.parse(seededStorage(world.state, identities, now)["sidevoice.onboarding"]);
  assert.equal(earlier.baseline_release, record.baseline_release - 1);
  assert.ok(earlier.baseline_release > 0);
});

test("addresses: a machine directly, through the room (its own origin or the page's), the local host", () => {
  assert.deepEqual(placeOf(`${directUrl("nuc")}/api/x?a=1`, PAGE), { id: "nuc", via: "direct", path: "/api/x", query: "?a=1" });
  assert.deepEqual(placeOf(`${ROOM_URL}/nodes/nuc/api/x`, PAGE), { id: "nuc", via: "room", path: "/api/x", query: "" });
  assert.deepEqual(placeOf("/nodes/nuc/api/x", PAGE), { id: "nuc", via: "room", path: "/api/x", query: "", onPage: true });
  assert.equal(placeOf(`${LOCAL_URL}/api/x`, PAGE).id, LOCAL_ID);
  assert.deepEqual(placeOf("/api/rendezvous", PAGE), { page: true, path: "/api/rendezvous", query: "" });
  assert.equal(placeOf("https://elsewhere.example/api/x", PAGE), null);
  assert.equal(placeOf("http://nuc.machines.sidevoice.example/api/x", PAGE), null, "only https is a machine's address");
});

test("a machine proves its identity with a real signature, where the world lets it answer", async () => {
  const { world, identities, ask } = await setup();
  const asked = nonce();
  const proof = await ask(`${directUrl("nuc")}/api/device/identity?nonce=${asked}`);
  assert.equal(proof.status, 200);
  assert.equal(proof.body.public_key, identities.nuc.publicKey);
  const key = await crypto.subtle.importKey("spki", Buffer.from(proof.body.public_key, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.from(proof.body.signature, "base64url"),
    new TextEncoder().encode(`sidevoice-node-identity:${asked}`)));
  assert.equal((await ask(`${directUrl("nuc")}/api/device/identity?nonce=short`)).status, 400);
  // The workstation answers only through the room; an address that does not answer is no answer.
  assert.deepEqual(await ask(`${directUrl("ws")}/api/rendezvous`), { unreachable: true });
  assert.equal((await ask(`${ROOM_URL}/nodes/ws/api/rendezvous`)).status, 200);
  assert.equal((await ask("/nodes/ws/api/rendezvous")).status, 200, "the page a room serves relays too");
  world.choose("nucReach", "offline");
  assert.equal((await ask(`${ROOM_URL}/nodes/nuc/api/rendezvous`)).status, 503);
  assert.deepEqual((await ask(`${ROOM_URL}/api/rendezvous?nodes=nuc`)).body, { nodes: [{ id: "nuc", connected: false }] });
  world.patch({ "machines.nuc.reach": "away" });
  assert.deepEqual((await ask(`${ROOM_URL}/api/rendezvous?nodes=nuc`)).body, { nodes: [] });
  assert.deepEqual((await ask("/api/rendezvous")).body, { kind: "room" });
  world.patch({ page: "none" });
  assert.equal((await ask("/api/rendezvous")).status, 404);
});

test("codes: redeemed once, refused after, and an impostor answers with another key", async () => {
  const { world, identities, ask } = await setup();
  const decode = (code) => JSON.parse(Buffer.from(code.slice(4), "base64url"));
  const pair = (code) => ask(`${directUrl("ws")}/api/device/pair`.replace(directUrl("ws"), `${ROOM_URL}/nodes/ws`), {
    method: "POST", body: JSON.stringify({ secret: decode(code).secret, name: "Phone" }),
  });
  const code = mintCode(world, identities, "ws");
  const payload = decode(code);
  assert.equal(payload.v, 1);
  assert.equal(payload.fp, identities.ws.fingerprint);
  assert.ok(payload.exp > Date.now() / 1000);
  const paired = await pair(code);
  assert.equal(paired.status, 200);
  assert.equal(paired.body.token, identities.ws.token);
  assert.equal(paired.body.node.public_key, identities.ws.publicKey);
  assert.equal(world.state.machines.ws.devices.at(-1).name, "Phone");
  assert.equal((await pair(code)).status, 403);
  assert.equal((await pair(mintCode(world, identities, "ws", "used"))).status, 403);
  assert.notEqual((await pair(mintCode(world, identities, "ws", "impostor"))).body.node.public_key, identities.ws.publicKey);
  assert.ok(decode(mintCode(world, identities, "ws", "expired")).exp < Date.now() / 1000);
  assert.deepEqual(decode(mintCode(world, identities, "ws", "plaintext")).urls, ["http://192.168.1.20:8765"]);
  assert.throws(() => decode(mintCode(world, identities, "ws", "damaged")));
});

test("a machine's own routes take this device's token, and refuse it once revoked", async () => {
  const { world, identities, ask } = await setup();
  const auth = { headers: { authorization: `Bearer ${identities.nuc.token}` } };
  const base = directUrl("nuc");
  assert.equal((await ask(`${base}/api/presentation/participants`)).status, 401);
  const people = await ask(`${base}/api/presentation/participants`, auth);
  assert.deepEqual(people.body.participants[0], {
    thread_id: "nuc-thread-1", title: "Claude", harness: null, available: true, selected: false,
    machine: { id: "nuc-connector", host: "NUC" },
    capabilities: { deliver: "supported", inspectInbound: "supported", working: "supported", endOfTurn: "supported", sessionIdentity: "supported" },
    engine: null, route: null,
    reach: { state: "listening", detail: null, remedy: null },
  });
  assert.deepEqual((await ask(`${base}/api/presentation/history`, auth)).body, { messages: [] });
  assert.equal((await ask(`${base}/api/presentation/admission`, auth)).body.admitted, true);
  assert.equal((await ask(`${base}/api/presentation/latency`, auth)).status, 404);
  world.patch({ "machines.nuc.devices": [{ name: "Mac", mine: true }, { name: "iPhone", id: "phone" }] });
  const devices = (await ask(`${base}/api/device/devices`, auth)).body.devices;
  assert.deepEqual(devices.map((d) => [d.name, d.current]), [["Mac", true], ["iPhone", false]]);
  assert.equal((await ask(`${base}/api/device/devices/phone`, { method: "DELETE", ...auth })).status, 200);
  assert.equal(world.state.machines.nuc.devices.length, 1);
  world.patch({ "machines.nuc.revoked": true });
  assert.equal((await ask(`${base}/api/device/devices/phone`, { method: "PATCH", body: '{"name":"x"}', ...auth })).status, 401);
  assert.equal((await ask(`${base}/api/presentation`, auth)).status, 401);
});

test("a machine's agents are a scenario's rows over the connector's own, and what is done to them stays, here too", async () => {
  const { world, identities, ask } = await setup();
  const as = (id) => ({ headers: { authorization: `Bearer ${identities[id].token}` } });
  const agents = async (base, id) => (await ask(`${base}/api/host/agents`, as(id))).body.agents;
  const found = await agents(directUrl("nuc"), "nuc");
  assert.deepEqual(found.map((a) => [a.id, a.registration, a.actionable]),
    [["claude", "connected", false], ["codex", "not-connected", true], ["cursor", "not-connected", false]]);
  assert.ok(found.every((a) => a.label && a.connect && a.instructions && a.removal));
  world.patch({ "machines.nuc.agents": [{ id: "claude", registration: "foreign" }] });
  assert.deepEqual((await agents(directUrl("nuc"), "nuc")).map((a) => [a.id, a.label, a.registration, a.removal.command]),
    [["claude", "Claude Code", "foreign", "claude mcp remove --scope user sidevoice"]]);

  // This computer's host keeps them as a remote one does: its agents (the bridge's too) and its devices.
  world.patch({
    "local.state": "running", "local.agents": [{ id: "codex", registration: "not-connected", actionable: true }],
    "local.devices": [{ name: "App", kind: "local", mine: true }, { name: "Phone", id: "phone" }],
  });
  assert.equal((await ask(`${LOCAL_URL}/api/host/agents/codex/connect`, { method: "POST", ...as(LOCAL_ID) })).status, 200);
  assert.equal(world.state.local.agents[0].registration, "connected");
  // The page reads the local host's agents over its own route (the bridge has no agents()).
  assert.equal((await ask(`${LOCAL_URL}/api/host/agents`, as(LOCAL_ID))).body.agents[0].label, "Codex");
  assert.equal((await ask(`${LOCAL_URL}/api/device/devices/phone`, { method: "DELETE", ...as(LOCAL_ID) })).status, 200);
  assert.deepEqual(world.state.local.devices.map((d) => d.name), ["App"]);
});

test("a device paired with a machine, this one too, is renamed there: 1 to 60 characters, trimmed", async () => {
  const { world, identities, ask } = await setup();
  const as = (id) => ({ headers: { authorization: `Bearer ${identities[id].token}` } });
  const rename = (base, id, deviceId, body) =>
    ask(`${base}/api/device/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body), ...as(id) });
  const names = async (base, id) => (await ask(`${base}/api/device/devices`, as(id))).body.devices.map((d) => d.name);
  const base = directUrl("nuc");
  world.patch({ "machines.nuc.devices": [{ name: "Chrome on Mac", mine: true }, { name: "Safari on iPhone", id: "phone" }] });

  assert.deepEqual(await rename(base, "nuc", "phone", { name: "  Ana's iPhone " }), { status: 200, body: { device_id: "phone", name: "Ana's iPhone" } });
  assert.deepEqual(await rename(base, "nuc", identities.nuc.deviceId, { name: "Work Mac" }),
    { status: 200, body: { device_id: identities.nuc.deviceId, name: "Work Mac" } });
  assert.deepEqual(await names(base, "nuc"), ["Work Mac", "Ana's iPhone"]);
  assert.equal((await rename(base, "nuc", "phone", { name: "x".repeat(60) })).status, 200);
  for (const refused of [{ name: "" }, { name: "   " }, { name: "x".repeat(61) }, { name: 7 }, {}, "not json"]) {
    assert.equal((await rename(base, "nuc", "phone", refused)).status, 400, JSON.stringify(refused));
  }
  assert.equal((await rename(base, "nuc", "nobody", { name: "Tablet" })).status, 404);
  assert.equal((await names(base, "nuc"))[1], "x".repeat(60));

  // This computer's host is asked the same at its loopback address (the page's localHostApi).
  world.patch({ "local.state": "running", "local.devices": [{ name: "Mac de Ana", kind: "local", mine: true }, { name: "Chrome on Mac", id: "chrome" }] });
  assert.equal((await rename(LOCAL_URL, LOCAL_ID, "chrome", { name: "Chrome (work)" })).status, 200);
  assert.deepEqual(world.state.local.devices.map((d) => d.name), ["Mac de Ana", "Chrome (work)"]);
});

test("a named list of agents has one in every state; a Connect may take its time or fail, and a scan may fail", async () => {
  const { world, identities, ask } = await setup();
  const auth = { headers: { authorization: `Bearer ${identities.nuc.token}` } };
  const base = directUrl("nuc");
  world.patch({ "machines.nuc.agents": "every-state" });
  const listed = (await ask(`${base}/api/host/agents`, auth)).body.agents;
  assert.deepEqual(new Set(listed.map((a) => a.registration)), new Set(["connected", "not-connected", "outdated", "foreign", "invalid", "unknown"]));
  assert.ok(listed.some((a) => a.connect === "manual"));
  assert.ok(listed.some((a) => a.registration === "not-connected" && a.actionable && a.present));
  assert.ok(listed.some((a) => a.registration === "connected" && a.present === false));
  assert.ok(listed.every((a) => a.label && a.instructions && !("connectMs" in a) && !("connectFails" in a)));
  assert.equal(listed.find((a) => a.registration === "invalid").instructions.file, "~/.config/zed/settings.json");

  // Amp's Connect takes 8 s of the world's time: held while the clock is paused.
  world.speed = 0;
  let done = false;
  const connecting = ask(`${base}/api/host/agents/amp/connect`, { method: "POST", ...auth }).then((r) => ((done = true), r));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(done, false);
  world.speed = 1;
  const connected = await connecting;
  assert.equal(connected.body.agents.find((a) => a.id === "amp").registration, "connected");
  // What the mock alone knows of a row stays with it: disconnected, it takes its time again.
  assert.equal(world.state.machines.nuc.agents.find((a) => a.id === "amp").connectMs, 8000);

  const failed = await ask(`${base}/api/host/agents/copilot/connect`, { method: "POST", ...auth });
  assert.equal(failed.status, 409);
  assert.deepEqual(failed.body, { error: { key: "connect-failed", params: { id: "copilot", agent: "GitHub Copilot CLI" } } });
  assert.equal(world.state.machines.nuc.agents.find((a) => a.id === "copilot").registration, "not-connected");

  // A scan that fails answers as the core does: its own refusals by key, the connector's errors with 409.
  world.patch({ "machines.nuc.agentsFail": "connector-timeout" });
  assert.deepEqual(await ask(`${base}/api/host/agents`, auth), { status: 504, body: { key: "connector-timeout" } });
  world.patch({ "machines.nuc.agentsFail": "agents.busy" });
  assert.deepEqual(await ask(`${base}/api/host/agents`, auth), { status: 409, body: { error: { key: "agents.busy" } } });
  world.patch({ "local.state": "running", "local.agentsFail": "no-connector" });
  assert.equal((await ask(`${LOCAL_URL}/api/host/agents`, { headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } })).body.key, "no-connector");
});

test("the desktop app's local host installs, starts, stops and pairs on the world's clock", async () => {
  const { world, identities } = await setup();
  const host = desktopHost(world, identities);
  const local = host.localHost;
  assert.equal(local.state().state, "absent");
  assert.equal(local.pairing(), null);
  const seen = [];
  const unsubscribe = local.subscribe((status) => seen.push(status.state));
  const steps = [];
  const install = local.install((event) => steps.push(event.step));
  assert.match(install.job, /^install-/);
  const status = await install;
  assert.equal(status.state, "running");
  assert.equal(status.reachable, true);
  assert.deepEqual([...new Set(steps)], ["download", "verification", "staging", "service-start"]);
  assert.deepEqual(seen.filter((state, i) => state !== seen[i - 1]), ["installing", "starting", "running"]);
  assert.equal(local.pairing().urls[0], LOCAL_URL);
  assert.equal(local.pairing().fp, identities[LOCAL_ID].fingerprint);
  const code = await local.pairingCode();
  assert.equal(code.reach, "local-only");
  assert.equal(JSON.parse(Buffer.from(code.code.slice(4), "base64url")).rv, null);
  await local.stop();
  assert.equal(local.state().state, "stopped-by-person");
  assert.equal(local.pairing(), null);
  await local.restart();
  assert.equal(local.state().state, "running");
  unsubscribe();
  assert.equal((await local.version()).update, "current");
});

test("an install fails where the world says, with the key and step the page reads, and can be cancelled", async () => {
  const { world, identities } = await setup();
  const local = desktopHost(world, identities).localHost;
  world.patch({ "local.install": "verification@install.checksum" });
  await assert.rejects(local.install(), (error) => error.key === "install.checksum" && error.step === "verification");
  assert.equal(local.state().state, "absent");
  world.patch({ "local.install": "ok" });
  const install = local.install();
  assert.equal(await local.cancel(install.job), true);
  await assert.rejects(install, (error) => error.key === "install.cancelled");
  assert.equal(await local.cancel("nope"), false);
});

test("a backing-off local host says when it tries again", () => {
  const status = localStatus({ state: "backoff" }, Date.parse("2026-10-11T00:00:00Z"));
  assert.equal(status.attempts, 2);
  assert.equal(status.next_retry_at, "2026-10-11T00:00:04.000Z");
  assert.equal(status.reachable, false);
});

test("the card's picks round-trip through the address, defaults left out", () => {
  const params = readParams("?s=paired-machines&view=phone&lang=en&speed=4&o.nucReach=room");
  assert.deepEqual(params, { scenario: "paired-machines", view: "phone", language: "en", speed: 4, options: { nucReach: "room" } });
  assert.equal(writeParams(params, { nucReach: "direct" }), "?s=paired-machines&view=phone&lang=en&speed=4&o.nucReach=room");
  assert.equal(writeParams({ ...params, view: null, language: "", speed: 1, options: { nucReach: "direct" } }, { nucReach: "direct" }), "?s=paired-machines");
  assert.equal(readParams("?speed=0").speed, 0);
  assert.equal(readParams("?view=tv").view, null);
});

test("the shipped scenarios are valid, and every option's fields land in their world", async () => {
  const scenarios = await loadMockScenarios();
  assert.ok(scenarios.length >= 3);
  for (const s of scenarios) {
    assert.ok(validMockScenario(s), s.id);
    for (const option of s.options) {
      for (const value of option.values) {
        const state = stateFor(s, choicesFor(s, { [option.id]: value.value }));
        for (const path of Object.keys(value.set)) {
          const parent = path.split(".").slice(0, -1).reduce((at, key) => at?.[key], state);
          assert.ok(parent && typeof parent === "object", `${s.id}: ${option.id}=${value.value} sets ${path}`);
        }
      }
    }
  }
});

test("Room ready and Desktop local host each show every agent state on one machine, and an agent search failing on another", async () => {
  const scenarios = await loadMockScenarios();
  for (const [id, shows] of [["room-ready", "machines.nuc"], ["desktop-local-host", "local"]]) {
    const state = stateFor(scenarios.find((s) => s.id === id), {});
    const machine = shows.split(".").reduce((at, key) => at[key], state);
    const rows = agentRows(agentsOf(machine));
    for (const registration of ["connected", "not-connected", "outdated", "foreign", "invalid", "unknown"]) {
      assert.ok(rows.some((a) => a.registration === registration), `${id}: ${registration}`);
    }
    assert.ok(rows.some((a) => a.actionable && a.present), `${id}: new`);
    assert.ok(rows.some((a) => a.connect === "manual"), `${id}: by hand`);
    assert.ok(rows.some((a) => a.present === false && a.registration === "connected"), `${id}: connected, not installed`);
    assert.ok(agentsOf(machine).some((a) => a.connectMs >= 8000) && agentsOf(machine).some((a) => a.connectFails), `${id}: slow, failing`);
    if (id === "room-ready") assert.ok(Object.values(state.machines).some((m) => m.agentsFail && m.reach !== "offline"), `${id}: a search that fails`);
  }
  // Desktop local host: the remote machines answer with their agents by default; a failing search is the card's.
  const desktop = scenarios.find((s) => s.id === "desktop-local-host");
  const state = stateFor(desktop, {});
  for (const id of ["nuc", "laptop"]) {
    assert.ok(state.machines[id].reach !== "offline" && !state.machines[id].agentsFail && agentsOf(state.machines[id]).length >= 3, id);
  }
  assert.equal(new Set(agentsOf(state.machines.laptop).map((a) => a.registration)).size, 3, "the laptop's agents in a few states");
  const search = desktop.options.find((o) => o.id === "nucAgents").values;
  assert.deepEqual(search.map((v) => v.set["machines.nuc.agentsFail"]), [null, "connector-timeout", "no-connector"]);
});

test("every scenario runs in the desktop app: one with no local host gets one not installed", async () => {
  for (const scenario of await loadMockScenarios()) {
    const world = createWorld(scenario, {}, instant);
    const identities = await makeIdentities(world.state);
    const host = desktopHost(world, identities);
    assert.ok(host.localHost, scenario.id);
    if (!scenario.world.local) {
      assert.equal(world.state.local.state, "absent", scenario.id);
      assert.equal((await host.localHost.state()).installed, false, scenario.id);
    }
  }
});

test("a scenario starts a shared option where its defaults say, and only its own copy of it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scenarios-"));
  try {
    const plain = { id: "plain", title: "P", summary: "p", world: { machines: {} }, options: [] };
    await writeFile(join(dir, "1.json"), JSON.stringify({ ...plain, id: "seeded", defaults: { installed: "seeded", keys: "elevenlabs" } }));
    await writeFile(join(dir, "2.json"), JSON.stringify(plain));
    const [seeded, other] = await loadMockScenarios(dir);
    assert.equal("defaults" in seeded, false);
    const first = (s, id) => s.options.find((o) => o.id === id).values[0].value;
    assert.deepEqual([first(seeded, "installed"), first(seeded, "keys")], ["seeded", "elevenlabs"]);
    assert.deepEqual([first(other, "installed"), first(other, "keys")], ["vad", "none"]);
    assert.equal(seeded.options.find((o) => o.id === "installed").values.length, other.options.find((o) => o.id === "installed").values.length);
    const state = stateFor(seeded, choicesFor(seeded));
    assert.equal(state.voice.installed["whisper-small"], true);
    assert.equal(state.voice.lastUsedDaysAgo["whisper-small"], 120);
    assert.deepEqual(state.voice.keys, { elevenlabs: "sk-preview-accepted" });

    await writeFile(join(dir, "3.json"), JSON.stringify({ ...plain, id: "typo", defaults: { keys: "nope" } }));
    await assert.rejects(loadMockScenarios(dir), /keys=nope/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mocked run serves the shell, the mocks' target.js, its modules and scenarios, and nothing else of mock/", async () => {
  assert.match(String((await mockFile("/")).body), /preview-mock\/shell\.mjs/);
  assert.match(String((await mockFile("/voice/target.js")).body), /__sidevoicePreview/);
  assert.ok(JSON.parse((await mockFile("/preview-mock/scenarios.json")).body).length >= 3);
  assert.equal((await mockFile("/preview-mock/machines.mjs")).type, "text/javascript");
  assert.equal(await mockFile("/preview-mock/web-types.d.ts"), null);
  assert.equal(await mockFile("/preview-mock/scenarios/01-first-visit.json"), null);
  assert.equal(await mockFile("/voice/index.html"), null);
});

test("a storage step that never answers holds the preview up for its bound only", async () => {
  const { bounded } = await import("../preview/mock/shell.mjs");
  const started = Date.now();
  assert.equal(await bounded(new Promise(() => {}), 50), undefined);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await bounded(Promise.resolve(3), 1000), 3);
  assert.equal(await bounded(Promise.reject(new Error("x")), 1000), undefined);
});

test("the shell shows the way out before its script runs", async () => {
  const html = String((await mockFile("/")).body);
  assert.match(html, /<aside id="card"[^]*href="\/preview-reset"/);
  assert.match(html, /allow="microphone;[^"]*autoplay;[^"]*speaker-selection/);
});

test("the reset page clears the origin's data, with or without a run, and only goes on to this origin", async () => {
  const { createServer } = await import("node:http");
  const { previewOrigin } = await import("../preview/proxy.mjs");
  let current = null;
  const origin = previewOrigin({ runs: { get current() { return current; }, resetDone() {} } });
  const server = createServer((req, res) => origin.handle(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const none = await fetch(`${base}/preview-reset`);
    assert.equal(none.status, 200);
    assert.equal(none.headers.get("clear-site-data"), '"cache", "storage"');
    assert.match(await none.text(), /location\.replace\("\/"\)/);
    assert.match(await (await fetch(`${base}/preview-reset?next=//evil.example`)).text(), /location\.replace\("\/"\)/);
    current = { mode: "real", reset: true };
    assert.match(await (await fetch(`${base}/preview-reset`)).text(), /location\.replace\("\/voice\/"\)/);
    current = { mode: "mock" };
    assert.match(await (await fetch(`${base}/preview-reset`)).text(), /location\.replace\("\/"\)/);
    assert.equal((await fetch(`${base}/`)).status, 200);
  } finally {
    server.close();
  }
});

test("each machine answers its own conversations and history, at its own address, with its own token", async () => {
  const history = (text, minutesAgo, role = "assistant") => ({ role, text, minutesAgo });
  const two = {
    ...scenario,
    world: { ...scenario.world, machines: {
      nuc: { ...scenario.world.machines.nuc, participants: [{ title: "Claude", reach: "listening", history: [history("hi", 10, "user"), history("hello", 9)] }] },
      ws: { ...scenario.world.machines.ws, paired: true, participants: [{ title: "infra", reach: "listening", history: [history("backup ok", 2)] }] },
    } },
  };
  const world = createWorld(two, {}, { ...instant, now: () => 1_000_000_000 });
  const identities = await makeIdentities(world.state);
  const ask = (url, id) => answer(world, identities, { pageOrigin: PAGE, url, headers: { authorization: `Bearer ${identities[id].token}` } });
  const nuc = (await ask(`${directUrl("nuc")}/api/presentation/history`, "nuc")).body.messages;
  assert.deepEqual(nuc.map((row) => [row.thread, row.role, row.text, row.name, row.status]), [
    ["nuc-thread-1", "user", "hi", "You", "read"], ["nuc-thread-1", "assistant", "hello", "Claude", "playback_finished"]]);
  assert.equal(nuc[0].time, 1_000_000_000 - 10 * 60_000);
  const ws = (await ask(`${ROOM_URL}/nodes/ws/api/presentation/history`, "ws")).body.messages;
  assert.deepEqual(ws.map((row) => [row.thread, row.text]), [["ws-thread-1", "backup ok"]]);
  assert.deepEqual((await ask(`${ROOM_URL}/nodes/ws/api/presentation/participants`, "ws")).body.participants.map((p) => p.title), ["infra"]);
  assert.equal((await ask(`${ROOM_URL}/nodes/ws/api/presentation/history`, "nuc")).status, 401, "another machine's token");
});

test("a machine's Sidevoice version is the scenario's, and unknown when it says none", async () => {
  assert.equal(localStatus({ state: "running" }, 0).product_version, null);
  assert.equal(localStatus({ state: "running", productVersion: "0.8.1" }, 0).product_version, "0.8.1");
  const { world, identities, ask } = await setup();
  const status = () => ask(`${directUrl("nuc")}/api/host/status`, { headers: { authorization: `Bearer ${identities.nuc.token}` } });
  assert.deepEqual((await status()).body, { version: null });
  world.patch({ "machines.nuc.productVersion": "0.8.1" });
  assert.deepEqual((await status()).body, { version: "0.8.1" });
  for (const scenario of await loadMockScenarios()) {
    const option = scenario.options.find((o) => o.id === "productVersion");
    assert.deepEqual(option?.values.map((v) => v.value), ["0.8.1", "unknown"], scenario.id);
  }
});
