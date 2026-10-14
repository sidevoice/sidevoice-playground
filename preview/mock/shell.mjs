// The mocked preview's shell: the real web in a frame sized by the view (browser, the desktop app's window, a
// phone), the world its mocks answer from, and the card that picks the scenario and its options. Everything the
// card picks is in this page's address, so a link opens the same screen. A scenario, a view, a language or an
// option marked ↻ loads the page again, from the storage the world says it had; any other option is live. While
// "Keep state on reload" is on, a reload of this page restores the world and leaves the page's storage as
// it was, and a view, a language or a ↻ option changes only what the world owns of it (`mergeSeed`).

import { createWorld, changedCount } from "./world.mjs";
import { loadIdentities, makeIdentities, saveIdentities, seededStorage } from "./machines.mjs";
import { attach, mockModule } from "./attach.mjs";
import { cardHost } from "./card-host.mjs";

// The design alternatives the web offers to compare (VARIANTS), and the panel that picks them (drawVariants). The page reads what is picked from
// localStorage `sidevoice.variants` (`{ name: value }`; sidevoice-web src/lib/variants.ts), the same origin as this
// shell, and follows it live; a variant the page no longer has is simply never read. Each entry names the page's
// variant and its values, the first being the page's default.
const VARIANTS_KEY = "sidevoice.variants";

/** @type {{ name: string, label: string, note: string, values: { value: string, label: string }[] }[]} */
export const VARIANTS = [{
  name: "bubbles-style", label: "", note: "",
  values: ["current", "soft", "illustrated", "panel"].map((value) => ({ value, label: "" })),
}];

/** Copy only translated words from the actual app, keeping the panel's agreed choices and default. */
export function applyVariantMetadata(metadata) {
  const variant = VARIANTS[0];
  if (metadata?.name !== variant.name || !Array.isArray(metadata.values) ||
    metadata.values.length !== variant.values.length ||
    metadata.values.some((option, index) => option.value !== variant.values[index].value || typeof option.label !== "string") ||
    typeof metadata.label !== "string" || typeof metadata.note !== "string") return false;
  variant.label = metadata.label;
  variant.note = metadata.note;
  variant.values.forEach((option, index) => { option.label = metadata.values[index].label; });
  return true;
}

export function prunedVariantChoices(choices) {
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) return {};
  return Object.fromEntries(Object.entries(choices).filter(([name, value]) =>
    VARIANTS.some((variant) => variant.name === name && variant.values.some((each) => each.value === value))));
}

function readVariants() {
  try { return JSON.parse(localStorage.getItem(VARIANTS_KEY) || "{}") ?? {}; } catch { return {}; }
}

/** Choices kept for variants the panel no longer offers (decided ones), or for values it no longer offers (a reopened
 *  one's), go: the page then shows what was decided, or the variant's default. */
function pruneVariants() {
  const kept = readVariants();
  const open = prunedVariantChoices(kept);
  if (JSON.stringify(open) !== JSON.stringify(kept)) localStorage.setItem(VARIANTS_KEY, JSON.stringify(open));
}

/** Draws the pickers into `body`: one group of radio buttons per variant, the picked one checked. */
function drawVariants(body) {
  const picked = readVariants();
  if (!VARIANTS.length) {
    const none = document.createElement("p");
    none.className = "variant-note";
    none.textContent = "No open design questions right now.";
    body.replaceChildren(none);
    return;
  }
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
const worldOwned = (key) => key === "sidevoice.local-host-selected" || key.startsWith("sidevoice.provider-key.") || key.startsWith("sidevoice.provider-key-hint.");

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
    stage: query.get("stage") === "card" ? "card" : "app",
    options,
  };
}

/** The query for `params`, leaving out what is at its default (options at their first value included). */
export function writeParams({ scenario, view, language, speed, stage = "app", options }, defaults = {}) {
  const query = new URLSearchParams();
  if (scenario) query.set("s", scenario);
  if (view) query.set("view", view);
  if (language) query.set("lang", language);
  if (speed !== 1) query.set("speed", String(speed));
  if (stage === "card") query.set("stage", stage);
  for (const [id, value] of Object.entries(options)) if (defaults[id] !== value) query.set(`o.${id}`, value);
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** The least a desktop view is laid out at, in CSS px: the page then lays out as on a desktop, whatever room is left. */
export const DESKTOP = { width: 1280, height: 800 };
/** The phone's frame, and the desktop app's title bar. */
const PHONE = { width: 390, height: 844 };
const PHONE_FRAME = 20; // the shell's 10px border on each side sits outside the page's viewport
const APP_CHROME = 30;

/**
 * Where the page's frame goes in a slot of `width` × `height`, for `view`: its size (what the page lays out at), the
 * scale it is drawn at, and its offset. The browser fills the slot, at a desktop's size at least; the desktop app is a
 * window of a desktop's size and its title bar; both are scaled down to fit, never up. The phone is its own size.
 */
export function deviceBox({ width, height }, view) {
  let w, h, scale;
  if (view === "phone") {
    w = PHONE.width;
    h = Math.min(PHONE.height, Math.max(1, height - PHONE_FRAME));
    scale = 1;
  } else if (view === "app") {
    w = DESKTOP.width;
    h = DESKTOP.height + APP_CHROME;
    scale = Math.min(1, width / w, height / h);
  } else {
    scale = Math.min(1, width / DESKTOP.width, height / DESKTOP.height);
    w = width / scale;
    h = height / scale;
  }
  return { width: Math.round(w), height: Math.round(h), scale,
    left: Math.max(0, (width - w * scale - (view === "phone" ? PHONE_FRAME : 0)) / 2),
    top: Math.max(0, (height - h * scale - (view === "phone" ? PHONE_FRAME : 0)) / 2) };
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
  const slot = document.getElementById("slot");
  const stage = document.getElementById("stage");
  const switcher = document.getElementById("stage-switch");
  let params = readParams(location.search);
  let world = null;
  let identities = null;
  let saved = null;
  let keep = keeping(localStorage);
  let open = matchMedia("(min-width: 761px)").matches;

  const scenario = () => scenarios.find((s) => s.id === params.scenario) ?? scenarios[0];
  const float = floatingCard(frame, device);
  const firstValues = () => Object.fromEntries(scenario().options.map((o) => [o.id, o.values[0].value]));
  const view = () => params.view ?? scenario().view ?? "browser";
  // The address is what a snapshot is for: it is taken again whenever the address changes.
  const remember = () => {
    history.replaceState(null, "", location.pathname + writeParams({ ...params, scenario: scenario().id, options: world.choices }, firstValues()));
    save();
  };

  window.__sidevoicePreview = {
    attach: (win) => attach(win, { world, identities, desktop: view() === "app", onKey: shortcut, card: () => float.host(() => world) }),
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
    arrange();
    // The card first: whatever the page's storage does next, the card is there to change it or reset it.
    remember();
    render();
    frame.src = "about:blank";
    float.show(view() === "app");
    const local = seededStorage(world.state, identities, world.now(), { desktop: view() === "app" });
    if (!snapshot) {
      if (keep && !remake) overlay(local);
      else await seed(local);
    }
    save();
    frame.src = "/voice/";
  }

  /** The frame placed in what the panels leave (`deviceBox`), and, in the Desktop app view, the app's window or its
   *  floating card on the stage, as the switch says. */
  function place() {
    const box = slot?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    const at = deviceBox(box, view());
    Object.assign(device.style, {
      width: at.width + "px", height: at.height + "px", left: at.left + "px", top: at.top + "px",
      transform: at.scale < 1 ? `scale(${at.scale})` : "",
    });
  }
  function arrange() {
    const app = view() === "app";
    const onCard = app && params.stage === "card";
    if (stage) stage.dataset.stage = onCard ? "card" : "app";
    float.visible(onCard);
    if (switcher) {
      switcher.hidden = !app;
      for (const button of switcher.querySelectorAll("[data-stage]")) button.classList.toggle("on", button.getAttribute("data-stage") === (onCard ? "card" : "app"));
    }
    place();
  }
  if (slot) new ResizeObserver(place).observe(slot);
  for (const button of switcher?.querySelectorAll("[data-stage]") ?? []) {
    button.addEventListener("click", () => {
      params.stage = button.getAttribute("data-stage") === "card" ? "card" : "app";
      remember();
      arrange();
    });
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
  pruneVariants();
  if (variantsBody) drawVariants(variantsBody);
  let metadataObserver;
  let lastMetadata = "";
  const syncMetadata = () => {
    let metadata;
    const raw = frame.contentDocument?.querySelector(".call-layout[data-bubbles-variants], .room-shell[data-bubbles-variants]")?.getAttribute("data-bubbles-variants") || "";
    if (!raw || raw === lastMetadata) return;
    try { metadata = JSON.parse(raw); } catch { return; }
    lastMetadata = raw;
    if (applyVariantMetadata(metadata) && variantsBody) drawVariants(variantsBody);
  };
  frame.addEventListener("load", () => {
    metadataObserver?.disconnect();
    lastMetadata = "";
    if (!frame.contentDocument) return;
    metadataObserver = new MutationObserver(syncMetadata);
    metadataObserver.observe(frame.contentDocument, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-bubbles-variants"] });
    syncMetadata();
  });
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
      /** Loads the page again, the world kept: what a ↻ option does, for what the card changes in the world itself. */
      reload() {
        load();
      },
    });
  }

  let snapshot = null;
  try {
    if (keep) snapshot = restorable(sessionStorage.getItem(SNAPSHOT_KEY), scenario().id, location.search);
  } catch {}
  await load({ fresh: true, snapshot });
}

/**
 * The desktop app's floating card beside the room (the Desktop app view only): the web's real card page in its own
 * frame, its host (card-host.mjs) fed from the room frame, sized by what the card reports, shown while the card is
 * wanted. Clicks elsewhere (the shell, the room) close its panels; the pointer over it holds its exit notice; its
 * "Open Sidevoice" focuses the room and flashes its outline.
 */
function floatingCard(roomFrame, device) {
  const aside = document.getElementById("float");
  const cardFrame = /** @type {HTMLIFrameElement | null} */ (document.getElementById("float-frame"));
  const wallpaper = aside?.querySelector(".wallpaper");
  const expanded = /** @type {HTMLInputElement | null} */ (document.getElementById("float-expanded"));
  const stage = document.getElementById("stage");
  if (!aside || !cardFrame) return { host: () => null, show() {}, visible() {} };
  /** The world the card's commands are logged in: the shell's, whichever scenario it is now. */
  let worldNow = () => null;
  const controller = cardHost(() => roomFrame.contentWindow, {
    world: { log: (entry) => worldNow()?.log(entry) },
    alwaysExpanded: () => !!expanded?.checked,
    onLayout({ width, height }) {
      cardFrame.style.width = width + "px";
      cardFrame.style.height = height + "px";
      stage?.style.setProperty("--float-w", width + "px");
    },
    onOpen() {
      roomFrame.focus();
      device.classList.add("flash");
      setTimeout(() => device.classList.remove("flash"), 600);
    },
    onShow(shown) { cardFrame.hidden = !shown; },
  });
  expanded?.addEventListener("change", () => controller.refresh());
  for (const button of aside.querySelectorAll("[data-behind]")) {
    button.addEventListener("click", () => {
      wallpaper?.setAttribute("data-behind", button.getAttribute("data-behind"));
      for (const other of aside.querySelectorAll("[data-behind]")) other.classList.toggle("on", other === button);
    });
  }
  cardFrame.addEventListener("pointerenter", () => controller.hold(true));
  cardFrame.addEventListener("pointerleave", () => controller.hold(false));
  addEventListener("pointerdown", (event) => { if (event.target !== cardFrame) controller.outsideClick(); }, true);
  roomFrame.addEventListener("load", () => roomFrame.contentWindow?.addEventListener("pointerdown", () => controller.outsideClick(), true));
  return {
    host(world) {
      worldNow = world;
      return controller.host;
    },
    /** In the Desktop app view the card's page loads with the room; elsewhere there is no card. */
    show(on) {
      cardFrame.hidden = true;
      cardFrame.src = on ? "/voice/call-controls.html" : "about:blank";
    },
    /** Whether the stage shows it (the stage switch): loaded or not, it is fed all along. */
    visible(on) {
      aside.hidden = !on;
    },
  };
}

if (typeof document !== "undefined") main();
