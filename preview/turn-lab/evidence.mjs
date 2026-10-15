import { SCRIPTS } from "./agent.mjs";
import { initialChecks, verdict } from "./verdict.mjs";

function epochFor(events, conversation) {
  const scope = events.filter((event) => event.data?.type !== "history" &&
    (["voice-session", "voice-user-turn", "voice-input-receipt"].includes(event.data?.type) || event.kind === "agent-input") &&
    (!conversation || event.data?.conversation === conversation || event.data?.thread_id === conversation));
  const epochs = scope.map((event) => event.data?.epoch ?? event.data?.data?.epoch).filter(Number.isInteger);
  return epochs.length ? Math.max(...epochs) : null;
}

const scalars = (text) => [...text];
const bounded = (map, size) => { while (map.size > size) map.delete(map.keys().next().value); };

// A case boundary does not end the room's hearing journal. Keep identity, text,
// maximum extent and pending reliable receipt IDs together across cases.
export function reduceHearing(events, state = { replies: new Map(), receipts: new Map() }) {
  const { replies, receipts } = state;
  const get = (id) => {
    if (!replies.has(id)) replies.set(id, { utterance_id: id, fate: "unconfirmed", hearing_unconfirmed: true });
    return replies.get(id);
  };
  const textOf = (row, text) => {
    if (typeof text === "string" && row.text === undefined) row.text = text;
    if (row.text !== undefined && Number.isInteger(row.heard_chars)) {
      row.heard = scalars(row.text).slice(0, row.heard_chars).join("");
      row.unheard = scalars(row.text).slice(row.heard_chars).join("");
    } else if (row.text === undefined) {
      row.heard = null;
      row.unheard = null;
    }
  };
  const set = (id, outcome, heardChars, text, historyId, unconfirmed) => {
    if (!id || !["heard", "partial", "not_heard"].includes(outcome)) return;
    const row = get(id);
    if (historyId && row.history_id && historyId !== row.history_id) return;
    if (historyId) row.history_id = historyId;
    textOf(row, text);
    if (outcome === "not_heard" && heardChars != null && heardChars !== 0) return;
    const extent = outcome === "not_heard" ? 0 : outcome === "heard" ?
      (Number.isInteger(heardChars) ? heardChars : row.text === undefined ? null : scalars(row.text).length) : heardChars;
    if (!Number.isInteger(extent) || extent < 0 || outcome === "partial" &&
      (extent === 0 || row.text !== undefined && extent >= scalars(row.text).length) || outcome === "heard" &&
      row.text !== undefined && extent !== scalars(row.text).length) return;
    if (extent < (row.heard_chars ?? -1)) return;
    if (extent === row.heard_chars && row.fate === "heard" && outcome !== "heard") return;
    row.fate = outcome;
    row.heard_chars = extent;
    if (typeof unconfirmed === "boolean") row.hearing_unconfirmed = unconfirmed;
    textOf(row);
  };
  for (const event of events) {
    const item = event.data ?? {};
    if (event.kind === "tool-result" && item.name === "voice_say" && item.args?.utterance_id) {
      const row = get(item.args.utterance_id);
      textOf(row, item.args.text);
      row.audio = item.result?.audio ?? item.result?.status;
      if (item.result?.status === "rejected") { row.fate = "refused"; row.hearing_unconfirmed = false; }
    }
    if (["room-frame", "browser-action"].includes(event.kind)) {
      const history = item.type === "history" ? item.row ?? item : null;
      const id = item.utterance_id ?? (history?.role === "assistant" ? history.id?.split(":voice:").at(-1) : null);
      if (id) {
        const row = get(id);
        if (item.type === "voice-reply") { textOf(row, item.text); if (item.history_id) row.history_id = item.history_id; }
        if (item.type === "voice-playback") row.audio = item.status;
        if (item.type === "voice-reply-withdrawn") row.audio = "withdrawn";
        if (item.type === "reply-hearing" && event.kind === "browser-action" && item.client_msg_id)
          receipts.set(item.client_msg_id, { id, outcome: item.outcome, heard_chars: item.heard_chars, history_id: item.history_id,
            valid: !!item.history_id && (!row.history_id || row.history_id === item.history_id) });
        if (history) {
          textOf(row, history.text);
          if (history.status) row.audio = history.status;
          if (history.history_id ?? history.id) row.history_id = history.history_id ?? history.id;
          if (history.hearing) set(id, history.hearing, history.heard_chars, history.text, row.history_id, history.hearing_unconfirmed);
          else if (history.hearing_unconfirmed === true && row.fate === "unconfirmed") row.hearing_unconfirmed = true;
        }
      }
      if (event.kind === "room-frame" && item.client_msg_id && receipts.has(item.client_msg_id)) {
        const receipt = receipts.get(item.client_msg_id);
        if (item.type === "voice-ack" && receipt.valid)
          set(receipt.id, receipt.outcome, receipt.heard_chars, undefined, receipt.history_id);
        if (item.type === "error") get(receipt.id).receipt_error = item.key ?? "rejected";
        if (["voice-ack", "error"].includes(item.type)) receipts.delete(item.client_msg_id);
      }
    }
    if (event.kind === "agent-input") {
      for (const miss of item.unheard?.replies ?? []) set(miss.utterance_id, miss.fate, miss.heard_chars, miss.text, miss.history_id);
      for (const heard of item.notice?.heard ?? []) set(heard.utterance_id, heard.fate, heard.heard_chars, undefined, heard.history_id);
    }
    bounded(replies, 256); bounded(receipts, 512);
  }
  return state;
}

export function evidence(events, conversation = null) {
  const starts = events.flatMap((event, index) => event.kind === "script-start" ? [index] : []);
  if (!starts.length) return judge(events, conversation);
  const checks = initialChecks(Object.keys(SCRIPTS));
  const notes = [], inputs = [];
  for (const [from, to] of [[0, starts[0]], ...starts.map((at, index) => [at, starts[index + 1] ?? events.length])]) {
    const segment = events.slice(from, to);
    // T06b/T06d set output before Run; carry that setting, not previous replies.
    const scope = segment[0]?.data?.conversation;
    const setting = events.slice(0, from).reverse().find((event) =>
      ["room-frame", "browser-action"].includes(event.kind) && event.data?.type === "voice-speech" &&
      (!scope || !event.data?.conversation || event.data.conversation === scope));
    const result = judge(setting ? [setting, ...segment] : segment, conversation);
    notes.push(...result.notes);
    inputs.push(...result.inputs);
    const id = segment[0]?.kind === "script-start" ? segment[0].data?.id : null;
    if (id) checks[id] = result.checks[id];
  }
  return { currentEpoch: epochFor(events, conversation), fates: [...reduceHearing(events).replies.values()], notes, inputs, checks };
}

function judge(events, conversation) {
  const selected = events.find((event) => event.kind === "script-start")?.data?.id;
  const inputs = events.filter((event) => event.kind === "agent-input").map((event) => event.data);
  const notes = inputs.filter((input) => input.notice).map((input) => ({ ...input.notice, unheard: input.unheard?.replies ?? [] }));
  const replies = reduceHearing(events).replies;
  const checks = initialChecks(Object.keys(SCRIPTS));
  if (selected) checks[selected] = verdict(selected, events, replies);
  return { currentEpoch: epochFor(events, conversation), fates: [...replies.values()], notes, inputs, checks };
}
