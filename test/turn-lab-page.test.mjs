import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SCRIPTS } from '../preview/turn-lab/agent.mjs';

const source = await readFile(new URL('../web/turn-lab.mjs', import.meta.url), 'utf8');
const observerSource = await readFile(new URL('../preview/turn-lab/observe.js', import.meta.url), 'utf8');

function page() {
  const elements = new Map();
  const messages = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, hidden: id === 'room', disabled: false, textContent: '', value: 'push',
      children: [], className: '', contentWindow: { postMessage(message, origin) { messages.push({ message, origin }); } }, replaceChildren(...children) {
        this.children = children; if (this.id === 'script') this.value = children[0]?.value;
      } });
    return elements.get(id);
  };
  let config = { core: 'core-A', connector: 'connector-A', web: 'web-A', voice: 'voice-A', engine: null, notes: {} };
  const state = { job: { state: 'running' }, current: { mode: 'real', scenario: 'turn-lab', identity: config, runId: 'run-A' },
    agent: { ready: true, inputMode: 'push', conversation: 'thread' }, secondAgent: null, events: [],
    evidence: { currentEpoch: 0, fates: [], notes: [], checks: {} } };
  const requests = [];
  const fetch = async (path, options) => {
    const body = options?.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, body });
    if (path === '/preview/turn-lab/connect') state.agent.inputMode = body.mode;
    if (path === '/preview/turn-lab/recover') state.job.state = 'starting';
    const value = path === '/preview/turn-lab/config' ? config : path === '/preview/turn-lab/scripts' ?
      SCRIPTS : path === '/preview/status' ?
      { link: 'http://localhost:5199/voice/' } : path === '/preview/turn-lab/events' ? state : {};
    return { ok: true, json: async () => value };
  };
  const ctx = vm.createContext({ document: { getElementById: element, createElement: () => element(`created-${Math.random()}`) },
    window: { addEventListener() {} }, fetch, Option: function Option(text, value) { this.text = text; this.value = value; }, URL, Date,
    setInterval() {}, setTimeout, Blob, console });
  vm.runInContext(source, ctx, { filename: 'turn-lab.mjs' });
  const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); await vm.runInContext('poll()', ctx); };
  return { element, state, requests, messages, tick, join: () => vm.runInContext('joinedThread = "thread"', ctx),
    setConfig: (value) => { config = value; } };
}

test('Lab output controls target the pinned room without using the removed web menu', async () => {
  const lab = page();
  await lab.tick(); lab.join(); await lab.tick();
  for (const [id, output] of [['output-unavailable', 'agents_muted'], ['output-voice-off', 'voice_off'], ['output-restore', 'on']]) {
    assert.equal(lab.element(id).disabled, false);
    lab.element(id).onclick();
    assert.deepEqual(JSON.parse(JSON.stringify(lab.messages.at(-1))),
      { message: { type: 'turn-lab-output', output }, origin: 'http://localhost:5199' });
  }
});

test('the Lab bridge applies only allowed output policies from its parent', async () => {
  const messages = [], applied = [], handlers = new Map(), parent = { postMessage(message) { messages.push(message); } };
  const win = { WebSocket: class {}, fetch: async () => ({}),
    sidevoiceActions: { pairDevice() {}, setSpeechOutput(output) { applied.push(output); } },
    addEventListener(name, handler) { handlers.set(name, handler); } };
  vm.runInNewContext(observerSource, { window: win, parent, URL, Date, setInterval() {}, setTimeout,
    location: { pathname: '/voice/' }, document: { referrer: 'http://parent/', addEventListener() {} }, navigator: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} } });
  const send = (origin, output) => handlers.get('message')({ source: parent, origin, data: { type: 'turn-lab-output', output } });
  await send('http://parent', 'agents_muted');
  await send('http://parent', 'voice_off');
  await send('http://parent', 'on');
  await send('http://parent', 'invalid');
  await send('http://other', 'voice_off');
  assert.deepEqual(applied, ['agents_muted', 'voice_off', 'on']);
  assert.deepEqual(messages.filter((message) => message.data?.output).map((message) => message.data.output), applied);
});

test('fresh T06 procedures wait for delivered setup words in push and pull, then offer the other conversation', async () => {
  const lab = page();
  await lab.tick(); lab.join(); await lab.tick();
  let at = 100;
  for (const mode of ['push', 'pull']) {
    lab.state.agent.inputMode = mode;
    for (const id of ['T06a', 'T06b', 'T06c', 'T06d']) {
      lab.element('script').value = id;
      lab.element('script').onchange();
      await lab.tick();
      assert.equal(lab.element('run').disabled, true, `${mode} ${id}: no setup delivery`);
      lab.state.evidence.currentEpoch++;
      lab.state.events.push({ at: ++at, kind: 'agent-input', data: { conversation: 'thread', channel: 'voice', text: 'old turn', epoch: lab.state.evidence.currentEpoch - 1 } });
      await lab.tick();
      assert.equal(lab.element('run').disabled, true, `${mode} ${id}: stale epoch`);
      lab.state.events.push({ at: ++at, kind: 'agent-input', data: { conversation: 'other-thread', channel: 'voice', text: 'other turn', epoch: lab.state.evidence.currentEpoch } });
      await lab.tick();
      assert.equal(lab.element('run').disabled, true, `${mode} ${id}: wrong conversation`);
      lab.state.events.push({ at: ++at, kind: 'agent-input', data: { conversation: 'thread', channel: 'voice', text: 'setup words', epoch: lab.state.evidence.currentEpoch } });
      await lab.tick();
      assert.equal(lab.element('run').disabled, false, `${mode} ${id}: delivered setup`);
      if (id === 'T06a') {
        lab.state.events.push({ at: ++at, kind: 'script-start', data: { id, conversation: 'thread' } });
        lab.state.evidence.currentEpoch++;
        await lab.tick();
        assert.equal(lab.element('run').disabled, false, `${mode} ${id}: second click continues after phase one`);
      }
      if (id === 'T06c') {
        lab.state.secondAgent = { ready: true, conversation: 'other-thread' };
        await lab.tick();
        assert.equal(lab.element('switch-conversation').hidden, false);
        assert.match(lab.element('instruction').textContent, /Turn Lab \(other\)/);
      }
    }
  }
});

test('polling preserves the operator-selected pull mode until reconnect', async () => {
  const lab = page();
  await lab.tick();
  assert.equal(lab.element('mode').value, 'push');
  lab.element('mode').value = 'pull';
  for (let i = 0; i < 3; i++) await lab.tick();
  assert.equal(lab.element('mode').value, 'pull');
  await lab.element('connect').onclick();
  assert.equal(lab.requests.findLast((request) => request.path === '/preview/turn-lab/connect')?.body.mode, 'pull');
  assert.match(lab.element('agent-status').textContent, /pull/);
});

test('open page refreshes changed pins through restart and displays the new run', async () => {
  const lab = page();
  await lab.tick();
  const next = { core: 'core-B', connector: 'connector-A', web: 'web-A', voice: 'voice-A', engine: null, notes: {} };
  lab.setConfig(next);
  await lab.element('recover').onclick();
  lab.state.current = { ...lab.state.current, identity: next, runId: 'run-B' };
  lab.state.job.state = 'running';
  await lab.tick();
  assert.equal(lab.element('room').hidden, false);
  assert.ok(lab.element('pins').children.some((entry) => entry.textContent === 'core-B'));
  assert.equal(lab.state.current.runId, 'run-B');
});

test('an open page starts the re-pinned candidate after the server restarts', async () => {
  const lab = page();
  await lab.tick();
  const next = { core: 'core-B', connector: 'connector-A', web: 'web-A', voice: 'voice-A', engine: null, notes: {} };
  lab.setConfig(next);
  lab.state.job.state = 'idle'; lab.state.current = null;
  await lab.tick();
  assert.ok(lab.element('pins').children.some((entry) => entry.textContent === 'core-B'));
  assert.equal(lab.requests.filter((request) => request.path === '/preview/turn-lab/start').length, 1);
  lab.state.job.state = 'running'; lab.state.current = { mode: 'real', scenario: 'turn-lab', identity: next, runId: 'run-B' };
  await lab.tick();
  assert.equal(lab.element('room').hidden, false);
});

test('history observation preserves each row thread and browser-side time', async () => {
  const messages = [], handlers = new Map();
  const parent = { postMessage(message) { messages.push(message); } };
  const body = { messages: [{ id: 'old:voice:a', role: 'assistant', thread_id: 'other', epoch: 1 }] };
  const response = { ok: true, status: 200, clone() { return this; }, async json() { return body; } };
  const win = { WebSocket: class {}, fetch: async () => response,
    addEventListener(name, handler) { handlers.set(name, handler); } };
  const storage = new Map();
  vm.runInNewContext(observerSource, { window: win, parent, URL, Date, setInterval() {}, setTimeout,
    location: { href: 'http://child/voice/', pathname: '/voice/' },
    document: { referrer: 'http://parent/', addEventListener() {} }, navigator: {},
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) } });
  handlers.get('message')({ source: parent, origin: 'http://parent', data: { type: 'turn-lab-thread', thread: 'selected' } });
  await win.fetch('/api/presentation/history');
  const history = messages.find((message) => message.data?.type === 'history');
  assert.equal(history.data.conversation, 'other');
  assert.ok(Number.isInteger(history.data.observed_at));
});
