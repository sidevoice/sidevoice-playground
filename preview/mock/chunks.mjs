// The mocked preview's packages, in the browser view: the web loads @sidevoice/engine and @sidevoice/voice with
// `import()`, each as a chunk of its own that the build names by hash. The chunk whose exports include `WebEngine` is
// the engine's, the one with `createVoiceHost` the voice's; for a mocked run the origin serves, at that chunk's
// address, a module with the same exports taken from the shell's mocks (attach.mjs `mockModule`). The web is built
// as it is and asks for its packages as it does; only what answers changes.

import { readFile } from "node:fs/promises";

/** The names a built chunk exports: its last `export{a as B, c as default}`. */
export function exportedNames(code) {
  const list = [...code.matchAll(/export\s*\{([^}]*)\}/g)].at(-1)?.[1];
  if (!list) return [];
  return list.split(",").map((part) => part.trim().split(/\s+as\s+/).at(-1).trim()).filter(Boolean);
}

/** Which package a chunk is: `engine`, `voice`, or null. */
export function packageOf(names) {
  if (names.includes("WebEngine")) return "engine";
  if (names.includes("createVoiceHost")) return "voice";
  return null;
}

/** The module served for a chunk of package `kind` exporting `names`: each export, the shell's mock of it. */
export function mockChunk(kind, names) {
  const lines = [
    `// The mocked preview's ${kind} package (the playground's preview/mock/chunks.mjs): the shell's mocks, by name.`,
    `const mocked = window.parent !== window && window.parent.__sidevoicePreview ? window.parent.__sidevoicePreview.module(${JSON.stringify(kind)}) : {};`,
  ];
  for (const name of names) {
    if (name === "default") lines.push(`export default mocked["default"];`);
    else if (/^[A-Za-z_$][\w$]*$/.test(name)) lines.push(`export const ${name} = mocked[${JSON.stringify(name)}];`);
  }
  return lines.join("\n") + "\n";
}

const known = new Map();
/** The mocked module to serve for the site file at `path`, or null when it is not a package's chunk. */
export async function chunkFor(path) {
  if (!path.endsWith(".js")) return null;
  if (!known.has(path)) {
    const code = await readFile(path, "utf8").catch(() => "");
    const names = exportedNames(code);
    const kind = packageOf(names);
    known.set(path, kind ? mockChunk(kind, names) : null);
  }
  return known.get(path);
}
