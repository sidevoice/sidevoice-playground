// Web preview: the preview origin, a listener of its own so the web's storage there is never the playground's. It
// serves the running web build's static site as a deployment serves it (`/` → `/voice/`, the page's routes falling
// back to `/voice/index.html`, `/voice/target.js` left as the build wrote it, so the page targets this origin), and
// passes the core's routes (`/api/…`, the call's socket among them) to the running core as they are: the core
// answers this origin because the run told it to, so nothing is rewritten.
//
// `/preview-reset` is this origin's one page of its own: it empties what the browser keeps here (storage, IndexedDB,
// caches, service workers; with `Clear-Site-Data` too, so it works whatever the page's own script can still do) and
// goes on to the web — or, mocked, to the shell with nothing picked — so a preview starts as on a device that never
// saw it. The access cookie stays.
//
// A mocked run serves no core: `/` is the shell (mock/shell.html), with the card, that holds the web in a frame;
// `/preview-mock/…` its modules and its scenarios; and the site's `/voice/target.js` is the mocks' (mock/frame.js),
// which hands the page to the shell before the web starts. The rest of the site is served as it was built.

import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validMockScenario } from "./mock/world.mjs";
import { chunkFor, exportedNames, mockChunk, packageOf } from "./mock/chunks.mjs";

const MOCK_DIR = fileURLToPath(new URL("./mock/", import.meta.url));
const OBSERVE = fileURLToPath(new URL("./turn-lab/observe.js", import.meta.url));
/** What the shell may load from mock/: a module or a stylesheet right in it, by a plain name — no path, nothing
 *  hidden, so nothing outside mock/ — read when asked, so a module added there is served without a restart. Its
 *  types, its scenarios and the page's target are not served under it. */
export const MOCK_FILE = /^[a-z0-9][a-z0-9-]*\.(?:mjs|css)$/;
export const MOCK_PATH = "/preview-mock/";

/** The mocked preview's scenarios (mock/scenarios/*.json), in their files' order, each with the voice's and the
 *  models' options (mock/voice-options.json) after its own. An option starts at its first value, or at the one the
 *  scenario's `defaults` names for it (`{ "<option>": "<value>" }`): a shared option seeded per scenario. */
export async function loadMockScenarios(dir = join(MOCK_DIR, "scenarios")) {
  const files = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  const shared = JSON.parse(await readFile(join(MOCK_DIR, "voice-options.json"), "utf8"));
  const scenarios = [];
  for (const file of files) {
    const { defaults = {}, ...value } = JSON.parse(await readFile(join(dir, file), "utf8"));
    value.options = [...(value.options ?? []), ...shared.filter((option) => !value.options?.some((own) => own.id === option.id))];
    if (!validMockScenario(value)) throw new Error(`${file} is not a mocked scenario`);
    for (const [id, start] of Object.entries(defaults)) {
      const at = value.options.findIndex((o) => o.id === id);
      const first = value.options[at]?.values.find((v) => v.value === start);
      if (!first) throw new Error(`${file}: its defaults name ${id}=${start}, which no option offers`);
      // A copy: the shared options are every scenario's.
      value.options[at] = { ...value.options[at], values: [first, ...value.options[at].values.filter((v) => v !== first)] };
    }
    scenarios.push(value);
  }
  return scenarios;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

export const RESET_PATH = "/preview-reset";

/** The page that empties this origin's browser storage, then opens `next`. */
export function resetPage(next = "/voice/") {
  return `<!doctype html><meta charset="utf-8"><title>Resetting the preview</title><p>Starting from a device that never saw this…</p>
<script>
// Each step bounded, and the page goes on in 4 s whatever: a storage that never answers is no reason to stay here.
const go = () => location.replace(${JSON.stringify(next)});
setTimeout(go, 4000);
const bounded = (work) => Promise.race([Promise.resolve().then(work).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
(async () => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  await bounded(async () => { for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name); });
  await bounded(async () => { for (const key of await caches.keys()) await caches.delete(key); });
  await bounded(async () => { for (const worker of await navigator.serviceWorker.getRegistrations()) await worker.unregister(); });
  go();
})();
</script>`;
}

/** Whether `pathname` is the core's: what the web asks a node for, and the room's routes. */
export function coreRoute(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/** The file of `site` a request for `pathname` gets: the file, or the page for its routes. */
export function sitePath(site, pathname) {
  if (pathname === "/" || pathname === "") return { redirect: "/voice/" };
  if (pathname === "/voice") return { redirect: "/voice/" };
  const root = site + sep;
  const path = normalize(join(root, decodeURIComponent(pathname)));
  if (!path.startsWith(root)) return { forbidden: true };
  if (!extname(path) || pathname.endsWith("/")) return { path: join(site, "voice/index.html"), fallback: true };
  return { path };
}

/**
 * The preview origin's handlers. `runs` is the run manager (runs.mjs): its `current` says what to serve and where the
 * core listens; `onReset` is told when the reset page went out.
 */
export function previewOrigin({ runs, onReset = () => runs.resetDone() }) {
  async function handle(req, res) {
    const url = new URL(req.url, "http://preview");
    const run = runs.current;
    // The way out works with or without a run: it is what a browser stuck on this origin is sent to.
    if (url.pathname === RESET_PATH) {
      if (run) onReset();
      const next = url.searchParams.get("next") ?? (run?.mode === "real" ? "/voice/" : "/");
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store", "clear-site-data": '"cache", "storage"' });
      return res.end(resetPage(next.startsWith("/") && !next.startsWith("//") ? next : "/"));
    }
    if (!run) return send(res, 503, "No preview is running: start one from the playground's Web preview section.");
    if (run.mode === "mock" || run.mode === "dev") {
      const served = await mockFile(url.pathname);
      if (served) {
        res.writeHead(200, { "content-type": served.type, "cache-control": "no-store" });
        return res.end(served.body);
      }
      if (coreRoute(url.pathname)) return send(res, 404, "a mocked preview has no core: its page asks its mocks");
    }
    if (run.mode === "dev") return devProxy(req, res, run.port, url);
    if (coreRoute(url.pathname)) return proxy(req, res, run.port);
    // A fresh run's first page goes through the reset page, once.
    if (run.mode !== "mock" && run.reset && (url.pathname === "/" || url.pathname.startsWith("/voice/")) && !extname(url.pathname)) {
      res.writeHead(303, { location: `${RESET_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" });
      return res.end();
    }
    const target = sitePath(run.site, url.pathname);
    if (target.redirect) {
      res.writeHead(302, { location: target.redirect });
      return res.end();
    }
    if (target.forbidden) return send(res, 403, "outside the site");
    // Mocked, the web's voice and engine packages are the mocks' (mock/chunks.mjs).
    const chunk = run.mode === "mock" && url.pathname.startsWith("/voice/assets/") ? await chunkFor(target.path) : null;
    if (chunk) {
      res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
      return res.end(chunk);
    }
    try {
      let body = await readFile(target.path);
      if (run.scenario === "turn-lab" && url.pathname === "/voice/target.js") {
        body = Buffer.concat([body, Buffer.from("\n"), await readFile(OBSERVE)]);
      }
      // Mocked, scripts are never kept: a package chunk the browser kept from a run with the real one would win.
      const noStore = target.fallback || target.path.endsWith("target.js") || target.path.endsWith("index.html") ||
        (run.mode === "mock" && target.path.endsWith(".js"));
      res.writeHead(200, {
        "content-type": TYPES[extname(target.path)] ?? "application/octet-stream",
        "cache-control": noStore ? "no-store" : "public, max-age=3600",
      });
      res.end(body);
    } catch {
      send(res, 404, "not found");
    }
  }

  /** A request passed to the core as it came, and its answer back as it went. */
  function proxy(req, res, port) {
    const upstream = httpRequest({ host: "127.0.0.1", port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) send(res, 502, "the core does not answer");
      else res.destroy();
    });
    req.pipe(upstream);
  }

  /**
   * A dev run's request passed to its dev server; a module of the web's voice or engine package (told by its exports,
   * as a build's chunks are) answered with the mocks' instead.
   */
  function devProxy(req, res, port, url) {
    const maybePackage = req.method === "GET" && /sidevoice/i.test(url.pathname);
    const headers = { ...req.headers };
    if (maybePackage) delete headers["accept-encoding"];
    const upstream = httpRequest({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (answer) => {
      const type = String(answer.headers["content-type"] ?? "");
      if (!maybePackage || !/javascript/.test(type)) {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        return answer.pipe(res);
      }
      const chunks = [];
      answer.on("data", (chunk) => chunks.push(chunk));
      answer.on("end", () => {
        const code = Buffer.concat(chunks);
        const names = exportedNames(code.toString("utf8"));
        const kind = packageOf(names);
        if (!kind) {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          return res.end(code);
        }
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
        res.end(mockChunk(kind, names));
      });
    });
    upstream.on("error", () => {
      if (!res.headersSent) send(res, 502, "the dev server does not answer");
      else res.destroy();
    });
    req.pipe(upstream);
  }

  /** A socket upgrade passed on, bytes both ways: the call's to the core, or, in a dev run, the hot reload's to Vite. */
  function upgrade(req, socket, head) {
    const run = runs.current;
    const url = new URL(req.url, "http://preview");
    if (!run || run.mode === "mock" || (run.mode === "real" && !coreRoute(url.pathname))) return socket.destroy();
    const core = connect(run.port, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      core.write(lines.join("\r\n") + "\r\n\r\n");
      if (head?.length) core.write(head);
      core.pipe(socket);
      socket.pipe(core);
    });
    const close = () => {
      core.destroy();
      socket.destroy();
    };
    core.on("error", close);
    socket.on("error", close);
  }

  return { handle, upgrade };
}

/** What a mocked run serves of its own at `pathname`: `{ type, body }`, or null for the site's files. */
export async function mockFile(pathname) {
  if (pathname === "/") return { type: TYPES[".html"], body: await readFile(join(MOCK_DIR, "shell.html")) };
  // A dev server writes the page's `/voice/target.js` under its base again: `/voice/voice/target.js`.
  if (pathname === "/voice/target.js" || pathname === "/voice/voice/target.js") {
    return { type: TYPES[".js"], body: await readFile(join(MOCK_DIR, "frame.js")) };
  }
  if (pathname === `${MOCK_PATH}scenarios.json`) return { type: TYPES[".json"], body: JSON.stringify(await loadMockScenarios()) };
  if (!pathname.startsWith(MOCK_PATH)) return null;
  const name = pathname.slice(MOCK_PATH.length);
  if (!MOCK_FILE.test(name)) return null;
  try {
    return { type: TYPES[extname(name)], body: await readFile(join(MOCK_DIR, name)) };
  } catch {
    return null;
  }
}

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
