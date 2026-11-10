// The recommender the design sheet shows, as a pure function: the example catalogue and an example device in, the
// ranked models, the recommendation and each family's own pick out. No DOM, so a test can hold it to the rules decided
// with Rubén (briefs/night-2026-11-10-handover/POINT-7-RECOMMENDER.md, "The pipeline, written out"). It is NOT the
// engine's code: the engine owns the real one (sidevoice-engine#124, core#33); this replicates the rules for the preview.
//
//   candidate = a (model, build) pair, resolved on the device: the engine runs there, on which class of hardware, and
//   why not when it does not.
//   HARD filters (a candidate that fails any cannot run here; a model with none left is disabled, with why):
//     1. build allowed here   the backend is in this build of the engine on this device
//     2. GPU builds off       where the device allows none (iPhone, until sidevoice-engine#154); said with the app's own
//                             «necesita un acelerador que este dispositivo no tiene» (build-accelerator)
//     3. fits memory          its memory is within the budget (60 %) of the memory it runs on
//   SOFT filter (a model that fails stays selectable, but is never recommended): the person's language is one of its own.
//   ORDER BY, one sort, first criterion decides:  comfortable (hint) > quality (hand-written list) > accelerator class
//   (desktop: GPU > neural engine > CPU; mobile: CPU first) > catalogue order.
//   JOINT choice: the (transcription i, voice j) closest to (1st, 1st) that fits the budget together with the end-of-turn
//   model: minimise i + j, tie → the better transcription.
import { BUDGET, CATALOGUE, COMFORTABLE_ON, DEVICES, QUALITY, TURN_MB } from "./recommender-data.mjs";

/** A language's primary subtag, lower-case ("en-US" → "en"): languages are compared by it (model-languages.ts). */
export const languagePrimary = (tag) => tag.split(/[-_]/)[0].toLowerCase();
/** Whether `wanted` is one of `tags`' languages; an empty list says nothing against it (model-languages.ts). */
export const languageSupported = (tags, wanted) => !tags.length || tags.some((tag) => languagePrimary(tag) === languagePrimary(wanted));
/** `tags` with `front`'s languages first, in `front`'s order, the engine's order kept within each group (model-languages.ts). */
export function orderLanguages(tags, front) {
  const primaries = [...new Set(front.filter(Boolean).map(languagePrimary))];
  const first = primaries.flatMap((primary) => tags.filter((tag) => languagePrimary(tag) === primary));
  return [...first, ...tags.filter((tag) => !primaries.includes(languagePrimary(tag)))];
}
/** A family as people read it: its id with a capital ("whisper" → "Whisper"; VoiceSettings.tsx). */
export const familyName = (family) => family.charAt(0).toUpperCase() + family.slice(1);

/** The memory budget of a device for the whole voice set, in MB. */
export const budgetMb = (device) => device.memoryMb * BUDGET;

const CLASS_ORDER = { desktop: { gpu: 0, "neural-engine": 1, cpu: 2 }, mobile: { cpu: 0, "neural-engine": 1, gpu: 2 } };
const classRank = (device, hardware) => CLASS_ORDER[device.mobile ? "mobile" : "desktop"][hardware] ?? 9;

/** A build as it resolves on `device`: where it runs, and the reasons (codes) it does not, in the order the filters ran. */
export function resolveBuild(model, spec, device) {
  const id = `${model.id}/${spec.backend}-${spec.precision}`;
  const place = device.engines[spec.backend];
  const reasons = [];
  if (!place) reasons.push("backend-not-in-this-build");
  else if (place.class === "gpu" && !device.gpuBuilds) reasons.push("build-accelerator"); // the app's closest existing reason: GPU builds are not offered here
  if (place && spec.memoryMb > budgetMb(device)) reasons.push("memory");
  const comfortOn = COMFORTABLE_ON[model.id] ?? COMFORTABLE_ON.default;
  return {
    id, backend: spec.backend, precision: spec.precision, memoryMb: spec.memoryMb, downloadMb: spec.downloadMb, available: reasons.length === 0, reasons,
    acceleratorClass: place?.class ?? null, accelerator: place?.accelerator ?? null, comfortable: !!place && comfortOn.includes(place.class),
  };
}

/** The builds of a model by the order of preference on `device`: those that run first, then comfortable, then the
 *  accelerator class, then the catalogue's order (the sort is stable). */
function orderedBuilds(device, builds) {
  return [...builds].sort((a, b) => Number(b.available) - Number(a.available) || Number(b.comfortable) - Number(a.comfortable)
    || classRank(device, a.acceleratorClass) - classRank(device, b.acceleratorClass));
}

/** Why a model that does not run here does not: the distinct reasons of its builds that the engine could have run here
 *  (a build whose engine is not in this app is left out of it, unless nothing else is there). Today the app says only the
 *  first build's. */
function unfitReasons(builds) {
  const native = builds.filter((build) => !build.reasons.includes("backend-not-in-this-build"));
  return [...new Set((native.length ? native : builds).flatMap((build) => build.reasons))];
}

/**
 * Every model of `task` as it stands on `device` for a person who speaks `language`, best first: those that can be
 * recommended, then those that cannot (not recommended: soft), then those that cannot run here (hard, last).
 * @returns {{ models: object[], recommendable: string[] }}
 */
export function rank(task, device, language) {
  const quality = QUALITY[task];
  const models = CATALOGUE.filter((model) => model.capabilities.includes(task)).map((model) => {
    const builds = orderedBuilds(device, model.builds.map((spec) => resolveBuild(model, spec, device)));
    const best = builds.find((build) => build.available) ?? null;
    const q = quality.indexOf(model.id);
    return {
      id: model.id, family: model.family, languages: model.languages, index: model.index, builds, best, available: !!best,
      reasons: best ? [] : unfitReasons(builds), soft: !languageSupported(model.languages, language),
      comfortable: !!best?.comfortable, quality: q < 0 ? quality.length + model.index : q,
    };
  });
  const key = (model) => [Number(!model.available), Number(model.soft), Number(!model.comfortable), model.quality, classRank(device, model.best?.acceleratorClass), model.index];
  models.sort((a, b) => { const [ka, kb] = [key(a), key(b)]; for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  return { models, recommendable: models.filter((model) => model.available && !model.soft).map((model) => model.id) };
}

/**
 * The recommendation of both slots, jointly: the pair of (transcription i, voice j) closest to the first of each that
 * fits the budget with the end-of-turn model. With nothing recommendable in a slot the best that runs stands in (a small
 * model rather than nothing); with no pair that fits, the first of each.
 * @returns {{ stt: string | null, tts: string | null }}
 */
export function recommend(device, language) {
  const lists = Object.fromEntries(["stt", "tts"].map((task) => {
    const { models, recommendable } = rank(task, device, language);
    const ids = recommendable.length ? recommendable : models.filter((model) => model.available).map((model) => model.id);
    return [task, ids.map((id) => models.find((model) => model.id === id))];
  }));
  const set = budgetMb(device) - TURN_MB;
  let pick = null;
  lists.stt.forEach((stt, i) => lists.tts.forEach((tts, j) => {
    if (stt.best.memoryMb + tts.best.memoryMb > set) return;
    if (!pick || i + j < pick.sum || (i + j === pick.sum && i < pick.i)) pick = { i, j, sum: i + j, stt, tts };
  }));
  const first = { stt: lists.stt[0] ?? null, tts: lists.tts[0] ?? null };
  return { stt: (pick?.stt ?? first.stt)?.id ?? null, tts: (pick?.tts ?? first.tts)?.id ?? null };
}

/** Each family of `task`'s ranking, the recommended's first: its models in the order of the ranking, its own pick (the
 *  best of them that runs here, a recommendable one before a soft one), and whether it runs here at all. */
export function families(ranking, recommended) {
  const out = [];
  for (const model of ranking.models) {
    let family = out.find((each) => each.id === model.family);
    if (!family) out.push(family = { id: model.family, models: [], pick: null, available: false, recommended: false });
    family.models.push(model);
  }
  for (const family of out) {
    family.pick = family.models.find((model) => model.available)?.id ?? null;
    family.available = !!family.pick;
    family.recommended = family.models.some((model) => model.id === recommended);
  }
  // The recommended one first, then those that run here by their best model's place in the ranking (the order they first
  // appear in), then those that do not.
  const runs = out.filter((family) => family.available);
  return [...runs.filter((family) => family.recommended), ...runs.filter((family) => !family.recommended), ...out.filter((family) => !family.available)];
}

/** Everything a screen needs for `task` on `device` in `language`: the ranking, the recommended model, the families. */
export function evaluate(task, deviceId, language) {
  const device = DEVICES[deviceId];
  const ranking = rank(task, device, language);
  const pair = recommend(device, language);
  const recommended = pair[task];
  return { device, ranking, recommended, models: ranking.models, families: families(ranking, recommended), byId: Object.fromEntries(ranking.models.map((model) => [model.id, model])) };
}
