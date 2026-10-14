/** Capture the call's bubbles (the soft cards, decided 2026-10-14) from a mocked Web preview in dev mode.
 * Usage: node scripts/bubbles-screenshots.mjs --url http://127.0.0.1:5291 --access-file /tmp/preview-access
 *   --web /absolute/path/to/sidevoice-web-worktree --out /workspace/sidevoice/share/bubbles-soft-final
 *   [--views browser,phone,phone320] [--themes light,dark] [--reduced-motion 1]
 * Start that playground's preview in dev mode with the web worktree before running this script. Each view and theme
 * gets: the bars, a short and a long sent turn (the long one past its first page), a short and a long reply held mid
 * voice (the long one past its first page), and the transcript; a manifest records sizes and contrast checks.
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
}, scenario: "room-ready", motion, sampling: { barsElapsedMs: 320, agentHeardCharacters: 57, longAgentHeardCharacters: 330 },
captures: [], checks: [] };
const selected = (key, defaults) => flags[key] ? flags[key].split(",") : defaults;
/** The app's viewport in each view: the desktop's, the phone frame's, and the narrowest phone (the frame squeezed). */
const VIEWPORTS = { browser: { width: 1280, height: 800 }, phone: { width: 390, height: 844 }, phone320: { width: 320, height: 844 } };

async function capture(page, theme, view, state) {
  const file = `${theme}-${view}-${state}.png`;
  await page.locator("#app").screenshot({ path: join(out, file), animations: "disabled" });
  const size = await page.locator("#app").evaluate((node) => ({ width: node.clientWidth, height: node.clientHeight }));
  const expected = VIEWPORTS[view];
  if (size.width !== expected.width || size.height !== expected.height)
    throw Error(`${view} viewport ${size.width}×${size.height}, expected ${expected.width}×${expected.height}`);
  manifest.captures.push({ file, theme, view, state, appViewport: size });
  console.log(file);
}
function contrast(first, second) {
  const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((channel) => value.startsWith("color(srgb ") ? channel * 255 : channel);
  const luminance = (value) => rgb(value).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const [a, b] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return Number(((a + .05) / (b + .05)).toFixed(2));
}
async function checkInk(frame, theme, view, selector, minimum) {
  let colors;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    colors = await frame.locator(selector).first().evaluate((node) => {
      if (!node.isConnected) return null;
      const style = getComputedStyle(node);
      let surface = style.backgroundColor;
      for (let parent = node.parentElement; parent && (surface === "rgba(0, 0, 0, 0)" || surface === "transparent"); parent = parent.parentElement) {
        surface = getComputedStyle(parent).backgroundColor;
      }
      return { ink: style.color, surface, size: style.fontSize, weight: style.fontWeight, family: style.fontFamily.split(",")[0] };
    }).catch(() => null);
    if (colors?.ink && colors?.surface) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  if (!colors?.ink || !colors?.surface) throw Error(`${theme}/${view} ${selector}: no stable paint`);
  const ratio = contrast(colors.ink, colors.surface);
  manifest.checks.push({ theme, view, selector, ...colors, ratio, minimum });
  if (ratio < minimum) throw Error(`${theme}/${view} ${selector}: ${ratio}:1, needs ${minimum}:1`);
}
async function checkTranscribing(frame, theme, view) {
  const colors = await frame.locator(".person-bubble [data-phase='transcribing']").evaluate((node) => {
    const mark = node.querySelector("canvas, i");
    const animation = mark.getAnimations()[0];
    if (animation) { animation.currentTime = 950; animation.pause(); }
    return { ink: getComputedStyle(mark).color, surface: getComputedStyle(node).backgroundColor,
      opacity: Number(getComputedStyle(mark).opacity), element: mark.localName };
  });
  const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    .map((v) => value.startsWith("color(srgb ") ? v * 255 : v);
  const ink = rgb(colors.ink), surface = rgb(colors.surface);
  const painted = ink.map((v, i) => v * colors.opacity + surface[i] * (1 - colors.opacity));
  const asRgb = (v) => `rgb(${v.join(", ")})`;
  const ratio = contrast(asRgb(painted), asRgb(surface));
  manifest.checks.push({ theme, view, selector: "transcribing painted bars", ...colors, ratio, minimum: 3 });
  if (ratio < 3) throw Error(`${theme}/${view} transcribing ${colors.element}: ${ratio}:1, needs 3:1`);
}
/** No line of the bubble's text box spills past the bubble, and the page is on screen. */
async function checkFits(frame, theme, view, selector) {
  const box = await frame.locator(selector).first().evaluate((node) => {
    const bubble = node.getBoundingClientRect();
    return { left: bubble.left, right: bubble.right, page: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth };
  });
  manifest.checks.push({ theme, view, selector: `${selector} fits`, ...box });
  if (box.left < 0 || box.right > box.page || box.scroll > box.page) throw Error(`${theme}/${view} ${selector} overflows: ${JSON.stringify(box)}`);
}
async function card(page, open) {
  const panel = page.locator("#card");
  if ((await panel.evaluate((node) => node.classList.contains("closed"))) === open) await panel.locator(".card-header").click();
}
async function cardAction(page, name) {
  await card(page, true);
  await page.locator("#card button").filter({ hasText: name }).first().click();
  await card(page, false);
}
async function pickSample(page, label, longest) {
  await card(page, true);
  const select = page.locator("#card label").filter({ hasText: label }).locator("select");
  const values = await select.locator("option").evaluateAll((options) => options.map((option) => option.value));
  await select.selectOption(longest ? values.reduce((a, b) => b.length > a.length ? b : a) : values[0]);
  await card(page, false);
}
/** Wait until the bubble's pages have turned at least once: the earlier text fades above. */
async function pastFirstPage(page, selector) {
  await page.waitForFunction((selector) => {
    const run = document.querySelector("#app")?.contentDocument?.querySelector(`${selector} .paged-text-run`);
    return !!run && /translateY\(-[1-9]/.test(run.style.transform);
  }, selector, { timeout: 15_000 });
  await page.waitForTimeout(700); // the page's own turn, 600ms
}
async function holdAgent(frame, heard) {
  const held = await frame.locator("html").evaluate((node, heard) => {
    const store = window.sidevoiceUI?.store;
    const state = store?.getState().facts.karaokeState;
    if (!state?.segment) return false;
    store.patch({ karaokeState: { ...state, from: 0, to: heard } });
    return true;
  }, heard);
  if (!held) throw Error("The agent's speech position could not be held");
}

try {
  // Restore the same mocked identities and world for every capture.
  const seed = await context.newPage();
  await seed.goto(`${origin}/?s=room-ready&access=${encodeURIComponent(token)}`);
  await seed.frameLocator("#app").locator(".call-layout").waitFor();
  const seedSnapshot = await seed.evaluate(() => JSON.parse(sessionStorage.getItem("sidevoice-preview.snapshot")));
  if (!seedSnapshot?.identities) throw Error("Preview did not save a reusable room snapshot");
  await seed.close();
  for (const view of selected("views", ["browser", "phone", "phone320"])) for (const theme of selected("themes", ["light", "dark"])) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: view === "browser" ? 832 : 900 });
    await page.addInitScript((snapshot) => {
      if (window !== window.top) return;
      snapshot.search = location.search;
      sessionStorage.setItem("sidevoice-preview.snapshot", JSON.stringify(snapshot));
    }, seedSnapshot);
    page.on("pageerror", (error) => { if (!/WebSocket closed without opened/.test(error.message)) console.error(`Page error: ${error.message}`); });
    await page.goto(`${origin}/?s=room-ready${view === "browser" ? "" : "&view=phone"}`);
    if (view === "phone320") await page.locator("#app").evaluate((node) => { node.style.width = "320px"; });
    const frame = page.frameLocator("#app");
    const narrow = view !== "browser";
    await frame.locator(".call-layout").waitFor();
    await frame.locator(narrow ? ".header-avatar" : ".conversation-sidebar .person").first().waitFor();
    await frame.locator("html").evaluate((node, next) => { node.dataset.theme = next; }, theme);
    await frame.locator(narrow ? ".header-avatar" : ".conversation-sidebar .person").first().click();
    await frame.locator(".stage-tile:not(.stage-empty) .stage-agent").waitFor();
    await frame.locator("html").evaluate(async () => { await document.fonts.ready; });
    await card(page, false);
    // Hold the mock's time so each capture shows the same point in the listening sample.
    await page.clock.pauseAt(new Date());
    await pickSample(page, "You say", false);
    await cardAction(page, "You speak → sent");
    await frame.locator(".person-bubble .voice-wave, .person-bubble .voice-bars").waitFor();
    await page.clock.runFor(320);
    await capture(page, theme, view, "bars");
    await checkInk(frame, theme, view, ".person-bubble .voice-wave, .person-bubble .voice-bars", 3);
    await checkInk(frame, theme, view, ".person-bubble .cancel-input", 4.5);
    await page.clock.resume();
    await frame.locator(".person-bubble [data-phase='transcribing']").waitFor({ timeout: 10_000 });
    await checkTranscribing(frame, theme, view);
    await frame.locator(".person-bubble[data-sent]").waitFor({ timeout: 10_000 });
    await capture(page, theme, view, "person");
    await checkInk(frame, theme, view, ".person-bubble[data-sent] .person-said", 4.5);
    await checkFits(frame, theme, view, ".person-bubble[data-sent]");
    // The long dictated turn, a page on: what was said before fades above the page showing.
    await frame.locator(".person-bubble[data-sent]").waitFor({ state: "detached", timeout: 15_000 });
    await pickSample(page, "You say", true);
    await cardAction(page, "You speak → sent");
    await frame.locator(".person-bubble[data-sent]").waitFor({ timeout: 15_000 });
    await pastFirstPage(page, ".person-bubble[data-sent]");
    await capture(page, theme, view, "person-long");
    await checkFits(frame, theme, view, ".person-bubble[data-sent]");
    await frame.locator(".person-bubble[data-sent]").waitFor({ state: "detached", timeout: 60_000 });
    // The direct person sample gives the page a synthetic call. Leave it, then join Voice to bind the
    // selected conversation through the mock room before the agent's real speech path runs.
    const selectedBeforeJoin = await frame.locator("html").evaluate(() => window.sidevoiceUI?.store?.getState().session.selected);
    if (!selectedBeforeJoin && (await frame.locator("#connect").getAttribute("title"))?.includes("Leave")) await frame.locator("#connect").click();
    if ((await frame.locator("#connect").getAttribute("title"))?.includes("Join")) await frame.locator("#connect").click();
    await page.waitForFunction(() => {
      const state = document.querySelector("#app")?.contentWindow?.sidevoiceUI?.store?.getState();
      return !!state?.session.selected && state.session.selected === state.session.viewed;
    }, null, { timeout: 10_000 });
    await pickSample(page, "The agent says", false);
    await cardAction(page, "Agent speaks");
    await frame.locator(".stage-bubble[data-visible] .karaoke-played").waitFor();
    await page.clock.pauseAt(new Date());
    await holdAgent(frame, 57);
    await page.waitForTimeout(300);
    await capture(page, theme, view, "agent");
    await checkInk(frame, theme, view, ".stage-bubble .karaoke-played", 4.5);
    await checkInk(frame, theme, view, ".stage-bubble .karaoke-upcoming", 4.5);
    await checkFits(frame, theme, view, ".stage-bubble[data-visible]");
    await page.clock.resume();
    await frame.locator(".stage-bubble").waitFor({ state: "detached", timeout: 30_000 });
    await pickSample(page, "The agent says", true);
    await cardAction(page, "Agent speaks");
    await frame.locator(".stage-bubble[data-visible] .karaoke-played").waitFor();
    await page.clock.pauseAt(new Date());
    await holdAgent(frame, 330);
    await pastFirstPage(page, ".stage-bubble[data-visible]");
    await capture(page, theme, view, "agent-long");
    await checkFits(frame, theme, view, ".stage-bubble[data-visible]");
    await page.clock.resume();
    await frame.locator("#transcript-toggle:visible").first().click();
    await frame.locator(".transcript[data-open]").waitFor();
    await page.waitForTimeout(400);
    await capture(page, theme, view, "transcript");
    await page.close();
  }
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
} finally {
  await browser.close();
}
