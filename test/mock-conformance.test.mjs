// The mocked machines against the matching candidate core (room-only, no models) and connector,
// asked the same routes as the mocks, in the same order — a code, its redemption, the device's own routes. Every
// answer the mocks give must have the core's status, and nothing the core's answer lacks or types otherwise (the
// core may say more). Lists the core leaves empty (no agents here) are checked by the protocol's types instead
// (web-build.mjs). Set PLAYGROUND_CONFORMANCE=1 and both candidate binary paths to run it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { connectorEnv, coreLaunch, profileOf } from "../preview/runs.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { answer, directUrl, makeIdentities, mintCode } from "../preview/mock/machines.mjs";

const ORIGIN = "http://localhost:5199";

/** Where `mock` has what `real` lacks, or types otherwise: a list of paths. */
export function shapeDifferences(mock, real, path = "$") {
  const kind = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
  if (real === null || mock === null) return [];
  if (kind(mock) !== kind(real)) return [`${path}: ${kind(mock)} where the core has ${kind(real)}`];
  if (kind(mock) === "array") return mock.length && real.length ? shapeDifferences(mock[0], real[0], `${path}[0]`) : [];
  if (kind(mock) !== "object") return [];
  return Object.keys(mock).flatMap((key) =>
    key in real ? shapeDifferences(mock[key], real[key], `${path}.${key}`) : [`${path}.${key}: the core has no such field`]);
}

test("shapes: what the mocks have, the core has, typed alike", () => {
  assert.deepEqual(shapeDifferences({ a: 1, b: [{ c: "x" }] }, { a: 2, b: [{ c: "y", d: 1 }], e: 0 }), []);
  assert.deepEqual(shapeDifferences({ a: "1" }, { a: 1 }), ["$.a: string where the core has number"]);
  assert.deepEqual(shapeDifferences({ z: 1 }, {}), ["$.z: the core has no such field"]);
});

const REQUESTED = process.env.PLAYGROUND_CONFORMANCE === "1";
const CANDIDATE = REQUESTED && process.env.PLAYGROUND_CORE_BIN && process.env.PLAYGROUND_CONNECTOR_BIN;

test("requested candidate conformance has both binaries", { skip: !REQUESTED }, () => {
  assert.ok(process.env.PLAYGROUND_CORE_BIN, "PLAYGROUND_CORE_BIN is required");
  assert.ok(process.env.PLAYGROUND_CONNECTOR_BIN, "PLAYGROUND_CONNECTOR_BIN is required");
});

async function checkedCandidate(kind, program, sha) {
  const dir = dirname(dirname(dirname(program)));
  const receipt = JSON.parse(await readFile(join(dir, "binary.json"), "utf8"));
  const digest = createHash("sha256").update(await readFile(program)).digest("hex");
  assert.deepEqual({ sha: receipt.sha, digest: receipt.digest, kind: receipt.kind }, { sha, digest, kind });
  return { program };
}

test("the mocked machines answer as the pinned candidate core does", { skip: !CANDIDATE && "set PLAYGROUND_CONFORMANCE=1 plus both candidate binary paths", timeout: 300_000 }, async () => {
  const config = JSON.parse(await readFile(new URL("../preview/turn-lab.config.json", import.meta.url), "utf8"));
  const work = await mkdtemp(join(tmpdir(), "mock-conformance-"));
  const [core, connector] = await Promise.all([
    checkedCandidate("core", process.env.PLAYGROUND_CORE_BIN, config.core),
    checkedCandidate("connector", process.env.PLAYGROUND_CONNECTOR_BIN, config.connector),
  ]);
  const profile = profileOf(join(work, "profile"));
  for (const dir of [profile.home, profile.xdgConfig, profile.xdgData, profile.core]) await mkdir(dir, { recursive: true, mode: 0o700 });
  const launch = coreLaunch(core.program, profile, ORIGIN);
  const child = spawn(launch.command, launch.args, { env: launch.env, stdio: "ignore" });
  try {
    let port = null;
    for (let i = 0; i < 150 && port === null; i++) {
      await new Promise((r) => setTimeout(r, 100));
      port = JSON.parse(await readFile(join(profile.core, "core.json"), "utf8").catch(() => "{}")).port ?? null;
    }
    assert.ok(port, "the core is ready");
    const real = async (path, init = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...init, headers: { host: new URL(ORIGIN).host, origin: ORIGIN, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      return { status: response.status, body: await response.json() };
    };
    const { stdout } = await promisify(execFile)(connector.program, ["pair-device", "--json"], { env: connectorEnv(profile) });
    const realCode = JSON.parse(stdout).code;

    const world = createWorld({ id: "c", title: "c", summary: "c", options: [], world: {
      page: "room", machines: { nuc: { host: "NUC", reach: "direct", paired: false, devices: [], participants: [] } }, local: null,
    } });
    const identities = await makeIdentities(world.state);
    const mock = (path, init = {}) => answer(world, identities, { pageOrigin: ORIGIN, url: `${directUrl("nuc")}${path}`, ...init });
    const secretOf = (code) => JSON.parse(Buffer.from(code.slice(4), "base64url")).secret;

    const asked = [];
    const both = async (label, path, realInit, mockInit = realInit) => {
      const [r, m] = await Promise.all([real(path, realInit), mock(path, mockInit)]);
      asked.push(label);
      assert.equal(m.status, r.status, `${label}: status`);
      assert.deepEqual(shapeDifferences(m.body, r.body), [], `${label}: shape`);
      return { real: r, mock: m };
    };
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    await both("rendezvous", "/api/rendezvous", {});
    await both("identity", `/api/device/identity?nonce=${nonce}`, {});
    await both("identity, a bad nonce", "/api/device/identity?nonce=x", {});
    const mockCode = mintCode(world, identities, "nuc");
    const pairBody = (code) => ({ method: "POST", body: JSON.stringify({ secret: secretOf(code), name: "conformance" }) });
    const paired = await both("pair", "/api/device/pair", pairBody(realCode), pairBody(mockCode));
    await both("pair again", "/api/device/pair", pairBody(realCode), pairBody(mockCode));
    const realAuth = { headers: { authorization: `Bearer ${paired.real.body.token}` } };
    const mockAuth = { headers: { authorization: `Bearer ${paired.mock.body.token}` } };
    world.patch({ "machines.nuc.devices": [{ name: "conformance", mine: true }] });
    for (const path of ["/api/device/devices", "/api/presentation", "/api/presentation/history", "/api/presentation/participants",
      "/api/presentation/admission", "/api/presentation/latency"]) {
      await both(path, path, realAuth, mockAuth);
    }
    await both("no token", "/api/presentation", {});
    await both("revoke a device it does not have", "/api/device/devices/nope", { method: "DELETE", ...realAuth }, { method: "DELETE", ...mockAuth });
    assert.equal(asked.length, 13);
    await promisify(execFile)(connector.program, ["service", "stop", "--json"], { env: connectorEnv(profile) }).catch(() => {});
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode !== null ? r() : child.once("exit", r)));
    await rm(work, { recursive: true, force: true });
  }
});
