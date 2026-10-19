// Draws the call-card exploration's creatures (web/callcard/) with sidevoice-web's own bichos engine, so the mockup
// shows the app's drawings and moves them with the app's CSS, with no build step in the page.
//
//   node scripts/callcard-creatures.mjs --web <sidevoice-web tree> --sha <its commit> --esbuild <esbuild package dir>
//
// <sidevoice-web tree> is a checkout (or `git archive` of one) holding apps/web/src; <esbuild package dir> is any
// node_modules/esbuild (a sidevoice-web checkout's, after `npm ci`), which bundles the engine for Node. It writes
// web/callcard/creatures.json (each creature's SVG at the stage and sidebar sizes, its backdrop and desk) and
// web/callcard/motion.mjs (the engine's own picks of what a bicho does: its work and idle turns, its startle, its mouth),
// and copies beside them the web's stylesheets the card is drawn with: the engine's (styles/bichos.css), the avatars'
// (styles/call.css), the design tokens (styles/tokens.css, styles/theme.css), the call stage's (features/call/
// call-view.css: the balloons, the name), today's call controls card's (call-controls/call-card.css) and the settings
// screen's (components/ui/ui.css, features/settings/settings.css).
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { web: { type: "string" }, sha: { type: "string" }, esbuild: { type: "string" } } });
if (!values.web || !values.sha || !values.esbuild) {
  throw new Error("usage: --web <sidevoice-web tree> --sha <commit> --esbuild <esbuild package dir>");
}
const src = resolve(values.web, "apps/web/src");
const out = resolve(import.meta.dirname, "../web/callcard");

// The conversations the mockup calls (their titles are their seeds here), then the Sidevoice mascot.
const SEEDS = ["Orquestador Sidevoice", "Refactor del relay", "Landing nueva", "Tests de la voz"];

const dir = mkdtempSync(join(tmpdir(), "callcard-creatures-"));
const entry = join(dir, "entry.ts");
const from = (path) => JSON.stringify(join(src, "features/avatar/engine", path));
writeFileSync(entry, `
import { specFromSeed } from ${from("bichos/seed")};
import { renderSpec } from ${from("bichos/render")};
import { worksFor } from ${from("bichos/work")};
import { idlesFor } from ${from("bichos/idle")};
import { renderMascot } from ${from("styles/bichos")};
import { backdropFromSeed, backdropSvg } from ${from("backdrop")};
import { DESK_TOPS, deskFromSeed, deskSvg } from ${from("desk")};
import { personSpec } from ${JSON.stringify(join(src, "features/avatar/bicho-draw"))};
const scene = (seed, tone) => {
  const desk = deskFromSeed(seed);
  const [, top, topDeep, front, frontDeep] = DESK_TOPS[desk.top] ?? DESK_TOPS.wood;
  return { backdrop: backdropSvg(backdropFromSeed(seed), tone, "dark"), desk: deskSvg(desk), deskColours: { top, topDeep, front, frontDeep } };
};
const creatures = ${JSON.stringify(SEEDS)}.map((seed) => {
  const spec = specFromSeed(seed);
  const stage = renderSpec(spec, "stage"), small = renderSpec(spec, "sidebar");
  return { id: seed, seed, tone: stage.tone, works: worksFor(spec), idles: idlesFor(spec), stage: stage.html, small: small.html, ...scene(seed, stage.tone) };
});
const mascot = renderMascot("sidevoice", "stage");
creatures.push({ id: "mascot:sidevoice", seed: "Sidevoice", tone: mascot.tone, works: [], idles: [], stage: mascot.html,
  small: renderMascot("sidevoice", "sidebar").html, ...scene("Sidevoice", mascot.tone) });
// The person holding the microphone (onboarding's: PermissionsList PERSON_WITH_MIC), for the settings' previews.
const person = personSpec("microphone");
creatures.push({ id: "person:microphone", seed: "My project", tone: renderSpec(person, "stage").tone, works: [], idles: [], stage: renderSpec(person, "stage").html,
  small: renderSpec(person, "sidebar").html, ...scene("My project", renderSpec(person, "stage").tone) });
process.stdout.write(JSON.stringify(creatures));
`);

// The engine's registry finds its part batches with Vite's import.meta.glob: here, the same files imported one by one.
const glob = {
  name: "parts-glob",
  setup(build) {
    build.onLoad({ filter: /bichos[\\/]registry\.ts$/ }, ({ path }) => {
      const parts = readdirSync(resolve(path, "../../parts")).filter((name) => name.endsWith(".ts") && !name.includes(".test.")).sort();
      const imports = parts.map((name, i) => `import * as p${i} from "../parts/${name}";`).join("\n");
      const files = `{${parts.map((name, i) => `"../parts/${name}": p${i}`).join(", ")}}`;
      const code = readFileSync(path, "utf8").replace(/import\.meta\.glob(<[^>]*>)?\([^)]*\)/, files);
      return { contents: imports + "\n" + code, loader: "ts" };
    });
  },
};
const esbuild = (await import(resolve(values.esbuild, "lib/main.js"))).default;
const bundle = join(dir, "bundle.mjs");
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", logLevel: "warning", outfile: bundle, plugins: [glob] });
const creatures = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: "utf8", maxBuffer: 64 << 20 }));

// What the app's avatar picks, as the browser module the page imports: the engine's functions, bundled, not rewritten.
const motion = join(dir, "motion.ts");
writeFileSync(motion, `
export { nextWork, workTurn } from ${from("bichos/work")};
export { nextIdle } from ${from("bichos/idle")};
export { enterFrom, ENTER_MS } from ${from("styles/bichos")};
export { smoothPlaybackLevel } from ${JSON.stringify(join(src, "features/avatar/playback-mouth"))};
export { createPlaybackLevelChannel } from ${JSON.stringify(join(src, "state/playback-level"))};
`);
await esbuild.build({ entryPoints: [motion], bundle: true, platform: "browser", format: "esm", logLevel: "warning", outfile: join(out, "motion.mjs"), plugins: [glob], minify: true,
  banner: { js: `// GENERATED from sidevoice-web@${values.sha} by scripts/callcard-creatures.mjs: the bichos engine's own picks.` } });

// The harness marks the stage's badge wears (components/ui/Icons.tsx HarnessIcon), from the web's own logo files.
const marks = Object.fromEntries(["claude", "codex"].map((name) => [name, readFileSync(join(src, `assets/logos/${name}.svg`), "utf8").trim()]));
writeFileSync(join(out, "creatures.json"), JSON.stringify({ source: `sidevoice-web@${values.sha}`, creatures, marks }) + "\n");
for (const path of ["styles/bichos.css", "styles/call.css", "styles/tokens.css", "styles/theme.css", "features/call/call-view.css",
  "call-controls/call-card.css", "components/ui/ui.css", "features/settings/settings.css"]) {
  const css = readFileSync(join(src, path), "utf8");
  // The brand's typeface is served here from callcard/fonts/, not from the web's /voice/fonts/.
  writeFileSync(join(out, path.split("/").pop()), `/* COPIED from sidevoice-web@${values.sha} apps/web/src/${path} by scripts/callcard-creatures.mjs. */\n${css.replaceAll("/voice/fonts/", "/callcard/fonts/")}`);
}
// DM Sans, as the web bundles it, with its licence.
mkdirSync(join(out, "fonts"), { recursive: true });
for (const name of ["DMSans-Variable-latin.woff2", "OFL.txt"]) copyFileSync(resolve(values.web, "apps/web/public/fonts", name), join(out, "fonts", name));
console.log(`wrote ${creatures.length} creatures from sidevoice-web@${values.sha} to ${out}`);
