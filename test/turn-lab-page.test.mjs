import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../web/turn-lab.mjs', import.meta.url), 'utf8');

function page() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, hidden: id === 'room', disabled: false, textContent: '', value: 'push',
      children: [], className: '', contentWindow: { postMessage() {} }, replaceChildren(...children) {
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
      { T01: { title: 'Interrupt', instruction: 'Speak' } } : path === '/preview/status' ?
      { link: 'http://localhost:5199/voice/' } : path === '/preview/turn-lab/events' ? state : {};
    return { ok: true, json: async () => value };
  };
  const ctx = vm.createContext({ document: { getElementById: element, createElement: () => element(`created-${Math.random()}`) },
    window: { addEventListener() {} }, fetch, Option: function Option(text, value) { this.text = text; this.value = value; }, URL, Date,
    setInterval() {}, setTimeout, Blob, console });
  vm.runInContext(source, ctx, { filename: 'turn-lab.mjs' });
  const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); await vm.runInContext('poll()', ctx); };
  return { element, state, requests, tick, setConfig: (value) => { config = value; } };
}

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
