// The mocked preview's desktop app: `window.__sidevoiceDesktop.host` as the desktop bridge gives it to the page
// (sidevoice-desktop docs/BRIDGE.md; the page's side is apps/web/src/services/desktop-host.ts), with its local host
// (`localHost`) answering from the world: its state, its pairing, starting and stopping it, its pairing codes and its
// version, and installing it as the desktop app does (`install`, `cancel`: download with its bytes, cancellable, then
// verification, staging and the service's start), unless the world's app has no install seam (`local.appInstalls: false`),
// where the page shows only the install command (`npx sidevoice@latest install`).
// The command run by hand is the world's `local.commandRun`: this computer then starts, and answers or fails as a
// start ends (`local.startsAs`). What a person's action changes takes the time it takes, on the world's clock.
// @ts-check

/** @typedef {import("./web-types").LocalHostStatus} LocalHostStatus */
/** @typedef {import("./web-types").LocalHostBridge} LocalHostBridge */
/** @typedef {import("./web-types").DesktopDataBridge} DesktopDataBridge */

import { LOCAL_ID, LOCAL_URL, SERVICE_VERSION, mintCode, nextMinor, storedPairing } from "./machines.mjs";
import { desktopEngine } from "./models.mjs";
import { fakeVoice } from "./voice.mjs";
import { appMicrophone } from "./microphone.mjs";

/** This computer's Sidevoice service's version where the world names none (`local.version`, `local.bundledVersion`):
 *  the one installed, and the one the app bundles — a service's number, as every machine's (machines.mjs). */
export const LOCAL_VERSION = SERVICE_VERSION;

/** The local host's status (desktop-host.ts `LocalHostStatus`), from the world's `local`.
 * @returns {LocalHostStatus} */
export function localStatus(local, now) {
  const running = local.state === "running";
  /** @type {LocalHostStatus} */
  const status = {
    state: local.state,
    service: local.service ?? "launchd",
    installed: local.installed ?? !["absent", "not-installed", "installing"].includes(local.state),
    core: running ? { pid: 4242, version: local.version ?? LOCAL_VERSION, api: 1, launch_id: "preview" } : null,
    // The installed Sidevoice's version (the `sidevoice` package, bundling the core): sidevoice-web #75's
    // LocalHostStatus.product_version, which the real bridge does not report yet. The one installed (`version`), the
    // same number `version()` says, so the page never shows two for one service; null, unknown, where the scenario has
    // it say none (`saysVersion: false`) and where there is no local host.
    product_version: local.saysVersion === false || local.state === "absent" ? null : local.version ?? LOCAL_VERSION,
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
export const NO_LOCAL_HOST = { computerName: "Mac de Ana", state: "absent", installed: false, reach: "local-only", participants: [] };

/** The desktop host for the world: `{ app, version, computerName, voice, microphone, engine, localHost }`, as the bridge gives it:
 *  the app's voice and engine (voice.mjs, models.mjs), and its local host. Any scenario runs in the app: one whose
 *  world has no local host gets one not installed (`NO_LOCAL_HOST`), so the page offers to prepare this computer (or,
 *  where the world's app has no install seam, `local.appInstalls: false`, shows only the install command).
 *  `relaunch`: what the app restarting into its update does to the page (attach.mjs: loads it again, as a restart
 *  opens a new window); none, it stays. */
export function desktopHost(world, identities, { relaunch = null } = {}) {
  if (!world.state.local) world.patch({ local: NO_LOCAL_HOST });
  const local = () => world.state.local;
  const status = () => localStatus(local(), world.now());
  const set = (fields) => world.patch(Object.fromEntries(Object.entries(fields).map(([k, v]) => [`local.${k}`, v])));
  const jobs = new Map();
  let jobCount = 0;
  // The reset seam (deleteAll, resetReport) is macOS only and newer than some webs (web #127); uninstall (desktop #95) is
  // deleteAll ending with the app moved to the Trash instead of a relaunch.
  /** @type {DesktopDataBridge & { deleteAll?: () => Promise<any>, resetReport?: () => Promise<any>, uninstall?: () => Promise<any> }} */
  const data = {
    pairings: {
      async read() {
        const saved = world.state.app?.pairings;
        const pairings = Array.isArray(saved) ? saved : Object.keys(world.state.machines ?? {})
          .filter((id) => world.state.machines[id].paired)
          .map((id) => storedPairing(world.state, identities, id, world.now()));
        return { pairings: structuredClone(pairings), pendingRevokes: structuredClone(world.state.app?.pendingRevokes ?? []) };
      },
      async write(value) {
        if (!Array.isArray(value?.pairings) || !Array.isArray(value?.pendingRevokes)) throw { key: "data.pairings-invalid" };
        world.patch({ "app.pairings": structuredClone(value.pairings), "app.pendingRevokes": structuredClone(value.pendingRevokes) });
      },
    },
    async deleteAll() {
      if (world.state.app?.resetFailure === "service") throw { key: "reset.service-failed" };
      if (world.state.local?.state === "installing") throw { key: "reset.busy" };
      const service = world.state.local?.state === "absent" ? "absent" : "removed";
      await world.delay(450); // the installed connector's top-level uninstall, not serviceUninstall()
      world.patch({ "local.state": "absent", "local.installed": false });
      const modelsFailed = world.state.app?.resetFailure === "models";
      const failed = modelsFailed ? [{ step: "models", key: "remove" }] : [];
      const result = { state: failed.length ? "partial" : "complete", completed: ["app-data", "webview", "cache"], failed, agents: {} };
      // Native returns while the app is still visible, then the helper runs after the app exits.
      void world.delay(550).then(() => {
        world.patch({
          "app.pairings": [], "app.pendingRevokes": [], "app.shortcut": null,
          "app.shortcutRefused": false, "app.alwaysShown": false,
          "app.resetReport": result, setup: null,
          "voice.keys": {}, ...(modelsFailed ? {} : { "voice.installed": {} }),
          "local.devices": [],
        });
        relaunch?.({ reset: true });
      });
      return { state: "needs-restart", service, agents: {}, failed: [], pending: ["app-data", "models", "webview"] };
    },
    async uninstall() {
      if (world.state.app?.resetFailure === "unremovable") throw { key: "reset.app-unremovable" };
      if (world.state.app?.resetFailure === "service") throw { key: "reset.service-failed" };
      if (world.state.local?.state === "installing") throw { key: "reset.busy" };
      const service = world.state.local?.state === "absent" ? "absent" : "removed";
      await world.delay(450);
      world.patch({ "local.state": "absent", "local.installed": false });
      // The helper runs once the app has quit: everything gone, the app in the Trash, nothing relaunched.
      void world.delay(550).then(() => {
        world.patch({
          "app.pairings": [], "app.pendingRevokes": [], "app.shortcut": null, "app.shortcutRefused": false, "app.alwaysShown": false,
          "app.resetReport": null, setup: null, "voice.keys": {}, "voice.installed": {}, "local.devices": [],
        });
        relaunch?.({ reset: true, uninstalled: true });
      });
      return { state: "needs-quit", service, agents: {}, failed: [], pending: ["app-data", "models", "webview", "app"] };
    },
    async resetReport() {
      const report = world.state.app?.resetReport ?? null;
      if (report) world.patch({ "app.resetReport": null });
      return report;
    },
  };

  /** The state after a start: running, or what the world says a start ends in. */
  async function starting() {
    set({ state: "starting", failure: null });
    await world.delay(1500);
    const outcome = local().startsAs ?? "running";
    set({ state: outcome, failure: outcome === "running" ? null : local().startFailure ?? { key: "start.failed", step: "service-start" } });
  }

  /** Whatever the install command leaves: Sidevoice installed with its service, starting, then as a start ends. */
  async function commandRun() {
    set({ commandRun: null, installed: true, service: "launchd", state: "starting", failure: null });
    await starting();
  }

  /** @type {LocalHostBridge} */
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
  };
  /** Installing Sidevoice from the app (the desktop app's, from the npm platform package), unless the world's app has none. */
  const appInstall = {
    /** @type {NonNullable<LocalHostBridge["install"]>} */
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
  };
  if (local().appInstalls !== false) Object.assign(localHost, appInstall);
  Object.assign(localHost, {
    async version() {
      const bundled = { version: local()?.bundledVersion ?? LOCAL_VERSION };
      return {
        bridge: 1, bundled, installed: local()?.installed === false ? null : { version: local()?.version ?? LOCAL_VERSION },
        core_api: 1, update: local()?.update ?? "current",
      };
    },
    async update() {
      await world.delay(1200);
      set({ version: local()?.bundledVersion ?? LOCAL_VERSION, update: "current" });
      await starting();
      return status();
    },
  });
  // The install command run by hand (a scenario's "ran the install command"), as the world loads or whenever it says so.
  if (local().commandRun) void commandRun();
  world.subscribe(() => { if (local()?.commandRun) void commandRun(); });
  const voice = fakeVoice(world);
  world.voiceRuntime = voice;
  const host = {
    app: "sidevoice-desktop",
    version: "0.0.0-preview",
    // The app's call settings (after sidevoice-desktop #56): the mute shortcut and the call controls always shown.
    ...(world.state.app?.desktopSettings === false ? {} : { muteShortcut: muteShortcutOf(world), callControls: callControlsOf(world) }),
    // The app's own build (sidevoice-desktop #56): a release, a nightly or a development build, as the world says.
    build: buildOf(world.state.app?.channel ?? "release"),
    // A release's or a nightly's updater (sidevoice-desktop #56): its mode and its state are the world's
    // (`app.update`), stepped from the card or a scenario's options, and heard by the page as they change.
    ...(hasAppUpdater(world) ? { updater: appUpdaterOf(world) } : {}),
    computerName: local()?.computerName ?? "Mac de Ana",
    voice: voice.host,
    // Where the app runs the call (macOS), the microphone's permission is the app's to ask for (sidevoice-desktop#93).
    microphone: appMicrophone(world),
    engine: desktopEngine(world),
    data,
    localHost,
  };
  // The app's number is the one it runs: APP_VERSION, or the update it restarted into (`app.version`).
  Object.defineProperty(host, "build", { enumerable: true, get: () => ({ ...buildOf(world.state.app?.channel ?? "release"), version: appVersion(world) }) });
  world.relaunchPage = relaunch;
  return host;
}

/** The desktop app's version where the world names none: the app's own number, apart from its service's (LOCAL_VERSION). */
export const APP_VERSION = "0.3.0";
/** The desktop app's version now: APP_VERSION, or the update it restarted into. */
export const appVersion = (world) => world.state.app?.version ?? APP_VERSION;

/** Whether this computer's Sidevoice is behind: the app bundles a newer one than the one installed, so its local host's
 *  `version()` says `update: "available"` (and the page offers to update this machine). */
export const localBehind = (world) => world.state.local?.update === "available";

/** Makes this computer's Sidevoice behind, the app bundling one a minor on from the one installed, or current, the app
 *  bundling the one installed (the card's "Updates elsewhere"). Only where the world has a local host: whether it has.
 *  The page asks `version()` as it loads, and again only when the host's state or its core's version changes. */
export function setLocalBehind(world, behind) {
  const local = world.state.local;
  if (!local) return false;
  const installed = local.version ?? LOCAL_VERSION;
  world.patch({ "local.update": behind ? "available" : "current", "local.bundledVersion": behind ? nextMinor(installed) : installed });
  return true;
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

/** Whether the desktop app's build has an updater (`host.updater`): a release does and, for now, a nightly too
 *  (sidevoice-desktop #56); a development build has none. */
export const hasAppUpdater = (world) => ["release", "nightly"].includes(world.state.app?.channel ?? "release");

/** The desktop app's `host.build` for `channel`. A release and a nightly have an updater (`hasAppUpdater`). */
function buildOf(channel) {
  if (channel === "nightly") return { channel, version: APP_VERSION, commit: "abc1234def", date: "2026-10-13T06:12:00Z" };
  if (channel === "dev") return { channel, version: APP_VERSION, commit: "0f1e2d3c" };
  return { channel: "release", version: APP_VERSION };
}

/** The app's version a check finds, in the preview: the one after APP_VERSION (after an update, the one after that). */
export const UPDATE_VERSION = nextMinor(APP_VERSION);

/** The updater's states the card steps through, and the world's `app.update` fields each one sets. A failure is the
 *  state it leaves the updater in, with its error; the next check, download or restart clears it. */
export const UPDATER_STATES = [
  { id: "idle", label: "Idle", set: { state: "idle", progress: null, error: null } },
  { id: "available", label: "Available", set: { state: "available", progress: null, error: null } },
  { id: "downloading", label: "Downloading", set: { state: "downloading", progress: 0, error: null } },
  { id: "ready", label: "Ready", set: { state: "ready", progress: null, error: null } },
  { id: "check-failed", label: "Check failed", set: { state: "idle", progress: null, error: "update-check-failed" } },
  { id: "download-failed", label: "Download failed", set: { state: "available", progress: null, error: "update-download-failed" } },
  { id: "install-failed", label: "Install failed", set: { state: "ready", progress: null, error: "update-install-failed" } },
];

const updateOf = (world) => world.state.app?.update ?? {};
const setUpdate = (world, fields) => world.patch(Object.fromEntries(Object.entries(fields).map(([k, v]) => [`app.update.${k}`, v])));
/** The updater's mode: automatic unless the world says manual. */
export const updaterMode = (world) => updateOf(world).mode === "manual" ? "manual" : "automatic";

/** The updater's status (sidevoice-desktop #56 `UpdaterStatus`), from the world's `app.update`. */
export function updaterStatus(world) {
  const update = updateOf(world);
  const state = ["available", "downloading", "ready"].includes(update.state) ? update.state : "idle";
  return {
    state,
    // Always newer than the app it updates: the one after the app's version, unless the world names one.
    ...(state !== "idle" ? { version: update.version ?? nextMinor(appVersion(world)) } : {}),
    ...(state === "downloading" ? { progress: Math.max(0, Math.min(1, update.progress ?? 0)) } : {}),
    ...(update.error ? { error: { code: update.error } } : {}),
  };
}

/** Whether the updater, in automatic mode, would be downloading what it found by now: found, and not a download that
 *  failed (that one waits for its Retry) nor one the person cancelled (`cancel`: it waits for their `download`).
 *  Automatic never rests at "available" otherwise. */
const autoDownloads = (world) => updaterMode(world) === "automatic" && updateOf(world).state === "available" && !updateOf(world).error
  && updateOf(world).cancelled !== updaterStatus(world).version;

/** How long the app's check takes, in the world's time: a request to the release feed, ~1.5 s. */
export const CHECK_MS = 1500;
/** A download in the world's time: what each step adds to its progress (uneven, as chunks arrive; they add up to the
 *  whole), one every DOWNLOAD_STEP_MS — ~7 s from 0 to ready. */
export const DOWNLOAD_STEPS = [0.04, 0.07, 0.09, 0.11, 0.1, 0.12, 0.1, 0.09, 0.11, 0.08, 0.06, 0.03];
export const DOWNLOAD_STEP_MS = 600;

/** Starts downloading what was found, moving on to ready on the world's clock. A download asked for lifts a cancel. */
function startDownload(world) {
  setUpdate(world, { state: "downloading", progress: 0, error: null, cancelled: null });
  void driveDownload(world);
}

/** The updater's mode, as the app keeps it: the one place it is set, by the page (`setMode`) or by the card. Automatic
 *  downloads what was found and not downloaded yet. The page reads the mode as it loads (sidevoice-desktop #56 pushes
 *  only the status): whoever sets it from outside the page loads the page again. */
export function setUpdaterMode(world, mode) {
  if (mode !== "automatic" && mode !== "manual") throw Object.assign(new Error("mode-invalid"), { code: "mode-invalid" });
  setUpdate(world, { mode });
  if (autoDownloads(world)) startDownload(world);
  return { mode };
}

/** The card's step `id` (UPDATER_STATES): its fields set, and a download moving on from there. Available, in automatic
 *  mode, downloads at once, as the app would. */
export function setUpdaterState(world, id) {
  const step = UPDATER_STATES.find((s) => s.id === id);
  if (!step) return;
  setUpdate(world, { ...step.set, installed: false, cancelled: null });
  if (step.set.state === "downloading" || autoDownloads(world)) startDownload(world);
}

/** Moves a download on to ready on the world's clock, step by step (DOWNLOAD_STEPS), while the world says it is
 *  downloading: once, however many ask. */
function driveDownload(world) {
  if (world.updaterJob) return world.updaterJob;
  world.updaterJob = (async () => {
    try {
      for (let step = 0; updateOf(world).state === "downloading"; step++) {
        await world.delay(DOWNLOAD_STEP_MS);
        if (updateOf(world).state !== "downloading") return;
        const progress = Math.min(1, Math.round(((updateOf(world).progress ?? 0) + DOWNLOAD_STEPS[step % DOWNLOAD_STEPS.length]) * 100) / 100);
        setUpdate(world, progress >= 1 ? { state: "ready", progress: null } : { progress });
      }
    } finally {
      world.updaterJob = null;
    }
  })();
  return world.updaterJob;
}

/** The app's check, as sidevoice-desktop #56 runs it — the page's `check()`, or the app's own at launch and every 6 h
 *  (the card's App checks): CHECK_MS, then the one after the app's version unless it was just installed, available; in
 *  automatic mode its download starts at once (one found before and not downloaded too), so the check answers
 *  downloading; in manual mode it stays available until `download`. Nothing found: the status stays as it was. */
export async function checkForUpdate(world) {
  await world.delay(CHECK_MS);
  const update = updateOf(world);
  if ((update.state ?? "idle") === "idle" && !update.installed) {
    setUpdate(world, { state: "available", version: nextMinor(appVersion(world)), progress: null, error: null });
    if (updaterMode(world) === "automatic") startDownload(world);
  } else {
    setUpdate(world, { error: null });
    if (autoDownloads(world)) startDownload(world);
  }
  return updaterStatus(world);
}

/** The desktop app's updater (sidevoice-desktop #56), a release's or a nightly's: automatic or manual, and its state,
 *  kept in the world (`app.update`). A check takes CHECK_MS (`checkForUpdate`); a download moves on to ready over
 *  ~7 s, in steps (DOWNLOAD_STEPS); only a restart installs a ready one. The card steps it to any state, failures too
 *  (UPDATER_STATES), runs the app's own check, and sets its mode (`setUpdaterMode`). */
function appUpdaterOf(world) {
  const log = (call) => world.log({ method: "BRIDGE", url: `updater.${call}`, status: "ok", mocked: true });
  return {
    settings: async () => ({ mode: updaterMode(world) }),
    async setMode(mode) {
      const answer = setUpdaterMode(world, mode);
      log(`setMode(${mode})`);
      return answer;
    },
    async status() {
      if (updateOf(world).state === "downloading") void driveDownload(world);
      return updaterStatus(world);
    },
    subscribe(listener) {
      let last = JSON.stringify(updaterStatus(world));
      return world.subscribe(() => {
        // A download a scenario's option set moves on too.
        if (updateOf(world).state === "downloading") void driveDownload(world);
        const next = updaterStatus(world);
        const text = JSON.stringify(next);
        if (text !== last) {
          last = text;
          listener(next);
        }
      });
    },
    async check() {
      const answer = await checkForUpdate(world);
      log("check()");
      return answer;
    },
    async download() {
      log("download()");
      if (updateOf(world).state === "available") startDownload(world);
      return updaterStatus(world);
    },
    /** As the app's: stops a download in progress, the update staying known, `available` and without an error; the
     *  version stopped is left alone by automatic mode until a `download()`. With none in progress it changes nothing. */
    async cancel() {
      log("cancel()");
      if (updateOf(world).state !== "downloading") return;
      setUpdate(world, { state: "available", progress: null, error: null, cancelled: updaterStatus(world).version });
    },
    async restart() {
      log("restart()");
      await world.delay(800);
      if (updateOf(world).state !== "ready") return;
      // The app runs the update it installed: its number is that one's, and the next a check could find is after it.
      world.patch({ "app.version": updaterStatus(world).version });
      setUpdate(world, { state: "idle", version: null, progress: null, error: null, installed: true });
      // A new app brings a newer service: this computer's is behind it now, if it was not already.
      const local = world.state.local;
      if (local && local.state !== "absent" && local.installed !== false && (local.update ?? "current") === "current") setLocalBehind(world, true);
      // A restart opens a new window: the page loads again.
      world.relaunchPage?.();
    },
  };
}

/** An install outcome names where it fails: `<step>@<key>` (`download@install.network`). */
function stepKeyFor(step) {
  return `${step}@`;
}
