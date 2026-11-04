// The duck-level design sheet's page (duck-level.html): Settings > Call > "Other apps' media" in Spanish, light and dark,
// with the option for the level other apps' media is lowered to that the VARIANTS panel's `duckLevel` pick names, or all
// three side by side. The row is drawn as the web draws it (components/ui/Card Row and Group, Tabs Segmented, Settings'
// speed slider: the classes of duck-level-web.css, copied from sidevoice-web), and works: the mode, the presets and the
// slider can be moved. The panel (shell.mjs) writes `sidevoice.variants`; the sheet only reads it and follows it live.
//
//   ?v=presets|slider|windows|all   an option, or all of them (default: what the panel picked, else the first)
//   ?theme=both|light|dark          which themes to draw (default: both, side by side)
//   ?mode=lower|pause|off           the row's mode (default: lower, the default mode)
//   ?width=<px>                     the width of each Settings pane (default 720; 390 is a phone's)
import { MODES, OPTIONS, OPTION_IDS, TODAY, percent, rowFor, stepOf } from "./duck-level-data.mjs";

const VARIANTS_KEY = "sidevoice.variants";
const THEMES = ["light", "dark"];
const root = document.getElementById("sheet");
const query = new URLSearchParams(location.search);

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const readPick = () => {
  try { return JSON.parse(localStorage.getItem(VARIANTS_KEY) || "{}")?.duckLevel; } catch { return undefined; }
};

const state = {
  show: query.get("v") === "all" ? "all" : "picked",
  forced: OPTION_IDS.includes(query.get("v")) ? query.get("v") : null,
  theme: ["light", "dark"].includes(query.get("theme")) ? query.get("theme") : "both",
  mode: MODES.some((mode) => mode.value === query.get("mode")) ? query.get("mode") : "lower",
  width: Math.max(320, Math.min(900, Number(query.get("width")) || 720)),
  // Each option keeps its own level: the slider's 25 % is not a stop of the Windows-style list.
  levels: Object.fromEntries(OPTION_IDS.map((id) => [id, OPTIONS[id].start])),
};
const picked = () => state.forced ?? (OPTION_IDS.includes(readPick()) ? readPick() : OPTION_IDS[0]);
let focusKey = null;

/** One row of a group, as components/ui/Card.tsx draws it. */
function row({ label, hint, control, htmlFor }) {
  const name = htmlFor ? `<label class="ui-row-label" for="${htmlFor}">${esc(label)}</label>` : `<span class="ui-row-label">${esc(label)}</span>`;
  return `<div class="ui-row"><div class="ui-row-text">${name}${hint ? `<p class="ui-row-description">${esc(hint)}</p>` : ""}</div>${control ? `<div class="ui-row-control">${control}</div>` : ""}</div>`;
}

/** components/ui/Tabs.tsx Segmented, small: a radio group of buttons, the chosen one checked. */
function segmented({ label, items, current, key, attribute }) {
  const buttons = items.map(({ value, label: text }, index) =>
    `<button type="button" role="radio" class="ui-segment" aria-checked="${index === current}" tabindex="${index === current ? 0 : -1}" data-${attribute}="${esc(value)}" data-key="${key}-${index}"><span>${esc(text)}</span></button>`).join("");
  return `<div class="ui-segmented ui-segmented--sm" role="radiogroup" aria-label="${esc(label)}">${buttons}</div>`;
}

/** The level's control: presets as a Segmented, or the slider as Settings draws the voice's speed (`.voice-speed`). */
function levelControl(id, theme, option, level) {
  if (option.steps) {
    return segmented({ label: option.label, items: option.steps.map((step) => ({ value: step.level, label: step.label })), current: stepOf(option, level), key: `${id}-${theme}`, attribute: "level" });
  }
  const field = `level-${id}-${theme}`;
  return `<span class="voice-speed"><input id="${field}" type="range" min="${option.range.min}" max="${option.range.max}" step="${option.range.step}" value="${level}" data-slider="${id}"><output for="${field}" data-output="${id}">${percent(level)}</output></span>`;
}

/** The Settings pane: Call's title and the row's group, as sidevoice-web's Section, Group and Row draw them. */
function pane(id, theme) {
  const option = OPTIONS[id];
  const { hint, level } = rowFor(id, state.mode, state.levels[id]);
  const mode = row({ label: TODAY.row, hint, control: segmented({ label: TODAY.row, items: MODES, current: MODES.findIndex((m) => m.value === state.mode), key: `mode-${id}-${theme}`, attribute: "mode" }) });
  const lowered = level ? row({ label: level.label, hint: level.hint, htmlFor: option.range ? `level-${id}-${theme}` : undefined, control: levelControl(id, theme, option, level.level) }) : "";
  return `<div class="sheet-window" style="--window:${state.width}px"><b>${theme}</b><div class="duck-window" data-theme="${theme}"><div class="settings-column">
<section class="ui-section"><header class="ui-section-head"><div><h2 class="ui-section-title">${esc(TODAY.section)}</h2><p class="ui-section-description">${esc(TODAY.sectionHint)}</p></div></header>
<div class="ui-section-body"><div class="ui-group"><div class="ui-group-card">${mode}${lowered}</div></div></div></section></div></div></div>`;
}

const bar = (title, choices) => `<span class="bar-group"><b>${title}</b><span class="bar-choice" role="radiogroup" aria-label="${title}">${choices.join("")}</span></span>`;
const choice = (title, value, on, text) => `<button type="button" role="radio" aria-checked="${on}" data-bar="${title}" data-value="${value}" data-key="bar-${title}-${value}">${text}</button>`;

function draw() {
  const ids = state.show === "all" ? OPTION_IDS : [picked()];
  const themes = state.theme === "both" ? THEMES : [state.theme];
  const pick = picked();
  const blocks = ids.map((id) => {
    const option = OPTIONS[id];
    return `<section class="sheet-block" id="option-${id}"><h2>${option.letter} · ${esc(option.name)}${state.show === "all" && id === pick ? " <small>picked in the panel</small>" : ""}</h2>
<p class="why">${esc(WHY[id])}</p><div class="sheet-windows">${themes.map((theme) => pane(id, theme)).join("")}</div></section>`;
  }).join("");
  root.innerHTML = `<header class="sheet-bar"><h1>Other apps' media · the level it is lowered to</h1>
${bar("Show", [choice("show", "picked", state.show === "picked", `The panel's pick (${OPTIONS[pick].letter})`), choice("show", "all", state.show === "all", "All three")])}
${bar("Theme", [choice("theme", "both", state.theme === "both", "Both"), choice("theme", "light", state.theme === "light", "Light"), choice("theme", "dark", state.theme === "dark", "Dark")])}
<span class="bar-group">Pick it in the VARIANTS panel of <a href="/">the preview</a>.</span></header>
<div class="sheet-intro"><p>Settings &gt; Llamada, in Spanish, as on macOS with its permissions granted. Switch the mode: only <b>Bajar el volumen</b> has a level, so the row goes away with <b>Pausar</b> and <b>No hacer nada</b>. The controls work.</p>
<p>The level is what is left of another app's volume while it is lowered. Default 25 %.</p></div>${blocks}`;
  if (focusKey) root.querySelector(`[data-key="${focusKey}"]`)?.focus();
  focusKey = null;
}

/** What each option does for the decision, and what it costs: the sheet's reading, not the web's copy. */
const WHY = {
  presets: "Three named stops that map to 50 % / 25 % / 0 % of the volume. The default, 25 %, is Mucho. Each tap is one choice to carry to the app.",
  slider: "Any level from 0 to 100 %, the value beside it. The default is 25 %. 100 % lowers nothing, which is what No hacer nada already is; dragging asks the app for a level at every step unless it commits on release.",
  windows: "Windows' own four steps, as reductions: Silenciar, 80 %, 50 %, Nada. An 80 % reduction leaves 20 %, so the decided 25 % is not one of the stops, and Nada is No hacer nada again.",
};

root.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  focusKey = target.dataset.key ?? null;
  if (target.dataset.bar === "show") state.show = target.dataset.value;
  else if (target.dataset.bar === "theme") state.theme = target.dataset.value;
  else if (target.dataset.mode) state.mode = target.dataset.mode;
  else if (target.dataset.level !== undefined) state.levels[target.closest(".sheet-block").id.replace("option-", "")] = Number(target.dataset.level);
  else return;
  draw();
});

// A slider moves without redrawing it (a redraw would drop the drag); the other theme's copy follows.
root.addEventListener("input", (event) => {
  const slider = event.target.closest("input[type=range]");
  if (!slider) return;
  const id = slider.dataset.slider;
  state.levels[id] = Number(slider.value);
  for (const other of root.querySelectorAll(`input[data-slider="${id}"]`)) other.value = slider.value;
  for (const output of root.querySelectorAll(`output[data-output="${id}"]`)) output.textContent = percent(state.levels[id]);
});

// The panel's pick, live: it is the same origin's localStorage.
addEventListener("storage", (event) => { if (event.key === null || event.key === VARIANTS_KEY) draw(); });
draw();
