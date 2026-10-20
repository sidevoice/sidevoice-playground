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
export const SETTING_DEFAULTS = { format: "pip", size: "m", captions: true, alwaysShown: false, place: null };

/** One card's settings, filled from the defaults; unknown values fall back. */
export function cardSettings(stored = {}) {
  const s = { ...SETTING_DEFAULTS, ...Object.fromEntries(Object.entries(stored).filter(([, value]) => value !== undefined)) };
  return {
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
  "settings.section.call": { en: "Call", es: "Llamada", existing: true },
  "settings.call.description": { en: "How a call behaves: when your turn ends, the sound while the agent works, and the screen.", es: "Cómo se comporta una llamada: cuándo acaba tu turno, el sonido mientras el agente trabaja y la pantalla.", existing: true },
  "settings.callCard.title": { en: "Floating call card", es: "Tarjeta flotante" },
  "settings.callCard.hint": { en: "What Sidevoice shows over your other apps during a call.", es: "Lo que Sidevoice muestra sobre tus otras aplicaciones durante una llamada." },
  "settings.desktop.alwaysShown": { en: "Always show the call controls", es: "Mostrar siempre los controles de llamada", existing: true },
  // The same setting the desktop app has (it is the card's alwaysExpanded too); its line says both of what it does now.
  "settings.desktop.alwaysShownHint": { en: "On: the card keeps its controls out, and stays with Sidevoice in front. Off: the controls show near the pointer, and the card only while Sidevoice is minimised.", es: "Activado: la tarjeta deja sus controles a la vista y sigue aunque Sidevoice esté delante. Desactivado: los controles salen al acercar el puntero, y la tarjeta solo con Sidevoice minimizada." },
  "settings.callCard.format": { en: "Style", es: "Estilo" },
  "settings.callCard.format.card": { en: "Card", es: "Tarjeta" },
  "settings.callCard.format.cardHint": { en: "The conversation, its state and the controls.", es: "La conversación, su estado y los controles." },
  "settings.callCard.format.pip": { en: "Picture in picture", es: "Imagen en imagen" },
  "settings.callCard.format.pipHint": { en: "The call's stage, small.", es: "La escena de la llamada, en pequeño." },
  "settings.callCard.format.mascot": { en: "Just the avatar", es: "Solo el avatar" },
  "settings.callCard.format.mascotHint": { en: "It floats on your desktop.", es: "Flota sobre tu escritorio." },
  "settings.callCard.size": { en: "Size", es: "Tamaño" },
  "settings.callCard.size.s": { en: "Small", es: "Pequeño" },
  "settings.callCard.size.m": { en: "Medium", es: "Mediano" },
  "settings.callCard.size.custom": { en: "Custom", es: "Personalizado" },
  "settings.callCard.size.l": { en: "Large", es: "Grande" },
  "settings.callCard.previewNote": { en: "Shown for a moment on your screen.", es: "Se muestra un momento en tu pantalla." },

  "card.you": { en: "You", es: "Tú" },
  // The room's own (sidevoice-web stage.cancelTurn).
  "stage.cancelTurn": { en: "Cancel sending", es: "Cancelar envío" },
  "settings.callCard.startCorner": { en: "Default position", es: "Posición inicial" },
  "settings.callCard.startCornerHint": { en: "Where the card first appears. After that, drag it anywhere: it stays where you leave it on each screen.", es: "Dónde aparece la tarjeta la primera vez. Luego arrástrala a donde quieras: se queda donde la dejes en cada pantalla." },
  "settings.callCard.corner.tl": { en: "Top left", es: "Arriba a la izquierda" },
  "settings.callCard.corner.tr": { en: "Top right", es: "Arriba a la derecha" },
  "settings.callCard.corner.bl": { en: "Bottom left", es: "Abajo a la izquierda" },
  "settings.callCard.corner.br": { en: "Bottom right", es: "Abajo a la derecha" },
  "settings.callCard.position": { en: "Position", es: "Posición" },
  "settings.callCard.positionHint": { en: "Drag it anywhere. It stays where you leave it on each screen.", es: "Arrástrala a donde quieras. Se queda donde la dejes en cada pantalla." },
  "settings.callCard.sizeTitle": { en: "Starting size", es: "Tamaño inicial" },
  "settings.callCard.positionReset": { en: "Reset size and position", es: "Restablecer tamaño y posición" },
  "settings.callCard.sizeHint": { en: "Or resize it by an edge or a corner: it keeps the size you leave it at.", es: "O cambia su tamaño desde un borde o una esquina: se queda como la dejes." },
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
