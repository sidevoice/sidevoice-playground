// The filter of a searchable select (combobox.mjs): which options a query keeps, which parts of a label it matched, and
// where the arrow keys go. No DOM here, so it is tested in Node. An option is `{ label, disabled? }` plus whatever its
// caller keeps on it.

/** A query's words, lowercased: each must be somewhere in a label, in any order. */
export function words(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** The options whose label holds every word of `query`, case-insensitively, in their order; all of them for none. */
export function filterOptions(options, query) {
  const wanted = words(query);
  return options.filter((option) => {
    const label = option.label.toLowerCase();
    return wanted.every((word) => label.includes(word));
  });
}

/** `label` cut into what `query` matched and what it did not, `[{ text, match }]` in order, joining back to `label`. */
export function marks(label, query) {
  const lower = label.toLowerCase();
  // A label whose lowercase is another length (a few letters outside ASCII) cannot be marked by position: left plain.
  if (lower.length !== label.length) return label ? [{ text: label, match: false }] : [];
  const hit = new Array(label.length).fill(false);
  for (const word of words(query)) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) hit.fill(true, at, at + word.length);
  }
  const parts = [];
  for (let i = 0; i < label.length; i++) {
    const last = parts.at(-1);
    if (last?.match === hit[i]) last.text += label[i];
    else parts.push({ text: label[i], match: hit[i] });
  }
  return parts;
}

/**
 * Where an arrow key goes from `from` (an index into `options`, -1 for none): the next option down (`step` 1) or up
 * (-1) that is not disabled, round the ends; `from` itself when no other is, -1 when none is.
 */
export function move(options, from, step) {
  const count = options.length;
  const start = from >= 0 && from < count ? from : step > 0 ? -1 : count;
  for (let n = 1; n <= count; n++) {
    const at = (((start + step * n) % count) + count) % count;
    if (!options[at].disabled) return at;
  }
  return -1;
}
