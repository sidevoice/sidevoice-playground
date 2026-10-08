// The web shell's server: the page from web/, and /fetch, which downloads a sidevoice-engine release asset for the
// page (github.com sends no CORS headers). Listens on localhost only; /fetch takes engine release URLs only.
//
// Every route is behind the access gate (access.mjs): open it once with `?access=<token>`, the token being in
// --access-file (~/.agent/secrets/sidevoice-playground-access by default), made anew at each start.
//
// Engine builds it serves installed, with the import map their dependencies need (served-engine.mjs):
// - the local build, with --engine-tarball: /local-engine.json describes it, /local-engine/ serves it;
// - CI builds of git refs (refs.mjs): /ref-build?ref=<ref> fetches and installs one and describes it,
//   /engines/<sha>/ serves it. Actions artifacts need a GitHub token: --github-token-file, read-only use.
//
//   node server.mjs [--access-file FILE] [--github-token-file FILE]
//                   [--engine-tarball FILE [--engine-label TEXT] [--engine-sha256 HEX]]      PORT=5174 by default

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { accessToken, DEFAULT_ACCESS_FILE, gate } from "./access.mjs";
import { ENGINES_PREFIX, RefError, refBuilds } from "./refs.mjs";
import { installLocalEngine, LOCAL_PREFIX } from "./served-engine.mjs";

const ROOT = fileURLToPath(new URL("./web/", import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);
const ALLOWED = "https://github.com/sidevoice/sidevoice-engine/releases/download/";
const DEFAULT_GITHUB_TOKEN_FILE = join(homedir(), ".agent/secrets/github.token");
const TYPES = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
};

/** The local engine build, once installed (`installLocalEngine`), or null. */
let local = null;
/** The ref builds (`refBuilds`). Set when the server starts. */
let refs = null;
/** Whether a request may go through: every route needs it. Set when the server starts. */
let access = null;

export function allowed(url) {
  return typeof url === "string" && url.startsWith(ALLOWED) && !url.slice(ALLOWED.length).includes("..");
}

/** The import map for the served builds: the local one's names at the top level, each other build's in its scope. */
export function importMapFor(localBuild, others) {
  const map = { imports: localBuild?.imports ?? {} };
  if (others.length) map.scopes = Object.fromEntries(others.map((build) => [build.prefix, build.imports]));
  return map;
}

/** index.html with an import map ahead of the page's module, which needs it before it loads. */
export function withImportMap(html, map) {
  const script = `<script type="importmap">${JSON.stringify(map)}</script>\n    `;
  return html.replace('<script type="module"', `${script}<script type="module"`);
}

/** What the page needs of a served build. */
function describe({ label, version, sha256, entry, prefix, imports, sha, verified }) {
  return { label, version, sha256, entry, prefix, imports, sha, verified };
}

async function handle(req, res) {
  const verdict = access.check(req);
  if (verdict.redirect) {
    res.writeHead(303, { location: verdict.redirect, "set-cookie": verdict.cookie, "cache-control": "no-store" });
    return res.end();
  }
  if (!verdict.ok) return send(res, 401, "unauthorized: open the playground with the link you were given");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/fetch") {
    const target = url.searchParams.get("url");
    if (!allowed(target)) return send(res, 403, `only ${ALLOWED}*`);
    const upstream = await fetch(target, { redirect: "follow" });
    if (!upstream.ok) return send(res, 502, `${target}: HTTP ${upstream.status}`);
    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    return res.end(Buffer.from(await upstream.arrayBuffer()));
  }
  if (url.pathname === "/local-engine.json") {
    if (!local) return send(res, 404, "no local engine build: start the server with --engine-tarball");
    return sendJson(res, describe(local));
  }
  if (url.pathname === "/ref-build") {
    try {
      return sendJson(res, describe(await refs.get(url.searchParams.get("ref"))));
    } catch (error) {
      if (error instanceof RefError) return send(res, error.status, error.message);
      throw error;
    }
  }
  if (local && url.pathname.startsWith(LOCAL_PREFIX)) {
    return serveFile(res, local.site + sep, decodeURIComponent(url.pathname.slice(LOCAL_PREFIX.length)));
  }
  if (url.pathname.startsWith(ENGINES_PREFIX)) {
    const [sha, ...rest] = url.pathname.slice(ENGINES_PREFIX.length).split("/");
    const build = refs.installed(sha);
    if (!build) return send(res, 404, `no build of ${sha} is installed here: load it first`);
    return serveFile(res, build.site + sep, decodeURIComponent(rest.join("/")));
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(ROOT, "index.html"), "utf8");
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    return res.end(withImportMap(html, importMapFor(local, refs.all())));
  }
  return serveFile(res, ROOT, url.pathname);
}

async function serveFile(res, root, pathname) {
  const path = normalize(join(root, pathname));
  if (!path.startsWith(root)) return send(res, 403, "outside the served directory");
  try {
    const body = await readFile(path);
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, "not found");
  }
}

function sendJson(res, value) {
  res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
}

async function readToken(file) {
  try {
    return (await readFile(file, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      "access-file": { type: "string" },
      "github-token-file": { type: "string" },
      "engine-tarball": { type: "string" },
      "engine-label": { type: "string" },
      "engine-sha256": { type: "string" },
    },
  });
  access = gate(await accessToken(values["access-file"] ?? DEFAULT_ACCESS_FILE));
  const githubToken = await readToken(values["github-token-file"] ?? DEFAULT_GITHUB_TOKEN_FILE);
  if (!githubToken) console.log("no GitHub token: builds of git refs cannot be fetched (--github-token-file)");
  refs = refBuilds({ token: githubToken });
  if (values["engine-tarball"]) {
    local = await installLocalEngine({
      tarball: values["engine-tarball"],
      label: values["engine-label"],
      sha256: values["engine-sha256"],
    });
    console.log(`local engine: ${local.label}, version ${local.version}, sha256 ${local.sha256}, in ${local.site}`);
  }
  createServer((req, res) => handle(req, res).catch((e) => send(res, 500, String(e)))).listen(PORT, "127.0.0.1", () =>
    console.log(`sidevoice-playground on http://localhost:${PORT}`),
  );
}
