import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockFile, loadMockScenarios } from "../preview/proxy.mjs";
import { changedCount, choicesFor, createWorld, deepSet, stateFor, validMockScenario } from "../preview/mock/world.mjs";
import {
  LOCAL_ID, LOCAL_URL, ROOM_URL, agentRows, agentsOf, answer, directUrl, lanUrl, makeIdentities, mintCode, placeOf, seededStorage,
} from "../preview/mock/machines.mjs";
import {
  CHECK_MS, DOWNLOAD_STEPS, DOWNLOAD_STEP_MS, UPDATER_STATES, UPDATE_VERSION, checkForUpdate, desktopHost, hasAppUpdater, localStatus, setUpdaterMode, setUpdaterState,
  updaterMode,
} from "../preview/mock/bridge.mjs";
import { DESKTOP, VARIANTS, chooseMockOption, deviceBox, mergeSeed, prunedVariantChoices, readParams, writeParams } from "../preview/mock/shell.mjs";
import { APP_VERSION, LOCAL_VERSION } from "../preview/mock/bridge.mjs";
import { nextMinor } from "../preview/mock/machines.mjs";

const PAGE = "https://preview.example";
const nonce = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const instant = { tick: () => new Promise((r) => setImmediate(r)) };

test("the open choices are the model blocks'; every decided one stored goes; scenario seeding leaves choices alone", () => {
  // The web's own names and values, in its order: the first is the page's default (sidevoice-web#340).
  assert.deepEqual(VARIANTS.map((variant) => [variant.name, variant.values.map((option) => option.value)]), [
    ["modelSummary", ["status", "facts", "advanced", "chip", "chipfacts", "chipadvanced"]],
    ["modelList", ["sized", "names", "twolines"]],
    ["hardwareLabel", ["class", "technical", "both"]],
  ]);
  for (const variant of VARIANTS) assert.ok(variant.label && variant.note && variant.values.every((option) => option.label), variant.name);
  assert.deepEqual(prunedVariantChoices({ modelSummary: "gone", modelList: "twolines" }), { modelList: "twolines" },
    "an open one's choice stays, a value it does not offer goes");
  assert.deepEqual(prunedVariantChoices({ modelLanguages: "inline", modelSummary: "chip" }), { modelSummary: "chip" },
    "the decided model languages (the popover, sidevoice-web#339) are pruned from a stored choice");
  assert.deepEqual(prunedVariantChoices({ onboardingFlow: "d", titleDetail: "popover" }), {}, "the decided onboarding flow and call details are pruned from a stored choice");
  assert.deepEqual(prunedVariantChoices({ "bubbles-style": "soft", old: "yes" }), {});
  assert.deepEqual(prunedVariantChoices(null), {});
  assert.deepEqual(prunedVariantChoices({ permissionsStep: "b", permissionButton: "c" }), {}, "the decided permissions look is pruned from a stored choice");
  assert.deepEqual(prunedVariantChoices({ keylessProvider: "key" }), {}, "the decided keyless provider look (both together) is pruned from a stored choice");
  const current = { "sidevoice.variants": JSON.stringify({ "bubbles-style": "illustrated" }) };
  const merged = mergeSeed(current, { "sidevoice.onboarding": "done" });
  assert.ok(!merged.remove.includes("sidevoice.variants"));
  assert.equal(merged.set["sidevoice.variants"], undefined);
});

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

test("desktop data mock keeps pairings and reports deletion only after relaunch", async () => {
  const { world, identities } = await setup();
  const relaunched = [];
  const data = desktopHost(world, identities, { relaunch: (what) => relaunched.push(what) }).data;
  assert.equal((await data.pairings.read()).pairings.length, 1);
  await data.pairings.write({ pairings: [], pendingRevokes: [] });
  assert.deepEqual(await data.pairings.read(), { pairings: [], pendingRevokes: [] });
  const started = await data.deleteAll();
  assert.equal(started.state, "needs-restart");
  assert.equal(world.state.app?.resetReport, undefined, "helper has not finished when native call returns");
  await new Promise((resolve) => { const stop = world.subscribe(() => { if (world.state.app?.resetReport) { stop(); resolve(); } }); });
  assert.deepEqual(relaunched, [{ reset: true }]);
  assert.equal((await data.resetReport()).state, "complete");
  assert.deepEqual(world.state.voice?.installed, {});
  assert.deepEqual(world.state.voice?.keys, {});
  assert.equal(world.state.app?.shortcut, null);
  assert.equal(await data.resetReport(), null);
  world.patch({ "app.resetFailure": "service", "local.state": "running" });
  await assert.rejects(data.deleteAll(), (failure) => failure.key === "reset.service-failed");
  assert.equal(world.state.local.state, "running");
});

test("desktop uninstall mock deletes everything, then quits to the Trash without a report", async () => {
  const { world, identities } = await setup();
  world.patch({ "voice.installed": { "whisper-base": true }, "voice.keys": { openai: "mock-secret" } });
  let quit;
  const relaunched = new Promise((resolve) => { quit = resolve; });
  const data = desktopHost(world, identities, { relaunch: (what) => quit(what) }).data;
  const started = await data.uninstall();
  assert.equal(started.state, "needs-quit");
  assert.ok(started.pending.includes("app"));
  assert.deepEqual(await relaunched, { reset: true, uninstalled: true });
  assert.deepEqual(world.state.voice.installed, {});
  assert.deepEqual(world.state.voice.keys, {});
  assert.equal(await data.resetReport(), null);
  world.patch({ "app.resetFailure": "unremovable" });
  await assert.rejects(data.uninstall(), (failure) => failure.key === "reset.app-unremovable");
});

test("desktop reset mock reports model cleanup failure only after relaunch", async () => {
  const { world, identities } = await setup();
  world.patch({ "app.resetFailure": "models", "voice.installed": { "whisper-base": true }, "voice.keys": { openai: "mock-secret" } });
  const data = desktopHost(world, identities).data;
  const started = await data.deleteAll();
  assert.equal(started.state, "needs-restart");
  assert.deepEqual(started.failed, []);
  await new Promise((resolve) => { const stop = world.subscribe(() => { if (world.state.app?.resetReport) { stop(); resolve(); } }); });
  const final = await data.resetReport();
  assert.equal(final.state, "partial");
  assert.deepEqual(final.failed, [{ step: "models", key: "remove" }]);
  assert.equal(world.state.voice.installed["whisper-base"], true);
  assert.deepEqual(world.state.voice.keys, {});
});

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

test("a machine paired without encryption is kept at its local network's address alone, and answers there over http", async () => {
  const { world, identities, ask } = await setup();
  world.patch({ "machines.ws.paired": true, "machines.ws.insecure": true });
  const kept = JSON.parse(seededStorage(world.state, identities, 0)["sidevoice.pairings"]).pairings;
  const ws = kept.find((p) => p.host === "WS");
  assert.deepEqual([ws.urls, ws.rv, ws.insecure], [["http://ws.local:8768"], null, true]);
  assert.equal(kept.find((p) => p.host === "NUC").insecure, undefined, "only the one paired so");
  assert.deepEqual(placeOf(`${lanUrl("ws")}/api/x?a=1`, PAGE), { id: "ws", via: "direct", path: "/api/x", query: "?a=1" });
  assert.equal(placeOf("https://ws.local:8768/api/x", PAGE), null, "only plain http");
  assert.equal(placeOf("http://ws.local:8765/api/x", PAGE), null, "only its port");
  assert.equal(placeOf("http://ws.lan:8768/api/x", PAGE), null, "only a .local name");
  // It is a direct address: the machine answers there as it does at its other one.
  assert.deepEqual(await ask(`${lanUrl("ws")}/api/rendezvous`), { unreachable: true }, "the workstation answers only through the room");
  world.patch({ "machines.ws.reach": "direct" });
  assert.equal((await ask(`${lanUrl("ws")}/api/device/identity?nonce=${nonce()}`)).body.public_key, identities.ws.publicKey);
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

test("a machine slow to answer proves itself only after its delay of the world's time, wherever it is asked", async () => {
  let ticked = 0;
  const world = createWorld(scenario, {}, { tick: () => new Promise((r) => setImmediate(() => r(ticked++))) });
  const identities = await makeIdentities(world.state);
  const ask = (url) => answer(world, identities, { pageOrigin: PAGE, url });
  const prove = (base) => ask(`${base}/api/device/identity?nonce=${nonce()}`);
  assert.equal((await prove(directUrl("nuc"))).status, 200);
  assert.equal(ticked, 0, "one that answers at once");
  world.patch({ "machines.nuc.answersAfterMs": 3000 });
  assert.equal((await prove(directUrl("nuc"))).status, 200);
  assert.equal(ticked, 60, "3000 ms: sixty steps of 50 ms");
  assert.equal((await prove(`${ROOM_URL}/nodes/nuc`)).status, 200);
  assert.equal(ticked, 120, "through the room too");
  assert.equal((await ask(`${directUrl("nuc")}/api/rendezvous`)).status, 200);
  assert.equal(ticked, 120, "only its proof waits");
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
  // Any other agent is connected by hand from the entry the listing carries, as the connector's does.
  assert.match((await ask(`${LOCAL_URL}/api/host/agents`, as(LOCAL_ID))).body.custom.snippet, /"sidevoice"/);
  assert.equal((await ask(`${LOCAL_URL}/api/device/devices/phone`, { method: "DELETE", ...as(LOCAL_ID) })).status, 200);
  assert.deepEqual(world.state.local.devices.map((d) => d.name), ["App"]);
});

test("Cursor readiness presets emit only state and reason codes", async () => {
  const desktop = (await loadMockScenarios()).find((entry) => entry.id === "desktop-local-host");
  const world = createWorld(desktop, {}, instant);
  const identities = await makeIdentities(world.state);
  const states = ["ready", "needs_attention", "unsupported", "unknown_code", "unknown_no_message"];
  const expected = {
    ready: { state: "ready", reasons: [] },
    needs_attention: { state: "needs_attention", reasons: [{ code: "cursor.bridge_not_running",
      message: "Voice in the Cursor editor needs Cursor's Desktop Bridge: in Cursor, open Settings › Beta, enable “Allow CLI to access desktop agents”, then restart Cursor." }] },
    unsupported: { state: "unsupported", reasons: [{ code: "cursor.unsupported", message: "Cursor editor voice is not supported on this computer." }] },
    unknown_code: { state: "needs_attention", reasons: [{ code: "cursor.future_code", message: "Check the new Cursor setup." }] },
    unknown_no_message: { state: "needs_attention", reasons: [{ code: "cursor.future_code" }] },
  };
  assert.deepEqual(desktop.options.find((option) => option.id === "cursorBridge").values.map((value) => value.value), states);
  let otherAgents;
  for (const state of states) {
    world.choose("cursorBridge", state);
    const response = await answer(world, identities, { pageOrigin: PAGE, url: `${LOCAL_URL}/api/host/agents`,
      headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } });
    assert.equal(response.status, 200);
    const cursor = response.body.agents.find((agent) => agent.id === "cursor");
    assert.equal(cursor.registration, "connected", "MCP registration is independent of readiness");
    assert.deepEqual(cursor.readiness, expected[state]);
    assert.equal(Object.hasOwn(cursor, "cursor_bridge"), false);
    const others = response.body.agents.filter((agent) => agent.id !== "cursor");
    assert.ok(others.every((agent) => !agent.readiness));
    if (otherAgents) assert.deepEqual(others, otherAgents);
    else otherAgents = others;
  }
});

test("agent actions change registration without inventing readiness", async () => {
  const desktop = (await loadMockScenarios()).find((entry) => entry.id === "desktop-local-host");
  const world = createWorld(desktop, {}, instant);
  const identities = await makeIdentities(world.state);
  const auth = { headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } };
  const ask = (path, method = "GET") => answer(world, identities, { pageOrigin: PAGE, url: `${LOCAL_URL}${path}`, method, ...auth });
  const cursor = (response) => response.body.agents.find((agent) => agent.id === "cursor");
  assert.deepEqual(cursor(await ask("/api/host/agents")).readiness, { state: "ready", reasons: [] });
  const disconnected = await ask("/api/host/agents/cursor/disconnect", "POST");
  assert.equal(cursor(disconnected).registration, "not-connected");
  assert.deepEqual(cursor(disconnected).readiness, { state: "ready", reasons: [] });
  const connected = await ask("/api/host/agents/cursor/connect", "POST");
  assert.equal(cursor(connected).registration, "connected");
  assert.deepEqual(cursor(connected).readiness, { state: "ready", reasons: [] });
});

test("live Cursor readiness picker refreshes all reason-message choices without reconnecting or reloading", async () => {
  const desktop = (await loadMockScenarios()).find((entry) => entry.id === "desktop-local-host");
  const world = createWorld(desktop, {}, instant);
  const identities = await makeIdentities(world.state);
  const fp = identities[LOCAL_ID].fingerprint;
  const ask = () => answer(world, identities, { pageOrigin: PAGE, url: `${LOCAL_URL}/api/host/agents`,
    headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } });
  const displayed = { status: "ready", value: (await ask()).body };
  const card = () => displayed.value.agents.find((agent) => agent.id === "cursor").readiness;
  const cursor = () => displayed.value.agents.find((agent) => agent.id === "cursor");
  const disconnected = await answer(world, identities, { pageOrigin: PAGE, url: `${LOCAL_URL}/api/host/agents/cursor/disconnect`,
    method: "POST", headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } });
  assert.equal(disconnected.status, 200);
  displayed.value = disconnected.body;
  assert.equal(cursor().registration, "not-connected");
  assert.equal(cursor().actionable, true);
  let refresh;
  let calls = 0;
  const frame = { src: "/voice/", contentWindow: {
    sidevoiceUI: { store: { getState: () => ({ facts: { hostAgents: { [fp]: displayed } } }) } },
    sidevoiceActions: { loadHostAgents(askedFp, options) {
      assert.equal(askedFp, fp);
      assert.deepEqual(options, { rescan: true });
      calls++;
      refresh = ask().then((response) => { displayed.value = response.body; });
      return refresh;
    } },
  } };
  assert.deepEqual(card(), { state: "ready", reasons: [] });
  for (const [choice, expected] of [
    ["needs_attention", { state: "needs_attention", reasons: [{ code: "cursor.bridge_not_running",
      message: "Voice in the Cursor editor needs Cursor's Desktop Bridge: in Cursor, open Settings › Beta, enable “Allow CLI to access desktop agents”, then restart Cursor." }] }],
    ["unsupported", { state: "unsupported", reasons: [{ code: "cursor.unsupported", message: "Cursor editor voice is not supported on this computer." }] }],
    ["unknown_code", { state: "needs_attention", reasons: [{ code: "cursor.future_code", message: "Check the new Cursor setup." }] }],
    ["unknown_no_message", { state: "needs_attention", reasons: [{ code: "cursor.future_code" }] }],
    ["ready", { state: "ready", reasons: [] }],
  ]) {
    assert.equal(chooseMockOption(world, "cursorBridge", choice, frame, identities), false);
    await refresh;
    assert.deepEqual(card(), expected);
    assert.equal(cursor().registration, "not-connected", `${choice} must not reconnect Cursor`);
    assert.equal(cursor().actionable, true, `${choice} must leave Connect available`);
    assert.equal(frame.src, "/voice/", "the framed page never reloads");
  }
  assert.equal(calls, 5);
  const connected = await answer(world, identities, { pageOrigin: PAGE, url: `${LOCAL_URL}/api/host/agents/cursor/connect`,
    method: "POST", headers: { authorization: `Bearer ${identities[LOCAL_ID].token}` } });
  assert.equal(connected.status, 200);
  assert.equal(connected.body.agents.find((agent) => agent.id === "cursor").registration, "connected");
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
  assert.ok(listed.every((a) => a.present), "only agents installed on the machine, as the connector lists them");
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

test("an app with no install seam installs nothing: the install command run leaves it starting, then running", async () => {
  const { world, identities } = await setup();
  world.patch({ "local.appInstalls": false });
  const local = desktopHost(world, identities).localHost;
  assert.equal(local.install, undefined);
  assert.equal(local.cancel, undefined);
  assert.equal(local.state().state, "absent");
  const seen = [];
  local.subscribe((status) => seen.push(status.state));
  world.patch({ "local.commandRun": true });
  await new Promise((resolve) => { const off = world.subscribe(() => { if (local.state().state === "running") { off(); resolve(); } }); });
  assert.deepEqual(seen.filter((state, i) => state !== seen[i - 1]), ["starting", "running"]);
  assert.equal(local.state().installed, true);
  assert.equal(world.state.local.commandRun, null);
  assert.equal(local.pairing().urls[0], LOCAL_URL);
  // Run where a start fails, it fails, and Retry (a restart) brings it back once a start runs again.
  world.patch({ "local.state": "absent", "local.installed": false, "local.startsAs": "failed" });
  world.patch({ "local.commandRun": true });
  await new Promise((resolve) => { const off = world.subscribe(() => { if (local.state().state === "failed") { off(); resolve(); } }); });
  world.patch({ "local.startsAs": "running" });
  await local.restart();
  assert.equal(local.state().state, "running");
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

test("a release's updater: automatic downloads what a check finds, manual waits for download, a restart installs", async () => {
  const { world, identities } = await setup();
  const updater = desktopHost(world, identities).updater;
  assert.deepEqual(await updater.settings(), { mode: "automatic" });
  assert.deepEqual(await updater.status(), { state: "idle" });
  const seen = [];
  const stop = updater.subscribe((status) => seen.push(status.state));
  // Automatic: a check finds it and it downloads by itself, its progress moving, to ready.
  assert.equal((await updater.check()).state, "downloading");
  while ((await updater.status()).state === "downloading") await new Promise((r) => setImmediate(r));
  assert.deepEqual(await updater.status(), { state: "ready", version: UPDATE_VERSION });
  assert.deepEqual([...new Set(seen)], ["available", "downloading", "ready"]);
  await updater.restart();
  assert.deepEqual(await updater.status(), { state: "idle" });
  // Installed: the next check finds nothing.
  assert.equal((await updater.check()).state, "idle");
  // Manual: what a check finds waits for download() — the one after the app's, now UPDATE_VERSION's.
  assert.deepEqual(await updater.setMode("manual"), { mode: "manual" });
  setUpdaterState(world, "idle");
  assert.deepEqual(await updater.check(), { state: "available", version: nextMinor(UPDATE_VERSION) });
  assert.equal((await updater.download()).state, "downloading");
  const progress = [];
  while ((await updater.status()).state === "downloading") {
    progress.push((await updater.status()).progress);
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(progress.some((p) => p > 0 && p < 1));
  assert.equal((await updater.status()).state, "ready");
  stop();
  await assert.rejects(updater.setMode("sometimes"));
});

test("the updater's steps take the app's time: a check ~1.5 s, a download ~7 s in uneven steps; the app's own check too", async () => {
  // The world's clock, as its delays spend it.
  let elapsed = 0;
  const world = createWorld(scenario, {}, { tick: (ms) => { elapsed += ms; return new Promise((r) => setImmediate(r)); } });
  const updater = desktopHost(world, await makeIdentities(world.state)).updater;
  const until = async (done) => { while (!done(await updater.status())) await new Promise((r) => setImmediate(r)); };
  assert.equal(Math.round(DOWNLOAD_STEPS.reduce((sum, step) => sum + step, 0) * 100), 100);
  assert.ok(new Set(DOWNLOAD_STEPS).size > 1, "uneven, as chunks arrive");
  const seen = [];
  const stop = updater.subscribe((status) => seen.push(status));
  // Automatic: the check takes its time, then what it found downloads by itself, step by step, to ready.
  assert.equal((await updater.check()).state, "downloading");
  // (Its download started as it answered: the clock is theirs together, a tick apart.)
  assert.ok(elapsed >= CHECK_MS && elapsed <= CHECK_MS + 100, `the check took ${elapsed} ms`);
  const started = CHECK_MS;
  await until((status) => status.state === "ready");
  const took = elapsed - started;
  assert.ok(took >= 6000 && took <= 8000, `the download took ${took} ms`);
  const progress = seen.filter((status) => status.state === "downloading").map((status) => status.progress);
  assert.deepEqual(seen.map((status) => status.state).filter((state, i, all) => state !== all[i - 1]), ["available", "downloading", "ready"]);
  assert.equal(progress.length, DOWNLOAD_STEPS.length);
  assert.ok(progress.every((value, i) => i === 0 || value > progress[i - 1]), "it only moves on");
  assert.ok(progress.at(-1) < 1);
  stop();
  // Manual: the app's own check (the card's App checks: the page asked nothing) finds one, and it waits for download().
  setUpdaterMode(world, "manual");
  setUpdaterState(world, "idle");
  const before = elapsed;
  assert.equal((await checkForUpdate(world)).state, "available");
  assert.equal(elapsed - before, CHECK_MS);
  await world.delay(DOWNLOAD_STEP_MS * 3);
  assert.deepEqual(await updater.status(), { state: "available", version: UPDATE_VERSION });
  assert.equal((await updater.download()).state, "downloading");
  await until((status) => status.state === "ready");
});

test("the card steps the updater to each state, failures with their codes; a nightly has one too, a development build none", async () => {
  const { world, identities } = await setup();
  const updater = desktopHost(world, identities).updater;
  // Manual: each state stays as stepped (automatic downloads what is available: the next test).
  setUpdaterMode(world, "manual");
  const expected = {
    idle: { state: "idle" }, available: { state: "available", version: UPDATE_VERSION }, ready: { state: "ready", version: UPDATE_VERSION },
    "check-failed": { state: "idle", error: { code: "update-check-failed" } },
    "download-failed": { state: "available", version: UPDATE_VERSION, error: { code: "update-download-failed" } },
    "install-failed": { state: "ready", version: UPDATE_VERSION, error: { code: "update-install-failed" } },
  };
  for (const { id } of UPDATER_STATES) {
    setUpdaterState(world, id);
    if (id === "downloading") assert.equal((await updater.status()).state, "downloading");
    else assert.deepEqual(await updater.status(), expected[id], id);
  }
  // A retry clears the failure.
  setUpdaterState(world, "check-failed");
  assert.equal((await updater.check()).error, undefined);
  // A nightly's (sidevoice-desktop #56, for now) is the same world's updater; a development build has none.
  world.patch({ "app.channel": "nightly" });
  assert.equal(hasAppUpdater(world), true);
  const nightly = desktopHost(world, identities).updater;
  setUpdaterState(world, "available");
  assert.deepEqual(await nightly.status(), { state: "available", version: UPDATE_VERSION });
  world.patch({ "app.channel": "dev" });
  assert.equal(hasAppUpdater(world), false);
  assert.equal(desktopHost(world, identities).updater, undefined);
});

test("one mode, the app's: the page's setMode and the card set the same; automatic never rests at available, manual never downloads by itself", async () => {
  const { world, identities } = await setup();
  const updater = desktopHost(world, identities).updater;
  const settle = async () => { while ((await updater.status()).state === "downloading") await new Promise((r) => setImmediate(r)); };
  // Manual: a check finds one and it waits — no download, no ready — until download().
  await updater.setMode("manual");
  assert.deepEqual(await updater.check(), { state: "available", version: UPDATE_VERSION });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(await updater.status(), { state: "available", version: UPDATE_VERSION });
  // The card's mode is the page's: what the page reads next (settings) is what the card set.
  setUpdaterMode(world, "automatic");
  assert.deepEqual(await updater.settings(), { mode: "automatic" });
  assert.equal(updaterMode(world), "automatic");
  // Automatic downloads what was found, by itself, to ready; the restart is still the person's.
  assert.equal((await updater.status()).state, "downloading");
  await settle();
  assert.deepEqual(await updater.status(), { state: "ready", version: UPDATE_VERSION });
  // The card's Available, in automatic, downloads at once, as the app would; a download that failed waits for Retry.
  setUpdaterState(world, "available");
  assert.equal((await updater.status()).state, "downloading");
  setUpdaterState(world, "download-failed");
  assert.deepEqual(await updater.status(), { state: "available", version: UPDATE_VERSION, error: { code: "update-download-failed" } });
  // A check in automatic with one found and not downloaded downloads it.
  setUpdaterMode(world, "manual");
  setUpdaterState(world, "available");
  setUpdaterMode(world, "automatic");
  assert.equal((await updater.status()).state, "downloading");
  await settle();
  setUpdaterState(world, "idle");
  world.patch({ "app.update.mode": "automatic", "app.update.state": "available", "app.update.error": null });
  assert.equal((await updater.check()).state, "downloading");
  assert.throws(() => setUpdaterMode(world, "sometimes"));
});

test("a backing-off local host says when it tries again", () => {
  const status = localStatus({ state: "backoff" }, Date.parse("2026-10-11T00:00:00Z"));
  assert.equal(status.attempts, 2);
  assert.equal(status.next_retry_at, "2026-10-11T00:00:04.000Z");
  assert.equal(status.reachable, false);
});

test("the card's picks round-trip through the address, defaults left out", () => {
  const params = readParams("?s=paired-machines&view=phone&lang=en&speed=4&o.nucReach=room");
  assert.deepEqual(params, { scenario: "paired-machines", view: "phone", language: "en", speed: 4, stage: "app", options: { nucReach: "room" } });
  assert.equal(writeParams(params, { nucReach: "direct" }), "?s=paired-machines&view=phone&lang=en&speed=4&o.nucReach=room");
  assert.equal(writeParams({ ...params, view: null, language: "", speed: 1, options: { nucReach: "direct" } }, { nucReach: "direct" }), "?s=paired-machines");
  assert.equal(readParams("?speed=0").speed, 0);
  assert.equal(readParams("?view=tv").view, null);
  // The stage shows the app unless it says the floating card.
  assert.equal(readParams("?view=app&stage=card").stage, "card");
  assert.equal(readParams("?stage=tv").stage, "app");
  assert.equal(writeParams({ ...readParams("?s=x&view=app&stage=card") }), "?s=x&view=app&stage=card");
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
    assert.ok(rows.every((a) => a.present), `${id}: only agents installed`);
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

test("Machine states seeds a machine in each state, a long name, one new agent, and this device in each of its states", async () => {
  const states = (await loadMockScenarios()).find((s) => s.id === "machine-states");
  assert.ok(states);
  const state = stateFor(states, choicesFor(states));
  const machines = Object.values(state.machines);
  assert.ok(machines.every((m) => m.paired), "every one paired");
  for (const [shows, is] of [
    ["direct", (m) => m.reach === "direct" && !m.revoked && !m.insecure && !m.answersAfterMs],
    ["room", (m) => m.reach === "room"],
    ["slow", (m) => m.reach === "direct" && m.answersAfterMs > 0 && m.answersAfterMs < 4000],
    ["offline", (m) => m.reach === "offline"],
    ["revoked", (m) => m.reach === "direct" && m.revoked],
    ["insecure", (m) => m.reach === "direct" && m.insecure && !m.revoked],
  ]) assert.equal(machines.filter(is).length, 1, shows);
  assert.ok(machines.some((m) => m.host.length > 30), "a long name");
  // Exactly one new agent, on the NUC: every machine names its agents, since the default list has a new one.
  const hosts = [...machines, state.local];
  assert.ok(hosts.every((m) => Array.isArray(m.agents)), "each one's agents named");
  const fresh = (m) => agentRows(agentsOf(m)).filter((a) => a.actionable && a.present && a.registration === "not-connected");
  assert.equal(hosts.flatMap(fresh).length, 1);
  assert.equal(fresh(state.machines.nuc).length, 1);
  // The new setting is What's new's: set up on the release before, with a transcription model ready for it.
  assert.equal(state.setup, "earlier");
  assert.equal(state.voice.installed["whisper-base"], true);

  // As the page finds them: the insecure one at its local network's address, the revoked one refusing this device.
  const world = createWorld(states, {}, instant);
  const identities = await makeIdentities(world.state);
  const idOf = (is) => Object.keys(state.machines).find((id) => is(state.machines[id]));
  const [insecure, revoked] = [idOf((m) => m.insecure), idOf((m) => m.revoked)];
  const kept = JSON.parse(seededStorage(world.state, identities, 0, { desktop: true })["sidevoice.pairings"]).pairings;
  assert.deepEqual(kept.find((p) => p.fp === identities[insecure].fingerprint).urls, [lanUrl(insecure)]);
  const ask = (id, path) => answer(world, identities, { pageOrigin: PAGE, url: `${directUrl(id)}${path}`, headers: { authorization: `Bearer ${identities[id].token}` } });
  assert.equal((await ask(revoked, `/api/device/identity?nonce=${nonce()}`)).status, 200);
  assert.equal((await ask(revoked, "/api/host/agents")).status, 401);

  // This device in each of the five states it reads in, each value setting all it depends on.
  const local = states.options.find((o) => o.id === "localState");
  assert.deepEqual(local.values.map((v) => v.set["local.state"]), ["running", "starting", "failed", "stopped-by-person", "absent"]);
  for (const value of local.values) {
    const status = localStatus(stateFor(states, choicesFor(states, { localState: value.value })).local, 0);
    assert.equal(status.state, value.value);
    assert.equal(status.installed, value.value !== "absent", value.value);
    assert.equal(!!status.failure, value.value === "failed", value.value);
  }
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

test("a module added to mock/ is served at once, and no name reaches outside it", async () => {
  const added = new URL("../preview/mock/zz-added-for-test.mjs", import.meta.url);
  assert.equal(await mockFile("/preview-mock/zz-added-for-test.mjs"), null, "not there yet");
  await writeFile(added, "export const added = true;\n");
  try {
    const served = await mockFile("/preview-mock/zz-added-for-test.mjs");
    assert.equal(served.type, "text/javascript");
    assert.match(String(served.body), /added = true/);
  } finally {
    await rm(added, { force: true });
  }
  assert.equal(await mockFile("/preview-mock/zz-added-for-test.mjs"), null, "gone again");
  assert.equal((await mockFile("/preview-mock/shell.css")).type, "text/css");
  for (const name of ["../proxy.mjs", "..%2Fproxy.mjs", "%2e%2e/proxy.mjs", "scenarios/../shell.mjs", ".hidden.mjs", "frame.js",
    "shell.html", "voice-options.json", "web-types.d.ts", "Shell.mjs", "scenarios", ""]) {
    assert.equal(await mockFile(`/preview-mock/${name}`), null, name);
  }
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

test("the app's version and its update's are coherent: an update is newer, a restart runs it and brings a newer service", async () => {
  const { world, identities } = await setup();
  world.patch({ local: { state: "running", installed: true, version: LOCAL_VERSION, bundledVersion: LOCAL_VERSION, update: "current" } });
  const relaunched = [];
  const host = desktopHost(world, identities, { relaunch: () => relaunched.push(true) });
  // Two products, two numbers, each offered a newer one: the app 0.3.0 → 0.4.0, the service 0.8.1 → 0.9.0.
  assert.deepEqual([host.build.version, APP_VERSION, UPDATE_VERSION, LOCAL_VERSION], ["0.3.0", "0.3.0", "0.4.0", "0.8.1"]);
  setUpdaterState(world, "ready");
  assert.equal((await host.updater.status()).version, "0.4.0");
  await host.updater.restart();
  // The app runs what it installed, the page loads again, and the new app bundles a newer service than the one installed.
  assert.equal(host.build.version, "0.4.0");
  assert.deepEqual(relaunched, [true]);
  const service = await host.localHost.version();
  assert.deepEqual([service.update, service.installed?.version, service.bundled.version], ["available", "0.8.1", "0.9.0"]);
  assert.equal(host.localHost.state().product_version, "0.8.1", "the service says the number installed, as version() does");
  // Stepped to available again, the app is offered the one after the one it runs, never the one it runs.
  setUpdaterState(world, "available");
  assert.equal((await host.updater.status()).version, "0.5.0");
});

test("a machine's Sidevoice version is the scenario's, and unknown when it says none", async () => {
  // This computer's service says the number installed (the same version() says), unless the scenario has it say none.
  assert.equal(localStatus({ state: "running" }, 0).product_version, LOCAL_VERSION);
  assert.equal(localStatus({ state: "running", version: "0.9.0" }, 0).product_version, "0.9.0");
  assert.equal(localStatus({ state: "running", saysVersion: false }, 0).product_version, null);
  assert.equal(localStatus({ state: "absent" }, 0).product_version, null);
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

test("a desktop view lays the page out at a desktop's size at least, scaled to fit; the phone keeps its own", () => {
  // A laptop with both panels open: the browser view fills the slot at a desktop's size, scaled down.
  const laptop = deviceBox({ width: 830, height: 760 }, "browser");
  assert.ok(laptop.width >= DESKTOP.width && laptop.height >= DESKTOP.height, JSON.stringify(laptop));
  assert.ok(laptop.scale < 1);
  assert.ok(Math.abs(laptop.width * laptop.scale - 830) < 1 || Math.abs(laptop.height * laptop.scale - 760) < 1, "it fills one side");
  assert.ok(laptop.width * laptop.scale <= 831 && laptop.height * laptop.scale <= 761, "and fits");
  // A wide screen: no scaling, the slot itself.
  assert.deepEqual(deviceBox({ width: 1500, height: 900 }, "browser"), { width: 1500, height: 900, scale: 1, left: 0, top: 0 });
  // The desktop app: a desktop-sized window and its title bar, centred, scaled down when the slot is smaller.
  const app = deviceBox({ width: 1000, height: 900 }, "app");
  assert.deepEqual([app.width, app.height], [1280, 830]);
  assert.ok(Math.abs(app.scale - 1000 / 1280) < 1e-9);
  assert.equal(deviceBox({ width: 1600, height: 1000 }, "app").scale, 1);
  // A window dragged to another size: laid out at that size (and its title bar), still scaled to fit.
  const dragged = deviceBox({ width: 1600, height: 1000 }, "app", { width: 700, height: 500 });
  assert.deepEqual([dragged.width, dragged.height, dragged.scale], [700, 530, 1]);
  // The phone: its own width, never scaled.
  const phone = deviceBox({ width: 600, height: 700 }, "phone");
  assert.deepEqual([phone.width, phone.height, phone.scale], [390, 680, 1]);
  assert.equal(phone.left, 95);
  assert.deepEqual([deviceBox({ width: 600, height: 900 }, "phone").width, deviceBox({ width: 600, height: 900 }, "phone").height], [390, 844]);
});

test("the first visit and the local host's scenario reach every state of this computer, and an app with no install seam", async () => {
  const STATES = ["absent", "not-installed", "stopped-by-person", "starting", "backoff", "failed", "service-failed", "refused", "incompatible", "running"];
  const scenarios = await loadMockScenarios();
  for (const id of ["first-visit", "desktop-local-host"]) {
    const shipped = scenarios.find((s) => s.id === id);
    const option = shipped.options.find((o) => o.id === "localState");
    assert.deepEqual([...new Set(option.values.map((v) => v.set["local.state"]))].sort(), [...STATES].sort(), id);
    assert.ok(option.values.some((v) => v.set["local.commandRun"] === true), id);
    for (const value of option.values) {
      const status = localStatus(stateFor(shipped, choicesFor(shipped, { localState: value.value })).local, 0);
      assert.equal(status.state, value.set["local.state"], `${id} ${value.value}`);
    }
    for (const [appInstalls, offered] of [["no", false], ["yes", true]]) {
      const world = createWorld(shipped, { appInstalls }, instant);
      const host = desktopHost(world, await makeIdentities(world.state));
      assert.equal(typeof host.localHost.install === "function", offered, `${id} ${appInstalls}`);
    }
  }
  // Every scenario's app installs, as the desktop app does.
  for (const shipped of scenarios) {
    const world = createWorld(shipped, {}, instant);
    assert.equal(typeof desktopHost(world, await makeIdentities(world.state)).localHost.install, "function", shipped.id);
  }
});
