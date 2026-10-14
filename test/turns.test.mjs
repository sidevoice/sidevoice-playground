import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE, createResampler, createTurnChain, END_OF_TURN_AUDIO_MS, END_OF_TURN_LIKELY, LISTENING_BAR, loudness, PATIENCE,
  PRE_SPEECH_MS, roundHalfEven, SILENCE_STOP_MS, START_MS, turnModelChoices, VAD_DEFAULTS,
} from "../web/turns/chain.mjs";
import { clockText, logLine } from "../web/turns-text.mjs";

const kinds = (entries) => entries.map((entry) => entry.kind);

/** One 32 ms window of a 1 kHz tone at `amplitude` (whole periods: windows join seamlessly). */
const tone = (amplitude) => Float32Array.from({ length: 512 }, (_, i) => amplitude * Math.sin((2 * Math.PI * 1000 * i) / 16000));
const LOUD = 0.1; // −23 LUFS, a volume of 0.87
const SOFT = 0.01; // −43 LUFS (0.67), its RMS at −43 dBFS
const MURMUR = 0.0005; // −69 LUFS (0.41), under the bar
const speech = (amplitude) => [tone(amplitude), 0.9];
const silence = () => [new Float32Array(512), 0.02];
const times = (window, count) => Array.from({ length: count }, () => window);

/** Feeds windows 32 ms apart from `clock.at`: the entries, each with the index of the window that made it. */
function hear(chain, clock, windows, playing = false) {
  return windows.flatMap(([samples, probability], index) => {
    clock.at += 32;
    return chain.window(clock.at, samples, probability, probability >= 0.5, playing).map((entry) => ({ ...entry, index }));
  });
}

/** A chain that has heard a second of sound at a normal level (its volume settled) and has a turn open. */
function speaking(settings) {
  const chain = createTurnChain(settings);
  const clock = { at: 0 };
  const entries = hear(chain, clock, [...times([tone(LOUD), 0.02], 32), ...times(speech(LOUD), 12)]);
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.index]), [["turn", 43]]);
  return { chain, clock };
}

test("the chain's numbers are sidevoice-voice's", () => {
  assert.deepEqual(PATIENCE, {
    fast: { stop: 600, longest: 2500, silence: 2000 },
    normal: { stop: 900, longest: 3000, silence: 2500 },
    calm: { stop: 1300, longest: 4000, silence: 3500 },
  });
  assert.deepEqual([SILENCE_STOP_MS, START_MS, CONFIDENCE, PRE_SPEECH_MS, END_OF_TURN_AUDIO_MS], [200, 400, 0.6, 900, 8000]);
  assert.deepEqual(LISTENING_BAR, { quiet: 0.5, playing: 0.8 });
  assert.equal(END_OF_TURN_LIKELY, 0.5);
  assert.deepEqual(VAD_DEFAULTS, { threshold: 0.6, minSilenceMs: 200, minSpeechMs: 400 });
});

test("the volume is BS.1770 loudness as Pipecat measures it, and durations round to windows as Pipecat rounds", () => {
  // The figures pipecat-ai 1.10.0's `loudness` (0.2.0) gives the same 400 ms of tone.
  for (const [amplitude, lufs] of [[0.1, -22.95], [0.0141, -39.95], [0.01, -42.95], [0.003, -53.45]]) {
    const block = Float32Array.from({ length: 6400 }, (_, i) => Math.fround(amplitude * Math.sin((2 * Math.PI * 1000 * (i % 512)) / 16000)));
    assert.ok(Math.abs(loudness(block) - lufs) < 1e-9, `${amplitude}: ${loudness(block)}`);
  }
  assert.equal(loudness(new Float32Array(6400)), -Infinity);
  assert.deepEqual([12.5, 28.125, 18.75, 40.625, 6.25, 13.5].map(roundHalfEven), [12, 28, 19, 41, 6, 14]);
});

test("speech starts after 400 ms of it, and a click or a murmur opens nothing", () => {
  const chain = createTurnChain({ mode: "smart-turn" });
  const clock = { at: 0 };
  const windows = [
    ...times([tone(LOUD), 0.02], 32), ...times(speech(LOUD), 11), [tone(LOUD), 0.3], ...times(speech(LOUD), 11),
    ...times(silence(), 40), ...times(speech(MURMUR), 40),
  ];
  assert.deepEqual(hear(chain, clock, windows), []);
  assert.deepEqual(kinds(hear(chain, clock, times(speech(LOUD), 40))), ["turn"]);
});

test("soft speech under −30 dBFS mid-sentence is still speech", () => {
  const { chain, clock } = speaking({ mode: "smart-turn" });
  assert.deepEqual(hear(chain, clock, [...times(speech(LOUD), 30), ...times(speech(SOFT), 120), ...times(speech(LOUD), 30)]), []);
  const entries = hear(chain, clock, times(silence(), 28));
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.index]), [["pause", 27], ["ask", 27]]);
});

test("smart-turn: the model is asked at each stop; P(end) not above the threshold keeps the turn, a pause it leaves open cuts 3 s after the stop", () => {
  const { chain, clock } = speaking({ mode: "smart-turn", patience: "normal" });
  const started = chain.turn.start;
  hear(chain, clock, times(speech(LOUD), 60));
  const [pause, ask] = hear(chain, clock, times(silence(), 38));
  assert.deepEqual([pause.kind, pause.index, pause.cutAt - pause.at], ["pause", 27, 3000]);
  assert.deepEqual([ask.kind, ask.turn, ask.pause, ask.from], ["ask", 1, 1, started - 900]);
  assert.equal(chain.answer(clock.at, 0.3, ask)[0].kind, "keep");
  // The person goes on: the pause is over, and an answer about it changes nothing.
  assert.deepEqual(kinds(hear(chain, clock, times(speech(LOUD), 40))), ["resumed"]);
  assert.deepEqual(chain.answer(clock.at, 0.99, ask), []);
  const [, again] = hear(chain, clock, times(silence(), 28));
  assert.deepEqual([again.kind, again.pause], ["ask", 2]);
  assert.equal(chain.answer(clock.at, 0.5, again)[0].kind, "keep", "an even chance is not the end");
  // A click in the pause neither ends it nor starts it over.
  const entries = hear(chain, clock, [...times(silence(), 20), ...times(speech(LOUD), 5), ...times(silence(), 100)]);
  const [cut] = entries;
  assert.deepEqual([cut.kind, cut.reason, cut.index, cut.silent], ["cut", "longest", 93, 122 * 32]);
  assert.equal(chain.turn, null);
});

test("smart-turn: P(end) above the threshold cuts the turn at the stop", () => {
  const { chain, clock } = speaking({ mode: "smart-turn", threshold: 0.5 });
  hear(chain, clock, times(speech(LOUD), 60));
  const [, ask] = hear(chain, clock, times(silence(), 28));
  const [cut] = chain.answer(clock.at, 0.9, ask);
  assert.deepEqual([cut.kind, cut.reason, cut.probability, cut.silent], ["cut", "end-of-turn", 0.9, 896]);
});

test("silence: speech stops after 200 ms, and the patience's silence after that cuts the turn", () => {
  const { chain, clock } = speaking({ mode: "silence", patience: "normal" });
  hear(chain, clock, times(speech(LOUD), 60));
  // A breath of 300 ms: speech stops and starts again; the same turn goes on.
  assert.deepEqual(kinds(hear(chain, clock, [...times(silence(), 9), ...times(speech(LOUD), 30)])), ["pause", "resumed"]);
  assert.equal(chain.turn.number, 1);
  const entries = hear(chain, clock, times(silence(), 100));
  assert.deepEqual(entries.map((entry) => [entry.kind, entry.index]), [["pause", 5], ["cut", 84]]);
  assert.deepEqual([entries[1].reason, entries[1].silent], ["silence", 85 * 32]);
});

test("the bar rises while a reply plays", () => {
  const soft = createTurnChain({});
  const clock = { at: 0 };
  assert.deepEqual(hear(soft, clock, [...times([tone(SOFT), 0.02], 32), ...times(speech(SOFT), 40)], true), []);
  assert.deepEqual(kinds(hear(soft, clock, times(speech(SOFT), 12))), ["turn"]);
  const loud = createTurnChain({});
  assert.deepEqual(kinds(hear(loud, { at: 0 }, [...times([tone(LOUD), 0.02], 32), ...times(speech(LOUD), 12)], true)), ["turn"]);
});

test("a backend with no probability is taken at its speech flag; settings change live", () => {
  const chain = createTurnChain({ mode: "silence", patience: "calm" });
  let at = 0;
  const flag = (samples, speech) => chain.window((at += 32), samples, null, speech);
  for (let i = 0; i < 32; i++) flag(tone(LOUD), false);
  const opened = [];
  for (let i = 0; i < 12; i++) opened.push(...flag(tone(LOUD), true));
  assert.deepEqual(kinds(opened), ["turn"]);
  chain.configure({ patience: "fast" });
  const entries = [];
  for (let i = 0; i < 80; i++) entries.push(...flag(new Float32Array(512), false));
  assert.deepEqual(entries.map((entry) => entry.kind), ["pause", "cut"]);
  assert.equal(entries[1].silent, (6 + 63) * 32, "fast: 2 s after the stop");
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
  assert.match(logLine({ kind: "pause", at: 2000, turn: 1, askAt: 2000, cutAt: 5000 }), /speech stops: asks the end-of-turn model now, cuts at 0:05.00/);
  assert.match(logLine({ kind: "keep", at: 3000, probability: 0.31 }), /P\(end\) 0.31 not above the threshold: keep listening/);
  assert.match(logLine({ kind: "cut", at: 3000, reason: "end-of-turn", probability: 0.83, turn: 1, length: 2000 }), /P\(end\) 0.83: cut now/);
  assert.match(logLine({ kind: "cut", at: 5000, reason: "silence", silent: 2500, turn: 1, length: 4000 }), /2.5 s of silence/);
  assert.match(logLine({ kind: "cut", at: 5000, reason: "longest", silent: 3000, turn: 1 }), /whatever the model said/);
});
