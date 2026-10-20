// The call card's formats, its settings and where it sits, as data: what the settings screen offers (format, size,
// captions), what the app remembers (its place on each screen), and the words for both. The page (callcard.mjs) draws
// the card and the settings mock from these and nothing else.

/** The three formats the operator kept (2026-10-19). Sizes are the card's own box in CSS pixels, without the window's
 *  shadow margin: a card's width, a picture's width and height, the avatar's square. */
export const FORMATS = [
  { id: "card", label: "A1 · Title card", sizes: { s: { w: 340 }, m: { w: 390 }, l: { w: 450 } },
    blurb: "Today's card grown up: the avatar in place of the brand mark, the conversation, its machine and its state; today's controls near the pointer. Captions as plain lines, above or below it." },
  { id: "pip", label: "B1 · Picture in picture", sizes: { s: { w: 350, h: 197 }, m: { w: 420, h: 236 }, l: { w: 560, h: 315 } },
    blurb: "The room's 16:9 stage itself, small, with nothing changed; a button at its top right goes back to the call; today's controls over it near the pointer." },
  { id: "mascot", label: "C1 · Just the avatar", sizes: { s: { w: 120 }, m: { w: 160 }, l: { w: 220 } },
    blurb: "Only the avatar, floating on the desktop, on nothing; today's controls under it near the pointer. Its balloons open above or below it, never sideways." },
];
/** The starting sizes. Small is back now that a card lays itself out again at any width (2026-10-19); a card resized by
 *  hand is "Custom" until a size is picked again. */
export const SIZES = { s: "Small", m: "Medium", l: "Large" };

/** The settings, as the desktop app would store them, and their defaults. `alwaysShown` and `place` (per display)
 *  exist today (sidevoice-desktop: the "Always show the call controls" switch, and the card's place); `format` and
 *  `size` are new, set in Settings; `captions` is new too, but only the card's own button sets it (on by default; the
 *  room's call view gets the same toggle later), never Settings. The default format is B1, the picture (operator,
 *  2026-10-20; it was A1 before). */
export const SETTING_DEFAULTS = { enabled: true, format: "pip", size: "m", captions: true, alwaysShown: false, place: null };

/** One card's settings, filled from the defaults; unknown values fall back. */
export function cardSettings(stored = {}) {
  const s = { ...SETTING_DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined)) };
  return {
    // The card itself, on or off (Settings' first switch, operator 2026-10-20): off, no card shows during a call.
    enabled: s.enabled !== false,
    format: FORMATS.some((each) => each.id === s.format) ? s.format : SETTING_DEFAULTS.format,
    size: SIZES[s.size] ? s.size : SETTING_DEFAULTS.size,
    captions: !!s.captions,
    alwaysShown: !!s.alwaysShown,
    place: s.place && Number.isFinite(s.place.x) && Number.isFinite(s.place.y) ? s.place : null,
  };
}

/** The settings section's words: English, and Spanish as sidevoice-web's catalogue writes it (keys in its style; not in
 *  the catalogue yet). `existing` marks a key the catalogue already has. */
export const COPY = {
  "settings.desktop.alwaysShown": { en: "Always show the call controls", es: "Mostrar siempre los controles de llamada", existing: true },
  // The same setting the desktop app has (it is the card's alwaysExpanded too); its line says both of what it does now.
  "settings.desktop.alwaysShownHint": { en: "Off: they show only while the Sidevoice window is minimised during a call.", es: "Desactivado: solo se ven mientras la ventana de Sidevoice está minimizada durante una llamada.", existing: true },
  // The section's first row: the card on or off; its line says what each does (as Call's presence row does).
  "settings.callCard.enabled": { en: "Show the floating card", es: "Mostrar la tarjeta flotante" },
  "settings.callCard.enabledOnHint": { en: "During a call, over your other apps.", es: "Durante una llamada, sobre tus otras aplicaciones." },
  "settings.callCard.enabledOffHint": { en: "No card during calls: the call's controls stay in Sidevoice and its tray icon. Turn it on to choose how it looks.", es: "Sin tarjeta durante las llamadas: los controles de la llamada siguen en Sidevoice y en su icono de la bandeja. Actívala para elegir cómo se ve." },

  // Settings → Floating card, the app's own words (sidevoice-web i18n/locales en.ts and es.ts, main 6a2230f).
  "settings.section.floatingCard": { en: "Floating card", es: "Tarjeta flotante", existing: true },
  "settings.floatingCard.description": { en: "What Sidevoice shows over your other apps during a call.", es: "Lo que Sidevoice muestra sobre tus otras aplicaciones durante una llamada.", existing: true },
  "settings.floatingCard.style": { en: "Style", es: "Estilo", existing: true },
  "settings.floatingCard.format.card": { en: "Card", es: "Tarjeta", existing: true },
  "settings.floatingCard.format.cardHint": { en: "The conversation, its state and the controls.", es: "La conversación, su estado y los controles.", existing: true },
  "settings.floatingCard.format.pip": { en: "Picture in picture", es: "Imagen en imagen", existing: true },
  "settings.floatingCard.format.pipHint": { en: "The call's stage, small.", es: "La escena de la llamada, en pequeño.", existing: true },
  "settings.floatingCard.format.avatar": { en: "Just the avatar", es: "Solo el avatar", existing: true },
  "settings.floatingCard.format.avatarHint": { en: "It floats on your desktop.", es: "Flota sobre tu escritorio.", existing: true },
  // Renamed (operator, 2026-10-20): "Starting size" → "Size"; "Default position" → "Preferred position" (the web's catalogue to follow).
  "settings.floatingCard.size": { en: "Size", es: "Tamaño" },
  "settings.floatingCard.size.s": { en: "Small", es: "Pequeño", existing: true },
  "settings.floatingCard.size.m": { en: "Medium", es: "Mediano", existing: true },
  "settings.floatingCard.size.l": { en: "Large", es: "Grande", existing: true },
  "settings.floatingCard.sizeHint": { en: "Or resize the picture by its corner: it keeps the size you leave it at.", es: "O cambia el tamaño de la imagen desde su esquina: se queda como la dejes.", existing: true },
  "settings.floatingCard.corner": { en: "Preferred position", es: "Posición preferida" },
  "settings.floatingCard.cornerHint": { en: "Pick a corner to send the card there. Drag it anywhere and it stays where you leave it, until you pick a corner again or reset.", es: "Elige una esquina para llevar la tarjeta allí. Arrástrala a donde quieras y se queda donde la dejes, hasta que elijas una esquina o la restablezcas." },
  "settings.floatingCard.corner.tl": { en: "Top left", es: "Arriba a la izquierda", existing: true },
  "settings.floatingCard.corner.tr": { en: "Top right", es: "Arriba a la derecha", existing: true },
  "settings.floatingCard.corner.bl": { en: "Bottom left", es: "Abajo a la izquierda", existing: true },
  "settings.floatingCard.corner.br": { en: "Bottom right", es: "Abajo a la derecha", existing: true },
  "settings.floatingCard.reset": { en: "Reset size and position", es: "Restablecer tamaño y posición", existing: true },

  "card.you": { en: "You", es: "Tú" },
  // The room's own (sidevoice-web stage.cancelTurn).
  "stage.cancelTurn": { en: "Cancel sending", es: "Cancelar envío" },
  "card.captions.show": { en: "Show captions", es: "Mostrar subtítulos" },
  "card.captions.hide": { en: "Hide captions", es: "Ocultar subtítulos" },
};

/** Where the card goes, as the desktop app places it today (sidevoice-desktop core/src/call_controls.rs): its window
 *  (the card plus `margin` for its shadow) anywhere in the work area (the screen clear of the taskbar, the dock, the
 *  menu bar), first at the top right; dropped within `magnet` of an edge, against it. */
export const PLACEMENT = { margin: 12, magnet: 56 };

/** Where a card never placed goes: the corner Settings' Default position names (top right unless set). `work` and `size`
 *  are { width, height }. After that it stays where it is dragged. */
export function firstPlace(work, size, corner = "tr") {
  return { x: corner.endsWith("r") ? work.width - size.width : 0, y: corner.startsWith("b") ? work.height - size.height : 0 };
}

/** Where the card lands when dropped at `at`: inside the work area, and against an edge or a corner when dropped within
 *  the magnet of it; otherwise exactly where it was dropped (call_controls.rs `drop_at`). */
export function dropAt(at, size, work) {
  const maxX = Math.max(0, work.width - size.width), maxY = Math.max(0, work.height - size.height);
  const snap = (v, hi) => (v < PLACEMENT.magnet ? 0 : hi - v < PLACEMENT.magnet ? hi : v);
  return { x: snap(Math.min(Math.max(at.x, 0), maxX), maxX), y: snap(Math.min(Math.max(at.y, 0), maxY), maxY) };
}

/** Where the card shows while it is `size` (grown with its controls): at its place when it fits there, else moved in
 *  just enough to fit; the place itself does not change (call_controls.rs `fit`). */
export function fit(place, size, work) {
  return { x: Math.max(0, Math.min(place.x, work.width - size.width)), y: Math.max(0, Math.min(place.y, work.height - size.height)) };
}

/** Which way a card's captions open from it: below it in the upper half of the screen, above it in the lower half
 *  (sideways room is the scarcest); never configurable. The card itself stays where it was put. */
export const opensDown = (place, size, work) => place.y + size.height / 2 < work.height / 2;

/** The call's states the card shows. `mood` is what the avatar acts out (the room's stage moods). */
export const STATES = {
  listening: { label: "Listening", line: "Listening to you", mood: "listening" },
  // The person's turn held while it is recorded (a mock: the cancel button stays up to be seen).
  recording: { label: "Your turn, recording", line: "Listening to you", mood: "listening" },
  speaking: { label: "Speaking", line: "Speaking", mood: "speaking" },
  working: { label: "Agent working", line: "Working", mood: "working" },
  muted: { label: "Muted", line: "Muted", mood: "idle" },
  idle: { label: "Your turn", line: "Your turn", mood: "idle" },
};
