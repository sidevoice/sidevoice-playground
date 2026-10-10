// Web preview: the preview origin, a listener of its own so the web's storage there is never the playground's. It
// serves the running web build's static site as a deployment serves it (`/` → `/voice/`, the page's routes falling
// back to `/voice/index.html`, `/voice/target.js` left as the build wrote it, so the page targets this origin), and
// passes the core's routes (`/api/…`, the call's socket among them) to the running core as they are: the core
// answers this origin because the run told it to, so nothing is rewritten.
//
// `/preview-reset` is this origin's one page of its own: it empties what the browser keeps here (storage, IndexedDB,
// caches) and goes on to the web, so a fresh scenario starts as on a device that never saw it.

import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";

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
(async () => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
  try { for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name); } catch {}
  try { for (const key of await caches.keys()) await caches.delete(key); } catch {}
  location.replace(${JSON.stringify(next)});
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
    if (!run) return send(res, 503, "No preview is running: start one from the playground's Web preview section.");
    if (url.pathname === RESET_PATH) {
      onReset();
      res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
      return res.end(resetPage(url.searchParams.get("next") ?? "/voice/"));
    }
    if (coreRoute(url.pathname)) return proxy(req, res, run.port);
    // A fresh run's first page goes through the reset page, once.
    if (run.reset && (url.pathname === "/" || url.pathname.startsWith("/voice/")) && !extname(url.pathname)) {
      res.writeHead(303, { location: `${RESET_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`, "cache-control": "no-store" });
      return res.end();
    }
    const target = sitePath(run.site, url.pathname);
    if (target.redirect) {
      res.writeHead(302, { location: target.redirect });
      return res.end();
    }
    if (target.forbidden) return send(res, 403, "outside the site");
    try {
      const body = await readFile(target.path);
      const noStore = target.fallback || target.path.endsWith("target.js") || target.path.endsWith("index.html");
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

  /** A socket upgrade (the call's) passed to the core, bytes both ways. */
  function upgrade(req, socket, head) {
    const run = runs.current;
    const url = new URL(req.url, "http://preview");
    if (!run || !coreRoute(url.pathname)) return socket.destroy();
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

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}
