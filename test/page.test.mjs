import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../web/app.mjs", import.meta.url), "utf8");

test("every element the page script looks up is in index.html", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...app.matchAll(/\$\(`?["`]#([\w-]+)/g)].map((m) => m[1]).filter((id) => !id.includes("$"));
  assert.ok(used.length > 20);
  for (const id of used) assert.ok(ids.has(id), `#${id}`);
  for (const screen of ["tts", "stt"]) {
    const section = html.slice(html.indexOf(`<section id="${screen}"`), html.indexOf("</section>", html.indexOf(`<section id="${screen}"`)));
    for (const name of ["family", "model", "advanced", "builds", "build-info", "progress", "model-status", "cancel", "remove", "run-status"]) {
      assert.match(section, new RegExp(`class="[^"]*\\b${name}\\b`), `#${screen} .${name}`);
    }
  }
});

test("the page is set up for phones: viewport, no zoom on focus, touch-sized controls", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1/);
  assert.match(css, /font-size: 16px; \/\* 16px or more/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /overflow-x: hidden/);
});
