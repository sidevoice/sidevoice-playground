import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { importMap, resolveSpecifier } from "../served-engine.mjs";
import { importMapFor, withImportMap } from "../server.mjs";

const manifests = {
  "@sidevoice/engine": { exports: { ".": "./dist/sidevoice_engine.js" } },
  "@huggingface/transformers": { exports: { node: "./dist/node.mjs", default: { import: "./dist/web.js" } } },
  "onnxruntime-web": { exports: { ".": { browser: "./dist/ort.min.mjs" }, "./webgpu": { import: "./dist/ort.webgpu.mjs" } } },
  "espeak-ng": { browser: "espeak.js", main: "node.js" },
};
const read = (file) => {
  const name = Object.keys(manifests).find((n) => file === join("/site", "node_modules", n, "package.json"));
  if (!name) throw new Error(`ENOENT ${file}`);
  return JSON.stringify(manifests[name]);
};

test("a local build's imports resolve to each package's browser entry point", () => {
  assert.equal(resolveSpecifier("/site", "@huggingface/transformers", read), "@huggingface/transformers/dist/web.js");
  assert.equal(resolveSpecifier("/site", "onnxruntime-web/webgpu", read), "onnxruntime-web/dist/ort.webgpu.mjs");
  assert.equal(resolveSpecifier("/site", "espeak-ng", read), "espeak-ng/espeak.js");
  assert.equal(resolveSpecifier("/site", "onnxruntime-common", read), null);
  assert.deepEqual(importMap("/site", "/local-engine/", read), {
    "@sidevoice/engine": "/local-engine/node_modules/@sidevoice/engine/dist/sidevoice_engine.js",
    "@huggingface/transformers": "/local-engine/node_modules/@huggingface/transformers/dist/web.js",
    "onnxruntime-web": "/local-engine/node_modules/onnxruntime-web/dist/ort.min.mjs",
    "onnxruntime-web/webgpu": "/local-engine/node_modules/onnxruntime-web/dist/ort.webgpu.mjs",
    "espeak-ng": "/local-engine/node_modules/espeak-ng/espeak.js",
  });
});

test("the import map goes ahead of the page's module", () => {
  const html = withImportMap('<head><script type="module" src="app.mjs"></script></head>', { imports: { a: "/x.js" } });
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
  assert.match(html, /\{"imports":\{"a":"\/x.js"\}\}/);
});

test("each CI build's names go in its own scope; the local build's at the top level", () => {
  const local = { imports: { "@sidevoice/engine": "/local-engine/e.js" } };
  const ref = { prefix: "/engines/abc/", imports: { "@sidevoice/engine": "/engines/abc/e.js" } };
  assert.deepEqual(importMapFor(local, [ref]), {
    imports: local.imports,
    scopes: { "/engines/abc/": ref.imports },
  });
  assert.deepEqual(importMapFor(null, []), { imports: {} });
});
