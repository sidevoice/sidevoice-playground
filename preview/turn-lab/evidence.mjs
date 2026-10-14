import { SCRIPTS } from "./agent.mjs";

const MANUAL = new Set(["T09a", "T09b", "T10", "T13", "T14", "T15"]);

export function evidence(events) {
  const starts = events.flatMap((event, index) => event.kind === "script-start" ? [index] : []);
  if (!starts.length) return judge(events);
  const checks = judge([]).checks;
  const fates = new Map();
  const notes = [];
  const inputs = [];
  const knownEpochs = events.map((event) => event.data?.epoch ?? event.data?.data?.epoch).filter(Number.isInteger);
  let currentEpoch = knownEpochs.length ? Math.max(...knownEpochs) : null;
  starts.forEach((from, index) => {
    const segment = events.slice(from, starts[index + 1] ?? events.length);
    const result = judge(segment);
    const id = events[from].data?.id;
    if (id && result.checks[id]) checks[id] = result.checks[id];
    for (const fate of result.fates) fates.set(fate.utterance_id, fate);
    notes.push(...result.notes);
    inputs.push(...result.inputs);
    if (result.currentEpoch != null) currentEpoch = Math.max(currentEpoch ?? 0, result.currentEpoch);
  });
  return { currentEpoch, fates: [...fates.values()], notes, inputs, checks };
}

function judge(events) {
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
      const textOnly = disposition === "text_only" || result?.audio === "text_only";
      fates.set(item.args.utterance_id, { fate: disposition === "rejected" ? "refused" : textOnly ? result?.reason === "newer_turn" ? "stale" : "not played" : result?.audio ?? disposition ?? "submitted", text: item.args.text, reason: result?.reason });
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
    if (selected === "T03" && results.length) {
      const stale = results.some((result) => result?.reason === "newer_turn" && (status(result) === "text_only" || result?.audio === "text_only"));
      if (stale || unreadKind(notes, "reply_not_played")) pass(selected, stale && unreadKind(notes, "reply_not_played"), "Stale admission and not-played notice must both be observed");
    }
    if (selected === "T01" && unheard.length) pass(selected, unheard.some((item) => item.fate === "interrupted" && Number.isInteger(item.heard_chars)), "Cut extent and full text reached the agent");
    if (["T02a", "T02b"].includes(selected) && unheard.length) {
      const unstarted = unheard.filter((item) => item.reason === "newer_turn" && item.heard_chars == null);
      const properInput = selected === "T02a" ? inputs.some((input) => input.channel === "voice" && input.text) : inputs.some((input) => input.channel === "note" && !input.text && input.notice && input.unheard?.replies?.length);
      pass(selected, properInput && unstarted.length > 0 && unstarted.every((item) => !frames.some((frame) => frame.type === "voice-playback" && frame.status === "playing" && frame.utterance_id === item.utterance_id)), "Accepted reply must remain not started and reach the proper spoken or empty outcome");
    }
    if (selected === "T04b" && unheard.length >= 3) pass(selected, unheard.every((item) => item.reason === "newer_turn" || item.reason === "user_interrupted"), "All three replies must reach the new turn's unheard evidence");
    if (selected === "T02d" && notes.some((note) => note.kind === "turn_empty") && refused) pass(selected, true, "Refusal and empty notice reached the agent");
    if (selected === "T12" && notes.some((note) => note.kind === "reply_skipped")) pass(selected, !unheard.some((item) => item.reason === "user_skipped"), "Skip was reported as heard by choice");
    if (selected === "T06d" && notes.some((note) => note.kind === "user_returned")) pass(selected, true, "Return notice reached the agent");
    if (selected === "T05" && notes.some((note) => note.kind === "reply_interrupted")) {
      pass(selected, [...fates.values()].some((fate) => fate.fate === "cut" && Number.isInteger(fate.heard_chars)), "Checkpoint interruption must report its cut extent");
    }
    if (["T06a", "T06b"].includes(selected)) {
      const reason = selected === "T06a" ? "agents_muted" : "voice_off";
      const disabled = frames.some((frame) => frame.type === "voice-speech" && frame.reason === reason && (frame.on === false || frame.data?.on === false));
      const unpublished = results.some((result) => result?.reason === reason && (result?.audio === "text_only" || status(result) === "text_only"));
      if (disabled && results.length) pass(selected, unpublished && [...fates.values()].every((fate) => fate.fate !== "played"), "Output disabled before publication must save text without audio");
    }
    if (selected === "T16" && inputs.length) checks[selected] = { state: "pending", reason: "Repeat in both modes and compare exported traces" };
    if (selected === "T08") {
      const typed = frames.find((frame) => frame.type === "typed-message" && frame.status >= 200 && frame.status < 300);
      const replyFates = [...fates.values()].filter((fate) => fate.text);
      if (typed && replyFates.length >= 2 && replyFates.every((fate) => ["played", "cut", "not played", "stale"].includes(fate.fate))) {
        pass(selected, replyFates.every((fate) => fate.fate === "played") && (currentEpoch == null || typed.epoch === currentEpoch), "Typing must keep the epoch and allow both replies to play");
      }
    }
    if (selected === "T04a") {
      const published = after.filter((event) => event.kind === "tool-result" && event.data.name === "voice_say").map((event) => event.data.args?.utterance_id).filter(Boolean);
      const started = frames.filter((frame) => frame.type === "voice-playback" && frame.status === "playing").map((frame) => frame.utterance_id);
      if (published.length >= 3 && started.length >= 3) {
        const ordered = published.every((id, index) => started.indexOf(id) === index);
        if (!ordered) pass(selected, false, "Three replies must begin in publication order");
        else if (published.every((id) => fates.get(id)?.fate === "played")) pass(selected, true, "Three replies began in order and were heard");
      }
    }
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
