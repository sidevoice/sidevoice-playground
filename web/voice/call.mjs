// What the Voice section makes of what it lists and of what the call says, with no DOM: the voice builds to pick, the
// choices a stage offers, the call's `VoiceConfig` (sidevoice-voice src/config.rs), the reply this page sends as the
// room (`voice-reply`, src/room.rs) and how a reply reads while it sounds (`karaoke`).

import { buildText } from "../engine/choices.mjs";

/**
 * The voice module's builds to pick from what /voice-builds lists (engine-builds.mjs): its open pull requests, then
 * its branches, each as the git ref /voice-build loads. A pull request whose head has no build loads the latest
 * earlier commit that has one, when there is one.
 */
export function voiceChoices({ pulls = [], branches = [] } = {}) {
  const pull = pulls.map((pr) => {
    const fallback = pr.build.state !== "available" ? pr.fallback : null;
    const behind = fallback ? ` (loads ${fallback.sha.slice(0, 7)}, ${fallback.behind} behind)` : "";
    return {
      value: fallback ? fallback.sha : `pull/${pr.number}/head`,
      label: `#${pr.number} ${pr.title}${behind}`,
      detail: [`by ${pr.author}`, `${pr.head.label} @ ${pr.head.sha.slice(0, 7)}`, pr.draft && "draft", buildText(pr.build)]
        .filter(Boolean)
        .join(" · "),
      usable: pr.build.state === "available" || Boolean(fallback),
    };
  });
  const branch = branches.map((b) => ({
    value: b.name,
    label: `branch ${b.name}`,
    detail: `Head ${b.sha.slice(0, 7)}: loads the voice CI's build of that commit, if it has one.`,
    usable: true,
  }));
  return [...pull, ...branch];
}

/** The engine's models that serve `capability` ("vad", "stt", "tts"), as `{ value, label }`. */
export function modelsFor(catalog, capability) {
  return (catalog ?? [])
    .filter((model) => (model.capabilities ?? []).includes(capability))
    .map((model) => ({ value: model.id, label: model.installed ? `${model.id} (installed)` : model.id }));
}

/** The voices of the engine's model `id`, as `{ value, label }`. */
export function voicesOf(catalog, id) {
  const model = (catalog ?? []).find((candidate) => candidate.id === id);
  return (model?.voices ?? []).map((voice) => ({
    value: voice.id,
    label: voice.languages?.length ? `${voice.id} (${voice.languages.join(", ")})` : voice.id,
  }));
}

/**
 * The call's `VoiceConfig` from what is picked: the stages by model id (the engine picks each build), the end of
 * turn and the patience. An empty language or voice is the model's own choice.
 */
export function voiceConfig({ vad, stt, language, tts, voice, endOfTurn, patience }) {
  if (!vad || !stt || !tts) throw new Error("pick a model for voice activity, speech to text and text to speech");
  return {
    vad: { model: vad },
    stt: { model: stt, language: language?.trim() || null },
    tts: { model: tts, voice: voice || null },
    end_of_turn: endOfTurn,
    patience,
  };
}

/**
 * The room's `voice-reply` for `text`, as this page sends it: reply `number` of the conversation, at the room revision
 * of the turn it answers.
 */
export function reply(text, { number, revision, language = null }) {
  const id = `playground-${number}`;
  return {
    type: "voice-reply",
    data: { utterance_id: id, revision, reply_revision: number, thread_id: "playground", history_id: id, text, language },
  };
}

/**
 * A reply as it reads while it sounds: what was heard (`heard_chars`), what is sounding now (`sounding`, a
 * `[from, to)` range, when the call says) and the rest. The call counts characters as Unicode scalar values.
 */
export function karaoke(text, { heard_chars: heard = 0, sounding = null }) {
  const chars = Array.from(text);
  const [from, to] = sounding ?? [heard, heard];
  const start = Math.min(Math.max(from, heard), chars.length);
  const end = Math.min(Math.max(to, start), chars.length);
  const part = (a, b) => chars.slice(a, b).join("");
  return { heard: part(0, start), sounding: part(start, end), rest: part(end) };
}

/** A line for the turns log from a `voice-user-turn` message's data. */
export function turnLine(turn) {
  const said = turn.text ? `: “${turn.text}”` : "";
  const took = turn.timings ? ` (${Object.entries(turn.timings).map(([k, v]) => `${k} ${v} ms`).join(", ")})` : "";
  return `${turn.phase}${turn.merged ? " (merged)" : ""}${said}${took}`;
}
