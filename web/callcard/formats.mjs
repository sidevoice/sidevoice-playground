// The call card's formats, its settings and where it sits, as data: what the settings screen offers (format, size,
// captions), what the app remembers (its place on each screen), and the words for both. The page (callcard.mjs) draws
// the card and the settings mock from these and nothing else.

/** The three formats the operator kept (2026-10-19). Sizes are the card's own box in CSS pixels, without the window's
 *  shadow margin: a card's width, a picture's width and height, the avatar's square. */
export const FORMATS = [
  { id: "card", label: "A1 · Title card", sizes: { m: { w: 390 }, l: { w: 450 } },
    blurb: "Today's card grown up: the avatar in place of the brand mark, the conversation, its machine and its state; today's controls near the pointer." },
  { id: "pip", label: "B1 · Picture in picture", sizes: { m: { w: 400, h: 225 }, l: { w: 512, h: 288 } },
    blurb: "The room's stage, small: the same screen, its balloons included; today's controls over it near the pointer." },
  { id: "mascot", label: "C1 · Just the avatar", sizes: { m: { w: 160 }, l: { w: 220 } },
    blurb: "Only the avatar, floating on the desktop, on nothing; today's controls under it near the pointer." },
];

export const SIZES = { m: "Medium", l: "Large" };

/** Where a title card's captions go: beside it, as the avatar's balloons (the default), or inside it. */
export const CAPTION_PLACES = { beside: "Beside the card", inside: "Inside the card" };

/** The settings, as the desktop app would store them, and their defaults. `alwaysShown` and `places` exist today
 *  (sidevoice-desktop: the "Always show the call controls" switch, and the card's place per display); the rest are new. */
export const SETTING_DEFAULTS = { format: "card", size: "l", captions: true, captionPlace: "beside", alwaysShown: false, place: null };

/** One card's settings, filled from the defaults; unknown values fall back. */
export function cardSettings(stored = {}) {
  const s = { ...SETTING_DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined)) };
  return {
    format: FORMATS.some((each) => each.id === s.format) ? s.format : SETTING_DEFAULTS.format,
    size: SIZES[s.size] ? s.size : SETTING_DEFAULTS.size,
    captions: !!s.captions,
    captionPlace: CAPTION_PLACES[s.captionPlace] ? s.captionPlace : SETTING_DEFAULTS.captionPlace,
    alwaysShown: !!s.alwaysShown,
    place: s.place && Number.isFinite(s.place.x) && Number.isFinite(s.place.y) ? s.place : null,
  };
}

/** The settings section's words: English, and Spanish as sidevoice-web's catalogue writes it (keys in its style; not in
 *  the catalogue yet). `existing` marks a key the catalogue already has. */
export const COPY = {
  "settings.section.call": { en: "Call", es: "Llamada", existing: true },
  "settings.call.description": { en: "How a call behaves: when your turn ends, the sound while the agent works, and the screen.", es: "Cómo se comporta una llamada: cuándo acaba tu turno, el sonido mientras el agente trabaja y la pantalla.", existing: true },
  "settings.callCard.title": { en: "Floating call card", es: "Tarjeta flotante" },
  "settings.callCard.hint": { en: "What Sidevoice shows over your other apps during a call.", es: "Lo que Sidevoice muestra sobre tus otras aplicaciones durante una llamada." },
  "settings.desktop.alwaysShown": { en: "Always show the call controls", es: "Mostrar siempre los controles de llamada", existing: true },
  "settings.desktop.alwaysShownHint": { en: "Off: they show only while the Sidevoice window is minimised during a call.", es: "Desactivado: solo se ven mientras la ventana de Sidevoice está minimizada durante una llamada.", existing: true },
  "settings.callCard.format": { en: "Style", es: "Estilo" },
  "settings.callCard.format.card": { en: "Card", es: "Tarjeta" },
  "settings.callCard.format.cardHint": { en: "The conversation, its state and the controls.", es: "La conversación, su estado y los controles." },
  "settings.callCard.format.pip": { en: "Picture in picture", es: "Imagen en imagen" },
  "settings.callCard.format.pipHint": { en: "The call's stage, small.", es: "La escena de la llamada, en pequeño." },
  "settings.callCard.format.mascot": { en: "Just the avatar", es: "Solo el avatar" },
  "settings.callCard.format.mascotHint": { en: "It floats on your desktop.", es: "Flota sobre tu escritorio." },
  "settings.callCard.size": { en: "Size", es: "Tamaño" },
  "settings.callCard.size.m": { en: "Medium", es: "Mediano" },
  "settings.callCard.size.l": { en: "Large", es: "Grande" },
  "settings.callCard.captions": { en: "Show captions", es: "Mostrar subtítulos" },
  "settings.callCard.captionsHint": { en: "What the agent says and what it hears, in speech bubbles. The card's own button turns them on and off.", es: "Lo que dice el agente y lo que te oye, en bocadillos. El botón de la tarjeta los activa y desactiva." },
  "settings.callCard.captionPlace": { en: "Captions on the card", es: "Subtítulos en la tarjeta" },
  "settings.callCard.captionPlace.beside": { en: "Beside it", es: "Al lado" },
  "settings.callCard.captionPlace.inside": { en: "Inside it", es: "Dentro" },
  "settings.callCard.position": { en: "Position", es: "Posición" },
  "settings.callCard.positionHint": { en: "Drag it anywhere. It stays where you leave it on each screen.", es: "Arrástrala a donde quieras. Se queda donde la dejes en cada pantalla." },
  "settings.callCard.positionReset": { en: "Reset position", es: "Restablecer posición" },
  "card.captions.show": { en: "Show captions", es: "Mostrar subtítulos" },
  "card.captions.hide": { en: "Hide captions", es: "Ocultar subtítulos" },
};

/** Where the card goes, as the desktop app places it today (sidevoice-desktop core/src/call_controls.rs): its window
 *  (the card plus `margin` for its shadow) anywhere in the work area (the screen clear of the taskbar, the dock, the
 *  menu bar), first at the top right; dropped within `magnet` of an edge, against it. */
export const PLACEMENT = { margin: 12, magnet: 56 };

/** Where a card never placed goes: the work area's top-right corner. `work` and `size` are { width, height }. */
export function firstPlace(work, size) {
  return { x: work.width - size.width, y: 0 };
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

/** The call's states the card shows. `mood` is what the avatar acts out (the room's stage moods). */
export const STATES = {
  listening: { label: "Listening", line: "Listening to you", mood: "listening" },
  speaking: { label: "Speaking", line: "Speaking", mood: "speaking" },
  working: { label: "Agent working", line: "Working", mood: "working" },
  muted: { label: "Muted", line: "Muted", mood: "idle" },
  idle: { label: "Your turn", line: "Your turn", mood: "idle" },
};
