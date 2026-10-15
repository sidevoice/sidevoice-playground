// Deterministic executable reference for the 25 mock turn fixtures. The action
// names drive state transitions; `expect` is used only after the run to judge it.
export async function runTurnFixture(fixture, { wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onStep = () => {} } = {}) {
  const state = { epochDelta: 0, fates: [], notice: [], screen: [], tool: null, trace: [], turnOpen: false,
    output: 'on', playing: null, queued: [], misses: false, activity: false };
  const mark = (items, value) => { if (value && !items.includes(value)) items.push(value); };
  const add = (fate) => { state.fates.push(fate); return state.fates.length - 1; };
  const settle = (fate) => { if (state.playing != null) { state.fates[state.playing] = fate; state.playing = null; } };
  const missQueued = () => { for (const index of state.queued) state.fates[index] = 'unplayed'; state.queued = []; };
  const act = (type) => {
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
      case 'typed-message': settle('heard'); mark(state.screen, 'typed-context'); break;
      case 'speech-990ms': case 'speech-low-volume': settle('heard'); mark(state.screen, 'no-cut'); break;
      case 'speaker-only-echo': mark(state.screen, 'no-user-message'); break;
      case 'conversation-a': case 'conversation-b': state.epochDelta++; mark(state.screen, 'independent-conversations'); break;
      case 'duplicate-start': case 'out-of-order-finish': break;
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
      case 'push-input': case 'pull-input': case 'ack-loss': case 'redelivery': mark(state.screen, 'stable-message-ids'); break;
      default: throw new Error(`Unknown turn fixture action: ${type}`);
    }
  };
  let elapsed = 0;
  for (const action of fixture.actions) {
    if (!Number.isInteger(action.atMs) || action.atMs < elapsed) throw new Error(`Actions must be ordered: ${fixture.id}`);
    await wait(action.atMs - elapsed);
    elapsed = action.atMs;
    act(action.type);
    const entry = { atMs: elapsed, action: action.type, epoch: state.epochDelta, fates: [...state.fates], notice: [...state.notice] };
    state.trace.push(entry);
    onStep(entry);
  }
  for (const index of state.queued) state.fates[index] = 'heard';
  const actions = new Set(fixture.actions.map((action) => action.type));
  if (state.fates.length === 3 && state.fates.every((fate) => fate === 'heard')) mark(state.screen, 'all-three');
  if (actions.has('checkpoint') && state.fates.includes('interrupted')) mark(state.screen, 'checkpoint-cut');
  if (!actions.has('checkpoint') && state.fates.some((fate) => ['unplayed', 'text_only'].includes(fate))) mark(state.screen, 'unheard');
  if (actions.has('push-input') && actions.has('pull-input') && actions.has('redelivery')) mark(state.notice, 'same-in-push-and-pull');
  const actual = { epochDelta: state.epochDelta, fates: state.fates, notice: state.notice, screen: state.screen, tool: state.tool };
  const mismatches = Object.entries(fixture.expect).flatMap(([key, expected]) => JSON.stringify(actual[key] ?? []) === JSON.stringify(expected) ? [] : [`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual[key])}`]);
  return { id: fixture.id, actual, mismatches, trace: state.trace, status: mismatches.length ? 'fail' : 'pass' };
}
