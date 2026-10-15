// A check only passes when the whole scripted outcome is observed. Missing evidence
// remains pending; a contradictory terminal outcome is a failure.
const MANUAL = new Set(["T06c", "T06e", "T07", "T09a", "T09b", "T10", "T11", "T13", "T14", "T15", "T16"]);
const good = (status) => ["accepted", "queued", "spoken", "published"].includes(status);
const terminal = (fate) => ["played", "skipped", "cut", "refused", "stale", "not played"].includes(fate);
const check = (state, reason) => ({ state, reason });
const pending = (reason = "Insufficient case evidence") => check("pending", reason);
const pass = (reason) => check("pass", reason);
const fail = (reason) => check("fail", reason);

export function initialChecks(ids) {
  return Object.fromEntries(ids.map((id) => [id, MANUAL.has(id) ? check("manual", "Follow the case instruction and review the room and exported trace") : pending()]));
}

export function verdict(id, events, fates) {
  const conversation = events.find((event) => event.kind === "script-start")?.data?.conversation;
  if (conversation) events = events.filter((event) => !event.data?.conversation || event.data.conversation === conversation);
  const publications = events.filter((event) => event.kind === "tool-result" && event.data?.name === "voice_say")
    .map((event) => ({ id: event.data.args?.utterance_id, result: event.data.result ?? {}, args: event.data.args ?? {} }));
  const ids = publications.map((item) => item.id).filter(Boolean);
  const distinct = new Set(ids);
  const frames = events.filter((event) => ["room-frame", "browser-action"].includes(event.kind)).map((event) => event.data);
  const inputs = events.filter((event) => event.kind === "agent-input").map((event) => event.data);
  const notes = inputs.filter((input) => input.notice).map((input) => input.notice);
  const unheard = inputs.flatMap((input) => input.unheard?.replies ?? []);
  const fate = (key) => fates.get(key)?.fate;
  const note = (kind) => notes.some((item) => item.kind === kind);
  const status = (item) => item.result?.status ?? item.result?.result?.status;
  const textOnly = (item, reason) => good(status(item)) && item.result?.audio === "text_only" && item.result?.reason === reason;
  const completed = (count) => publications.length >= count && ids.length === publications.length && distinct.size === publications.length;
  const duplicate = ids.length !== distinct.size;
  const unheardIds = unheard.map((item) => item.utterance_id);
  const unstarted = (key) => unheard.some((item) => item.utterance_id === key && item.reason === "newer_turn" && item.cut === false && item.heard_chars == null);
  const matches = (frame, key) => frame.utterance_id === key || frame.utterance_ids?.includes(key) ||
    (frame.type === "history" && frame.row?.role === "assistant" && frame.row.id?.endsWith(`:voice:${key}`));
  const observed = (key, predicate) => frames.some((frame) => matches(frame, key) && predicate(frame));
  const begun = (key) => observed(key, (frame) => frame.type === "voice-playback" && frame.status === "playing");
  const played = (key) => observed(key, (frame) => frame.type === "voice-playback" && ["playing", "heard", "playback_finished"].includes(frame.status) ||
    frame.type === "history" && (frame.row?.globally_heard || ["playing", "playback_finished"].includes(frame.row?.status)));
  const audible = (key) => played(key) || observed(key, (frame) => frame.type === "voice-playback" && frame.status === "interrupted" && frame.cut !== false ||
    frame.type === "history" && Number.isInteger(frame.row?.heard_chars) && frame.row.heard_chars > 0);
  const hasAssistantRow = (key) => observed(key, (frame) => ["voice-reply", "voice-playback", "history"].includes(frame.type)) || unheardIds.includes(key);
  const legalExtent = (value, text) => Number.isInteger(value) && value >= 0 && value <= [...text].length;
  const actionAt = (predicate) => events.findIndex((event) => ["room-frame", "browser-action"].includes(event.kind) && predicate(event.data));
  const outputDisabled = (reason) => actionAt((frame) => frame.type === "voice-speech" && frame.reason === reason && (frame.on === false || frame.data?.on === false));
  let result = MANUAL.has(id) ? check("manual", "Follow the case instruction and review the room and exported trace") : pending();

  if (["T02c", "T02d"].includes(id) && publications.length) {
    const refused = publications.every((item) => status(item) === "rejected" && item.result?.reason === "user_speaking");
    const refusalAt = events.findIndex((event) => event.kind === "tool-result" && event.data?.name === "voice_say");
    const terminal = events.slice(refusalAt + 1).some((event) => event.kind === "agent-input" &&
      (id === "T02c" ? event.data?.channel === "voice" && Boolean(event.data.text) :
        event.data?.channel === "note" && event.data.text === "" && event.data.notice?.kind === "turn_empty"));
    if (!refused || publications.length !== 1 || publications.some((item) => item.result?.audio === "queued" || item.result?.text_saved === true))
      result = fail("Open-turn publication must be refused specifically for user_speaking");
    else if (ids.some(hasAssistantRow)) result = fail("Refused speech must have no assistant row, queued audio, or unheard evidence");
    else if (terminal) result = pass(id === "T02c" ? "Open-turn refusal and spoken words reached the agent" : "Open-turn refusal and empty-turn notice reached the agent");
  }
  if (id === "T01" && publications.length && unheard.length) {
    const item = unheard.find((row) => ids.includes(row.utterance_id));
    const cutAt = events.findIndex((event) => event.kind === "agent-input" && event.data?.unheard?.replies?.some((row) => row.utterance_id === item?.utterance_id && row.fate === "interrupted" && row.cut === true));
    const resumed = cutAt >= 0 && events.slice(cutAt + 1).some((event) => ["room-frame", "browser-action"].includes(event.kind) &&
      (event.data?.utterance_id === item?.utterance_id || event.data?.row?.id?.endsWith(`:voice:${item?.utterance_id}`)) &&
      ((event.data?.type === "voice-playback" && ["playing", "heard", "playback_finished"].includes(event.data.status)) ||
       (event.data?.type === "history" && (event.data?.row?.globally_heard || event.data?.row?.status === "playback_finished"))));
    const text = publications[0]?.args.text;
    const startAt = actionAt((frame) => frame.type === "voice-playback" && frame.status === "playing" && frame.utterance_id === item?.utterance_id);
    const cutReceiptAt = actionAt((frame) => frame.type === "voice-playback" && frame.status === "interrupted" &&
      frame.reason === "user_interrupted" && frame.utterance_id === item?.utterance_id);
    const cutReceipt = events[cutReceiptAt];
    const spokenWithCut = events.slice(cutAt).some((event) => event.kind === "agent-input" && event.data?.channel === "voice" && Boolean(event.data.text) &&
      event.data.unheard?.replies?.some((row) => row.utterance_id === item?.utterance_id && row.cut === true));
    if (!item || publications.length !== 1 || !good(status(publications[0])) || item.fate !== "interrupted" || item.reason !== "user_interrupted" || item.cut !== true ||
      typeof text !== "string" || !legalExtent(item.heard_chars, text) || item.text !== text || fate(item.utterance_id) === "played" || resumed ||
      (cutReceiptAt >= 0 && events.slice(cutReceiptAt + 1, cutAt < 0 ? undefined : cutAt).some((event) =>
        ["room-frame", "browser-action"].includes(event.kind) && event.data?.type === "voice-playback" &&
        event.data.utterance_id === item.utterance_id && ["playing", "heard"].includes(event.data.status))) ||
      observed(item.utterance_id, (frame) => frame.type === "voice-playback" && frame.status === "heard" ||
        frame.type === "history" && (frame.row?.globally_heard || frame.row?.status === "playback_finished")))
      result = fail("Interrupted reply needs a legal matched extent and must never finish or resume");
    else if (startAt < 0 || cutReceiptAt <= startAt || cutAt <= cutReceiptAt || !legalExtent(cutReceipt.data.heard_chars, text) ||
      cutReceipt.data.heard_chars > item.heard_chars || !spokenWithCut)
      result = pending("Insufficient playback start, cut receipt, or matched spoken input");
    else result = pass("Matched playback start, legal cut extent, and spoken input");
  }
  if (["T02a", "T02b"].includes(id) && publications.length && unheard.length) {
    const publication = publications[0], key = ids[0];
    const publishedAt = events.findIndex((event) => event.kind === "tool-result" && event.data?.args?.utterance_id === key);
    const matchedAt = events.findIndex((event, index) => index > publishedAt && event.kind === "agent-input" &&
      event.data?.unheard?.replies?.some((row) => row.utterance_id === key) &&
      (id === "T02a" ? event.data.channel === "voice" && Boolean(event.data.text) && event.data.notice?.kind === "reply_not_played" :
        event.data.channel === "note" && event.data.text === "" && event.data.notice?.kind === "turn_empty"));
    const matched = events[matchedAt]?.data;
    const record = matched?.unheard.replies.find((row) => row.utterance_id === key);
    if (publications.length !== 1 || !completed(1) || !good(status(publication)) || audible(key) ||
      ["played", "cut", "skipped"].includes(fate(key)) || unheard.some((row) => row.utterance_id === key &&
        (row.cut !== false || row.heard_chars != null || !["interrupted", "unplayed"].includes(row.fate) || row.text !== publication.args.text)))
      result = fail("Accepted unstarted reply cannot have playback or contradictory unheard evidence");
    else if (!matched || !record || record.reason !== "newer_turn" || record.text !== publication.args.text || !unstarted(key))
      result = pending("Insufficient matched unstarted evidence with the spoken or empty outcome");
    else result = pass("Accepted reply stayed unstarted and reached the matching outcome");
  }
  if (id === "T03" && publications.length && (note("reply_not_played") || unheard.length)) {
    const stale = publications.some((item) => textOnly(item, "newer_turn") && item.id);
    const matched = unheard.some((item) => ids.includes(item.utterance_id) && item.reason === "newer_turn");
    result = stale && matched && note("reply_not_played") && ids.every((key) => !played(key) && fate(key) !== "played") ? pass("Stale admission and matched not-played notice") : fail("Stale admission and not-played notice must identify the same reply without playback");
  }
  if (id === "T04a") {
    if (duplicate || publications.some((item) => status(item) === "rejected")) result = fail("Three distinct publications must be accepted");
    else if (completed(3)) {
      const started = frames.filter((frame) => frame.type === "voice-playback" && frame.status === "playing")
        .map((frame) => frame.utterance_id).filter((key) => ids.includes(key));
      if (started.length >= 3 && ids.some((key, index) => started.indexOf(key) !== index)) result = fail("Replies started out of publication order");
      else if (ids.some((key) => terminal(fate(key)) && fate(key) !== "played")) result = fail("All three replies must be heard");
      else if (started.length >= 3 && ids.every((key) => fate(key) === "played")) result = pass("Three distinct replies began in order and were heard");
    }
  }
  if (id === "T04b" && (publications.length >= 3 || unheard.length >= 3)) {
    if (!completed(3) || unheardIds.length !== new Set(unheardIds).size || ids.some((key) => !unheardIds.includes(key)))
      result = fail("Three distinct publications need three matched unheard replies");
    else if (ids.every((key, index) => index === 0 ? fate(key) === "cut" : ["not played", "stale"].includes(fate(key))))
      result = pass("First reply cut and both queued replies were not played");
    else if (ids.some((key) => terminal(fate(key)))) result = fail("First reply must cut; both queued replies must stay unplayed");
  }
  if (id === "T05" && (publications.length >= 3 || note("reply_interrupted"))) {
    if (duplicate || (publications.length >= 3 && !completed(3))) result = fail("Checkpoint case needs three distinct publications");
    else if (completed(3)) {
      const [first, second, third] = ids;
      const complete = [first, second, third].every((key) => terminal(fate(key))) && note("reply_interrupted");
      if (complete) result = fate(first) === "played" && fate(second) === "cut" && Number.isInteger(fates.get(second)?.heard_chars) && ["not played", "stale"].includes(fate(third))
        ? pass("Acknowledgement heard, checkpoint cut, result unplayed") : fail("Checkpoint sequence or cut extent is wrong");
    }
  }
  if (id === "T06a" && publications.length >= 2) {
    const muteAt = outputDisabled("agents_muted");
    const firstAt = events.findIndex((event) => event.kind === "tool-result" && event.data?.args?.utterance_id === ids[0]);
    const secondAt = events.findIndex((event) => event.kind === "tool-result" && event.data?.args?.utterance_id === ids[1]);
    const phaseAt = events.findIndex((event) => event.kind === "script-phase" && event.data?.id === "T06a" && event.data.phase === 2);
    const cutAt = actionAt((frame) => frame.type === "voice-playback" && frame.utterance_id === ids[0] &&
      frame.status === "interrupted");
    const withdrawalAt = actionAt((frame) => frame.type === "voice-reply-withdrawn" &&
      frame.utterance_ids?.includes(ids[0]) && frame.reason === "agents_muted");
    const cutReason = events[cutAt]?.data?.reason ?? fates.get(ids[0])?.reason;
    if (!completed(2) || publications.length !== 2 || audible(ids[1]) || ["played", "cut", "skipped"].includes(fate(ids[1])) ||
      fate(ids[0]) === "played" || !textOnly(publications[1], "agents_muted") ||
      (cutAt >= 0 && cutReason && cutReason !== "agents_muted"))
      result = fail("Mute must cut the playing reply and save the second without audio");
    else if (muteAt < 0 || firstAt < 0 || secondAt < 0 || phaseAt < 0 || cutAt < 0 ||
      (cutReason !== "agents_muted" && withdrawalAt < 0) ||
      !events.slice(firstAt + 1, muteAt).some((event) => ["room-frame", "browser-action"].includes(event.kind) &&
        event.data?.type === "voice-playback" && event.data.utterance_id === ids[0] && event.data.status === "playing") ||
      !(firstAt < muteAt && muteAt < cutAt && cutAt < phaseAt && phaseAt < secondAt) ||
      (withdrawalAt >= 0 && !(muteAt < withdrawalAt && withdrawalAt < phaseAt)) || fate(ids[0]) !== "cut")
      result = pending("Insufficient ordered playback, mute, and second-phase evidence");
    else result = pass("Playing reply cut; second-phase publication saved without audio");
  }
  if (id === "T06b" && outputDisabled("voice_off") >= 0 && publications.length) {
    result = publications.every((item) => textOnly(item, "voice_off") && !played(item.id))
      ? pass("Voice-off publication stayed text only") : fail("Voice-off publication must not play");
  }
  if (id === "T06d" && publications.length && note("user_returned")) {
    const key = ids[0], muteAt = outputDisabled("agents_muted");
    const publishedAt = events.findIndex((event) => event.kind === "tool-result" && event.data?.args?.utterance_id === key);
    const returnAt = events.findIndex((event) => event.kind === "agent-input" && event.data?.notice?.kind === "user_returned");
    const backAt = events.findIndex((event, index) => index > publishedAt && ["room-frame", "browser-action"].includes(event.kind) &&
      event.data?.type === "voice-speech" && (event.data.on === true || event.data.data?.on === true));
    const returned = events[returnAt]?.data;
    const matched = returned?.unheard?.replies?.find((row) => row.utterance_id === key);
    if (publications.length !== 1 || !textOnly(publications[0], "agents_muted") || audible(key) ||
      ["played", "cut", "skipped"].includes(fate(key)) || returned?.channel !== "note" || returned.text !== "" ||
      !matched || matched.text !== publications[0].args.text || matched.reason !== "agents_muted" ||
      matched.cut !== false || matched.heard_chars != null || !["unplayed", "interrupted"].includes(matched.fate) ||
      returned.unheard.count === 0)
      result = fail("Return notice must identify the saved missed reply without replay");
    else if (muteAt < 0 || publishedAt < muteAt || backAt < 0 || returnAt < backAt)
      result = pending("Insufficient observed mute, return, and matched notice sequence");
    else result = pass("Observed return notice identified the missed reply without replay");
  }
  if (id === "T08") {
    const typed = frames.find((frame) => frame.type === "typed-message" && frame.status >= 200 && frame.status < 300);
    const start = events.find((event) => event.kind === "script-start")?.data;
    const baseline = start?.epoch ?? publications[0]?.args?.epoch ?? frames.find((frame) => Number.isInteger(frame.epoch) && frame !== typed)?.epoch;
    if (typed && Number.isInteger(baseline) && typed.epoch !== baseline) result = fail("Typing advanced the conversation epoch");
    else if (typed && publications.length >= 2) {
      if (!completed(2)) result = fail("Typing case needs two distinct replies");
      else if (ids.some((key) => terminal(fate(key)) && fate(key) !== "played")) result = fail("Typing must not interrupt or invalidate either reply");
      else if (Number.isInteger(baseline) && ids.every((key) => fate(key) === "played")) result = pass("Typing kept the starting epoch and both replies played");
    }
  }
  if (id === "T12" && (publications.length >= 2 || note("reply_skipped"))) {
    if (duplicate) result = fail("Skip case needs two distinct publications");
    else if (completed(2)) {
      const [first, second] = ids;
      const playedAfterSkip = events.some((event, index) => event.kind === "browser-action" && event.data?.utterance_id === first && event.data?.reason === "user_skipped" &&
        events.slice(index + 1).some((later) => ["browser-action", "room-frame"].includes(later.kind) && later.data?.utterance_id === first && later.data?.type === "voice-playback" && ["playing", "heard"].includes(later.data.status)));
      if (terminal(fate(first)) && fate(first) !== "skipped" || terminal(fate(second)) && fate(second) !== "played" || unheard.some((item) => item.utterance_id === first) || playedAfterSkip)
        result = fail("Skip must mark the first heard by choice and still play the next reply");
      else if (note("reply_skipped") && fate(first) === "skipped" && fate(second) === "played") result = pass("First reply skipped; second played; skip notice reached agent");
    }
  }
  return result;
}
