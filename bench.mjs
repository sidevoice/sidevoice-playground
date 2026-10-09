// The connector's test bench (`cargo xtask bench` in sidevoice-connector) under /connector/: a reverse proxy, so the
// bench's page and its logic stay in the connector, in one copy, and reach a browser through this server's access gate
// and tunnel like the rest of the playground.
//
// The bench answers only requests that name its own host (a site of another name cannot reach it), so the proxy names
// it. The playground's own cookie (its access gate's) does not go to the bench. The bench's page names its API relative
// to itself (sidevoice-connector#92), so it works under the prefix.

import { request } from "node:http";

export const BENCH_PREFIX = "/connector";

/** Request headers that stay here: the hop's own, and this server's credential. */
const DROPPED = new Set(["host", "cookie", "connection", "keep-alive", "upgrade", "proxy-connection", "transfer-encoding"]);

/** What a page reads when the bench is not running. */
export const NOT_RUNNING =
  "The connector's test bench is not running. Start it in a sidevoice-connector checkout with `cargo xtask bench` " +
  "(it listens on 127.0.0.1:4477), or point this server at it with --bench-url.\n";

/** The bench's path for `url`, a request under BENCH_PREFIX: `/connector/api/state?since=3` → `/api/state?since=3`. */
export function benchPath(url) {
  return url.pathname.slice(BENCH_PREFIX.length) + url.search;
}

/** Forwards `req` (its `url` parsed) to the bench at `benchUrl` and answers `res` with what the bench answers. */
export function proxyBench(req, res, benchUrl, url) {
  const target = new URL(benchUrl);
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !DROPPED.has(name)));
  headers.host = target.host;
  const upstream = request(
    { hostname: target.hostname, port: target.port, method: req.method, path: benchPath(url), headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(NOT_RUNNING);
  });
  req.pipe(upstream);
}
