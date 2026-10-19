// The call card's formats, as data: what a user setting would pick from if more than one is kept (format, size,
// corner, controls). The page (callcard.mjs) draws each from these and nothing else, so a format, a size or a corner
// is one entry here.

/** The families the exploration compares: a titled card like today's, a picture-in-picture of the call, the creature
 *  itself. */
export const FAMILIES = {
  card: "Titled card",
  pip: "Picture-in-picture",
  mascot: "The creature itself",
};

/** Each format: its family, its name, one line on it, its sizes (s, m, l: the card's box in CSS pixels, without the
 *  window's shadow margin), and whether its controls show by default or only near the pointer. */
export const FORMATS = [
  { id: "today", family: "card", label: "Today (reference)", blurb: "The current card, 320px, for comparison: brand mark, title, your wave; controls near the pointer.",
    sizes: { s: { w: 320 }, m: { w: 320 }, l: { w: 320 } }, controls: "hover" },
  { id: "card", family: "card", label: "A1 · Titled card", blurb: "Today's card grown up: the creature replaces the brand mark, the state is a word, the controls always there.",
    sizes: { s: { w: 340 }, m: { w: 390 }, l: { w: 450 } }, controls: "always" },
  { id: "card-caption", family: "card", label: "A2 · Card with caption", blurb: "A1 plus what is happening in words: the reply as it sounds, what the agent works on, what it hears.",
    sizes: { s: { w: 360 }, m: { w: 420 }, l: { w: 480 } }, controls: "always" },
  { id: "pip", family: "pip", label: "B1 · Picture-in-picture 16:9", blurb: "The call's stage, as in the room: backdrop, the creature, its desk while working, subtitles; controls over it.",
    sizes: { s: { w: 320, h: 180 }, m: { w: 400, h: 225 }, l: { w: 512, h: 288 } }, controls: "hover" },
  { id: "pip-tall", family: "pip", label: "B2 · Picture-in-picture, portrait", blurb: "The same stage standing up, like a phone's call: takes a narrow strip of the screen.",
    sizes: { s: { w: 200, h: 260 }, m: { w: 240, h: 320 }, l: { w: 288, h: 384 } }, controls: "hover" },
  { id: "mascot", family: "mascot", label: "C1 · Mascot", blurb: "Only the creature, floating on the desktop; a speech bubble while it speaks; controls under its feet near the pointer.",
    sizes: { s: { w: 120 }, m: { w: 160 }, l: { w: 220 } }, controls: "hover" },
  { id: "mascot-perch", family: "mascot", label: "C2 · Mascot on a bar", blurb: "The creature sitting on a slim control bar with the title: a mascot that still says where the call is.",
    sizes: { s: { w: 110 }, m: { w: 140 }, l: { w: 180 } }, controls: "always" },
];

export const SIZES = { s: "Small", m: "Medium", l: "Large" };

/** Where the card sits, in the screen's work area (clear of the taskbar, the dock, the menu bar). */
export const CORNERS = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" };

/** The gap between the card and the work area's edges, in CSS pixels. */
export const CORNER_GAP = 16;

/** The call's states the card shows. `mood` is what the creature acts out (the app's avatar moods). */
export const STATES = {
  listening: { label: "Listening", line: "Listening to you", mood: "listening" },
  speaking: { label: "Speaking", line: "Speaking", mood: "speaking" },
  working: { label: "Agent working", line: "Working", mood: "working" },
  muted: { label: "Muted", line: "Muted", mood: "idle" },
  idle: { label: "Your turn", line: "Your turn", mood: "idle" },
};

/** One format's settings, filled with its defaults: what a user setting would store. */
export function cardSettings({ format = "card", size = "m", corner = "br", controls } = {}) {
  const spec = FORMATS.find((each) => each.id === format) ?? FORMATS[1];
  return { format: spec.id, size: SIZES[size] ? size : "m", corner: CORNERS[corner] ? corner : "br", controls: controls ?? spec.controls };
}
