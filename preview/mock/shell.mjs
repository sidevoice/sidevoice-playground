// The mocked preview's shell: the real web in a frame sized by the view (browser, the desktop app's window, a
// phone), the world its mocks answer from, and the card that picks the scenario and its options. Everything the
// card picks is in this page's address, so a link opens the same screen. A scenario, a view, a language or an
// option marked ↻ loads the page again, from the storage the world says it had; any other option is live.

import { createWorld, changedCount } from "./world.mjs";
import { makeIdentities, seededStorage } from "./machines.mjs";
import { attach, mockModule } from "./attach.mjs";

// The design alternatives the web offers to compare (VARIANTS), and the panel that picks them (drawVariants). The page reads what is picked from
// localStorage `sidevoice.variants` (`{ name: value }`; sidevoice-web src/lib/variants.ts), the same origin as this
// shell, and follows it live; a variant the page no longer has is simply never read. Each entry names the page's
// variant and its values, the first being the page's default.
const VARIANTS_KEY = "sidevoice.variants";

/** @type {{ name: string, label: string, note: string, values: { value: string, label: string }[] }[]} */
const VARIANTS = [
  { name: "machines", label: "Settings → Machines", note: "How the machines are laid out.",
    values: [{ value: "a", label: "A · picker + add" }, { value: "b", label: "B · list → page" }] },
  { name: "header-avatars", label: "Phone header avatars", note: "Where the other conversations sit in a phone's header.",
    values: [{ value: "left", label: "Left" }, { value: "centre", label: "Centre" }, { value: "right", label: "Right" }] },
];

function readVariants() {
  try { return JSON.parse(localStorage.getItem(VARIANTS_KEY) || "{}") ?? {}; } catch { return {}; }
}

/** Draws the pickers into `body`: one group of radio buttons per variant, the picked one checked. */
function drawVariants(body) {
  const picked = readVariants();
  body.replaceChildren(...VARIANTS.map((variant) => {
    const group = document.createElement("fieldset");
    group.className = "variant";
    const legend = document.createElement("legend");
    legend.textContent = variant.label;
    const note = document.createElement("p");
    note.className = "variant-note";
    note.textContent = variant.note;
    group.append(legend, note);
    const current = variant.values.some((option) => option.value === picked[variant.name]) ? picked[variant.name] : variant.values[0].value;
    for (const option of variant.values) {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "variant-" + variant.name;
      input.value = option.value;
      input.checked = option.value === current;
      input.addEventListener("change", () => {
        localStorage.setItem(VARIANTS_KEY, JSON.stringify({ ...readVariants(), [variant.name]: option.value }));
      });
      label.append(input, " " + option.label);
      group.append(label);
    }
    return group;
  }));
}
import { renderCard, updateActivity } from "./card.mjs";

export const VIEWS = ["browser", "app", "phone"];
export const LANGUAGES = ["", "es", "en"];
export const SPEEDS = [1, 4, 0];

/** The card's picks in an address's query: `s`, `view` (null: the scenario's own), `lang`, `speed`, and `o.<option>`. */
export function readParams(search) {
  const query = new URLSearchParams(search);
  const options = {};
  for (const [key, value] of query) if (key.startsWith("o.")) options[key.slice(2)] = value;
  const speed = Number(query.get("speed"));
  return {
    scenario: query.get("s") ?? "",
    view: VIEWS.includes(query.get("view")) ? query.get("view") : null,
    language: LANGUAGES.includes(query.get("lang")) ? query.get("lang") : "",
    speed: SPEEDS.includes(speed) && query.has("speed") ? speed : 1,
    options,
  };
}

/** The query for `params`, leaving out what is at its default (options at their first value included). */
export function writeParams({ scenario, view, language, speed, options }, defaults = {}) {
  const query = new URLSearchParams();
  if (scenario) query.set("s", scenario);
  if (view) query.set("view", view);
  if (language) query.set("lang", language);
  if (speed !== 1) query.set("speed", String(speed));
  for (const [id, value] of Object.entries(options)) if (defaults[id] !== value) query.set(`o.${id}`, value);
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** `promise`, or undefined once `ms` passed: a browser's storage that does not answer never holds the preview up. */
export function bounded(promise, ms) {
  let timer;
  return Promise.race([Promise.resolve(promise).catch(() => undefined), new Promise((resolve) => (timer = setTimeout(resolve, ms)))])
    .finally(() => clearTimeout(timer));
}

/** Empties what the page keeps on this origin, then writes `local` into its localStorage; each step bounded in time. The
 *  variants picked stay: they are the person comparing designs, not the page's state. */
async function seed(local) {
  let picked = null;
  try {
    picked = localStorage.getItem(VARIANTS_KEY);
    localStorage.clear();
    sessionStorage.clear();
    if (picked) localStorage.setItem(VARIANTS_KEY, picked);
  } catch {}
  const databases = (await bounded(indexedDB.databases?.(), 2000)) ?? [];
  await Promise.all(databases.filter((db) => db.name).map((db) => bounded(new Promise((resolve) =>
    Object.assign(indexedDB.deleteDatabase(db.name), { onsuccess: resolve, onerror: resolve, onblocked: resolve })), 2000)));
  await bounded((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
  })(), 3000);
  for (const [key, value] of Object.entries(local)) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
}

/** What went wrong, in the card, with the way out: the card itself must survive anything. */
function problem(card, message) {
  let note = card.querySelector(".problem");
  if (!note) {
    note = Object.assign(document.createElement("p"), { className: "problem" });
    (card.querySelector(".card-body") ?? card).prepend(note);
  }
  note.replaceChildren(`The preview hit a problem: ${message} `, Object.assign(document.createElement("a"), {
    href: "/preview-reset", textContent: "Reset the preview",
  }), " (clears what this browser keeps for it).");
}

async function main() {
  const card = document.getElementById("card");
  addEventListener("error", (event) => problem(card, String(event.message ?? event.error)));
  addEventListener("unhandledrejection", (event) => problem(card, String(event.reason?.message ?? event.reason)));
  try {
    await run(card);
  } catch (error) {
    problem(card, String(error?.message ?? error));
  }
}

async function run(card) {
  const scenarios = await (await fetch("/preview-mock/scenarios.json", { cache: "no-store" })).json();
  const frame = document.getElementById("app");
  const device = document.getElementById("device");
  let params = readParams(location.search);
  let world = null;
  let identities = null;
  let open = matchMedia("(min-width: 761px)").matches;

  const scenario = () => scenarios.find((s) => s.id === params.scenario) ?? scenarios[0];
  const firstValues = () => Object.fromEntries(scenario().options.map((o) => [o.id, o.values[0].value]));
  const view = () => params.view ?? scenario().view ?? "browser";
  const remember = () => history.replaceState(null, "", location.pathname + writeParams({ ...params, scenario: scenario().id, options: world.choices }, firstValues()));

  window.__sidevoicePreview = {
    attach: (win) => attach(win, { world, identities, desktop: view() === "app", onKey: shortcut }),
    module: (kind) => mockModule(kind, world),
  };

  /** Loads the page again from the storage the world says it had; `fresh` makes the world (and its machines) anew. */
  async function load({ fresh = false } = {}) {
    if (fresh || !world) {
      world = createWorld(scenario(), params.options);
      identities = await makeIdentities(world.state);
      // The card follows the world: its activity on every answer, all of it when the codes it can give change.
      let running = world.state.local?.state === "running";
      world.subscribe(() => {
        const now = world.state.local?.state === "running";
        if (now !== running) {
          running = now;
          render();
        } else updateActivity(card, world);
      });
    }
    world.speed = params.speed;
    world.state.language = params.language;
    device.className = `device ${view()}`;
    // The card first: whatever the page's storage does next, the card is there to change it or reset it.
    remember();
    render();
    frame.src = "about:blank";
    await seed(seededStorage(world.state, identities, world.now(), { desktop: view() === "app" }));
    frame.src = "/voice/";
  }

  function shortcut(event) {
    if (event.altKey && event.shiftKey && event.code === "KeyP") {
      event.preventDefault();
      open = !open;
      render();
    }
  }
  addEventListener("keydown", shortcut, true);

  // The variants' panel opens and closes on its header, or Alt+Shift+V, and picks what the page shows (variants.mjs).
  const variants = document.getElementById("variants");
  const variantsBody = variants?.querySelector(".card-body");
  if (variantsBody) drawVariants(variantsBody);
  const flipVariants = () => {
    const closed = variants.classList.toggle("closed");
    variants.querySelector(".chevron").textContent = closed ? "▸" : "▾";
  };
  variants?.querySelector(".card-header").addEventListener("click", flipVariants);
  addEventListener("keydown", (event) => {
    if (variants && event.altKey && event.shiftKey && event.code === "KeyV") {
      event.preventDefault();
      flipVariants();
    }
  }, true);

  function render() {
    try {
      draw();
    } catch (error) {
      problem(card, String(error?.message ?? error));
    }
  }

  function draw() {
    renderCard(card, {
      scenarios, scenario: scenario(), world, identities, params: { ...params, view: view() }, open,
      count: changedCount(scenario(), world.choices),
      frame,
      toggle() {
        open = !open;
        render();
      },
      pick(next) {
        // Another scenario starts from its own view and options.
        params = next.scenario ? { ...params, view: null, ...next, options: {} } : { ...params, ...next };
        load({ fresh: !!next.scenario });
      },
      choose(id, value) {
        const reload = world.choose(id, value);
        params.options = world.choices;
        if (reload) load();
        else {
          remember();
          render();
        }
      },
      speed(value) {
        params.speed = value;
        world.speed = value;
        remember();
        render();
      },
      restart() {
        load({ fresh: true });
      },
      clear() {
        params.options = {};
        load({ fresh: true });
      },
    });
  }

  await load({ fresh: true });
}

if (typeof document !== "undefined") main();
