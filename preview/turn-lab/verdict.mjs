// A check only passes when the whole scripted outcome is observed. Missing evidence
// remains pending; a contradictory terminal outcome is a failure.
const MANUAL = new Set(["T06c", "T06e", "T07", "T09a", "T09b", "T10", "T11", "T13", "T14", "T15", "T16"]);
const good = (status) => ["accepted", "queued", "spoken", "published"].includes(status);
const terminal = (fate) => ["played", "skipped", "cut", "refused", "stale", "not played"].includes(fate);
const check = (state, reason) => ({ state, reason });
const pending = (reason = "Awaiting complete case evidence") => check("pending", reason);
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
  const unknown = publications.some((item) => status(item) === "admission_unknown");
  const completed = (count) => publications.length >= count && ids.length === publications.length && distinct.size === publications.length;
  const duplicate = ids.length !== distinct.size;
  const unheardIds = unheard.map((item) => item.utterance_id);
  const unstarted = (key) => unheard.some((item) => item.utterance_id === key && item.reason === "newer_turn" && item.cut === false && item.heard_chars == null);
  const begun = (key) => frames.some((frame) => frame.type === "voice-playback" && frame.status === "playing" && frame.utterance_id === key);
  const outputDisabled = (reason) => frames.some((frame) => frame.type === "voice-speech" && frame.reason === reason && (frame.on === false || frame.data?.on === false));
  let result = MANUAL.has(id) ? check("manual", "Follow the case instruction and review the room and exported trace") : pending();

  if (["T02c", "T02d"].includes(id) && publications.length) {
    const refused = publications.every((item) => status(item) === "rejected" && item.result?.reason === "user_speaking");
    if (!refused) result = fail("Open-turn publication must be refused specifically for user_speaking");
    else if (id === "T02c" && inputs.some((input) => input.channel === "voice" && input.text)) result = pass("Open-turn refusal and spoken words reached the agent");
    else if (id === "T02d" && inputs.some((input) => input.channel === "note" && input.text === "" && input.notice?.kind === "turn_empty")) result = pass("Open-turn refusal and empty-turn notice reached the agent");
  }
  if (id === "T01" && publications.length && unheard.length) {
    const item = unheard.find((row) => ids.includes(row.utterance_id));
    if (!item || item.fate !== "interrupted" || item.cut !== true || !Number.isInteger(item.heard_chars) || !inputs.some((input) => input.channel === "voice" && input.text))
      result = fail("Interrupted reply needs a matched cut extent and spoken input");
    else result = pass("Matched interrupted reply, cut extent, and spoken input");
  }
  if (["T02a", "T02b"].includes(id) && publications.length && unheard.length) {
    const properInput = id === "T02a" ? inputs.some((input) => input.channel === "voice" && input.text) :
      inputs.some((input) => input.channel === "note" && input.text === "" && input.notice);
    if (!completed(1) || !good(status(publications[0])) || !unstarted(ids[0]) || begun(ids[0]) || !properInput)
      result = fail("Accepted reply must never start and reach the matching spoken or empty outcome");
    else result = pass("Accepted reply stayed unstarted and reached the matching outcome");
  }
  if (id === "T03" && publications.length && (note("reply_not_played") || unheard.length)) {
    const stale = publications.some((item) => status(item) === "text_only" && item.result?.reason === "newer_turn" && item.id);
    const matched = unheard.some((item) => ids.includes(item.utterance_id) && item.reason === "newer_turn");
    result = stale && matched && note("reply_not_played") ? pass("Stale admission and matched not-played notice") : fail("Stale admission and not-played notice must identify the same reply");
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
  if (id === "T06a" && outputDisabled("agents_muted") && publications.length >= 2) {
    if (!completed(2)) result = fail("Muted case needs two distinct publications");
    else result = fate(ids[0]) === "cut" && status(publications[1]) === "text_only" && publications[1].result?.reason === "agents_muted" && fate(ids[1]) !== "played"
      ? pass("Playing reply cut; muted publication saved without audio") : fail("Mute must cut playback and keep later speech text only");
  }
  if (id === "T06b" && outputDisabled("voice_off") && publications.length) {
    result = publications.every((item) => status(item) === "text_only" && item.result?.reason === "voice_off" && fate(item.id) !== "played")
      ? pass("Voice-off publication stayed text only") : fail("Voice-off publication must not play");
  }
  if (id === "T06d" && publications.length && note("user_returned")) {
    const missed = ids.every((key) => publications.find((item) => item.id === key)?.result?.audio === "text_only" || status(publications.find((item) => item.id === key)) === "text_only");
    result = missed && ids.every((key) => fate(key) !== "played" && !begun(key))
      ? pass("Return notice followed missed text without replay") : fail("Missed speech must not replay on return");
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
      if (terminal(fate(first)) && fate(first) !== "skipped" || terminal(fate(second)) && fate(second) !== "played" || unheard.some((item) => item.utterance_id === first && item.reason === "user_skipped"))
        result = fail("Skip must mark the first heard by choice and still play the next reply");
      else if (note("reply_skipped") && fate(first) === "skipped" && fate(second) === "played") result = pass("First reply skipped; second played; skip notice reached agent");
    }
  }
  if (unknown && result.state !== "fail" && result.state !== "pass")
    result = check("known-limitation", "Core cannot recover the original saved/refused outcome of uncertain speech admission");
  return result;
}
