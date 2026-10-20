import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, summarise, PRESETS, DEFAULTS } from '../web/turn-lab-barge.mjs';

const run = (steps, { seconds = 1.0, preset = 'A' } = {}) => {
  const out = [], tracker = createTracker({ emit: (record) => out.push(record) });
  tracker.play(preset, seconds, 0);
  for (const [kind, t, value] of steps) {
    if (kind === 'state') tracker.state(value, t);
    else if (kind === 'mic') tracker.mic(value, t);
    else if (kind === 'hearing') tracker.hearing(value);
    tracker.tick(t);
  }
  return out;
};
const speak = (from, to, level = 40) => { const rows = []; for (let t = from; t <= to; t += 80) rows.push(['mic', t, level]); return rows; };
const playing = (t) => ['state', t, { listening: 'listening', playback: 'playing' }];

test('a real interruption reports detection, stop and the latency from the first sound', () => {
  const [record] = run([playing(500), ...speak(2000, 3000), ['state', 3050, { listening: 'speaking', playback: 'playing' }],
    ['state', 3090, { listening: 'speaking', playback: 'idle' }], ['hearing', 3100, 'partial'], ['mic', 4000, 0], ['mic', 4000, 0], ['state', 4000, { listening: 'speaking', playback: 'idle' }]]);
  assert.equal(record.outcome, 'interrupted');
  assert.equal(record.onsetMs, 1500);
  assert.equal(record.detectedMs, 1050);
  assert.equal(record.feltMs, 1090);
  assert.equal(record.voiceMs, 40);
});

test('the agent stopping with no speech is a false trigger', () => {
  const [record] = run([playing(500), ['state', 5000, { listening: 'speaking', playback: 'playing' }],
    ['state', 5040, { listening: 'speaking', playback: 'idle' }], ['hearing', 5100, 'partial'], ['mic', 6000, 0]]);
  assert.equal(record.outcome, 'false');
  assert.equal(record.onsetMs, null);
});

test('stopping with no speech heard at all, only a partial hearing, is a false trigger', () => {
  const [record] = run([playing(500), ['state', 5000, { listening: 'listening', playback: 'idle' }], ['hearing', 5100, 'partial'], ['mic', 6000, 0]]);
  assert.equal(record.outcome, 'false');
});

test('long speech that never cuts is missed, scaled to the preset', () => {
  const rows = [playing(500), ...speak(1000, 3300)];
  assert.equal(run(rows, { seconds: 1.0 })[0].outcome, 'missed');
  assert.equal(run(rows, { seconds: 1.6, preset: 'C' }).length, 0);
});

test('a short backchannel the agent ignores is not a miss', () => {
  const [record] = run([playing(500), ...speak(1000, 1400), ['state', 200000, { listening: 'listening', playback: 'idle' }], ['hearing', 200000, 'heard'], ['mic', 201000, 0]]);
  assert.equal(record.outcome, 'ignored');
});

test('a reply that plays through untouched is recorded as such, and silence before audio is no audio', () => {
  assert.equal(run([playing(500), ['state', 9000, { listening: 'listening', playback: 'idle' }], ['hearing', 9000, 'heard'], ['mic', 10000, 0]])[0].outcome, 'through');
  assert.equal(run([['mic', 20000, 0]])[0].outcome, 'none');
});

test('summaries compare presets and the presets are A defaults, B eager, C tolerant', () => {
  assert.ok(PRESETS.B.turn.barge_in_min_speech < PRESETS.A.turn.barge_in_min_speech && PRESETS.A.turn.barge_in_min_speech < PRESETS.C.turn.barge_in_min_speech && PRESETS.A.turn.listening_bar.playing === DEFAULTS.listening_bar.playing);
  const rows = summarise([{ preset: 'A', outcome: 'interrupted', feltMs: 1000 }, { preset: 'A', outcome: 'interrupted', feltMs: 1400 }, { preset: 'B', outcome: 'false' }]);
  assert.deepEqual(rows.A, { n: 2, interrupted: 2, false: 0, missed: 0, medianFeltMs: 1200 });
  assert.equal(rows.B.false, 1);
});

test('the page mounts, sends the preset to the room once it joins, and counts a Play', async () => {
  const elements = new Map(), posted = [], handlers = [], requests = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: '', textContent: '', disabled: false, children: [], classList: { toggle() {} },
      replaceChildren(...children) { this.children = children; }, append() {}, contentWindow: { postMessage: (message, origin) => posted.push({ message, origin }) }, src: 'https://room.example/voice/' });
    return elements.get(id);
  };
  const win = { localStorage: { getItem: () => null, setItem() {} }, performance: { timeOrigin: 0, now: () => 1000 }, addEventListener: (_, handler) => handlers.push(handler),
    setInterval() {}, setTimeout, clearTimeout, fetch: async (path) => { requests.push(path); return { ok: true, json: async () => ({}), text: async () => '' }; }, URL, Blob };
  const doc = { getElementById: element, createElement: () => ({ classList: { toggle() {} }, append() {} }) };
  globalThis.document = doc; globalThis.window = win;
  try {
    element('barge-play');
    await import(`../web/turn-lab-barge.mjs?mount=${Math.random()}`);
    const message = (kind, data) => handlers[0]({ source: element('room').contentWindow, origin: 'https://room.example', data: { source: 'turn-lab-browser', kind, data } });
    const wait = () => new Promise((resolve) => setTimeout(resolve, 250));
    message('browser-ready', { voice: 'joined' });
    assert.deepEqual(posted.at(-1), { message: { type: 'turn-lab-barge', turn: DEFAULTS }, origin: 'https://room.example' });
    element('barge-B').onclick(); await wait();
    assert.deepEqual(posted.at(-1).message, { type: 'turn-lab-barge', turn: PRESETS.B.turn });
    element('barge-reset').onclick(); await wait();
    assert.deepEqual(posted.at(-1).message.turn, DEFAULTS);
    await element('barge-play').onclick();
    assert.deepEqual(requests, ['/preview/turn-lab/play']);
  } finally { delete globalThis.document; delete globalThis.window; }
});

test('an attempt records how loud the microphone got while the agent spoke', () => {
  const [record] = run([playing(500), ...speak(1000, 1400, 9), ...speak(1500, 1800, 12), ['state', 200000, { listening: 'listening', playback: 'idle' }], ['hearing', 200000, 'heard'], ['mic', 201000, 0]]);
  assert.equal(record.peakLevel, 12);
  assert.equal(record.outcome, 'through');
});
