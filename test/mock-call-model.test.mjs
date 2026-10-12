// The mocked room as a call that stays open with its voice off needs it (the web's call model B, the voice switch):
// a call's speech on or off and who hears a reply, what each conversation's person did not hear and its "hear it",
// leaving a conversation for none, every conversation's working in the listing; and the mocked voice losing the
// default headset or the microphone's permission.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, stateFor, choicesFor } from "../preview/mock/world.mjs";
import { HEAR_ANSWER_MS, agentSpeaks, agentWorks, answer, directUrl, makeIdentities, roomOf } from "../preview/mock/machines.mjs";
import { mockedWebSocket } from "../preview/mock/attach.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { loadMockScenarios } from "../preview/proxy.mjs";

const PAGE = "https://preview.example";
const NOW = 1_800_000_000_000;
const instant = { tick: () => new Promise((r) => setImmediate(r)), now: () => NOW };
const ALL = { deliver: "supported", inspectInbound: "supported", endOfTurn: "supported", sessionIdentity: "supported" };
const scenario = (participants) => ({
  id: "m", title: "M", summary: "m", options: [],
  world: {
    page: "room",
    machines: { nuc: { host: "NUC", reach: "direct", paired: true, inUse: true, devices: [], participants } },
    local: null,
  },
});
const THREE = [
  { title: "Claude", reach: "listening" }, { title: "Codex", reach: "listening" },
  { title: "Notes", reach: "listening", capabilities: { ...ALL, working: "unsupported" } },
];

/** Node has no CloseEvent: the browser's, as far as the page reads it. */
class CloseEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    Object.assign(this, { code: init.code, reason: init.reason ?? "", wasClean: !!init.wasClean });
  }
}

function pageWindow() {
  class Real {}
  return Object.assign(new EventTarget(), {
    WebSocket: Real, EventTarget, Event, MessageEvent, CloseEvent, DOMException,
    location: { origin: PAGE, href: `${PAGE}/voice/` },
  });
}

async function setup(participants = THREE) {
  const world = createWorld(scenario(participants), {}, instant);
  const identities = await makeIdentities(world.state);
  const WebSocket = mockedWebSocket(pageWindow(), { world, identities });
  const auth = { headers: { authorization: `Bearer ${identities.nuc.token}` } };
  const ask = async (path, init = {}) => answer(world, identities, { pageOrigin: PAGE, url: `${directUrl("nuc")}${path}`, ...auth, ...init });
  const post = (path, body) => ask(path, { method: "POST", body: JSON.stringify(body) });
  const rows = async () => (await ask("/api/presentation/history")).body.messages;
  const listed = async (thread) => (await ask("/api/presentation/participants")).body.participants.find((p) => p.thread_id === thread);
  return { world, identities, WebSocket, ask, post, rows, listed };
}

const until = async (check, what) => {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  assert.fail(`never: ${what}`);
};
/** Long enough for any frame already sent to have reached the page. */
const settled = () => new Promise((r) => setTimeout(r, 20));

/** A call joined on `conversation`, its hello saying `hello` besides. */
async function joined(c, conversation = "nuc-thread-1", hello = {}) {
  const socket = new c.WebSocket("wss://nuc.machines.sidevoice.example/api/presentation/ws", ["sidevoice", `sidevoice.token.${c.identities.nuc.token}`]);
  const frames = [];
  socket.onmessage = (event) => frames.push(JSON.parse(event.data));
  const call = { socket, frames, sent: (type) => frames.filter((frame) => frame.type === type), send: (type, data) => socket.send(JSON.stringify({ type, data })) };
  await until(() => socket.readyState === 1, "open");
  socket.send(JSON.stringify({ label: "rtvi-ai", type: "client-ready", data: { conversation, ui_language: "en", ...hello } }));
  await until(() => call.sent("voice-session").length === 1, "the session");
  call.session = call.sent("voice-session")[0].data.session_id;
  return call;
}

test("a call whose hello turns its speech off is sent no reply: it is only written, unheard for its reason, and its conversation's row says so", async () => {
  const c = await setup();
  const call = await joined(c, "nuc-thread-1", { speech: { on: false, reason: "voice_off" }, notes: "on-request" });
  const kept = [...roomOf(c.world, "nuc").calls].find((one) => one.session === call.session);
  assert.deepEqual([kept.speech, kept.notes], [{ on: false, reason: "voice_off" }, "on-request"]);
  assert.equal(agentSpeaks(c.world, "The tests pass."), true);
  await settled();
  assert.equal(call.sent("voice-reply").length, 0);
  const row = (await c.rows()).at(-1);
  assert.deepEqual([row.text, row.status, row.audio_reason, row.session], ["The tests pass.", "text_only", "voice_off", call.session]);
  assert.deepEqual((await c.listed("nuc-thread-1")).unheard, { count: 1, since: row.time });
  assert.equal((await c.listed("nuc-thread-2")).unheard, null);
  // A hello that says nothing of it is a call with its speech on, the agent told unasked by default.
  const plain = await joined(c, "nuc-thread-2");
  assert.deepEqual([...roomOf(c.world, "nuc").calls].find((one) => one.session === plain.session).speech, { on: true, reason: null });
});

test("voice-speech turns a call's speech on and off, unanswered; one that does not say on or off is ignored", async () => {
  const c = await setup();
  const call = await joined(c, "nuc-thread-1", { speech: { on: false, reason: "voice_off" } });
  call.send("voice-speech", { session_id: call.session, on: true });
  await settled();
  assert.equal(agentSpeaks(c.world, "On again."), true);
  await until(() => call.sent("voice-reply").length === 1, "the reply");
  assert.equal(call.sent("voice-reply")[0].data.text, "On again.");
  assert.equal((await c.rows()).at(-1).status, "queued");
  call.send("voice-speech", { session_id: call.session, on: "no" });
  call.send("voice-speech", { session_id: "another", on: false, reason: "voice_off" });
  call.send("voice-speech", { session_id: call.session, on: false, reason: "agents_muted" });
  await settled();
  agentSpeaks(c.world, "Muted.");
  await settled();
  assert.equal(call.sent("voice-reply").length, 1);
  assert.deepEqual(call.frames.filter((f) => !["voice-session", "voice-reply"].includes(f.type)), [], "never acknowledged nor answered");
  const row = (await c.rows()).at(-1);
  assert.deepEqual([row.status, row.audio_reason], ["text_only", "agents_muted"]);
});

test("the agent speaks and works on any conversation: one no call is on is written as unheard, for a change of conversation or no call", async () => {
  const c = await setup();
  const elsewhere = { machine: "nuc", thread: "nuc-thread-2" };
  assert.equal(agentSpeaks(c.world, "Nobody here.", elsewhere), true, "with no call at all");
  assert.equal(agentSpeaks(c.world, "x", { machine: "nuc", thread: "nuc-thread-9" }), false);
  assert.equal(agentSpeaks(c.world, "x", { machine: "attic", thread: "nuc-thread-1" }), false);
  assert.equal(agentWorks(c.world, 10, { machine: "nuc", thread: "nuc-thread-9" }), false);
  const call = await joined(c);
  assert.equal(agentSpeaks(c.world, "The build is done.", elsewhere), true);
  await settled();
  assert.equal(call.sent("voice-reply").length, 0, "the call is on another conversation");
  const [first, second] = (await c.rows()).slice(-2);
  assert.deepEqual([first.status, first.audio_reason], ["text_only", "call_ended"]);
  assert.match(second.id, /^room:voice:[0-9a-f-]{36}$/);
  assert.deepEqual([second.thread, second.session, second.revision, second.name, second.status, second.audio_reason],
    ["nuc-thread-2", null, 0, "Codex", "text_only", "focus_changed"]);
  assert.deepEqual((await c.listed("nuc-thread-2")).unheard, { count: 2, since: first.time });
  assert.equal((await c.listed("nuc-thread-1")).unheard, null);
  // Named, the conversation the call is on hears it as it would without a name.
  assert.equal(agentSpeaks(c.world, "Here too.", { machine: "nuc", thread: "nuc-thread-1" }), true);
  await until(() => call.sent("voice-reply").length === 1, "the reply");
  assert.equal(call.sent("voice-reply")[0].data.history_id, `${call.session}:voice:${call.sent("voice-reply")[0].data.utterance_id}`);
});

test("how a reply played marks its conversation: not played for muted agents does, heard does not", async () => {
  const c = await setup();
  const call = await joined(c);
  agentSpeaks(c.world, "First.");
  agentSpeaks(c.world, "Second.");
  await until(() => call.sent("voice-reply").length === 2, "both replies");
  const [first, second] = call.sent("voice-reply").map((f) => f.data.utterance_id);
  const report = (id, utterance_id, status, extra = {}) =>
    call.send("voice-playback", { session_id: call.session, client_msg_id: id, utterance_id, status, ...extra });
  report("p1", first, "unplayed", { reason: "agents_muted" });
  report("p2", second, "playing", { heard_chars: 0 });
  report("p3", second, "heard", { heard_chars: 7 });
  await until(() => call.sent("voice-ack").length === 3, "all acknowledged");
  const rows = await c.rows();
  const muted = rows.find((row) => row.text === "First.");
  assert.deepEqual([muted.status, muted.audio_reason], ["interrupted", "agents_muted"]);
  assert.equal(rows.find((row) => row.text === "Second.").status, "playback_finished");
  assert.deepEqual((await c.listed("nuc-thread-1")).unheard, { count: 1, since: muted.time });
});

test("the person's words on a conversation take what they missed there to the agent: its mark goes once they are delivered", async () => {
  const c = await setup();
  const call = await joined(c, "nuc-thread-1", { speech: { on: false, reason: "voice_off" } });
  agentSpeaks(c.world, "Unheard.");
  assert.equal((await c.listed("nuc-thread-1")).unheard.count, 1);
  const binding = (await c.ask(`/api/presentation?session_id=${call.session}`)).body.binding;
  const typed = await c.post("/api/presentation/text", {
    text: "What did you say?", thread_id: "nuc-thread-1", session_id: call.session, binding_id: binding.binding_id, message_id: crypto.randomUUID(),
  });
  assert.equal(typed.status, 200);
  assert.equal((await c.listed("nuc-thread-1")).unheard.count, 1, "still pending");
  await until(() => call.sent("voice-input-receipt").some((f) => f.data.status === "delivered"), "delivered");
  assert.equal((await c.listed("nuc-thread-1")).unheard, null);
});

test("hear: refused as the room refuses, nothing to hear, or asked: the note sent at once and a fresh answer after a moment, once", async () => {
  const c = await setup();
  const call = await joined(c);
  const hear = (body) => c.post("/api/presentation/hear", body);
  assert.deepEqual(await hear({ session_id: call.session }), { status: 400, body: { detail: "Invalid conversation identifier." } });
  assert.deepEqual(await hear({ session_id: call.session, thread_id: 7 }), { status: 400, body: { detail: "Invalid conversation identifier." } });
  assert.deepEqual(await hear({ session_id: "gone", thread_id: "nuc-thread-1" }), { status: 409, body: { detail: "That browser is not in the room." } });
  assert.deepEqual(await hear({ session_id: call.session, thread_id: "nuc-thread-2" }),
    { status: 409, body: { detail: "The connection or conversation changed. The text was not sent." } });
  assert.deepEqual(await hear({ session_id: call.session, thread_id: "nuc-thread-1" }), { status: 200, body: { status: "nothing" } });

  call.send("voice-speech", { session_id: call.session, on: false, reason: "agents_muted" });
  await settled();
  agentSpeaks(c.world, "One you missed.");
  agentSpeaks(c.world, "And another.");
  call.send("voice-speech", { session_id: call.session, on: true });
  await settled();
  assert.equal((await c.listed("nuc-thread-1")).unheard.count, 2);
  const before = (await c.rows()).filter((row) => row.role === "assistant").map((row) => row.text);
  assert.deepEqual(await hear({ session_id: call.session, thread_id: "nuc-thread-1" }), { status: 200, body: { status: "asked" } });
  assert.equal((await c.listed("nuc-thread-1")).unheard, null, "the note is sent at once");
  assert.deepEqual(await hear({ session_id: call.session, thread_id: "nuc-thread-1" }), { status: 200, body: { status: "asked" } }, "a repeat while it waits");
  await c.world.delay(HEAR_ANSWER_MS);
  await until(() => call.sent("voice-reply").length === 1, "the answer");
  await c.world.delay(200);
  const replies = call.sent("voice-reply").map((f) => f.data.text);
  assert.equal(replies.length, 1, "one answer only");
  assert.ok(!before.includes(replies[0]), "never an earlier reply's words");
  assert.equal((await c.rows()).filter((row) => row.role === "assistant").length, before.length + 1);

  // A world whose agent stays silent: asked, and nothing comes.
  c.world.patch({ hear: "silent" });
  call.send("voice-speech", { session_id: call.session, on: false, reason: "voice_off" });
  await settled();
  agentSpeaks(c.world, "Missed again.");
  call.send("voice-speech", { session_id: call.session, on: true });
  await settled();
  assert.equal((await hear({ session_id: call.session, thread_id: "nuc-thread-1" })).body.status, "asked");
  await c.world.delay(HEAR_ANSWER_MS + 200);
  await settled();
  assert.equal(call.sent("voice-reply").length, 1);
  assert.equal((await c.rows()).at(-1).text, "Missed again.");
  // The note no longer waits: asked again with something missed, it is sent, and answered afresh.
  c.world.patch({ hear: "answers" });
  agentSpeaks(c.world, "Third.");
  await until(() => call.sent("voice-reply").length === 2, "the third reply");
  call.send("voice-playback", { session_id: call.session, client_msg_id: "p1", utterance_id: call.sent("voice-reply")[1].data.utterance_id, status: "unplayed" });
  await until(() => call.sent("voice-ack").length === 1, "acknowledged");
  assert.equal((await c.listed("nuc-thread-1")).unheard.count, 1, "Third: the silent ask told the agent of the one before");
  assert.equal((await hear({ session_id: call.session, thread_id: "nuc-thread-1" })).body.status, "asked");
  await c.world.delay(HEAR_ANSWER_MS);
  await until(() => call.sent("voice-reply").length === 3, "the second answer");
  const said = (await c.rows()).filter((row) => row.role === "assistant").slice(0, -1).map((row) => row.text);
  assert.ok(!said.includes(call.sent("voice-reply")[2].data.text), "fresh again");
});

test("leave: the call is on no conversation, what it was saying is taken back, and typing to it is refused", async () => {
  const c = await setup();
  const call = await joined(c);
  agentSpeaks(c.world, "A long reply");
  await until(() => call.sent("voice-reply").length === 1, "the reply");
  const binding = (await c.ask(`/api/presentation?session_id=${call.session}`)).body.binding;
  const leave = (body) => c.post("/api/presentation/leave", body);
  assert.deepEqual(await leave({ session_id: "gone", binding_id: binding.binding_id }), { status: 409, body: { detail: "That browser is not in the room." } });
  assert.equal((await leave({ session_id: call.session, binding_id: "another" })).status, 409);
  const left = await leave({ session_id: call.session, binding_id: binding.binding_id });
  assert.equal(left.status, 200);
  assert.equal(left.body.status, "activated");
  assert.deepEqual([left.body.binding.thread_id, left.body.binding.title], ["", null]);
  assert.match(left.body.binding.binding_id, /^[0-9a-f-]{36}$/);
  assert.notEqual(left.body.binding.binding_id, binding.binding_id);
  await until(() => call.sent("voice-reply-withdrawn").length === 1, "the withdrawal");
  assert.deepEqual(call.sent("voice-reply-withdrawn")[0].data, { session_id: call.session, utterance_ids: [call.sent("voice-reply")[0].data.utterance_id], reason: "focus_changed" });
  assert.equal((await c.ask(`/api/presentation?session_id=${call.session}`)).body.binding, null);
  assert.equal((await c.listed("nuc-thread-1")).unheard.count, 1, "taken back unheard");
  assert.equal((await c.listed("nuc-thread-1")).selected, false);
  const typed = await c.post("/api/presentation/text", {
    text: "Hello?", thread_id: "", session_id: call.session, binding_id: left.body.binding.binding_id, message_id: crypto.randomUUID(),
  });
  assert.deepEqual(typed, { status: 409, body: { detail: "The connection or conversation changed. The text was not sent." } });
  assert.equal(agentSpeaks(c.world, "To nobody."), false, "the call is on no conversation");
});

test("the listing says what each conversation's harness last said about working: as it works, after, never, or not something it says", async () => {
  const c = await setup();
  const call = await joined(c, "nuc-thread-2");
  const working = async () => Object.fromEntries((await c.ask("/api/presentation/participants")).body.participants.map((p) => [p.title, p.working]));
  assert.deepEqual(await working(), { Claude: null, Codex: null, Notes: null });
  c.world.speed = 0;
  assert.equal(agentWorks(c.world, 1000, { machine: "nuc", thread: "nuc-thread-2" }), true);
  assert.equal(agentWorks(c.world, 1000, { machine: "nuc", thread: "nuc-thread-3" }), true);
  assert.deepEqual(await working(), { Claude: null, Codex: true, Notes: null });
  c.world.speed = 1;
  await until(() => call.sent("voice-conversation").length === 2, "the spell's end");
  assert.deepEqual(call.sent("voice-conversation").map((f) => [f.data.working, f.data.turn_phase, f.data.session_id]),
    [[true, "start", call.session], [false, "end", call.session]]);
  assert.deepEqual(await working(), { Claude: null, Codex: false, Notes: null });

  // A scenario may say a conversation is working before any report: the listing, and a call landing on it, say so.
  const seeded = await setup([{ title: "release", reach: "listening", working: true }]);
  assert.equal((await seeded.listed("nuc-thread-1")).working, true);
  const landing = await joined(seeded);
  await until(() => landing.sent("voice-conversation").length === 1, "told on landing");
  assert.equal(landing.sent("voice-conversation")[0].data.working, true);
});

test("a scenario's reply only written counts as unheard from the start", async () => {
  const c = await setup([
    { title: "release", reach: "listening", history: [
      { role: "user", text: "Ship it.", minutesAgo: 9 },
      { role: "assistant", text: "Shipping.", minutesAgo: 8 },
      { role: "assistant", text: "Shipped.", minutesAgo: 5, status: "text_only" },
      { role: "assistant", text: "Notes out.", minutesAgo: 2, status: "text_only", audio_reason: "voice_off" },
    ] },
    { title: "quiet", reach: "listening" },
  ]);
  assert.deepEqual((await c.listed("nuc-thread-1")).unheard, { count: 2, since: NOW - 5 * 60_000 });
  assert.equal((await c.listed("nuc-thread-2")).unheard, null);
  assert.deepEqual((await c.rows()).map((row) => row.audio_reason), [null, null, "focus_changed", "voice_off"]);
});

test("Room ready seeds release's missed replies and its working, and both leave no conversation where there is none", async () => {
  const ready = (await loadMockScenarios()).find((s) => s.id === "room-ready");
  const world = createWorld(ready, { missed: "release", working: "release" }, instant);
  const identities = await makeIdentities(world.state);
  const participants = async () => (await answer(world, identities, {
    pageOrigin: PAGE, url: `${directUrl("nuc")}/api/presentation/participants`, headers: { authorization: `Bearer ${identities.nuc.token}` },
  })).body.participants;
  const release = (await participants()).find((p) => p.title === "release");
  assert.equal(release.unheard.count, 2);
  assert.ok(release.unheard.since < NOW && release.unheard.since > NOW - 15 * 60_000, "a few minutes ago");
  assert.equal(release.working, true);
  assert.equal((await participants()).find((p) => p.title === "sidevoice-web").unheard, null);
  world.choose("working", "none");
  assert.equal((await participants()).find((p) => p.title === "release").working, null);
  // Picked over "many", release is still the second conversation; over "none yet", there is no conversation to mark.
  assert.equal(stateFor(ready, choicesFor(ready, { agents: "many", missed: "release" })).machines.nuc.participants[1].title, "release");
  const none = createWorld(ready, { agents: "none", missed: "release", working: "release" }, instant);
  const noneIds = await makeIdentities(none.state);
  const listed = await answer(none, noneIds, {
    pageOrigin: PAGE, url: `${directUrl("nuc")}/api/presentation/participants`, headers: { authorization: `Bearer ${noneIds.nuc.token}` },
  });
  assert.deepEqual(listed.body.participants, []);
});

test("the mocked voice loses the default headset's microphone (the call ends) and output (said), a chosen one as before, and the microphone's permission", async () => {
  const world = createWorld({ id: "v", title: "v", summary: "v", options: [], world: { machines: {}, local: null, voice: {} } }, {}, instant);
  const settings = { stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" } };
  const listen = async () => {
    const voice = fakeVoice(world);
    const seen = { devices: [], errors: [] };
    voice.host.onAudioDevices((devices) => seen.devices.push(devices));
    voice.host.onError((error) => seen.errors.push(error.code));
    await voice.host.setSettings(settings);
    return { voice, seen };
  };

  // Not started: unplugging says the list, as before.
  const idle = await listen();
  idle.voice.plugHeadset(false);
  assert.deepEqual([idle.seen.devices.at(-1).defaultLost, idle.seen.devices.at(-1).lost, idle.seen.errors], [undefined, undefined, []]);
  idle.voice.revokeMicrophone();
  assert.deepEqual(idle.seen.errors, []);

  // Started on the system's defaults, the headset being them: its output going is said, its microphone going ends it.
  const byDefault = await listen();
  await byDefault.voice.host.start();
  byDefault.voice.plugHeadset(false);
  assert.deepEqual(byDefault.seen.devices.at(-1).defaultLost, { output: true });
  assert.equal(byDefault.seen.devices.at(-1).lost, undefined);
  assert.deepEqual(byDefault.seen.errors, ["microphone-lost"]);
  assert.equal(byDefault.voice.state.started, false);
  byDefault.voice.plugHeadset(true);
  assert.equal(byDefault.seen.devices.at(-1).defaultLost, undefined, "plugged in: nothing lost");

  // The headset chosen: lost, the defaults in use, the call going on.
  const chosen = await listen();
  await chosen.voice.host.setAudioDevices({ input: "mic-headset", output: "out-headset" });
  await chosen.voice.host.start();
  chosen.voice.plugHeadset(false);
  assert.deepEqual([chosen.seen.devices.at(-1).lost, chosen.seen.devices.at(-1).defaultLost, chosen.seen.errors], [{ input: "mic-headset", output: "out-headset" }, undefined, []]);
  assert.equal(chosen.voice.state.started, true);

  // The permission taken back mid-call.
  chosen.voice.revokeMicrophone();
  assert.deepEqual(chosen.seen.errors, ["microphone-denied"]);
  assert.equal(chosen.voice.state.started, false);
});
