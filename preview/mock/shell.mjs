// The mocked preview's shell: the real web in a frame sized by the view (browser, the desktop app's window, a
// phone), the world its mocks answer from, and the card that picks the scenario and its options. Everything the
// card picks is in this page's address, so a link opens the same screen. A scenario, a view, a language or an
// option marked ↻ loads the page again, from the storage the world says it had; any other option is live. While
// "Keep state on reload" is on, a reload of this page restores the world and leaves the page's storage as
// it was, and a view, a language or a ↻ option changes only what the world owns of it (`mergeSeed`).

import { createWorld, changedCount } from "./world.mjs";
import { loadIdentities, makeIdentities, saveIdentities, seededStorage } from "./machines.mjs";
import { attach, mockModule } from "./attach.mjs";

// The design alternatives the web offers to compare (VARIANTS), and the panel that picks them (drawVariants). The page reads what is picked from
// localStorage `sidevoice.variants` (`{ name: value }`; sidevoice-web src/lib/variants.ts), the same origin as this
// shell, and follows it live; a variant the page no longer has is simply never read. Each entry names the page's
// variant and its values, the first being the page's default.
const VARIANTS_KEY = "sidevoice.variants";

/** @type {{ name: string, label: string, note: string, values: { value: string, label: string }[] }[]} */
const VARIANTS = [
  { name: "updates-entry", label: "Updates on a phone", note: "Where a phone shows what wants updating (a desktop: the conversations' foot).",
    values: [{ value: "header", label: "A · a button in the header" }, { value: "panel", label: "B · the conversations' panel, a dot on the chevron" }] },
  { name: "whats-new", label: "What's new", note: "How someone set up on an earlier release is told what is new.",
    values: [{ value: "dialog", label: "A · a small dialog" }, { value: "panel", label: "B · a section of the updates' list" }] },
  { name: "agent-actions", label: "An agent's other actions", note: "In the agents list: what a row offers besides Connect or Disconnect.",
    values: [{ value: "split", label: "A · a split button, its chevron joined" }, { value: "original", label: "B · every action a button on the row (the original)" }] },
  { name: "ready", label: "The setup's last step", note: "Ready: what was set up, what to tell an agent, and Enter Sidevoice.",
    values: [{ value: "a", label: "A · in the setup's frame" }, { value: "b", label: "B · on the stage, the frame stepped back" }] },
]

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

// What a reload keeps, while "Keep state on reload" is on (the default): the world as it stood (its state, choices
// and the machines' identities, which the page's pairings name) and the page's own storage, so a person comparing
// designs halfway through a flow is not sent back to its start. The snapshot is this tab's (sessionStorage), and only
// for the address it was taken at: a link opened elsewhere, or another scenario, starts from the scenario as written.
// "Restart scenario" and "Reset preview" start over.

/** localStorage: "off" while reloads start the scenario over; anything else keeps. */
export const KEEP_KEY = "sidevoice-preview.keep";
/** sessionStorage: the world as it last stood (`snapshotOf`). */
export const SNAPSHOT_KEY = "sidevoice-preview.snapshot";

/** Whether reloads keep the state, from the shell's `storage`. */
export function keeping(storage) {
  try { return storage.getItem(KEEP_KEY) !== "off"; } catch { return true; }
}

/** What a reload at `search` restores `world` from; `identities` as `saveIdentities` gave them. */
export function snapshotOf(world, identities, search) {
  return { scenario: world.scenario.id, search, choices: world.choices, state: world.state, identities };
}

/** The snapshot in `text` when it was taken at `search` on scenario `id`; else null. */
export function restorable(text, id, search) {
  try {
    const snapshot = JSON.parse(text ?? "null");
    return snapshot?.scenario === id && snapshot.search === search && snapshot.state && snapshot.identities ? snapshot : null;
  } catch {
    return null;
  }
}

const parse = (text, fallback) => {
  try { return JSON.parse(text) ?? fallback; } catch { return fallback; }
};
/** Keys only the world writes: the page's own copy goes when the world no longer has one. */
const worldOwned = (key) => key === "sidevoice.local-host-selected" || key.startsWith("sidevoice.provider-key.");

/**
 * The page's localStorage `current` brought to what the world now says (`seeded`, machines.mjs `seededStorage`)
 * while keeping what the page did itself: its first-run progress, the pairings it made, its other settings.
 * Returns the keys to `set` and to `remove`.
 */
export function mergeSeed(current, seeded) {
  const set = {};
  const remove = Object.keys(current).filter((key) => worldOwned(key) && !(key in seeded));
  for (const [key, value] of Object.entries(seeded)) {
    if (key === "sidevoice.onboarding" && key in current) continue;
    if (key === "sidevoice.pairings" && key in current) {
      const kept = parse(current[key], {}), now = parse(value, {});
      const fresh = now.pairings ?? [];
      set[key] = JSON.stringify({ ...kept, in_use: now.in_use ?? null,
        pairings: [...(kept.pairings ?? []).filter((p) => !fresh.some((f) => f.fp === p.fp)), ...fresh] });
    } else set[key] = value;
  }
  // The interface's language is the world's (the card's Language); the rest of the settings are the page's.
  const settings = { ...parse(current["sidevoice.settings"] ?? "{}", {}) };
  delete settings.ui_language;
  const language = parse(seeded["sidevoice.settings"] ?? "{}", {}).ui_language;
  if (language) settings.ui_language = language;
  if (Object.keys(settings).length) set["sidevoice.settings"] = JSON.stringify(settings);
  else if ("sidevoice.settings" in current) remove.push("sidevoice.settings");
  return { set, remove };
}

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
 *  variants picked and whether reloads keep the state stay: they are the person comparing designs, not the page's state. */
async function seed(local) {
  try {
    const kept = [VARIANTS_KEY, KEEP_KEY].map((key) => [key, localStorage.getItem(key)]);
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of kept) if (value != null) localStorage.setItem(key, value);
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

/** Brings the page's localStorage to `local` as `mergeSeed` says, leaving the rest of what it keeps as it is. */
function overlay(local) {
  try {
    const { set, remove } = mergeSeed({ ...localStorage }, local);
    for (const key of remove) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(set)) localStorage.setItem(key, value);
  } catch {}
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
  let saved = null;
  let keep = keeping(localStorage);
  let open = matchMedia("(min-width: 761px)").matches;

  const scenario = () => scenarios.find((s) => s.id === params.scenario) ?? scenarios[0];
  const firstValues = () => Object.fromEntries(scenario().options.map((o) => [o.id, o.values[0].value]));
  const view = () => params.view ?? scenario().view ?? "browser";
  // The address is what a snapshot is for: it is taken again whenever the address changes.
  const remember = () => {
    history.replaceState(null, "", location.pathname + writeParams({ ...params, scenario: scenario().id, options: world.choices }, firstValues()));
    save();
  };

  window.__sidevoicePreview = {
    attach: (win) => attach(win, { world, identities, desktop: view() === "app", onKey: shortcut }),
    module: (kind) => mockModule(kind, world),
  };

  /** The world as it stands, for a reload to restore. */
  function save() {
    try {
      if (keep && saved) sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshotOf(world, saved, location.search)));
    } catch {}
  }

  /** Loads the page again from the storage the world says it had; `fresh` makes the world (and its machines) anew,
   *  from `snapshot` when there is one, the page's storage then left as it is. */
  async function load({ fresh = false, snapshot = null } = {}) {
    const remake = fresh || !world;
    if (remake) {
      world = createWorld(scenario(), snapshot?.choices ?? params.options);
      if (snapshot) world.state = snapshot.state;
      identities = snapshot ? await loadIdentities(snapshot.identities) : await makeIdentities(world.state);
      saved = snapshot?.identities ?? await saveIdentities(identities);
      // The card follows the world: its activity on every answer, all of it when the codes it can give change.
      let running = world.state.local?.state === "running";
      world.subscribe(() => {
        const now = world.state.local?.state === "running";
        if (now !== running) {
          running = now;
          render();
        } else updateActivity(card, world);
        save();
      });
    }
    world.speed = params.speed;
    world.state.language = params.language;
    device.className = `device ${view()}`;
    // The card first: whatever the page's storage does next, the card is there to change it or reset it.
    remember();
    render();
    frame.src = "about:blank";
    const local = seededStorage(world.state, identities, world.now(), { desktop: view() === "app" });
    if (!snapshot) {
      if (keep && !remake) overlay(local);
      else await seed(local);
    }
    save();
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
      scenarios, scenario: scenario(), world, identities, params: { ...params, view: view() }, open, keeping: keep,
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
      keep(on) {
        keep = on;
        try {
          localStorage.setItem(KEEP_KEY, on ? "on" : "off");
          if (on) save();
          else sessionStorage.removeItem(SNAPSHOT_KEY);
        } catch {}
        render();
      },
    });
  }

  let snapshot = null;
  try {
    if (keep) snapshot = restorable(sessionStorage.getItem(SNAPSHOT_KEY), scenario().id, location.search);
  } catch {}
  await load({ fresh: true, snapshot });
}

if (typeof document !== "undefined") main();
