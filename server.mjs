// The web shell's server: the page from web/, and the engine builds the page loads. Listens on localhost only.
//
// Every route is behind the access gate (access.mjs): open it once with `?access=<token>`, the token being in
// --access-file (~/.agent/secrets/sidevoice-playground-access by default), made anew at each start.
//
// Engine builds it serves installed, with the import map their dependencies need (served-engine.mjs):
// - the local build, with --engine-tarball: /local-engine.json describes it, /local-engine/ serves it;
// - release builds (release-builds.mjs): /release-build?name=<v0.2.0 | nightly | latest> downloads one's tarball,
//   checks it against the release's SHA256SUMS, installs it and describes it; /engines/<its sha256>/ serves it;
// - CI builds of git refs (refs.mjs): /ref-build?ref=<ref> fetches and installs one and describes it,
//   /engines/<sha>/ serves it. Actions artifacts need a GitHub token: --github-token-file, read-only use.
//
// /engine-builds lists what there is to pick (engine-builds.mjs): releases, pull requests and branches, through the
// GitHub API with the same token; `?fresh=1` lists anew instead of answering from the short-lived copy it keeps.
//
// The voice module (`@sidevoice/voice`, sidevoice-voice) the same way: /voice-builds lists its pull requests and
// branches, /voice-build?ref=<ref> fetches and installs one CI build, /voices/<sha>/ serves it.
//
// Web preview (preview/): /preview/… runs the real sidevoice-web, built by checkout per commit, against the real core
// and connector of a picked release, in a scenario of preview/scenarios/. The web is served on a second listener, the
// preview origin (--preview-port, PORT + 1 by default; --preview-origin is its public address, behind a tunnel say),
// so its storage is its own; that origin passes the core's routes to the running core. Builds, archives and the
// scenarios' profiles live in --cache-dir (~/.cache/sidevoice-playground by default).
//
// /connector/ is the connector's test bench (`cargo xtask bench` in sidevoice-connector), reached through this server:
// a reverse proxy to --bench-url (http://127.0.0.1:4477 by default), so the bench's page and logic stay in the connector
// and only one copy of them exists. The bench answers only requests naming its own host, which the proxy does.
//
//   node server.mjs [--access-file FILE] [--github-token-file FILE] [--bench-url URL]
//                   [--preview-port PORT] [--preview-origin URL] [--cache-dir DIR]
//                   [--engine-tarball FILE [--engine-label TEXT] [--engine-sha256 HEX]]      PORT=5174 by default

import { createServer } from "node:http";
import { previewSection } from "./preview/index.mjs";
import { previewOrigin } from "./preview/proxy.mjs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { accessToken, DEFAULT_ACCESS_FILE, gate } from "./access.mjs";
import { engineBuilds } from "./engine-builds.mjs";
import { proxyBench } from "./bench.mjs";
import { ENGINES_PREFIX, githubApi, RefError, refBuilds, VOICES_PREFIX } from "./refs.mjs";
import { releaseBuilds } from "./release-builds.mjs";
import { installLocalEngine, installVoice, LOCAL_PREFIX } from "./served-engine.mjs";
import { publicApi } from "./web/engine/listing.mjs";
import { VOICE } from "./web/sources.mjs";

const ROOT = fileURLToPath(new URL("./web/", import.meta.url));
const PORT = Number(process.env.PORT ?? 5174);
const DEFAULT_GITHUB_TOKEN_FILE = join(homedir(), ".agent/secrets/github.token");
const DEFAULT_BENCH_URL = "http://127.0.0.1:4477";
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
/** The release builds (`releaseBuilds`). Set when the server starts. */
let releases = null;
/** What there is to pick (`engineBuilds`). Set when the server starts. */
let listing = null;
/** The voice module's ref builds, and what there is to pick of them. Set when the server starts. */
let voices = null;
let voiceListing = null;
/** Where the connector's test bench listens. Set when the server starts. */
let bench = DEFAULT_BENCH_URL;
/** Whether a request may go through: every route needs it. Set when the server starts. */
let access = null;
/** The Web preview's routes (preview/index.mjs). Set when the server starts. */
let preview = null;

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
function describe({ label, version, sha256, entry, prefix, imports, sha, tag, verified }) {
  return { label, version, sha256, entry, prefix, imports, sha, tag, verified };
}

/** The builds served: engines of git refs, by commit, and of releases, by tarball digest; voice builds, by commit. */
function served() {
  return [...refs.all(), ...releases.all(), ...voices.all()];
}

async function handle(req, res) {
  const verdict = access.check(req);
  if (verdict.redirect) {
    res.writeHead(303, { location: verdict.redirect, "set-cookie": verdict.cookie, "cache-control": "no-store" });
    return res.end();
  }
  if (!verdict.ok) return send(res, 401, "unauthorized: open the playground with the link you were given");
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/connector") {
    res.writeHead(308, { location: "/connector/" });
    return res.end();
  }
  if (url.pathname.startsWith("/connector/")) return proxyBench(req, res, bench, url);
  if (url.pathname.startsWith("/preview/") && preview) {
    try {
      const answer = await preview.route(req, url);
      if (answer !== undefined) return sendJson(res, answer);
    } catch (error) {
      if (error instanceof RefError) return send(res, error.status, error.message);
      throw error;
    }
  }
  if (url.pathname === "/local-engine.json") {
    if (!local) return send(res, 404, "no local engine build: start the server with --engine-tarball");
    return sendJson(res, describe(local));
  }
  if (url.pathname === "/engine-builds") {
    return sendJson(res, await listing.get({ fresh: url.searchParams.has("fresh") }));
  }
  if (url.pathname === "/voice-builds") {
    return sendJson(res, await voiceListing.get({ fresh: url.searchParams.has("fresh") }));
  }
  if (url.pathname === "/ref-build" || url.pathname === "/release-build") {
    try {
      const build = url.pathname === "/ref-build"
        ? await refs.get(url.searchParams.get("ref"))
        : await releases.get(url.searchParams.get("name"));
      return sendJson(res, describe(build));
    } catch (error) {
      if (error instanceof RefError) return send(res, error.status, error.message);
      throw error;
    }
  }
  if (url.pathname === "/voice-build") {
    try {
      const build = await voices.get(url.searchParams.get("ref"));
      return sendJson(res, describe(build));
    } catch (error) {
      if (error instanceof RefError) return send(res, error.status, error.message);
      throw error;
    }
  }
  if (local && url.pathname.startsWith(LOCAL_PREFIX)) {
    return serveFile(res, local.site + sep, decodeURIComponent(url.pathname.slice(LOCAL_PREFIX.length)));
  }
  if (url.pathname.startsWith(ENGINES_PREFIX)) {
    const [key, ...rest] = url.pathname.slice(ENGINES_PREFIX.length).split("/");
    const build = refs.installed(key) ?? releases.installed(key);
    if (!build) return send(res, 404, `no build ${key} is installed here: load it first`);
    return serveFile(res, build.site + sep, decodeURIComponent(rest.join("/")));
  }
  if (url.pathname.startsWith(VOICES_PREFIX)) {
    const [key, ...rest] = url.pathname.slice(VOICES_PREFIX.length).split("/");
    const build = voices.installed(key);
    if (!build) return send(res, 404, `no voice build ${key} is installed here: load it first`);
    return serveFile(res, build.site + sep, decodeURIComponent(rest.join("/")));
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(ROOT, "index.html"), "utf8");
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    return res.end(withImportMap(html, importMapFor(local, served())));
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
      "bench-url": { type: "string" },
      "engine-tarball": { type: "string" },
      "engine-label": { type: "string" },
      "engine-sha256": { type: "string" },
      "preview-port": { type: "string" },
      "preview-origin": { type: "string" },
      "cache-dir": { type: "string" },
    },
  });
  const token = await accessToken(values["access-file"] ?? DEFAULT_ACCESS_FILE);
  access = gate(token);
  const githubToken = await readToken(values["github-token-file"] ?? DEFAULT_GITHUB_TOKEN_FILE);
  if (!githubToken) console.log("no GitHub token: builds of git refs cannot be fetched (--github-token-file)");
  refs = refBuilds({ token: githubToken });
  releases = releaseBuilds({ api: githubToken ? githubApi({ token: githubToken }).api : publicApi() });
  listing = engineBuilds({ token: githubToken });
  voices = refBuilds({ token: githubToken, source: VOICE, prefix: VOICES_PREFIX, install: installVoice });
  voiceListing = engineBuilds({ token: githubToken, source: VOICE });
  bench = values["bench-url"] ?? DEFAULT_BENCH_URL;
  if (values["engine-tarball"]) {
    local = await installLocalEngine({
      tarball: values["engine-tarball"],
      label: values["engine-label"],
      sha256: values["engine-sha256"],
    });
    console.log(`local engine: ${local.label}, version ${local.version}, sha256 ${local.sha256}, in ${local.site}`);
  }
  const previewPort = Number(values["preview-port"] ?? PORT + 1);
  const previewAt = values["preview-origin"] ?? `http://localhost:${previewPort}`;
  preview = await previewSection({
    api: githubApi({ token: githubToken }).api,
    engineBuild: (ref) => (/^(v\d|nightly$|latest$)/.test(ref) ? releases.get(ref) : refs.get(ref)),
    voiceBuild: (ref) => voices.get(ref),
    cache: values["cache-dir"] ?? join(homedir(), ".cache/sidevoice-playground"),
    origin: previewAt,
    // The preview origin is behind the same gate, with a cookie of its own: the page, already let in, gets the link.
    link: `${previewAt}/?access=${encodeURIComponent(token)}`,
  });
  createServer((req, res) => handle(req, res).catch((e) => send(res, 500, String(e)))).listen(PORT, "127.0.0.1", () =>
    console.log(`sidevoice-playground on http://localhost:${PORT}`),
  );
  // The preview origin: the same access gate, its own cookie (another origin), the web and the core behind it.
  const origin = previewOrigin({ runs: preview.runs });
  const previewServer = createServer((req, res) => {
    const verdict = access.check(req);
    if (verdict.redirect) {
      res.writeHead(303, { location: verdict.redirect, "set-cookie": verdict.cookie, "cache-control": "no-store" });
      return res.end();
    }
    if (!verdict.ok) return send(res, 401, "unauthorized: open the preview with the link the playground gives");
    origin.handle(req, res).catch((e) => send(res, 500, String(e)));
  });
  previewServer.on("upgrade", (req, socket, head) => (access.check(req).ok ? origin.upgrade(req, socket, head) : socket.destroy()));
  previewServer.listen(previewPort, "127.0.0.1", () => console.log(`web preview on ${previewAt} (port ${previewPort})`));
}
