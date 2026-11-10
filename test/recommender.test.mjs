// The model recommender design sheet: its rules are the ones decided with Rubén (POINT-7), its example data stays inside
// what the catalogue says, every string it shows has a key, and the page is served beside the shell with every file it loads.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MOCK_FILE, RECOMMENDER_PATH, mockFile } from "../preview/proxy.mjs";
import * as data from "../preview/mock/recommender-data.mjs";
import { BUDGET, CATALOGUE, COPY, DEVICES, DEVICE_IDS, QUALITY, TURN_MB } from "../preview/mock/recommender-data.mjs";
import { budgetMb, evaluate, languageSupported, orderLanguages, rank, recommend } from "../preview/mock/recommender-logic.mjs";
import { describeBuild, hardware, mb, sizeText } from "../preview/mock/recommender-format.mjs";

const order = (task, device, language) => evaluate(task, device, language).models.map((model) => model.id);
const model = (task, device, language, id) => evaluate(task, device, language).byId[id];

test("the recommendation per device: turbo only where it is comfortable (a graphics card), else Parakeet; Supertonic 3 for the voice", () => {
  assert.deepEqual([evaluate("stt", "mac", "es").recommended, evaluate("tts", "mac", "es").recommended], ["whisper-large-v3-turbo", "supertonic-3"]);
  for (const device of ["windows", "iphone"]) {
    assert.equal(evaluate("stt", device, "es").recommended, "parakeet-tdt-0.6b-v3", `${device}: turbo is not comfortable on a CPU`);
    assert.equal(evaluate("tts", device, "es").recommended, "supertonic-3");
  }
  assert.equal(model("stt", "mac", "es", "whisper-large-v3-turbo").best.acceleratorClass, "gpu");
  assert.equal(model("stt", "windows", "es", "whisper-large-v3-turbo").best.acceleratorClass, "cpu");
});

test("quality order: STT turbo > parakeet-v3 > qwen3-asr > whisper small/base/tiny; TTS Supertonic 3 > 2 > Kokoro > Piper", () => {
  assert.deepEqual(QUALITY.stt.slice(0, 4), ["whisper-large-v3-turbo", "parakeet-tdt-0.6b-v3", "qwen3-asr-0.6b", "whisper-small"]);
  assert.deepEqual(order("stt", "mac", "es").slice(0, 6), QUALITY.stt);
  assert.deepEqual(QUALITY.tts.slice(0, 4), ["supertonic-3", "supertonic-2", "kokoro-82m-v1.0", "piper-es_ES-carlfm-x_low"]);
  // Supertonic 2 only has the browser's build: in the apps it is hard-excluded, so the next of the order stands in.
  assert.deepEqual(order("tts", "mac", "es").slice(0, 3), ["supertonic-3", "kokoro-82m-v1.0", "piper-es_ES-carlfm-x_low"]);
});

test("a model not named in the quality order is ranked after those that are", () => {
  const ids = order("stt", "windows", "es");
  const named = QUALITY.stt.filter((id) => ids.includes(id));
  assert.deepEqual(ids.slice(0, 5), ["parakeet-tdt-0.6b-v3", "qwen3-asr-0.6b", "whisper-small", "whisper-base", "whisper-tiny"]);
  assert.ok(ids.indexOf("canary-180m-flash") > ids.indexOf(named.filter((id) => model("stt", "windows", "es", id).comfortable).at(-1)));
});

test("hard exclusions: memory, an engine not in this build, GPU builds on iPhone; each says why in the app's own words and is not recommendable", () => {
  const turbo = model("stt", "iphone", "es", "whisper-large-v3-turbo");
  assert.equal(turbo.available, false);
  assert.deepEqual(new Set(turbo.reasons), new Set(["memory", "build-accelerator"]));
  assert.ok(turbo.builds.some((build) => build.reasons.includes("build-accelerator") && build.acceleratorClass === "gpu"), "its GPU build is removed, not ranked lower");
  for (const code of turbo.reasons) assert.ok(COPY[`voice.unfit.${code}`], `the app already says ${code}`);
  for (const device of DEVICE_IDS) {
    const two = model("tts", device, "es", "supertonic-2");
    assert.equal(two.available, false);
    assert.deepEqual(two.reasons, ["backend-not-in-this-build"]);
  }
  for (const device of ["mac", "windows"]) assert.equal(model("stt", device, "es", "whisper-large-v3").available, true, `${device} has the memory for large-v3`);
  assert.equal(model("stt", "windows", "es", "whisper-large-v3-turbo").available, true, "no GPU builds is not a hard exclusion: the CPU builds run");
  for (const device of DEVICE_IDS) for (const language of ["es", "it"]) for (const task of ["stt", "tts"]) {
    const recommended = evaluate(task, device, language).byId[evaluate(task, device, language).recommended];
    assert.ok(recommended.available && !recommended.soft, `${device}/${language}/${task}: the recommendation runs here and speaks the language`);
  }
});

test("GPU builds are removed on iPhone and nowhere else; mobile prefers the CPU", () => {
  const gpu = (id) => DEVICES[id].gpuBuilds;
  assert.deepEqual(DEVICE_IDS.map(gpu), [true, true, false]);
  for (const task of ["stt", "tts"]) {
    for (const each of rank(task, DEVICES.iphone, "es").models.filter((m) => m.available)) assert.equal(each.best.acceleratorClass, "cpu", each.id);
  }
});

test("the language is a soft filter: the model stays selectable and available, and is never recommended", () => {
  const kokoro = model("tts", "mac", "it", "kokoro-82m-v1.0");
  assert.equal(kokoro.soft, true);
  assert.equal(kokoro.available, true);
  assert.equal(evaluate("tts", "mac", "it").recommended, "supertonic-3", "in Italian only Supertonic 3 can be recommended");
  assert.deepEqual(evaluate("tts", "mac", "it").ranking.recommendable, ["supertonic-3"]);
  assert.equal(model("stt", "mac", "es", "canary-180m-flash").soft, false);
  assert.equal(model("stt", "mac", "it", "canary-180m-flash").soft, true);
  assert.equal(model("tts", "mac", "es", "piper-en_US-ljspeech-medium").soft, true);
  // soft ones come after every recommendable one, and a hard exclusion after both
  const tts = evaluate("tts", "mac", "it").models;
  assert.deepEqual(tts.map((m) => (!m.available ? "hard" : m.soft ? "soft" : "ok")), ["ok", "soft", "soft", "soft", "hard"]);
});

test("each family has its own pick for the device; switching family never lands on a model that cannot run", () => {
  const family = (device, id) => evaluate("stt", device, "es").families.find((each) => each.id === id).pick;
  assert.equal(family("mac", "whisper"), "whisper-large-v3-turbo");
  assert.equal(family("windows", "whisper"), "whisper-small", "on a CPU the best Whisper that is comfortable is small, not turbo");
  assert.equal(family("iphone", "whisper"), "whisper-small");
  assert.equal(family("mac", "parakeet"), "parakeet-tdt-0.6b-v3");
  assert.equal(model("stt", "mac", "es", "parakeet-tdt-0.6b-v3").best.backend, "mlx", "on a Mac Parakeet's best build is MLX, on its graphics card");
  assert.equal(model("stt", "windows", "es", "parakeet-tdt-0.6b-v3").best.backend, "sherpa-onnx");
  for (const device of DEVICE_IDS) for (const task of ["stt", "tts"]) for (const each of evaluate(task, device, "es").families) {
    if (each.available) assert.ok(evaluate(task, device, "es").byId[each.pick].available);
    else assert.equal(each.pick, null);
  }
  // a family whose models are all soft still offers its best
  assert.equal(evaluate("tts", "mac", "it").families.find((each) => each.id === "piper").pick, "piper-es_ES-carlfm-x_low");
});

test("the recommended family comes first in the Familia list", () => {
  for (const device of DEVICE_IDS) assert.equal(evaluate("stt", device, "es").families[0].recommended, true);
});

test("the pair closest to (1st, 1st) that fits the budget with the end-of-turn model; a tie goes to the better transcription", () => {
  assert.equal(budgetMb(DEVICES.mac), 16384 * BUDGET);
  const device = (memoryMb) => ({ ...DEVICES.windows, memoryMb });
  // Parakeet 840 + Supertonic 3 190 + 50 = 1080: does not fit 1068; (Parakeet, Kokoro 170) and (Whisper small 470, Supertonic 3) both sum to 1: Parakeet wins.
  assert.equal(840 + 190 + TURN_MB > budgetMb(device(1780)), true);
  assert.deepEqual(recommend(device(1780), "es"), { stt: "parakeet-tdt-0.6b-v3", tts: "kokoro-82m-v1.0" });
  // Smaller still: Kokoro does not fit either with Parakeet; whisper-small + Supertonic 3 is the closest.
  assert.deepEqual(recommend(device(1600), "es"), { stt: "whisper-small", tts: "supertonic-3" });
  assert.deepEqual(recommend(DEVICES.windows, "es"), { stt: "parakeet-tdt-0.6b-v3", tts: "supertonic-3" });
});

test("the example catalogue is the engine's: native and browser builds, languages, sizes", () => {
  assert.equal(CATALOGUE.filter((m) => m.capabilities.includes("stt")).length, 9);
  assert.equal(CATALOGUE.filter((m) => m.capabilities.includes("tts")).length, 5);
  assert.equal(CATALOGUE.find((m) => m.id === "whisper-large-v3-turbo").builds.find((b) => b.backend === "whisper-cpp").memoryMb, 720);
  assert.equal(CATALOGUE.find((m) => m.id === "parakeet-tdt-0.6b-v3").builds.find((b) => b.backend === "mlx").memoryMb, 3110);
  assert.deepEqual(CATALOGUE.find((m) => m.id === "supertonic-2").builds.map((b) => b.backend), ["transformers-js"]);
  assert.equal(CATALOGUE.find((m) => m.id === "supertonic-3").languages.length, 31);
  assert.deepEqual(CATALOGUE.map((m) => m.index), CATALOGUE.map((_, i) => i));
});

test("language helpers as the app has them: by primary subtag, the interface's and the chosen one first", () => {
  assert.equal(languageSupported(["en-US", "es"], "es-ES"), true);
  assert.equal(languageSupported(["en-US"], "es"), false);
  assert.equal(languageSupported([], "es"), true, "a model that lists none says nothing against it");
  assert.deepEqual(orderLanguages(["en", "es", "it", "fr"], ["es", "it"]), ["es", "it", "en", "fr"]);
});

test("sizes and builds are said as the app says them", () => {
  assert.equal(sizeText(574e6), "574 MB");
  assert.equal(mb(3110), "3,1 GB");
  assert.equal(mb(1290), "1,3 GB");
  const mac = model("stt", "mac", "es", "whisper-large-v3-turbo").best;
  assert.equal(describeBuild(mac), "whisper.cpp · q5_0 · tarjeta gráfica (Metal)");
  assert.deepEqual(hardware(mac), { main: "GPU", name: "Metal" });
  assert.deepEqual(hardware(model("stt", "windows", "es", "parakeet-tdt-0.6b-v3").best), { main: "CPU", name: "" });
});

test("the sheet adds no word of its own to the screens: the only addition is the app's «Recomendado»", async () => {
  assert.equal("NEW_COPY" in data, false);
  assert.equal(COPY["runtime.recommended"], "Recomendado");
  assert.equal(COPY["voice.source.local"], "En este dispositivo");
  assert.equal(COPY["voice.family"], "Familia");
  assert.equal(COPY["voice.languages.unsupported"], "No admite {language}");
  assert.equal(COPY["runtime.notHere"], "No funciona aquí: {reasons}");
  const code = await readFile(new URL("../preview/mock/recommender.mjs", import.meta.url), "utf8");
  for (const gone of ["Volver a lo recomendado", "No disponibles aquí", "No recomendados", "soltura", "para este dispositivo", "tarjeta gráfica en este sistema", "NEW_COPY", "rec-new"]) {
    assert.equal(code.includes(gone), false, `${gone} is not on the sheet`);
  }
});

test("«Recomendado» is the app's tag, in two places only: the end of Modelo's label row, and the entry in the open list (compact, so it stays on one line)", async () => {
  assert.equal("REC_VARIANTS" in data, false, "no open decision is left");
  const code = await readFile(new URL("../preview/mock/recommender.mjs", import.meta.url), "utf8");
  assert.match(code, /isRecommended \? recommended\(\) : ""\)/, "the tag in the Field's aside, while the model shown is the recommended one");
  assert.match(code, /recommended\(true\)/, "its entry in the list wears the Badge's compact tag form");
  assert.match(code, /badge: family\.recommended \? recommended\(\) : ""/, "the recommended family, in the open Familia list");
  for (const gone of ["leading", "sparkle", "REC_VARIANTS", "data-rec", "matrix", "decision("]) assert.equal(code.includes(gone), false, `${gone} is gone`);
  const css = await readFile(new URL("../preview/mock/recommender.css", import.meta.url), "utf8");
  assert.equal(css.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr)"), false, "the Modelo column is not widened");
  assert.match(css, /text-overflow: ellipsis; white-space: nowrap/, "an entry stays on one line");
});

test("every key the page asks for exists", async () => {
  const code = await readFile(new URL("../preview/mock/recommender.mjs", import.meta.url), "utf8")
    + await readFile(new URL("../preview/mock/recommender-format.mjs", import.meta.url), "utf8");
  const keys = [...code.matchAll(/COPY\["([^"]+)"\]/g)].map((match) => match[1]);
  for (const key of keys) assert.ok(key in COPY, `COPY has ${key}`);
  for (const match of code.matchAll(/\bt\("([^"]+)"/g)) assert.ok(match[1] in COPY, `COPY has ${match[1]}`);
  assert.ok(keys.length > 20);
});

test("the sheet is served beside the shell, with every file it loads", async () => {
  const page = await mockFile(RECOMMENDER_PATH);
  assert.equal(page.type, "text/html; charset=utf-8");
  const html = String(page.body);
  const loaded = [...html.matchAll(/(?:href|src)="\/preview-mock\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(loaded.sort(), ["recommender-web.css", "recommender.css", "recommender.mjs"]);
  const imports = [...(await readFile(new URL("../preview/mock/recommender.mjs", import.meta.url), "utf8")).matchAll(/from "\.\/([^"]+)"/g)].map((match) => match[1]);
  for (const name of [...loaded, ...imports]) {
    assert.match(name, MOCK_FILE, `${name} is a file the shell may load`);
    assert.ok(await mockFile(`/preview-mock/${name}`), `${name} is served`);
  }
  assert.equal(await mockFile("/preview-mock/recommender.html"), null, "the page is its route's, not a file of mock/");
});

test("the sheet's styles are copies of the web's, with the typeface left where a web build serves it", async () => {
  const css = String((await mockFile("/preview-mock/recommender-web.css")).body);
  for (const path of ["styles/tokens.css", "components/ui/ui.css", "features/settings/model-prepare.css", "features/onboarding/onboarding.css"]) {
    assert.match(css, new RegExp(`COPIED from sidevoice-web@[0-9a-f]{40} apps/web/src/${path.replace(/[./]/g, "\\$&")} by scripts/recommender-styles\\.mjs`));
  }
  for (const rule of [".ui-select-item-reason", ".model-sheet", ".model-runtime-option", ".wizard-dialog", '[data-theme="dark"]']) assert.ok(css.includes(rule), rule);
  assert.ok(css.includes('url("/voice/fonts/DMSans-Variable-latin.woff2")'));
});
