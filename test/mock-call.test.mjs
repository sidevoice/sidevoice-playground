// The mocked call: the page's WebSocket (attach.mjs `mockedWebSocket`) and the machine's room behind it
// (machines.mjs `callSocket`), driven as the web's room-session-controller drives a real one — its hello, its
// messages with their `client_msg_id`, its HTTP reads — and the agent the card plays (`agentSpeaks`, `agentWorks`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../preview/mock/world.mjs";
import { agentSpeaks, agentWorks, answer, directUrl, isCallSocket, liveCall, makeIdentities, ROOM_URL } from "../preview/mock/machines.mjs";
import { mockedWebSocket } from "../preview/mock/attach.mjs";

const PAGE = "https://preview.example";
const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const scenario = {
  id: "c", title: "C", summary: "c", options: [],
  world: {
    page: "room",
    machines: {
      nuc: { host: "NUC", reach: "direct", paired: true, inUse: true, devices: [], participants: [
        { title: "Claude", reach: "listening" }, { title: "Codex", reach: "listening" }, { title: "Notes", reach: "holding" },
      ] },
    },
    local: null,
  },
};

/** Node has no CloseEvent: the browser's, as far as the page reads it. */
class CloseEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, { code: init.code, reason: init.reason ?? "", wasClean: !!init.wasClean });
  }
}

/** A page window as the socket needs it, its own WebSocket a recorder. */
function pageWindow() {
  class Real {
    constructor(url, protocols) {
      Object.assign(this, { url, protocols, real: true });
    }
  }
  return Object.assign(new EventTarget(), {
    WebSocket: Real, EventTarget, Event, MessageEvent, CloseEvent, DOMException,
    location: { origin: PAGE, href: `${PAGE}/voice/` },
  });
}

async function setup() {
  const world = createWorld(scenario, {}, instant);
  const identities = await makeIdentities(world.state);
  const win = pageWindow();
  const WebSocket = mockedWebSocket(win, { world, identities });
  const auth = { headers: { authorization: `Bearer ${identities.nuc.token}` } };
  const ask = async (path, init = {}) => answer(world, identities, { pageOrigin: PAGE, url: `${directUrl("nuc")}${path}`, ...auth, ...init });
  return { world, identities, win, WebSocket, ask };
}

const until = async (check, what) => {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.fail(`never: ${what}`);
};

/** A call as the page opens it: the socket, everything it heard, and the events it saw, in order. */
function open(WebSocket, url, token) {
  const socket = new WebSocket(url, ["sidevoice", `sidevoice.token.${token}`]);
  const frames = [];
  const events = [];
  for (const type of ["open", "error", "close"]) socket.addEventListener(type, (event) => events.push(event));
  socket.onmessage = (event) => frames.push(JSON.parse(event.data));
  const sent = (type) => frames.filter((frame) => frame.type === type);
  const send = (type, data) => socket.send(JSON.stringify({ type, data }));
  return { socket, frames, events, sent, send };
}

/** A call joined on `conversation`: the room's session answered. */
async function joined(c, conversation = "nuc-thread-1") {
  const call = open(c.WebSocket, `wss://nuc.machines.sidevoice.example/api/presentation/ws`, c.identities.nuc.token);
  await until(() => call.socket.readyState === 1, "open");
  call.socket.send(JSON.stringify({ label: "rtvi-ai", type: "client-ready", id: "hello", data: { conversation, ui_language: "en" } }));
  await until(() => call.sent("voice-session").length === 1, "the session");
  call.session = call.sent("voice-session")[0].data.session_id;
  return call;
}

test("only a mocked machine's call socket is mocked: anything else is the page's own WebSocket", async () => {
  const { WebSocket } = await setup();
  assert.equal(new WebSocket(`wss://preview.example/voice/?token=hmr`).real, true, "the dev server's hot reload");
  assert.equal(new WebSocket(`wss://nuc.machines.sidevoice.example/api/other`).real, true);
  assert.equal(isCallSocket("wss://nuc.machines.sidevoice.example/api/presentation/ws", PAGE), true);
  assert.equal(isCallSocket(`wss://room.sidevoice.example/nodes/nuc/api/presentation/ws`, PAGE), true, "through the room's relay");
  assert.equal(isCallSocket(`wss://preview.example/nodes/nuc/api/presentation/ws`, PAGE), true, "the relay on the page's origin");
  assert.equal(isCallSocket("ws://127.0.0.1:47123/api/presentation/ws", PAGE), true, "the local host");
  assert.equal(isCallSocket("wss://preview.example/api/presentation/ws", PAGE), false);
});

test("a call socket opens as a browser's, and the room answers the hello with a session on the conversation it names", async () => {
  const c = await setup();
  const call = open(c.WebSocket, "wss://nuc.machines.sidevoice.example/api/presentation/ws", c.identities.nuc.token);
  assert.equal(call.socket.readyState, c.WebSocket.CONNECTING);
  assert.equal(call.events.length, 0, "nothing before the constructor returned");
  assert.throws(() => call.socket.send("x"), (e) => e.name === "InvalidStateError");
  assert.throws(() => call.socket.close(1001), (e) => e.name === "InvalidAccessError");
  let handled = 0;
  call.socket.onopen = () => handled++;
  await until(() => call.socket.readyState === c.WebSocket.OPEN, "open");
  assert.deepEqual([call.events.map((e) => e.type), handled, call.socket.protocol], [["open"], 1, "sidevoice"]);
  call.socket.send(JSON.stringify({ label: "rtvi-ai", type: "client-ready", data: { conversation: "nuc-thread-2" } }));
  await until(() => call.frames.length === 1, "the session");
  const [session] = call.frames;
  assert.equal(session.type, "voice-session");
  assert.equal(session.seq, undefined, "the session frame is not numbered");
  assert.equal(session.data.resumed, false);
  assert.equal(typeof session.data.resume.token, "string");
  const sid = session.data.session_id;
  const presentation = (await c.ask(`/api/presentation?session_id=${sid}`)).body;
  assert.equal(presentation.binding.thread_id, "nuc-thread-2");
  assert.equal(presentation.binding.title, "Codex");
  assert.equal(presentation.call.id, sid);
  assert.equal((await c.ask("/api/presentation")).body.call, null, "a read about no call");
  assert.deepEqual((await c.ask(`/api/presentation/participants?session_id=${sid}`)).body.participants.map((p) => p.selected), [false, true, false]);
  assert.deepEqual(liveCall(c.world), { machine: "nuc", session: sid, thread: "nuc-thread-2", title: "Codex" });
  assert.ok(c.world.activity.some((a) => a.method === "WS" && a.status === 101));
});

test("a turn is acknowledged and answered with its revision; its words reach the agent, which reads them and works", async () => {
  const c = await setup();
  const call = await joined(c);
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m1", turn_id: "t1", phase: "started", started_at: 1 });
  await until(() => call.sent("voice-user-turn").length === 1, "the turn's start answered");
  assert.deepEqual(call.frames.map((f) => f.type), ["voice-session", "voice-ack", "voice-user-turn"]);
  assert.deepEqual(call.frames.slice(1).map((f) => f.seq), [1, 2]);
  assert.deepEqual(call.sent("voice-ack")[0].data, { session_id: call.session, client_msg_id: "m1" });
  assert.deepEqual(call.sent("voice-user-turn")[0].data, { session_id: call.session, phase: "started", turn_id: "t1", revision: 1, epoch: 1, thread_id: "nuc-thread-1" });
  const finished = { session_id: call.session, client_msg_id: "m2", turn_id: "t1", phase: "finished", text: "Run the tests", merged: false };
  call.send("voice-user-turn", finished);
  await until(() => call.sent("voice-conversation").length === 1, "the agent working on it");
  const receipts = call.sent("voice-input-receipt").map((f) => f.data);
  assert.deepEqual(receipts.map((r) => r.status), ["pending", "delivered", "read"]);
  assert.deepEqual(receipts[0], { revision: 1, epoch: 1, history_id: `${call.session}:user-turn:t1`, thread_id: "nuc-thread-1", session_id: call.session, status: "pending", turn_id: "t1" });
  assert.deepEqual(call.sent("voice-conversation")[0].data, { thread_id: "nuc-thread-1", working: true, turn_phase: "start", session_id: call.session, revision: 1 });
  const [row] = (await c.ask("/api/presentation/history")).body.messages;
  assert.deepEqual([row.id, row.role, row.text, row.status, row.revision, row.thread], [`${call.session}:user-turn:t1`, "user", "Run the tests", "read", 1, "nuc-thread-1"]);
  assert.equal("turn_id" in row, false, "the room's history view");
  // Sent again after a drop, a message is only acknowledged.
  const before = call.frames.length;
  call.send("voice-user-turn", finished);
  await until(() => call.frames.length === before + 1, "the ack");
  assert.equal(call.frames.at(-1).type, "voice-ack");
  // A turn the room does not know, and a message without its id, are refused, the first by its id.
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m3", turn_id: "nope", phase: "finished", text: "x" });
  call.send("voice-user-turn", { session_id: call.session, turn_id: "t2", phase: "started" });
  await until(() => call.sent("error").length === 2, "two refusals");
  assert.deepEqual(call.sent("error").map((f) => [f.data.key, f.data.client_msg_id]), [["room.input_ended", "m3"], ["room.request_invalid", undefined]]);
  // Typed words go the same way.
  const binding = (await c.ask(`/api/presentation?session_id=${call.session}`)).body.binding;
  const typed = await c.ask("/api/presentation/text", { method: "POST", body: JSON.stringify({
    text: "And push it", thread_id: "nuc-thread-1", session_id: call.session, binding_id: binding.binding_id, message_id: crypto.randomUUID(),
  }) });
  assert.equal(typed.status, 200);
  assert.equal(typed.body.accepted, true);
  assert.equal(typed.body.epoch, 1, "typing does not advance the spoken epoch");
  assert.equal((await c.ask("/api/presentation/history")).body.messages.at(-1).text, "And push it");
});

test("mock room keeps conversation epochs separate from typing, duplicates and output eligibility", async () => {
  const c = await setup();
  const call = await joined(c);
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "e1", turn_id: "t1", phase: "started" });
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "e2", turn_id: "t1", phase: "started" });
  await until(() => call.sent("voice-user-turn").length === 2, "duplicate turn acknowledged");
  assert.deepEqual(call.sent("voice-user-turn").map((frame) => frame.data.epoch), [1, 1]);
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "e3", turn_id: "t1", phase: "finished", text: "first" });
  const binding = (await c.ask(`/api/presentation?session_id=${call.session}`)).body.binding;
  const typed = await c.ask("/api/presentation/text", { method: "POST", body: JSON.stringify({
    text: "typed", thread_id: "nuc-thread-1", session_id: call.session, binding_id: binding.binding_id, message_id: crypto.randomUUID(),
  }) });
  assert.equal(typed.body.epoch, 1);
  call.send("voice-speech", { session_id: call.session, client_msg_id: "e4", on: false, reason: "voice_off" });
  await until(() => call.sent("voice-ack").some((frame) => frame.data.client_msg_id === "e4"), "output off acknowledged");
  const replies = call.sent("voice-reply").length;
  assert.equal(agentSpeaks(c.world, "Written only"), true);
  assert.equal(call.sent("voice-reply").length, replies);
  assert.equal((await c.ask("/api/presentation/history")).body.messages.at(-1).audio_reason, "voice_off");
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "e5", turn_id: "t2", phase: "started" });
  await until(() => call.sent("voice-user-turn").length === 3, "new speech epoch");
  assert.equal(call.sent("voice-user-turn").at(-1).data.epoch, 2);
  assert.equal(agentSpeaks(c.world, "Must be refused"), false, "an open spoken turn refuses publication");
});

test("the agent speaks through the room: a reply to the call, its row in the history, and how it played", async () => {
  const c = await setup();
  assert.equal(agentSpeaks(c.world, "Hola"), false, "no call to say it to");
  const call = await joined(c);
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m1", turn_id: "t1", phase: "started" });
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m2", turn_id: "t1", phase: "finished", text: "Hi" });
  await until(() => call.sent("voice-conversation").length === 1, "read, and working");
  assert.equal(agentSpeaks(c.world, "The tests pass."), true);
  await until(() => call.sent("voice-reply").length === 1, "the reply");
  const reply = call.sent("voice-reply")[0].data;
  assert.equal(reply.text, "The tests pass.");
  assert.equal(reply.session_id, call.session);
  assert.equal(reply.thread_id, "nuc-thread-1");
  assert.equal(reply.reply_revision, 1, "it answers the turn");
  assert.equal(reply.history_id, `${call.session}:voice:${reply.utterance_id}`);
  await until(() => call.sent("voice-conversation").length === 2, "the harness's turn ends");
  assert.deepEqual(call.sent("voice-conversation")[1].data, { thread_id: "nuc-thread-1", working: false, turn_phase: "end", session_id: call.session, revision: 1 });
  const status = async () => (await c.ask("/api/presentation/history")).body.messages.find((r) => r.id === reply.history_id).status;
  assert.equal(await status(), "queued");
  call.send("voice-playback", { session_id: call.session, client_msg_id: "p1", utterance_id: reply.utterance_id, status: "playing", heard_chars: 0 });
  call.send("voice-playback", { session_id: call.session, client_msg_id: "p2", utterance_id: reply.utterance_id, status: "heard", heard_chars: 15 });
  await until(() => call.sent("voice-ack").length === 4, "both acknowledged");
  assert.equal(await status(), "playback_finished");
  // Working on its own: a start, and its end once the time is up.
  assert.equal(agentWorks(c.world, 100), true);
  await until(() => call.sent("voice-conversation").length === 4, "a working spell");
  assert.deepEqual(call.sent("voice-conversation").slice(2).map((f) => [f.data.working, f.data.turn_phase]), [[true, "start"], [false, "end"]]);
});

test("selecting moves the call to another conversation and takes back the reply it was saying", async () => {
  const c = await setup();
  const call = await joined(c);
  agentSpeaks(c.world, "A long reply");
  await until(() => call.sent("voice-reply").length === 1, "the reply");
  const select = (body) => c.ask("/api/presentation/select", { method: "POST", body: JSON.stringify(body) });
  const moved = await select({ thread_id: "nuc-thread-2", session_id: call.session });
  assert.equal(moved.body.status, "activated");
  assert.equal(moved.body.binding.thread_id, "nuc-thread-2");
  await until(() => call.sent("voice-reply-withdrawn").length === 1, "the withdrawal");
  assert.deepEqual(call.sent("voice-reply-withdrawn")[0].data.utterance_ids, [call.sent("voice-reply")[0].data.utterance_id]);
  assert.equal((await select({ thread_id: "nuc-thread-2", session_id: call.session })).body.status, "already_active");
  assert.equal((await select({ thread_id: "nuc-thread-1", session_id: "gone" })).status, 409);
  assert.equal((await select({ session_id: call.session })).status, 400);
  // Words for a conversation that does not listen wait there.
  await select({ thread_id: "nuc-thread-3", session_id: call.session });
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m1", turn_id: "t1", phase: "started" });
  call.send("voice-user-turn", { session_id: call.session, client_msg_id: "m2", turn_id: "t1", phase: "finished", text: "Hi" });
  await until(() => call.sent("voice-input-receipt").length === 1, "pending");
  await c.world.delay(1500);
  assert.deepEqual(call.sent("voice-input-receipt").map((f) => f.data.status), ["pending"]);
});

test("refused, dropped and hung up as a browser's socket is: 4401, an error then 1006, and the room lets the call go", async () => {
  const c = await setup();
  const stranger = open(c.WebSocket, "wss://nuc.machines.sidevoice.example/api/presentation/ws", "not-this-device");
  await until(() => stranger.socket.readyState === 3, "closed");
  assert.deepEqual(stranger.events.map((e) => [e.type, e.code]), [["open", undefined], ["close", 4401]]);

  // Through the relay, a machine that is away is the relay's refusal; directly, it is no answer at all.
  c.world.patch({ "machines.nuc.reach": "offline" });
  const relayed = open(c.WebSocket, `${ROOM_URL.replace("https", "wss")}/nodes/nuc/api/presentation/ws`, c.identities.nuc.token);
  await until(() => relayed.socket.readyState === 3, "refused");
  assert.equal(relayed.sent("error")[0].data.reason, "node_offline");
  assert.equal(relayed.events.at(-1).code, 1013);
  const direct = open(c.WebSocket, "wss://nuc.machines.sidevoice.example/api/presentation/ws", c.identities.nuc.token);
  await until(() => direct.socket.readyState === 3, "failed");
  assert.deepEqual(direct.events.map((e) => [e.type, e.code, e.wasClean]), [["error", undefined, undefined], ["close", 1006, false]]);

  // A machine that stops answering drops the call.
  c.world.patch({ "machines.nuc.reach": "direct" });
  const dropped = await joined(c);
  c.world.patch({ "machines.nuc.reach": "offline" });
  await until(() => dropped.socket.readyState === 3, "dropped");
  assert.deepEqual(dropped.events.slice(1).map((e) => [e.type, e.code]), [["error", undefined], ["close", 1006]]);
  assert.equal(liveCall(c.world), null);

  // A hang-up ends the call in the room, and the page's close says so.
  c.world.patch({ "machines.nuc.reach": "direct" });
  const call = await joined(c);
  call.socket.close(1000);
  assert.equal(call.socket.readyState, 2);
  await until(() => call.socket.readyState === 3, "closed");
  assert.deepEqual([call.events.at(-1).code, call.events.at(-1).wasClean], [1000, true]);
  assert.equal((await c.ask(`/api/presentation?session_id=${call.session}`)).body.call, null);
  call.socket.send("after the close: nothing");

  // A page that goes away leaves its calls.
  await joined(c);
  assert.ok(liveCall(c.world));
  c.win.dispatchEvent(new Event("pagehide"));
  assert.equal(liveCall(c.world), null);
});
