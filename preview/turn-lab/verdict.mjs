// Physical playback proves ordering. Only reply-hearing, semantic history and
// the agent envelope prove hearing; operational stop reasons never do.
const MANUAL = new Set(["T06c", "T06e", "T07", "T09a", "T09b", "T10", "T11", "T13", "T14", "T15", "T16"]);
const good = (status) => ["accepted", "queued", "spoken", "published"].includes(status);
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
  const publications = events.filter((event) => event.kind === "tool-result" && event.data?.name === "voice_say")
    .map((event) => ({ args: event.data.args ?? {}, result: event.data.result ?? {}, at: events.indexOf(event) }));
  const ids = publications.map((item) => item.args.utterance_id);
  const frames = events.flatMap((event, at) => ["room-frame", "browser-action"].includes(event.kind) ? [{ ...event.data, at }] : []);
  const inputs = events.flatMap((event, at) => event.kind === "agent-input" ? [{ ...event.data, at }] : []);
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
  const semantic = (key) => frames.filter((frame) => frame.type === "reply-hearing" && frame.utterance_id === key).map((frame) => ({ outcome: frame.outcome, heard_chars: frame.heard_chars, at: frame.at }))
    .concat(frames.filter((frame) => frame.type === "history" && frame.row?.role === "assistant" && frame.row.id?.endsWith(`:voice:${key}`) && frame.row.hearing)
      .map((frame) => ({ outcome: frame.row.hearing, heard_chars: frame.row.heard_chars, at: frame.at })));
  const hearing = (key) => fates.get(key)?.fate;
  const text = (key) => publications.find((item) => item.args.utterance_id === key)?.args.text;
  const valid = (value, key) => value?.outcome === "heard" ? (value.heard_chars == null || value.heard_chars === length(text(key))) :
    value?.outcome === "not_heard" ? (value.heard_chars == null || value.heard_chars === 0) :
    value?.outcome === "partial" && Number.isInteger(value.heard_chars) && value.heard_chars >= 0 && value.heard_chars < length(text(key));
  const match = (key, expected) => semantic(key).some((value) => value.outcome === expected && valid(value, key));
  const contradictory = (key, expected) => semantic(key).some((value) => !valid(value, key) || value.outcome !== expected);
  const miss = (key, expected) => misses.find((row) => row.utterance_id === key && row.fate === expected && row.text === text(key) &&
    !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "cut") && valid({ outcome: row.fate, heard_chars: row.heard_chars }, key));
  const wrongMiss = (key, expected) => misses.some((row) => row.utterance_id === key &&
    (row.fate !== expected || row.text !== text(key) || Object.hasOwn(row, "reason") || Object.hasOwn(row, "cut") || !valid({ outcome: row.fate, heard_chars: row.heard_chars }, key)));
  const noAudio = (key) => !physical(key).some((frame) => ["playing", "heard", "playback_finished"].includes(frame.status));
  const textOnly = (item) => good(status(item)) && item.result.audio === "text_only";
  const distinct = ids.length === new Set(ids).size && ids.every(Boolean);
  const complete = (n) => publications.length === n && distinct && publications.every((item) => good(status(item)));
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
  if (ids.some((key) => semantic(key).some((value) => !valid(value, key)))) return fail("Invalid semantic hearing extent");
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
    const terminal = inputs.find((input) => input.at > item.at && (id === "T02c" ? input.channel === "voice" && input.text :
      input.channel === "note" && input.text === "" && input.notice?.kind === "turn_empty"));
    return terminal ? pass("Refusal and terminal user outcome reached the agent") : pending();
  }
  if (id === "T01") {
    if (!publications.length) return pending();
    const key = ids[0], item = misses.find((row) => row.utterance_id === key && ["partial", "not_heard"].includes(row.fate) &&
      row.text === text(key) && !Object.hasOwn(row, "reason") && !Object.hasOwn(row, "cut") && valid({ outcome: row.fate, heard_chars: row.heard_chars }, key)),
      begin = started(key), stop = stopped(key);
    if (!good(status(publications[0])) || (item && (wrongMiss(key, item.fate) || contradictory(key, item.fate))) ||
      physical(key).some((frame) => ["heard", "playback_finished"].includes(frame.status)) ||
      physical(key).filter((frame) => frame.status === "playing").length > 1 ||
      (item && hearing(key) !== item.fate)) return fail("Interrupted reply needs a matched partial extent and no resumed playback");
    if (!item || !begin || !stop || stop.status !== "interrupted" || !match(key, item?.fate) || !spoken ||
      !(begin.at < stop.at && stop.at < item.at) || !Number.isInteger(stop.heard_chars) || stop.heard_chars > item.heard_chars)
      return pending("Insufficient playback, semantic cut, or spoken input");
    return pass("Original reply partially heard; new-epoch replies remain allowed");
  }
  if (["T02a", "T02b"].includes(id)) {
    if (!publications.length) return pending();
    const key = ids[0], expected = id === "T02a" ? inputs.find((input) => input.channel === "voice" && input.text && input.notice?.kind === "reply_not_heard") : note("turn_empty");
    if (!complete(1) || !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard") || hearing(key) === "heard" || hearing(key) === "partial")
      return fail("Accepted unstarted reply cannot be heard or carry contradictory evidence");
    if (!expected || !miss(key, "not_heard") || !match(key, "not_heard")) return pending("Insufficient matched unstarted evidence");
    return pass("Accepted reply remained unstarted and was confirmed not heard");
  }
  if (id === "T03") {
    if (!publications.length) return pending();
    const key = ids[0];
    if (!textOnly(publications[0]) || !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard")) return fail("Stale reply must remain text only and not heard");
    const stale = frames.some((frame) => frame.type === "history" && frame.row?.id?.endsWith(`:voice:${key}`) && frame.row.audio_reason === "newer_turn");
    return stale && match(key, "not_heard") && miss(key, "not_heard") && note("reply_not_heard") ? pass("Stale admission and confirmed not-heard notice match") : pending();
  }
  if (id === "T04a") {
    if (publications.length > 3 || !distinct || publications.some((item) => status(item) === "rejected")) return fail("Three distinct replies must be accepted");
    if (!complete(3)) return pending();
    const sequence = orderedPlayback(ids);
    if (sequence === "fail" || ids.some((key) => contradictory(key, "heard") || misses.some((row) => row.utterance_id === key))) return fail("Replies must play once in FIFO order and be heard");
    return sequence === "complete" && ids.every((key) => match(key, "heard")) ? pass("Three replies played once in order and were heard") : pending();
  }
  if (id === "T04b" || id === "T05") {
    if (!publications.length) return pending();
    if (publications.length > 3 || !distinct || publications.some((item) => !good(status(item)))) return fail("Three distinct replies must be accepted");
    if (!complete(3)) return pending();
    const cutKey = id === "T04b" ? ids[0] : ids[1];
    const cutOutcome = semantic(cutKey).find((value) => ["partial", "not_heard"].includes(value.outcome))?.outcome ?? "partial";
    const expected = id === "T04b" ? [cutOutcome, "not_heard", "not_heard"] : ["heard", cutOutcome, "not_heard"];
    if (ids.some((key, index) => contradictory(key, expected[index]) || (index && expected[index] === "not_heard" && !noAudio(key)) || wrongMiss(key, expected[index])) ||
      misses.filter((row) => ids.includes(row.utterance_id)).length > 3) return fail("Reply hearing or playback contradicts the ordered outcome");
    const found = ids.every((key, index) => match(key, expected[index]) && (expected[index] === "heard" || miss(key, expected[index])));
    const playbackOk = id === "T04b" ? Boolean(started(ids[0]) && stopped(ids[0])) :
      Boolean(physical(ids[0]).some((frame) => frame.status === "heard") && started(ids[1]) && stopped(ids[1]));
    return found && playbackOk && note("reply_not_heard") ? pass("Matched heard, partial, and not-heard outcomes") : pending();
  }
  if (id === "T06a") {
    if (publications.length < 2) return pending();
    const [first, second] = ids;
    const mute = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "agents_muted");
    const phase = events.findIndex((event) => event.kind === "script-phase" && event.data?.id === "T06a" && event.data.phase === 2);
    const beforeMute = started(first), cut = stopped(first);
    if (!complete(2) || !textOnly(publications[1]) || !noAudio(second) ||
      semantic(second).some((value) => value.outcome !== "not_heard") ||
      semantic(first).some((value) => !["partial", "not_heard"].includes(value.outcome)) ||
      physical(first).some((frame) => frame.status === "heard")) return fail("Mute policy must stop audio and report generic hearing outcomes");
    if (!mute || !beforeMute || !cut || cut.status !== "interrupted" || phase < 0 ||
      !(beforeMute.at < mute.at && mute.at < cut.at && cut.at < phase && phase < publications[1].at) ||
      !semantic(first).length || !match(second, "not_heard")) return pending("Insufficient ordered mute, hearing, and second-phase evidence");
    return pass("Mute stopped audio; both semantic outcomes were confirmed");
  }
  if (id === "T06b") {
    if (!publications.length) return pending();
    const off = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "voice_off");
    if (publications.some((item) => !textOnly(item) || !noAudio(item.args.utterance_id) || contradictory(item.args.utterance_id, "not_heard"))) return fail("Voice-off publication must have no audio and generic not-heard outcome");
    return off && publications.every((item) => match(item.args.utterance_id, "not_heard")) ? pass("Voice-off publication was confirmed not heard") : pending();
  }
  if (id === "T06d") {
    if (!publications.length) return pending();
    const key = ids[0], returned = note("user_returned"), row = returned?.unheard?.replies?.find((item) => item.utterance_id === key);
    const mute = frames.find((frame) => frame.type === "voice-speech" && frame.on === false && frame.reason === "agents_muted");
    const back = frames.find((frame) => frame.type === "voice-speech" && frame.on === true && frame.at > publications[0].at);
    if (publications.length !== 1 || !textOnly(publications[0]) || !noAudio(key) || contradictory(key, "not_heard") || wrongMiss(key, "not_heard") ||
      (returned && (returned.channel !== "note" || returned.text !== "" || !row || returned.unheard.count < 1))) return fail("Return must identify the confirmed missed reply without replay");
    return mute && back && returned && back.at < returned.at && match(key, "not_heard") && miss(key, "not_heard") ?
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
    return sequence === "complete" && typed && Number.isInteger(baseline) && ids.every((key) => match(key, "heard")) ? pass("Typing kept the epoch and uninterrupted hearing") : pending();
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
    if (!click || !firstStart || !stopped(first) || !secondStart || !physical(second).some((frame) => frame.status === "heard") ||
      !(firstStart.at < click.at && click.at < secondStart.at) || !ids.every((key) => match(key, "heard"))) return pending();
    return pass("Local skip counted as heard; next reply played without a skip notice");
  }
  return pending();
}
