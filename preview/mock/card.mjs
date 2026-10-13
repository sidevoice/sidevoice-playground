// The mocked preview's card: a panel over the page that is plainly not the product, shown and hidden with its
// header (or Alt+Shift+P). It picks the scenario, the view, the language and the scenario's options; gives pairing
// codes for the machines, to paste into the page; sets how fast the world's time runs and whether a reload keeps
// the state; and lists what the mocks were asked. Rendered again whole on each change: it is small.

import { CODE_VARIANTS, LOCAL_ID, agentSpeaks, agentWorks, firstPaired, hostStatus, liveCall, mintCode, remoteBehind, setRemoteBehind } from "./machines.mjs";
import { appVersion } from "./bridge.mjs";
import { SAMPLE_KEYS, voiceState } from "./models.mjs";
import { SPEAKING_MS, speechLevel } from "./voice.mjs";
import { LOCAL_VERSION, UPDATER_STATES, checkForUpdate, hasAppUpdater, localBehind, setLocalBehind, setUpdaterMode, setUpdaterState, updaterMode, updaterStatus } from "./bridge.mjs";

const VIEW_LABELS = { browser: "Browser", app: "Desktop app", phone: "Phone" };
const BEHIND_LABELS = { current: "Current", behind: "Behind" };
const MODE_LABELS = { automatic: "Automatic", manual: "Manual" };
const LANGUAGE_LABELS = { "": "System", es: "Español", en: "English" };
const SPEED_LABELS = { 1: "×1", 4: "×4", 0: "Pause" };
const VARIANT_LABELS = {
  valid: "valid", expired: "expired", used: "already used", plaintext: "plain http only", damaged: "damaged", impostor: "another machine answers",
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

function segmented(values, labels, current, pick) {
  return el("div", { className: "segmented" }, values.map((value) =>
    el("button", { type: "button", textContent: labels[value], className: value === current ? "on" : "", onclick: () => pick(value) }),
  ));
}

function select(values, current, pick) {
  const node = el("select", { onchange: () => pick(node.value) }, values.map(({ value, label }) => new Option(label, value, false, value === current)));
  return node;
}

/** Puts `code` in the page's pairing field, as typing it would, if the field is open. */
function paste(frame, code) {
  const field = frame.contentDocument?.getElementById("device-pairing-code");
  if (!field) return false;
  const setter = Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLTextAreaElement.prototype, "value").set;
  setter.call(field, code);
  field.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
  field.focus();
  return true;
}

export function renderCard(root, { scenarios, scenario, world, identities, params, open, keeping, count, frame, toggle, pick, choose, speed, restart, clear, keep, reload }) {
  root.classList.toggle("closed", !open);
  const header = el("button", { type: "button", className: "card-header", onclick: toggle, title: "Alt+Shift+P" },
    el("strong", { textContent: "PREVIEW" }), count ? el("span", { className: "count", textContent: String(count) }) : null,
    el("span", { className: "chevron", textContent: open ? "▾" : "▸" }));
  if (!open) return root.replaceChildren(header);

  const groups = new Map();
  for (const option of scenario.options) {
    if (!groups.has(option.group)) groups.set(option.group, []);
    groups.get(option.group).push(option);
  }
  const machines = [
    ...Object.entries(world.state.machines ?? {}).map(([id, m]) => ({ id, host: m.host })),
    ...(world.state.local?.state === "running" ? [{ id: LOCAL_ID, host: `${world.state.local.computerName ?? "This computer"} (local host)` }] : []),
  ];
  let variant = root.dataset.variant || "valid";
  const note = el("p", { className: "note" });
  const codeRow = (machine) => el("div", { className: "code-row" },
    el("span", { textContent: machine.host }),
    el("button", { type: "button", textContent: "Paste", title: "Into the page's pairing field (open it first)", onclick: () => {
      const code = mintCode(world, identities, machine.id, variant);
      note.textContent = paste(frame, code) ? "" : "Open the page's pairing dialog first, or copy the code.";
    } }),
    el("button", { type: "button", textContent: "Copy", onclick: async () => {
      await navigator.clipboard.writeText(mintCode(world, identities, machine.id, variant));
      note.textContent = "Copied.";
    } }));

  const voiceNote = el("p", { className: "note voice-state", textContent: voiceLine(world) });
  const said = el("input", { type: "text", value: root.dataset.said ?? voiceState(world).transcript, oninput: () => (root.dataset.said = said.value) });
  // The conversation as the page shows it: you speaking, the agent speaking, the agent working. In a call it is the
  // call's own: you speak into the mocked voice, as into the microphone, and the page sends your turn to the machine's
  // mocked room; the agent speaks and works through that room, as its connector would (machines.mjs `agentSpeaks`,
  // `agentWorks`), and the page plays the reply with the mocked voice. With no call, a transcription test still hears
  // "You speak"; anything else the card plays into the page's own store (window.sidevoiceUI.store), the facts the
  // room would have sent, so the bubbles, the karaoke and the transcript show as they would.
  const sampleUser = el("select", {}, CONVERSATION_SAMPLES.user.map((text) => el("option", { value: text, textContent: sampleLabel(text) })));
  const sampleAgent = el("select", {}, CONVERSATION_SAMPLES.agent.map((text) => el("option", { value: text, textContent: text })));
  const conversationSection = el("fieldset", {},
    el("legend", { textContent: "Conversation (shown in the page)" }),
    el("label", {}, "You say", sampleUser),
    el("label", {}, "The agent says", sampleAgent),
    el("div", { className: "actions" },
      el("button", { type: "button", textContent: "You speak", title: "Listening, then transcribing, then your words sent", onclick: async () => {
        if (liveCall(world)) {
          if (!(await world.voiceRuntime?.speak(sampleUser.value))) voiceNote.textContent = "The call does not hear you: unmute it, and pick a conversation in the page.";
          return;
        }
        if (world.voiceRuntime?.state?.started && await world.voiceRuntime.speak(sampleUser.value)) return;
        if (!simulateUser(frame, sampleUser.value)) voiceNote.textContent = "Open a conversation in the page first.";
      } }),
      el("button", { type: "button", textContent: "You speak → sent", title: "The whole turn on the stage, on demand: your name and the bars, then what is sent, which leaves", onclick: () => {
        if (!simulateUser(frame, sampleUser.value || "Can you check the build and tell me what failed?")) voiceNote.textContent = "Open a conversation in the page first.";
      } }),
      el("button", { type: "button", textContent: "You speak twice", title: "Your turn sent, then you speak again while it is still on the stage", onclick: () => {
        if (!simulateUser(frame, sampleUser.value || CONVERSATION_SAMPLES.user[0])) voiceNote.textContent = "Open a conversation in the page first.";
        else setTimeout(() => simulateUser(frame, AGAIN_SAMPLE), SPOKEN_TURN_MS + AGAIN_AFTER_MS);
      } }),
      el("button", { type: "button", textContent: "Agent speaks", title: "A reply with its voice: the bubble, the karaoke, the transcript", onclick: () => {
        if (liveCall(world)) {
          if (!agentSpeaks(world, sampleAgent.value)) voiceNote.textContent = "The call is on no conversation: pick one in the page.";
          return;
        }
        if (!simulateAgent(frame, sampleAgent.value)) voiceNote.textContent = "Open a conversation in the page first.";
      } }),
      el("button", { type: "button", textContent: "Agent working", title: "The agent busy for a few seconds, then it answers with the reply above", onclick: () => {
        if (liveCall(world)) {
          if (!agentWorks(world, WORKING_MS)) voiceNote.textContent = "The call is on no conversation: pick one in the page.";
          else void world.delay(WORKING_MS).then(() => agentSpeaks(world, sampleAgent.value));
          return;
        }
        if (!simulateWorking(frame)) voiceNote.textContent = "Open a conversation in the page first.";
        else setTimeout(() => simulateAgent(frame, sampleAgent.value), WORKING_MS);
      } })));
  // The microphone and the speaker the page's voice offers (its device bar, by the microphone): a headset to plug in and
  // out, and a speaker that cannot be chosen (a browser without setSinkId).
  const devicesNote = el("p", { className: "note" });
  const describe = () => {
    const now = world.voiceRuntime?.devices;
    devicesNote.textContent = now ? `Headset ${now.headset ? "plugged in" : "unplugged"}; the speaker ${now.outputSelectable ? "can" : "cannot"} be chosen.`
      : "The page's voice is not made yet: join the call, or open the microphone's device bar.";
    plug.textContent = now?.headset === false ? "Plug the headset in" : "Unplug the headset";
    sink.textContent = now?.outputSelectable === false ? "Let the speaker be chosen" : "Speaker cannot be chosen";
  };
  const plug = el("button", { type: "button", onclick: () => { world.voiceRuntime?.plugHeadset(!world.voiceRuntime.devices.headset); describe(); } });
  const sink = el("button", { type: "button", onclick: () => { world.voiceRuntime?.outputSelectable(!world.voiceRuntime.devices.outputSelectable); describe(); } });
  describe();
  const devicesSection = el("fieldset", {},
    el("legend", { textContent: "Microphone and speaker (mocked)" }), devicesNote, el("div", { className: "actions" }, plug, sink));
  const voiceSection = el("fieldset", {},
    el("legend", { textContent: "Voice (mocked: no microphone)" }),
    voiceNote,
    el("label", {}, "You say", said),
    el("div", { className: "actions" },
      el("button", { type: "button", textContent: "Speak", title: "As if said into the microphone, while the page listens", onclick: async () => {
        const heard = await world.voiceRuntime?.speak(said.value);
        if (!heard) voiceNote.textContent = "The page is not listening: start what listens first (a call, or a transcription test).";
      } }),
      el("button", { type: "button", textContent: "Speak, pausing", title: "A pause mid-sentence, shorter than the end of turn waits: still your turn", onclick: async () => {
        if (!(await world.voiceRuntime?.speak(said.value, { pause: true }))) voiceNote.textContent = "The page is not listening: start what listens first (a call, or a try).";
      } }),
      el("button", { type: "button", textContent: "Speak, cut off", title: "The turn ended mid-sentence and you go on: a new turn, the cut one merged into it", onclick: async () => {
        if (!(await world.voiceRuntime?.speak(said.value, { cutOff: true }))) voiceNote.textContent = "The page is not listening: start what listens first (a call, or a try).";
      } }),
      el("button", { type: "button", textContent: "Copy accepted key", onclick: () => navigator.clipboard.writeText(SAMPLE_KEYS.accepted) }),
      el("button", { type: "button", textContent: "Copy rejected key", onclick: () => navigator.clipboard.writeText(SAMPLE_KEYS.rejected) })));

  // The stage avatar held in each mood it has (the page's avatarPreview fact), or Auto: the room drives it again. Pages
  // without that fact ignore it.
  const AVATAR_STATES = [
    ["idle", "Idle"], ["listening", "Listening (you speak)"], ["working", "Thinking / working"], ["speaking", "Speaking"],
    ["present", "Waiting for you"], ["attention", "Unheard (attention)"], ["offline", "Offline"],
  ];
  const avatarNote = el("p", { className: "note" });
  const holdAvatar = (state) => {
    const store = frame?.contentWindow?.sidevoiceUI?.store;
    if (!store) { avatarNote.textContent = "The page is not loaded yet."; return; }
    store.patch({ avatarPreview: state === null ? null : state === "attention" ? { mood: "present", unread: true } : { mood: state } });
    avatarNote.textContent = state === null ? "The room drives the avatar." : `Held: ${AVATAR_STATES.find(([id]) => id === state)?.[1]}.`;
  };
  const avatarSection = el("fieldset", {},
    el("legend", { textContent: "Stage avatar (forced state)" }), avatarNote,
    el("div", { className: "actions" },
      ...AVATAR_STATES.map(([id, label]) => el("button", { type: "button", textContent: label, onclick: () => holdAvatar(id) })),
      el("button", { type: "button", textContent: "Auto", onclick: () => holdAvatar(null) })));
  // The floating card's overlays (sidevoice-web FLOATING-CARD-SPEC §8.9), in the Desktop app view: the room's own facts
  // patched, so the room and the card beside it show them at once.
  const cardNote = el("p", { className: "note" });
  const roomPage = () => {
    const page = frame?.contentWindow;
    const store = page?.sidevoiceUI?.store;
    if (!store) cardNote.textContent = "The page is not loaded yet.";
    return store ? { store, actions: page.sidevoiceActions } : null;
  };
  const cardStatesSection = params.view === "app" ? el("fieldset", {},
    el("legend", { textContent: "Floating card states" }), cardNote,
    el("div", { className: "actions" },
      el("button", { type: "button", textContent: "Idle warning", title: "The minute before the call ends itself; Keep answers it", onclick: () => {
        const page = roomPage();
        if (!page) return;
        page.store.patch({ callIdleWarning: !page.store.getState().facts.callIdleWarning });
        cardNote.textContent = "";
      } }),
      el("button", { type: "button", textContent: "Ends by itself", title: "The call ends by itself: the card says why for a moment", onclick: () => {
        const page = roomPage();
        if (!page) return;
        // One change of the room's, as when it happens by itself: off, and why, at once.
        page.store.batch(() => {
          page.store.patch({ callEnded: { reason: "idle", detail: "" } });
          if (page.store.getState().call.joined) void page.actions?.toggleCall?.();
        });
        cardNote.textContent = "";
      } }))) : null;
  // The desktop app's updater (bridge.mjs `appUpdaterOf`), in any scenario, in the Desktop app view: each of its
  // states, set in the world and pushed to the page through its `subscribe`, live; and its mode, which the page reads
  // as it loads (the app pushes only its status), so setting it here loads the page again (↻) — the page and the app
  // never disagree on it. The mode and the line follow the world, the page's own changes too (updateActivity). App
  // checks is the app's own check (at launch, every 6 h), which the page never asked for: ~1.5 s, then what it finds
  // (automatic downloads it by itself, over ~7 s), pushed as the page's would be.
  const updaterSection = params.view === "app" ? el("fieldset", {},
    el("legend", { textContent: "App update (desktop)" }),
    el("p", { className: "note updater-state", textContent: updaterLine(world) }),
    el("div", { className: "row", title: "The app's updater mode: the page reads it as it loads, so it loads again" }, "Mode ↻",
      segmented(Object.keys(MODE_LABELS), MODE_LABELS, updaterMode(world), (mode) => {
        if (mode === updaterMode(world)) return;
        setUpdaterMode(world, mode);
        refreshUpdater(root, world);
        reload?.();
      })),
    el("div", { className: "actions" }, UPDATER_STATES.map((step) =>
      el("button", { type: "button", textContent: step.label, onclick: () => setUpdaterState(world, step.id) })),
      el("button", { type: "button", textContent: "App checks", title: "The app's own check, at launch and every 6 h: the page did not ask for it",
        onclick: () => void checkForUpdate(world) }))) : null;
  updaterSection?.querySelector(".segmented")?.classList.add("updater-mode");
  // Updates elsewhere (the web's Updates section), in any scenario and any view: this
  // computer's Sidevoice behind the one the app bundles (bridge.mjs `setLocalBehind`), and the first paired machine's
  // behind (machines.mjs `setRemoteBehind`). The page asks the app's `version()` as it loads, so the first loads it
  // again (↻; the Desktop app view only, the one with the app); it asks a machine's status once the machine connects, so
  // the second has it ask again at once, live. Where there is nothing to set (no local host, no machine paired), the
  // toggle stays as it is and its line says why.
  root.dataset.view = params.view;
  const elsewhereNote = el("p", { className: "note" });
  const behindRow = (key, label, title, behind, pick) => el("div", { className: `row elsewhere-${key}`, title }, label,
    segmented(Object.keys(BEHIND_LABELS), BEHIND_LABELS, behind ? "behind" : "current", (value) => {
      elsewhereNote.textContent = "";
      pick(value === "behind");
    }));
  const updatesElsewhereSection = el("fieldset", {},
    el("legend", { textContent: "Updates elsewhere" }),
    behindRow("local", "This computer's Sidevoice ↻", "What the desktop app's local host says of its version: the page asks as it loads, so it loads again (the Desktop app view only)",
      localBehind(world), (behind) => {
        if (setLocalBehind(world, behind) && params.view === "app") reload?.();
      }),
    el("p", { className: "note elsewhere-local-state", textContent: localUpdateLine(world, params.view) }),
    behindRow("remote", "A remote machine", "What the first paired machine answers at /api/host/status: the page asks it again now",
      remoteBehind(world), (behind) => {
        const id = setRemoteBehind(world, behind);
        if (!id) return;
        const actions = frame?.contentWindow?.sidevoiceActions;
        if (typeof actions?.loadMachineInfo === "function") void Promise.resolve(actions.loadMachineInfo(identities[id].fingerprint)).catch(() => {});
        else elsewhereNote.textContent = "The page cannot be asked to look again now: it asks once the machine connects.";
      }),
    el("p", { className: "note elsewhere-remote-state", textContent: remoteUpdateLine(world) }),
    elsewhereNote);
  root.replaceChildren(
    header,
    el("div", { className: "card-body" },
      el("label", {}, "Scenario", select(scenarios.map((s) => ({ value: s.id, label: s.title })), scenario.id, (id) => pick({ scenario: id }))),
      el("p", { className: "summary", textContent: scenario.summary }),
      el("div", { className: "row" }, "View", segmented(Object.keys(VIEW_LABELS), VIEW_LABELS, params.view, (view) => pick({ view }))),
      el("div", { className: "row" }, "Language", segmented(Object.keys(LANGUAGE_LABELS), LANGUAGE_LABELS, params.language, (language) => pick({ language }))),
      [...groups].map(([group, options]) => el("fieldset", {},
        el("legend", { textContent: group }),
        options.map((option) => el("label", {},
          option.reload ? `${option.label} ↻` : option.label,
          select(option.values, world.choices[option.id], (value) => choose(option.id, value)))),
      )),
      conversationSection,
      avatarSection,
      cardStatesSection,
      updaterSection,
      updatesElsewhereSection,
      voiceSection,
      devicesSection,
      machines.length ? el("fieldset", {},
        el("legend", { textContent: "Pairing codes" }),
        el("label", {}, "Code", select(CODE_VARIANTS.map((v) => ({ value: v, label: VARIANT_LABELS[v] })), variant, (v) => {
          variant = v;
          root.dataset.variant = v;
        })),
        machines.map(codeRow), note) : null,
      el("div", { className: "row" }, "Time", segmented(Object.keys(SPEED_LABELS).map(Number), SPEED_LABELS, params.speed, speed)),
      el("label", { className: "check", title: "A reload, a view, a language or a ↻ option keeps where the page is: what it stored, the machines paired. Restart scenario starts over." },
        el("input", { type: "checkbox", checked: keeping, onchange: (event) => keep(event.target.checked) }), "Keep state on reload"),
      el("div", { className: "actions" },
        el("button", { type: "button", textContent: "Restart scenario", title: "Starts the scenario over, the page's storage cleared (what was kept too)", onclick: restart }),
        el("button", { type: "button", textContent: "Copy link", onclick: () => navigator.clipboard.writeText(location.href) }),
        el("button", { type: "button", textContent: "Reset options", onclick: clear }),
        el("button", { type: "button", textContent: "Reset preview", title: "Clears what this browser keeps for the preview, and starts it over",
          onclick: () => location.assign("/preview-reset") })),
      el("details", { className: "activity" },
        el("summary", { textContent: `What the mocks were asked (${world.activity.length})` }),
        el("ol", {}, world.activity.slice(-12).reverse().map((a) =>
          el("li", { textContent: `${a.method} ${shortUrl(a.url)} → ${a.status}` })))),
    ),
  );
}

/** The desktop app's updater, in a line: its mode, its state, its error. A development build has none. */
function updaterLine(world) {
  if (!hasAppUpdater(world)) return `A ${world.state.app?.channel} build has no updater: pick a release or nightly build to try it.`;
  const status = updaterStatus(world);
  const progress = status.state === "downloading" ? ` ${Math.round((status.progress ?? 0) * 100)}%` : "";
  return `${updaterMode(world) === "manual" ? "Manual" : "Automatic"} · app ${appVersion(world)} · ${status.state}${status.version ? ` ${status.version}` : ""}${progress}${status.error ? ` · ${status.error.code}` : ""}.`;
}

/** This computer's Sidevoice, in a line: what the app's local host says of its version (`version()`), and what keeps its
 *  row from the page in `view`. */
export function localUpdateLine(world, view = "app") {
  const local = world.state.local;
  if (!local) return "No Sidevoice on this computer here: the Desktop app view gives every scenario one.";
  const installed = local.version ?? LOCAL_VERSION, bundled = local.bundledVersion ?? LOCAL_VERSION;
  const said = local.update === "available" ? `behind: the app bundles ${bundled}` : `${local.update ?? "current"} (the app bundles ${bundled})`;
  // The page offers its Update where the app updates itself: a release, and a nightly with its updater (#69).
  const why = view !== "app" ? " Seen in the Desktop app view only."
    : local.state !== "running" ? " Not running: install or start it in the page for its row."
    : !hasAppUpdater(world) ? ` A ${world.state.app?.channel} build offers no update of it: pick a release or nightly build.` : "";
  return `${installed}, ${said}.${why}`;
}

/** The first paired machine's Sidevoice, in a line: what its status answers, and whether the page can ask it. */
export function remoteUpdateLine(world) {
  const id = firstPaired(world.state);
  if (!id) return "No machine is paired yet: pair one in the page.";
  const machine = world.state.machines[id];
  const { version, update } = hostStatus(machine);
  const said = update ? `${version ?? "no version"}, behind: ${update.latest}` : `${version ?? "no version"}, current`;
  const why = machine.reach === "direct" || machine.reach === "room" ? "" : " It does not answer now: the page asks once it does.";
  return `${machine.host ?? id}: ${said}.${why}`;
}

/** The app's updater brought up to date with the world: its mode's button on (the page may have set it), its line. */
function refreshUpdater(root, world) {
  const line = root.querySelector(".updater-state");
  if (line) line.textContent = updaterLine(world);
  for (const button of root.querySelectorAll(".updater-mode button")) button.classList.toggle("on", button.textContent === MODE_LABELS[updaterMode(world)]);
}

/** The "Updates elsewhere" rows brought up to date with the world: which value each has on, and what it says. */
function refreshElsewhere(root, world) {
  const lines = [["local", localBehind(world), localUpdateLine(world, root.dataset.view)], ["remote", remoteBehind(world), remoteUpdateLine(world)]];
  for (const [key, behind, line] of lines) {
    for (const button of root.querySelectorAll(`.elsewhere-${key} .segmented button`)) {
      button.classList.toggle("on", button.textContent === BEHIND_LABELS[behind ? "behind" : "current"]);
    }
    const state = root.querySelector(`.elsewhere-${key}-state`);
    if (state) state.textContent = line;
  }
}

/** Where the page's call and the mocked voice are, in a line. */
function voiceLine(world) {
  const call = liveCall(world);
  const where = call ? `In a call ${call.thread ? `on ${call.title ?? call.thread}` : "on no conversation"}. ` : "";
  const state = world.voiceRuntime?.state;
  if (!state?.started) return `${where}The page's voice is not listening.`;
  return `${where}Listening: ${state.listening}${state.recognising ? ", transcribing" : ""}${state.playback !== "idle" ? `, speaking (${state.playback})` : ""}.`;
}

/** Brings the list of what the mocks were asked up to date, leaving the rest of the card as it is. */
export function updateActivity(root, world) {
  const voice = root.querySelector(".voice-state");
  if (voice) voice.textContent = voiceLine(world);
  refreshUpdater(root, world);
  refreshElsewhere(root, world);
  const list = root.querySelector(".activity ol");
  if (!list) return;
  root.querySelector(".activity summary").textContent = `What the mocks were asked (${world.activity.length})`;
  list.replaceChildren(...world.activity.slice(-12).reverse().map((a) => el("li", { textContent: `${a.method} ${shortUrl(a.url)} → ${a.status}` })));
}

function shortUrl(url) {
  return String(url).replace(/^(?:https|wss):\/\/([a-z0-9-]+)\.machines\.sidevoice\.example/, "[$1]")
    .replace(/^(?:https|wss):\/\/room\.sidevoice\.example/, "[room]").replace(/^(?:http|ws):\/\/127\.0\.0\.1:47123/, "[local]");
}

/** Sample lines for the conversation's buttons. */
export const CONVERSATION_SAMPLES = {
  user: ["Can you run the tests and tell me what fails?", "Make the dark theme a little warmer.", "Yes, go ahead and push it.",
    // A long dictated turn, to see how long sent text shows (its pages).
    "Okay, so here's what I'd like you to do next. First, go through the settings pane and check that every toggle still " +
    "saves when you change it, because I think the one for automatic updates stopped doing that after yesterday's refactor. " +
    "Then look at the transcript on a phone: the bubbles get really cramped when the keyboard is open, and I'd like them to " +
    "breathe a bit more. And when you're done with both, run the whole test suite, push it on a branch, and tell me what " +
    "failed before you try to fix anything."],
  agent: [
    "I ran the tests: two fail in the settings pane, both about the Save button that no longer exists. Shall I update them?",
    "Done. The dark theme is a little warmer now; have a look and tell me if it is too much.",
    "Pushed. CI is running, and I will tell you as soon as it is green.",
  ],
};

/** A sample as its option shows it: a long one by its start and its length, so the card keeps its width. */
export function sampleLabel(text) {
  return text.length <= 60 ? text : `${text.slice(0, 44).trimEnd()}… (long, ${text.length} characters)`;
}

let simulated = 0;
/** The page's store and the conversation it shows, in a call as far as the page can tell: the facts the room sets. */
function pageConversation(frame) {
  const store = frame?.contentWindow?.sidevoiceUI?.store;
  if (!store) return null;
  const state = store.getState();
  const thread = state.facts.viewedThread || state.facts.roomBinding?.thread_id || state.participants?.[0]?.threadId;
  if (!thread) return null;
  if (!state.facts.sessionId) store.patch({ sessionId: "preview-session", ws: state.facts.ws || { readyState: 3, send() {}, close() {} } });
  return { store, thread, session: store.getState().facts.sessionId };
}
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long a simulated turn listens (the same whatever is said, as the voice speaks), and how long until it is sent
 *  (listening, then transcribing). */
const LISTENING_MS = SPEAKING_MS;
const SPOKEN_TURN_MS = LISTENING_MS + 900;

/**
 * While a simulated turn listens, the microphone the page reads speaks: its waveform (`sidevoiceAudio.readWaveform`,
 * when the page has no voice of its own to read) and its meter (`sidevoiceUI.micLevel`) follow `speechLevel`, so the
 * bars move as a real voice's do. Returns what stops it.
 */
function speakIntoPage(frame, seed) {
  const win = frame?.contentWindow;
  const audio = win?.sidevoiceAudio;
  let level = 0;
  if (audio && !audio.previewWrapped) {
    const own = audio.readWaveform.bind(audio);
    audio.readWaveform = () => own() ?? (audio.previewLevel ? samplesAt(audio.previewLevel) : null);
    audio.previewWrapped = true;
  }
  const started = Date.now();
  const timer = setInterval(() => {
    level = speechLevel(Date.now() - started, seed);
    if (audio) audio.previewLevel = level;
    win?.sidevoiceUI?.micLevel?.publish?.(Math.round(level * 100));
  }, 50);
  return () => {
    clearInterval(timer);
    if (audio) audio.previewLevel = 0;
    win?.sidevoiceUI?.micLevel?.publish?.(0);
  };
}

/** Samples whose loudness the page reads as `level` (its 60 dB window: `waveColumn`). */
function samplesAt(level) {
  const amplitude = 10 ** ((level * 60 - 60) / 20);
  return Float32Array.from({ length: 256 }, (_, i) => (i % 2 ? amplitude : -amplitude));
}
/** "You speak twice": the second turn, said this long after the first is sent (inside its moment on the stage). */
const AGAIN_SAMPLE = "Oh, and keep the old one as a fallback.";
const AGAIN_AFTER_MS = 700;

/** You speak: listening, then transcribing, then what you said in the conversation. */
function simulateUser(frame, text) {
  const page = pageConversation(frame);
  if (!page) return false;
  const { store, thread, session } = page;
  const segment = "preview-you-" + ++simulated;
  void (async () => {
    store.patch({ userLive: true, userTurn: { id: segment, segment, thread }, pendingPhase: "listening", pendingUserText: "" });
    const quiet = speakIntoPage(frame, simulated * 1.7);
    await later(LISTENING_MS);
    quiet();
    store.patch({ userLive: false, pendingPhase: "transcribing" });
    await later(SPOKEN_TURN_MS - LISTENING_MS);
    const history = store.getState().facts.history;
    store.patch({ userTurn: null, pendingPhase: "", history: [...history, { segment, thread, session, role: "user", text, name: "", time: Date.now(), seq: history.length + 1 }] });
  })();
  return true;
}

/** The agent speaks: its reply in the conversation, its voice playing it word by word (the karaoke), then done. */
function simulateAgent(frame, text) {
  const page = pageConversation(frame);
  if (!page) return false;
  const { store, thread, session } = page;
  const segment = "preview-agent-" + ++simulated;
  const name = store.getState().participants?.find((row) => row.threadId === thread)?.title ?? "";
  const words = [...text.matchAll(/\S+/g)].map((match) => match.index + match[0].length);
  const set = (audio) => store.patch({ history: store.getState().facts.history.map((r) => r.segment === segment ? { ...r, audio } : r) });
  void (async () => {
    const history = store.getState().facts.history;
    store.patch({ history: [...history, { segment, thread, session, role: "assistant", text, name, time: Date.now(), seq: history.length + 1, audio: "playing" }],
      botLive: true, karaokeState: { segment, from: 0, to: 0 } });
    for (const end of words) {
      await later(260);
      store.patch({ karaokeState: { segment, from: 0, to: end } });
    }
    await later(400);
    set("played");
    store.patch({ botLive: false, karaokeState: null });
  })();
  return true;
}

/** How long "Agent working" keeps the agent busy before it answers. */
const WORKING_MS = 5000;

/** The agent working for a few seconds, then idle again (the card then has it answer). */
function simulateWorking(frame) {
  const page = pageConversation(frame);
  if (!page) return false;
  const { store, thread } = page;
  store.patch({ harness: { ...store.getState().facts.harness, [thread]: true } });
  setTimeout(() => store.patch({ harness: { ...store.getState().facts.harness, [thread]: false } }), WORKING_MS);
  return true;
}
