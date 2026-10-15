// Checks selected #19 fixture actions against the mock room's real socket and
// presentation handlers, rather than another table of action labels.
import { createWorld } from "./world.mjs";
import { answer, agentSpeaks, callSocket, directUrl, makeIdentities, roomOf } from "./machines.mjs";

export async function probeMockRoom(fixture) {
  if (!["T08", "T11", "T06c"].includes(fixture.id)) return [];
  const world = createWorld({ id: "turn-probe", title: "Turn probe", summary: "", options: [], world: {
    page: "room", machines: { nuc: { host: "NUC", reach: "direct", paired: true, devices: [],
      participants: [{ thread_id: "a", title: "A", reach: "listening" }, { thread_id: "b", title: "B", reach: "listening" }] } }, local: null,
  } });
  const identities = await makeIdentities(world.state);
  const frames = [];
  const socket = callSocket(world, identities, {
    url: `${directUrl("nuc").replace("https:", "wss:")}/api/presentation/ws`,
    protocols: ["sidevoice", `sidevoice.token.${identities.nuc.token}`], pageOrigin: "http://localhost:5198",
  }, { open() {}, message: (raw) => frames.push(JSON.parse(raw)), close() {}, fail() { throw new Error("mock room socket failed"); } });
  const send = (type, data) => socket.send(JSON.stringify({ type, data }));
  const request = (path, body) => answer(world, identities, { pageOrigin: "http://localhost:5198",
    url: `${directUrl("nuc")}${path}`, method: "POST", headers: { authorization: `Bearer ${identities.nuc.token}` }, body: JSON.stringify(body) });
  send("client-ready", { conversation: "a" });
  const session = frames.find((frame) => frame.type === "voice-session")?.data?.session_id;
  if (!session) return ["Mock room did not create a session"];
  const room = roomOf(world, "nuc");
  const call = [...room.calls][0];
  const captured = new Map([["a", call?.binding]]);
  let serial = 0;
  const turn = (phase, id, text, focus) => send("voice-user-turn", { session_id: session, client_msg_id: `case-${++serial}`, phase,
    turn_id: id, ...(phase === "started" ? { thread_id: focus?.thread_id, binding_id: focus?.binding_id } : {}), ...(text ? { text } : {}) });
  const playback = (id, status) => send("voice-playback", { session_id: session, client_msg_id: `case-${++serial}`,
    utterance_id: id, status });
  const failures = [];
  try {
    if (["T11", "T06c"].includes(fixture.id)) {
      let switched = false;
      for (const action of fixture.actions) {
        if (action.type === "reply-playing") {
          agentSpeaks(world, "A's reply");
          const utterance = frames.filter((frame) => frame.type === "voice-reply").at(-1)?.data?.utterance_id;
          if (utterance) playback(utterance, "playing");
        }
        if (action.type === "conversation-a") turn("started", action.turnId ?? "a-turn-1", null, captured.get("a"));
        if (action.type === "focus-switch") {
          const selected = await request("/api/presentation/select", { session_id: session, thread_id: "b" });
          if (selected.status !== 200) failures.push("Mock room refused conversation B");
          captured.set("b", call.binding);
          switched = true;
          if (room.rows.some((row) => row.role === "user" && row.thread === "a"))
            failures.push("Focus switch flushed A before its normal turn end");
        }
        if (action.type === "conversation-b") {
          if (!switched) failures.push("B received speech before input was routed to B");
          turn("started", action.turnId ?? "b-turn-1", null, captured.get("b"));
        }
        if (action.type === "duplicate-start") turn("started", action.turnId ?? "a-turn-1", null, captured.get("a"));
        if (action.type === "out-of-order-finish") {
          turn("finished", action.bTurnId ?? "b-turn-1", "Words for B");
          turn("finished", action.aTurnId ?? "a-turn-1", "Words for A");
        }
      }
      const started = frames.filter((frame) => frame.type === "voice-user-turn" && frame.data?.phase === "started")
        .map((frame) => [frame.data.turn_id, frame.data.thread_id, frame.data.epoch]);
      const words = room.rows.filter((row) => row.role === "user").map((row) => [row.text, row.thread, row.epoch]);
      const expectedStarts = fixture.id === "T11" ? [["a-turn-1", "a", 1], ["b-turn-1", "b", 1], ["a-turn-1", "a", 1]] :
        [["a-turn-1", "a", 1], ["b-turn-1", "b", 1]];
      if (JSON.stringify(started) !== JSON.stringify(expectedStarts))
        failures.push(`Mock room duplicate/epoch receipts differ: ${JSON.stringify(started)}`);
      if (JSON.stringify(words) !== JSON.stringify([["Words for B", "b", 1], ["Words for A", "a", 1]]))
        failures.push(`Mock room routed reordered terminals incorrectly: ${JSON.stringify(words)}`);
      if (room.epochs.get("a") !== 1 || room.epochs.get("b") !== 1) failures.push("Mock room advanced a conversation twice");
    } else {
      let first, second, typed;
      for (const action of fixture.actions) {
        if (action.type === "reply-playing") {
          agentSpeaks(world, "First reply");
          first = frames.filter((frame) => frame.type === "voice-reply").at(-1)?.data?.utterance_id;
          if (first) playback(first, "playing");
        }
        if (action.type === "typed-message") {
          const binding = [...room.calls][0]?.binding;
          typed = await request("/api/presentation/text", { session_id: session, thread_id: "a", binding_id: binding?.binding_id,
            message_id: crypto.randomUUID(), text: "Typed context" });
          if (room.rows.find((row) => row.id.endsWith(`:voice:${first}`))?.status !== "playing")
            failures.push("Typing settled the playing reply in the mock room");
        }
        if (action.type === "reply-queued") {
          agentSpeaks(world, "Second reply");
          second = frames.filter((frame) => frame.type === "voice-reply").at(-1)?.data?.utterance_id;
        }
      }
      if (typed?.status !== 200 || typed.body?.epoch !== 0 || (room.epochs.get("a") ?? 0) !== 0)
        failures.push(`Typing changed the mock room epoch: ${JSON.stringify({ receipt: typed, epoch: room.epochs.get("a") })}`);
      if (!first || !second || first === second) failures.push("Two distinct mock replies were not published");
      if (first) playback(first, "heard");
      if (second) playback(second, "heard");
      if (room.rows.filter((row) => row.role === "assistant" && row.status === "playback_finished").length !== 2)
        failures.push("Typing prevented one of the mock replies from being heard");
    }
  } finally { socket.close(1000); }
  return failures;
}
