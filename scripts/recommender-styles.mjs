// Copies the stylesheets the model recommender design sheet (preview/mock/recommender.html) is drawn with from
// sidevoice-web, so the sheet shows the app's own tokens, Select, Badge, Row/Group, model block and first-run setup,
// never a look of its own.
//
//   node scripts/recommender-styles.mjs --web <sidevoice-web tree> --sha <its commit>
//
// <sidevoice-web tree> is a checkout (or `git archive` of one) holding apps/web/src. It writes
// preview/mock/recommender-web.css: the design tokens (styles/tokens.css, styles/theme.css), the shared components'
// (components/ui/ui.css), the page's base (styles/app.css), Settings' (features/settings/settings.css), the model
// block's (features/settings/model-prepare.css) and the first-run setup's (features/onboarding/onboarding.css), in the
// order duck-level-styles.mjs uses. The brand's typeface stays at `/voice/fonts/`, where a web build serves it.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { web: { type: "string" }, sha: { type: "string" } } });
if (!values.web || !values.sha) throw new Error("usage: --web <sidevoice-web tree> --sha <commit>");
if (!/^[0-9a-f]{40}$/.test(values.sha)) throw new Error("--sha is the full 40-digit commit");
const src = resolve(values.web, "apps/web/src");
const parts = [
  "styles/tokens.css", "styles/theme.css", "components/ui/ui.css", "styles/app.css",
  "features/settings/settings.css", "features/settings/model-prepare.css", "features/onboarding/onboarding.css",
];
const css = parts.map((path) =>
  `/* COPIED from sidevoice-web@${values.sha} apps/web/src/${path} by scripts/recommender-styles.mjs. */\n${readFileSync(join(src, path), "utf8")}`).join("\n");
writeFileSync(resolve(import.meta.dirname, "../preview/mock/recommender-web.css"), css);
console.log(`wrote recommender-web.css from sidevoice-web@${values.sha}`);
