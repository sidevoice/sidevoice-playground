import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventEmitter } from "node:events";
import { parseWorktrees, startDevServer } from "../preview/dev.mjs";
import { mockFile, previewOrigin } from "../preview/proxy.mjs";
import { validStart } from "../preview/index.mjs";

test("worktrees as git lists them: path, branch, head", () => {
  const listed = parseWorktrees("worktree /w/main\nHEAD aaa\nbranch refs/heads/main\n\nworktree /w/onboarding\nHEAD bbb\nbranch refs/heads/feat/onboarding\n\nworktree /w/detached\nHEAD ccc\ndetached\n");
  assert.deepEqual(listed, [
    { path: "/w/main", branch: "main", head: "aaa" },
    { path: "/w/onboarding", branch: "feat/onboarding", head: "bbb" },
    { path: "/w/detached", branch: null, head: "ccc" },
  ]);
});

test("a dev start names an absolute worktree", () => {
  assert.deepEqual(validStart({ mode: "dev", worktree: "/w/onboarding" }, []), { mode: "dev", worktree: "/w/onboarding" });
  assert.throws(() => validStart({ mode: "dev", worktree: "relative" }, []), /worktree/);
  assert.throws(() => validStart({ mode: "dev" }, []), /worktree/);
});

test("a worktree without its dependencies is refused, not installed into", async () => {
  let spawned = false;
  await assert.rejects(startDevServer({ path: "/w/x", ready: false }, { spawnProcess: () => (spawned = true) }), /npm ci/);
  assert.equal(spawned, false);
});

test("the dev server is started in the worktree's app, on its own port, until it answers", async () => {
  const calls = [];
  const child = Object.assign(new EventEmitter(), { exitCode: null, pid: 999_999, stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  let asked = 0;
  const server = await startDevServer({ path: "/w/onboarding", ready: true }, {
    spawnProcess: (command, args, options) => (calls.push({ command, args, cwd: options.cwd, detached: options.detached }), child),
    fetch: async () => ({ status: ++asked < 3 ? 502 : 200 }),
    wait: async () => {},
  });
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].args.slice(0, 4), ["run", "dev", "--", "--port"]);
  assert.equal(calls[0].args.at(-1), "--strictPort");
  assert.equal(calls[0].cwd, "/w/onboarding/apps/web");
  assert.equal(calls[0].detached, true);
  assert.equal(server.port, Number(calls[0].args[4]));
  assert.equal(asked, 3);
});

test("a dev run serves the mocks' target.js at the path the dev server writes it under", async () => {
  assert.match(String((await mockFile("/voice/voice/target.js")).body), /__sidevoicePreview/);
});

test("a dev run passes requests to its dev server, and serves the web's packages as the mocks'", async () => {
  const upstream = createServer((req, res) => {
    if (req.url.includes("sidevoice_engine")) {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end("const a=1;\nexport { a as WebEngine, a as default };");
    }
    if (req.url.includes("sidevoice-other")) {
      res.writeHead(200, { "content-type": "text/javascript" });
      return res.end("export { b as helper };");
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`dev ${req.url}`);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const run = { mode: "dev", port: upstream.address().port };
  const origin = previewOrigin({ runs: { current: run, resetDone() {} } });
  const front = createServer((req, res) => origin.handle(req, res));
  await new Promise((r) => front.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${front.address().port}`;
  try {
    assert.equal(await (await fetch(`${base}/voice/src/main.tsx`)).text(), "dev /voice/src/main.tsx");
    const engine = await (await fetch(`${base}/voice/node_modules/.vite/deps/@sidevoice_engine.js?v=1`)).text();
    assert.match(engine, /module\("engine"\)/);
    assert.match(engine, /export const WebEngine/);
    assert.equal(await (await fetch(`${base}/voice/sidevoice-other.js`)).text(), "export { b as helper };");
    assert.match(await (await fetch(`${base}/`)).text(), /preview-mock\/shell\.mjs/, "the shell, not the dev server's root");
    assert.equal((await fetch(`${base}/api/presentation`)).status, 404, "the page's mocks answer the core's routes");
  } finally {
    front.close();
    upstream.close();
  }
});
