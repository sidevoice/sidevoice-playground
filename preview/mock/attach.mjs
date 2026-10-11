// What the shell puts into the page before the web starts: a `fetch` that the mocked machines answer (machines.mjs)
// and, in the app view, the desktop app's bridge (bridge.mjs: its local host, voice and engine). In the browser view the
// page's own voice and engine packages are the mocks' too: the origin serves their chunks as `module(kind)` here. Anything that is not a mocked address — the site's
// own files — goes where it was going. Every answer is in the page's own realm (its Response, its errors), so the
// web sees what a browser gives it. Each mocked request is logged in the world's activity.
// @ts-check

import { answer } from "./machines.mjs";
import { desktopHost } from "./bridge.mjs";
import { webEngine } from "./models.mjs";
import { fakeVoice } from "./voice.mjs";

/**
 * What the page's `import()` of @sidevoice/engine (`engine`) or @sidevoice/voice (`voice`) gives, mocked: their
 * `WebEngine.create` and `createVoiceHost`, and an init that loads nothing. The served chunk re-exports these.
 */
export function mockModule(kind, world) {
  const init = async () => undefined;
  if (kind === "engine") return { default: init, initSync: () => undefined, WebEngine: { create: async (host) => webEngine(world, host) } };
  return {
    default: init, initSync: () => undefined,
    createVoiceHost: (source) => {
      const voice = fakeVoice(world, { source });
      world.voiceRuntime = voice;
      return voice.host;
    },
  };
}

/** Puts the mocks for `world` into the page `win` (the iframe's window). `desktop`: whether it is the app view.
 * @param {Window & typeof globalThis & { __sidevoiceDesktop?: unknown }} win */
export function attach(win, { world, identities, desktop, onKey }) {
  const realFetch = win.fetch.bind(win);
  const pageOrigin = win.location.origin;
  win.fetch = async (input, init = {}) => {
    const request = input instanceof win.Request ? input : null;
    const url = request ? request.url : String(input);
    const method = (init.method ?? request?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new win.Headers(init.headers ?? request?.headers ?? {}).entries());
    const body = typeof init.body === "string" ? init.body : request ? await request.clone().text() : null;
    const answered = await answer(world, identities, { method, url, headers, body, pageOrigin });
    if (!answered) return realFetch(input, init);
    if (answered.unreachable) {
      world.log({ method, url, status: "no answer", mocked: true });
      throw new win.TypeError("Failed to fetch");
    }
    world.log({ method, url, status: answered.status, mocked: true });
    return new win.Response(JSON.stringify(answered.body), {
      status: answered.status,
      headers: { "content-type": "application/json" },
    });
  };
  if (desktop) win.__sidevoiceDesktop = { host: desktopHost(world, identities) };
  // The card's shortcut works with the page focused too.
  win.addEventListener("keydown", (event) => onKey?.(event), true);
}
