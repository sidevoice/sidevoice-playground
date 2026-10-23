import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_VERSION, EXIT_NOTICE_MS, MUTE_SHORTCUT, cardHost, endedByItself, gateOpen } from "../preview/mock/card-host.mjs";
import { attach } from "../preview/mock/attach.mjs";
import { mockFile } from "../preview/proxy.mjs";
import { VARIANTS } from "../preview/mock/shell.mjs";
import { withoutPreviewTurns } from "../preview/mock/card.mjs";

// The preview's floating card host (sidevoice-web FLOATING-CARD-SPEC §8): the desktop card's seam, fed from the room
// frame's store as the desktop bridge feeds it, and the desktop's part played: when the card is wanted, what each
// command does.

/** A card snapshot as the room projects it (the web's callCardView): a call on "a", set up. */
const card = (extra = {}) => ({
  ready: true, joined: true, busy: false, micEnabled: true, micDisabled: false, title: "Claude", agent: "idle", youTalking: false,
  canSkip: false, conversation: "a", devices: { inputs: [], outputs: [], inputId: "", outputId: "", available: true, outputAvailable: true, busy: false },
  participants: [{ threadId: "a", title: "Claude", available: true, switching: false }, { threadId: "b", title: "Codex", available: false, switching: false }],
  setupDone: true, mood: "idle", turn: null, idleWarning: false, ended: null, busyReason: null, switchingTo: null, theme: "dark", language: "en",
  micSilent: false, ...extra,
});

function channel(initial = null) {
  const listeners = new Set();
  let last = initial;
  return {
    publish(value) { last = value; for (const listener of listeners) listener(value); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    current: () => last,
  };
}

/** The room frame's window: its store (`callCard`), its level and caption channels, its actions. */
function room(initial = card()) {
  let view = { callCard: initial };
  const listeners = new Set();
  const store = { getState: () => view, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
  const actions = {
    toggleMic: mock.fn(), toggleCall: mock.fn(async () => {}), skipReply: mock.fn(),
    selectParticipant: mock.fn(), keepVoiceOn: mock.fn(), setAudioDevices: mock.fn(),
  };
  const ui = { store, micLevel: channel(0), caption: channel(null) };
  return {
    window: { sidevoiceUI: ui, sidevoiceActions: actions }, ui, actions,
    set(fields) { view = { callCard: { ...view.callCard, ...fields } }; for (const listener of listeners) listener(view); },
  };
}

function setup(initial, options = {}) {
  const page = room(initial);
  let clock = 1_000_000;
  const shows = [];
  const logged = [];
  const controller = cardHost(() => page.window, {
    now: () => clock, poll: false, world: { log: (entry) => logged.push(`${entry.method} ${entry.url} → ${entry.status}`) },
    onShow: (shown) => shows.push(shown), ...options,
  });
  const states = [];
  controller.host.subscribe((state) => states.push(state));
  return { page, controller, host: controller.host, states, shows, logged, last: () => states.at(-1), advance(ms) { clock += ms; controller.tick(); }, at: () => clock };
}

test("the card is told the room's own snapshot, passed through, with the host's stamps and channels", () => {
  const { page, last, at } = setup(undefined, { alwaysExpanded: () => true });
  assert.deepEqual(last().call, { ...card(), version: BRIDGE_VERSION, since: at() });
  assert.equal(last().pointerInside, null);
  assert.equal(last().alwaysExpanded, true);
  assert.equal(last().muteShortcut, MUTE_SHORTCUT);
  assert.equal(last().outsideClicks, 0);
  // The level whatever the call model (FC14), and the caption on its own channel (FC8).
  page.ui.micLevel.publish(42);
  assert.equal(last().level, 42);
  page.ui.caption.publish({ who: "agent", previous: "", current: "Hello there", spoken: 5, source: "voice" });
  assert.equal(last().caption.current, "Hello there");
  page.set({ title: "Codex" });
  assert.equal(last().call.title, "Codex");
});

test("the gate: set up, and the call on; `since` is when it opened", () => {
  const { page, shows, last, advance } = setup(card({ setupDone: false }));
  assert.deepEqual(shows, [false]);
  page.set({ setupDone: true });
  assert.deepEqual(shows, [false, true]);
  const opened = last().call.since;
  advance(5000);
  page.set({ title: "x" });
  assert.equal(last().call.since, opened, "the same call keeps its start");
  page.set({ joined: false });
  assert.equal(shows.at(-1), false);
  assert.equal(last().call.since, null);
  assert.equal(gateOpen(card({ joined: false })), false);
});

test("the exit notice: the card stays a while when the call ends by itself, held while the pointer is over it; never after a hang-up", () => {
  const { page, controller, shows, advance, logged } = setup();
  page.set({ joined: false, ended: { reason: "idle", detail: "" } });
  assert.equal(shows.at(-1), true, "it stays to say why");
  advance(EXIT_NOTICE_MS - 1);
  assert.equal(shows.at(-1), true);
  controller.hold(true);
  advance(10_000);
  assert.equal(shows.at(-1), true, "held while the pointer is over it");
  controller.hold(false);
  assert.equal(shows.at(-1), false);
  // Close ends it at once.
  page.set({ joined: true, ended: null });
  page.set({ joined: false, ended: { reason: "failed", detail: "closed" } });
  assert.equal(shows.at(-1), true);
  controller.host.run({ command: "dismiss" });
  assert.equal(shows.at(-1), false);
  assert.ok(logged.includes("card dismiss → closed"));
  // The person hanging up: no notice.
  page.set({ joined: true, ended: null });
  page.set({ joined: false });
  assert.equal(shows.at(-1), false);
  assert.equal(endedByItself(card({ ended: { reason: "offline", detail: "Claude" } })), true);
  assert.equal(endedByItself(card()), false);
});

test("the commands: the room's actions, refused where its own controls would be", () => {
  const { page, host, logged } = setup(card({ canSkip: true }));
  for (const command of ["toggle-mute", "skip-reply", "hang-up", "keep-alive"]) assert.equal(host.run({ command }), true, command);
  assert.equal(page.actions.toggleMic.mock.callCount(), 1);
  assert.equal(page.actions.skipReply.mock.callCount(), 1);
  assert.equal(page.actions.toggleCall.mock.callCount(), 1);
  assert.equal(page.actions.keepVoiceOn.mock.callCount(), 1);
  // A command the card does not have means nothing; a conversation that is not there cannot take the call.
  for (const request of [{ command: "unknown" }, { command: "select-participant", threadId: "b" }]) {
    assert.equal(host.run(request), false, request.command);
  }
  assert.equal(host.run({ command: "select-participant", threadId: "a" }), true);
  assert.deepEqual(page.actions.selectParticipant.mock.calls.map((call) => call.arguments), [["a"]]);
  page.set({ micDisabled: true, canSkip: false });
  assert.equal(host.run({ command: "toggle-mute" }), false);
  assert.equal(host.run({ command: "skip-reply" }), false);
  assert.ok(logged.includes("card toggle-mute → ran"));
  assert.ok(logged.includes("card unknown → refused"));
});

test("a device chosen: the room's own choice (the system's as null), the card's devices busy until it answers", async () => {
  let answer;
  const { page, host, last } = setup();
  page.actions.setAudioDevices.mock.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  host.run({ command: "select-audio-device", kind: "input", id: "" });
  assert.deepEqual(page.actions.setAudioDevices.mock.calls[0].arguments, [{ input: null }]);
  assert.equal(last().call.devices.busy, true);
  answer();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(last().call.devices.busy, false);
});

test("Open Sidevoice, the size, a drag and clicks elsewhere: the shell's to show, placement the desktop's", () => {
  const opened = mock.fn(), sized = mock.fn();
  const { controller, host, last, logged } = setup(undefined, { onOpen: opened, onLayout: sized });
  host.run({ command: "open-app" });
  assert.equal(opened.mock.callCount(), 1);
  host.layout({ width: 312.4, height: 254 });
  host.layout({ width: 0, height: 0 });
  assert.deepEqual(sized.mock.calls.map((call) => call.arguments[0]), [{ width: 312, height: 254 }]);
  host.drag("start"); host.drag("move"); host.drag("end"); host.drag("start");
  assert.equal(logged.filter((line) => line.startsWith("card drag")).length, 1);
  controller.outsideClick();
  assert.equal(last().outsideClicks, 1);
});

test("a room frame loaded again (a scenario, a reload) is followed anew", () => {
  const first = room(card({ title: "First" }));
  const second = room(card({ title: "Second" }));
  let now = first;
  const controller = cardHost(() => now.window, { poll: false });
  const states = [];
  controller.host.subscribe((state) => states.push(state));
  assert.equal(states.at(-1).call.title, "First");
  now = second;
  controller.tick();
  assert.equal(states.at(-1).call.title, "Second");
  first.set({ title: "Gone" });
  assert.equal(states.at(-1).call.title, "Second", "the old room is no longer followed");
});

test("the card page gets the app's card seam and nothing else; the shell serves the host", async () => {
  const seam = { subscribe() {} };
  const win = { location: { pathname: "/voice/call-controls.html" }, fetch: "untouched" };
  attach(/** @type {any} */ (win), { world: null, identities: null, desktop: true, card: () => seam });
  assert.deepEqual(win.__sidevoiceDesktop, { host: { app: "sidevoice-desktop", callControls: seam } });
  assert.equal(win.fetch, "untouched", "the card fetches nothing");
  assert.ok(await mockFile("/preview-mock/card-host.mjs"));
  assert.ok(!VARIANTS.some((variant) => variant.name === "floating-card"), "the floating card's options are out of this release");
  assert.deepEqual(VARIANTS.map((variant) => [variant.name, variant.values.map((option) => option.value)]),
    [["modelSummary", ["status", "facts", "advanced", "chip", "chipfacts", "chipadvanced"]], ["modelList", ["sized", "names", "twolines"]],
      ["hardwareLabel", ["class", "technical", "both"]]],
    "the open choices are the model blocks', each first the web's default: the title's call details and the onboarding flow are decided");
});

test("removing visual sample turns leaves the scenario's seeded messages alone", () => {
  const seeded = { segment: "seed-1", text: "Already here" };
  assert.deepEqual(withoutPreviewTurns([seeded, { segment: "preview-you-1" }, { segment: "preview-agent-2" }]), [seeded]);
});
