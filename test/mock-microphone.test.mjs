import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../preview/mock/world.mjs";
import { MIC_STATES, appMicrophone, askMicrophone, micPermission, pagePermission } from "../preview/mock/microphone.mjs";
import { fakeVoice } from "../preview/mock/voice.mjs";
import { loadMockScenarios } from "../preview/proxy.mjs";

// The microphone's permission in the mocked preview (sidevoice-web#129): read without asking, asked, and what each of
// the card's states does — in a browser (permissions.query, getUserMedia), in the app (host.microphone), and to the voice.

const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const world = (mic) => createWorld({ id: "m", title: "m", summary: "m", options: [], world: { machines: {}, local: null, voice: { mic } } }, {}, instant);

test("asking: a prompt where it was not asked, its answer kept; the stored answer at once otherwise", async () => {
  const expected = {
    granted: ["granted", "granted", "granted"],
    prompt: ["prompt", "granted", "granted"],
    "prompt-block": ["prompt", "denied", "denied"],
    "prompt-dismiss": ["prompt", "dismissed", "prompt"],
    denied: ["denied", "denied", "denied"],
    "denied-then-allowed": ["denied", "granted", "granted"],
    missing: ["prompt", "missing", "prompt"],
  };
  for (const state of MIC_STATES) {
    const w = world(state);
    const before = micPermission(w);
    const answer = await askMicrophone(w);
    assert.deepEqual([before, answer, micPermission(w)], expected[state], state);
  }
  // Closed unanswered once, the next ask is allowed.
  const w = world("prompt-dismiss");
  await askMicrophone(w);
  assert.equal(await askMicrophone(w), "granted");
});

test("the app's host.microphone: the system's permission, allowed or not, and its settings opened", async () => {
  const w = world("denied-then-allowed");
  const host = appMicrophone(w);
  assert.equal(await host.state(), "denied");
  assert.equal(await host.request(), "granted");
  assert.equal(await host.state(), "granted");
  assert.equal(await appMicrophone(world("missing")).request(), "denied");
  await host.openSettings();
  assert.match(w.activity.at(-1).url, /System Settings/);
});

/** A page's window, enough for the browser's side. */
function page() {
  const listeners = {};
  return {
    navigator: {}, EventTarget, Event, TypeError, DOMException,
    addEventListener: (type, listener) => { listeners[type] = listener; },
    leave: () => listeners.pagehide?.(),
  };
}

test("in a browser: permissions.query reads it and hears it change; getUserMedia asks, refusing as a browser does", async () => {
  const w = world("denied");
  const win = page();
  pagePermission(win, w);
  const status = await win.navigator.permissions.query({ name: "microphone" });
  assert.equal(status.state, "denied");
  await assert.rejects(win.navigator.mediaDevices.getUserMedia({ audio: true }), { name: "NotAllowedError" });
  const changed = new Promise((resolve) => { status.onchange = resolve; });
  // Allowed in the browser's settings (the card's option, live): the page hears it.
  w.patch({ "voice.mic": "granted" });
  await changed;
  assert.equal(status.state, "granted");
  const stream = await win.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.deepEqual(stream.getTracks(), []);
  w.patch({ "voice.mic": "missing" });
  await assert.rejects(win.navigator.mediaDevices.getUserMedia({ audio: true }), { name: "NotFoundError" });
  await assert.rejects(win.navigator.permissions.query({ name: "camera" }), TypeError);
  win.leave();
});

test("the voice's start asks the same way: blocked when asked is the microphone denied, none connected unavailable", async () => {
  for (const [mic, code] of [["prompt-block", "microphone-denied"], ["denied", "microphone-denied"], ["missing", "microphone-unavailable"]]) {
    const voice = fakeVoice(world(mic));
    await voice.host.setSettings({ stt: { catalog: "local", model: "whisper-base" }, tts: { catalog: "local", model: "kokoro-82m-v1.0" } });
    await assert.rejects(voice.host.start(), (e) => e.code === code, mic);
  }
});

test("every scenario offers each of the microphone's states, and one opens at the setup's microphone step", async () => {
  const scenarios = await loadMockScenarios();
  for (const s of scenarios) {
    assert.deepEqual(s.options.find((o) => o.id === "mic")?.values.map((v) => v.value).sort(), [...MIC_STATES].sort(), s.id);
  }
  const step = scenarios.find((s) => s.id === "microphone-step");
  assert.equal(step.world.setup, "microphone");
  assert.equal(step.options.find((o) => o.id === "mic").values[0].value, "prompt");
});

test("the card's control fires what a browser or the app would: permission change, devicechange, the app's onChange", async () => {
  const w = world("granted");
  const win = page();
  pagePermission(win, w);
  const media = win.navigator.mediaDevices;
  assert.deepEqual((await media.enumerateDevices()).map((d) => d.kind), ["audioinput"]);
  const status = await win.navigator.permissions.query({ name: "microphone" });
  const once = (target, type) => new Promise((resolve) => target.addEventListener(type, resolve, { once: true }));
  // Blocked and allowed again: a change each time.
  let heard = once(status, "change");
  w.patch({ "voice.mic": "denied" });
  await heard;
  assert.equal(status.state, "denied");
  heard = once(status, "change");
  w.patch({ "voice.mic": "granted" });
  await heard;
  assert.equal(status.state, "granted");
  // Unplugged and plugged in: devicechange, and the list follows.
  heard = once(media, "devicechange");
  w.patch({ "voice.mic": "missing" });
  await heard;
  assert.deepEqual(await media.enumerateDevices(), []);
  heard = once(media, "devicechange");
  w.patch({ "voice.mic": "prompt" });
  await heard;
  assert.equal((await media.enumerateDevices()).length, 1);
  win.leave();
  // The app's bridge.
  const aw = world("granted");
  const app = appMicrophone(aw);
  let calls = 0;
  const stop = app.onChange(() => { calls++; });
  aw.patch({ "voice.mic": "denied" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 1);
  // Allowed to none connected and back to not asked: each is a change of what `state()` says.
  aw.patch({ "voice.mic": "granted" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2);
  aw.patch({ "voice.mic": "missing" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 3);
  assert.equal(await app.state(), "missing");
  aw.patch({ "voice.mic": "prompt" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 4);
  assert.equal(await app.state(), "prompt");
  stop();
  aw.patch({ "voice.mic": "granted" });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 4);
});
