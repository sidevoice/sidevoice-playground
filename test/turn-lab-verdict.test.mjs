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
const judge = (id, events) => evidence([start(id), ...events]).checks[id];
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
  T04b: (events) => [...events, hearing('b', 'heard')],
  T05: (events) => [...events, hearing('c', 'heard')],
  T06a: (events) => [...events, sound('b', 'playing')],
  T06b: (events) => [...events, sound('a', 'playing')],
  T06d: (events) => [...events, hearing('a', 'heard')],
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
  const off = evidence([mute('voice_off'), start('T06b'), say('a', 'text_only'), hearing('a', 'not_heard')]);
  assert.equal(off.checks.T06b.state, 'pass');
  const returned = evidence([mute('agents_muted'), start('T06d'), say('a', 'text_only'), hearing('a', 'not_heard'),
    mute(null, true), input('note', '', [miss('a', 'not_heard')], 'user_returned')]);
  assert.equal(returned.checks.T06d.state, 'pass');
  const old = evidence([start('T04a'), say('old'), mute('voice_off'), start('T06b'), say('a', 'text_only'), hearing('a', 'not_heard')]);
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
