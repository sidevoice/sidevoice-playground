/** Serves the model recommender design sheet (preview/mock/recommender.html) alone, from the preview's own files
 * (`mockFile`) with the brand's typeface from a sidevoice-web tree, so no preview has to run and nothing is built.
 * It serves only static pages of example data: no access gate, no engine, no core. For a tunnel, expose its port.
 * Usage: node scripts/recommender-serve.mjs --web <sidevoice-web tree holding apps/web/public/fonts> [--port 5480]
 * `/` goes to `/recommender`; the files are read when asked, so an edit shows on reload.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { RECOMMENDER_PATH, mockFile } from "../preview/proxy.mjs";

const { values } = parseArgs({ options: { web: { type: "string" }, port: { type: "string", default: "5480" } } });
if (!values.web) throw new Error("usage: --web <sidevoice-web tree> [--port <n>]");
const fonts = join(resolve(values.web), "apps/web/public/fonts");

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://sheet");
  if (pathname === "/") { res.writeHead(302, { location: RECOMMENDER_PATH }); return res.end(); }
  const name = pathname.startsWith("/voice/fonts/") ? pathname.slice("/voice/fonts/".length) : null;
  const served = name !== null
    ? (/^[A-Za-z0-9._-]+\.woff2$/.test(name) ? { type: "font/woff2", body: await readFile(join(fonts, name)).catch(() => null) } : null)
    : pathname === RECOMMENDER_PATH || pathname.startsWith("/preview-mock/") ? await mockFile(pathname) : null;
  if (!served?.body) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("not found"); }
  res.writeHead(200, { "content-type": served.type, "cache-control": "no-store" });
  res.end(served.body);
});
server.listen(Number(values.port), "0.0.0.0", () => console.log(`model recommender sheet on http://localhost:${values.port}${RECOMMENDER_PATH}`));
