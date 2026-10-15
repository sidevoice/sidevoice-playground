// Web preview: what the playground's page asks of the server about it (under /preview/), and the job that starts a
// run. A start builds (or finds) the picked web and starts it: mocked (the default: its scenarios and options are
// picked in the preview's own card, mock/), or on the real core and connector of the picked releases, in a scenario
// of scenarios/. It takes minutes the first time for a web commit, so it runs in the background and /preview/status
// tells how it goes.

import { RefError } from "../refs.mjs";
import { archives as archiveStore, listArchives } from "./archives.mjs";
import { loadScenarios, runs as runStore } from "./runs.mjs";
import { WEB_REPO, webBuilds } from "./web-build.mjs";
import { listWorktrees, startDevServer } from "./dev.mjs";
import { sourceBuilds } from "./source-build.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scriptedAgent, SCRIPTS } from "./turn-lab/agent.mjs";
import { evidence } from "./turn-lab/evidence.mjs";

const LAB_CONFIG = fileURLToPath(new URL("./turn-lab.config.json", import.meta.url));

/** How many log lines a job keeps for the page. */
export const LOG_LINES = 200;

/** What there is to pick of the web: its releases, open pull requests and branches. */
export async function listWeb(api) {
  const [releases, pulls, branches] = await Promise.all([
    api(`/repos/${WEB_REPO}/releases?per_page=30`).then((all) => (all ?? []).filter((r) => !r.draft)),
    api(`/repos/${WEB_REPO}/pulls?state=open&sort=updated&direction=desc&per_page=50`),
    api(`/repos/${WEB_REPO}/branches?per_page=100`),
  ]);
  return {
    releases: releases.map((r) => ({ tag: r.tag_name, prerelease: r.prerelease })),
    pulls: (pulls ?? []).map((p) => ({ number: p.number, title: p.title, draft: p.draft, sha: p.head.sha })),
    branches: (branches ?? []).map((b) => ({ name: b.name, sha: b.commit.sha })),
  };
}

/**
 * A picked start, checked: `{ mode, web, engine?, voice? }`, and for `mode: "real"` `{ core, connector, scenario }` too;
 * refs and tags as the pickers give them. `mode` is `mock` unless it says `real`.
 */
export function validStart(body, scenarios) {
  const ref = (value) => typeof value === "string" && /^(?:sha:)?[\w.\/-]+$/.test(value) && !value.includes("..");
  // A dev run names a worktree, not a version.
  if (body?.mode === "dev") {
    if (typeof body.worktree !== "string" || !body.worktree.startsWith("/")) throw new RefError(400, "pick a worktree");
    return { mode: "dev", worktree: body.worktree };
  }
  if (!body || !ref(body.web)) throw new RefError(400, "pick a web version");
  for (const name of ["engine", "voice"]) {
    if (body[name] != null && !ref(body[name])) throw new RefError(400, `not a build: ${body[name]}`);
  }
  const mode = body.mode ?? "mock";
  if (!["mock", "real"].includes(mode)) throw new RefError(400, `no mode ${mode}`);
  if (mode === "mock") return { mode, web: body.web, engine: body.engine ?? null, voice: body.voice ?? null };
  if (!ref(body.core) || !ref(body.connector)) throw new RefError(400, "pick a core and a connector");
  const scenario = scenarios.find((s) => s.id === body.scenario);
  if (!scenario) throw new RefError(400, `no scenario ${body.scenario}`);
  return { ...body, mode, scenario };
}

/**
 * The Web preview's routes for the playground's own origin. `api` is GitHub's (refs.mjs); `engineBuild(ref)` and
 * `voiceBuild(ref)` get a picked build (its `tarball` among what they give); `cache` holds what it builds and runs;
 * `origin` is the preview origin's public address, and `link` the first address of it the page opens (past its gate).
 */
export async function previewSection({ api, engineBuild, voiceBuild, cache, origin, link = origin, web = null, archives = null, runs = null, devRepo = null, devServer = startDevServer }) {
  const scenarios = await loadScenarios();
  const store = archives ?? archiveStore({ cache: `${cache}/archives`, api });
  const manager = runs ?? runStore({ cache, origin });
  const log = [];
  const say = (line) => {
    log.push(line);
    if (log.length > LOG_LINES) log.shift();
  };
  const sources = sourceBuilds({ cache, api, log: say });
  const builds = web ?? webBuilds({ cache, api, log: say });
  let job = { state: "idle", error: null };
  let agent = null;
  const events = [];
  const redact = (value) => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
      [key, /token|secret|authorization|access_cookie/i.test(key) ? "[redacted]" : redact(item)]));
    if (typeof value === "string") return value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/SV1\.[A-Za-z0-9_-]+/g, "SV1.[redacted]");
    return value;
  };
  const emit = (event) => { events.push(redact(event)); };
  const candidate = (config) => ({ core: config.core, connector: config.connector, web: config.web, voice: config.voice, engine: config.engine });
  const matchesCandidate = (current, config) => current?.mode === "real" && current.scenario === "turn-lab" &&
    Object.entries(candidate(config)).every(([key, value]) => current.identity?.[key] === value);
  const labPick = (config) => validStart({ mode: "real", scenario: "turn-lab", web: config.web, core: `sha:${config.core}`,
    connector: `sha:${config.connector}`, voice: config.voice, engine: config.engine }, scenarios);

  async function start(pick) {
    if (agent) { await agent.stop(); agent = null; }
    events.length = 0;
    log.length = 0;
    job = { state: "starting", error: null };
    try {
      if (pick.mode === "dev") {
        // Only a worktree of the dev checkout, as it lists them now.
        const worktree = (await listWorktrees(devRepo)).find((w) => w.path === pick.worktree);
        if (!worktree) throw new RefError(404, `${pick.worktree} is not a sidevoice-web worktree of ${devRepo}`);
        say(`Starting the dev server of ${worktree.branch ?? "a detached head"} in ${worktree.path}…`);
        await manager.dev({ label: `dev: ${worktree.branch ?? worktree.head?.slice(0, 7)} (${worktree.path})`, start: () => devServer(worktree, { log: say }) });
        job = { state: "running", error: null };
        say("Running, live: edits to the worktree reach the preview as they are saved.");
        return;
      }
      if (pick.mode === "mock") {
        const tarballs = await picked(pick);
        say(`Building web ${pick.web} (the first time for a commit takes minutes)…`);
        const { sha, site, mocks } = await builds.get(pick.web, tarballs);
        if (!mocks.ok) throw new RefError(409, `the mocks do not match web ${sha.slice(0, 7)}'s types: ${mocks.errors}`);
        await manager.mock({ web: { label: `${pick.web} @ ${sha.slice(0, 7)}`, site } });
        job = { state: "running", error: null };
        say("Running, mocked: open the preview.");
        return;
      }
      say(`Getting core ${pick.core} and connector ${pick.connector}…`);
      const binary = (kind, ref) => ref.startsWith("sha:") ? sources.get(kind, ref.slice(4)) : store.get(kind, ref);
      // Rust candidate builds run one at a time to keep memory use predictable.
      const core = await binary("core", pick.core);
      const connector = await binary("connector", pick.connector);
      const tarballs = await picked(pick);
      if (pick.scenario.id === "turn-lab") tarballs.forceVoice = true;
      say(`Building web ${pick.web} (the first time for a commit takes minutes)…`);
      const { sha, site } = await builds.get(pick.web, tarballs);
      say(`Starting ${pick.scenario.title}: core ${core.tag}${core.source ? ` (${core.source.slice(0, 7)})` : ""}…`);
      await manager.start({ scenario: pick.scenario, web: { label: `${pick.web} @ ${sha.slice(0, 7)}`, site }, core, connector,
        identity: { core: core.source ?? null, connector: connector.source ?? null, web: sha, voice: pick.voice ?? null, engine: pick.engine ?? null } });
      emit({ at: Date.now(), kind: "run-start", data: { core: { sha: core.source, digest: core.digest }, connector: { sha: connector.source, digest: connector.digest }, web: sha, voice: { sha: pick.voice, digest: tarballs.voiceDigest ?? null } } });
      job = { state: "running", error: null };
      say("Running: open the preview.");
    } catch (error) {
      job = { state: "failed", error: error.message };
      say(`Failed: ${error.message}`);
    }
  }

  /** The tarballs of the engine and voice builds picked for the web's unpublished pins. */
  async function picked(pick) {
    const tarballs = {};
    if (pick.engine) tarballs.engine = (await engineBuild(pick.engine)).tarball;
    if (pick.voice) {
      const voice = await voiceBuild(pick.voice);
      tarballs.voice = voice.tarball;
      tarballs.voiceDigest = voice.sha256;
    }
    return tarballs;
  }

  async function body(req) {
    let text = "";
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 10_000) throw new RefError(413, "too large");
    }
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new RefError(400, "not JSON");
    }
  }

  /** Handles `url` when it is one of the section's routes: its answer's value, or undefined. */
  async function route(req, url) {
    const path = url.pathname;
    if (path === "/preview/turn-lab/config" && req.method === "GET") return JSON.parse(await readFile(LAB_CONFIG, "utf8"));
    if (path === "/preview/turn-lab/events" && req.method === "GET") return { events, evidence: evidence(events), agent: agent?.state ?? null, job, current: manager.current };
    if (path === "/preview/turn-lab/scripts" && req.method === "GET") return SCRIPTS;
    if (path === "/preview/turn-lab/export" && req.method === "GET") return { at: new Date().toISOString(), events, evidence: evidence(events) };
    if (path === "/preview/options" && req.method === "GET") {
      const [web, core, connector, worktrees] = await Promise.all([
        listWeb(api), listArchives(api, "core"), listArchives(api, "connector"), devRepo ? listWorktrees(devRepo) : [],
      ]);
      const kept = await Promise.all(scenarios.map((s) => manager.kept(s)));
      return { web, core, connector, worktrees, devRepo, scenarios: scenarios.map((s, i) => ({ ...s, kept: kept[i] })), origin };
    }
    if (path === "/preview/status" && req.method === "GET") return { job, log: [...log], current: manager.current, origin, link };
    if (req.method !== "POST") return undefined;
    if (path === "/preview/turn-lab/start" || path === "/preview/turn-lab/recover") {
      const config = JSON.parse(await readFile(LAB_CONFIG, "utf8"));
      if (job.state === "starting") throw new RefError(409, "a preview is starting; retry after it finishes");
      if (path.endsWith("/start") && matchesCandidate(manager.current, config) && job.state === "running") return { job, config, reused: true };
      const pick = labPick(config);
      job = { state: "starting", error: null };
      void start(pick);
      return { job, config, reused: false };
    }
    if (path === "/preview/turn-lab/connect") {
      if (job.state !== "running") throw new RefError(409, "real room is not ready");
      const { mode } = await body(req);
      if (!["push", "pull"].includes(mode)) throw new RefError(400, "mode must be push or pull");
      if (agent) await agent.stop();
      agent = scriptedAgent({ ...manager.labConnection(), emit });
      try { return { connected: await agent.start(mode) }; }
      catch (error) { await agent.stop().catch(() => {}); agent = null; throw new RefError(502, error.message); }
    }
    if (path === "/preview/turn-lab/choose") {
      if (!agent?.state.ready) throw new RefError(409, "connect the test agent first");
      const { id } = await body(req);
      return agent.choose(id);
    }
    if (path === "/preview/turn-lab/event") {
      const event = await body(req);
      if (!event || !["room-frame", "browser-action", "browser-ready", "browser-error"].includes(event.kind)) throw new RefError(400, "not a lab event");
      emit({ at: Date.now(), kind: event.kind, data: event.data });
      return { recorded: true };
    }
    if (path === "/preview/start") {
      if (job.state === "starting") throw new RefError(409, "a preview is starting already");
      const pick = validStart(await body(req), scenarios);
      void start(pick);
      return { job: { state: "starting" } };
    }
    if (path === "/preview/pair") return manager.pairingCode();
    if (path === "/preview/stop") {
      if (agent) { await agent.stop(); agent = null; }
      await manager.stop();
      job = { state: "idle", error: null };
      return { stopped: true };
    }
    if (path === "/preview/forget") {
      const { scenario } = await body(req);
      const found = scenarios.find((s) => s.id === scenario);
      if (!found) throw new RefError(400, `no scenario ${scenario}`);
      await manager.forget(found);
      return { forgotten: found.id };
    }
    return undefined;
  }

  return { route, runs: manager };
}
