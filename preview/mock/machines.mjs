// The mocked preview's machines: each one a node as sidevoice-core answers the routes the web asks (its
// `/api/rendezvous`, its identity, pairing and devices, the presentation's reads), at the addresses a person's setup
// has: directly (`https://<id>.machines.sidevoice.example`), through the room's relay (`<room>/nodes/<id>`), and,
// for the desktop app's own host, its per-launch proxy on loopback. Identities are real P-256 keys, made per
// load: the web proves them, and redeems codes for them, with its own code. Where the world says a machine cannot
// be reached at an address, asking it there fails as a network does.
//
// The shapes are the core's: the conformance test (test/mock-conformance.test.mjs) asks the real one the same.
// The web's own types for them (web-types.d.ts) check these modules against each web commit built (web-build.mjs).
// @ts-check

/** @typedef {import("./web-types").Pairing} Pairing */
/** @typedef {import("./web-types").PairingCodePayload} PairingCodePayload */
/** @typedef {import("./web-types").Participant} Participant */

export const ROOM_URL = "https://room.sidevoice.example";
export const LOCAL_ID = "local";
export const LOCAL_URL = "http://127.0.0.1:47123";
export const directUrl = (id) => `https://${id}.machines.sidevoice.example`;
/** The code variants the card offers for a machine. */
export const CODE_VARIANTS = ["valid", "expired", "used", "plaintext", "damaged", "impostor"];
const API = 1;
const IDENTITY_PREFIX = "sidevoice-node-identity:";
const NOT_PAIRED = "This device is not paired with the core.";
const DAY = 86_400;

/** @param {ArrayBuffer | Uint8Array} bytes */
function base64(bytes) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
}
/** @param {ArrayBuffer | Uint8Array} bytes */
function base64url(bytes) {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const utf8 = (text) => new TextEncoder().encode(text);
const randomId = () => crypto.randomUUID();
const secretText = () => base64url(crypto.getRandomValues(new Uint8Array(24)));

/** A node's identity: a P-256 key pair, its SPKI (base64) and fingerprint (base64url of its SHA-256). */
export async function makeIdentity(subtle = crypto.subtle) {
  const keys = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const spki = await subtle.exportKey("spki", keys.publicKey);
  return {
    privateKey: keys.privateKey,
    publicKey: base64(spki),
    fingerprint: base64url(await subtle.digest("SHA-256", spki)),
    token: secretText(),
    deviceId: randomId(),
  };
}

/** Identities for every machine of `state` and the local host, plus a stranger's (what an impostor answers with). */
export async function makeIdentities(state, subtle = crypto.subtle) {
  const ids = [...Object.keys(state.machines ?? {}), LOCAL_ID, "stranger"];
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await makeIdentity(subtle)])));
}

/** The machine `id` of `state`: one of its machines, or the local host while the app has one. */
export function machineOf(state, id) {
  return id === LOCAL_ID ? (state.local ? { ...state.local, host: state.local.computerName } : null) : state.machines?.[id] ?? null;
}

/** What this device keeps of its pairing with machine `id` (device-pairing.js's `Pairing`).
 * @returns {Pairing} */
export function storedPairing(state, identities, id, now) {
  const machine = state.machines[id];
  const identity = identities[id];
  return {
    fp: identity.fingerprint, public_key: identity.publicKey, host: machine.host, urls: [directUrl(id)],
    rv: { url: ROOM_URL, node: id }, device_id: identity.deviceId, token: identity.token,
    paired_at: Math.floor(now / 1000) - Math.round((machine.pairedDaysAgo ?? 1) * DAY),
  };
}

/** What the page keeps in its storage when it loads in `state`: its pairings, the one in use, the local host's choice. */
export function seededStorage(state, identities, now, { desktop = false } = {}) {
  const paired = Object.keys(state.machines ?? {}).filter((id) => state.machines[id].paired);
  const inUse = paired.find((id) => state.machines[id].inUse) ?? paired[0] ?? null;
  const local = {
    "sidevoice.pairings": JSON.stringify({
      in_use: desktop && state.local?.inUse ? identities[LOCAL_ID].fingerprint : inUse ? identities[inUse].fingerprint : null,
      pairings: paired.map((id) => storedPairing(state, identities, id, now)),
    }),
  };
  if (desktop && state.local?.inUse) local["sidevoice.local-host-selected"] = "true";
  if (state.language) local["sidevoice.settings"] = JSON.stringify({ ui_language: state.language });
  return local;
}

/**
 * The secrets the codes minted so far carry, by secret: `{ id, used, impostor }`. One per world: `codes(world)`.
 */
const minted = new WeakMap();
export function codes(world) {
  if (!minted.has(world)) minted.set(world, new Map());
  return minted.get(world);
}

/** A pairing code for machine `id` (`SV1.` + base64url JSON), as `variant` (CODE_VARIANTS) says. */
export function mintCode(world, identities, id, variant = "valid") {
  const machine = machineOf(world.state, id);
  const secret = secretText();
  const now = Math.floor(world.now() / 1000);
  /** @type {PairingCodePayload} */
  const payload = {
    v: 1, fp: identities[id].fingerprint, host: machine?.host ?? null,
    urls: id === LOCAL_ID ? [LOCAL_URL] : [directUrl(id)],
    rv: id === LOCAL_ID && world.state.local?.reach === "local-only" ? null : { url: ROOM_URL, node: id },
    secret, exp: now + 600,
  };
  if (variant === "expired") payload.exp = now - 60;
  if (variant === "plaintext") {
    payload.urls = ["http://192.168.1.20:8765"];
    payload.rv = null;
  }
  codes(world).set(secret, { id, used: variant === "used", impostor: variant === "impostor" });
  const code = "SV1." + base64url(utf8(JSON.stringify(payload)));
  return variant === "damaged" ? code.slice(0, Math.floor(code.length * 0.6)) : code;
}

/** Where `url` is: `{ id, via, path }` for a machine's address, `{ room: true, path }` for the room's own, `{ page: true }`. */
export function placeOf(url, pageOrigin) {
  const parsed = new URL(url, pageOrigin);
  const path = parsed.pathname;
  const query = parsed.search;
  if (parsed.origin === ROOM_URL) {
    const relay = path.match(/^\/nodes\/([^/]+)(\/.*)?$/);
    return relay ? { id: decodeURIComponent(relay[1]), via: "room", path: relay[2] ?? "/", query } : { room: true, path, query };
  }
  if (parsed.origin === LOCAL_URL) return { id: LOCAL_ID, via: "local", path, query };
  const direct = parsed.hostname.match(/^([a-z0-9-]+)\.machines\.sidevoice\.example$/);
  if (direct && parsed.protocol === "https:") return { id: direct[1], via: "direct", path, query };
  if (parsed.origin === pageOrigin) {
    // A page a room serves reaches the room's relay on its own origin.
    const relay = path.match(/^\/nodes\/([^/]+)(\/.*)?$/);
    if (relay) return { id: decodeURIComponent(relay[1]), via: "room", path: relay[2] ?? "/", query, onPage: true };
    return { page: true, path, query };
  }
  return null;
}

/** Whether the world lets machine `id` answer at `via`. */
function answers(state, id, via) {
  const machine = machineOf(state, id);
  if (!machine) return false;
  if (id === LOCAL_ID) return via === "local" ? machine.state === "running" : machine.state === "running" && machine.reach !== "local-only";
  if (via === "direct") return machine.reach === "direct";
  return machine.reach === "direct" || machine.reach === "room";
}

const json = (status, body) => ({ status, body });
const refuse = (status, detail) => json(status, { detail });

/**
 * The answer to one request, from the world: `{ status, body }`, `{ unreachable: true }` (the network failed), or
 * null (not one of the mocked addresses: the request goes where it was going).
 */
export async function answer(world, identities, { method = "GET", url, headers = {}, body = null, pageOrigin }) {
  const place = placeOf(url, pageOrigin);
  if (!place) return null;
  const state = world.state;
  if (place.page) {
    if (!place.path.startsWith("/api/")) return null;
    if (place.path === "/api/rendezvous") {
      if (state.page === "room") return roomRendezvous(state, place.query);
      const id = state.page;
      if (machineOf(state, id) && answers(state, id, "direct")) return json(200, { kind: "node", fingerprint: identities[id].fingerprint, api: API });
      return refuse(404, "The requested resource was not found.");
    }
    return refuse(404, "The requested resource was not found.");
  }
  if (place.room) {
    if (place.path === "/api/rendezvous") return roomRendezvous(state, place.query);
    return refuse(404, "The requested resource was not found.");
  }
  if (place.onPage && state.page !== "room") return refuse(404, "The requested resource was not found.");
  if (!answers(state, place.id, place.via)) {
    // The room answers for its relay; a machine's own address that does not answer is no answer at all.
    return place.via === "room" ? refuse(503, "That machine is not connected to the room.") : { unreachable: true };
  }
  return machineAnswer(world, identities, place.id, { method, path: place.path, query: place.query, headers, body });
}

function roomRendezvous(state, query) {
  const asked = new URLSearchParams(query).get("nodes");
  if (asked == null) return json(200, { kind: "room" });
  const nodes = asked.split(",").flatMap((id) => {
    const machine = machineOf(state, id);
    if (!machine || machine.reach === "away") return [];
    return [{ id, connected: answers(state, id, "room") }];
  });
  return json(200, { nodes });
}

async function machineAnswer(world, identities, id, { method, path, query, headers, body }) {
  const state = world.state;
  const machine = machineOf(state, id);
  const identity = identities[id];
  if (method === "GET" && path === "/api/rendezvous") return json(200, { kind: "node", fingerprint: identity.fingerprint, api: API });
  if (method === "GET" && path === "/api/device/identity") {
    const nonce = new URLSearchParams(query).get("nonce") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) return refuse(400, "The identity challenge is invalid.");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, utf8(IDENTITY_PREFIX + nonce));
    return json(200, { fingerprint: identity.fingerprint, public_key: identity.publicKey, signature: base64url(signature) });
  }
  if (method === "POST" && path === "/api/device/pair") {
    let request = null;
    try {
      request = JSON.parse(body ?? "");
    } catch {
      return refuse(400, "The pairing secret is invalid.");
    }
    const code = codes(world).get(request?.secret);
    if (!code || code.id !== id || code.used) return refuse(403, "The pairing secret is invalid.");
    code.used = true;
    const node = code.impostor ? identities.stranger : identity;
    if (id !== LOCAL_ID) {
      world.patch({
        [`machines.${id}.revoked`]: false,
        [`machines.${id}.devices`]: [...(machine.devices ?? []), { name: request.name ?? "Sidevoice", kind: "code", daysAgo: 0, mine: true }],
      });
    }
    return json(200, {
      device_id: identity.deviceId, token: identity.token,
      node: { fingerprint: node.fingerprint, public_key: node.publicKey, host: machine.host ?? null },
    });
  }
  // Everything else is this device's, with its token.
  const token = /^Bearer (.+)$/.exec(headers.authorization ?? headers.Authorization ?? "")?.[1];
  if (token !== identity.token || machine.revoked) return refuse(401, NOT_PAIRED);
  const now = Math.floor(world.now() / 1000);
  if (method === "GET" && path === "/api/device/devices") {
    const devices = (machine.devices ?? []).map((device, i) => ({
      id: device.mine ? identity.deviceId : device.id ?? `${id}-device-${i}`,
      name: device.name, kind: device.kind ?? "code",
      created: now - Math.round((device.daysAgo ?? 0) * DAY), last_seen: now - Math.round((device.seenDaysAgo ?? 0) * DAY),
      current: !!device.mine,
    }));
    return json(200, { devices });
  }
  const revoke = path.match(/^\/api\/device\/devices\/([^/]+)$/);
  if (method === "DELETE" && revoke) {
    const deviceId = decodeURIComponent(revoke[1]);
    const devices = machine.devices ?? [];
    const kept = devices.filter((device, i) => (device.mine ? identity.deviceId : device.id ?? `${id}-device-${i}`) !== deviceId);
    if (kept.length === devices.length) return refuse(404, "That device is not paired with the core.");
    if (id !== LOCAL_ID) world.patch({ [`machines.${id}.devices`]: kept });
    return json(200, { ok: true });
  }
  if (method === "GET" && path === "/api/presentation") {
    return json(200, {
      binding: null,
      room: { revision: 0, speaking: false, switching: false, clients: 0, utterances: [], client_errors: [] },
      clients: [], call: null,
    });
  }
  if (method === "GET" && path === "/api/presentation/history") return json(200, { messages: [] });
  if (method === "GET" && path === "/api/presentation/participants") return json(200, { participants: participantsOf(machine, id) });
  if (method === "GET" && path === "/api/presentation/admission") {
    return json(200, { admitted: true, reason: null, message: null, clients: 0, max: 8 });
  }
  if (method === "GET" && path === "/api/presentation/latency") return refuse(404, "That browser is not in the room.");
  return refuse(404, "The requested resource was not found.");
}

/** What a harness says it can do, as the room passes it on (sidevoice-core control/room/declaration.rs). */
const CAPABILITIES = ["deliver", "inspectInbound", "working", "endOfTurn", "sessionIdentity"];

/** Machine `id`'s conversations, as the room lists them (protocol `Participant`, and the room's own fields:
 * the machine, what the harness can do, its engine and route; sidevoice-core control/room/participants.rs).
 * @returns {Participant[]} */
export function participantsOf(machine, id) {
  return (machine?.participants ?? []).map((p, i) => ({
    thread_id: p.thread_id ?? `${id}-thread-${i + 1}`, title: p.title, harness: p.harness ?? null,
    available: p.reach !== "offline", selected: false,
    machine: { id: `${id}-connector`, host: machine.host ?? null },
    capabilities: p.capabilities ?? Object.fromEntries(CAPABILITIES.map((key) => [key, "supported"])),
    engine: p.engine ?? null, route: p.route ?? null,
    reach: { state: p.reach ?? "listening", detail: p.detail ?? null, remedy: p.remedy ?? null },
  }));
}
