// The web shell's server: the page from web/, and /fetch, which downloads a sidevoice-engine release asset for the
// page (github.com sends no CORS headers). Listens on localhost only; /fetch takes engine release URLs only.
//
//   node server.mjs            PORT=5174 by default

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./web/", import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);
const ALLOWED = "https://github.com/sidevoice/sidevoice-engine/releases/download/";
const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css" };

export function allowed(url) {
  return typeof url === "string" && url.startsWith(ALLOWED) && !url.slice(ALLOWED.length).includes("..");
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/fetch") {
    const target = url.searchParams.get("url");
    if (!allowed(target)) return send(res, 403, `only ${ALLOWED}*`);
    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok) return send(res, 502, `${target}: HTTP ${upstream.status}`);
    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(ROOT)) return send(res, 403, "outside web/");
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, "not found");
  }
}

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer((req, res) => handle(req, res).catch((e) => send(res, 500, String(e)))).listen(PORT, "127.0.0.1", () =>
    console.log(`sidevoice-playground on http://localhost:${PORT}`),
  );
}
