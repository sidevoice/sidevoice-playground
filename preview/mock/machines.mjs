// The mocked preview's machines: each one a node as sidevoice-core answers the routes the web asks (its
// `/api/rendezvous`, its identity, pairing and devices, the presentation's reads), at the addresses a person's setup
// has: directly (`https://<id>.machines.sidevoice.example`), through the room's relay (`<room>/nodes/<id>`), and,
// for the desktop app's own host, its per-launch proxy on loopback. Identities are real P-256 keys, made per
// load: the web proves them, and redeems codes for them, with its own code. Where the world says a machine cannot
// be reached at an address, asking it there fails as a network does. Each machine's presentation room holds the
// page's calls too (`callSocket`, behind the page's mocked WebSocket in attach.mjs): see "the room" below.
//
// The shapes are the core's: the conformance test (test/mock-conformance.test.mjs) asks the real one the same.
// The web's own types for them (web-types.d.ts) check these modules against each web commit built (web-build.mjs).
// @ts-check

/** @typedef {import("./web-types").Pairing} Pairing */
/** @typedef {import("./web-types").PairingCodePayload} PairingCodePayload */
/** @typedef {import("./web-types").Participant} Participant */
/** @typedef {import("./web-types").RoomBinding} RoomBinding */
/** @typedef {import("./web-types").VoiceReply} VoiceReply */
/** @typedef {import("./web-types").VoiceSession} VoiceSession */

export const ROOM_URL = "https://room.sidevoice.example";
export const LOCAL_ID = "local";
export const LOCAL_URL = "http://127.0.0.1:47123";
export const directUrl = (id) => `https://${id}.machines.sidevoice.example`;
/** The code variants the card offers for a machine. */
export const CODE_VARIANTS = ["valid", "expired", "used", "plaintext", "damaged", "impostor"];
const API = 1;
const IDENTITY_PREFIX = "sidevoice-node-identity:";
const NOT_PAIRED = "This device is not paired with the core.";
const NOT_A_DEVICE = "That device is not paired with the core.";
/** The longest name a device may be given. */
const DEVICE_NAME_MAX = 60;
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

/** A node's identity: a P-256 key pair, its SPKI (base64) and fingerprint (base64url of its SHA-256). Its private key
 *  can be exported (`saveIdentities`): the page keeps pairings with it, and a preview reloaded keeps them. */
export async function makeIdentity(subtle = crypto.subtle) {
  const keys = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
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

/** `identities` as plain data (JSON), each private key as a JWK: what `loadIdentities` makes them again from. */
export async function saveIdentities(identities, subtle = crypto.subtle) {
  return Object.fromEntries(await Promise.all(Object.entries(identities).map(async ([id, { privateKey, ...rest }]) =>
    [id, { ...rest, privateJwk: await subtle.exportKey("jwk", privateKey) }])));
}

/** The identities `saveIdentities` gave. */
export async function loadIdentities(saved, subtle = crypto.subtle) {
  return Object.fromEntries(await Promise.all(Object.entries(saved).map(async ([id, { privateJwk, ...rest }]) =>
    [id, { ...rest, privateKey: await subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]) }])));
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

/** What the page keeps in its storage when it loads in `state`: its pairings, the one in use, the local host's choice,
 *  and whether its first-run setup was done. */
/** The web's release counter (sidevoice-web features/whats-new/catalogue.ts RELEASE): a setup done on it has nothing new. */
const WEB_RELEASE = 2;

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
  // This device's name (sidevoice-web's device-name setting): the one this device has in its machines' lists.
  const mine = Object.values(state.machines ?? {}).flatMap((machine) => machine.devices ?? []).find((device) => device.mine)?.name;
  if (mine) local["sidevoice.deviceName"] = mine;
  // The first-run setup (sidevoice-web's onboarding-state.ts): "done" finished it on this device on this release, so the
  // page opens on the room; "earlier" finished it on the release before, so the room shows what is new since
  // (whats-new); anything else leaves the page to run it.
  if (state.setup === "done" || state.setup === "earlier") local["sidevoice.onboarding"] = JSON.stringify({
    version: 1, basics_done: true, choice: desktop && state.local?.inUse ? "agents" : "remote", agents_done: true, turn_done: true,
    deferred_at: null, completed_at: now - DAY * 1000, trials: {}, baseline_release: state.setup === "earlier" ? WEB_RELEASE - 1 : WEB_RELEASE,
  });
  if (state.language) local["sidevoice.settings"] = JSON.stringify({ ui_language: state.language });
  for (const [provider, key] of Object.entries(state.voice?.keys ?? {})) {
    if (!key) continue;
    // In the browser the page keeps the provider keys (the app keeps its own); in both, its note of the last four of
    // each key it connected (sidevoice-web ProviderKeys' hint).
    if (!desktop) local[`sidevoice.provider-key.${provider}`] = key;
    local[`sidevoice.provider-key-hint.${provider}`] = JSON.stringify({ last4: key.slice(-4), addedAt: now - 20 * DAY * 1000 });
  }
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

/* How each agent takes Sidevoice, as the real connector handles them (sidevoice-connector agents.rs, agents/*.rs): an
 * agent with a CLI is connected through it (`<cli> mcp add`), and the connector can act only where that CLI is found;
 * one configured by a file (Cursor's mcp.json, …) is edited by the connector itself, so it can always act. Each says
 * how to do it by hand (sidevoice-web #75's DetectedAgent.manual: connect, disconnect, replace — a gap in the real
 * connector), in order. */
const OURS = "npx sidevoice@latest mcp";
/** An agent connected through its CLI (`scope`: Claude Code's user scope). */
const byCli = (cli, scope = "") => {
  const add = { command: `${cli} mcp add${scope} sidevoice -- ${OURS}` }, remove = { command: `${cli} mcp remove${scope} sidevoice` };
  return { cli, manual: { connect: [add], disconnect: [remove], replace: [remove, add] }, instructions: add, removal: remove };
};
/** An agent configured by a file the connector edits itself. */
const byFile = (file, snippet, under) => {
  const add = { file, snippet }, remove = { file, snippet: `Delete the "sidevoice" entry under "${under}".` };
  return { manual: { connect: [add], disconnect: [remove], replace: [{ file, snippet: `Delete the other "sidevoice" entry under "${under}".` }, add] }, instructions: add, removal: remove };
};
const MCP_SERVERS = '{ "mcpServers": { "sidevoice": { "command": "npx", "args": ["sidevoice@latest", "mcp"] } } }';
/** The agents the connector knows (Claude Code, Codex, Cursor) and more harnesses a person may have, as found
 *  installed. Where each one stands is the machine's. */
const KNOWN_AGENTS = {
  claude: { id: "claude", label: "Claude Code", present: true, version: "2.1.4", ...byCli("claude", " --scope user") },
  codex: { id: "codex", label: "Codex", present: true, version: "0.48.0", ...byCli("codex") },
  cursor: { id: "cursor", label: "Cursor", present: true, version: "1.7", ...byFile("~/.cursor/mcp.json", MCP_SERVERS, "mcpServers") },
  gemini: { id: "gemini", label: "Gemini CLI", present: true, version: "0.9.0", ...byCli("gemini") },
  opencode: { id: "opencode", label: "OpenCode", present: true, version: "0.15.2",
    ...byFile("~/.config/opencode/opencode.json", '{ "mcp": { "sidevoice": { "type": "local", "command": ["npx", "sidevoice@latest", "mcp"] } } }', "mcp") },
  windsurf: { id: "windsurf", label: "Windsurf", present: true, version: "1.12.4", ...byFile("~/.codeium/windsurf/mcp_config.json", MCP_SERVERS, "mcpServers") },
  zed: { id: "zed", label: "Zed", present: true, version: "0.208.4",
    ...byFile("~/.config/zed/settings.json", '"context_servers": { "sidevoice": { "command": "npx", "args": ["sidevoice@latest", "mcp"] } }', "context_servers") },
  goose: { id: "goose", label: "Goose", present: true, version: "1.9.3",
    ...byFile("~/.config/goose/config.yaml", "extensions:\n  sidevoice:\n    type: stdio\n    cmd: npx\n    args: [sidevoice@latest, mcp]\n    enabled: true", "extensions") },
  amp: { id: "amp", label: "Amp", present: true, version: "0.0.1760", ...byCli("amp") },
  copilot: { id: "copilot", label: "GitHub Copilot CLI", present: true, version: "0.0.339",
    ...byFile("~/.copilot/mcp-config.json", '{ "mcpServers": { "sidevoice": { "type": "local", "command": "npx", "args": ["sidevoice@latest", "mcp"], "tools": ["*"] } } }', "mcpServers") },
  kiro: { id: "kiro", label: "Kiro", present: true, version: "0.4.0", ...byFile("~/.kiro/settings/mcp.json", MCP_SERVERS, "mcpServers") },
  continue: { id: "continue", label: "Continue", present: true, version: "1.2.0",
    ...byFile("~/.continue/config.yaml", "mcpServers:\n  - name: sidevoice\n    command: npx\n    args: [sidevoice@latest, mcp]", "mcpServers") },
};
/** A machine's agents when its scenario names none: one connected, one just found and not yet connected (new), and
 *  one to connect by hand. */
const DEFAULT_AGENTS = [
  { id: "claude", registration: "connected", actionable: false },
  { id: "codex", registration: "not-connected", actionable: true },
  { id: "cursor", registration: "not-connected", actionable: false },
];
// (Cursor is connected by the connector editing its file: never by hand only. By hand only is an agent whose CLI the
// connector cannot find — `cliFound: false`.)
/** Lists a scenario names (`"agents": "<name>"`) instead of giving its rows. `every-state`: one agent in each state the
 *  web shows one in — connected; not connected; just found (new); set up by an older Sidevoice (outdated); another
 *  "sidevoice" entry (foreign); MCP settings it cannot read (invalid); unknown; by hand only; one whose Connect takes
 *  8 s; one whose Connect fails; connected but no longer installed; and one not installed, which the web hides. */
const AGENT_LISTS = {
  "every-state": [
    { id: "claude", registration: "connected", actionable: false },
    { id: "gemini", registration: "not-connected", actionable: true },
    { id: "codex", registration: "not-connected", actionable: false, cliFound: false },
    { id: "opencode", registration: "outdated", actionable: false },
    { id: "windsurf", registration: "foreign", actionable: false },
    { id: "zed", registration: "invalid", actionable: false },
    { id: "goose", registration: "unknown", actionable: false },
    { id: "cursor", registration: "not-connected", actionable: false },
    { id: "amp", registration: "not-connected", actionable: false, connectMs: 8000 },
    { id: "copilot", registration: "not-connected", actionable: false, connectMs: 1500, connectFails: "connect-failed" },
    { id: "kiro", registration: "connected", actionable: false, present: false, version: null },
    { id: "continue", registration: "not-connected", actionable: false, present: false, version: null },
  ],
};

/** A machine's agents as its scenario (or an action) left them: rows of at least `id` and `registration`, and, for the
 *  mock alone, how long its Connect takes (`connectMs`) and the error key it fails with (`connectFails`). */
export function agentsOf(machine) {
  const agents = machine?.agents ?? DEFAULT_AGENTS;
  return typeof agents === "string" ? AGENT_LISTS[agents] ?? [] : agents;
}

/** Agents as the connector lists them: each row a scenario (or an action) gives over what the connector knows of
 *  that agent, without what is the mock's alone. */
export function agentRows(agents) {
  return agents.map(({ connectMs, connectFails, cliFound = true, ...agent }) => {
    const { cli, ...known } = KNOWN_AGENTS[agent.id] ?? {};
    // The connector acts where it can reach the agent: its CLI found, or its file.
    const able = !cli || cliFound;
    return { ...known, connect: able ? "auto" : "manual", can: { connect: able, update: able, disconnect: able }, ...agent };
  });
}

/** How the core refuses an agents request its connector could not answer (sidevoice-core connector_routes), by key;
 *  any other key is the connector's own error, which the core passes on with 409. */
const AGENT_FAILURES = { "no-connector": 503, "connector-unavailable": 502, "connector-timeout": 504 };
const agentFailure = (key, params) =>
  key in AGENT_FAILURES ? json(AGENT_FAILURES[key], { key }) : json(409, { error: { key, ...(params ? { params } : {}) } });

/** Machine `machine`'s agents as `GET /api/host/agents` answers: the listing, or, where the scenario makes the scan
 *  fail (`agentsFail`: a key), that failure after a moment of searching. */
export async function agentsListing(world, machine) {
  if (machine?.agentsFail) {
    await world.delay(1500);
    return agentFailure(machine.agentsFail);
  }
  return json(200, { agents: agentRows(agentsOf(machine)), scanned_at: new Date(world.now()).toISOString() });
}

/** Where machine `id` is in the world's state: what a mock's action on it patches. */
const statePath = (id) => (id === LOCAL_ID ? "local" : `machines.${id}`);

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
  // The coding agents this machine found (sidevoice-web HostAgentsPanel): a listing, and connect / disconnect / dismiss,
  // each answering with the listing as it is after it. A scenario may set `machines.<id>.agents` (`local.agents`): its
  // rows, or the name of a list (`AGENT_LISTS`); and `agentsFail`, a key the scan fails with.
  // Its Sidevoice's version (sidevoice-web #75's machine card; core has no such route yet): the scenario's
  // (`productVersion`), null when it does not know it.
  if (method === "GET" && path === "/api/host/status") return json(200, { version: machine.productVersion ?? null });
  if (method === "GET" && path === "/api/host/agents") return agentsListing(world, machine);
  const agentAction = /^\/api\/host\/agents\/([^/]+)\/(connect|disconnect|dismiss)$/.exec(path);
  if (method === "POST" && agentAction) {
    const [, rawId, action] = agentAction;
    const agentId = decodeURIComponent(rawId);
    const asked = agentsOf(machine).find((agent) => agent.id === agentId);
    // A Connect takes what the agent's row says, and may fail as the connector says it (409, its key and the agent).
    // Its CLI not found: the connector cannot act on it (the page offers the steps by hand instead).
    if (asked?.cliFound === false && action !== "dismiss") return agentFailure("agents.cli-missing", { id: agentId, agent: agentRows([asked])[0].label ?? agentId });
    if (action === "connect" && asked?.connectMs) await world.delay(asked.connectMs);
    if (action === "connect" && asked?.connectFails) {
      return agentFailure(asked.connectFails, { id: agentId, agent: agentRows([asked])[0].label ?? agentId });
    }
    // The rows as they are now: others may have changed them while this one took its time.
    const agents = agentsOf(machineOf(world.state, id)).map((agent) => agent.id !== agentId ? agent
      : action === "dismiss" ? { ...agent, dismissed: true, actionable: false }
      : { ...agent, registration: action === "connect" ? "connected" : "not-connected", actionable: action !== "connect" });
    world.patch({ [`${statePath(id)}.agents`]: agents });
    return json(200, { agents: agentRows(agents), scanned_at: new Date(world.now()).toISOString() });
  }
  // A device's id: this device's is its pairing's, any other the scenario's, or one by its place in the list.
  const deviceIdOf = (device, i) => (device.mine ? identity.deviceId : device.id ?? `${id}-device-${i}`);
  if (method === "GET" && path === "/api/device/devices") {
    const devices = (machine.devices ?? []).map((device, i) => ({
      id: deviceIdOf(device, i),
      name: device.name, kind: device.kind ?? "code",
      created: now - Math.round((device.daysAgo ?? 0) * DAY), last_seen: now - Math.round((device.seenDaysAgo ?? 0) * DAY),
      current: !!device.mine,
    }));
    return json(200, { devices });
  }
  const oneDevice = path.match(/^\/api\/device\/devices\/([^/]+)$/);
  if (method === "DELETE" && oneDevice) {
    const deviceId = decodeURIComponent(oneDevice[1]);
    const devices = machine.devices ?? [];
    const kept = devices.filter((device, i) => deviceIdOf(device, i) !== deviceId);
    if (kept.length === devices.length) return refuse(404, NOT_A_DEVICE);
    world.patch({ [`${statePath(id)}.devices`]: kept });
    return json(200, { ok: true });
  }
  // Renaming a device, this one too (sidevoice-web's renameMachineDevice and renameLocalHostDevice): `{ name }`, kept
  // trimmed, 1 to 60 characters.
  if (method === "PATCH" && oneDevice) {
    const deviceId = decodeURIComponent(oneDevice[1]);
    const asked = parsed(body).name;
    const name = typeof asked === "string" ? asked.trim() : "";
    if (!name || [...name].length > DEVICE_NAME_MAX) return refuse(400, `The device name must be 1 to ${DEVICE_NAME_MAX} characters.`);
    const devices = machine.devices ?? [];
    const at = devices.findIndex((device, i) => deviceIdOf(device, i) === deviceId);
    if (at < 0) return refuse(404, NOT_A_DEVICE);
    world.patch({ [`${statePath(id)}.devices`]: devices.map((device, i) => (i === at ? { ...device, name } : device)) });
    return json(200, { device_id: deviceId, name });
  }
  // The presentation's routes are the room's: each one about the call its `session_id` names, when it is one.
  if (path.startsWith("/api/presentation")) {
    const room = roomOf(world, id);
    const call = callOf(room, new URLSearchParams(query).get("session_id"));
    if (method === "GET" && path === "/api/presentation") return json(200, snapshot(room, call, identity));
    if (method === "GET" && path === "/api/presentation/history") return json(200, { messages: room.rows.map(rowView) });
    if (method === "GET" && path === "/api/presentation/participants") {
      return json(200, { participants: participantsOf(machine, id, call?.binding?.thread_id) });
    }
    if (method === "GET" && path === "/api/presentation/admission") {
      return json(200, { admitted: true, reason: null, message: null, clients: seated(room).length, max: 8 });
    }
    if (method === "POST" && path === "/api/presentation/select") return select(world, room, machine, parsed(body));
    if (method === "POST" && path === "/api/presentation/text") return typed(world, room, parsed(body));
    if (method === "GET" && path === "/api/presentation/latency") return refuse(404, "That browser is not in the room.");
  }
  return refuse(404, "The requested resource was not found.");
}

/** A request's JSON body, or an empty object. */
function parsed(body) {
  try {
    const value = JSON.parse(body ?? "");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

/** What a harness says it can do, as the room passes it on (sidevoice-core control/room/declaration.rs). */
const CAPABILITIES = ["deliver", "inspectInbound", "working", "endOfTurn", "sessionIdentity"];

/** Machine `id`'s conversations, as the room lists them (protocol `Participant`, and the room's own fields:
 * the machine, what the harness can do, its engine and route; sidevoice-core control/room/participants.rs).
 * `selected` is the conversation the asking call is on, if any.
 * @returns {Participant[]} */
export function participantsOf(machine, id, selected = null) {
  return (machine?.participants ?? []).map((p, i) => ({
    thread_id: p.thread_id ?? `${id}-thread-${i + 1}`, title: p.title, harness: p.harness ?? null,
    available: p.reach !== "offline", selected: !!selected && (p.thread_id ?? `${id}-thread-${i + 1}`) === selected,
    machine: { id: `${id}-connector`, host: machine.host ?? null },
    capabilities: p.capabilities ?? Object.fromEntries(CAPABILITIES.map((key) => [key, "supported"])),
    engine: p.engine ?? null, route: p.route ?? null,
    reach: { state: p.reach ?? "listening", detail: p.detail ?? null, remedy: p.remedy ?? null },
  }));
}

/* ----- the room: the calls a machine's presentation room holds, and what it keeps of their conversations -----
 * As sidevoice-core speaks to a call (rust/server/call, rust/control/room). The socket is the page's own mocked one
 * (attach.mjs); this is the machine's end of it. It opens where the machine answers, carrying this device's token as
 * its second subprotocol: a token it does not know is a close with 4401, a relay whose machine is away says so and
 * closes with 1013, and an address that does not answer never opens. The page's hello is answered with its session,
 * landing the call on the conversation it names; every message of the page's (a turn of the person's, how a reply
 * played) is taken once, acknowledged with `voice-ack` and answered as the room answers it; every frame after the
 * session is numbered (`seq`). The person's words become rows of the room's history, `pending` until the agent's
 * connector takes them, then `delivered` and `read` while their conversation listens. The agent is the card's: it
 * speaks (`agentSpeaks`) and works (`agentWorks`) as a connector reports it, to every call on its conversation.
 * Not mocked: a dropped call taken back (a new session answers instead), the room asking a quiet page if it is still
 * there, replays, latency. */

const CALL_PATH = "/api/presentation/ws";
const TOKEN_PREFIX = "sidevoice.token.";
/** The close of a call whose device the machine does not know (sidevoice-core server/call.rs). */
const UNPAIRED = 4401;
/** How many of a call's turns may wait for their words at once (sidevoice-core control/room/browsers.rs). */
const MAX_OPEN_TURNS = 8;
/** The room's refusals, in English as the core words them (rust/messages/en.json). */
const REFUSALS = {
  "room.request_invalid": "Invalid room request.",
  "room.turns_full": "Too many turns are still being transcribed. Wait for one to finish.",
  "room.input_ended": "The message has already ended; it cannot be cancelled.",
  "room.receipt_invalid": "Invalid playback state.",
  "room.stale_utterance": "Stale utterance.",
  "room.thread_invalid": "Invalid conversation identifier.",
  "room.browser_absent": "That browser is not in the room.",
  "room.focus_changed": "The connection or conversation changed. The text was not sent.",
  "room.message_conflict": "That identifier already belongs to another message.",
  "room.text_empty": "Write a message.",
};
/** How a call's report of a reply's playback leaves the reply: its status and, when it ended short, why. */
const PLAYBACK = {
  playing: ["playing", null], heard: ["playback_finished", null], interrupted: ["interrupted", "user_interrupted"],
  unplayed: ["interrupted", "newer_turn"], failed: ["failed", "playback_failed"],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rooms of each world, by machine. */
const rooms = new WeakMap();
let seats = 0;

/**
 * Machine `id`'s room in `world`: its calls (`calls`, seated once the page said hello), its history (`rows`, the
 * journal's rows), what each conversation's harness last said about working, and the page's messages already taken.
 */
export function roomOf(world, id) {
  if (!rooms.has(world)) rooms.set(world, new Map());
  const all = rooms.get(world);
  if (!all.has(id)) {
    const room = { id, calls: new Set(), rows: seededRows(world, id), seq: 0, working: {}, spells: {}, seen: new Set() };
    room.seq = room.rows.length;
    all.set(id, room);
    // A call ends as the world changes under it: its device revoked (4401), or its machine no longer answering
    // where the call reached it (dropped, as a network drops it).
    world.subscribe(() => {
      for (const call of [...room.calls]) {
        if (machineOf(world.state, id)?.revoked) end(world, room, call, { code: UNPAIRED, reason: NOT_PAIRED });
        else if (!reachable(world.state, id, call.via, call.onPage)) end(world, room, call, { code: 1006 });
      }
    });
  }
  return all.get(id);
}

/** What machine `id`'s room already said before the page came, oldest first: each conversation's `history` in the
 *  scenario (`{ role: "user" | "assistant", text, minutesAgo, status? }`), as rows of no call. Each machine keeps its
 *  own, at its own address: a page watching every machine merges them. */
function seededRows(world, id) {
  const machine = machineOf(world.state, id);
  const said = participantsOf(machine, id).flatMap((conversation, i) =>
    (machine.participants[i].history ?? []).map((entry) => ({ conversation, entry })));
  return said.sort((a, b) => b.entry.minutesAgo - a.entry.minutesAgo).map(({ conversation, entry }, n) => ({
    seq: n + 1, id: `${id}-said-${n + 1}`, thread: conversation.thread_id, role: entry.role, text: entry.text,
    name: entry.role === "user" ? "You" : conversation.title, session: null, revision: 0,
    time: world.now() - Math.round(entry.minutesAgo * 60_000),
    status: entry.status ?? (entry.role === "user" ? "read" : "playback_finished"), audio_reason: null, heard_chars: null, offline: null,
  }));
}

/** Whether machine `id` answers at `via` (on the page's own origin only when a room serves the page). */
function reachable(state, id, via, onPage) {
  return (!onPage || state.page === "room") && answers(state, id, via);
}

/** The calls of `room` the page said hello on. */
const seated = (room) => [...room.calls].filter((call) => call.session);
/** The call of `room` with session `sid`, if it is one. */
const callOf = (room, sid) => (sid ? seated(room).find((call) => call.session === sid) : undefined);
/** What the room's history says of a row: all of it but the turn it was said in. */
const rowView = ({ turn_id, ...row }) => row;
const refusal = (key, id = null) => ({ type: "error", data: { key, message: REFUSALS[key], ...(id ? { client_msg_id: id } : {}) } });

/** Whether `url` is a mocked machine's call socket. */
export function isCallSocket(url, pageOrigin) {
  try {
    const place = placeOf(String(url).replace(/^ws/, "http"), pageOrigin);
    return !!place?.id && place.path === CALL_PATH;
  } catch {
    return false;
  }
}

/**
 * The machine's end of a call socket the page opens at `url` (a mocked machine's, `isCallSocket`) with `protocols`.
 * `peer` is how the room speaks to the page: `open(protocol)`, `message(text)`, `close(code, reason)` once open,
 * `fail()` when it never opens. What it gives back is how the page speaks to the room: `send(text)`, and `close(code)`
 * for a socket the page closed (or left with the page).
 */
export function callSocket(world, identities, { url, protocols = [], pageOrigin }, peer) {
  const place = placeOf(String(url).replace(/^ws/, "http"), pageOrigin);
  const { id, via } = place;
  const state = world.state;
  const machine = machineOf(state, id);
  const log = (status) => world.log({ method: "WS", url, status, mocked: true });
  const nothing = { send() {}, close() {} };
  const protocol = protocols.includes("sidevoice") ? "sidevoice" : "";
  if (!reachable(state, id, via, place.onPage)) {
    if (via !== "room" || (place.onPage && state.page !== "room")) {
      log("no answer");
      peer.fail();
      return nothing;
    }
    // The room's relay answers for a machine it cannot reach: it says why, then closes as a full room does.
    log("machine away");
    peer.open(protocol);
    peer.message(JSON.stringify({ type: "error", data: { reason: "node_offline", message: "That machine is not connected to the room." } }));
    peer.close(1013, "node_offline");
    return nothing;
  }
  const token = protocols.find((offered) => offered.startsWith(TOKEN_PREFIX))?.slice(TOKEN_PREFIX.length);
  if (token !== identities[id].token || machine.revoked) {
    log(UNPAIRED);
    peer.open(protocol);
    peer.close(UNPAIRED, NOT_PAIRED);
    return nothing;
  }
  log(101);
  const room = roomOf(world, id);
  const call = {
    url, via, onPage: !!place.onPage, peer, session: null, since: 0, binding: /** @type {RoomBinding | null} */ (null),
    revision: 0, frames: 0, turns: [], speaking: false, replies: new Map(), ended: false,
  };
  room.calls.add(call);
  peer.open(protocol);
  return {
    send: (text) => take(world, room, call, text),
    close: (code) => end(world, room, call, { code, byPage: true }),
  };
}

/** A frame for the page on `call`, numbered as every frame after the session is. */
function send(call, event) {
  if (!call.ended) call.peer.message(JSON.stringify({ ...event, seq: ++call.frames }));
}

/** What the page sent on `call`: its hello first, then its messages, each about the call's own session. Its interface
 *  language (`voice-settings`) changes nothing here: the mocks speak English. */
function take(world, room, call, text) {
  if (call.ended) return;
  let frame = null;
  try {
    frame = JSON.parse(text);
  } catch {}
  if (!call.session) return seat(world, room, call, frame ?? {});
  const data = frame?.data && typeof frame.data === "object" ? frame.data : {};
  if (data.session_id !== call.session) return;
  if (frame.type === "voice-user-turn") once(world, room, call, data, userTurn);
  else if (frame.type === "voice-playback") once(world, room, call, data, playback);
}

/** The hello: the call gets its session, and lands on the conversation the hello names while it is in the room. */
function seat(world, room, call, hello) {
  const data = hello.data && typeof hello.data === "object" ? hello.data : {};
  call.session = randomId();
  call.since = ++seats;
  const named = participantsOf(machineOf(world.state, room.id), room.id).find((p) => p.thread_id === data.conversation);
  if (named) call.binding = { thread_id: named.thread_id, title: named.title, binding_id: randomId() };
  /** @type {VoiceSession & { room: { api: number, version: string }, resume_refused?: string }} */
  const session = {
    session_id: call.session, room: { api: API, version: "mock" }, resume: { token: secretText(), seconds: 60 }, resumed: false,
    // A call taken back is not mocked: the room answers with a new session, as for a ticket it no longer knows.
    ...(data.resume ? { resume_refused: "unknown" } : {}),
  };
  // The session frame is the one frame not numbered.
  call.peer.message(JSON.stringify({ type: "voice-session", data: session }));
  reportWorking(room, call);
  world.changed();
}

/** A message of the page's, taken once by its `client_msg_id`: applied, acknowledged, then answered. Sent again after
 *  a drop it is only acknowledged. */
function once(world, room, call, data, apply) {
  const id = typeof data.client_msg_id === "string" && data.client_msg_id ? data.client_msg_id : null;
  if (!id) return send(call, refusal("room.request_invalid"));
  const fresh = !room.seen.has(id);
  room.seen.add(id);
  const events = fresh ? apply(world, room, call, data, id) : [];
  send(call, { type: "voice-ack", data: { session_id: call.session, client_msg_id: id } });
  for (const event of events) send(call, event);
}

/** The person's turn: its start takes the call's next revision and the conversation the call is on; its end brings
 *  its words (or none); words said while the call had no room come finished, as a row of their own. */
function userTurn(world, room, call, data, id) {
  const turnId = typeof data.turn_id === "string" ? data.turn_id : "";
  const started = (revision, thread) => ({
    type: "voice-user-turn", data: { session_id: call.session, phase: "started", turn_id: turnId, revision, thread_id: thread },
  });
  const words = typeof data.text === "string" && data.text.trim() ? data.text : null;
  if (data.phase === "started") {
    if (!turnId || call.turns.some((turn) => turn.turn_id === turnId)) return [refusal("room.request_invalid", id)];
    if (call.turns.length >= MAX_OPEN_TURNS) return [refusal("room.turns_full", id)];
    const turn = { turn_id: turnId, revision: ++call.revision, binding: call.binding?.thread_id ? call.binding : null };
    call.turns.push(turn);
    call.speaking = true;
    return [started(turn.revision, turn.binding?.thread_id ?? null)];
  }
  if (data.phase === "finished" && data.offline === true) {
    if (!turnId || !words) return [refusal("room.request_invalid", id)];
    const revision = ++call.revision;
    const row = input(world, room, call, { id: `${call.session}:user-turn:${turnId}`, text: words, revision, binding: call.binding, turnId, offline: true });
    return row ? [started(revision, row.thread)] : [];
  }
  if (data.phase === "finished" || data.phase === "cancelled") {
    const turn = call.turns.find((open) => open.turn_id === turnId);
    if (!turn) return [refusal("room.input_ended", id)];
    call.turns = call.turns.filter((open) => open !== turn);
    call.speaking = false;
    if (data.phase === "finished" && words) {
      input(world, room, call, { id: `${call.session}:user-turn:${turnId}`, text: words, revision: turn.revision, binding: turn.binding, turnId });
    }
    return [];
  }
  return [refusal("room.request_invalid", id)];
}

/**
 * The person's words, as a row of the room's history for the conversation `binding` names: `pending`, told to the call
 * at once, and on their way to the agent. With no conversation they are never sent (`not_sent`, and no row).
 */
function input(world, room, call, { id, text, revision, binding, turnId = null, offline = false }) {
  const kept = room.rows.find((row) => row.id === id);
  if (kept) return kept;
  if (!binding?.thread_id) {
    receipt(call, { id, thread: null, session: call.session, revision, turn_id: turnId }, "not_sent");
    return null;
  }
  const row = {
    seq: ++room.seq, id, thread: binding.thread_id, role: "user", text, name: "You", session: call.session, revision,
    time: world.now(), status: "pending", audio_reason: null, heard_chars: null, offline: offline || null, turn_id: turnId,
  };
  room.rows.push(row);
  receipt(call, row, "pending");
  void deliver(world, room, row);
  return row;
}

/** What became of the person's words, told to the call that sent them. */
function receipt(call, row, status) {
  send(call, {
    type: "voice-input-receipt",
    data: { revision: row.revision, history_id: row.id, thread_id: row.thread, session_id: row.session, status, ...(row.turn_id ? { turn_id: row.turn_id } : {}) },
  });
}

/** The words reach the agent while its conversation listens: its connector takes them, then the agent reads them and
 *  its harness starts working on them. One that does not listen leaves them pending. */
async function deliver(world, room, row) {
  for (const [status, ms] of /** @type {const} */ ([["delivered", 400], ["read", 900]])) {
    await world.delay(ms);
    const conversation = participantsOf(machineOf(world.state, room.id), room.id).find((p) => p.thread_id === row.thread);
    if (conversation?.reach.state !== "listening") return;
    row.status = status;
    const call = callOf(room, row.session);
    if (call) receipt(call, row, status);
  }
  working(room, row.thread, true, { turn_phase: "start", session_id: row.session, revision: row.revision });
}

/** A call's report of how a reply played: the reply's row says it, while the reply is still queued or playing. */
function playback(world, room, call, data, id) {
  const report = PLAYBACK[data.status];
  if (!report || (data.heard_chars != null && !Number.isInteger(data.heard_chars))) return [refusal("room.receipt_invalid", id)];
  const reply = call.replies.get(data.utterance_id);
  if (!reply) return [refusal("room.stale_utterance", id)];
  if (!["queued", "playing"].includes(reply.status)) return [];
  const [status, reason] = report;
  reply.status = status;
  reply.row.status = status;
  reply.row.audio_reason = status === "interrupted" && typeof data.reason === "string" ? data.reason : reason;
  reply.row.heard_chars = data.status === "interrupted" ? data.heard_chars ?? null : null;
  return [];
}

/** A call leaves the room: the page closed it (or went), or the room closed it (`code`, told to the page). What was
 *  still to play for it is not heard. */
function end(world, room, call, { code = 1000, reason = "", byPage = false }) {
  if (!room.calls.delete(call)) return;
  stopReplies(call, "call_ended");
  call.ended = true;
  if (!byPage) call.peer.close(code, reason);
  world.log({ method: "WS", url: call.url, status: `closed ${code}`, mocked: true });
}

/** The replies `call` has not finished end there, unheard, for `reason`; the ids of those that did. */
function stopReplies(call, reason) {
  const stopped = [];
  for (const [uid, reply] of call.replies) {
    if (!["queued", "playing"].includes(reply.status)) continue;
    reply.status = reply.row.status = "interrupted";
    reply.row.audio_reason = reason;
    stopped.push(uid);
  }
  return stopped;
}

/** `POST /api/presentation/select`: the call goes on to another conversation, what it was saying of the last one is
 *  taken back, and it is told whether its harness is working. */
function select(world, room, machine, body) {
  const thread = body.thread_id;
  if (typeof thread !== "string" || !thread) return refuse(400, REFUSALS["room.thread_invalid"]);
  const call = callOf(room, body.session_id);
  if (!call) return refuse(409, REFUSALS["room.browser_absent"]);
  if (call.binding?.thread_id === thread) return json(200, { status: "already_active", binding: call.binding });
  const title = participantsOf(machine, room.id).find((p) => p.thread_id === thread)?.title ?? null;
  call.binding = { thread_id: thread, title, binding_id: randomId() };
  const withdrawn = stopReplies(call, "focus_changed");
  if (withdrawn.length) send(call, { type: "voice-reply-withdrawn", data: { session_id: call.session, utterance_ids: withdrawn, reason: "focus_changed" } });
  reportWorking(room, call);
  world.changed();
  return json(200, { status: "activated", binding: call.binding });
}

/** `POST /api/presentation/text`: words typed in the call, for the conversation it is on, as said ones go. */
function typed(world, room, body) {
  const mid = body.message_id;
  if (typeof mid !== "string" || !UUID.test(mid)) return refuse(422, REFUSALS["room.request_invalid"]);
  const id = `${body.session_id}:user-text:${mid}`;
  const kept = room.rows.find((row) => row.id === id);
  if (kept) {
    return kept.text === body.text && kept.thread === body.thread_id
      ? json(200, { accepted: true, id, revision: kept.revision, thread_id: kept.thread }) : refuse(409, REFUSALS["room.message_conflict"]);
  }
  const call = callOf(room, body.session_id);
  if (!call || call.binding?.thread_id !== body.thread_id || call.binding?.binding_id !== body.binding_id) {
    return refuse(409, REFUSALS["room.focus_changed"]);
  }
  if (typeof body.text !== "string" || !body.text.trim()) return refuse(422, REFUSALS["room.text_empty"]);
  const row = input(world, room, call, { id, text: body.text, revision: call.revision, binding: call.binding });
  return json(200, { accepted: true, id, revision: row.revision, thread_id: row.thread });
}

/** `GET /api/presentation`: the room, and the asking call as the room sees it. */
function snapshot(room, call, identity) {
  const calls = seated(room);
  return {
    binding: call?.binding?.thread_id ? call.binding : null,
    room: { revision: call?.revision ?? 0, speaking: !!call?.speaking, switching: false, clients: calls.length, utterances: [], client_errors: [] },
    clients: calls.map((c) => ({ id: c.session, device_id: identity.deviceId, connected: true, user_speaking: c.speaking, turn_revision: c.revision })),
    call: call ? {
      id: call.session, target: call.binding ?? {}, connected: true, user_speaking: call.speaking, error: null, sent: 0,
      last_delivery: null, revision: call.revision, utterances: [],
    } : null,
  };
}

/** What the conversation's harness says about working, passed on to every call on it as the room does. Each report
 *  starts a spell of its own: a later end ends only its own. */
function working(room, thread, value, turn = {}) {
  room.working[thread] = value;
  const spell = (room.spells[thread] = (room.spells[thread] ?? 0) + 1);
  for (const call of seated(room)) {
    if (call.binding?.thread_id === thread) send(call, { type: "voice-conversation", data: { thread_id: thread, working: value, ...turn } });
  }
  return spell;
}

/** A call landing on a conversation is told what its harness last said about working. */
function reportWorking(room, call) {
  const thread = call.binding?.thread_id;
  if (thread && typeof room.working[thread] === "boolean") {
    send(call, { type: "voice-conversation", data: { thread_id: thread, working: room.working[thread] } });
  }
}

/** The newest call in `world` on a conversation: `{ room, call }`, or null. */
function newestCall(world) {
  const found = [...(rooms.get(world)?.values() ?? [])]
    .flatMap((room) => seated(room).map((call) => ({ room, call })))
    .sort((a, b) => b.call.since - a.call.since);
  return found[0] ?? null;
}

/** The page's call in `world`, as the card names it: `{ machine, session, thread, title }` (no conversation: null
 *  thread), or null when the page is in no call. */
export function liveCall(world) {
  const on = newestCall(world);
  if (!on) return null;
  return { machine: on.room.id, session: on.call.session, thread: on.call.binding?.thread_id ?? null, title: on.call.binding?.title ?? null };
}

/** The newest revision the person said something at on `thread` in `call`: what the agent's next reply answers. */
function answering(room, call, thread) {
  return room.rows.filter((row) => row.role === "user" && row.thread === thread && row.session === call.session).at(-1)?.revision ?? call.revision;
}

/**
 * The agent of the conversation the page's call is on says `text`, as its connector publishes a reply: a row of the
 * room's history, and a `voice-reply` to every call on that conversation, whose voice says it and reports how it
 * played. Its harness's turn ends with it. Whether there was a call on a conversation to say it to.
 */
export function agentSpeaks(world, text) {
  const on = newestCall(world);
  const thread = on?.call.binding?.thread_id;
  if (!thread) return false;
  const { room, call } = on;
  const uid = randomId();
  const revision = answering(room, call, thread);
  const row = {
    seq: ++room.seq, id: `${call.session}:voice:${uid}`, thread, role: "assistant", text, name: call.binding.title ?? null,
    session: call.session, revision, time: world.now(), status: "queued", audio_reason: null, heard_chars: null, offline: null,
  };
  room.rows.push(row);
  for (const listener of seated(room)) {
    if (listener.binding?.thread_id !== thread) continue;
    listener.replies.set(uid, { row, status: "queued" });
    /** @type {VoiceReply} */
    const reply = { session_id: listener.session, utterance_id: uid, revision, reply_revision: revision, thread_id: thread, history_id: row.id, text, language: null };
    send(listener, { type: "voice-reply", data: reply });
  }
  if (room.working[thread]) working(room, thread, false, { turn_phase: "end", session_id: call.session, revision });
  return true;
}

/** The agent of the conversation the page's call is on works for `ms` of the world's time, as its harness reports a
 *  turn's start and end. Whether there was a call on a conversation to tell. */
export function agentWorks(world, ms = 5000) {
  const on = newestCall(world);
  const thread = on?.call.binding?.thread_id;
  if (!thread) return false;
  const { room, call } = on;
  const turn = { session_id: call.session, revision: answering(room, call, thread) };
  const spell = working(room, thread, true, { turn_phase: "start", ...turn });
  void world.delay(ms).then(() => {
    if (room.spells[thread] === spell) working(room, thread, false, { turn_phase: "end", ...turn });
  });
  return true;
}
