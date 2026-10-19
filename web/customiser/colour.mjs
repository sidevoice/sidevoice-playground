// The coat's colour in the three ways the customiser edits it. The engine stores HSL (bichos/spec.ts: hue 0–360,
// saturation and lightness 0–100); RGB and hex are views of it, converted here and stored back as HSL. The picker
// itself is the platform's (<input type=color>), which reads and writes hex.

/** { hue, sat, light } → [r, g, b], 0–255 (CSS Color 4's hsl-to-rgb). */
export function hslToRgb({ hue, sat, light }) {
  const s = sat / 100, l = light / 100;
  const f = (n) => { const k = (n + hue / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/** [r, g, b], 0–255 → { hue, sat, light }, rounded to one decimal (CSS Color 4's rgb-to-hsl). */
export function rgbToHsl([r, g, b]) {
  const [R, G, B] = [r, g, b].map((v) => Math.min(255, Math.max(0, v)) / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const light = (max + min) / 2;
  let hue = 0, sat = 0;
  if (d) {
    sat = light === 0 || light === 1 ? 0 : (max - light) / Math.min(light, 1 - light);
    hue = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    hue *= 60;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return { hue: r1(hue) % 360, sat: r1(sat * 100), light: r1(light * 100) };
}

export const rgbToHex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");

/** "#rrggbb" or "rrggbb" (or the short "#rgb") → [r, g, b], or null. */
export function hexToRgb(text) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text).trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
