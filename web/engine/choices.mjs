// The engine picker's choices, each with what it is and what loading it means, so the operator sees the state of a
// choice before loading it (sidevoice-playground#1). No DOM here.

export const OTHER = "other";

/**
 * @param {{ local?: { label: string } | null, releases?: { tag: string, prerelease: boolean }[] }} sources
 * @returns {{ value: string, label: string, hint: string }[]}
 */
export function engineChoices({ local = null, releases = [] } = {}) {
  const choices = [];
  if (local) {
    choices.push({ value: "local", label: local.label, hint: "The build this server was started with." });
  }
  choices.push(
    { value: "nightly", label: "nightly", hint: "The latest green main, from GitHub Releases." },
    { value: "latest", label: "latest release", hint: "The newest published release." },
  );
  for (const { tag, prerelease } of releases) {
    if (tag === "nightly") continue;
    choices.push({ value: tag, label: prerelease ? `${tag} (pre-release)` : tag, hint: `The release ${tag}.` });
  }
  choices.push({
    value: OTHER,
    label: "Other: a version, pull request, branch or commit…",
    hint: "A pull request, branch or commit loads the engine CI's build of its head commit (kept 7 days).",
  });
  return choices;
}

/** What the engine can do in this page, in words, from the methods its WebEngine exposes. */
export function engineAbilities(methods) {
  const modelInterface = ["models", "install", "load"].every((name) => methods.includes(name));
  return modelInterface
    ? { usable: true, text: "Speaks and transcribes: pick a model in the tabs below." }
    : {
        usable: false,
        text: `This build cannot speak or transcribe here: its WebEngine exposes ${methods.join(", ") || "nothing"}, not the model interface (models, install, load).`,
      };
}
