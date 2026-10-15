// What the shell puts into the page before the web starts: a `fetch` that the mocked machines answer (machines.mjs),
// a `WebSocket` whose call sockets the mocked machines' rooms hold (machines.mjs `callSocket`) and, in the app view,
// the desktop app's bridge (bridge.mjs: its local host, voice and engine). In the browser view the
// page's own voice and engine packages are the mocks' too: the origin serves their chunks as `module(kind)` here. Anything that is not a mocked address — the site's
// own files, the dev server's hot reload — goes where it was going. Every answer is in the page's own realm (its
// Response, its errors, its events), so the web sees what a browser gives it. Each mocked request is logged in the
// world's activity.
// @ts-check

import { answer, callSocket, isCallSocket } from "./machines.mjs";
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

/**
 * The page `win`'s WebSocket: at a mocked machine's call socket, the machine's room on the other end
 * (machines.mjs `callSocket`); anywhere else, the page's own WebSocket. It behaves as a browser's does: `readyState`
 * goes from CONNECTING to OPEN (or, when it never opens, to CLOSED with an `error` then a `close` 1006), to CLOSING
 * and CLOSED; `open`, `message`, `error` and `close` reach both `addEventListener` and the `on…` handlers, each in a
 * task of its own and never inside the call that caused it; `send` while connecting throws, and after the close does
 * nothing; `close` takes only the codes a page may send. Its events are the page's (`MessageEvent`, `CloseEvent`).
 * A page that goes away (pagehide) leaves its calls, as its sockets would close with it.
 * @param {Window & typeof globalThis} win
 */
export function mockedWebSocket(win, { world, identities }) {
  const Real = win.WebSocket;
  const pageOrigin = win.location.origin;
  /** The page's sockets still open, each with what leaving the page does to it. */
  const live = new Map();
  win.addEventListener("pagehide", () => {
    for (const leave of [...live.values()]) leave();
  });
  /** One task later, as a network's answer comes. */
  const later = (fn) => setTimeout(fn, 0);
  const STATES = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 };

  class WebSocket extends win.EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    #url = "";
    #state = STATES.CONNECTING;
    #protocol = "";
    /** @type {{ send(text: string): void, close(code: number): void } | null} */
    #line = null;
    onopen = null;
    onmessage = null;
    onerror = null;
    onclose = null;
    binaryType = "blob";

    /** @param {string | URL} url @param {string | string[]} [protocols] */
    constructor(url, protocols = []) {
      let href = null;
      try {
        const parsed = new URL(String(url), win.location.href);
        parsed.protocol = parsed.protocol.replace(/^http/, "ws");
        href = parsed.href;
      } catch {}
      if (!href || !isCallSocket(href, pageOrigin)) return /** @type {any} */ (new Real(url, protocols));
      super();
      this.#url = href;
      // The `on…` handlers are listeners like any other, called in their turn.
      for (const type of ["open", "message", "error", "close"]) {
        this.addEventListener(type, (event) => {
          const handler = this[`on${type}`];
          if (typeof handler === "function") handler.call(this, event);
        });
      }
      live.set(this, () => {
        this.#state = STATES.CLOSED;
        live.delete(this);
        this.#line?.close(1001);
      });
      const asked = typeof protocols === "string" ? [protocols] : [...protocols];
      this.#line = callSocket(world, identities, { url: href, protocols: asked, pageOrigin }, {
        open: (protocol) => later(() => {
          if (this.#state !== STATES.CONNECTING) return;
          this.#state = STATES.OPEN;
          this.#protocol = protocol;
          this.dispatchEvent(new win.Event("open"));
        }),
        message: (text) => later(() => {
          if (this.#state === STATES.OPEN) this.dispatchEvent(new win.MessageEvent("message", { data: text, origin: new URL(href).origin }));
        }),
        close: (code, reason = "") => later(() => this.#closed(code, reason, code !== 1006)),
        fail: () => later(() => this.#closed(1006, "", false)),
      });
    }

    get url() { return this.#url; }
    get readyState() { return this.#state; }
    get protocol() { return this.#protocol; }
    get extensions() { return ""; }
    get bufferedAmount() { return 0; }
    get CONNECTING() { return STATES.CONNECTING; }
    get OPEN() { return STATES.OPEN; }
    get CLOSING() { return STATES.CLOSING; }
    get CLOSED() { return STATES.CLOSED; }

    /** @param {string} data */
    send(data) {
      if (this.#state === STATES.CONNECTING) {
        throw new win.DOMException("Failed to execute 'send' on 'WebSocket': Still in CONNECTING state.", "InvalidStateError");
      }
      if (this.#state !== STATES.OPEN) return;
      const text = String(data);
      later(() => this.#line?.send(text));
    }

    /** @param {number} [code] @param {string} [reason] */
    close(code, reason = "") {
      if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
        throw new win.DOMException(
          `Failed to execute 'close' on 'WebSocket': The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
          "InvalidAccessError",
        );
      }
      if (this.#state === STATES.CLOSING || this.#state === STATES.CLOSED) return;
      const opened = this.#state === STATES.OPEN;
      this.#state = STATES.CLOSING;
      later(() => {
        this.#line?.close(code ?? 1005);
        // A socket closed before it opened never had a connection to close cleanly.
        if (opened) this.#closed(code ?? 1005, reason, true);
        else this.#closed(1006, "", false);
      });
    }

    /** The connection is over: an `error` first when it did not end cleanly, then the `close`. */
    #closed(code, reason, clean) {
      if (this.#state === STATES.CLOSED) return;
      this.#state = STATES.CLOSED;
      live.delete(this);
      if (!clean) this.dispatchEvent(new win.Event("error"));
      this.dispatchEvent(new win.CloseEvent("close", { code, reason, wasClean: clean }));
    }
  }
  return WebSocket;
}

/** Puts the mocks for `world` into the page `win` (the iframe's window). `desktop`: whether it is the app view.
 * The desktop's floating card page (the web's call-controls.html, in the frame beside the room) gets only the app's
 * card seam, `card()` — card-host.mjs, fed from the room frame —: it fetches nothing.
 * @param {Window & typeof globalThis & { __sidevoiceDesktop?: unknown }} win
 * @param {{ world: any, identities: any, desktop: boolean, onKey?: (event: KeyboardEvent) => void, card?: () => unknown }} options */
export function attach(win, { world, identities, desktop, onKey, card }) {
  if (win.location.pathname.endsWith("/call-controls.html")) {
    win.__sidevoiceDesktop = { host: { app: "sidevoice-desktop", callControls: card?.() ?? null } };
    return;
  }
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
  win.WebSocket = /** @type {any} */ (mockedWebSocket(win, { world, identities }));
  // Restarting into an app update opens a new window: the page loads again, its session (sessionStorage: what it hid
  // for this run, an update notice's ×) started over, as a new window's is. The preview's own keys on this origin
  // (sidevoice-preview.*: the world kept over a reload) stay.
  if (desktop) win.__sidevoiceDesktop = { host: desktopHost(world, identities, { relaunch: ({ reset } = {}) => {
    if (reset) try {
      for (const key of Object.keys(win.localStorage)) if (key.startsWith("sidevoice.") && !key.startsWith("sidevoice-preview.")) win.localStorage.removeItem(key);
    } catch { /* The reset report still names what failed. */ }
    try {
      for (const key of Object.keys(win.sessionStorage)) if (!key.startsWith("sidevoice-preview.")) win.sessionStorage.removeItem(key);
    } catch { /* Nothing kept. */ }
    win.location.reload();
  } }) };
  // The card's shortcut works with the page focused too.
  win.addEventListener("keydown", (event) => onKey?.(event), true);
}
