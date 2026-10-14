import { SCRIPTS } from "./agent.mjs";

const MANUAL = new Set(["T09a", "T09b", "T10", "T13", "T14", "T15"]);

export function evidence(events) {
  const selected = [...events].reverse().find((event) => event.kind === "script-start")?.data?.id;
  const after = selected ? events.slice(events.findLastIndex((event) => event.kind === "script-start")) : [];
  const inputs = after.filter((event) => event.kind === "agent-input").map((event) => event.data);
  const results = after.filter((event) => event.kind === "tool-result" && event.data.name === "voice_say").map((event) => event.data.result);
  const frames = after.filter((event) => event.kind === "room-frame" || event.kind === "browser-action").map((event) => event.data);
  const notes = inputs.filter((input) => input.notice).map((input) => input.notice);
  const unheard = inputs.flatMap((input) => input.unheard?.replies ?? []);
  const status = (result) => result?.status ?? result?.result?.status;
  const accepted = results.some((result) => ["accepted", "queued", "spoken", "published"].includes(status(result)));
  const refused = results.some((result) => status(result) === "rejected" || /user.speaking/.test(JSON.stringify(result)));
  const epochs = [...inputs, ...frames].map((item) => item?.epoch ?? item?.data?.epoch).filter(Number.isInteger);
  const currentEpoch = epochs.length ? Math.max(...epochs) : null;
  const fates = new Map();
  for (const event of after) {
    const item = event.data;
    if (event.kind === "tool-result" && item?.name === "voice_say" && item.args?.utterance_id) {
      const result = item.result;
      const disposition = status(result);
      fates.set(item.args.utterance_id, { fate: disposition === "rejected" ? "refused" : disposition === "text_only" || result?.audio === "text_only" ? "stale" : disposition ?? "submitted", text: item.args.text, reason: result?.reason });
    }
    const utterances = item?.utterance_ids ?? (item?.utterance_id ? [item.utterance_id] : []);
    if (event.kind === "room-frame" || event.kind === "browser-action") for (const id of utterances) {
      const type = item.type ?? item.event;
      if (type === "voice-reply") fates.set(id, { fate: "queued", text: item.text, epoch: item.epoch });
      if (type === "voice-reply-withdrawn") fates.set(id, { ...fates.get(id), fate: "not played", reason: item.reason });
      if (type === "voice-playback") fates.set(id, { ...fates.get(id), fate: playbackFate(item.status, item.reason), heard_chars: item.heard_chars, reason: item.reason });
      if (type === "history") fates.set(id, { ...fates.get(id), fate: playbackFate(item.status, item.reason), heard_chars: item.heard_chars, reason: item.reason, text: item.text ?? fates.get(id)?.text });
    }
  }
  for (const item of unheard) {
    if (["played", "skipped", "heard"].includes(fates.get(item.utterance_id)?.fate)) continue;
    const scalars = [...(item.text ?? "")];
    const cut = item.heard_chars;
    fates.set(item.utterance_id, { fate: playbackFate(item.fate, item.reason), heard_chars: cut, text: item.text, reason: item.reason,
      heard: cut == null ? null : scalars.slice(0, cut).join(""), unheard: cut == null ? item.text : scalars.slice(cut).join("") });
  }
  const checks = Object.fromEntries(Object.keys(SCRIPTS).map((id) => [id, { state: MANUAL.has(id) ? "manual" : "pending", reason: "Awaiting evidence" }]));
  const pass = (id, condition, reason) => { checks[id] = { state: condition ? "pass" : "fail", reason }; };
  if (selected && !MANUAL.has(selected)) {
    if (["T02c", "T02d"].includes(selected) && results.length) pass(selected, refused, "The MCP tool result must refuse the open turn");
    if (selected === "T04a" && results.length >= 3 && results.some((result) => status(result) === "rejected")) pass(selected, false, "One of three publications was refused");
    if (selected === "T03" && results.length && unreadKind(notes, "reply_not_played")) pass(selected, true, "Stale reply evidence reached the agent");
    if (selected === "T01" && unheard.length) pass(selected, unheard.some((item) => item.fate === "interrupted" && Number.isInteger(item.heard_chars)), "Cut extent and full text reached the agent");
    if (["T02a", "T02b", "T04b"].includes(selected) && unheard.length) pass(selected, unheard.some((item) => item.fate === "unplayed"), "Not played evidence reached the agent");
    if (selected === "T02d" && notes.some((note) => note.kind === "turn_empty") && refused) pass(selected, true, "Refusal and empty notice reached the agent");
    if (selected === "T12" && notes.some((note) => note.kind === "reply_skipped")) pass(selected, !unheard.some((item) => item.reason === "user_skipped"), "Skip was reported as heard by choice");
    if (selected === "T06d" && notes.some((note) => note.kind === "user_returned")) pass(selected, true, "Return notice reached the agent");
    if (selected === "T16" && inputs.length) checks[selected] = { state: "pending", reason: "Repeat in both modes and compare exported traces" };
    if (selected === "T08" && frames.some((frame) => frame.type === "voice-reply") && inputs.some((input) => input.text)) checks[selected] = { state: "pending", reason: "Check that epoch and audio stayed unchanged" };
    if (selected === "T04a" && accepted && fates.size === 3 && [...fates.values()].every((fate) => fate.fate === "played")) pass(selected, true, "Three replies played in order");
  }
  return { currentEpoch, fates: [...fates].map(([utterance_id, fate]) => ({ utterance_id, ...fate })), notes, inputs, checks };
}

function unreadKind(notes, kind) { return notes.some((note) => note.kind === kind); }
function playbackFate(status, reason) {
  if (status === "playback_finished" || status === "heard") return "played";
  if (reason === "user_skipped" || status === "skipped") return "skipped";
  if (status === "interrupted") return "cut";
  if (status === "unplayed") return "not played";
  return status ?? "unknown";
}
