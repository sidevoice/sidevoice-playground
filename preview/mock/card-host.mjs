// The preview's floating call card host (sidevoice-web briefs/FLOATING-CARD-SPEC.md §8): the seam the desktop app gives
// its card window (`window.__sidevoiceDesktop.host.callControls`, the web's call-controls/host.ts CallControlsHost),
// fed from the room frame beside it as the desktop's bridge feeds it from the room window — the room's own store
// (`sidevoiceUI.store`, whose `callCard` is the card's whole snapshot), its microphone level and its caption channels,
// and its actions (`sidevoiceActions`). The card page in the frame is the web's real one: what shows is what the app's
// window would draw. What the desktop owns is played here the way it would: when the card is wanted (the gate, and the
// exit notice's moments), and what each command does.

/** The bridge's snapshot version. */
export const BRIDGE_VERSION = 2;
/** How long the exit notice keeps the card after the call or the voice went off by itself (FC7; an estimate). */
export const EXIT_NOTICE_MS = 8000;
/** How often the host looks for the room's store: it appears after the room's scripts, and anew on each of its loads. */
export const BIND_EVERY_MS = 200;
/** The global mute shortcut the app registers, as the person reads it. */
export const MUTE_SHORTCUT = "⌃⌥M";

/** Whether the card is wanted for `call` (the desktop's `wanted()` without "the room in front": the room is always in
 *  view here, and that is the point): the first setup done, and the call (A) or the voice (B) on. */
export function gateOpen(call) {
  if (!call?.setupDone) return false;
  return call.callModel === "voice-switch" ? !!call.voiceOn : !!call.joined;
}

/** Whether the gate closed by itself, so the card says why a moment (§2.1): A's `ended`, B's `voiceOffReason` (but
 *  `micUnavailable`, which only happens while voice turns on). */
export function endedByItself(call) {
  if (!call) return false;
  if (call.callModel === "voice-switch") return !!call.voiceOffReason && call.voiceOffReason !== "micUnavailable";
  return !!call.ended;
}

/**
 * The host for the card page. `roomWindow()` is the room frame's window now. Options: `world` (its log), `now` (the
 * clock), `alwaysExpanded()` (the shell's checkbox), `onLayout(size)` (the card's size, margin included), `onOpen()`
 * (the preview's stand-in for bringing the room's window forward), `onShow(shown)` (the card is wanted or not), and
 * `poll` — false to call `tick()` by hand (tests).
 */
export function cardHost(roomWindow, { world = null, now = () => Date.now(), alwaysExpanded = () => false, onLayout = () => {}, onOpen = () => {}, onShow = () => {}, poll = true } = {}) {
  const listeners = new Set();
  /** The room's store and channels this host follows now, and what stops following them. */
  let bound = null;
  let stop = [];
  let level = 0;
  let caption = null;
  let outsideClicks = 0;
  /** When the gate last opened (the card's `since`), whether it is open, and until when the exit notice keeps the card. */
  let since = null;
  let open = false;
  let exitUntil = 0;
  let held = false;
  let shown = null;
  /** Device choices the card asked for that the room has not answered yet: the card's devices are busy meanwhile. */
  let choosing = 0;
  let draggedOnce = false;

  const log = (command, status) => world?.log({ method: "card", url: command, status, mocked: true });
  const view = () => bound?.store.getState() ?? null;

  function snapshot() {
    const card = view()?.callCard;
    if (!card) return null;
    const devices = card.devices ? { ...card.devices, busy: card.devices.busy || choosing > 0 } : null;
    return { ...card, devices, version: BRIDGE_VERSION, since };
  }

  /** What the card is told: the room's snapshot with the host's stamps, the level, the caption and the app's own. */
  function state() {
    const call = snapshot();
    if (!call) return null;
    return { call, level, pointerInside: null, alwaysExpanded: !!alwaysExpanded(), muteShortcut: MUTE_SHORTCUT, outsideClicks, caption };
  }

  /** The gate and the exit notice's moment, as the desktop's `wanted()` decides them. */
  function decide() {
    const call = snapshot();
    const gate = gateOpen(call);
    if (gate && !open) {
      since = now();
      exitUntil = 0;
    }
    if (!gate && open) {
      exitUntil = endedByItself(call) ? now() + EXIT_NOTICE_MS : 0;
      since = null;
    }
    open = gate;
    const wanted = gate || (exitUntil > 0 && (held || now() < exitUntil));
    if (!wanted) exitUntil = 0;
    if (wanted !== shown) {
      shown = wanted;
      onShow(wanted);
    }
  }

  function publish() {
    decide();
    const next = state();
    if (!next) return;
    for (const listener of [...listeners]) listener(next);
  }

  /** Follows the room frame's store and channels; anew whenever the frame loaded another room (a scenario, a reload). */
  function bind() {
    const ui = roomWindow()?.sidevoiceUI;
    const store = ui?.store;
    if (!store || store === bound?.store) return;
    for (const off of stop) off();
    bound = { store, actions: () => roomWindow()?.sidevoiceActions ?? null };
    open = false;
    since = null;
    level = ui.micLevel?.current?.() ?? 0;
    caption = ui.caption?.current?.() ?? null;
    stop = [
      store.subscribe(publish),
      // The level follows the microphone whatever the call model (FC14: the desktop sends it only while `joined`).
      ui.micLevel?.subscribe?.((value) => { level = value; publish(); }) ?? (() => {}),
      ui.caption?.subscribe?.((value) => { caption = value; publish(); }) ?? (() => {}),
    ];
    publish();
  }

  function tick() {
    bind();
    decide();
  }
  const timer = poll ? setInterval(tick, BIND_EVERY_MS) : null;

  /** Runs one command as the desktop bridge's `run()` does: refused where the room's own controls would be. */
  function run(request) {
    const actions = bound?.actions();
    const call = snapshot();
    const command = request?.command ?? "?";
    if (command === "open-app") { onOpen(); log(command, "shown"); return true; }
    if (command === "dismiss") { exitUntil = 0; held = false; decide(); log(command, "closed"); return true; }
    if (!actions || !call) { log(command, "no room"); return false; }
    const voiceSwitch = call.callModel === "voice-switch";
    const settle = (result) => Promise.resolve(result).catch(() => {});
    const refused = () => { log(command, "refused"); return false; };
    switch (command) {
      case "toggle-mute":
        if (call.micDisabled) return refused();
        actions.toggleMic();
        break;
      case "hang-up":
        // B has no call to hang up: the card turns the voice off instead (FC2).
        if (voiceSwitch || !call.joined) return refused();
        settle(actions.toggleCall());
        break;
      case "voice-off":
        if (!voiceSwitch || typeof actions.setVoice !== "function") return refused();
        settle(actions.setVoice(false));
        break;
      case "toggle-agents":
        if (!voiceSwitch || typeof actions.setAgentsMuted !== "function") return refused();
        actions.setAgentsMuted(!call.agentsMuted);
        break;
      case "skip-reply":
        if (!call.canSkip) return refused();
        settle(actions.skipReply());
        break;
      case "select-participant": {
        const row = call.participants.find((candidate) => candidate.threadId === request.threadId);
        // A: only one that is there; B: any, but while switching (D5).
        if (!row || (voiceSwitch ? row.switching : row.available === false)) return refused();
        actions.selectParticipant(request.threadId);
        break;
      }
      case "select-audio-device":
        if (!["input", "output"].includes(request.kind) || typeof actions.setAudioDevices !== "function") return refused();
        choosing += 1;
        publish();
        settle(actions.setAudioDevices({ [request.kind]: request.id === "" ? null : request.id })).finally(() => { choosing -= 1; publish(); });
        break;
      case "hear-it":
        if (!voiceSwitch || typeof actions.hearIt !== "function") return refused();
        settle(actions.hearIt(request.threadId));
        break;
      case "keep-alive":
        if (typeof actions.keepVoiceOn !== "function") return refused();
        actions.keepVoiceOn();
        break;
      default:
        return refused();
    }
    log(command, "ran");
    return true;
  }

  const host = {
    subscribe(listener) {
      listeners.add(listener);
      bind();
      const now = state();
      if (now) listener(now);
      return () => listeners.delete(listener);
    },
    run,
    layout(size) {
      if (size && size.width > 0 && size.height > 0) onLayout({ width: Math.round(size.width), height: Math.round(size.height) });
    },
    // Where the card sits is the desktop's (its magnet, the place per display): the preview's card stays in its column.
    drag(phase) {
      if (phase !== "start" || draggedOnce) return;
      draggedOnce = true;
      log("drag", "ignored (placement is the desktop app's)");
    },
  };

  return {
    host,
    tick,
    /** A click somewhere other than the card (the shell's, the room frame's): an open panel closes. */
    outsideClick() { outsideClicks += 1; publish(); },
    /** The pointer is over the card's frame: the exit notice stays while it is. */
    hold(on) { held = !!on; decide(); },
    /** The shell's own settings changed (always show controls). */
    refresh: publish,
    stop() {
      if (timer) clearInterval(timer);
      for (const off of stop) off();
      stop = [];
      listeners.clear();
    },
  };
}
