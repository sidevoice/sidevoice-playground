// The microphone's permission in the mocked preview (sidevoice-web#129, the setup's microphone step): the world's
// `voice.mic` says where it stands and what asking does, and both places the page asks hear it — in a browser, its
// `navigator.permissions.query({name: "microphone"})` and `navigator.mediaDevices.getUserMedia` (pagePermission); in the
// desktop app, `host.microphone` (appMicrophone; sidevoice-desktop#93). The voice's own start asks the same way
// (voice.mjs). The scenario card's Voice › Microphone picks it, live: allowed, not asked yet (allowed, blocked or
// closed when asked), blocked, blocked then allowed (the next ask finds it allowed, as after fixing it in the
// settings), or none connected. No DOM here but the page's own, handed in.
// @ts-check

/** What `voice.mic` can be: where the permission stands, and what the next ask does. */
export const MIC_STATES = ["granted", "prompt", "prompt-block", "prompt-dismiss", "denied", "denied-then-allowed", "missing"];

/** How long the browser's or the system's prompt stays open before the mocked person answers it. */
export const PROMPT_MS = 1200;

const mic = (world) => world.state.voice?.mic ?? "granted";

/** The permission as the platform reads it without asking: "prompt" | "granted" | "denied". No microphone connected
 *  reads as not asked: only asking finds there is none. */
export function micPermission(world) {
  const state = mic(world);
  if (state === "granted") return "granted";
  if (state === "denied" || state === "denied-then-allowed") return "denied";
  return "prompt";
}

/** Asks for the microphone, as `getUserMedia` or the system's request does: a prompt (answered after PROMPT_MS of the
 *  world's time) where it was not asked yet, else the stored answer at once. Resolves "granted", "denied", "dismissed"
 *  (the prompt closed without an answer: still not asked) or "missing" (none connected). */
export async function askMicrophone(world) {
  const state = mic(world);
  if (state.startsWith("prompt")) await world.delay(PROMPT_MS);
  // What the person answered (or the setting fixed meanwhile) is what the platform keeps.
  const next = { prompt: "granted", "prompt-block": "denied", "prompt-dismiss": "prompt", "denied-then-allowed": "granted" }[mic(world)];
  const now = mic(world);
  if (next) world.patch({ "voice.mic": next });
  world.log({ method: "MIC", url: `ask (${now})`, status: next ?? now, mocked: true });
  if (now === "missing") return "missing";
  if (now === "prompt-dismiss") return "dismissed";
  return micPermission(world) === "granted" ? "granted" : "denied";
}

/** The desktop app's `host.microphone` (macOS, where the app runs the call): the system's permission for the app. */
export function appMicrophone(world) {
  return Object.freeze({
    state: async () => micPermission(world),
    // The system has no "dismissed" (its prompt is answered) and the app none of "missing": allowed or not.
    request: async () => (await askMicrophone(world)) === "granted" ? "granted" : "denied",
    openSettings: async () => { world.log({ method: "MIC", url: "open System Settings › Privacy & Security › Microphone", status: "ok", mocked: true }); },
  });
}

/**
 * The browser's side in the page `win`: `permissions.query` answers the microphone's from the world (a status whose
 * `change` fires as the world's changes, as a browser's does when its setting changes), and `getUserMedia` asks it,
 * refusing as a browser does (`NotAllowedError`, `NotFoundError`) or giving a stream with no tracks to stop.
 * @param {Window & typeof globalThis} win
 */
export function pagePermission(win, world) {
  const nav = win.navigator;
  const realQuery = nav.permissions?.query?.bind(nav.permissions);
  /** @type {(EventTarget & { name: string, state: string, onchange: any }) | null} */
  let status = null;
  function microphoneStatus() {
    if (status) return status;
    const target = new win.EventTarget();
    let last = micPermission(world);
    status = Object.assign(target, { name: "microphone", onchange: null });
    Object.defineProperty(status, "state", { enumerable: true, get: () => micPermission(world) });
    target.addEventListener("change", (event) => { if (typeof status?.onchange === "function") status.onchange.call(status, event); });
    const stop = world.subscribe(() => {
      const now = micPermission(world);
      if (now === last) return;
      last = now;
      setTimeout(() => target.dispatchEvent(new win.Event("change")), 0);
    });
    win.addEventListener("pagehide", () => stop());
    return status;
  }
  const permissions = {
    query: async (descriptor) => descriptor?.name === "microphone" ? microphoneStatus()
      : realQuery ? realQuery(descriptor) : Promise.reject(new win.TypeError(`'${descriptor?.name}' is not a valid permission name`)),
  };
  Object.defineProperty(nav, "permissions", { configurable: true, value: permissions });
  const media = nav.mediaDevices ?? {};
  const getUserMedia = async (/** @type {MediaStreamConstraints} */ constraints) => {
    if (!constraints?.audio) throw new win.DOMException("Only the microphone is mocked.", "NotSupportedError");
    const answer = await askMicrophone(world);
    if (answer === "missing") throw new win.DOMException("Requested device not found", "NotFoundError");
    if (answer !== "granted") throw new win.DOMException("Permission denied", "NotAllowedError");
    return typeof win.MediaStream === "function" ? new win.MediaStream() : { getTracks: () => [] };
  };
  if (nav.mediaDevices) Object.defineProperty(media, "getUserMedia", { configurable: true, value: getUserMedia });
  else Object.defineProperty(nav, "mediaDevices", { configurable: true, value: { getUserMedia } });
}
