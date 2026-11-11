// The mocked preview's shell: the real web in a frame sized by the view (browser, the desktop app's window, a
// phone), the world its mocks answer from, and the card that picks the scenario and its options. Everything the
// card picks is in this page's address, so a link opens the same screen. A scenario, a view, a language or an
// option marked ↻ loads the page again, from the storage the world says it had; any other option is live. While
// "Keep state on reload" is on, a reload of this page restores the world and leaves the page's storage as
// it was, and a view, a language or a ↻ option changes only what the world owns of it (`mergeSeed`).

import { createWorld, changedCount } from "./world.mjs";
import { LOCAL_ID, loadIdentities, makeIdentities, saveIdentities, seededStorage } from "./machines.mjs";
import { attach, mockModule } from "./attach.mjs";
import { cardHost } from "./card-host.mjs";

// The design alternatives the web offers to compare (VARIANTS), and the panel that picks them (drawVariants). The page reads what is picked from
// localStorage `sidevoice.variants` (`{ name: value }`; sidevoice-web src/lib/variants.ts), the same origin as this
// shell, and follows it live; a variant the page no longer has is simply never read. Each entry names the page's
// variant and its values, the first being the page's default.
const VARIANTS_KEY = "sidevoice.variants";

/** @type {{ name: string, label: string, note: string, sheet?: string, values: { value: string, label: string }[] }[]} */
export const VARIANTS = [
  { name: "serviceRow", label: "V · Service card: version, port and state", note: "Settings > This device and each remote machine's page (scenario Service version rows; the top bar there picks all of this). The same Servicio de Sidevoice card on both. Mockup for sidevoice-desktop#67.", values: [
    { value: "v1", label: "V1 · muted line under the title (v0.19.2 · Al día); the port a row of its own" },
    { value: "v2", label: "V2 · key/value rows: Versión 0.19.2 · Al día, Puerto 10829" },
    { value: "v3", label: "V3 · version and state as small tags by the title; Escucha en el puerto 10829" },
    { value: "v4", label: "V4 · three facts side by side, each under its name: Versión, Puerto, Estado" },
  ] },
  { name: "remoteOffline", label: "B · Remote machine not answering", note: "Scenario Service version rows, the machine not answering. B1: only Sin conexión. B2: Sin conexión and the last version seen. Mockup for sidevoice-desktop#67.", values: [
    { value: "b1", label: "B1 · Sin conexión, nothing else" },
    { value: "b2", label: "B2 · Sin conexión + Última versión vista" },
  ] },
  { name: "pairingScan", label: "Pairing: scanning the QR code", note: "Where Scan sits on the pairing screen of the mobile app, and how the viewfinder looks. Shown in the phone view (its mock camera: a scan lasts until Cancel). sidevoice-web#466.", values: [
    { value: "current", label: "Today's · button under the field, plain frame" },
    { value: "inField", label: "A · camera inside the code field" },
    { value: "twoWays", label: "B · Scan and Type the code, two equal tiles" },
    { value: "scanFirst", label: "C · scan first: the viewfinder in the card" },
    { value: "labelRow", label: "D · Scan pill in the field's label row" },
  ] },
  { name: "duckLevel", label: "Other apps' media: the level it is lowered to", sheet: "/duck-level", note: "Settings > Call, row \"Other apps' media\": Lower, default 25 %, is the only mode with a level; the control goes with Pause and Do nothing. The web has no such control yet: the design sheet draws the row in Spanish, light and dark, and follows this pick. sidevoice-web#468.", values: [
    { value: "presets", label: "A · 3 presets: Un poco 50 % · Mucho 25 % (default) · Silenciar 0 %" },
    { value: "slider", label: "B · slider 0–100 % with its value, default 25 %" },
    { value: "windows", label: "C · Windows-style: Silenciar · 80 % · 50 % · Nada (reductions)" },
  ] },
];

/** What is kept of `choices`: only a value a variant still offers. */
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
function drawVariants(body, { forceVoiceError } = {}) {
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
    if (variant.sheet) {
      const link = document.createElement("a");
      link.className = "variant-sheet";
      link.href = variant.sheet;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Open the design sheet";
      group.append(link);
    }
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
  if (forceVoiceError) {
    const force = document.createElement("button");
    force.type = "button";
    force.id = "force-voice-error";
    force.textContent = "Force a voice error";
    force.title = "The active call's voice reports a failure (join a call first)";
    force.addEventListener("click", forceVoiceError);
    body.append(force);
  }
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
/** The least the desktop app's window can be dragged to, in CSS px (its page; the title bar comes on top). */
export const APP_MIN = { width: 480, height: 420 };
/** The phone's frame, and the desktop app's title bar. */
const PHONE = { width: 390, height: 844 };
const PHONE_FRAME = 20; // the shell's 10px border on each side sits outside the page's viewport
const APP_CHROME = 30;

/**
 * Where the page's frame goes in a slot of `width` × `height`, for `view`: its size (what the page lays out at), the
 * scale it is drawn at, and its offset. The browser fills the slot, at a desktop's size at least; the desktop app is a
 * window of a desktop's size (or `app`, the size the person dragged it to) and its title bar; both are scaled down to
 * fit, never up. The phone is its own size.
 */
export function deviceBox({ width, height }, view, app = DESKTOP) {
  let w, h, scale;
  if (view === "phone") {
    w = PHONE.width;
    h = Math.min(PHONE.height, Math.max(1, height - PHONE_FRAME));
    scale = 1;
  } else if (view === "app") {
    w = app.width;
    h = app.height + APP_CHROME;
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

/** Live Cursor choices refresh the already mounted agent card through the web's normal listing action. */
export function chooseMockOption(world, id, value, frame, identities) {
  const reload = world.choose(id, value);
  if (id === "cursorBridge" && !reload) {
    const page = frame?.contentWindow;
    const fp = identities?.[LOCAL_ID]?.fingerprint;
    if (fp && page?.sidevoiceUI?.store && typeof page.sidevoiceActions?.loadHostAgents === "function") {
      void Promise.resolve(page.sidevoiceActions.loadHostAgents(fp, { rescan: true })).catch(() => {});
    }
  }
  return reload;
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
  // The desktop app's window, resizable from its corner as a real window is; its size kept on this browser.
  const APP_SIZE = "sidevoice-preview.appSize";
  let appSize = (() => { try { const kept = JSON.parse(localStorage.getItem(APP_SIZE) ?? "null"); return kept?.width && kept?.height ? kept : DESKTOP; } catch { return DESKTOP; } })();
  const firstValues = () => Object.fromEntries(scenario().options.map((o) => [o.id, o.values[0].value]));
  const view = () => params.view ?? scenario().view ?? "browser";
  // The address is what a snapshot is for: it is taken again whenever the address changes.
  const remember = () => {
    history.replaceState(null, "", location.pathname + writeParams({ ...params, scenario: scenario().id, options: world.choices }, firstValues()));
    save();
  };

  window.__sidevoicePreview = {
    attach: (win) => attach(win, { world, identities, desktop: view() === "app", phone: view() === "phone", onKey: shortcut, card: () => float.host(() => world) }),
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
    const at = deviceBox(box, view(), appSize);
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
  // Dragging the window's corner resizes it (at the scale it is drawn at); a double click puts it back to a desktop's size.
  const handle = document.getElementById("resize");
  if (handle) {
    let from = null;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const scale = device.getBoundingClientRect().width / (appSize.width || 1);
      from = { x: event.clientX, y: event.clientY, size: appSize, scale: scale || 1 };
    });
    handle.addEventListener("pointermove", (event) => {
      if (!from) return;
      appSize = { width: Math.max(APP_MIN.width, Math.round(from.size.width + (event.clientX - from.x) / from.scale)),
        height: Math.max(APP_MIN.height, Math.round(from.size.height + (event.clientY - from.y) / from.scale)) };
      place();
    });
    const end = () => { if (!from) return; from = null; try { localStorage.setItem(APP_SIZE, JSON.stringify(appSize)); } catch {} };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("dblclick", () => { appSize = DESKTOP; try { localStorage.removeItem(APP_SIZE); } catch {} place(); });
  }
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
  if (variantsBody) drawVariants(variantsBody, { forceVoiceError: () => { for (const fail of [...(world?.voiceFailers ?? [])]) fail(); } });
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

  // MOCKUP (sidevoice-desktop#67): in the Service version rows scenario, a visible bar at the top picks what the page shows,
  // one click each, instantly: the device (a phone's 390 or a desktop's 1280), the section of Settings, the design (the
  // serviceRow / remoteVersion variants) and the state (the scenario's serviceState option, or which remote machine).
  if (scenario().id === "service-version") serviceBar();
  function serviceBar() {
    const KEY = "sidevoice-preview.svcbar";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const DEVICES = [["phone", "Teléfono"], ["desktop", "Escritorio"]];
    const SECTIONS = [["device", "Este dispositivo"], ["remote", "Máquinas remotas"]];
    const LAYOUTS = [["v1", "V1"], ["v2", "V2"], ["v3", "V3"], ["v4", "V4"]];
    const CONN = [["b1", "B1 · Sin conexión"], ["b2", "B2 · Sin conexión + última versión"]];
    const STATES = { device: [["current", "Al día"], ["updating", "Actualizando…"], ["waiting", "Esperando llamada"], ["newer", "Más nueva"]] };
    const NOTE = { remote: "En la lista de Máquinas remotas, una por estado: Mac mini al día (0.19.2) · daimon desactualizada (0.16.0) · NUC más nueva (0.20.0) · Portátil viejo sin conexión.",
      current: "Este dispositivo · 0.19.2, al día", updating: "Este dispositivo · 0.19.0 actualizando a 0.19.2", waiting: "Este dispositivo · 0.19.0, 0.19.2 espera a que termine la llamada", newer: "Este dispositivo · 0.20.0 instalada a mano (la app usa 0.19.x)" };
    let pick = { device: "desktop", section: "device", layout: "v1", conn: "b1", state: "current" };
    try { pick = { ...pick, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch {}
    if (!LAYOUTS.some(([value]) => value === pick.layout)) pick.layout = "v1";
    if (!CONN.some(([value]) => value === pick.conn)) pick.conn = "b1";
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch {} };
    const bar = document.createElement("header");
    bar.id = "svcbar";
    document.body.classList.add("svc-bar");
    document.body.prepend(bar);
    const group = (label, items, current, on) => {
      const g = document.createElement("div");
      g.className = "svc-group";
      const l = document.createElement("span");
      l.className = "svc-label";
      l.textContent = label;
      const seg = document.createElement("div");
      seg.className = "svc-seg";
      seg.setAttribute("role", "group");
      seg.setAttribute("aria-label", label);
      for (const [value, text] of items) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-pressed", String(value === current));
        b.addEventListener("click", () => on(value));
        seg.append(b);
      }
      g.append(l, seg);
      return g;
    };
    const writeVariants = () => {
      try {
        const kept = JSON.parse(localStorage.getItem(VARIANTS_KEY) || "{}") ?? {};
        localStorage.setItem(VARIANTS_KEY, JSON.stringify({ ...kept, serviceRow: pick.layout, remoteOffline: pick.conn }));
      } catch {}
    };
    let navigation = 0;
    async function navigate() {
      const mine = ++navigation;
      for (let i = 0; i < 200 && mine === navigation; i++) {
        const win = frame.contentWindow;
        let ready = false;
        try { ready = !!win?.location?.pathname?.startsWith("/voice") && !!win.sidevoiceUI?.store && !!win.document.getElementById("settings-open"); } catch {}
        if (ready) break;
        await sleep(100);
      }
      if (mine !== navigation) return;
      const win = frame.contentWindow;
      const doc = win.document;
      const store = win.sidevoiceUI.store;
      // The runtime wires the gear a moment after it is drawn: press it until Settings is open.
      for (let i = 0; i < 40 && mine === navigation && !doc.querySelector("dialog[open]"); i++) { doc.getElementById("settings-open")?.click(); await sleep(400); }
      if (mine !== navigation) return;
      await sleep(250);
      if (pick.section === "device") { store.patch({ settingsSection: "this-computer", settingsLevel: "page" }); return; }
      // The list of machines: the first one's page on a desktop, the list itself on a phone.
      store.patch({ settingsSection: "machines", settingsLevel: "page", machinesView: { machine: null } });
    }
    function draw() {
      const device = pick.section === "device";
      bar.replaceChildren(
        group("Dispositivo", DEVICES, pick.device, (value) => { pick.device = value; save(); setSize(); draw(); void sleep(700).then(navigate); }),
        group("Sección", SECTIONS, pick.section, (value) => { pick.section = value; save(); draw(); void navigate(); }),
        group("Opción", LAYOUTS, pick.layout, (value) => { pick.layout = value; save(); writeVariants(); draw(); }),
        ...(device ? [group("Estado", STATES.device, pick.state, (value) => { pick.state = value; save(); chooseMockOption(world, "serviceState", value, frame, identities); draw(); })]
          : [group("Portátil viejo (sin conexión)", CONN, pick.conn, (value) => { pick.conn = value; save(); writeVariants(); draw(); })]),
      );
      const note = document.createElement("p");
      note.className = "svc-note";
      note.textContent = NOTE[device ? pick.state : "remote"] ?? "";
      bar.append(note);
    }
    function setSize() { appSize = pick.device === "phone" ? { width: 390, height: 844 } : DESKTOP; place(); }
    writeVariants();
    setSize();
    draw();
    // The page loads (again) after a scenario or a ↻ option: land on the section picked, in the state picked.
    frame.addEventListener("load", () => {
      try { if (frame.contentWindow.location.pathname.startsWith("/voice")) { if (world) chooseMockOption(world, "serviceState", pick.state, frame, identities); void navigate(); } } catch {}
    });
    if (frame.contentWindow?.location?.pathname?.startsWith("/voice")) { chooseMockOption(world, "serviceState", pick.state, frame, identities); void navigate(); }
  }

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
        const reload = chooseMockOption(world, id, value, frame, identities);
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
