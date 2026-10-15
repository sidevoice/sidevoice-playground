// Physical playback proves ordering. Only reply-hearing, semantic history and
// the agent envelope prove hearing; operational stop reasons never do.
const MANUAL = new Set(["T06c", "T06e", "T07", "T09a", "T09b", "T10", "T11", "T13", "T14", "T15", "T16"]);
const good = (status) => ["accepted", "queued", "spoken", "published", "text_only"].includes(status);
const check = (state, reason) => ({ state, reason });
const pending = (reason = "Insufficient case evidence") => check("pending", reason);
const pass = (reason) => check("pass", reason);
const fail = (reason) => check("fail", reason);
const length = (text) => [...(text ?? "")].length;
const status = (item) => item?.result?.status ?? item?.result?.result?.status;

export function initialChecks(ids) {
  return Object.fromEntries(ids.map((id) => [id, MANUAL.has(id) ? check("manual", "Follow the case instruction and review the room and exported trace") : pending()]));
}

export function verdict(id, events, fates) {
  if (MANUAL.has(id)) return check("manual", "Follow the case instruction and review the room and exported trace");
  const conversation = events.find((event) => event.kind === "script-start")?.data?.conversation;
  if (conversation) events = events.filter((event) => !event.data?.conversation || event.data.conversation === conversation);
  const publications = [];
  for (const [at, event] of events.entries()) {
    if (event.kind !== "tool-result" || event.data?.name !== "voice_say") continue;
    const item = { args: event.data.args ?? {}, result: event.data.result ?? {}, at };
    const retry = publications.find((prior) => prior.args.event_id && prior.args.event_id === item.args.event_id &&
      prior.args.utterance_id === item.args.utterance_id);
    if (retry) { if (status(item) !== "admission_unknown") retry.result = item.result; }
    else publications.push(item);
  }
  const ids = publications.map((item) => item.args.utterance_id);
  const timestamp = (value) => Number.isFinite(value) ? value : typeof value === "string" ? Date.parse(value) : NaN;
  const frames = events.flatMap((event, at) => ["room-frame", "browser-action"].includes(event.kind) ? [{ ...event.data, at,
    source_at: timestamp(event.data?.observed_at ?? event.at), direction: event.kind }] : []);
  const inputs = events.flatMap((event, at) => event.kind === "agent-input" ? [{ ...event.data, at,
    source_at: timestamp(event.data?.arrival_time ?? event.data?.received_at ?? event.at) }] : []);
  const misses = inputs.flatMap((input) => (input.unheard?.replies ?? []).map((row) => ({ ...row, at: input.at, input })));
  const notes = inputs.filter((input) => input.notice);
  const note = (kind) => notes.find((input) => input.notice.kind === kind);
  const dedupePlayback = (list) => {
    const seen = new Set();
    return list.filter((frame) => {
      if (!frame.client_msg_id) return true;
      if (seen.has(frame.client_msg_id)) return false;
      seen.add(frame.client_msg_id);
      return true;
    });
  };
  const physical = (key) => dedupePlayback(frames.filter((frame) => frame.type === "voice-playback" && frame.utterance_id === key));
  const historyId = (key) => frames.find((frame) => frame.type === "voice-reply" && frame.utterance_id === key)?.history_id ??
    frames.find((frame) => frame.type === "history" && frame.row?.role === "assistant" && frame.row.id?.endsWith(`:voice:${key}`))?.row.id;
  const submissions = frames.filter((frame) => frame.type === "reply-hearing");
  const responses = (submission) => frames.filter((frame) => frame.client_msg_id === submission.client_msg_id && frame.at > submission.at &&
    ["voice-ack", "error"].includes(frame.type));
  const accepted = (submission, key) => submission.client_msg_id && submission.history_id && historyId(key) &&
    submission.history_id === historyId(key) && responses(submission).some((frame) => frame.type === "voice-ack") &&
    !responses(submission).some((frame) => frame.type === "error");
  const semantic = (key) => submissions.filter((frame) => frame.utterance_id === key && accepted(frame, key))
    .map((frame) => ({ outcome: frame.outcome, heard_chars: frame.heard_chars, at: frame.at, source: "receipt", history_id: frame.history_id }))
    .concat(frames.filter((frame) => frame.type === "history" && frame.row?.role === "assistant" && frame.row.id?.endsWith(`:voice:${key}`) && frame.row.hearing)
      .map((frame) => ({ outcome: frame.row.hearing, heard_chars: frame.row.heard_chars, at: frame.at,
        source: "history", history_id: frame.row.id, unconfirmed: frame.row.hearing_unconfirmed })));
  const text = (key) => publications.find((item) => item.args.utterance_id === key)?.args.text;
  const valid = (value, key) => {
    if (value.outcome === "partial" && (!Number.isInteger(value.heard_chars) || value.heard_chars <= 0)) return false;
    if (value.outcome === "heard" || value.outcome === "not_heard") {
      if (value.source === "receipt" && value.heard_chars !== undefined) return false;
      if (value.source !== "receipt" && (!Number.isInteger(value.heard_chars) ||
        value.outcome === "not_heard" && value.heard_chars !== 0)) return false;
    } else if (value.outcome !== "partial") return false;
    if (typeof text(key) !== "string" || !value?.history_id || !historyId(key)) return null;
    if (value.history_id !== historyId(key)) return false;
    return value.outcome === "partial" ? value.heard_chars < length(text(key)) :
      value.outcome === "heard" ? value.source === "receipt" || value.heard_chars === length(text(key)) : true;
  };
  const candidate = (frame) => ({ outcome: frame.outcome ?? frame.fate, heard_chars: frame.heard_chars,
    history_id: frame.history_id, source: frame.source ?? "agent" });
  const match = (key, expected) => semantic(key).some((value) => value.outcome === expected && valid(value, key) === true);
  const contradictory = (key, expected) => {
    const exposure = misses.find((row) => row.utterance_id === key && row.fate === expected)?.at ?? Infinity;
    const expectedExtent = expected === "heard" ? length(text(key)) : expected === "not_heard" ? 0 :
      misses.find((row) => row.utterance_id === key && row.fate === expected)?.heard_chars;
    return semantic(key).some((value) => valid(value, key) === false || value.at <= exposure &&
      Number.isInteger(expectedExtent) && (value.heard_chars ?? (value.outcome === "heard" ? length(text(key)) : 0)) > expectedExtent);
  };
  const miss = (key, expected) => misses.find((row) => row.utterance_id === key && row.fate === expected && row.text === text(key) &&
    !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "cut") && valid(candidate(row), key) === true &&
    semantic(key).some((value) => value.outcome === row.fate &&
      (value.heard_chars ?? (value.outcome === "heard" ? length(text(key)) : 0)) === row.heard_chars && value.at <= row.at));
  const wrongMiss = (key, expected) => misses.some((row) => row.utterance_id === key &&
    (row.fate !== expected || row.text !== text(key) || Object.hasOwn(row, "reason") || Object.hasOwn(row, "cut") || valid(candidate(row), key) === false ||
      semantic(key).some((value) => value.at <= row.at && value.outcome === row.fate && value.heard_chars != null && value.heard_chars !== row.heard_chars)));
  const noAudio = (key) => !physical(key).some((frame) => ["playing", "heard", "playback_finished"].includes(frame.status));
  const authoritative = (item) => frames.some((frame) => frame.type === "history" && frame.row?.role === "assistant" &&
    frame.row.id === `${item.args.session_id}:voice:${item.args.utterance_id}` && frame.row.text === item.args.text);
  const admitted = (item) => good(status(item)) || status(item) === "admission_unknown" && authoritative(item);
  const textOnly = (item) => admitted(item) && (item.result.audio === "text_only" || status(item) === "text_only" ||
    status(item) === "admission_unknown" && frames.some((frame) => frame.type === "history" &&
      frame.row?.id === `${item.args.session_id}:voice:${item.args.utterance_id}` && frame.row.status === "text_only"));
  const distinct = ids.length === new Set(ids).size && ids.every(Boolean);
  const complete = (n) => publications.length === n && distinct && publications.every(admitted);
  const unresolved = () => publications.some((item) => status(item) === "admission_unknown" && !authoritative(item));
  const startFrames = frames.filter((frame) => frame.type === "voice-user-turn" && frame.phase === "started");
  const baselineEpoch = events.find((event) => event.kind === "script-start")?.data?.epoch;
  const qualifiedTurn = () => startFrames.find((frame) => Number.isInteger(frame.epoch) &&
    (!Number.isInteger(baselineEpoch) || frame.epoch > baselineEpoch));
  const publicationIdentity = (item) => item.args.utterance_id && item.args.event_id && item.result.utterance_id === item.args.utterance_id &&
    item.result.event_id === item.args.event_id && item.args.session_id && Number.isInteger(item.args.revision) && Number.isInteger(item.args.epoch);
  const publicationEpoch = (item, epoch) => publicationIdentity(item) && item.args.epoch === epoch;
  const sameReply = (row, item) => row.history_id && (!historyId(item.args.utterance_id) || row.history_id === historyId(item.args.utterance_id)) &&
    row.session_id === item.args.session_id && row.revision === item.args.revision && row.epoch === item.args.epoch;
  const envelope = (key, outcome, noticeKind, channel) => {
    const item = publications.find((entry) => entry.args.utterance_id === key);
    return inputs.find((input) => input.channel === channel && input.notice?.kind === noticeKind && input.message_id &&
      input.session_id === item?.args.session_id && Number.isInteger(input.revision) && Number.isInteger(input.epoch) &&
      (channel !== "note" || input.text === "") &&
      (input.unheard?.replies ?? []).some((row) => row.utterance_id === key && row.fate === outcome && sameReply(row, item) &&
        row.text === item.args.text && valid(candidate(row), key) === true &&
        semantic(key).some((value) => value.at <= input.at && value.outcome === outcome &&
          (value.heard_chars ?? (outcome === "heard" ? length(text(key)) : 0)) === row.heard_chars)) &&
      (!input.notice.related_message_id || inputs.some((prior) => prior.message_id === input.notice.related_message_id && prior.at < input.at)));
  };
  const envelopeGap = (key) => misses.some((row) => row.utterance_id === key &&
    (!row.input.message_id || !row.history_id || !row.session_id || !Number.isInteger(row.revision) || !Number.isInteger(row.epoch)));
  const caseIdentity = () => publications.every((item) => publicationIdentity(item));
  const started = (key) => physical(key).find((frame) => frame.status === "playing");
  const stopped = (key) => physical(key).find((frame) => ["interrupted", "unplayed", "failed"].includes(frame.status));
  const spoken = inputs.find((input) => input.channel === "voice" && Boolean(input.text));
  const forbiddenNotice = inputs.some((input) => ["reply_skipped", "reply_interrupted", "reply_not_played"].includes(input.notice?.kind) ||
    Object.hasOwn(input.notice ?? {}, "skipped") || (input.unheard?.replies ?? []).some((row) =>
      !["partial", "not_heard"].includes(row.fate) || Object.hasOwn(row, "reason") || Object.hasOwn(row, "cut")) ||
    (input.notice?.heard ?? []).some((row) => !["partial", "heard"].includes(row.fate) || Object.hasOwn(row, "reason") || Object.hasOwn(row, "cut")));
  if (forbiddenNotice) return fail("Agent received a prohibited hearing fate, cause, cut flag, or notice");
  const receiptIds = new Map();
  for (const frame of frames.filter((item) => item.type === "voice-playback" && item.client_msg_id)) {
    const payload = JSON.stringify([frame.utterance_id, frame.status, frame.heard_chars, frame.reason]);
    if (receiptIds.has(frame.client_msg_id) && receiptIds.get(frame.client_msg_id) !== payload)
      return fail("A reliable playback receipt changed under the same client_msg_id");
    receiptIds.set(frame.client_msg_id, payload);
  }
  for (const key of ids) {
    if (submissions.some((frame) => frame.utterance_id === key && valid(candidate({ ...frame, source: "receipt" }), key) === false))
      return fail("Invalid receipt hearing extent or identity");
    if (semantic(key).some((value) => valid(value, key) === false)) return fail("Invalid semantic hearing extent");
    if (misses.some((row) => row.utterance_id === key && valid(candidate(row), key) === false) ||
      inputs.some((input) => (input.notice?.heard ?? []).some((row) => row.utterance_id === key && valid(candidate(row), key) === false)))
      return fail("Invalid agent hearing extent or identity");
    if (submissions.some((frame) => frame.utterance_id === key && responses(frame).some((response) => response.type === "error")))
      return fail("Core rejected the app's hearing decision");
  }
  if (unresolved()) return pending("Publication admission is unresolved");
  for (const key of ids) {
    const exposed = misses.find((row) => row.utterance_id === key);
    if (!exposed) continue;
    const stronger = semantic(key).filter((value) => value.at > exposed.at &&
      (value.heard_chars ?? (value.outcome === "heard" ? length(text(key)) : 0)) > exposed.heard_chars);
    if (stronger.length && !stronger.every((value) => inputs.some((input) => input.at > exposed.at &&
      input.channel === "note" && input.text === "" && input.notice?.kind === "reply_heard" &&
      input.notice.corrects_message_id === exposed.input.message_id && (input.notice.heard ?? []).some((row) =>
        row.utterance_id === key && row.history_id === historyId(key) && row.fate === value.outcome &&
        row.heard_chars === (value.heard_chars ?? length(text(key)))))))
      return pending("Confirmed stronger hearing awaits its linked agent correction");
  }
  if (publications.some((item) => item.result.utterance_id && item.result.utterance_id !== item.args.utterance_id ||
    item.result.event_id && item.result.event_id !== item.args.event_id)) return fail("Publication identity changed");
  const orderedPlayback = (keys) => {
    const receipts = dedupePlayback(frames.filter((frame) => frame.type === "voice-playback" && keys.includes(frame.utterance_id)));
    for (const [index, frame] of receipts.entries()) {
      if (frame.utterance_id !== keys[Math.floor(index / 2)] ||
        (index % 2 === 0 ? frame.status !== "playing" : !["heard", "playback_finished"].includes(frame.status))) return "fail";
    }
    return receipts.length === keys.length * 2 ? "complete" : "pending";
  };
  if (["T02c", "T02d"].includes(id)) {
    if (!publications.length) return pending();
    const item = publications[0];
    if (publications.length !== 1 || status(item) !== "rejected" || item.result.reason !== "user_speaking" || item.result.text_saved === true ||
      frames.some((frame) => frame.utterance_id === ids[0] && ["voice-reply", "voice-playback"].includes(frame.type)) ||
      frames.some((frame) => frame.type === "history" && frame.row?.role === "assistant" && frame.row.id?.endsWith(`:voice:${ids[0]}`)) || misses.some((row) => row.utterance_id === ids[0]))
      return fail("Open-turn publication must be refused for user_speaking without an assistant row");
    const opened = startFrames.find((frame) => frame.at < item.at && Number.isInteger(item.args.epoch) && frame.epoch > item.args.epoch);
    const terminal = inputs.find((input) => input.at > item.at && input.session_id === item.args.session_id &&
      input.epoch === opened?.epoch && input.message_id && (id === "T02c" ? input.channel === "voice" && input.text :
        input.channel === "note" && input.text === "" && input.notice?.kind === "turn_empty"));
    if (terminal && !opened || terminal && terminal.notice?.related_message_id &&
      !inputs.some((prior) => prior.message_id === terminal.notice.related_message_id && prior.at < terminal.at)) return fail("Refusal terminal message is on the wrong turn");
    return opened && terminal && publicationIdentity(item) && item.result.terminal === true &&
      typeof item.result.instruction === "string" && item.result.instruction.length ?
      pass("Refusal and terminal user outcome reached the agent") : pending();
  }
  if (id === "T01") {
    if (!publications.length) return pending();
    const key = ids[0], item = misses.find((row) => row.utterance_id === key && ["partial", "not_heard"].includes(row.fate) &&
      row.text === text(key) && !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "cut") && valid(candidate(row), key) === true),
      begin = started(key), stop = stopped(key);
    if (status(publications[0]) === "rejected" || (item && (wrongMiss(key, item.fate) || contradictory(key, item.fate))) ||
      physical(key).some((frame) => ["heard", "playback_finished"].includes(frame.status)) ||
      physical(key).filter((frame) => frame.status === "playing").length > 1)
      return fail("Interrupted reply needs a matched partial extent and no resumed playback");
    const opened = qualifiedTurn();
    if (opened && (opened.at <= (begin?.at ?? -1) || stop && opened.at >= stop.at || opened.epoch <= publications[0].args.epoch ||
      spoken && spoken.epoch !== opened.epoch)) return fail("Interrupting speech must start the next epoch");
    if (!item || !begin || !stop || stop.status !== "interrupted" || !match(key, item?.fate) || !spoken ||
      !(begin.at < stop.at && stop.at < item.at) || !Number.isInteger(stop.heard_chars) || stop.heard_chars > item.heard_chars ||
      !opened || !publicationIdentity(publications[0]) || !envelope(key, item.fate, "reply_not_heard", "voice"))
      return pending("Insufficient playback, semantic cut, or spoken input");
    return pass("Original reply partially heard; new-epoch replies remain allowed");
  }
  if (["T02a", "T02b"].includes(id)) {
    if (!publications.length) return pending();
    const key = ids[0], expected = id === "T02a" ? inputs.find((input) => input.channel === "voice" && input.text && input.notice?.kind === "reply_not_heard") : note("turn_empty");
    if (status(publications[0]) === "rejected" || !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard"))
      return fail("Accepted unstarted reply cannot be heard or carry contradictory evidence");
    const opened = qualifiedTurn();
    if (opened && (opened.epoch <= publications[0].args.epoch || opened.at <= publications[0].at))
      return fail("Accepted reply must precede the next spoken turn");
    const direct = envelope(key, "not_heard", id === "T02a" ? "reply_not_heard" : "turn_empty", id === "T02a" ? "voice" : "note");
    const followup = id === "T02a" && inputs.find((input) => input.channel === "note" && input.notice?.kind === "reply_not_heard" &&
      input.notice.related_message_id && inputs.some((prior) => prior.message_id === input.notice.related_message_id &&
        prior.channel === "voice" && prior.text && prior.at < input.at)) && envelope(key, "not_heard", "reply_not_heard", "note");
    if (!complete(1) || !expected && !followup || !miss(key, "not_heard") || !match(key, "not_heard") || !opened ||
      !publicationIdentity(publications[0]) || !direct && !followup) return pending("Insufficient matched unstarted evidence");
    return pass("Accepted reply remained unstarted and was confirmed not heard");
  }
  if (id === "T03") {
    if (!publications.length) return pending();
    const key = ids[0];
    if (status(publications[0]) === "rejected" || good(status(publications[0])) && !textOnly(publications[0]) || !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard")) return fail("Stale reply must remain text only and not heard");
    const stale = frames.some((frame) => frame.type === "history" && frame.row?.id?.endsWith(`:voice:${key}`) && frame.row.audio_reason === "newer_turn");
    return stale && textOnly(publications[0]) && publicationIdentity(publications[0]) && match(key, "not_heard") &&
      envelope(key, "not_heard", "reply_not_heard", "note") ? pass("Stale admission and confirmed not-heard notice match") : pending();
  }
  if (id === "T04a") {
    if (publications.length > 3 || !distinct || publications.some((item) => status(item) === "rejected")) return fail("Three distinct replies must be accepted");
    if (!complete(3)) return pending();
    const sequence = orderedPlayback(ids);
    if (sequence === "fail") return fail("Replies must play once in FIFO order and be heard");
    if (ids.some((key) => envelopeGap(key)) || !caseIdentity()) return pending();
    if (publications.some((item) => item.args.epoch !== publications[0].args.epoch || item.args.session_id !== publications[0].args.session_id ||
      item.args.revision !== publications[0].args.revision)) return fail("Three replies crossed epochs or sessions");
    if (sequence === "fail" || ids.some((key) => contradictory(key, "heard") || misses.some((row) => row.utterance_id === key))) return fail("Replies must play once in FIFO order and be heard");
    return sequence === "complete" && ids.every((key) => match(key, "heard")) ? pass("Three replies played once in order and were heard") : pending();
  }
  if (id === "T04b" || id === "T05") {
    if (!publications.length) return pending();
    if (publications.length > 3 || !distinct || publications.some((item) => status(item) === "rejected")) return fail("Three distinct replies must be accepted");
    if (!complete(3)) return pending();
    const cutKey = id === "T04b" ? ids[0] : ids[1];
    const cutOutcome = misses.find((row) => row.utterance_id === cutKey && ["partial", "not_heard"].includes(row.fate))?.fate ??
      semantic(cutKey).filter((value) => ["partial", "not_heard"].includes(value.outcome))
        .sort((a, b) => (b.heard_chars ?? 0) - (a.heard_chars ?? 0))[0]?.outcome ?? "partial";
    const expected = id === "T04b" ? [cutOutcome, "not_heard", "not_heard"] : ["heard", cutOutcome, "not_heard"];
    if (ids.some((key, index) => contradictory(key, expected[index]) || (index && expected[index] === "not_heard" && !noAudio(key)) || wrongMiss(key, expected[index])) ||
      misses.filter((row) => ids.includes(row.utterance_id)).length > 3) return fail("Reply hearing or playback contradicts the ordered outcome");
    if (physical(cutKey).some((frame) => ["heard", "playback_finished"].includes(frame.status))) return fail("Cut reply already finished playing");
    const opened = qualifiedTurn();
    if (opened && (opened.epoch <= publications[0].args.epoch || publications.some((item) => item.args.epoch !== publications[0].args.epoch)))
      return fail("Interrupting turn did not advance a single reply epoch");
    const found = ids.every((key, index) => match(key, expected[index]) && (expected[index] === "heard" ||
      envelope(key, expected[index], "reply_not_heard", "voice")));
    const firstStart = started(ids[0]), firstEnd = physical(ids[0]).find((frame) => frame.status === "heard");
    const cutStart = started(cutKey), cutStop = stopped(cutKey);
    if (opened && cutStart && cutStop && (opened.at <= publications.at(-1).at ||
      id === "T04b" && !(cutStart.at < opened.at && opened.at < cutStop.at) ||
      id === "T05" && firstStart && firstEnd && !(firstStart.at < firstEnd.at && firstEnd.at < cutStart.at &&
        cutStart.at < opened.at && opened.at < cutStop.at)))
      return fail("Qualified turn did not interrupt the intended playing reply");
    const playbackOk = id === "T04b" ? Boolean(cutStart && cutStop) :
      Boolean(firstStart && firstEnd && cutStart && cutStop);
    return found && playbackOk && opened && caseIdentity() && note("reply_not_heard") ? pass("Matched heard, partial, and not-heard outcomes") : pending();
  }
  if (id === "T06a") {
    if (publications.length < 2) return pending();
    const [first, second] = ids;
    const mute = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "agents_muted");
    const phase = events.findIndex((event) => event.kind === "script-phase" && event.data?.id === "T06a" && event.data.phase === 2);
    const beforeMute = started(first), cut = stopped(first);
    if (publications.some((item) => status(item) === "rejected") || good(status(publications[1])) && !textOnly(publications[1]) || !noAudio(second) ||
      semantic(second).some((value) => value.outcome !== "not_heard") ||
      semantic(first).some((value) => !["partial", "not_heard"].includes(value.outcome)) ||
      physical(first).some((frame) => frame.status === "heard")) return fail("Mute policy must stop audio and report generic hearing outcomes");
    if (!mute || !beforeMute || !cut || cut.status !== "interrupted" || phase < 0 ||
      !(beforeMute.at < mute.at && mute.at < cut.at && cut.at < phase && phase < publications[1].at) ||
      !semantic(first).length || !match(second, "not_heard") || !complete(2) || !caseIdentity()) return pending("Insufficient ordered mute, hearing, and second-phase evidence");
    return pass("Mute stopped audio; both semantic outcomes were confirmed");
  }
  if (id === "T06b") {
    if (!publications.length) return pending();
    const off = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "voice_off");
    if (publications.some((item) => status(item) === "rejected" || good(status(item)) && !textOnly(item) ||
      !noAudio(item.args.utterance_id) || contradictory(item.args.utterance_id, "not_heard"))) return fail("Voice-off publication must have no audio and generic not-heard outcome");
    if (off && publications.some((item) => off.at >= item.at)) return fail("Output was turned off after publication");
    return off && caseIdentity() && publications.every((item) => textOnly(item) && match(item.args.utterance_id, "not_heard")) ?
      pass("Voice-off publication was confirmed not heard") : pending();
  }
  if (id === "T06d") {
    if (!publications.length) return pending();
    const key = ids[0], returned = note("user_returned"), row = returned?.unheard?.replies?.find((item) => item.utterance_id === key);
    const mute = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "agents_muted");
    const back = frames.find((frame) => frame.type === "voice-speech" && frame.on === true && frame.at > publications[0].at);
    if (publications.length !== 1 || status(publications[0]) === "rejected" || good(status(publications[0])) && !textOnly(publications[0]) ||
      !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard") ||
      (returned && (returned.channel !== "note" || returned.text !== "" || !row || returned.unheard.count < 1))) return fail("Return must identify the confirmed missed reply without replay");
    if (back && returned && Number.isFinite(back.source_at) && Number.isFinite(returned.source_at) &&
      returned.source_at - back.source_at < 4750) return fail("Return notice preceded five seconds of eligible silence");
    return mute && back && returned && back.at < returned.at && Number.isFinite(back.source_at) && Number.isFinite(returned.source_at) &&
      returned.source_at - back.source_at >= 4750 && textOnly(publications[0]) && caseIdentity() &&
      match(key, "not_heard") && envelope(key, "not_heard", "user_returned", "note") ?
      pass("Return notice identified the confirmed not-heard reply") : pending();
  }
  if (id === "T08") {
    const typed = frames.find((frame) => frame.type === "typed-message" && frame.status >= 200 && frame.status < 300);
    const baseline = events.find((event) => event.kind === "script-start")?.data?.epoch ?? publications[0]?.args?.epoch;
    if (typed && Number.isInteger(baseline) && typed.epoch !== baseline) return fail("Typing advanced the epoch");
    if (publications.length > 2 || !distinct) return fail("Typing case needs two distinct replies");
    if (!complete(2)) return pending();
    const sequence = orderedPlayback(ids), first = physical(ids[0]);
    if (sequence === "fail" || ids.some((key) => contradictory(key, "heard") || misses.some((row) => row.utterance_id === key))) return fail("Typing must not interrupt, resume, or replay audio");
    if (sequence === "complete" && typed && !(first[0].at < typed.at && typed.at < first[1].at)) return fail("Typing must occur during continuous first playback");
    return sequence === "complete" && typed && Number.isInteger(baseline) && caseIdentity() &&
      publications.every((item) => publicationEpoch(item, baseline)) && ids.every((key) => match(key, "heard")) ?
      pass("Typing kept the epoch and uninterrupted hearing") : pending();
  }
  if (id === "T12") {
    if (publications.length > 2 || !distinct) return fail("Skip case needs two distinct replies");
    if (!complete(2)) return pending();
    const [first, second] = ids;
    const click = frames.find((frame) => frame.type === "ui-click" && frame.control === "skip-reply");
    const firstStart = started(first), secondStart = started(second);
    if (ids.some((key) => contradictory(key, "heard") || misses.some((row) => row.utterance_id === key)) ||
      physical(first).filter((frame) => frame.status === "playing").length > 1 ||
      physical(first).some((frame) => frame.status === "heard") || orderedPlayback([second]) === "fail")
      return fail("Skip is local; both replies must be semantically heard without replay");
    const stop = stopped(first), secondEnd = physical(second).find((frame) => frame.status === "heard");
    if (stop && secondStart && stop.at >= secondStart.at || stop && secondEnd && stop.at >= secondEnd.at ||
      Number.isInteger(baselineEpoch) && publications.some((item) => Number.isInteger(item.args.epoch) && item.args.epoch !== baselineEpoch) ||
      startFrames.some((frame) => Number.isInteger(baselineEpoch) && frame.epoch > baselineEpoch))
      return fail("Skip changed epoch or stopped after the next reply began");
    if (!click || !firstStart || !stopped(first) || !secondStart || !physical(second).some((frame) => frame.status === "heard") ||
      !(firstStart.at < click.at && click.at < stop.at && stop.at < secondStart.at) || !caseIdentity() ||
      !Number.isInteger(baselineEpoch) || !ids.every((key) => match(key, "heard"))) return pending();
    return pass("Local skip counted as heard; next reply played without a skip notice");
  }
  return pending();
}
