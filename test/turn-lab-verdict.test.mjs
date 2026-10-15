import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidence } from '../preview/turn-lab/evidence.mjs';

const start = (id, extra = {}) => ({ kind: 'script-start', data: { id, epoch: 0, ...extra } });
const say = (id, audio = 'queued', text = id) => ({ kind: 'tool-result', data: { name: 'voice_say', args: { utterance_id: id, text }, result: { status: 'published', audio } } });
const refused = (id = 'a') => ({ kind: 'tool-result', data: { name: 'voice_say', args: { utterance_id: id, text: id }, result: { status: 'rejected', reason: 'user_speaking' } } });
const frame = (type, id, data = {}) => ({ kind: 'browser-action', data: { type, ...(id ? { utterance_id: id } : {}), ...data } });
const sound = (id, status, data = {}) => frame('voice-playback', id, { status, ...data });
const hearing = (id, outcome, heard_chars) => frame('reply-hearing', id, { outcome, ...(heard_chars == null ? {} : { heard_chars }) });
const miss = (id, fate, heard_chars, text = id) => ({ utterance_id: id, text, fate, heard_chars: fate === 'not_heard' ? 0 : heard_chars });
const input = (channel, text, replies = [], kind) => ({ kind: 'agent-input', data: { channel, text, ...(replies.length ? { unheard: { count: replies.length, replies } } : {}), ...(kind ? { notice: { kind } } : {}) } });
const mute = (reason, on = false) => frame('voice-speech', null, { on, ...(on ? {} : { reason }) });
const history = (id, hearingOutcome, audio_reason) => ({ kind: 'room-frame', data: { type: 'history', row: { role: 'assistant', id: `s:voice:${id}`, text: id, hearing: hearingOutcome, hearing_unconfirmed: hearingOutcome == null, heard_chars: hearingOutcome === 'not_heard' ? 0 : hearingOutcome === 'heard' ? 1 : null, audio_reason } } });
const phase = () => ({ kind: 'script-phase', data: { id: 'T06a', phase: 2 } });
// Add the real wire identities, reliable acknowledgement and qualified turn to
// small case traces. Individual regressions below mutate these complete traces.
const trace = (id, events) => {
  const out = [start(id)];
  const activeTurn = ['T01', 'T02a', 'T02b', 'T02c', 'T02d', 'T04b', 'T05'].includes(id);
  let opened = false, receipts = 0, messages = 0;
  const open = () => { if (!opened) { out.push({ kind: 'room-frame', data: { type: 'voice-user-turn', phase: 'started', epoch: 1,
    session_id: 's', thread_id: 'thread' } }); opened = true; } };
  const textById = new Map(events.filter((event) => event.data?.name === 'voice_say').map((event) =>
    [event.data.args.utterance_id, event.data.args.text]));
  for (const original of events) {
    const event = structuredClone(original), data = event.data ?? {};
    if (id === 'T02c' || id === 'T02d') { if (event.kind === 'tool-result') open(); }
    if (['T01', 'T04b', 'T05'].includes(id) && data.type === 'voice-playback' && data.status === 'interrupted') open();
    if (['T02a', 'T02b'].includes(id) && event.kind === 'agent-input') open();
    if (event.kind === 'tool-result' && data.name === 'voice_say') {
      Object.assign(data.args, { event_id: data.args.event_id ?? `event-${data.args.utterance_id}`, session_id: 's',
        revision: 1, epoch: data.args.epoch ?? 0 });
      Object.assign(data.result, { event_id: data.args.event_id, utterance_id: data.args.utterance_id });
      if (data.result.status === 'rejected') Object.assign(data.result, { terminal: true,
        instruction: 'Wait for the person to finish speaking.' });
    }
    if (data.type === 'reply-hearing') Object.assign(data, { client_msg_id: data.client_msg_id ?? `receipt-${++receipts}`,
      history_id: data.history_id ?? `s:voice:${data.utterance_id}`, session_id: 's' });
    if (data.type === 'history' && data.row?.role === 'assistant') {
      data.row.utterance_id = data.row.id?.split(':voice:').at(-1);
      data.row.text = textById.get(data.row.utterance_id) ?? data.row.text;
      data.row.heard_chars = data.row.hearing === 'heard' ? [...data.row.text].length : data.row.heard_chars;
    }
    if (event.kind === 'agent-input') {
      Object.assign(data, { message_id: data.message_id ?? `message-${++messages}`, session_id: 's',
        revision: 2, epoch: activeTurn ? 1 : 0 });
      if (id === 'T06d' && data.notice?.kind === 'user_returned') data.received_at = 7000;
      for (const row of data.unheard?.replies ?? []) Object.assign(row, { history_id: row.history_id ?? `s:voice:${row.utterance_id}`,
        session_id: 's', revision: 1, epoch: 0 });
    }
    if (id === 'T06d' && data.type === 'voice-speech' && data.on === true) data.observed_at = 1000;
    out.push(event);
    if (data.name === 'voice_say' && data.result.status !== 'rejected') out.push({ kind: 'room-frame', data: {
      type: 'voice-reply', utterance_id: data.args.utterance_id, history_id: `s:voice:${data.args.utterance_id}`,
      text: data.args.text, session_id: 's', epoch: data.args.epoch } });
    if (data.type === 'reply-hearing') out.push({ kind: 'room-frame', data: { type: 'voice-ack', client_msg_id: data.client_msg_id } });
  }
  return out;
};
const judge = (id, events) => evidence(trace(id, events)).checks[id];
const pair = (id) => [sound(id, 'playing'), sound(id, 'heard'), hearing(id, 'heard')];
const baseline = {
  T01: [say('a', 'queued', 'é🐙ab'), sound('a', 'playing'), sound('a', 'interrupted', { heard_chars: 2 }), hearing('a', 'partial', 2), input('voice', 'Stop', [miss('a', 'partial', 2, 'é🐙ab')], 'reply_not_heard')],
  T02a: [say('a'), sound('a', 'unplayed'), hearing('a', 'not_heard'), input('voice', 'Next', [miss('a', 'not_heard')], 'reply_not_heard')],
  T02b: [say('a'), sound('a', 'unplayed'), hearing('a', 'not_heard'), input('note', '', [miss('a', 'not_heard')], 'turn_empty')],
  T02c: [refused(), input('voice', 'Words')],
  T02d: [refused(), input('note', '', [], 'turn_empty')],
  T03: [say('a', 'text_only'), history('a', 'not_heard', 'newer_turn'), input('note', '', [miss('a', 'not_heard')], 'reply_not_heard')],
  T04a: [say('a'), say('b'), say('c'), ...pair('a'), ...pair('b'), ...pair('c')],
  T04b: [say('a', 'queued', 'A reply'), say('b'), say('c'), sound('a', 'playing'), sound('a', 'interrupted', { heard_chars: 1 }), hearing('a', 'partial', 1), sound('b', 'unplayed'), hearing('b', 'not_heard'), sound('c', 'unplayed'), hearing('c', 'not_heard'), input('voice', 'Stop', [miss('a', 'partial', 1, 'A reply'), miss('b', 'not_heard'), miss('c', 'not_heard')], 'reply_not_heard')],
  T05: [say('a'), say('b', 'queued', 'B reply'), say('c'), ...pair('a'), sound('b', 'playing'), sound('b', 'interrupted', { heard_chars: 1 }), hearing('b', 'partial', 1), sound('c', 'unplayed'), hearing('c', 'not_heard'), input('voice', 'Stop', [miss('b', 'partial', 1, 'B reply'), miss('c', 'not_heard')], 'reply_not_heard')],
  T06a: [say('a'), sound('a', 'playing'), mute('agents_muted'), sound('a', 'interrupted', { heard_chars: 0 }), hearing('a', 'not_heard'), phase(), say('b', 'text_only'), hearing('b', 'not_heard')],
  T06b: [mute('voice_off'), say('a', 'text_only'), hearing('a', 'not_heard')],
  T06d: [mute('agents_muted'), say('a', 'text_only'), hearing('a', 'not_heard'), mute(null, true), input('note', '', [miss('a', 'not_heard')], 'user_returned')],
  T08: [say('a'), say('b'), sound('a', 'playing'), frame('typed-message', null, { status: 200, epoch: 0 }), sound('a', 'heard'), hearing('a', 'heard'), ...pair('b')],
  T12: [say('a'), say('b'), sound('a', 'playing'), frame('ui-click', null, { control: 'skip-reply' }), sound('a', 'interrupted'), hearing('a', 'heard'), ...pair('b')],
};
const invalid = {
  T01: (events) => events.map((event) => event.data?.type === 'reply-hearing' ? hearing('a', 'heard') : event),
  T02a: (events) => [...events, sound('a', 'playing')],
  T02b: (events) => events.map((event) => event.data?.type === 'reply-hearing' ? hearing('a', 'partial', 0) : event),
  T02c: (events) => [...events, history('a', null)],
  T02d: (events) => events.map((event) => event.data?.name === 'voice_say' ? say('a') : event),
  T03: (events) => [...events, sound('a', 'playing')],
  T04a: (events) => [...events, sound('a', 'playing')],
  T04b: (events) => [...events.slice(0, -1), hearing('b', 'heard'), events.at(-1)],
  T05: (events) => [...events.slice(0, -1), hearing('c', 'heard'), events.at(-1)],
  T06a: (events) => [...events, sound('b', 'playing')],
  T06b: (events) => [...events, sound('a', 'playing')],
  T06d: (events) => [...events, sound('a', 'playing')],
  T08: (events) => [...events, sound('a', 'playing')],
  T12: (events) => [...events, input('note', '', [], 'reply_skipped')],
};
for (const [id, events] of Object.entries(baseline)) {
  test(`${id}: confirmed outcome passes, prohibited outcome fails, missing evidence stays insufficient`, () => {
    assert.equal(judge(id, events).state, 'pass', `${id}: ${judge(id, events).reason}`);
    assert.equal(judge(id, invalid[id](events)).state, 'fail', `${id}: invalid trace`);
    const without = events.filter((event) => event.data?.type !== 'reply-hearing' && event.data?.type !== 'history');
    if (!['T02c', 'T02d'].includes(id)) assert.notEqual(judge(id, without).state, 'pass', `${id}: no semantic confirmation`);
  });
}
test('the invalid trace table covers every automatic check', () => {
  const automatic = Object.entries(evidence([]).checks).filter(([, value]) => value.state === 'pending').map(([id]) => id).sort();
  assert.deepEqual(Object.keys(invalid).sort(), automatic);
});
test('T01 allows a fresh response after the original partial cut, but never replays it', () => {
  assert.equal(judge('T01', [...baseline.T01, say('b'), sound('b', 'playing')]).state, 'pass');
  assert.equal(judge('T01', [...baseline.T01, say('b'), sound('a', 'playing')]).state, 'fail');
});
test('agent evidence refuses old causes, cut flags, skipped fates and skip notices', () => {
  for (const row of [{ ...miss('a', 'partial', 2, 'é🐙ab'), reason: 'user_interrupted' }, { ...miss('a', 'partial', 2, 'é🐙ab'), cut: true }, { ...miss('a', 'partial', 2, 'é🐙ab'), fate: 'skipped' }]) {
    const trace = baseline.T01.map((event) => event.kind === 'agent-input' ? input('voice', 'Stop', [row], 'reply_not_heard') : event);
    assert.equal(judge('T01', trace).state, 'fail');
  }
});
test('the pinned core shared fixture keeps physical playback separate from semantic hearing', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/core-hearing.json', import.meta.url), 'utf8'));
  assert.equal(fixture.text, 'é🐙ab');
  assert.deepEqual(fixture.hearing.map((item) => item.frame.data.outcome), ['heard', 'partial', 'not_heard', 'heard']);
  assert.equal(fixture.hearing[3].publication_status, 'text_only', 'written delivery may still be heard');
  assert.equal(fixture.unconfirmed.agent_evidence, null);
  for (const item of fixture.hearing) {
    const id = item.frame.data.utterance_id;
    const events = [say(id, item.publication_status ?? 'queued', fixture.text),
      { kind: 'browser-action', data: { ...item.frame.data, type: item.frame.type } },
      { kind: 'room-frame', data: { type: 'voice-ack', client_msg_id: item.frame.data.client_msg_id } },
      { kind: 'room-frame', data: { type: 'history', utterance_id: id, row: { ...item.history, id: item.frame.data.history_id,
        role: 'assistant', text: fixture.text } } }];
    const row = evidence([start('T14'), ...events]).fates[0];
    assert.equal(row.fate, item.history.hearing);
    assert.equal(row.heard_chars, item.history.heard_chars);
    assert.equal(row.hearing_unconfirmed, false);
  }
});
test('a played cut with zero confirmed characters is not_heard, while its physical cut remains visible', () => {
  const zero = [say('a', 'queued', 'é🐙ab'), sound('a', 'playing'), sound('a', 'interrupted', { heard_chars: 0 }),
    hearing('a', 'not_heard'), input('voice', 'Stop', [miss('a', 'not_heard', 0, 'é🐙ab')], 'reply_not_heard')];
  assert.equal(judge('T01', zero).state, 'pass');
  const invalidZeroPartial = zero.map((event) => event.data?.type === 'reply-hearing' ? hearing('a', 'partial', 0) : event);
  assert.equal(judge('T01', invalidZeroPartial).state, 'fail');
  assert.equal(judge('T01', [...zero, sound('a', 'playing')]).state, 'fail');
});
test('T06b and T06d include an output setting chosen before Run without borrowing earlier replies', () => {
  const off = evidence([mute('voice_off'), ...trace('T06b', [say('a', 'text_only'), hearing('a', 'not_heard')])]);
  assert.equal(off.checks.T06b.state, 'pass');
  const returned = evidence([mute('agents_muted'), ...trace('T06d', [say('a', 'text_only'), hearing('a', 'not_heard'),
    mute(null, true), input('note', '', [miss('a', 'not_heard')], 'user_returned')])]);
  assert.equal(returned.checks.T06d.state, 'pass');
  const old = evidence([start('T04a'), say('old'), mute('voice_off'), ...trace('T06b', [say('a', 'text_only'), hearing('a', 'not_heard')])]);
  assert.equal(old.checks.T06b.state, 'pass');
});
test('reply_heard correction advances a known missed extent without a skip-specific notice', () => {
  const first = input('note', '', [miss('a', 'not_heard', 0, 'é🐙ab')], 'reply_not_heard');
  first.data.message_id = 'original';
  const correction = input('note', '', [], 'reply_heard');
  correction.data.notice.corrects_message_id = 'original';
  correction.data.notice.heard = [{ utterance_id: 'a', history_id: 's:voice:a', fate: 'partial', heard_chars: 2 }];
  const result = evidence([start('T14'), say('a', 'queued', 'é🐙ab'), first, correction]);
  assert.equal(result.fates[0].fate, 'partial');
  assert.deepEqual(result.notes.map((notice) => notice.kind), ['reply_not_heard', 'reply_heard']);
  assert.equal(result.notes[1].corrects_message_id, 'original');
  assert.equal(result.notes[1].heard[0].fate, 'partial');
});

test('T12 remains insufficient while the first queued reply has not started', () => {
  assert.equal(judge('T12', [say('a'), say('b')]).state, 'pending');
  assert.equal(judge('T12', [say('a'), say('b'), sound('a', 'playing')]).state, 'pending');
});
test('reliable playback retransmission is not a second play, but a distinct start is', () => {
  const events = structuredClone(baseline.T12);
  const first = events.find((event) => event.data?.type === 'voice-playback' && event.data.status === 'playing');
  first.data.client_msg_id = 'stable-receipt';
  const retry = structuredClone(first);
  events.splice(events.indexOf(first) + 1, 0, retry);
  assert.equal(judge('T12', events).state, 'pass');
  const conflict = structuredClone(first); conflict.data.status = 'heard';
  assert.equal(judge('T12', [...events, conflict]).state, 'fail');
  const replay = structuredClone(first); replay.data.client_msg_id = 'new-receipt';
  assert.equal(judge('T12', [...events, replay]).state, 'fail');
});
test('historical epochs and other-thread rows cannot rewind the selected open turn', () => {
  const turn = { kind: 'room-frame', data: { type: 'voice-user-turn', conversation: 'selected', thread_id: 'selected', epoch: 2, phase: 'started' } };
  const old = { kind: 'room-frame', data: { type: 'history', conversation: 'selected', row: { thread_id: 'selected', epoch: 1, role: 'assistant' } } };
  const other = { kind: 'room-frame', data: { type: 'history', conversation: 'other', row: { thread_id: 'other', epoch: 9, role: 'assistant' } } };
  assert.equal(evidence([turn, old, other], 'selected').currentEpoch, 2);
  assert.equal(evidence([other], 'selected').currentEpoch, null);
});
test('late correction retains the original text and extent across case boundaries', () => {
  const first = input('note', '', [miss('a', 'partial', 2, 'abcd')], 'reply_not_heard');
  first.data.unheard.replies[0].history_id = 's:voice:a';
  const correction = input('note', '', [], 'reply_heard');
  correction.data.notice.heard = [{ utterance_id: 'a', history_id: 's:voice:a', fate: 'heard', heard_chars: 4 }];
  const old = { kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a', role: 'assistant', text: 'abcd',
    hearing: 'partial', heard_chars: 2, hearing_unconfirmed: true } } };
  const row = evidence([start('T14'), say('a', 'queued', 'abcd'), first, start('T01'), correction, old]).fates[0];
  assert.deepEqual([row.fate, row.heard_chars, row.text, row.heard, row.unheard], ['heard', 4, 'abcd', 'abcd', '']);
  const sparse = evidence([start('T14'), correction]).fates[0];
  assert.deepEqual([sparse.fate, sparse.heard_chars, sparse.text, sparse.heard], ['heard', 4, undefined, null]);
});
test('rejected and unacknowledged decisions do not erase history uncertainty', () => {
  const submitted = hearing('a', 'partial', 2);
  Object.assign(submitted.data, { client_msg_id: 'r1', history_id: 's:voice:a' });
  const coreHistory = { kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a', role: 'assistant', text: 'abcd',
    hearing: 'partial', heard_chars: 2, hearing_unconfirmed: true } } };
  const base = [start('T14'), say('a', 'queued', 'abcd'), coreHistory, submitted];
  for (const ending of [[], [{ kind: 'room-frame', data: { type: 'error', client_msg_id: 'r1', key: 'room.stale_utterance' } }],
    [{ kind: 'room-frame', data: { type: 'voice-ack', client_msg_id: 'r1' } }]]) {
    const row = evidence([...base, ...ending]).fates[0];
    assert.deepEqual([row.fate, row.heard_chars, row.hearing_unconfirmed], ['partial', 2, true]);
  }
  assert.equal(evidence([...base, { kind: 'room-frame', data: { type: 'history', row: { ...coreHistory.data.row,
    hearing_unconfirmed: false } } }]).fates[0].hearing_unconfirmed, false);
});
const direct = (id, events) => evidence(events).checks[id];
const prepared = (id) => trace(id, baseline[id]);
test('H6: zero partial fails on receipt, history, agent row and correction; missing text stays insufficient', () => {
  const modify = (change) => { const events = prepared('T01'); change(events); return direct('T01', events); };
  assert.equal(modify((events) => { events.find((e) => e.data?.type === 'reply-hearing').data.heard_chars = 0; }).state, 'fail');
  assert.equal(modify((events) => { events.push({ kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a',
    role: 'assistant', text: 'é🐙ab', hearing: 'partial', heard_chars: 0, hearing_unconfirmed: false } } }); }).state, 'fail');
  assert.equal(modify((events) => { events.find((e) => e.kind === 'agent-input').data.unheard.replies[0].heard_chars = 0; }).state, 'fail');
  assert.equal(modify((events) => { events.find((e) => e.kind === 'agent-input').data.unheard.replies[0].heard_chars = 0;
    events.splice(events.findIndex((e) => e.data?.type === 'voice-reply'), 1); }).state, 'fail',
  'an affirmative zero partial stays invalid before the history identity is observed');
  const corrected = prepared('T12');
  corrected.push({ kind: 'agent-input', data: { channel: 'note', text: '', message_id: 'correction', session_id: 's',
    revision: 2, epoch: 0, notice: { kind: 'reply_heard', corrects_message_id: 'message-1', heard: [
      { utterance_id: 'a', history_id: 's:voice:a', fate: 'partial', heard_chars: 0 }] } } });
  assert.equal(direct('T12', corrected).state, 'fail');
  assert.equal(modify((events) => { delete events.find((e) => e.data?.name === 'voice_say').data.args.text; }).state, 'pending');
  assert.equal(modify((events) => { events.find((e) => e.data?.type === 'reply-hearing').data.heard_chars = 4;
    events.find((e) => e.data?.type === 'reply-hearing').data.outcome = 'heard'; }).state, 'fail');
  const invalidDisplay = evidence([start('T14'), say('a', 'queued', 'abcd'),
    input('note', '', [miss('a', 'partial', 0, 'abcd')], 'reply_not_heard')]).fates[0];
  assert.equal(invalidDisplay.fate, 'unconfirmed');
  const invalidFull = evidence([start('T14'), say('a', 'queued', 'abcd'),
    { kind: 'agent-input', data: { notice: { kind: 'reply_heard', heard: [
      { utterance_id: 'a', history_id: 's:voice:a', fate: 'heard', heard_chars: 0 }] } } }]).fates[0];
  assert.equal(invalidFull.fate, 'unconfirmed');
});
test('a submitted hearing decision needs matching core acknowledgement and history identity', () => {
  const valid = prepared('T12');
  assert.equal(direct('T12', valid).state, 'pass');
  const noAck = valid.filter((e) => !(e.data?.type === 'voice-ack' && e.data.client_msg_id === 'receipt-1'));
  assert.equal(direct('T12', noAck).state, 'pending');
  const rejected = [...noAck, { kind: 'room-frame', data: { type: 'error', client_msg_id: 'receipt-1', key: 'room.stale_utterance' } }];
  assert.equal(direct('T12', rejected).state, 'fail');
  const wrong = structuredClone(valid);
  wrong.find((e) => e.data?.type === 'reply-hearing').data.history_id = 'other:voice:a';
  assert.notEqual(direct('T12', wrong).state, 'pass');
});
test('agent extent and notice must match the confirmed reply on the exposed message', () => {
  const wrongExtent = prepared('T01');
  wrongExtent.find((e) => e.kind === 'agent-input').data.unheard.replies[0].heard_chars = 3;
  assert.equal(direct('T01', wrongExtent).state, 'fail');
  const detached = prepared('T02a');
  const original = detached.find((e) => e.kind === 'agent-input');
  const detachedNote = structuredClone(original);
  detachedNote.data.message_id = 'unrelated-note'; detachedNote.data.channel = 'note'; detachedNote.data.text = '';
  original.data.unheard = undefined;
  detached.push(detachedNote);
  assert.notEqual(direct('T02a', detached).state, 'pass');
  const linked = prepared('T02a');
  const words = linked.find((e) => e.kind === 'agent-input');
  const note = structuredClone(words);
  note.data.message_id = 'linked-note'; note.data.channel = 'note'; note.data.text = '';
  note.data.notice.related_message_id = words.data.message_id;
  words.data.unheard = undefined; words.data.notice = undefined;
  linked.push(note);
  assert.equal(direct('T02a', linked).state, 'pass');
  const wrongTurn = prepared('T02a');
  wrongTurn.find((e) => e.kind === 'agent-input').data.unheard.replies[0].epoch = 9;
  assert.notEqual(direct('T02a', wrongTurn).state, 'pass');
  for (const id of ['T02c', 'T02d']) {
    const noInstruction = prepared(id);
    delete noInstruction.find((e) => e.data?.name === 'voice_say').data.result.instruction;
    assert.equal(direct(id, noInstruction).state, 'pending');
    const wrongIdentity = prepared(id);
    wrongIdentity.find((e) => e.data?.name === 'voice_say').data.result.utterance_id = 'wrong';
    assert.equal(direct(id, wrongIdentity).state, 'fail');
  }
  const corrected = prepared('T01');
  corrected.push({ kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a', role: 'assistant', text: 'é🐙ab',
    hearing: 'heard', heard_chars: 4, hearing_unconfirmed: false } } });
  assert.equal(direct('T01', corrected).state, 'pending', 'a stronger result waits for its correction notice');
  corrected.push({ kind: 'agent-input', data: { channel: 'note', text: '', message_id: 'correction', session_id: 's',
    revision: 2, epoch: 1, notice: { kind: 'reply_heard', corrects_message_id: 'message-1', heard: [
      { utterance_id: 'a', history_id: 's:voice:a', fate: 'heard', heard_chars: 4 }] } } });
  assert.equal(direct('T01', corrected).state, 'pass', 'frozen original and linked correction are both valid');
  const advanced = prepared('T04b');
  const beforeCut = advanced.findIndex((e) => e.data?.type === 'reply-hearing' && e.data.utterance_id === 'a');
  advanced.splice(beforeCut, 0, { kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a', role: 'assistant',
    text: 'A reply', hearing: 'not_heard', heard_chars: 0, hearing_unconfirmed: true } } });
  assert.equal(direct('T04b', advanced).state, 'pass', 'confirmed extent can advance before the first envelope');
});
test('lifecycle counterexamples cannot pass and absent transitions stay insufficient', () => {
  const a = prepared('T04a');
  a.filter((e) => e.data?.name === 'voice_say').forEach((e, i) => { e.data.args.epoch = i; });
  assert.equal(direct('T04a', a).state, 'fail');
  const b = prepared('T04b');
  b.splice(b.findIndex((e) => e.data?.type === 'voice-playback' && e.data.status === 'interrupted'), 0, sound('a', 'heard'));
  assert.equal(direct('T04b', b).state, 'fail');
  const five = prepared('T05').filter((e) => !(e.data?.type === 'voice-playback' && e.data.utterance_id === 'a' && e.data.status === 'playing'));
  assert.equal(direct('T05', five).state, 'pending');
  const skip = prepared('T12');
  const stopAt = skip.findIndex((e) => e.data?.type === 'voice-playback' && e.data.utterance_id === 'a' && e.data.status === 'interrupted');
  const [stop] = skip.splice(stopAt, 1); skip.push(stop);
  assert.equal(direct('T12', skip).state, 'fail');
  const returned = prepared('T06d');
  returned.find((e) => e.kind === 'agent-input').data.received_at = 1001;
  assert.equal(direct('T06d', returned).state, 'fail');
  const offLate = prepared('T06b');
  const offAt = offLate.findIndex((e) => e.data?.type === 'voice-speech');
  const [off] = offLate.splice(offAt, 1); offLate.push(off);
  assert.equal(direct('T06b', offLate).state, 'fail');
  for (const id of ['T01', 'T02a', 'T02b', 'T04b', 'T05']) {
    assert.equal(direct(id, prepared(id).filter((e) => e.data?.type !== 'voice-user-turn')).state, 'pending');
  }
  assert.equal(direct('T06d', returned.map((e) => { if (e.data?.type === 'voice-speech' && e.data.on === true) delete e.data.observed_at; return e; })).state, 'pending');
});
test('unresolved admission is insufficient until recovery or terminal rejection', () => {
  for (const id of ['T01', 'T02a', 'T02b', 'T03', 'T04b', 'T05', 'T06a', 'T06b', 'T06d']) {
    const unresolved = prepared(id);
    const first = unresolved.find((e) => e.data?.name === 'voice_say');
    const original = structuredClone(first);
    first.data.result = { status: 'admission_unknown', utterance_id: first.data.args.utterance_id,
      event_id: first.data.args.event_id, instruction: 'Wait for a disposition' };
    assert.equal(direct(id, unresolved).state, 'pending', id);
    unresolved.splice(unresolved.indexOf(first) + 1, 0, original);
    assert.equal(direct(id, unresolved).state, 'pass', `${id}: successful same-ID recovery`);
    original.data.result = { status: 'rejected', terminal: true, reason: 'newer_turn',
      utterance_id: first.data.args.utterance_id, event_id: first.data.args.event_id };
    assert.equal(direct(id, unresolved).state, 'fail', `${id}: terminal refusal`);
  }
  const historyResolved = prepared('T04a');
  historyResolved.find((e) => e.data?.name === 'voice_say').data.result.status = 'admission_unknown';
  assert.equal(direct('T04a', historyResolved).state, 'pending');
  historyResolved.push({ kind: 'room-frame', data: { type: 'history', row: { id: 's:voice:a', role: 'assistant',
    text: 'a', status: 'queued', hearing: 'heard', heard_chars: 1, hearing_unconfirmed: false } } });
  assert.equal(direct('T04a', historyResolved).state, 'pass', 'matching core history resolves uncertain admission');
});
