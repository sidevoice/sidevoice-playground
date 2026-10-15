import { SCRIPTS } from "./agent.mjs";
import { initialChecks, verdict } from "./verdict.mjs";

function epochFor(events, conversation) {
  const scope = events.filter((event) => event.kind !== "script-start" && (!conversation || !event.data?.conversation || event.data.conversation === conversation));
  return scope.map((event) => event.data?.epoch ?? event.data?.data?.epoch ?? event.data?.row?.epoch).filter(Number.isInteger).at(-1) ?? null;
}

export function evidence(events, conversation = null) {
  const starts = events.flatMap((event, index) => event.kind === "script-start" ? [index] : []);
  if (!starts.length) {
    const empty = judge(events);
    empty.currentEpoch = epochFor(events, conversation);
    return empty;
  }
  const checks = judge([]).checks;
  const fates = new Map();
  const notes = [];
  const inputs = [];
  const before = judge(events.slice(0, starts[0]));
  for (const fate of before.fates) fates.set(fate.utterance_id, fate);
  notes.push(...before.notes);
  inputs.push(...before.inputs);
  starts.forEach((from, index) => {
    const segment = events.slice(from, starts[index + 1] ?? events.length);
    const result = judge(segment);
    const id = events[from].data?.id;
    if (id && result.checks[id]) checks[id] = result.checks[id];
    for (const fate of result.fates) fates.set(fate.utterance_id, fate);
    notes.push(...result.notes);
    inputs.push(...result.inputs);
  });
  return { currentEpoch: epochFor(events, conversation), fates: [...fates.values()], notes, inputs, checks };
}

function judge(events) {
  const selected = [...events].reverse().find((event) => event.kind === "script-start")?.data?.id;
  const after = selected ? events.slice(events.findLastIndex((event) => event.kind === "script-start")) : events;
  const inputs = after.filter((event) => event.kind === "agent-input").map((event) => event.data);
  const frames = after.filter((event) => event.kind === "room-frame" || event.kind === "browser-action").map((event) => event.data);
  const notes = inputs.filter((input) => input.notice).map((input) => input.notice);
  const unheard = inputs.flatMap((input) => input.unheard?.replies ?? []);
  const status = (result) => result?.status ?? result?.result?.status;
  const currentEpoch = epochFor(after, selected ? after[0]?.data?.conversation : null);
  const fates = new Map();
  const fateRank = (value) => ({ played: 5, skipped: 5, cut: 4, refused: 4, stale: 4, "not played": 4, "known limitation": 3, playing: 2, queued: 1, synthesizing: 1 }[value] ?? 0);
  const settle = (id, incoming) => {
    const previous = fates.get(id);
    if (!previous) { fates.set(id, incoming); return; }
    const stronger = fateRank(incoming.fate) >= fateRank(previous.fate) ? incoming : previous;
    const defined = Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined));
    const next = { ...previous, ...defined, ...stronger };
    const extent = Math.max(previous.heard_chars ?? -1, incoming.heard_chars ?? -1);
    if (extent >= 0) next.heard_chars = extent;
    if (next.fate === "played" && next.text) { next.heard = next.text; next.unheard = ""; }
    fates.set(id, next);
  };
  for (const event of after) {
    const item = event.data;
    if (event.kind === "tool-result" && item?.name === "voice_say" && item.args?.utterance_id) {
      const result = item.result;
      const disposition = status(result);
      const textOnly = disposition === "text_only" || result?.audio === "text_only";
      settle(item.args.utterance_id, { fate: disposition === "rejected" ? "refused" : textOnly ? result?.reason === "newer_turn" ? "stale" : "not played" : result?.audio ?? disposition ?? "submitted", text: item.args.text, reason: result?.reason });
    }
    const row = item?.type === "history" ? item.row ?? item : null;
    const historyUtterance = row?.role && row.role !== "assistant" ? null : row?.id?.split(":voice:").at(-1);
    const utterances = item?.utterance_ids ?? (item?.utterance_id ? [item.utterance_id] : historyUtterance && historyUtterance !== row.id ? [historyUtterance] : []);
    if (event.kind === "room-frame" || event.kind === "browser-action") for (const id of utterances) {
      const type = item.type ?? item.event;
      if (type === "voice-reply") settle(id, { fate: "queued", text: item.text, epoch: item.epoch });
      if (type === "voice-reply-withdrawn") settle(id, { fate: "not played", reason: item.reason });
      if (type === "voice-playback") settle(id, { fate: playbackFate(item.status, item.reason, item.cut), heard_chars: item.heard_chars, reason: item.reason });
      if (type === "history") settle(id, { fate: row.globally_heard ? "played" : playbackFate(row.status, row.audio_reason ?? row.reason, row.cut), heard_chars: row.heard_chars, reason: row.audio_reason ?? row.reason, text: row.text, history_id: row.id });
    }
  }
  for (const item of unheard) {
    if (["played", "skipped", "heard"].includes(fates.get(item.utterance_id)?.fate)) continue;
    const scalars = [...(item.text ?? "")];
    const cut = item.heard_chars;
    settle(item.utterance_id, { fate: playbackFate(item.fate, item.reason, item.cut), heard_chars: cut, text: item.text, reason: item.reason,
      heard: cut == null ? null : scalars.slice(0, cut).join(""), unheard: cut == null ? item.text : scalars.slice(cut).join("") });
  }
  const checks = initialChecks(Object.keys(SCRIPTS));
  if (selected) checks[selected] = verdict(selected, after, fates);
  return { currentEpoch, fates: [...fates].map(([utterance_id, fate]) => ({ utterance_id, ...fate })), notes, inputs, checks };
}

function playbackFate(status, reason, cut) {
  if (status === "playback_finished" || status === "heard") return "played";
  if (reason === "user_skipped" || status === "skipped") return "skipped";
  if (status === "interrupted") return cut === false || (reason === "newer_turn" && cut !== true) ? "not played" : "cut";
  if (status === "unplayed") return "not played";
  return status ?? "unknown";
}
