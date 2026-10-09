import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { benchPath, NOT_RUNNING, proxyBench } from "../bench.mjs";

/** A server on a free port; resolves to its URL. */
function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

/** A playground that forwards everything to the bench at `benchUrl`. */
const playground = (benchUrl) => listen((req, res) => proxyBench(req, res, benchUrl, new URL(req.url, "http://playground")));

test("a path under /connector is the bench's path, query included", () => {
  assert.equal(benchPath(new URL("http://p/connector/api/state?since=3")), "/api/state?since=3");
  assert.equal(benchPath(new URL("http://p/connector/")), "/");
});

test("the bench gets its own host, the body and no playground cookie; the page gets the bench's answer", async () => {
  let seen;
  const bench = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen = { method: req.method, url: req.url, headers: req.headers, body };
      res.writeHead(200, { "content-type": "application/json", "x-frame-options": "DENY" });
      res.end('{"ok":true}');
    });
  });
  const proxy = await playground(bench.url);
  try {
    const res = await fetch(`${proxy.url}/connector/api/say`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sidevoice-playground=secret" },
      body: '{"thread":"t","text":"hi"}',
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(seen.method, "POST");
    assert.equal(seen.url, "/api/say");
    assert.equal(seen.headers.host, new URL(bench.url).host);
    assert.equal(seen.headers.cookie, undefined);
    assert.equal(seen.headers["content-type"], "application/json");
    assert.equal(seen.body, '{"thread":"t","text":"hi"}');
  } finally {
    proxy.server.close();
    bench.server.close();
  }
});

test("when the bench is not running, the page is told how to start it", async () => {
  const gone = await listen(() => {});
  const url = gone.url;
  await new Promise((resolve) => gone.server.close(resolve));
  const proxy = await playground(url);
  try {
    const res = await fetch(`${proxy.url}/connector/api/state`);
    assert.equal(res.status, 502);
    assert.equal(await res.text(), NOT_RUNNING);
  } finally {
    proxy.server.close();
  }
});
