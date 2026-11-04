// Copies the stylesheets the duck-level design sheet (preview/mock/duck-level.html) is drawn with from sidevoice-web,
// so the sheet shows the app's own tokens, Row, Group and Segmented, never a look of its own.
//
//   node scripts/duck-level-styles.mjs --web <sidevoice-web tree> --sha <its commit>
//
// <sidevoice-web tree> is a checkout (or `git archive` of one) holding apps/web/src. It writes
// preview/mock/duck-level-web.css: the design tokens (styles/tokens.css, styles/theme.css), the page's base
// (styles/app.css), the shared components' (components/ui/ui.css) and Settings' (features/settings/settings.css), in
// the order the web loads them. The brand's typeface stays at `/voice/fonts/`, where a web build serves it.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { web: { type: "string" }, sha: { type: "string" } } });
if (!values.web || !values.sha) throw new Error("usage: --web <sidevoice-web tree> --sha <commit>");
const src = resolve(values.web, "apps/web/src");
const parts = ["styles/tokens.css", "styles/theme.css", "components/ui/ui.css", "styles/app.css", "features/settings/settings.css"];
const css = parts.map((path) =>
  `/* COPIED from sidevoice-web@${values.sha} apps/web/src/${path} by scripts/duck-level-styles.mjs. */\n${readFileSync(join(src, path), "utf8")}`).join("\n");
writeFileSync(resolve(import.meta.dirname, "../preview/mock/duck-level-web.css"), css);
console.log(`wrote duck-level-web.css from sidevoice-web@${values.sha}`);
