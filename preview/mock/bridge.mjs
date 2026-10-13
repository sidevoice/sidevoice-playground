// The mocked preview's desktop app: `window.__sidevoiceDesktop.host` as the desktop bridge gives it to the page
// (sidevoice-desktop docs/BRIDGE.md; the page's side is apps/web/src/services/desktop-host.ts), with its local host
// (`localHost`) answering from the world: its state, its pairing, installing it, starting and stopping it, its
// pairing codes and its version. What a person's action changes takes the time it takes, on the world's clock.
// @ts-check

/** @typedef {import("./web-types").LocalHostStatus} LocalHostStatus */
/** @typedef {import("./web-types").LocalHostBridge} LocalHostBridge */

import { LOCAL_ID, LOCAL_URL, mintCode } from "./machines.mjs";
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
    // LocalHostStatus.product_version, which the real bridge does not report yet. The scenario's (`productVersion`), and
    // null, unknown, when it says none.
    product_version: local.productVersion ?? null,
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

/** This computer's local host where a scenario names none: not installed yet, as on a desktop app just opened. */
export const NO_LOCAL_HOST = { computerName: "Mac de Ana", state: "absent", installed: false, reach: "local-only", install: "ok", participants: [] };

/** The desktop host for the world: `{ app, version, computerName, voice, engine, localHost }`, as the bridge gives it:
 *  the app's voice and engine (voice.mjs, models.mjs), and its local host. Any scenario runs in the app: one whose
 *  world has no local host gets one not installed (`NO_LOCAL_HOST`), so the page offers to prepare this computer. */
export function desktopHost(world, identities) {
  if (!world.state.local) world.patch({ local: NO_LOCAL_HOST });
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
    // Start at sign-in only says whether the service starts at the next sign-in: turning it on or off leaves a
    // running service running and a stopped one stopped (Start, Stop and Restart are their own).
    async serviceInstall() {
      await world.delay(800);
      const wasSetUp = local()?.state !== "not-installed";
      set({ service: "launchd", installed: true });
      // A service not set up at all yet is set up and started (the card's Start in that state).
      if (!wasSetUp) await starting();
    },
    /** Whether the service starts at the next sign-in, only that (sidevoice-web #75's LocalHostBridge.setStartAtLogin; the
     *  real bridge and connector lack it: their service uninstall also stops the service). @param {boolean} enabled */
    async setStartAtLogin(enabled) {
      await world.delay(400);
      set({ service: "launchd", installed: !!enabled });
    },
    async serviceUninstall() {
      await world.delay(800);
      set({ installed: false });
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
    // The app's call settings (after sidevoice-desktop #56): the mute shortcut and the call controls always shown.
    ...(world.state.app?.desktopSettings === false ? {} : { muteShortcut: muteShortcutOf(world), callControls: callControlsOf(world) }),
    // The app's own build (sidevoice-desktop #56): a release, a nightly or a development build, as the world says.
    build: buildOf(world.state.app?.channel ?? "release"),
    // A release's updater (sidevoice-desktop #56): nothing to install in the preview, and the choice to download updates
    // by itself, on by default, where the world offers it.
    ...((world.state.app?.channel ?? "release") === "release" ? { updater: appUpdaterOf(world) } : {}),
    computerName: local()?.computerName ?? "Mac de Ana",
    voice: voice.host,
    engine: desktopEngine(world),
    localHost,
  };
}

/** The mute shortcut as the app keeps it: set, refused by the system (another app has it), or not set; an accelerator
 *  that is not a combination is refused as `shortcut_invalid`. One with Cmd+F5 clashes with VoiceOver. */
function muteShortcutOf(world) {
  const listeners = new Set();
  const read = () => {
    const app = world.state.app ?? {};
    const accelerator = app.shortcut === undefined ? "Cmd+Shift+M" : app.shortcut;
    const refused = app.shortcutRefused === true && !!accelerator;
    return {
      accelerator, label: accelerator ? accelerator.replace("Cmd", "⌘").replace("Shift", "⇧").replace("Alt", "⌥").replace("Ctrl", "⌃").replaceAll("+", "") : null,
      state: !accelerator ? "off" : refused ? "refused" : "on",
      alternatives: refused ? ["Cmd+Shift+;", "Cmd+Alt+M", "Ctrl+Shift+M"] : [],
      voiceOver: /Cmd\+F5/.test(accelerator ?? ""),
    };
  };
  return {
    get: async () => read(),
    async set(accelerator) {
      if (accelerator !== null && !/^(Cmd|Ctrl|Alt|Shift)(\+(Cmd|Ctrl|Alt|Shift))*\+.+$/.test(accelerator)) throw Object.assign(new Error("shortcut_invalid"), { key: "shortcut_invalid" });
      world.patch({ "app.shortcut": accelerator, "app.shortcutRefused": false });
      const now = read();
      for (const listener of listeners) listener(now);
      return now;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/** Whether the call controls show always, as the app keeps it. */
function callControlsOf(world) {
  return {
    settings: async () => ({ alwaysShown: world.state.app?.alwaysShown === true }),
    async setAlwaysShown(enabled) { world.patch({ "app.alwaysShown": !!enabled }); return { alwaysShown: !!enabled }; },
  };
}

/** The desktop app's `host.build` for `channel`. Only a release would have an updater (`host.updater`); this mock
 *  offers none on any channel. */
function buildOf(channel) {
  if (channel === "nightly") return { channel, version: "0.4.0", commit: "abc1234def", date: "2026-10-13T06:12:00Z" };
  if (channel === "dev") return { channel, version: "0.4.0", commit: "0f1e2d3c" };
  return { channel: "release", version: "0.4.0" };
}

/** The desktop app's updater: no update in the preview; downloading by itself kept in the world (`app.autoDownload`),
 *  offered unless the world says this app predates it (`app.autoDownloadOffered`). */
function appUpdaterOf(world) {
  const updater = {
    status: async () => ({ available: false }),
    restart: async () => {},
  };
  if (world.state.app?.autoDownloadOffered === false) return updater;
  return {
    ...updater,
    settings: async () => ({ autoDownload: world.state.app?.autoDownload !== false }),
    setAutoDownload: async (enabled) => { world.patch({ "app.autoDownload": !!enabled }); return { autoDownload: !!enabled }; },
  };
}

/** An install outcome names where it fails: `<step>@<key>` (`download@install.network`). */
function stepKeyFor(step) {
  return `${step}@`;
}
