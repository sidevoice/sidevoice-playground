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
