// Web preview: what the playground's page asks of the server about it (under /preview/), and the job that starts a
// run. A start builds (or finds) the picked web, gets the picked core and connector, and starts the scenario; it takes
// minutes the first time for a web commit, so it runs in the background and /preview/status tells how it goes.

import { RefError } from "../refs.mjs";
import { archives as archiveStore, listArchives } from "./archives.mjs";
import { loadScenarios, runs as runStore } from "./runs.mjs";
import { WEB_REPO, webBuilds } from "./web-build.mjs";

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

/** A picked start, checked: `{ web, engine?, voice?, core, connector, scenario }`, refs and tags as the pickers give them. */
export function validStart(body, scenarios) {
  const ref = (value) => typeof value === "string" && /^[\w.\/-]+$/.test(value) && !value.includes("..");
  if (!body || !ref(body.web)) throw new RefError(400, "pick a web version");
  for (const name of ["engine", "voice"]) {
    if (body[name] != null && !ref(body[name])) throw new RefError(400, `not a build: ${body[name]}`);
  }
  if (!ref(body.core) || !ref(body.connector)) throw new RefError(400, "pick a core and a connector");
  const scenario = scenarios.find((s) => s.id === body.scenario);
  if (!scenario) throw new RefError(400, `no scenario ${body.scenario}`);
  return { ...body, scenario };
}

/**
 * The Web preview's routes for the playground's own origin. `api` is GitHub's (refs.mjs); `engineBuild(ref)` and
 * `voiceBuild(ref)` get a picked build (its `tarball` among what they give); `cache` holds what it builds and runs;
 * `origin` is the preview origin's public address, and `link` the first address of it the page opens (past its gate).
 */
export async function previewSection({ api, engineBuild, voiceBuild, cache, origin, link = origin, web = null, archives = null, runs = null }) {
  const scenarios = await loadScenarios();
  const store = archives ?? archiveStore({ cache: `${cache}/archives`, api });
  const manager = runs ?? runStore({ cache, origin });
  const log = [];
  const say = (line) => {
    log.push(line);
    if (log.length > LOG_LINES) log.shift();
  };
  const builds = web ?? webBuilds({ cache, api, log: say });
  let job = { state: "idle", error: null };

  async function start(pick) {
    log.length = 0;
    job = { state: "starting", error: null };
    try {
      say(`Getting core ${pick.core} and connector ${pick.connector}…`);
      const [core, connector] = await Promise.all([store.get("core", pick.core), store.get("connector", pick.connector)]);
      const tarballs = {};
      if (pick.engine) tarballs.engine = (await engineBuild(pick.engine)).tarball;
      if (pick.voice) tarballs.voice = (await voiceBuild(pick.voice)).tarball;
      say(`Building web ${pick.web} (the first time for a commit takes minutes)…`);
      const { sha, site } = await builds.get(pick.web, tarballs);
      say(`Starting ${pick.scenario.title}: core ${core.tag}${core.source ? ` (${core.source.slice(0, 7)})` : ""}…`);
      await manager.start({ scenario: pick.scenario, web: { label: `${pick.web} @ ${sha.slice(0, 7)}`, site }, core, connector });
      job = { state: "running", error: null };
      say("Running: open the preview.");
    } catch (error) {
      job = { state: "failed", error: error.message };
      say(`Failed: ${error.message}`);
    }
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
    if (path === "/preview/options" && req.method === "GET") {
      const [web, core, connector] = await Promise.all([listWeb(api), listArchives(api, "core"), listArchives(api, "connector")]);
      const kept = await Promise.all(scenarios.map((s) => manager.kept(s)));
      return { web, core, connector, scenarios: scenarios.map((s, i) => ({ ...s, kept: kept[i] })), origin };
    }
    if (path === "/preview/status" && req.method === "GET") return { job, log: [...log], current: manager.current, origin, link };
    if (req.method !== "POST") return undefined;
    if (path === "/preview/start") {
      if (job.state === "starting") throw new RefError(409, "a preview is starting already");
      const pick = validStart(await body(req), scenarios);
      void start(pick);
      return { job: { state: "starting" } };
    }
    if (path === "/preview/pair") return manager.pairingCode();
    if (path === "/preview/stop") {
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
