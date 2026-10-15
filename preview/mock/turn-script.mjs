// Deterministic reference model for the 25 mock turn fixtures. The contract
// oracle is separate from fixture data; this model is not live-stack acceptance.
import { TURN_CONTRACT } from "./turn-contract.mjs";
import { probeMockRoom } from "./turn-machine-probes.mjs";
export async function runTurnFixture(fixture, { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onStep = () => {} } = {}) {
  const state = { epochDelta: 0, fates: [], notice: [], screen: [], tool: null, trace: [], turnOpen: false,
    output: 'on', playing: null, queued: [], misses: false, activity: false,
    conversations: new Map(), finishes: [], duplicateStarts: 0, envelopes: new Map(), deliveries: [], claims: new Map() };
  const mark = (items, value) => { if (value && !items.includes(value)) items.push(value); };
  const add = (fate) => { state.fates.push(fate); return state.fates.length - 1; };
  const settle = (fate) => { if (state.playing != null) { state.fates[state.playing] = fate; state.playing = null; } };
  const missQueued = () => { for (const index of state.queued) state.fates[index] = 'unplayed'; state.queued = []; };
  const act = (action) => {
    const { type } = action;
    switch (type) {
      case 'speech-start': { const playing = state.playing != null; state.epochDelta++; state.turnOpen = true; settle('interrupted'); missQueued(); if (playing) mark(state.notice, 'reply_interrupted'); else if (state.fates.includes('unplayed')) mark(state.notice, 'reply_not_played'); break; }
      case 'speech-finished': state.epochDelta++; state.turnOpen = false; break;
      case 'speech-short-silent': state.epochDelta++; mark(state.screen, 'user-message'); break;
      case 'speech-qualified': settle('interrupted'); mark(state.notice, 'reply_interrupted'); mark(state.screen, 'cut'); break;
      case 'turn-finished': state.turnOpen = false; break;
      case 'turn-cancelled': state.turnOpen = false; if (state.tool === 'user_speaking') mark(state.notice, 'turn_empty'); break;
      case 'reply-accepted': state.queued.push(add('queued')); break;
      case 'reply-playing': state.playing = add('playing'); break;
      case 'reply-queued': state.queued.push(add('queued')); break;
      case 'reply': add(state.output === 'on' ? state.turnOpen ? 'unplayed' : 'heard' : 'text_only'); break;
      case 'voice-say': state.tool = state.turnOpen ? 'user_speaking' : 'accepted'; break;
      case 'late-reply': add('text_only'); mark(state.notice, 'reply_not_played'); mark(state.screen, 'unheard'); break;
      case 'ack': add('heard'); break;
      case 'checkpoint': state.playing = add('playing'); break;
      case 'result': add(state.turnOpen ? 'unplayed' : 'heard'); break;
      case 'agents-mute': state.output = 'muted'; settle('interrupted'); if (state.fates.includes('interrupted')) mark(state.screen, 'unheard'); break;
      case 'agents-unmute': state.output = 'on'; break;
      case 'voice-off': state.output = 'off'; break;
      case 'voice-on': state.output = 'on'; break;
      case 'focus-switch': if (state.playing != null) { settle('interrupted'); mark(state.screen, 'inactive-conversation'); } break;
      case 'focus-return': break;
      case 'return-grace': if (state.fates.includes('text_only')) mark(state.notice, 'user_returned'); break;
      case 'disconnect': settle('unplayed'); mark(state.screen, 'unheard'); break;
      case 'reconnect': if (state.fates.includes('unplayed')) mark(state.notice, 'user_returned'); break;
      case 'retry': break;
      case 'typed-message': mark(state.screen, 'typed-context'); break;
      case 'speech-990ms': case 'speech-low-volume': settle('heard'); mark(state.screen, 'no-cut'); break;
      case 'speaker-only-echo': mark(state.screen, 'no-user-message'); break;
      case 'conversation-a': case 'conversation-b': {
        const conversation = type.slice(-1);
        const turnId = action.turnId ?? `${conversation}-turn-1`;
        const current = state.conversations.get(conversation);
        if (current?.turnId !== turnId) {
          state.conversations.set(conversation, { turnId, epoch: (current?.epoch ?? 0) + 1, finished: false });
          state.epochDelta++;
        } else state.duplicateStarts++;
        if (state.conversations.size === 2) mark(state.screen, 'independent-conversations');
        break;
      }
      case 'duplicate-start': {
        const conversation = action.conversation ?? 'a';
        const turnId = action.turnId ?? 'a-turn-1';
        const current = state.conversations.get(conversation);
        if (current?.turnId === turnId) state.duplicateStarts++;
        else { state.conversations.set(conversation, { turnId, epoch: (current?.epoch ?? 0) + 1, finished: false }); state.epochDelta++; }
        break;
      }
      case 'out-of-order-finish': {
        for (const [conversation, defaultId] of [['b', 'b-turn-1'], ['a', 'a-turn-1']]) {
          const turnId = action[`${conversation}TurnId`] ?? defaultId;
          const current = state.conversations.get(conversation);
          if (current?.turnId === turnId && !current.finished) { current.finished = true; state.finishes.push(`${conversation}:${turnId}`); }
          else state.finishes.push(`invalid:${conversation}:${turnId}`);
        }
        break;
      }
      case 'skip': settle('skipped'); mark(state.notice, 'reply_skipped'); mark(state.screen, 'heard-by-choice'); break;
      case 'next-reply': add('heard'); break;
      case 'mic-mute': mark(state.screen, 'normal-turn-end'); break;
      case 'reply-partial-device-a': state.playing = add('playing'); break;
      case 'reply-heard': add('heard'); mark(state.screen, 'heard'); break;
      case 'reply-heard-device-b': settle('heard'); mark(state.screen, 'global-heard'); break;
      case 'switch-device': break;
      case 'activity-2900ms': state.activity = true; mark(state.screen, 'hidden-before-3000'); break;
      case 'activity-3000ms': if (state.activity) mark(state.screen, 'shown-at-3000'); break;
      case 'inactivity': state.activity = false; mark(state.screen, 'reset'); break;
      case 'activity-restart': state.activity = true; break;
      case 'push-input': case 'pull-input': {
        const id = action.messageId ?? 'message-1';
        if (!state.envelopes.has(id)) state.envelopes.set(id, { id, channel: 'note', text: 'The person is back', notice: { kind: 'user_returned' } });
        const mode = type === 'push-input' ? 'push' : 'pull';
        state.deliveries.push({ mode, id, envelope: structuredClone(state.envelopes.get(id)) });
        state.claims.set(mode, id);
        break;
      }
      case 'ack-loss': state.claims.delete('pull'); break;
      case 'redelivery': {
        const id = action.messageId ?? 'message-1';
        const envelope = state.envelopes.get(id);
        if (envelope && !state.claims.has('pull')) { state.deliveries.push({ mode: 'pull-redelivery', id, envelope: structuredClone(envelope) }); state.claims.set('pull', id); }
        break;
      }
      default: throw new Error(`Unknown turn fixture action: ${type}`);
    }
  };
  let elapsed = 0;
  for (const action of fixture.actions) {
    if (!Number.isInteger(action.atMs) || action.atMs < elapsed) throw new Error(`Actions must be ordered: ${fixture.id}`);
    await wait(action.atMs - elapsed);
    elapsed = action.atMs;
    act(action);
    const entry = { atMs: elapsed, action: action.type, epoch: state.epochDelta, fates: [...state.fates], notice: [...state.notice],
      conversations: Object.fromEntries([...state.conversations].map(([key, value]) => [key, { ...value }])), deliveries: [...state.deliveries] };
    state.trace.push(entry);
    onStep(entry);
  }
  settle('heard');
  for (const index of state.queued) if (state.fates[index] === 'queued') state.fates[index] = 'heard';
  const actions = new Set(fixture.actions.map((action) => action.type));
  if (state.fates.length === 3 && state.fates.every((fate) => fate === 'heard')) mark(state.screen, 'all-three');
  if (actions.has('checkpoint') && state.fates.includes('interrupted')) mark(state.screen, 'checkpoint-cut');
  if (!actions.has('checkpoint') && state.fates.some((fate) => ['unplayed', 'text_only'].includes(fate))) mark(state.screen, 'unheard');
  if (state.deliveries.length === 3 && state.deliveries.every((item) => item.id === state.deliveries[0].id && JSON.stringify(item.envelope) === JSON.stringify(state.deliveries[0].envelope)) &&
      state.deliveries.map((item) => item.mode).join(',') === 'push,pull,pull-redelivery') {
    mark(state.notice, 'same-in-push-and-pull'); mark(state.screen, 'stable-message-ids');
  }
  const actual = { epochDelta: state.epochDelta, fates: state.fates, notice: state.notice, screen: state.screen, tool: state.tool };
  const contract = TURN_CONTRACT[fixture.id];
  const mismatches = [];
  if (!contract) mismatches.push(`Unknown #19 case: ${fixture.id}`);
  else {
    if (JSON.stringify(fixture.actions.map((action) => action.type)) !== JSON.stringify(contract.actions)) mismatches.push('Required #19 case steps are missing or reordered');
    for (const [key, expected] of Object.entries(contract.outcome)) {
      if (JSON.stringify(actual[key] ?? []) !== JSON.stringify(expected)) mismatches.push(`${key}: #19 requires ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`);
    }
    if (JSON.stringify(fixture.expect) !== JSON.stringify(contract.outcome)) mismatches.push('Fixture expectation disagrees with the independent #19 case oracle');
  }
  if (fixture.id === 'T08' && state.trace.find((item) => item.action === 'typed-message')?.fates[0] !== 'playing') mismatches.push('Typing must leave the first reply playing');
  if (fixture.id === 'T11' && (state.conversations.get('a')?.epoch !== 1 || state.conversations.get('b')?.epoch !== 1 ||
      state.duplicateStarts !== 1 || state.finishes.join(',') !== 'b:b-turn-1,a:a-turn-1')) mismatches.push('Separate epochs, deduplicated turn IDs, and out-of-order terminals are required');
  if (fixture.id === 'T16' && (state.deliveries.length !== 3 || state.claims.get('pull') !== state.deliveries[0]?.id)) mismatches.push('Push/pull envelope identity, claim release, and redelivery are required');
  mismatches.push(...await probeMockRoom(fixture));
  // A synthetic reference model cannot certify the real producers. Reserve
  // PASS for live case evidence; this result means the model matched #19.
  return { id: fixture.id, actual, mismatches, trace: state.trace, status: mismatches.length ? 'fail' : 'model-match', scope: 'reference-model' };
}
