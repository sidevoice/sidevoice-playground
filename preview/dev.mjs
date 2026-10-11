// Web preview, dev mode: a sidevoice-web worktree of this machine served live by its own Vite dev server (`npm run
// dev`), behind the preview origin, with the mocked preview's shell, card and mocks around it. An edit to the
// worktree reaches the browser by Vite's hot reload, whose socket the origin passes on: nothing is built or
// restarted per edit. The worktrees offered are those of one sidevoice-web checkout (`--dev-repo`), each with its
// dependencies installed (`npm ci` in it); this never installs anything in somebody's worktree.

import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { RefError } from "../refs.mjs";

/** How long a dev server gets to answer its first page. */
export const DEV_READY_MS = 90_000;

/** The worktrees of `repo` (`git worktree list --porcelain`): `{ path, branch, head }`, branch null when detached. */
export function parseWorktrees(porcelain) {
  return porcelain.split("\n\n").map((block) => {
    const field = (name) => block.split("\n").find((line) => line.startsWith(`${name} `))?.slice(name.length + 1) ?? null;
    return { path: field("worktree"), branch: field("branch")?.replace(/^refs\/heads\//, "") ?? null, head: field("HEAD") };
  }).filter((w) => w.path);
}

const exists = (path) => stat(path).then(() => true, () => false);

/** The worktrees of the sidevoice-web checkout at `repo` that have a web app: `{ path, branch, head, ready }`;
 *  `ready` says whether its dependencies are installed. */
export async function listWorktrees(repo) {
  let porcelain = "";
  try {
    porcelain = (await promisify(execFile)("git", ["-C", repo, "worktree", "list", "--porcelain"])).stdout;
  } catch {
    return [];
  }
  const found = [];
  for (const worktree of parseWorktrees(porcelain)) {
    if (!(await exists(join(worktree.path, "apps/web/vite.config.ts")))) continue;
    const ready = (await exists(join(worktree.path, "node_modules/vite"))) || (await exists(join(worktree.path, "apps/web/node_modules/vite")));
    found.push({ ...worktree, ready });
  }
  return found;
}

/** A port nobody listens on, for the dev server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the web's dev server in `worktree` (one of `listWorktrees`): `{ port, stop() }` once it answers. Its output
 * goes to `log`. `spawnProcess` and `fetch` are replaceable for tests.
 */
export async function startDevServer(worktree, { log = () => {}, spawnProcess = spawn, fetch = globalThis.fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!worktree.ready) throw new RefError(409, `${worktree.path} has no dependencies installed: run npm ci in it first`);
  const port = await freePort();
  // Its own process group, so stopping it stops what it started (esbuild).
  const child = spawnProcess("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
    cwd: join(worktree.path, "apps/web"), detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BROWSER: "none" },
  });
  const take = (chunk) => String(chunk).split("\n").filter(Boolean).forEach((line) => log(line));
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  /** Kills its process group now, synchronously: what the server does as it exits. */
  const kill = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  };
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", resolve);
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  });
  for (let waited = 0; waited < DEV_READY_MS; waited += 500) {
    if (child.exitCode !== null) throw new RefError(502, `the dev server in ${worktree.path} exited (${child.exitCode}) before it answered`);
    const answered = await fetch(`http://127.0.0.1:${port}/voice/`).then((r) => r.status < 500, () => false);
    if (answered) return { port, stop, kill };
    await wait(500);
  }
  await stop();
  throw new RefError(504, `the dev server in ${worktree.path} did not answer within ${DEV_READY_MS / 1000} s`);
}
