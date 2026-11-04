/** Captures the duck-level design sheet (preview/mock/duck-level.html): each option in light and dark, the row in its
 * other modes, a phone's width, and the three options together.
 * Usage: node scripts/duck-level-screenshots.mjs --web <sidevoice-web tree with node_modules> --out <dir> [--port 5471]
 * The sheet is served here from the preview's own files (`mockFile`), with the brand's typeface from the web tree, so
 * no preview has to run: only a browser for Playwright (the web tree's `@playwright/test`).
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { mockFile } from "../preview/proxy.mjs";

const { values } = parseArgs({ options: { web: { type: "string" }, out: { type: "string" }, port: { type: "string", default: "5471" } } });
if (!values.web || !values.out) throw new Error("usage: --web <sidevoice-web tree> --out <dir> [--port <n>]");
const web = resolve(values.web), out = resolve(values.out);
const { chromium } = createRequire(join(web, "package.json"))("@playwright/test");
await mkdir(out, { recursive: true });

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://sheet");
  const font = pathname.startsWith("/voice/fonts/") ? join(web, "apps/web/public/fonts", pathname.slice("/voice/fonts/".length)) : null;
  const served = font ? { type: "font/woff2", body: await readFile(font).catch(() => null) } : await mockFile(pathname);
  if (!served?.body) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": served.type, "cache-control": "no-store" });
  res.end(served.body);
});
await new Promise((done) => server.listen(Number(values.port), "127.0.0.1", done));
const base = `http://127.0.0.1:${values.port}/duck-level`;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const OPTIONS = ["presets", "slider", "windows"], LETTER = { presets: "a", slider: "b", windows: "c" };
async function shoot(file, query, selector, viewport = { width: 1000, height: 900 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${base}?${query}`);
  await page.evaluate(() => document.fonts.ready);
  await page.locator(selector).first().waitFor();
  await page.locator(selector).first().screenshot({ path: join(out, file), animations: "disabled" });
  console.log(file);
  await context.close();
}
try {
  for (const id of OPTIONS) {
    for (const theme of ["light", "dark"]) {
      await shoot(`${LETTER[id]}-${id}-${theme}.png`, `v=${id}&theme=${theme}`, ".sheet-window");
      await shoot(`${LETTER[id]}-${id}-${theme}-phone.png`, `v=${id}&theme=${theme}&width=390`, ".sheet-window", { width: 430, height: 900 });
    }
  }
  for (const theme of ["light", "dark"]) {
    await shoot(`pause-${theme}.png`, `v=presets&theme=${theme}&mode=pause`, ".sheet-window");
    await shoot(`all-${theme}.png`, `v=all&theme=${theme}`, "#sheet", { width: 1000, height: 900 });
  }
  await shoot("sheet-both-themes.png", "v=presets", "#sheet", { width: 1560, height: 900 });
} finally {
  await browser.close();
  server.close();
}
