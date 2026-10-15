import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { runTurnFixture } from "../preview/mock/turn-script.mjs";
import { probeMockRoom } from "../preview/mock/turn-machine-probes.mjs";
import { sourceBuilds } from "../preview/source-build.mjs";
import { SCRIPTS, scriptedAgent } from "../preview/turn-lab/agent.mjs";
import { ensureCaseConversation } from "../preview/index.mjs";
import { evidence } from "../preview/turn-lab/evidence.mjs";
import { plannedPins } from "../preview/web-build.mjs";
import { archiveChoices } from "../web/preview/choices.mjs";

const SHA = "a".repeat(40);

test("browser observer retains a turn's original thread and binding after focus changes", async () => {
  const posted = [];
  class Socket {
    addEventListener() {}
    send() {}
  }
  const window = { addEventListener() {}, WebSocket: Socket, fetch: async () => ({}), sidevoiceActions: null };
  const script = await readFile(new URL("../preview/turn-lab/observe.js", import.meta.url), "utf8");
  runInNewContext(script, { window, parent: { postMessage: (event) => posted.push(event) },
    localStorage: { getItem: () => "ready", removeItem() {} }, document: { addEventListener() {} },
    navigator: {}, location: { pathname: "/" }, setInterval() {}, URL, Date });
  const socket = new window.WebSocket();
  socket.send(JSON.stringify({ type: "voice-user-turn", data: { session_id: "s", turn_id: "a-turn", phase: "started",
    thread_id: "a", binding_id: "binding-a" } }));
  socket.send(JSON.stringify({ type: "voice-user-turn", data: { session_id: "s", turn_id: "a-turn", phase: "finished", text: "A's words" } }));
  const turns = posted.filter((event) => event.kind === "browser-action");
  assert.deepEqual(turns.map((event) => [event.data.conversation, event.data.binding_id]),
    [["a", "binding-a"], ["a", "binding-a"]]);
});

test("T06c prepares a distinct real conversation before its first publication from a fresh Lab", async () => {
  const events = [], calls = [], other = { state: { ready: false, conversation: null },
    async start(mode, title) { calls.push(["connect", mode, title]); this.state = { ready: true, conversation: "other-thread" }; },
    async stop() {} };
  let created = 0;
  const create = () => { created++; return other; };
  const first = await ensureCaseConversation("T06c", null, create, (event) => events.push(event));
  calls.push(["publish", "T06c"]);
  assert.equal(first.state.conversation, "other-thread");
  assert.equal(created, 1);
  assert.deepEqual(calls, [["connect", "push", "Turn Lab (other)"], ["publish", "T06c"]]);
  assert.equal(events[0].kind, "second-conversation-ready");
  assert.equal(events[0].data.conversation, "other-thread");
  assert.equal(await ensureCaseConversation("T11", first, create, () => {}), first, "T11 reuses the prepared conversation");
  assert.equal(created, 1);
  assert.match(SCRIPTS.T06c.instruction, /select Turn Lab \(other\) and speak there/);
});

// The ordinary endpoint is the configured one measured from the call's last captured speech, never a fixed wait
// after the switch or mute: Smart Turn may finish early, Silence/Fast waits 2 s, a forced terminal is invalid, and a
// terminal without source endpoint evidence cannot be judged.
async function endpointCases(fixture, id) {
  const run = (turn) => runTurnFixture(turn, { wait: async () => {} });
  const terminal = (turn) => turn.actions.find((action) => ["out-of-order-finish", "turn-finished"].includes(action.type));
  const variant = (change) => { const turn = structuredClone(fixture); change(terminal(turn), turn); return turn; };
  assert.equal((await run(variant((a) => { a.atMs = 1900; }))).status, "model-match", `${id}: a Smart Turn endpoint 900 ms after the last speech is valid`);
  const tooSoon = await run(variant((a) => { a.atMs = 1899; }));
  assert.equal(tooSoon.status, "fail", `${id}: before the configured endpoint`);
  assert.match(tooSoon.mismatches.join(" "), /endpoint waits 900 ms/);
  const silenceFast = (atMs) => variant((a) => { a.atMs = atMs; Object.assign(a.endpoint, { end_of_turn: "silence", patience: "fast" }); });
  assert.equal((await run(silenceFast(3000))).status, "model-match", `${id}: Silence/Fast waits 2 s from the last speech`);
  assert.equal((await run(silenceFast(2999))).status, "fail");
  for (const cause of ["focus", "mute"]) {
    const forced = await run(variant((a) => { a.endpoint.cause = cause; }));
    assert.equal(forced.status, "fail", `${id}: a terminal forced by the ${cause} change`);
    assert.match(forced.mismatches.join(" "), /forced by/);
  }
  const after = await run(variant((a) => { a.endpoint.last_speech_ms = 1500; a.atMs = 4000; }));
  assert.equal(after.status, "fail", `${id}: speech cannot be captured after the route or mute`);
  const missing = await run(variant((a) => { delete a.endpoint; }));
  assert.equal(missing.status, "insufficient", `${id}: no source endpoint evidence is insufficient, not invented from the timestamp`);
  assert.deepEqual(missing.mismatches, []);
}

test("T06c mock case rejects a trace without the required focus switch", async () => {
  const fixture = (await loadMockScenarios()).find((item) => item.turn?.id === "T06c").turn;
  assert.equal((await runTurnFixture(fixture, { wait: async () => {} })).status, "model-match");
  const invalid = structuredClone(fixture);
  invalid.actions = invalid.actions.filter((action) => action.type !== "focus-switch");
  assert.equal((await runTurnFixture(invalid, { wait: async () => {} })).status, "fail");
  await endpointCases(fixture, "T06c");
  const wrongCall = structuredClone(fixture);
  wrongCall.actions[3].type = "conversation-a";
  assert.equal((await runTurnFixture(wrongCall, { wait: async () => {} })).status, "fail", "B speech cannot enter A's call");
});

test("all 25 numbered cases are selectable mock fixtures with timed actions and expected outcomes", async () => {
  const cases = (await loadMockScenarios()).filter((scenario) => scenario.turn);
  assert.deepEqual(cases.map((scenario) => scenario.turn.id), Object.keys(SCRIPTS).sort());
  for (const scenario of cases) {
    const turn = scenario.turn;
    assert.equal(turn.extends, "04-room-ready");
    assert.ok(turn.actions.length);
    assert.ok(turn.actions.every((action) => Number.isInteger(action.atMs) && action.atMs >= 0));
    assert.ok(Number.isInteger(turn.expect.epochDelta));
    assert.ok(Array.isArray(turn.expect.fates));
    assert.ok(Array.isArray(turn.expect.screen));
    assert.deepEqual(turn.delivery, ["push", "pull"]);
    assert.deepEqual(turn.fixture.boundaryMs, [2900, 3000]);
    assert.equal([...turn.fixture.unicode].length, 4);
    assert.ok(turn.fixture.longText.length > 500);
  }
});

test("each mock turn fixture executes timed actions and checks its observed outcome", async () => {
  const cases = (await loadMockScenarios()).filter((scenario) => scenario.turn);
  for (const scenario of cases) {
    const seen = [];
    const result = await runTurnFixture(scenario.turn, { wait: async () => {}, onStep: (step) => seen.push(step.action) });
    assert.equal(result.status, "model-match", `${scenario.turn.id}: ${result.mismatches.join("; ")}`);
    assert.deepEqual(seen, scenario.turn.actions.map((action) => action.type));
  }
  const changed = structuredClone(cases.find((scenario) => scenario.turn.id === "T04a").turn);
  changed.expect.fates[1] = "unplayed";
  assert.equal((await runTurnFixture(changed, { wait: async () => {} })).status, "fail");
});

test("every #19 model case rejects an omitted required step", async () => {
  for (const scenario of (await loadMockScenarios()).filter((item) => item.turn)) {
    const fixture = structuredClone(scenario.turn);
    for (let index = 0; index < fixture.actions.length; index++) {
      const missing = { ...fixture, actions: fixture.actions.filter((_, at) => at !== index) };
      const result = await runTurnFixture(missing, { wait: async () => {} });
      assert.equal(result.status, "fail", `${fixture.id}: omitting ${fixture.actions[index].type} must fail`);
    }
  }
});

test("T11 actually deduplicates turn IDs and rejects wrong out-of-order terminals", async () => {
  const fixture = (await loadMockScenarios()).find((item) => item.turn?.id === "T11").turn;
  const result = await runTurnFixture(fixture, { wait: async () => {} });
  assert.deepEqual(result.trace.at(-1).conversations, {
    a: { turnId: "a-turn-1", epoch: 1, finished: true }, b: { turnId: "b-turn-1", epoch: 1, finished: true },
  });
  for (const [index, value] of [[3, { turnId: "a-turn-2" }], [4, { aTurnId: "wrong-turn" }]]) {
    const invalid = structuredClone(fixture);
    Object.assign(invalid.actions[index], value);
    assert.equal((await runTurnFixture(invalid, { wait: async () => {} })).status, "fail");
  }
});

test("T13 mute waits for an ordinary terminal instead of ending the turn at the switch", async () => {
  const fixture = (await loadMockScenarios()).find((item) => item.turn?.id === "T13").turn;
  assert.equal((await runTurnFixture(fixture, { wait: async () => {} })).status, "model-match");
  await endpointCases(fixture, "T13");
});

test("T16 compares delivered envelope IDs and requires claim release before redelivery", async () => {
  const fixture = (await loadMockScenarios()).find((item) => item.turn?.id === "T16").turn;
  const result = await runTurnFixture(fixture, { wait: async () => {} });
  assert.deepEqual(result.trace.at(-1).deliveries.map(({ mode, id }) => [mode, id]),
    [["push", "message-1"], ["pull", "message-1"], ["pull-redelivery", "message-1"]]);
  for (const index of [1, 3]) {
    const invalid = structuredClone(fixture);
    invalid.actions[index].messageId = "different-message";
    assert.equal((await runTurnFixture(invalid, { wait: async () => {} })).status, "fail");
  }
});

test("reference oracle separates app hearing from physical loss and validates agent envelopes", async () => {
  const fixtures = (await loadMockScenarios()).filter((item) => ["T02b", "T07", "T16"].includes(item.turn?.id));
  const byId = Object.fromEntries(fixtures.map((item) => [item.turn.id, item.turn]));
  const run = (turn) => runTurnFixture(turn, { wait: async () => {} });
  assert.equal((await run(byId.T02b)).status, "model-match");
  const wrongEmpty = structuredClone(byId.T02b);
  wrongEmpty.actions.at(-1).notice = ["reply_not_heard"];
  assert.equal((await run(wrongEmpty)).status, "fail");
  const lost = await run(byId.T07);
  assert.equal(lost.status, "model-match");
  assert.deepEqual([lost.actual.fates, lost.actual.notice], [["unconfirmed"], []]);
  const invented = structuredClone(byId.T07);
  invented.actions.at(-1).semantic = [{ reply: 0, outcome: "not_heard" }];
  invented.actions.at(-1).notice = ["user_returned"];
  assert.equal((await run(invented)).status, "fail");
  assert.equal((await run(byId.T16)).status, "model-match");
  const wrongEnvelope = structuredClone(byId.T16);
  wrongEnvelope.actions[0].envelope = { id: "message-1", channel: "note", text: "The person is back", notice: { kind: "reply_not_heard" } };
  assert.equal((await run(wrongEnvelope)).status, "fail");
});

test("T08 typing leaves playback active until the later playback outcome", async () => {
  const fixture = (await loadMockScenarios()).find((item) => item.turn?.id === "T08").turn;
  const result = await runTurnFixture(fixture, { wait: async () => {} });
  assert.deepEqual(result.trace.find((item) => item.action === "typed-message").fates, ["playing"]);
  assert.equal(result.status, "model-match");
});

test("actual mock room probes reject missing typed context and wrong turn identity", async () => {
  const cases = (await loadMockScenarios()).filter((item) => ["T08", "T11"].includes(item.turn?.id));
  const typed = structuredClone(cases.find((item) => item.turn.id === "T08").turn);
  typed.actions = typed.actions.filter((action) => action.type !== "typed-message");
  assert.ok((await probeMockRoom(typed)).some((reason) => reason.includes("Typing changed")));
  const turns = structuredClone(cases.find((item) => item.turn.id === "T11").turn);
  turns.actions.find((action) => action.type === "out-of-order-finish").aTurnId = "wrong";
  assert.ok((await probeMockRoom(turns)).some((reason) => reason.includes("reordered terminals")));
});

test("candidate picker accepts only a full SHA, and source build verifies commit and records binary digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "turn-lab-source-test-"));
  const commands = [];
  const run = async (command, args, opts = {}) => {
    commands.push([command, args]);
    if (command === "git" && args[0] === "init") {
      await mkdir(join(root, "source-builds", `core-${SHA}`, ".git"), { recursive: true });
    }
    if (command === "git" && args.includes("fetch")) await writeFile(join(root, "source-builds", `core-${SHA}`, ".git/FETCH_HEAD"), `${SHA}\tnot-for-merge\n`);
    if (command === "git" && args.includes("checkout")) await writeFile(join(root, "source-builds", `core-${SHA}`, ".git/HEAD"), `${SHA}\n`);
    if (command === "cargo") {
      await mkdir(join(opts.cwd, "target/release"), { recursive: true });
      await writeFile(join(opts.cwd, "target/release/sidevoice-core-rust"), "verified binary");
    }
  };
  try {
    const api = async () => ({ sha: SHA });
    const builds = sourceBuilds({ cache: root, api, run });
    await assert.rejects(builds.get("core", "main"), /full 40-character SHA/);
    const built = await builds.get("core", SHA);
    assert.equal(built.source, SHA);
    assert.match(built.digest, /^[a-f0-9]{64}$/);
    assert.equal((await readFile(join(built.dir, "binary.json"), "utf8")).includes(built.digest), true);
    assert.equal(commands.filter(([command]) => command === "cargo").length, 1);
    await builds.get("core", SHA);
    assert.equal(commands.filter(([command]) => command === "cargo").length, 1);
    await writeFile(built.program, "tampered binary");
    await assert.rejects(sourceBuilds({ cache: root, api, run }).get("core", SHA), /binary digest changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.equal(archiveChoices([], "nightly", SHA)[0].value, `sha:${SHA}`);
});

test("Turn Lab forces the exact voice candidate even when its old version is published", async () => {
  const result = await plannedPins([["@sidevoice/voice", "0.3.0"]], async () => true, { voice: "/tmp/voice.tgz", forceVoice: true });
  assert.deepEqual(result, { replace: { "@sidevoice/voice": "file:/tmp/voice.tgz" }, missing: [] });
});

test("the scripted pull agent acknowledges a consumed message with get", async () => {
  const calls = [], events = [], stdout = new PassThrough();
  const child = {
    stdout, stderr: new PassThrough(), on() {}, kill() {},
    stdin: { write(line) {
      const request = JSON.parse(line);
      if (request.id == null) return;
      const name = request.params?.name;
      const args = request.params?.arguments ?? {};
      if (name) calls.push({ name, args });
      const result = name === "voice_connect" ? { conversation: "test-thread", initial_reply_context: { session_id: "s", revision: 1, epoch: 0 } }
        : name === "get_messages" && !args.ack_ids ? { messages: [{ message_id: "m1", channel: "voice", text: "Hello", session_id: "s", revision: 1, epoch: 0 }], cursor: 1 }
          : name === "get_messages" ? { messages: [], cursor: 1, acknowledged: 1 } : {};
      queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } }) + "\n"));
    } },
  };
  const agent = scriptedAgent({ program: "unused", profile: {}, emit: (event) => events.push(event), spawnProcess: () => child });
  try {
    await agent.start("pull");
    for (let i = 0; i < 100 && !calls.some((call) => call.args.ack_ids); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(calls.find((call) => call.args.ack_ids), { name: "get_messages", args: { conversation: "test-thread", ack_ids: ["m1"], after: 1 } });
    assert.equal(events.filter((event) => event.kind === "agent-input").length, 1);
  } finally { await agent.stop(); }
});

test("automatic MCP refusal is logged and connector loss clears readiness without crashing the lab", async () => {
  const events = [], stdout = new PassThrough();
  const child = new EventEmitter();
  child.stdout = stdout; child.stderr = new PassThrough(); child.kill = () => child.emit("exit", 0);
  let deliveryUrl;
  child.stdin = { write(line) {
    const packet = JSON.parse(line);
    if (packet.id == null) return;
    const name = packet.params?.name;
    const result = name === "voice_connect" ? { conversation: "test-thread", initial_reply_context: { session_id: "s", revision: 1, epoch: 0 } } : {};
    queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: "2.0", id: packet.id, result: {
      content: [{ type: "text", text: name === "voice_say" ? "connector disconnected" : JSON.stringify(result) }], isError: name === "voice_say",
    } }) + "\n"));
  } };
  const agent = scriptedAgent({ program: "unused", profile: {}, emit: (event) => events.push(event),
    spawnProcess: (_program, _args, options) => { deliveryUrl = options.env.SIDEVOICE_DELIVERY_URL; return child; } });
  try {
    await agent.start("push");
    await agent.choose("T01");
    assert.equal(agent.state.ready, true);
    await fetch(deliveryUrl, { method: "POST", body: JSON.stringify({ message_id: "m", channel: "voice", text: "Hello", session_id: "s", revision: 1, epoch: 0 }) });
    for (let i = 0; i < 100 && !events.some((event) => event.kind === "auto-reply-error"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(events.some((event) => event.kind === "auto-reply-error"), true);
    child.emit("exit", 1);
    assert.equal(agent.state.ready, false);
  } finally { await agent.stop(); }
});

test("T06a second click continues the same case with a distinct muted publication", async () => {
  const events = [], stdout = new PassThrough();
  const child = {
    stdout, stderr: new PassThrough(), on() {}, kill() {},
    stdin: { write(line) {
      const request = JSON.parse(line);
      if (request.id == null) return;
      const name = request.params?.name;
      const result = name === "voice_connect" ? { conversation: "mute-thread", initial_reply_context: { session_id: "s", revision: 1, epoch: 0 } }
        : name === "voice_say" ? { status: "published", audio: "queued" } : {};
      queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } }) + "\n"));
    } },
  };
  const agent = scriptedAgent({ program: "unused", profile: {}, emit: (event) => events.push(event), spawnProcess: () => child });
  try {
    await agent.start("push");
    assert.equal((await agent.choose("T06a")).phase, 1);
    assert.equal((await agent.choose("T06a")).phase, 2);
    assert.equal(events.filter((event) => event.kind === "script-start").length, 1);
    assert.equal(events.filter((event) => event.kind === "script-phase").length, 1);
    const published = events.filter((event) => event.kind === "tool-result" && event.data.name === "voice_say");
    assert.equal(published.length, 2);
    assert.notEqual(published[0].data.args.utterance_id, published[1].data.args.utterance_id);
    assert.equal(published[1].data.args.text, SCRIPTS.T06a.afterMute);
  } finally { await agent.stop(); }
});

test("T15 uses a supported Codex working harness and emits real activity transitions", async () => {
  const home = await mkdtemp(join(tmpdir(), "turn-lab-activity-"));
  const events = [], stdout = new PassThrough();
  let spawned;
  const child = {
    stdout, stderr: new PassThrough(), on() {}, kill() {},
    stdin: { write(line) {
      const request = JSON.parse(line);
      if (request.id == null) return;
      const result = request.params?.name === "voice_connect" ? { conversation: "working-thread", initial_reply_context: { session_id: "s", revision: 1, epoch: 0 } } : { status: "published" };
      queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } }) + "\n"));
    } },
  };
  const agent = scriptedAgent({ program: "unused", profile: { home }, emit: (event) => events.push(event), wait: async () => {},
    spawnProcess: (_program, _args, options) => { spawned = options; return child; } });
  try {
    await agent.start("push");
    assert.equal(spawned.env.SIDEVOICE_HARNESS, "codex");
    assert.equal(spawned.env.CODEX_THREAD_ID, spawned.env.SIDEVOICE_THREAD);
    await agent.choose("T15");
    await fetch(spawned.env.SIDEVOICE_DELIVERY_URL, { method: "POST", body: JSON.stringify({ message_id: "working-input", channel: "voice", text: "Check this", session_id: "s", revision: 1, epoch: 0 }) });
    for (let i = 0; i < 100 && events.filter((event) => event.kind === "script-activity").length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(events.filter((event) => event.kind === "script-activity").map((event) => event.data.phase), ["task_started", "task_complete"]);
    const date = new Date().toISOString().slice(0, 10).split("-");
    const file = join(home, ".codex", "sessions", ...date, `rollout-${spawned.env.CODEX_THREAD_ID}.jsonl`);
    const lines = (await readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(lines.map((line) => line.payload.type), ["task_started", "task_complete"]);
    assert.equal(lines[0].payload.turn_id, lines[1].payload.turn_id);
  } finally { await agent.stop(); await rm(home, { recursive: true, force: true }); }
});

test("case verdicts stay pending without evidence, record refusals and keep physical echo manual", () => {
  assert.equal(evidence([]).checks.T01.state, "pending");
  assert.equal(evidence([]).checks.T10.state, "manual");
  assert.equal(evidence([]).checks.T16.state, "manual");
  assert.equal(evidence([{ kind: "room-frame", data: { type: "voice-session", epoch: 2 } }]).currentEpoch, 2);
  const events = [
    { kind: "script-start", data: { id: "T02d", epoch: 0 } },
    { kind: "room-frame", data: { type: "voice-user-turn", phase: "started", epoch: 1 } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "a", event_id: "e", session_id: "s", revision: 1, epoch: 0 },
      result: { status: "rejected", reason: "user_speaking", terminal: true, utterance_id: "a", event_id: "e", instruction: "Wait for the person." } } },
    { kind: "agent-input", data: { channel: "note", text: "", notice: { kind: "turn_empty" }, message_id: "m", session_id: "s", epoch: 1 } },
  ];
  assert.equal(evidence(events).checks.T02d.state, "pass");
  events.find((event) => event.data?.name === "voice_say").data.result = { status: "accepted" };
  assert.equal(evidence(events).checks.T02d.state, "fail");
});

test("the evidence log splits semantic hearing by Unicode scalars", () => {
  const events = [
    { kind: "script-start", data: { id: "T01" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "u", text: "é🐙ab" }, result: { status: "published" } } },
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "u", status: "interrupted", heard_chars: 2, reason: "user_interrupted" } },
    { kind: "browser-action", data: { type: "reply-hearing", utterance_id: "u", outcome: "partial", heard_chars: 2 } },
    { kind: "agent-input", data: { channel: "voice", text: "Wait", epoch: 2, unheard: { replies: [{ utterance_id: "u", text: "é🐙ab", fate: "partial", heard_chars: 2 }] } } },
  ];
  const view = evidence(events);
  assert.equal(view.currentEpoch, 2);
  assert.equal(view.fates[0].fate, "partial");
  assert.equal(view.fates[0].heard, "é🐙");
  assert.equal(view.fates[0].unheard, "ab");
  assert.equal(view.fates[0].hearing_unconfirmed, true, "an agent report does not settle other targets");
  assert.equal(view.checks.T01.state, "pending", "a prefix alone does not prove the full playback sequence");
});

test("physical playback alone cannot certify hearing, including local Skip", () => {
  const events = [
    { kind: "script-start", data: { id: "T12" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "skip", text: "First" }, result: { status: "published", audio: "queued" } } },
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "skip", status: "interrupted" } },
  ];
  assert.equal(evidence(events).fates[0].fate, "unconfirmed");
  assert.equal(evidence(events).fates[0].hearing_unconfirmed, true);
  events.push({ kind: "browser-action", data: { type: "reply-hearing", client_msg_id: "r1", history_id: "s:voice:skip", utterance_id: "skip", outcome: "heard" } });
  assert.equal(evidence(events).fates[0].fate, "unconfirmed", "submission is not core confirmation");
  events.push({ kind: "room-frame", data: { type: "voice-ack", client_msg_id: "r1" } });
  assert.equal(evidence(events).fates[0].fate, "heard");
});

test("late history snapshots cannot regress confirmed semantic hearing", () => {
  const events = [
    { kind: "script-start", data: { id: "T04a" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "u", text: "é🐙ab" }, result: { status: "published", audio: "queued" } } },
    { kind: "browser-action", data: { type: "reply-hearing", client_msg_id: "r1", history_id: "s:voice:u", utterance_id: "u", outcome: "heard" } },
    { kind: "room-frame", data: { type: "voice-ack", client_msg_id: "r1" } },
    { kind: "room-frame", data: { type: "history", row: { role: "assistant", id: "s:voice:u", hearing: null, hearing_unconfirmed: true, status: "playing", text: "é🐙ab" } } },
  ];
  const row = evidence(events).fates[0];
  assert.equal(row.fate, "heard");
  assert.equal(row.heard_chars, 4);
  assert.equal(row.unheard, "");
});

test("earlier case verdicts and notices remain visible after another script starts", () => {
  const events = [
    { kind: "script-start", data: { id: "T02d", epoch: 0 } },
    { kind: "room-frame", data: { type: "voice-user-turn", phase: "started", epoch: 1 } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "a", event_id: "e", session_id: "s", revision: 1, epoch: 0 },
      result: { status: "rejected", reason: "user_speaking", terminal: true, utterance_id: "a", event_id: "e", instruction: "Wait for the person." } } },
    { kind: "agent-input", data: { channel: "note", text: "", notice: { kind: "turn_empty" }, message_id: "m", session_id: "s", epoch: 1 } },
    { kind: "script-start", data: { id: "T03" } },
  ];
  const view = evidence(events);
  assert.equal(view.checks.T02d.state, "pass");
  assert.equal(view.checks.T03.state, "pending");
  assert.equal(view.notes[0].kind, "turn_empty");
  assert.equal(view.currentEpoch, 1);
});

test("notices received before a script are still shown beside the room", () => {
  const events = [
    { kind: "agent-input", data: { channel: "note", message_id: "early", notice: { kind: "user_returned", instruction: "Person is back" } } },
    { kind: "script-start", data: { id: "T04a" } },
  ];
  assert.deepEqual(evidence(events).notes.map((note) => note.kind), ["user_returned"]);
  assert.deepEqual(evidence(events).inputs.map((input) => input.message_id), ["early"]);
});

test("FIFO check requires observed playback starts in publication order", () => {
  const events = [{ kind: "script-start", data: { id: "T04a" } }];
  for (const id of ["a", "b", "c"]) events.push({ kind: "tool-result", data: { name: "voice_say", args: { utterance_id: id, text: id }, result: { status: "published", audio: "queued" } } });
  for (const id of ["a", "c", "b"]) events.push({ kind: "browser-action", data: { type: "voice-playback", utterance_id: id, status: "playing" } });
  assert.equal(evidence(events).checks.T04a.state, "fail");
  events.splice(4, 3, { kind: "browser-action", data: { type: "voice-playback", utterance_id: "a", status: "playing" } });
  assert.equal(evidence(events).checks.T04a.state, "pending");
  for (const [index, id] of ["a", "b", "c"].entries()) {
    if (index) events.push({ kind: "browser-action", data: { type: "voice-playback", utterance_id: id, status: "playing" } });
    events.push({ kind: "browser-action", data: { type: "voice-playback", utterance_id: id, status: "heard" } });
  }
  assert.equal(evidence(events).checks.T04a.state, "pending", "physical FIFO still needs semantic acknowledgements");
  for (const id of ["a", "b", "c"]) events.push({ kind: "browser-action", data: { type: "reply-hearing", utterance_id: id, outcome: "heard" } });
  assert.equal(evidence(events).checks.T04a.state, "pending", "unacknowledged semantic submissions still need IDs and core confirmation");
});

test("uncertain speech admission is not reported as a resolved outcome", () => {
  const events = [
    { kind: "script-start", data: { id: "T07" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "uncertain", text: "Retry me" }, result: { status: "admission_unknown" } } },
  ];
  const view = evidence(events);
  assert.equal(view.checks.T07.state, "manual");
  assert.equal(view.fates[0].fate, "unconfirmed");
  assert.equal(view.fates[0].audio, "admission_unknown");
});

test("mock voice discards short overlap but qualifies a sustained barge-in", async () => {
  let clock = 0;
  const world = createWorld({ id: "gate", title: "Gate", summary: "", world: {}, options: [] }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  const turns = [];
  voice.host.onTurn((turn) => turns.push(turn));
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" }, barge_in_min_speech: 1 });
  await voice.host.start();
  const saying = voice.host.say("Long reply for the duration gate. ".repeat(50));
  await Promise.resolve();
  await voice.speak("ajá", { durationMs: 990 });
  assert.equal(turns.length, 0);
  await voice.speak("Please stop there", { durationMs: 1300 });
  assert.equal(turns.filter((turn) => turn.phase === "started").length, 1);
  const outcome = await saying.outcome;
  assert.equal(outcome.status, "heard-up-to");
  assert.equal(outcome.reason, "barge-in");
  assert.ok(outcome.heard_chars >= 0 && outcome.heard_chars < [..."Long reply for the duration gate. ".repeat(50)].length);
  await voice.speak("vale", { durationMs: 300 });
  assert.equal(turns.filter((turn) => turn.phase === "started").length, 2);
  await voice.host.stop();
});

test("mock voice completes three queued replies in FIFO order", async () => {
  let clock = 0;
  const world = createWorld({ id: "fifo", title: "FIFO", summary: "", world: {}, options: [], turn: {} }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" } });
  await voice.host.start();
  const seen = [];
  const says = ["One.", "Two.", "Three."].map((text, index) => {
    const saying = voice.host.say(text);
    saying.onEvent((event) => { if (["playing", "done"].includes(event.type)) seen.push(`${event.type}:${index + 1}`); });
    return saying;
  });
  await Promise.all(says.map((say) => say.outcome));
  assert.deepEqual(seen, ["playing:1", "done:1", "playing:2", "done:2", "playing:3", "done:3"]);
  await voice.host.stop();
});

test("mock voice keeps A and B turns in separate running calls across an input route", async () => {
  let clock = 0;
  const world = createWorld({ id: "boundary", title: "Boundary", summary: "", world: {}, options: [] }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  const a = voice.host.createCall(), b = voice.host.createCall();
  assert.notEqual(a.id, b.id);
  assert.equal(typeof voice.host.setCaptureBoundary, "undefined");
  assert.equal(typeof a.onAgentInterrupted, "undefined");
  await assert.rejects(voice.host.routeInput({ id: "foreign" }), { code: "unknown-voice-call" });
  const turns = [];
  let aStarted, aStoppedSpeaking;
  const began = new Promise((resolve) => { aStarted = resolve; });
  const paused = new Promise((resolve) => { aStoppedSpeaking = resolve; });
  a.onTurn((event) => { turns.push(["a", event]); if (event.phase === "started") aStarted(); });
  b.onTurn((event) => turns.push(["b", event]));
  a.onLevel((level) => { if (level === 0) aStoppedSpeaking(); });
  for (const call of [a, b]) {
    await call.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" }, end_of_turn: "silence", patience: "normal" });
    await call.start();
  }
  await voice.host.routeInput(a);
  const first = voice.speak("Words for A");
  await began;
  await paused;
  await voice.host.routeInput(b);
  assert.equal(turns.filter(([, event]) => event.phase === "finished").length, 0, "routing does not flush A");
  const second = voice.speak("Words for B");
  await Promise.all([first, second]);
  assert.deepEqual(turns.filter(([, event]) => event.phase === "finished").map(([call, event]) => [call, event.text]),
    [["a", "Words for A"], ["b", "Words for B"]]);
  assert.ok(turns.every(([, event]) => !Object.hasOwn(event, "capture_boundary_id")));
  await voice.host.routeInput(null);
  assert.equal(await voice.speak("No routed call"), false);
  await a.dispose();
  await b.dispose();
});

// The microphone is shared: once the route (or the mute) moves away from a call speaking, that call hears silence
// for the rest of the utterance, keeps what it captured, and ends its turn at the ordinary endpoint (Silence/Normal
// waits 2.5 s), never at the switch.
async function sharedMicrophone() {
  let clock = 0;
  const world = createWorld({ id: "mic", title: "Mic", summary: "", world: {}, options: [] }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  const a = voice.host.createCall(), b = voice.host.createCall();
  const log = [];
  for (const [key, call] of [["a", a], ["b", b]]) {
    call.onTurn((event) => log.push({ call: key, at: clock, event }));
    call.onLevel((level) => log.push({ call: key, at: clock, level }));
    await call.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" }, end_of_turn: "silence", patience: "normal" });
    await call.start();
  }
  await voice.host.routeInput(a);
  return { voice, a, b, log, now: () => clock };
}
const finished = (log, key) => log.filter((item) => item.call === key && item.event?.phase === "finished");
const levelsAfter = (log, key, at) => log.filter((item) => item.call === key && item.level > 0 && item.at > at);
const FULL = "one two three four five six seven eight";

for (const [name, leave] of [
  ["routed to the other call", (m) => m.voice.host.routeInput(m.b)],
  ["routed to nobody", (m) => m.voice.host.routeInput(null)],
  ["muted", async (m) => m.a.mute(true)],
]) {
  test(`mock voice: a call speaking when the microphone is ${name} hears silence from then on and ends at its ordinary endpoint`, async () => {
    const m = await sharedMicrophone();
    let left = null;
    m.a.onLevel((level) => { if (level > 0 && left === null && m.log.filter((item) => item.call === "a" && item.level > 0).length > 5) left = leave(m).then(() => m.now()); });
    const speaking = m.voice.speak(FULL);
    await speaking;
    const leftAt = await left;
    assert.ok(leftAt != null, "the route changed mid-speech");
    assert.deepEqual(levelsAfter(m.log, "a", leftAt), [], "no microphone speech reaches A after the change");
    const [end] = finished(m.log, "a");
    assert.ok(end, "A still ends its turn, with what it captured");
    assert.ok(end.event.text.length > 0 && end.event.text.length < FULL.length && FULL.startsWith(end.event.text), `A keeps only its captured words, got ${end.event.text}`);
    assert.ok(end.at - leftAt >= 2500, `the terminal came ${end.at - leftAt} ms after the change; the endpoint is 2500 ms`);
    assert.ok(end.at - leftAt <= 2500 + 500 + 160, `the terminal came ${end.at - leftAt} ms after the change; the endpoint plus 500 ms recognition (and one 80 ms step) is the most`);
    await m.a.dispose();
    await m.b.dispose();
  });
}

test("mock voice: A→B mid-speech leaves B its own words and A its own, with no cross-call text", async () => {
  const m = await sharedMicrophone();
  let routed = false;
  m.a.onLevel((level) => { if (level > 0 && !routed && m.log.filter((item) => item.call === "a" && item.level > 0).length > 5) { routed = true; m.voice.host.routeInput(m.b).then(() => m.voice.speak("Words for B")); } });
  await m.voice.speak(FULL);
  while (!finished(m.log, "b").length) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished(m.log, "b")[0].event.text, "Words for B");
  assert.ok(FULL.startsWith(finished(m.log, "a")[0].event.text));
  assert.ok(!finished(m.log, "a")[0].event.text.includes("B"));
  await m.a.dispose();
  await m.b.dispose();
});

test("mock voice: speech routed back to A before its endpoint continues the same open turn", async () => {
  const m = await sharedMicrophone();
  let step = 0;
  m.a.onLevel(async (level) => {
    if (level === 0 && step === 0) { step = 1; await m.voice.host.routeInput(m.b); await m.voice.host.routeInput(m.a); step = 2; m.voice.speak("and then more"); }
  });
  await m.voice.speak("first part");
  while (step < 2 || !finished(m.log, "a").length) await new Promise((resolve) => setImmediate(resolve));
  const starts = m.log.filter((item) => item.call === "a" && item.event?.phase === "started");
  assert.equal(starts.length, 1, "one open turn");
  assert.equal(finished(m.log, "a").length, 1);
  assert.match(finished(m.log, "a")[0].event.text, /^first part and then more$/);
  await m.a.dispose();
  await m.b.dispose();
});

test("mock voice: speech after the endpoint is a new turn, and an unrouted call cannot start one", async () => {
  const m = await sharedMicrophone();
  await m.voice.speak("early words");
  await m.voice.host.routeInput(m.b);
  assert.equal(await m.a.mute(false), undefined);
  await m.voice.speak("for b");
  assert.equal(m.log.filter((item) => item.call === "a" && item.event?.phase === "started").length, 1);
  assert.equal(finished(m.log, "b")[0].event.text, "for b");
  await m.a.dispose();
  await m.b.dispose();
});

test("mock voice: A closes at its configured endpoint while a longer utterance goes on elsewhere, and a late return opens a new turn", async () => {
  const m = await sharedMicrophone();
  let routedAt = null, returned = null, closing = null;
  m.a.onLevel((level) => {
    if (level > 0 && routedAt === null && m.log.filter((item) => item.call === "a" && item.level > 0).length > 5) { routedAt = m.now(); m.voice.host.routeInput(m.b); }
  });
  // A's turn closing is observed while the 6 s utterance is still running: the person goes on, A has already finished.
  m.a.onTurn((event) => {
    if (event.phase !== "finished" || returned) return;
    closing = { waited: m.now() - routedAt, silentStepsLeft: 0 };
    returned = m.voice.host.routeInput(m.a).then(() => m.voice.speak("returned words"));
  });
  m.a.onLevel((level) => { if (closing && level === 0) closing.silentStepsLeft++; });
  await m.voice.speak(FULL, { durationMs: 6000 });
  await returned;
  assert.ok(closing, "A finished");
  assert.ok(closing.waited >= 2500 + 500, `A closed ${closing.waited} ms after the route moved; endpoint plus recognition is the least`);
  assert.ok(closing.waited <= 2500 + 500 + 160, `A closed ${closing.waited} ms after the route moved; endpoint plus recognition is the most`);
  assert.ok(closing.silentStepsLeft > 10, "the rest of the utterance was still being spoken when A closed");
  const [first, second] = finished(m.log, "a").map((item) => item.event.text);
  assert.ok(first.length > 0 && first !== FULL && FULL.startsWith(first), `A keeps the words it captured: ${first}`);
  assert.equal(second, "returned words", "the return after the endpoint is a separate turn, not merged with the closed one");
  const starts = m.log.filter((item) => item.call === "a" && item.event?.phase === "started");
  assert.equal(starts.length, 2, "the return after the endpoint starts a new turn");
  assert.notEqual(starts[0].event.turn_id, starts[1].event.turn_id);
  await m.a.dispose();
  await m.b.dispose();
});
