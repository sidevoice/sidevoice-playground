// The mocked preview's desktop app: `window.__sidevoiceDesktop.host` as the desktop bridge gives it to the page
// (sidevoice-desktop docs/BRIDGE.md; the page's side is apps/web/src/services/desktop-host.ts), with its local host
// (`localHost`) answering from the world: its state, its pairing, installing it, starting and stopping it, its
// pairing codes and its version. What a person's action changes takes the time it takes, on the world's clock.
// @ts-check

/** @typedef {import("./web-types").LocalHostStatus} LocalHostStatus */
/** @typedef {import("./web-types").LocalHostBridge} LocalHostBridge */

import { LOCAL_ID, LOCAL_URL, agentRows, mintCode } from "./machines.mjs";
import { desktopEngine } from "./models.mjs";
import { fakeVoice } from "./voice.mjs";

/** The local host's status (desktop-host.ts `LocalHostStatus`), from the world's `local`.
 * @returns {LocalHostStatus} */
export function localStatus(local, now) {
  const running = local.state === "running";
  /** @type {LocalHostStatus} */
  const status = {
    state: local.state,
    service: local.service ?? "launchd",
    installed: local.installed ?? !["absent", "not-installed", "installing"].includes(local.state),
    core: running ? { pid: 4242, version: local.version ?? "0.3.0", api: 1, launch_id: "preview" } : null,
    // The installed Sidevoice's version (the `sidevoice` package, bundling the core): sidevoice-web #75's
    // LocalHostStatus.product_version, which the real bridge does not report yet.
    product_version: local.productVersion ?? "0.8.1",
    calls: running ? 0 : null,
    reachable: running,
    attempts: null, limit: null, since: null, window_started: null, next_retry_at: null,
    failure: local.failure ?? null,
  };
  if (local.state === "backoff") {
    Object.assign(status, { attempts: local.attempts ?? 2, limit: local.limit ?? 5, next_retry_at: new Date(now + 4000).toISOString() });
  }
  return status;
}

const INSTALL_STEPS = [
  { step: "download", total: 48_000_000 },
  { step: "verification", total: null },
  { step: "staging", total: null },
  { step: "service-start", total: null },
];

/** The desktop host for the world: `{ app, version, computerName, voice, engine, localHost? }`, as the bridge gives it:
 *  the app's voice and engine (voice.mjs, models.mjs), and its local host when the world has one. */
export function desktopHost(world, identities) {
  const local = () => world.state.local;
  const status = () => localStatus(local(), world.now());
  const set = (fields) => world.patch(Object.fromEntries(Object.entries(fields).map(([k, v]) => [`local.${k}`, v])));
  const jobs = new Map();
  let jobCount = 0;

  /** The state after a start: running, or what the world says a start ends in. */
  async function starting() {
    set({ state: "starting", failure: null });
    await world.delay(1500);
    const outcome = local().startsAs ?? "running";
    set({ state: outcome, failure: outcome === "running" ? null : local().startFailure ?? { key: "start.failed", step: "service-start" } });
  }

  /** @type {Required<LocalHostBridge>} */
  const localHost = {
    state: () => status(),
    subscribe(listener) {
      let last = JSON.stringify(status());
      return world.subscribe(() => {
        const next = status();
        const text = JSON.stringify(next);
        if (text !== last) {
          last = text;
          listener(next);
        }
      });
    },
    pairing() {
      if (local()?.state !== "running" || local().paired === false) return null;
      const identity = identities[LOCAL_ID];
      return {
        fp: identity.fingerprint, public_key: identity.publicKey, device_id: identity.deviceId, token: identity.token,
        urls: [LOCAL_URL], host: local().computerName ?? null, local: true,
      };
    },
    start: () => starting(),
    restart: () => starting(),
    reconnect: () => starting(),
    async stop() {
      await world.delay(600);
      set({ state: "stopped-by-person", failure: null });
    },
    async serviceInstall() {
      await world.delay(800);
      set({ service: "launchd", installed: true });
      await starting();
    },
    async serviceUninstall() {
      await world.delay(800);
      set({ installed: false, state: "not-installed" });
    },
    revealLog: () => world.log({ method: "BRIDGE", url: "localHost.revealLog()", status: "shown", mocked: true }),
    async pairingCode() {
      await world.delay(300);
      return { code: mintCode(world, identities, LOCAL_ID, "valid"), expires_in: 600, reach: local().reach ?? "local-only" };
    },
    async pairRoom(url, code) {
      await world.delay(900);
      if (local().pairRoom === "refused") throw Object.assign(new Error("refused"), { key: "pair-room.refused" });
      set({ reach: "room" });
      return { ok: true, url, code: code ? "accepted" : null };
    },
    install(onProgress) {
      const job = `install-${++jobCount}`;
      const run = (async () => {
        set({ state: "installing", failure: null });
        const outcome = local().install ?? "ok";
        const slow = local().installSlow ? 6 : 1;
        for (const { step, total } of INSTALL_STEPS) {
          const parts = total ? 12 : 1;
          for (let part = 1; part <= parts; part++) {
            if (jobs.get(job)?.cancelled) {
              set({ state: "absent" });
              throw { key: "install.cancelled", step };
            }
            onProgress?.({ step, done: total ? Math.round((total * part) / parts) : null, total, cancellable: step === "download" });
            await world.delay((total ? 250 : 700) * slow);
          }
          if (outcome !== "ok" && outcome.startsWith(stepKeyFor(step))) {
            set({ state: "absent" });
            throw { key: outcome.split("@")[1] ?? outcome, step };
          }
        }
        set({ installed: true, service: "launchd" });
        await starting();
        return status();
      })();
      jobs.set(job, { cancelled: false });
      run.finally(() => jobs.delete(job)).catch(() => {});
      return Object.assign(run, { job });
    },
    async cancel(job) {
      const running = jobs.get(job);
      if (!running) return false;
      running.cancelled = true;
      return true;
    },
    async agents() {
      return { agents: agentRows(local()?.agents ?? []), scanned_at: new Date(world.now()).toISOString() };
    },
    async version() {
      const bundled = { version: local()?.bundledVersion ?? "0.3.0" };
      return {
        bridge: 1, bundled, installed: local()?.installed === false ? null : { version: local()?.version ?? "0.3.0" },
        core_api: 1, update: local()?.update ?? "current",
      };
    },
    async update() {
      await world.delay(1200);
      set({ version: local()?.bundledVersion ?? "0.3.0", update: "current" });
      await starting();
      return status();
    },
  };
  const voice = fakeVoice(world);
  world.voiceRuntime = voice;
  return {
    app: "sidevoice-desktop",
    version: "0.0.0-preview",
    computerName: local()?.computerName ?? "Mac de Ana",
    voice: voice.host,
    engine: desktopEngine(world),
    ...(local() ? { localHost } : {}),
  };
}

/** An install outcome names where it fails: `<step>@<key>` (`download@install.network`). */
function stepKeyFor(step) {
  return `${step}@`;
}
