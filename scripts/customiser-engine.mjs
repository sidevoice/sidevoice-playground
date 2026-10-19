// Bundles sidevoice-web's bichos engine for the browser, so the avatar customiser (web/customiser/) redraws a creature
// live with the app's own engine and moves it with the app's own CSS, with no build step in the page.
//
//   node scripts/customiser-engine.mjs --web <sidevoice-web tree> --sha <its commit> --esbuild <esbuild package dir>
//
// <sidevoice-web tree> is a checkout (or `git archive` of one) holding apps/web/src; <esbuild package dir> is any
// node_modules/esbuild (a sidevoice-web checkout's, after `npm ci`). It writes web/customiser/bichos.mjs (the engine's
// spec, roller, renderer, catalogue, backdrops and desks, one ES module) and copies the engine's generated stylesheet
// (styles/bichos.css) and the app's avatar rules (styles/call.css) beside it.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { web: { type: "string" }, sha: { type: "string" }, esbuild: { type: "string" } } });
if (!values.web || !values.sha || !values.esbuild) {
  throw new Error("usage: --web <sidevoice-web tree> --sha <commit> --esbuild <esbuild package dir>");
}
const src = resolve(values.web, "apps/web/src");
const out = resolve(import.meta.dirname, "../web/customiser");

const dir = mkdtempSync(join(tmpdir(), "customiser-engine-"));
const entry = join(dir, "entry.ts");
const from = (path) => JSON.stringify(join(src, "features/avatar/engine", path));
writeFileSync(entry, `
export { specFromSeed, memberSpec } from ${from("bichos/seed")};
export { renderSpec } from ${from("bichos/render")};
export { normalizeSpec, withPart, withBody, available, idsIn, traitsOf } from ${from("bichos/spec")};
export { SLOTS, BODIES, FAMILIES, MEMBERS, partsIn, partOf } from ${from("bichos/registry")};
export { SWATCHES } from ${from("bichos/kit")};
export { WORKS, WORK_LABELS, worksFor } from ${from("bichos/work")};
export { IDLE_STYLES, IDLE_LABELS, idlesFor } from ${from("bichos/idle")};
export { BACKDROPS, backdropFromSeed, backdropSvg } from ${from("backdrop")};
export { DESK_TOPS, DESK_PROPS, deskFromSeed, deskSvg } from ${from("desk")};
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
const bundle = join(dir, "bichos.mjs");
await esbuild.build({ entryPoints: [entry], bundle: true, platform: "browser", format: "esm", minify: true, logLevel: "warning", outfile: bundle, plugins: [glob] });

writeFileSync(join(out, "bichos.mjs"), `/* GENERATED from sidevoice-web@${values.sha} apps/web/src/features/avatar/engine by scripts/customiser-engine.mjs: do not edit. */\n${readFileSync(bundle, "utf8")}export const SOURCE = "sidevoice-web@${values.sha}";\n`);
for (const name of ["bichos.css", "call.css"]) {
  const css = readFileSync(join(src, "styles", name), "utf8");
  writeFileSync(join(out, name), `/* COPIED from sidevoice-web@${values.sha} apps/web/src/styles/${name} by scripts/customiser-engine.mjs. */\n${css}`);
}
console.log(`wrote the bichos engine from sidevoice-web@${values.sha} to ${out}`);
