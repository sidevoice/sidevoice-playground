import { SCRIPTS } from "./agent.mjs";
import { initialChecks, verdict } from "./verdict.mjs";

function epochFor(events, conversation) {
  const scope = events.filter((event) => event.kind !== "script-start" && (!conversation || !event.data?.conversation || event.data.conversation === conversation));
  return scope.map((event) => event.data?.epoch ?? event.data?.data?.epoch ?? event.data?.row?.epoch).filter(Number.isInteger).at(-1) ?? null;
}

export function evidence(events, conversation = null) {
  const starts = events.flatMap((event, index) => event.kind === "script-start" ? [index] : []);
  if (!starts.length) return judge(events, conversation);
  const checks = initialChecks(Object.keys(SCRIPTS));
  const replies = new Map();
  const notes = [], inputs = [];
  for (const [from, to] of [[0, starts[0]], ...starts.map((at, index) => [at, starts[index + 1] ?? events.length])]) {
    const segment = events.slice(from, to);
    const result = judge(segment, conversation);
    for (const row of result.fates) replies.set(row.utterance_id, row);
    notes.push(...result.notes);
    inputs.push(...result.inputs);
    const id = segment[0]?.kind === "script-start" ? segment[0].data?.id : null;
    if (id) checks[id] = result.checks[id];
  }
  return { currentEpoch: epochFor(events, conversation), fates: [...replies.values()], notes, inputs, checks };
}

function judge(events, conversation) {
  const selected = events.find((event) => event.kind === "script-start")?.data?.id;
  const inputs = events.filter((event) => event.kind === "agent-input").map((event) => event.data);
  const notes = inputs.filter((input) => input.notice).map((input) => ({ ...input.notice, unheard: input.unheard?.replies ?? [] }));
  const replies = new Map();
  const get = (id) => {
    if (!replies.has(id)) replies.set(id, { utterance_id: id, fate: "unconfirmed", hearing_unconfirmed: true });
    return replies.get(id);
  };
  const setHearing = (id, outcome, heardChars, text) => {
    if (!id || !["heard", "partial", "not_heard"].includes(outcome)) return;
    const row = get(id);
    const length = [...(text ?? row.text ?? "")].length;
    const extent = outcome === "heard" ? length : outcome === "not_heard" ? 0 : heardChars;
    if (!Number.isInteger(extent) || extent < 0) return;
    if (row.hearing_unconfirmed || extent >= (row.heard_chars ?? -1)) {
      row.fate = outcome; row.hearing_unconfirmed = false; row.heard_chars = extent;
      if (text !== undefined) row.text = text;
      if (row.text !== undefined) {
        const scalars = [...row.text];
        row.heard = scalars.slice(0, extent).join("");
        row.unheard = scalars.slice(extent).join("");
      }
    }
  };
  for (const event of events) {
    const item = event.data ?? {};
    if (event.kind === "tool-result" && item.name === "voice_say" && item.args?.utterance_id) {
      const row = get(item.args.utterance_id);
      row.text = item.args.text;
      row.audio = item.result?.audio ?? item.result?.status;
      if (item.result?.status === "rejected") { row.fate = "refused"; row.hearing_unconfirmed = false; }
    }
    if (["room-frame", "browser-action"].includes(event.kind)) {
      const history = item.type === "history" ? item.row ?? item : null;
      const id = item.utterance_id ?? (history?.role === "assistant" ? history.id?.split(":voice:").at(-1) : null);
      if (id) {
        const row = get(id);
        if (item.type === "voice-reply" && item.text !== undefined) row.text = item.text;
        if (item.type === "voice-playback") row.audio = item.status;
        if (item.type === "voice-reply-withdrawn") row.audio = "withdrawn";
        if (item.type === "reply-hearing") setHearing(id, item.outcome, item.heard_chars);
        if (history) {
          if (history.text !== undefined) row.text = history.text;
          if (history.status) row.audio = history.status;
          if (history.history_id ?? history.id) row.history_id = history.history_id ?? history.id;
          if (history.hearing_unconfirmed === true && row.fate === "unconfirmed") row.hearing_unconfirmed = true;
          if (history.hearing) setHearing(id, history.hearing, history.heard_chars, history.text);
        }
      }
    }
  }
  for (const input of inputs) {
    for (const miss of input.unheard?.replies ?? []) setHearing(miss.utterance_id, miss.fate, miss.heard_chars, miss.text);
    for (const heard of input.notice?.heard ?? []) setHearing(heard.utterance_id, heard.fate, heard.heard_chars);
  }
  const checks = initialChecks(Object.keys(SCRIPTS));
  if (selected) checks[selected] = verdict(selected, events, replies);
  return { currentEpoch: epochFor(events, conversation), fates: [...replies.values()], notes, inputs, checks };
}
