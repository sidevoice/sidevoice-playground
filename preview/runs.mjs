// Web preview: one run at a time. A run is a scenario (scenarios/*.json) on a web build, a core and a connector: the
// real core binary, started in the scenario's own profile, and the real connector, whose daemon links to that core
// to issue a pairing code (`pair-device`), as on a person's computer. The browser reaches the core only through the
// preview origin (proxy.mjs), so the core is told to answer that origin (its documented SIDEVOICE_ALLOWED_HOSTS and
// SIDEVOICE_ALLOWED_ORIGINS). Starting a run ends the one before: its processes stop, and a scenario that does not
// keep its state starts from an empty profile.

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RefError } from "../refs.mjs";

const SCENARIOS = fileURLToPath(new URL("./scenarios/", import.meta.url));
/** How long a core gets to say it is ready. */
export const READY_MS = 15_000;

/**
 * A scenario: `id`, `title`, `summary`, and what it starts from: `state` is `fresh` (an empty profile and a browser
 * with nothing stored) or `kept` (what its last run left, once the person paired, say); `steps` are what to walk.
 */
export function validScenario(value) {
  return (
    value &&
    typeof value.id === "string" && /^[a-z0-9-]+$/.test(value.id) &&
    typeof value.title === "string" &&
    ["fresh", "kept"].includes(value.state) &&
    Array.isArray(value.steps) && value.steps.every((step) => typeof step === "string")
  );
}

/** The scenarios, in their files' order. */
export async function loadScenarios(dir = SCENARIOS) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const scenarios = [];
  for (const file of files) {
    const value = JSON.parse(await readFile(join(dir, file), "utf8"));
    if (!validScenario(value)) throw new Error(`${file} is not a scenario`);
    scenarios.push(value);
  }
  return scenarios;
}

/** The directories of a profile at `root`, private, as the core and the connector want them. */
export function profileOf(root) {
  const data = join(root, "sidevoice");
  return {
    root,
    home: join(root, "home"),
    xdgConfig: join(root, "xdg/config"),
    xdgData: join(root, "xdg/data"),
    data,
    core: join(data, "core"),
  };
}

/** The core's command line and environment in `profile`, answering `origin` (the preview's). */
export function coreLaunch(program, profile, origin) {
  const { host } = new URL(origin);
  return {
    command: program,
    args: [
      "--data-dir", profile.core, "--port", "0",
      "--ready-file", join(profile.core, "core.json"), "--socket", join(profile.core, "local.sock"),
    ],
    env: { HOME: profile.home, SIDEVOICE_ALLOWED_HOSTS: host, SIDEVOICE_ALLOWED_ORIGINS: origin },
  };
}

/** The environment the connector runs with in `profile`: its own, and no service manager (it runs on demand). */
export function connectorEnv(profile) {
  return {
    PATH: process.env.PATH,
    HOME: profile.home,
    XDG_CONFIG_HOME: profile.xdgConfig,
    XDG_DATA_HOME: profile.xdgData,
    SIDEVOICE_DATA_DIR: profile.data,
    SIDEVOICE_SERVICE_MANAGER: "none",
  };
}

/**
 * The runs of this server. `cache` holds the profiles; `origin` is the preview origin's public address;
 * `spawnProcess` and `wait` are replaceable for tests.
 */
export function runs({ cache, origin, spawnProcess = spawn, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let current = null; // { scenario, web, core, connector, profile, process, port, sessionReset }

  async function readReady(path) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      return null;
    }
  }

  /** Runs the connector of `run` with `args` in its profile: its JSON answer. */
  function connector(run, args) {
    return new Promise((resolve, reject) => {
      const child = spawnProcess(run.connector.program, [...args, "--json"], {
        env: connectorEnv(run.profile),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (err += chunk));
      child.on("error", reject);
      child.on("close", () => {
        try {
          resolve(JSON.parse(out));
        } catch {
          reject(new RefError(502, `the connector's ${args.join(" ")} said: ${(err || out).trim().slice(0, 300)}`));
        }
      });
    });
  }

  async function stopCurrent() {
    const run = current;
    current = null;
    if (!run) return;
    // What the connector runs on demand stops the way a person stops it; then the core this run started.
    if (run.connectorUsed) await connector(run, ["service", "stop"]).catch(() => {});
    run.process.kill("SIGTERM");
    await new Promise((resolve) => (run.process.exitCode !== null ? resolve() : run.process.once("exit", resolve)));
  }

  return {
    /** What is running, for the page and for the proxy: no secrets in it. */
    get current() {
      return current && {
        scenario: current.scenario.id,
        web: current.web.label,
        core: current.core.tag,
        connector: current.connector.tag,
        port: current.port,
        site: current.web.site,
        reset: current.reset,
      };
    },
    /**
     * Starts `scenario` on the web build `web` ({ label, site }), the core and the connector archives (archives.mjs),
     * after stopping whatever ran.
     */
    async start({ scenario, web, core, connector: connectorArchive }) {
      await stopCurrent();
      const profile = profileOf(join(cache, "profiles", scenario.id));
      if (scenario.state === "fresh") await rm(profile.root, { recursive: true, force: true });
      for (const dir of [profile.home, profile.xdgConfig, profile.xdgData, profile.core]) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
      }
      const ready = join(profile.core, "core.json");
      await rm(ready, { force: true });
      const launch = coreLaunch(core.program, profile, origin);
      const child = spawnProcess(launch.command, launch.args, { env: launch.env, stdio: "ignore" });
      let port = null;
      for (let waited = 0; waited < READY_MS && port === null; waited += 100) {
        if (child.exitCode !== null) throw new RefError(502, `core ${core.tag} exited (${child.exitCode}) before it was ready`);
        port = (await readReady(ready))?.port ?? null;
        if (port === null) await wait(100);
      }
      if (port === null) {
        child.kill("SIGTERM");
        throw new RefError(504, `core ${core.tag} was not ready within ${READY_MS / 1000} s`);
      }
      current = {
        scenario, web, core, connector: connectorArchive, profile, process: child, port, connectorUsed: false,
        // A fresh scenario starts with a browser that remembers nothing of the preview origin.
        reset: scenario.state === "fresh",
      };
      return this.current;
    },
    /** A one-time pairing code from the real connector, linked to this run's core: `{code, expires_in, reach}`. */
    async pairingCode() {
      if (!current) throw new RefError(409, "no preview is running");
      current.connectorUsed = true;
      const answer = await connector(current, ["pair-device"]);
      if (!answer.ok) throw new RefError(502, answer.error?.message ?? "the connector gave no code");
      return { code: answer.code, expires_in: answer.expires_in, reach: answer.reach };
    },
    /** The browser's storage was reset for this run: the next page load keeps it. */
    resetDone() {
      if (current) current.reset = false;
    },
    stop: stopCurrent,
    /** Whether `scenario`'s kept profile is there. */
    kept: (scenario) => stat(join(profileOf(join(cache, "profiles", scenario.id)).core, "node-identity.json")).then(() => true, () => false),
    /** Forgets `scenario`'s kept state: its profile goes, and its next run starts as from scratch. */
    async forget(scenario) {
      if (current?.scenario.id === scenario.id) await stopCurrent();
      await rm(profileOf(join(cache, "profiles", scenario.id)).root, { recursive: true, force: true });
    },
  };
}
