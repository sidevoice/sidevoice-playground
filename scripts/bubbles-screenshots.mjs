/** Capture the open bubbles question from an isolated mocked Web preview.
 * Usage: node scripts/bubbles-screenshots.mjs --url http://127.0.0.1:5291 --access-file /tmp/preview-access
 *   --web /absolute/path/to/sidevoice-web-worktree --out /workspace/sidevoice/share/bubbles-variants
 * Start that playground instance in dev mode with the web worktree before running this script.
 */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function args() {
  const flags = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith("--")) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, []));
  for (const key of ["url", "access-file", "web", "out"]) if (!flags[key]) throw Error(`Missing --${key}`);
  return flags;
}
const flags = args();
const requireWeb = createRequire(join(resolve(flags.web), "package.json"));
const { chromium } = requireWeb("@playwright/test");
const token = (await readFile(flags["access-file"], "utf8")).trim();
const origin = flags.url.replace(/\/$/, "");
const out = resolve(flags.out);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const motion = flags["reduced-motion"] ? "reduce" : "no-preference";
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: motion });
const manifest = { generatedAt: new Date().toISOString(), source: {
  web: resolve(flags.web), playground: resolve("."),
  webRevision: flags["web-revision"] ?? "working-tree", playgroundRevision: flags["playground-revision"] ?? "working-tree",
},
  scenario: "room-ready", motion, variants: ["current", "soft", "illustrated", "panel"], captures: [], checks: [] };
const selected = (key, defaults) => flags[key] ? flags[key].split(",") : defaults;

async function capture(page, style, theme, view, state, target = "app") {
  const file = `${style}-${theme}-${view}-${state}.png`;
  await (target === "page" ? page : page.locator("#app")).screenshot({ path: join(out, file), animations: "disabled" });
  const size = await page.locator("#app").evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
  if (target === "app" && view === "browser" && (size.width !== 1280 || size.height !== 800))
    throw Error(`Desktop viewport ${size.width}×${size.height}, expected 1280×800`);
  manifest.captures.push({ file, style, theme, view, state, appViewport: size, target });
  console.log(file);
}
function contrast(first, second) {
  const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((channel) => value.startsWith("color(srgb ") ? channel * 255 : channel);
  const luminance = (value) => rgb(value).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const [a, b] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return Number(((a + .05) / (b + .05)).toFixed(2));
}
async function checkGraphic(frame, style, theme, view, selector, edge) {
  const colors = await frame.locator(selector).first().evaluate((node, border) => {
    const paint = getComputedStyle(node);
    return { ink: border === "left" ? paint.borderLeftColor : paint.borderRightColor, surface: paint.backgroundColor };
  }, edge);
  const ratio = contrast(colors.ink, colors.surface);
  manifest.checks.push({ style, theme, view, selector, edge, ...colors, ratio, minimum: 3 });
  if (ratio < 3) throw Error(`${style}/${theme}/${view} ${selector} edge: ${ratio}:1, needs 3:1`);
}
async function checkInk(frame, style, theme, view, selector, minimum) {
  let colors;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    colors = await frame.locator(selector).first().evaluate((node) => {
      if (!node.isConnected) return null;
      const style = getComputedStyle(node);
      let surface = style.backgroundColor;
      for (let parent = node.parentElement; parent && (surface === "rgba(0, 0, 0, 0)" || surface === "transparent"); parent = parent.parentElement) {
        surface = getComputedStyle(parent).backgroundColor;
      }
      return { ink: style.color, surface };
    }).catch(() => null);
    if (colors?.ink && colors?.surface) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!colors?.ink || !colors?.surface) throw Error(`${style}/${theme}/${view} ${selector}: no stable paint`);
  const ratio = contrast(colors.ink, colors.surface);
  manifest.checks.push({ style, theme, view, selector, ...colors, ratio, minimum });
  if (ratio < minimum) throw Error(`${style}/${theme}/${view} ${selector}: ${ratio}:1, needs ${minimum}:1`);
}
async function card(page, open) {
  const panel = page.locator("#card");
  if ((await panel.evaluate((node) => node.classList.contains("closed"))) === open) await panel.locator(".card-header").click();
}
async function variants(page, open) {
  const panel = page.locator("#variants");
  if ((await panel.evaluate((node) => node.classList.contains("closed"))) === open) await panel.locator(".card-header").click();
}
async function cardAction(page, name) {
  await card(page, true);
  await page.locator("#card button").filter({ hasText: name }).first().click();
  await card(page, false);
}
try {
  let first = true;
  for (const view of selected("views", ["browser", "phone"])) for (const theme of selected("themes", ["light", "dark"])) for (const style of selected("styles", manifest.variants)) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: view === "phone" ? 900 : 832 });
    page.on("pageerror", (error) => { if (!/WebSocket closed without opened/.test(error.message)) console.error(`Page error: ${error.message}`); });
    const url = `${origin}/?s=room-ready${view === "phone" ? "&view=phone" : ""}${first ? `&access=${encodeURIComponent(token)}` : ""}`;
    first = false;
    await page.goto(url);
    const frame = page.frameLocator("#app");
    await frame.locator(".call-layout[data-bubbles-variants]").waitFor();
    await frame.locator(view === "phone" ? ".header-avatar" : ".conversation-sidebar .person").first().waitFor();
    await frame.locator("html").evaluate((node, next) => { node.dataset.theme = next; }, theme);
    await frame.locator(view === "phone" ? ".header-avatar" : ".conversation-sidebar .person").first().click();
    await frame.locator(".stage-tile:not(.stage-empty) .stage-agent").waitFor();
    await frame.locator("html").evaluate(async () => { await document.fonts.ready; });
    await card(page, false);
    await variants(page, true);
    await page.locator(`#variants input[value="${style}"]`).check();
    await frame.locator(`.call-layout[data-bubbles-style="${style}"]`).waitFor();
    await page.waitForTimeout(150);
    if (view === "phone") {
      const size = await page.locator("#app").evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
      if (size.width !== 390 || size.height !== 844) throw Error(`Phone viewport ${size.width}×${size.height}, expected 390×844`);
    }
    await cardAction(page, "You speak → sent");
    await frame.locator(".person-bubble .voice-wave, .person-bubble .voice-bars").waitFor();
    await page.waitForTimeout(320);
    await capture(page, style, theme, view, "choice", "page");
    await variants(page, false);
    await capture(page, style, theme, view, "bars");
    await checkInk(frame, style, theme, view, ".person-bubble .voice-wave, .person-bubble .voice-bars", 3);
    await frame.locator(".person-bubble[data-sent]").waitFor({ timeout: 10_000 });
    await capture(page, style, theme, view, "person");
    await checkInk(frame, style, theme, view, ".person-bubble[data-sent] .person-said", 4.5);
    if (style === "illustrated") await checkGraphic(frame, style, theme, view, ".person-bubble[data-sent]", "right");
    if (style === "panel") await checkGraphic(frame, style, theme, view, ".person-bubble[data-sent]", "right");
    // The direct person sample gives the page a synthetic call. Leave it, then join Voice to bind the
    // selected conversation through the mock room before the agent's real speech path runs.
    const selectedBeforeJoin = await frame.locator("html").evaluate(() => window.sidevoiceUI?.store?.getState().session.selected);
    if (!selectedBeforeJoin && (await frame.locator("#connect").getAttribute("title"))?.includes("Leave")) await frame.locator("#connect").click();
    if ((await frame.locator("#connect").getAttribute("title"))?.includes("Join")) await frame.locator("#connect").click();
    await page.waitForFunction(() => {
      const state = document.querySelector("#app")?.contentWindow?.sidevoiceUI?.store?.getState();
      return !!state?.session.selected && state.session.selected === state.session.viewed;
    }, null, { timeout: 10_000 });
    await cardAction(page, "Agent speaks");
    await frame.locator(".stage-bubble[data-visible] .karaoke-played").waitFor();
    await page.waitForTimeout(550);
    await capture(page, style, theme, view, "agent");
    await checkInk(frame, style, theme, view, ".stage-bubble .karaoke-played", 4.5);
    if (style === "illustrated" || style === "panel") await checkGraphic(frame, style, theme, view, ".stage-bubble", "left");
    await frame.locator("#transcript-toggle:visible").first().click();
    await frame.locator(".transcript[data-open]").waitFor();
    await capture(page, style, theme, view, "transcript");
    await page.close();
  }
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await browser.close();
}
