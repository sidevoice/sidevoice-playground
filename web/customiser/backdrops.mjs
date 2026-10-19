// Colour backdrops for the stage, beside the engine's own (backdrop.ts): a flat colour, a vertical fade and a two-tone
// diagonal, painted in the scene's tint. The engine's "tone" backdrop (its colour) takes the tint too. These three are
// this exploration's: kept, they would move into the engine's backdrop catalogue, where the app draws backdrops.
import { backdropSvg } from "./bichos.mjs";
import { hslToRgb, rgbToHex } from "./colour.mjs";

const hex = (c) => rgbToHex(hslToRgb(c));
const shade = (c, dl) => hex({ ...c, light: Math.max(4, Math.min(96, c.light + dl)) });
const svg = (id, defs, fill) => `<svg class="backdrop" data-backdrop="${id}" data-hang="pin" width="100%" height="100%" aria-hidden="true" focusable="false"><defs>${defs}</defs><rect width="100%" height="100%" fill="${fill}"/></svg>`;

/** id → (tint, unique id prefix) → <svg>. */
export const COLOUR_BACKDROPS = {
  flat: (c) => svg("flat", "", shade(c, -18)),
  fade: (c, p) => svg("fade", `<linearGradient id="${p}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, -34)}"/><stop offset="1" stop-color="${shade(c, 4)}"/></linearGradient>`, `url(#${p})`),
  duo: (c, p) => svg("duo", `<linearGradient id="${p}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${shade(c, -26)}"/><stop offset=".5" stop-color="${shade(c, -26)}"/>
<stop offset=".5" stop-color="${hex({ ...c, hue: (c.hue + 40) % 360, light: Math.max(10, c.light - 34) })}"/><stop offset="1" stop-color="${hex({ ...c, hue: (c.hue + 40) % 360, light: Math.max(10, c.light - 34) })}"/></linearGradient>`, `url(#${p})`),
};

let made = 0;
/** The scene's backdrop: an engine one, or a colour one; `coat` is the creature's colour, the tint when it has none. */
export function sceneBackdropSvg(scene, coat) {
  const tint = scene.tint ?? coat;
  if (COLOUR_BACKDROPS[scene.backdrop]) return COLOUR_BACKDROPS[scene.backdrop](tint, `cbd${(made += 1).toString(36)}`);
  return backdropSvg(scene.backdrop, hex(tint), "dark");
}
