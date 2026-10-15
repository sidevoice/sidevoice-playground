import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { sourceBuilds } from "../preview/source-build.mjs";
import { SCRIPTS } from "../preview/turn-lab/agent.mjs";
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

test("case verdicts stay pending without evidence, record refusals and keep physical echo manual", () => {
  assert.equal(evidence([]).checks.T01.state, "pending");
  assert.equal(evidence([]).checks.T10.state, "manual");
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
    { kind: "agent-input", data: { channel: "voice", text: "Wait", epoch: 2, unheard: { replies: [{ utterance_id: "u", text: "é🐙ab", fate: "interrupted", heard_chars: 2, reason: "user_interrupted" }] } } },
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
    { kind: "browser-action", data: { type: "voice-playback", utterance_id: "skip", status: "interrupted", reason: "user_skipped", heard_chars: 2 } },
    { kind: "room-frame", data: { type: "history", utterance_id: "skip", status: "skipped", reason: "user_skipped", heard_chars: 5 } },
    { kind: "agent-input", data: { channel: "note", notice: { kind: "reply_skipped" } } },
  ];
  assert.equal(evidence(events).fates[0].fate, "skipped");
  assert.equal(evidence(events).checks.T12.state, "pass");
});

test("earlier case verdicts and notices remain visible after another script starts", () => {
  const events = [
    { kind: "script-start", data: { id: "T02d" } },
    { kind: "tool-result", data: { name: "voice_say", result: { status: "rejected", reason: "user_speaking" } } },
    { kind: "agent-input", data: { channel: "note", notice: { kind: "turn_empty" }, epoch: 1 } },
    { kind: "script-start", data: { id: "T03" } },
  ];
  const view = evidence(events);
  assert.equal(view.checks.T02d.state, "pass");
  assert.equal(view.checks.T03.state, "pending");
  assert.equal(view.notes[0].kind, "turn_empty");
  assert.equal(view.currentEpoch, 1);
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
