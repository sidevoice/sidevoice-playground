// Draws the call-card exploration's creatures (web/callcard/) with sidevoice-web's own bichos engine, so the mockup
// shows the app's drawings and moves them with the app's CSS, with no build step in the page.
//
//   node scripts/callcard-creatures.mjs --web <sidevoice-web tree> --sha <its commit> --esbuild <esbuild package dir>
//
// <sidevoice-web tree> is a checkout (or `git archive` of one) holding apps/web/src; <esbuild package dir> is any
// node_modules/esbuild (a sidevoice-web checkout's, after `npm ci`), which bundles the engine for Node. It writes
// web/callcard/creatures.json (each creature's SVG at the stage and sidebar sizes, its backdrop and desk) and copies
// the engine's generated stylesheet (styles/bichos.css) and the app's avatar rules (styles/call.css) beside it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

writeFileSync(join(out, "creatures.json"), JSON.stringify({ source: `sidevoice-web@${values.sha}`, creatures }) + "\n");
for (const name of ["bichos.css", "call.css"]) {
  const css = readFileSync(join(src, "styles", name), "utf8");
  writeFileSync(join(out, name), `/* COPIED from sidevoice-web@${values.sha} apps/web/src/styles/${name} by scripts/callcard-creatures.mjs. */\n${css}`);
}
console.log(`wrote ${creatures.length} creatures from sidevoice-web@${values.sha} to ${out}`);
