import { test } from "node:test";
import assert from "node:assert/strict";
import { karaoke, modelsFor, reply, turnLine, voiceChoices, voiceConfig, voicesOf } from "../web/voice/call.mjs";

const SHA = "efa1d6d42715ed713605fb009f72538e90c6cfc7";
const EARLIER = "0123456789abcdef0123456789abcdef01234567";

const catalog = [
  { id: "silero-vad", capabilities: ["vad"], installed: true },
  { id: "whisper-base", capabilities: ["stt"] },
  { id: "kokoro", capabilities: ["tts"], voices: [{ id: "af_heart", languages: ["en"] }, { id: "ef_dora", languages: [] }] },
];

test("the voice builds: open pull requests by their head, an earlier build when the head has none, then branches", () => {
  const pr = (number, build, fallback) => ({
    number, title: `pr ${number}`, author: "a", draft: false, head: { label: "x:y", sha: SHA }, build, fallback,
  });
  const choices = voiceChoices({
    pulls: [
      pr(7, { state: "available", expires: "2026-10-15T00:00:00Z" }),
      pr(8, { state: "none" }, { sha: EARLIER, behind: 2, expires: "2026-10-14T00:00:00Z" }),
      pr(9, { state: "none" }),
    ],
    branches: [{ name: "feat/web", sha: SHA }],
  });
  assert.deepEqual(choices.map((c) => [c.value, c.usable]), [
    ["pull/7/head", true], [EARLIER, true], ["pull/9/head", false], ["feat/web", true],
  ]);
  assert.match(choices[1].label, /loads 0123456, 2 behind/);
});

test("each stage offers the engine's models of its capability, and the TTS model's voices", () => {
  assert.deepEqual(modelsFor(catalog, "vad"), [{ value: "silero-vad", label: "silero-vad (installed)" }]);
  assert.deepEqual(modelsFor(catalog, "stt").map((m) => m.value), ["whisper-base"]);
  assert.deepEqual(modelsFor(null, "tts"), []);
  assert.deepEqual(voicesOf(catalog, "kokoro"), [{ value: "af_heart", label: "af_heart (en)" }, { value: "ef_dora", label: "ef_dora" }]);
  assert.deepEqual(voicesOf(catalog, "missing"), []);
});

test("the call's config names each stage's model, and leaves language and voice to the model when not picked", () => {
  const picked = { vad: "silero-vad", stt: "whisper-base", tts: "kokoro", endOfTurn: "silence", patience: "calm" };
  assert.deepEqual(voiceConfig({ ...picked, language: " es ", voice: "ef_dora" }), {
    vad: { model: "silero-vad" },
    stt: { model: "whisper-base", language: "es" },
    tts: { model: "kokoro", voice: "ef_dora" },
    end_of_turn: "silence",
    patience: "calm",
  });
  const plain = voiceConfig({ ...picked, language: "", voice: "" });
  assert.equal(plain.stt.language, null);
  assert.equal(plain.tts.voice, null);
  assert.throws(() => voiceConfig({ ...picked, vad: "" }), /pick a model/);
});

test("a reply is the room's voice-reply, numbered in the playground's one conversation", () => {
  assert.deepEqual(reply("Hi", { number: 3, revision: 12, language: "en" }), {
    type: "voice-reply",
    data: { utterance_id: "playground-3", revision: 12, reply_revision: 3, thread_id: "playground", history_id: "playground-3", text: "Hi", language: "en" },
  });
});

test("the karaoke splits a reply into heard, sounding and the rest, by Unicode characters", () => {
  assert.deepEqual(karaoke("Hola, ¿qué tal?", { heard_chars: 5, sounding: [5, 10] }), { heard: "Hola,", sounding: " ¿qué", rest: " tal?" });
  assert.deepEqual(karaoke("a😀b", { heard_chars: 2, sounding: null }), { heard: "a😀", sounding: "", rest: "b" });
  assert.deepEqual(karaoke("abc", { heard_chars: 9, sounding: [9, 12] }), { heard: "abc", sounding: "", rest: "" });
});

test("a turn reads as its phase, its words and its timings", () => {
  assert.equal(turnLine({ phase: "started" }), "started");
  assert.equal(
    turnLine({ phase: "finished", merged: true, text: "hola", timings: { audio_ms: 900, endpoint_silence_ms: 2500 } }),
    "finished (merged): “hola” (audio_ms 900 ms, endpoint_silence_ms 2500 ms)",
  );
});
