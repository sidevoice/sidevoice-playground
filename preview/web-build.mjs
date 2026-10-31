// Web preview: sidevoice-web built by checkout, one commit at a time. A release, `main`, a branch or a pull request
// names a commit; its sources come out of a local mirror of the repository (`git archive`), and the web's own build
// makes its static site, exactly as a release does it: `npm ci` (or `npm install` with pins replaced, below),
// `npm run build`, then `node scripts/assemble-static-web.mjs <site>`. Only the site is kept, per commit, and at
// most KEPT of them: the oldest go first. The sources and node_modules go once the site is there.
//
// The mocked preview's modules (mock/) are checked against the web's own types once the web is built: they are
// copied into the checkout and its TypeScript checks them (mock/web-types.d.ts names what they answer with). What
// it says is kept beside the site (MOCK_CHECK), and a site is built again when the mocks change.
//
// Pins the registry does not have yet (`@sidevoice/voice`, `@sidevoice/engine` before their first release) are
// installed from the CI tarballs of the engine and voice builds the page picked, never invented: a web that pins one
// with none picked says which.

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { RefError } from "../refs.mjs";

export const WEB_REPO = "sidevoice/sidevoice-web";
/** How many built sites are kept. */
export const KEPT = 3;
/** The packages a web's pins may name that the page can supply as CI builds, by the build each one comes from. */
export const SUPPLIED = { "@sidevoice/engine": "engine", "@sidevoice/voice": "voice" };
/** The mocked preview's modules, and those of them checked against the web's types. */
export const MOCK_DIR = fileURLToPath(new URL("./mock/", import.meta.url));
export const MOCK_CHECKED = ["world.mjs", "machines.mjs", "bridge.mjs", "attach.mjs", "models.mjs", "microphone.mjs", "voice.mjs", "web-types.d.ts"];
/** Where a site keeps what checking the mocks against its web said: `{ ok, errors }`. */
export const MOCK_CHECK = ".preview-mock-check.json";
const MOCK_TSCONFIG = {
  compilerOptions: {
    // Only the mocks that ask for it (`// @ts-check`) are checked: the web's own modules they import are the web's.
    allowJs: true, checkJs: false, noEmit: true, strict: false, skipLibCheck: true, types: [],
    baseUrl: ".", paths: { "@sidevoice/*": ["../node_modules/@sidevoice/*", "../apps/web/node_modules/@sidevoice/*"] },
    target: "ES2022", module: "ESNext", moduleResolution: "bundler", allowImportingTsExtensions: true,
    lib: ["ES2022", "DOM", "DOM.Iterable"],
  },
  include: ["*.mjs", "*.d.ts"],
};

/** A short digest of the checked mock modules: a site is built again when they change. */
export async function mockDigest() {
  const hash = createHash("sha256");
  for (const name of MOCK_CHECKED) hash.update(name).update(await readFile(join(MOCK_DIR, name)));
  return hash.digest("hex").slice(0, 12);
}

/** What a web's `apps/web/package.json` pins of ours, other than its own workspace packages. */
export function ourPins(manifest, workspaces = []) {
  return Object.entries(manifest.dependencies ?? {}).filter(
    ([name]) => name.startsWith("@sidevoice/") && !workspaces.includes(name),
  );
}

/**
 * The pins to replace by a CI tarball: those the registry does not have at their version. `published(name, version)`
 * says whether it does; `tarballs` is `{ engine?, voice? }`, the picked builds' tarball paths.
 * @returns {{ replace: Record<string, string>, missing: string[] }}
 */
export async function plannedPins(pins, published, tarballs) {
  const replace = {};
  const missing = [];
  for (const [name, version] of pins) {
    if (!(name === "@sidevoice/voice" && tarballs.forceVoice) && await published(name, version)) continue;
    const tarball = tarballs[SUPPLIED[name]];
    if (tarball) replace[name] = `file:${tarball}`;
    else missing.push(`${name}@${version}`);
  }
  return { replace, missing };
}

/** Whether npm's registry has `name` at exactly `version`. */
async function onRegistry(name, version) {
  try {
    const { stdout } = await promisify(execFile)("npm", ["view", `${name}@${version}`, "version", "--json"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Runs `command` in `cwd`, its output going to `log` line by line; rejects with the end of it when it fails. */
export function runner(log) {
  return (command, args, { cwd, env, stdin } = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: [stdin ? "pipe" : "ignore", "pipe", "pipe"] });
      const tail = [];
      const take = (chunk) => {
        for (const line of String(chunk).split("\n").filter(Boolean)) {
          log(line);
          tail.push(line);
          if (tail.length > 20) tail.shift();
        }
      };
      child.stdout.on("data", take);
      child.stderr.on("data", take);
      if (stdin) stdin.pipe(child.stdin);
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve() : reject(new RefError(502, `${command} ${args.join(" ")} failed (${code}): ${tail.slice(-5).join(" | ")}`)),
      );
    });
}

/**
 * The web builds of this server. `cache` is where the mirror, the work and the sites live; `api` GitHub's (refs.mjs);
 * `run`, `published` and `log` are replaceable for tests.
 */
export function webBuilds({ cache, api, run = null, published = onRegistry, log = () => {} }) {
  const exec = run ?? runner((line) => log(line));
  const mirror = join(cache, "web.git");
  const sites = join(cache, "web-sites");
  const pending = new Map();

  /** The commit `ref` names now: a tag, a branch, a commit, or `pull/<n>/head`. */
  async function resolve(ref) {
    const pr = ref.match(/^pull\/(\d+)\/head$/);
    if (pr) {
      const pull = await api(`/repos/${WEB_REPO}/pulls/${pr[1]}`);
      if (!pull) throw new RefError(404, `${WEB_REPO} has no pull request #${pr[1]}`);
      return pull.head.sha;
    }
    const commit = await api(`/repos/${WEB_REPO}/commits/${encodeURIComponent(ref)}`);
    if (!commit) throw new RefError(404, `${WEB_REPO} has no tag, branch or commit ${ref}`);
    return commit.sha;
  }

  async function exists(path) {
    return stat(path).then(() => true, () => false);
  }

  /** Every kept site but the KEPT - 1 newest goes, so a new one fits. */
  async function evict() {
    const names = await readdir(sites).catch(() => []);
    const dated = await Promise.all(names.map(async (name) => ({ name, at: (await stat(join(sites, name))).mtimeMs })));
    for (const { name } of dated.sort((a, b) => b.at - a.at).slice(KEPT - 1)) await rm(join(sites, name), { recursive: true, force: true });
  }

  async function build(sha, key, tarballs) {
    const site = join(sites, key);
    if (await exists(join(site, "voice/index.html"))) return site;
    await mkdir(sites, { recursive: true });
    if (!(await exists(mirror))) await exec("git", ["clone", "--bare", "--filter=blob:none", `https://github.com/${WEB_REPO}.git`, mirror]);
    await exec("git", ["-C", mirror, "fetch", "--filter=blob:none", "origin", sha]);
    const work = join(cache, `web-work-${key}`);
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    try {
      const archive = spawn("git", ["-C", mirror, "archive", sha], { stdio: ["ignore", "pipe", "inherit"] });
      await exec("tar", ["-x", "-C", work], { stdin: archive.stdout });
      const manifestPath = join(work, "apps/web/package.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const root = JSON.parse(await readFile(join(work, "package.json"), "utf8"));
      const workspaces = await workspaceNames(work, root.workspaces ?? []);
      const { replace, missing } = await plannedPins(ourPins(manifest, workspaces), published, tarballs);
      if (missing.length) {
        throw new RefError(409, `web ${sha.slice(0, 7)} pins ${missing.join(", ")}, which npm does not have: pick the build to use for it`);
      }
      if (Object.keys(replace).length) {
        Object.assign(manifest.dependencies, replace);
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        await exec("npm", ["install", "--no-audit", "--no-fund"], { cwd: work });
      } else {
        await exec("npm", ["ci", "--no-audit", "--no-fund"], { cwd: work });
      }
      await exec("npm", ["run", "build"], { cwd: work });
      const mocks = await checkMocks(work);
      await evict();
      await exec("node", ["scripts/assemble-static-web.mjs", site], { cwd: work });
      await writeFile(join(site, MOCK_CHECK), JSON.stringify(mocks));
      return site;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  /** The web's TypeScript on the mock modules, in the checkout: `{ ok, errors }`. */
  async function checkMocks(work) {
    const dir = join(work, ".preview-mock");
    await mkdir(dir, { recursive: true });
    for (const name of MOCK_CHECKED) await copyFile(join(MOCK_DIR, name), join(dir, name));
    await writeFile(join(dir, "tsconfig.json"), JSON.stringify(MOCK_TSCONFIG, null, 2));
    const tsc = (await exists(join(work, "node_modules/typescript/bin/tsc")))
      ? "node_modules/typescript/bin/tsc" : "apps/web/node_modules/typescript/bin/tsc";
    log("Checking the mocks against this web's types…");
    try {
      await exec("node", [tsc, "-p", ".preview-mock/tsconfig.json"], { cwd: work });
      return { ok: true, errors: "" };
    } catch (error) {
      return { ok: false, errors: error.message };
    }
  }

  return {
    resolve,
    /**
     * The site of the web at `ref`, built the first time its commit (with these tarballs) is asked for.
     * `tarballs` is `{ engine?, voice? }`: paths of the picked CI builds, for pins npm does not have.
     */
    async get(ref, tarballs = {}) {
      const sha = await resolve(ref);
      // CI downloads use new temporary paths on each server start. Cache by their
      // actual bytes so the same pinned candidate keeps its built site.
      const digest = async (path) => path ? createHash("sha256").update(await readFile(path)).digest("hex") : null;
      const picked = [await digest(tarballs.engine), await digest(tarballs.voice), Boolean(tarballs.forceVoice)];
      const key = `${picked.some(Boolean) ? `${sha}-${shortHash(JSON.stringify(picked))}` : sha}-m${await mockDigest()}`;
      if (!pending.has(key)) {
        const promise = build(sha, key, tarballs);
        pending.set(key, promise);
        promise.catch(() => pending.delete(key));
      }
      const site = await pending.get(key);
      const mocks = JSON.parse(await readFile(join(site, MOCK_CHECK), "utf8").catch(() => '{"ok":false,"errors":"not checked"}'));
      return { sha, site, mocks };
    },
  };
}

/** The package names of a root's npm workspaces (`apps/web`, `packages/*`), from their manifests. */
async function workspaceNames(root, patterns) {
  const names = [];
  for (const pattern of patterns) {
    const dirs = pattern.endsWith("/*")
      ? (await readdir(join(root, pattern.slice(0, -2))).catch(() => [])).map((name) => join(pattern.slice(0, -2), name))
      : [pattern];
    for (const dir of dirs) {
      const manifest = await readFile(join(root, dir, "package.json"), "utf8").catch(() => null);
      if (manifest) names.push(JSON.parse(manifest).name);
    }
  }
  return names;
}

function shortHash(text) {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}
