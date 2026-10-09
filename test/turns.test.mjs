import { test } from "node:test";
import assert from "node:assert/strict";
import { createResampler, createTurnChain, END_OF_TURN_LIKELY, PATIENCE, turnModelChoices, VAD_DEFAULTS } from "../web/turns/chain.mjs";
import { clockText, logLine } from "../web/turns-text.mjs";

const kinds = (entries) => entries.map((entry) => entry.kind);

test("the chain's numbers are sidevoice-voice's", () => {
  assert.deepEqual(PATIENCE, {
    fast: { silence: 2000, pause: 600, longest: 2500 },
    normal: { silence: 2500, pause: 900, longest: 3000 },
    calm: { silence: 3500, pause: 1300, longest: 4000 },
  });
  assert.equal(END_OF_TURN_LIKELY, 0.5);
  assert.deepEqual(VAD_DEFAULTS, { threshold: 0.6, minSilenceMs: 200, minSpeechMs: 400 });
});

test("silence: the patience's timer cuts the turn, and speech before it keeps the same turn going", () => {
  const chain = createTurnChain({ mode: "silence", patience: "normal" });
  assert.deepEqual(kinds(chain.speechStart(1000)), ["turn"]);
  const [pause] = chain.speechEnd(3000);
  assert.equal(pause.cutAt, 5500);
  assert.deepEqual(chain.tick(5000), []);
  assert.deepEqual(chain.next(5000), { what: "cut", in: 500 });
  assert.deepEqual(kinds(chain.speechStart(5200)), ["resumed"]);
  assert.equal(chain.turn.number, 1);
  chain.speechEnd(6000);
  assert.deepEqual(chain.tick(8499), []);
  const [cut] = chain.tick(8500);
  assert.deepEqual([cut.kind, cut.reason, cut.turn, cut.length, cut.silent], ["cut", "silence", 1, 7500, 2500]);
  assert.equal(chain.turn, null);
  assert.deepEqual(kinds(chain.speechStart(9000)), ["turn"]);
  assert.equal(chain.turn.number, 2);
});

test("smart-turn: the model is asked once per pause; P(end) at the threshold cuts now, below it keeps listening", () => {
  const chain = createTurnChain({ mode: "smart-turn", patience: "fast", threshold: 0.5 });
  chain.speechStart(0);
  const [pause] = chain.speechEnd(2000);
  assert.deepEqual([pause.askAt, pause.cutAt], [2600, 4500]);
  assert.deepEqual(chain.tick(2599), []);
  const [ask] = chain.tick(2600);
  assert.deepEqual([ask.kind, ask.from, ask.turn], ["ask", 0, 1]);
  assert.deepEqual(chain.tick(2700), [], "asked once");
  const [keep] = chain.answer(2800, 0.3, 1);
  assert.deepEqual([keep.kind, keep.probability], ["keep", 0.3]);
  assert.deepEqual(chain.answer(2900, 0.9, 1), [], "one answer per pause");
  assert.deepEqual(chain.next(2900), { what: "cut", in: 1600 });
  chain.speechStart(3000);
  chain.speechEnd(4000);
  chain.tick(4600);
  const [cut] = chain.answer(4700, 0.5, 1);
  assert.deepEqual([cut.reason, cut.probability, cut.length], ["end-of-turn", 0.5, 4700]);
});

test("smart-turn: a pause as long as the patience's longest cuts whatever the model said, and a stale answer changes nothing", () => {
  const chain = createTurnChain({ mode: "smart-turn", patience: "normal", threshold: 0.8 });
  chain.speechStart(0);
  chain.speechEnd(1000);
  chain.tick(1900);
  const [cut] = chain.tick(4000);
  assert.deepEqual([cut.reason, cut.silent], ["longest", 3000]);
  assert.deepEqual(chain.answer(4100, 0.99, 1), [], "the turn it was about is over");
  chain.speechStart(5000);
  chain.speechEnd(6000);
  chain.tick(6900);
  assert.deepEqual(chain.answer(7000, 0.99, 1), [], "an answer about another turn");
  assert.equal(chain.answer(7000, 0.79, 2)[0].kind, "keep", "below this threshold");
});

test("settings change live: patience, mode and threshold apply to the next decision", () => {
  const chain = createTurnChain({ mode: "silence", patience: "calm" });
  chain.speechStart(0);
  chain.speechEnd(1000);
  chain.configure({ patience: "fast" });
  assert.equal(chain.tick(3000)[0].reason, "silence");
  chain.configure({ mode: "smart-turn", threshold: 0.2 });
  chain.speechStart(4000);
  chain.speechEnd(5000);
  chain.tick(5600);
  assert.equal(chain.answer(5700, 0.25, 2)[0].reason, "end-of-turn");
});

test("the pickers offer the catalogue's models of each capability, those with no build here disabled", () => {
  const build = (id, available = true) => ({ id, available, reasons: [] });
  const catalog = [
    { id: "silero-vad", capabilities: ["vad"], parametersM: 2, installed: true, builds: [build("silero-vad/onnx")], recommendedBuild: "silero-vad/onnx" },
    { id: "smart-turn-v3", capabilities: ["end-of-turn"], parametersM: 8, installed: false, builds: [build("smart-turn-v3/gpu", false)] },
    { id: "whisper-base", capabilities: ["stt"], parametersM: 74, installed: false, builds: [build("whisper-base/int8")] },
  ];
  assert.deepEqual(turnModelChoices(catalog, "vad").map((c) => [c.id, c.build, c.disabled]), [["silero-vad", "silero-vad/onnx", false]]);
  assert.deepEqual(turnModelChoices(catalog, "end-of-turn").map((c) => [c.id, c.build, c.disabled]), [["smart-turn-v3", null, true]]);
  assert.deepEqual(turnModelChoices(catalog.filter((m) => m.id === "whisper-base"), "end-of-turn"), [], "an engine without the capability");
  assert.deepEqual(turnModelChoices(null, "vad"), []);
});

test("the resampler keeps its phase across chunks and leaves a matching rate alone", () => {
  const same = createResampler(16000, 16000);
  const chunk = Float32Array.from([1, 2, 3]);
  assert.equal(same(chunk), chunk);
  const down = createResampler(48000, 16000);
  const ramp = Float32Array.from({ length: 4800 }, (_, i) => i);
  const out = [...down(ramp.subarray(0, 1000)), ...down(ramp.subarray(1000, 2500)), ...down(ramp.subarray(2500))];
  assert.equal(out.length, 1600);
  out.forEach((value, i) => assert.ok(Math.abs(value - i * 3) < 1e-6, `sample ${i}`));
  const up = createResampler(8000, 16000);
  assert.deepEqual([...up(Float32Array.from([0, 2, 4]))], [0, 1, 2, 3, 4, 4]);
});

test("the log says what the chain did, on the audio's clock", () => {
  assert.equal(clockText(83456), "1:23.46");
  assert.equal(logLine({ kind: "turn", at: 1000, turn: 1 }), "0:01.00 speech starts: turn 1");
  assert.match(logLine({ kind: "pause", at: 2000, turn: 1, cutAt: 4500 }), /silence cuts the turn at 0:04.50/);
  assert.match(logLine({ kind: "pause", at: 2000, turn: 1, askAt: 2900, cutAt: 5000 }), /asks the end-of-turn model at 0:02.90, cuts at 0:05.00/);
  assert.match(logLine({ kind: "keep", at: 3000, probability: 0.31 }), /P\(end\) 0.31 below the threshold: keep listening/);
  assert.match(logLine({ kind: "cut", at: 3000, reason: "end-of-turn", probability: 0.83, turn: 1, length: 2000 }), /P\(end\) 0.83: cut now/);
  assert.match(logLine({ kind: "cut", at: 5000, reason: "silence", silent: 2500, turn: 1, length: 4000 }), /2.5 s of silence/);
  assert.match(logLine({ kind: "cut", at: 5000, reason: "longest", silent: 3000, turn: 1 }), /whatever the model said/);
});
