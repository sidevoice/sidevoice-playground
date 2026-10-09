// The engine picker's choices: one dropdown per kind (versions, open pull requests, branches), each choice with what
// it is and what loading it means, so the operator sees the state of a choice before loading it
// (sidevoice-playground#1). A choice's value is what the page loads it by: a name `spec.mjs` reads, or `local`. No
// DOM here.

import { ENGINE_REPO, parseSpec } from "./spec.mjs";

export const KINDS = ["version", "pull", "branch"];

/**
 * @typedef {{ value: string, label: string, detail: string, state?: "available" | "expired" | "none", sha?: string }} Choice
 */

/**
 * The choices of each dropdown. `latest` is the newest release when known, null when there is none, undefined until
 * listed; `pulls` and `branches` are undefined until listed.
 * @param {{ local?: { label: string, version?: string, sha256?: string } | null,
 *   releases?: { tag: string, prerelease: boolean, published?: string }[],
 *   latest?: { tag: string, published?: string } | null,
 *   pulls?: { number: number, title: string, author: string, draft: boolean, head: { label: string, sha: string },
 *     build: { state: "available" | "expired" | "none", expires?: string } }[],
 *   branches?: { name: string, sha: string }[] }} sources
 * @returns {{ version: Choice[], pull?: Choice[], branch?: Choice[] }}
 */
export function engineChoices({ local = null, releases = [], latest, pulls, branches } = {}) {
  const version = [];
  if (local) {
    const facts = [local.version && `version ${local.version}`, local.sha256 && `sha256 ${local.sha256.slice(0, 12)}`];
    version.push({
      value: "local",
      label: local.label,
      detail: [...facts, "the build this server was started with"].filter(Boolean).join(" · "),
    });
  }
  const nightly = releases.find((release) => release.tag === "nightly");
  version.push({ value: "nightly", label: "nightly", detail: `The latest green main${published(nightly)}.` });
  if (latest === null) {
    version.push({ value: "latest", label: "latest release (none yet)", detail: "No release is published yet.", state: "none" });
  } else {
    version.push({
      value: "latest",
      label: latest ? `latest release (${latest.tag})` : "latest release",
      detail: latest ? `The newest published release, ${latest.tag}${published(latest)}.` : "The newest published release.",
    });
  }
  for (const release of releases) {
    if (release.tag === "nightly") continue;
    version.push({
      value: release.tag,
      label: release.prerelease ? `${release.tag} (pre-release)` : release.tag,
      detail: `${release.prerelease ? "Pre-release" : "Release"} ${release.tag}${published(release)}.`,
    });
  }

  const pull = pulls?.map((pr) => ({
    value: `#${pr.number}`,
    label: `#${pr.number} ${pr.title}`,
    detail: [`by ${pr.author}`, `${pr.head.label} @ ${pr.head.sha.slice(0, 7)}`, pr.draft && "draft", buildText(pr.build)]
      .filter(Boolean)
      .join(" · "),
    state: pr.build.state,
    sha: pr.head.sha,
  }));
  const branch = branches?.map((b) => ({
    value: branchInput(b.name),
    label: b.name,
    detail: `Head ${b.sha.slice(0, 7)}: loads the engine CI's build of that commit, if it has one.`,
    sha: b.sha,
  }));
  return { version, pull, branch };
}

/** Whether a pull request's head commit has its CI build (`engine-npm-<sha>`), in words. */
export function buildText(build) {
  if (build.state === "available") return `CI build available until ${day(build.expires)}`;
  if (build.state === "expired") return `CI build expired on ${day(build.expires)}: re-run CI to build it again`;
  return "no CI build: CI has not run, is still running or failed";
}

/** What loads branch `name`: the name itself, unless spec.mjs would read it as something else (a version, `nightly`). */
export function branchInput(name) {
  try {
    const spec = parseSpec(name);
    if (spec.kind === "ref" && spec.ref === name) return name;
  } catch {
    // Not a name spec.mjs reads: its link is.
  }
  return `https://github.com/${ENGINE_REPO}/tree/${name}`;
}

function published(release) {
  return release?.published ? `, published ${day(release.published)}` : "";
}

function day(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : "an unknown date";
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
