// What the page shows of an engine's catalogue (`models()`), and the few numbers it prints: no DOM here, so it is
// tested in Node.

/** The models that do `capability` (`"stt"`, `"tts"`), in catalogue order. */
export function modelsFor(catalog, capability) {
  return catalog.filter((model) => model.capabilities.includes(capability));
}

/** The build to preselect: the recommended one when it runs here, else the first that does, else none. */
export function preferredBuild(model) {
  const runs = model.builds.filter((build) => build.available);
  return runs.find((build) => build.id === model.recommendedBuild) ?? runs[0] ?? null;
}

/** A model in a picker: its id, size, and whether anything of it runs here. */
export function modelLabel(model) {
  const runs = model.builds.some((build) => build.available);
  const marks = [model.installed && "installed", !runs && "no build runs in this browser"].filter(Boolean);
  return `${model.id} · ${model.parametersM} M params${marks.length ? ` (${marks.join(", ")})` : ""}`;
}

/** Why a build does not run here, from its reasons' codes and parameters. */
export function reasons(build) {
  return (build.reasons ?? [])
    .map((reason) => {
      const params = Object.entries(reason.params ?? {}).map(([key, value]) => `${key} ${value}`);
      return params.length ? `${reason.code} (${params.join(", ")})` : reason.code;
    })
    .join("; ");
}

/** What an install's progress callback says, in words. */
export function progressText({ files, done, received, size }) {
  const of = size ? ` of ${megabytes(size)}` : "";
  return `Downloading: ${done}/${files} files done, ${megabytes(received)}${of} received…`;
}

export function megabytes(bytes) {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/** An engine error rejects with an `Error` whose `code` is stable and whose `params` say more; others as they are. */
export function describeError(error) {
  if (error?.code === "cancelled") return "Cancelled.";
  if (error?.code) {
    const params = error.params && Object.keys(error.params).length ? ` ${JSON.stringify(error.params)}` : "";
    return `Engine error: ${error.code}${params} (the browser console may say more)`;
  }
  return String(error?.message ?? error);
}

/** Word error rate of `heard` against `said`: word edits over the words said, case and punctuation aside. */
export function wer(said, heard) {
  const words = (text) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const [a, b] = [words(said), words(heard)];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(previous[j] + 1, next[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return a.length ? previous[b.length] / a.length : b.length ? 1 : 0;
}

/** A picked build, spelled out under the pickers: what it is, what it costs, and whether it runs in this browser. */
export function buildInfo(model, build) {
  const what = [build.backend, build.precision, build.accelerator].filter(Boolean).join(" · ");
  const cost = `${megabytes(build.downloadBytes)} download · about ${build.memoryMb} MB in memory`;
  const runs = build.available ? "runs in this browser" : `does not run here: ${reasons(build)}`;
  const marks = [build.id === model.recommendedBuild && "recommended", build.installed && "installed"].filter(Boolean);
  return `${what} · ${cost} · ${runs}${marks.length ? ` · ${marks.join(", ")}` : ""}`;
}

/**
 * A model's family. sidevoice-engine's catalogue groups models in families (`catalog/families/<family>.json`), but
 * `models()` does not say which, up to #41 at least: until it does, the family is read from the model id, which in
 * every bundled family starts with the family's id and a hyphen (`whisper-tiny`, `kokoro-82m-v1.0`, `supertonic-2`).
 */
export function familyOf(model) {
  return model.family ?? model.id.split("-")[0];
}

/** The families with a model that does `capability`, each with those models, in catalogue order. */
export function familiesFor(catalog, capability) {
  const families = new Map();
  for (const model of modelsFor(catalog, capability)) {
    const family = familyOf(model);
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(model);
  }
  return [...families].map(([id, models]) => ({ id, models }));
}

/** A build in the Advanced list: what it is, and what it costs or why it does not run here. */
export function buildChoice(model, build) {
  const title = [build.backend, build.precision, build.accelerator].filter(Boolean).join(" · ");
  const marks = [build.id === model.recommendedBuild && "recommended", build.installed && "installed"].filter(Boolean);
  const detail = build.available
    ? `${megabytes(build.downloadBytes)} download · about ${build.memoryMb} MB in memory${marks.length ? ` · ${marks.join(", ")}` : ""}`
    : `Does not run here: ${reasons(build)}`;
  return { id: build.id, title, detail, available: build.available };
}
