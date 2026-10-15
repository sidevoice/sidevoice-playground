import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { runTurnFixture } from "../preview/mock/turn-script.mjs";
import { probeMockRoom } from "../preview/mock/turn-machine-probes.mjs";
import { sourceBuilds } from "../preview/source-build.mjs";
import { SCRIPTS, scriptedAgent } from "../preview/turn-lab/agent.mjs";
import { evidence } from "../preview/turn-lab/evidence.mjs";
import { plannedPins } from "../preview/web-build.mjs";
import { archiveChoices } from "../web/preview/choices.mjs";

const SHA = "a".repeat(40);

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
  for (const [index, value] of [[2, { turnId: "a-turn-2" }], [3, { aTurnId: "wrong-turn" }]]) {
    const invalid = structuredClone(fixture);
    Object.assign(invalid.actions[index], value);
    assert.equal((await runTurnFixture(invalid, { wait: async () => {} })).status, "fail");
  }
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
    { kind: "script-start", data: { id: "T02d" } },
    { kind: "tool-result", data: { name: "voice_say", result: { status: "rejected", reason: "user_speaking" } } },
    { kind: "agent-input", data: { channel: "note", text: "", notice: { kind: "turn_empty" }, epoch: 1 } },
  ];
  assert.equal(evidence(events).checks.T02d.state, "pass");
  events[1].data.result = { status: "accepted" };
  assert.equal(evidence(events).checks.T02d.state, "fail");
});

test("the evidence log splits heard and unheard by Unicode scalars", () => {
  const events = [
    { kind: "script-start", data: { id: "T01" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "u", text: "é🐙ab" }, result: { status: "published" } } },
    { kind: "agent-input", data: { channel: "voice", text: "Wait", epoch: 2, unheard: { replies: [{ utterance_id: "u", text: "é🐙ab", fate: "interrupted", cut: true, heard_chars: 2, reason: "user_interrupted" }] } } },
  ];
  const view = evidence(events);
  assert.equal(view.currentEpoch, 2);
  assert.deepEqual(view.fates[0], { utterance_id: "u", fate: "cut", heard_chars: 2, text: "é🐙ab", reason: "user_interrupted", heard: "é🐙", unheard: "ab" });
  assert.equal(view.checks.T01.state, "pass");
});

test("browser playback receipts and history settle reply fates", () => {
  const events = [
    { kind: "script-start", data: { id: "T12" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "skip", text: "First" }, result: { status: "published", audio: "queued" } } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "next", text: "Second" }, result: { status: "published", audio: "queued" } } },
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "skip", status: "interrupted", reason: "user_skipped", heard_chars: 2 } },
    { kind: "room-frame", data: { type: "history", utterance_id: "skip", status: "skipped", reason: "user_skipped", heard_chars: 5 } },
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "next", status: "heard", heard_chars: 6 } },
    { kind: "agent-input", data: { channel: "note", notice: { kind: "reply_skipped" } } },
  ];
  assert.equal(evidence(events).fates[0].fate, "skipped");
  assert.equal(evidence(events).checks.T12.state, "pass");
});

test("late snapshots cannot regress a terminal reply fate or confirmed hearing", () => {
  const events = [
    { kind: "script-start", data: { id: "T04a" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "u", text: "é🐙ab" }, result: { status: "published", audio: "queued" } } },
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "u", status: "heard", heard_chars: 4 } },
    { kind: "room-frame", data: { type: "history", utterance_id: "u", status: "playing", heard_chars: 1, text: "é🐙ab" } },
    { kind: "room-frame", data: { type: "voice-reply", utterance_id: "u", text: "é🐙ab" } },
  ];
  const fate = evidence(events).fates[0];
  assert.equal(fate.fate, "played");
  assert.equal(fate.heard_chars, 4);
  assert.equal(fate.unheard, "");
});

test("earlier case verdicts and notices remain visible after another script starts", () => {
  const events = [
    { kind: "script-start", data: { id: "T02d" } },
    { kind: "tool-result", data: { name: "voice_say", result: { status: "rejected", reason: "user_speaking" } } },
    { kind: "agent-input", data: { channel: "note", text: "", notice: { kind: "turn_empty" }, epoch: 1 } },
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
  events.splice(4, 3, ...["a", "b", "c"].map((id) => ({ kind: "browser-action", data: { type: "voice-playback", utterance_id: id, status: "playing" } })));
  assert.equal(evidence(events).checks.T04a.state, "pending");
  for (const id of ["a", "b", "c"]) events.push({ kind: "browser-action", data: { type: "voice-playback", utterance_id: id, status: "heard" } });
  assert.equal(evidence(events).checks.T04a.state, "pass");
});

test("uncertain speech admission is not reported as a resolved outcome", () => {
  const events = [
    { kind: "script-start", data: { id: "T07" } },
    { kind: "tool-result", data: { name: "voice_say", args: { utterance_id: "uncertain", text: "Retry me" }, result: { status: "admission_unknown" } } },
  ];
  const view = evidence(events);
  assert.equal(view.checks.T07.state, "manual");
  assert.equal(view.fates[0].fate, "admission_unknown");
});

test("mock voice discards short overlap but qualifies a sustained barge-in", async () => {
  let clock = 0;
  const world = createWorld({ id: "gate", title: "Gate", summary: "", world: {}, options: [] }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  const turns = [], cuts = [];
  voice.host.onTurn((turn) => turns.push(turn));
  voice.host.onAgentInterrupted((cut) => cuts.push(cut));
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" }, barge_in_min_speech: 1 });
  await voice.host.start();
  const saying = voice.host.say("Long reply for the duration gate. ".repeat(50));
  await Promise.resolve();
  await voice.speak("ajá", { durationMs: 990 });
  assert.equal(turns.length, 0);
  assert.equal(cuts.length, 0);
  await voice.speak("Please stop there", { durationMs: 1300 });
  assert.equal(turns.filter((turn) => turn.phase === "started").length, 1);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].played, true);
  assert.equal((await saying.outcome).status, "heard-up-to");
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

test("mock voice keeps a source turn's capture boundary through transcription", async () => {
  let clock = 0;
  const world = createWorld({ id: "boundary", title: "Boundary", summary: "", world: {}, options: [] }, {}, {
    now: () => clock, tick: async (ms) => { clock += ms; await Promise.resolve(); },
  });
  const voice = fakeVoice(world);
  const turns = [];
  let started;
  const began = new Promise((resolve) => { started = resolve; });
  voice.host.onTurn((event) => { turns.push(event); if (event.phase === "started") started(); });
  await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro" } });
  await voice.host.start();
  await voice.host.setCaptureBoundary("conversation-a");
  const first = voice.speak("Words for A");
  await began;
  await voice.host.setCaptureBoundary("conversation-b");
  await first;
  await voice.speak("Words for B");
  assert.deepEqual(turns.filter((event) => event.phase === "finished").map((event) => event.capture_boundary_id), ["conversation-a", "conversation-b"]);
  await voice.host.stop();
});
