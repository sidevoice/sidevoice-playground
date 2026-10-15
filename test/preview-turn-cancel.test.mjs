import { test } from "node:test";
import assert from "node:assert/strict";
import { removePreviewTurns, simulateAgent, simulateUser } from "../preview/mock/card.mjs";

function frame() {
  const state = { facts: { viewedThread: "thread-1", sessionId: "session-1", history: [
    { segment: "seeded-1", role: "user", text: "Seeded", thread: "thread-1" },
  ], harness: {} }, participants: [{ threadId: "thread-1", title: "Agent" }] };
  const store = { getState: () => state, patch: (patch) => Object.assign(state.facts, patch) };
  return { contentWindow: { sidevoiceUI: { store, micLevel: { publish() {} } } }, state };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

for (const phase of ["listening", "transcribing"]) test(`removing a preview turn during ${phase} cancels later patches`, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const shown = frame();
  assert.equal(simulateUser(shown, "Preview message"), true);
  if (phase === "transcribing") { t.mock.timers.tick(3000); await flush(); }
  assert.equal(shown.state.facts.pendingPhase, phase);
  assert.equal(removePreviewTurns(shown), true);
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(shown.state.facts.history.map((row) => row.segment), ["seeded-1"]);
  assert.equal(shown.state.facts.pendingPhase, "");
  assert.equal(shown.state.facts.userLive, false);
});

test("removing a preview agent reply stops its karaoke and completion patches", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const shown = frame();
  assert.equal(simulateAgent(shown, "Preview agent reply"), true);
  t.mock.timers.tick(260);
  await flush();
  assert.equal(removePreviewTurns(shown), true);
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(shown.state.facts.history.map((row) => row.segment), ["seeded-1"]);
  assert.equal(shown.state.facts.botLive, false);
  assert.equal(shown.state.facts.karaokeState, null);
});

test("a simulated turn feeds the page's level() and restores it after", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const shown = frame();
  const audio = { readWaveform: () => null, level: () => 0 };
  shown.contentWindow.sidevoiceAudio = audio;
  simulateUser(shown, "Loud");
  let peak = 0;
  for (let i = 0; i < 40; i++) { t.mock.timers.tick(50); peak = Math.max(peak, audio.level()); }
  assert.ok(peak > 0.04, "level() rises above the web's silence threshold");
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(audio.level(), 0);
});

test("overlapping simulations keep the newer turn until it completes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
  const shown = frame();
  simulateUser(shown, "First");
  t.mock.timers.tick(1000);
  simulateUser(shown, "Second");
  const second = shown.state.facts.userTurn.segment;
  t.mock.timers.tick(2500);
  await flush();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(shown.state.facts.userTurn?.segment, second, "the first completing leaves the second's turn");
  for (let i = 0; i < 10; i++) { t.mock.timers.tick(1000); await flush(); }
  assert.equal(shown.state.facts.userTurn, null);
  assert.deepEqual(shown.state.facts.history.map((row) => row.text), ["Seeded", "First", "Second"]);
});
