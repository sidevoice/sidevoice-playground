// What the Turn detection screen (turns.mjs) prints of the chain's log, with no DOM here, so it is tested in Node.

/** A time on the audio clock as m:ss.cc. */
export function clockText(ms) {
  const seconds = Math.max(0, ms) / 1000;
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

/** One entry of the chain's log as a line. */
export function logLine(entry) {
  const at = clockText(entry.at);
  const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const p = (value) => value.toFixed(2);
  switch (entry.kind) {
    case "turn": return `${at} speech starts: turn ${entry.turn}`;
    case "resumed": return `${at} speech again: turn ${entry.turn} goes on`;
    case "pause":
      return entry.askAt != null
        ? `${at} speech ends: asks the end-of-turn model at ${clockText(entry.askAt)}, cuts at ${clockText(entry.cutAt)} at the latest`
        : `${at} speech ends: silence cuts the turn at ${clockText(entry.cutAt)} unless speech resumes`;
    case "ask": return `${at} asks the end-of-turn model about ${s(entry.at - entry.from)} of turn ${entry.turn}`;
    case "keep": return `${at} P(end) ${p(entry.probability)} below the threshold: keep listening`;
    case "cut":
      if (entry.reason === "end-of-turn") return `${at} P(end) ${p(entry.probability)}: cut now (turn ${entry.turn}, ${s(entry.length)})`;
      if (entry.reason === "longest") return `${at} cut: a ${s(entry.silent)} pause ends the turn whatever the model said (turn ${entry.turn})`;
      return `${at} cut: ${s(entry.silent)} of silence (turn ${entry.turn}, ${s(entry.length)})`;
    case "error": return `${at} ${entry.message}`;
    case "note": return `${at} ${entry.message}`;
    default: return `${at} ${entry.kind}`;
  }
}

