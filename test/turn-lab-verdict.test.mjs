import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidence } from '../preview/turn-lab/evidence.mjs';

const start = (id, extra = {}) => ({ kind: 'script-start', data: { id, ...extra } });
const say = (id, status = 'published', reason) => ({ kind: 'tool-result', data: { name: 'voice_say', args: { utterance_id: id, text: id }, result: { status, reason, audio: status === 'text_only' ? 'text_only' : 'queued' } } });
const input = (channel, text, replies = [], kind) => ({ kind: 'agent-input', data: { channel, text, unheard: { replies }, ...(kind ? { notice: { kind } } : {}) } });
const reply = (id, fate, reason, cut, heard_chars) => ({ utterance_id: id, text: id, fate, reason, cut, heard_chars });
const frame = (type, id, status, extra = {}) => ({ kind: 'browser-action', data: { type, utterance_id: id, status, ...extra } });
const muted = (reason) => ({ kind: 'room-frame', data: { type: 'voice-speech', on: false, reason } });
const bad = {
  T01: [say('a'), input('voice', 'Stop', [reply('a', 'interrupted', 'user_interrupted', false, 2)])],
  T02a: [say('a'), input('voice', 'Hello', [reply('a', 'interrupted', 'user_interrupted', true, 2)])],
  T02b: [say('a'), input('note', '', [reply('a', 'interrupted', 'user_interrupted', true, 2)], 'turn_empty')],
  T02c: [say('a', 'rejected', 'room_speech_context_invalid'), input('voice', 'Hello')],
  T02d: [say('a', 'rejected', 'room_speech_context_invalid'), input('note', '', [], 'turn_empty')],
  T03: [say('a', 'text_only', 'newer_turn'), input('note', '', [reply('other', 'unplayed', 'newer_turn', false, null)], 'reply_not_played')],
  T04a: [say('a'), say('b'), say('c'), frame('voice-playback', 'a', 'playing'), frame('voice-playback', 'c', 'playing'), frame('voice-playback', 'b', 'playing')],
  T04b: [say('a'), say('b'), say('c'), input('voice', 'Stop', [reply('a', 'interrupted', 'user_interrupted', true, 2), reply('a', 'interrupted', 'user_interrupted', true, 2), reply('a', 'interrupted', 'user_interrupted', true, 2)])],
  T05: [say('a'), say('b'), say('c'), frame('voice-playback', 'a', 'heard'), frame('voice-playback', 'b', 'heard'), frame('voice-playback', 'c', 'heard'), input('note', '', [], 'reply_interrupted')],
  T06a: [say('a'), frame('voice-playback', 'a', 'heard'), muted('agents_muted'), say('b', 'text_only', 'agents_muted')],
  T06b: [muted('voice_off'), say('a'), frame('voice-playback', 'a', 'heard')],
  T06d: [muted('agents_muted'), say('a', 'text_only', 'agents_muted'), input('note', '', [], 'user_returned'), frame('voice-playback', 'a', 'heard')],
  T08: [say('a'), say('b'), frame('voice-playback', 'a', 'heard'), frame('typed-message', null, 200, { epoch: 1 }), frame('voice-playback', 'b', 'heard')],
  T12: [say('a'), say('b'), frame('voice-playback', 'a', 'interrupted', { reason: 'user_skipped' }), frame('voice-playback', 'b', 'interrupted', { reason: 'user_interrupted' }), input('note', '', [], 'reply_skipped')],
};
for (const [id, events] of Object.entries(bad)) test(`${id} rejects an invalid trace`, () => {
  const actual = evidence([start(id, id === 'T08' ? { epoch: 0 } : {}), ...events]).checks[id];
  assert.equal(actual.state, 'fail', actual.reason);
});

test('every automatic case has an invalid-trace FAIL regression', () => {
  const automatic = Object.entries(evidence([]).checks).filter(([, check]) => check.state === 'pending').map(([id]) => id).sort();
  assert.deepEqual(Object.keys(bad).sort(), automatic);
});

test('an outcome from another conversation cannot complete a case', () => {
  const actual = evidence([start('T02c', { conversation: 'a' }), say('a', 'rejected', 'user_speaking'),
    { ...input('voice', 'Other words'), data: { ...input('voice', 'Other words').data, conversation: 'b' } }]).checks.T02c;
  assert.equal(actual.state, 'pending');
});

test('missing evidence stays pending, including refusal without its empty notice and skip without its next reply', () => {
  assert.equal(evidence([start('T02d'), say('a', 'rejected', 'user_speaking')]).checks.T02d.state, 'pending');
  assert.equal(evidence([start('T12'), input('note', '', [], 'reply_skipped')]).checks.T12.state, 'pending');
});

test('an uncertain publication cannot hide an unrelated definite failure', () => {
  assert.equal(evidence([start('T02d'), say('a', 'rejected', 'wrong_reason'), say('b', 'admission_unknown')]).checks.T02d.state, 'fail');
});

test('actual core history rows reconcile terminal fate after reconnect', () => {
  const row = { id: 'session-1:voice:u', thread: 'thread-1', session: 'session-1', role: 'assistant', revision: 1, epoch: 2,
    status: 'playback_finished', audio_reason: null, heard_chars: 4, globally_heard: true, text: 'Done' };
  const events = [start('T04a'), say('u'), { kind: 'room-frame', data: { type: 'history', row } }];
  assert.deepEqual(evidence(events).fates[0], { utterance_id: 'u', fate: 'played', text: 'Done', reason: undefined, heard_chars: 4, history_id: row.id, heard: 'Done', unheard: '' });
});

test('never-started interrupted evidence is not displayed as a cut', () => {
  const events = [start('T02a'), say('u'), input('voice', 'Next', [reply('u', 'interrupted', 'newer_turn', false, null)])];
  assert.equal(evidence(events).fates[0].fate, 'not played');
  assert.equal(evidence(events).checks.T02a.state, 'pass');
});

test('current epoch follows the selected conversation, not the largest observed epoch', () => {
  const events = [
    { kind: 'room-frame', data: { type: 'voice-user-turn', conversation: 'a', epoch: 5, turn_id: 'a1', phase: 'started' } },
    { kind: 'room-frame', data: { type: 'voice-user-turn', conversation: 'b', epoch: 1, turn_id: 'b1', phase: 'started' } },
    { kind: 'room-frame', data: { type: 'voice-user-turn', conversation: 'b', epoch: 1, turn_id: 'b1', phase: 'started' } },
  ];
  assert.equal(evidence(events, 'b').currentEpoch, 1);
  assert.equal(evidence(events, 'a').currentEpoch, 5);
});
