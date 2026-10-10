// What the Web preview's pickers offer, from what the server lists (/preview/options, /engine-builds, /voice-builds).
// No DOM here, so it is tested in Node. Each choice is `{ value, label }`; `value` is what /preview/start takes.

/** The web: `main` first, then its releases, open pull requests and other branches. */
export function webChoices({ releases = [], pulls = [], branches = [] }) {
  const main = branches.find((b) => b.name === "main");
  return [
    ...(main ? [{ value: "main", label: `main @ ${main.sha.slice(0, 7)}` }] : []),
    ...releases.map((r) => ({ value: r.tag, label: `release ${r.tag}${r.prerelease ? " (pre-release)" : ""}` })),
    ...pulls.map((p) => ({ value: `pull/${p.number}/head`, label: `#${p.number} ${p.title}${p.draft ? " (draft)" : ""} @ ${p.sha.slice(0, 7)}` })),
    ...branches.filter((b) => b.name !== "main").map((b) => ({ value: b.name, label: `${b.name} @ ${b.sha.slice(0, 7)}` })),
  ];
}

/** A core or connector release: `preferred` (a tag, or `release` for the newest version) chosen first when there. */
export function archiveChoices(releases, preferred) {
  const choices = releases.map((r) => ({ value: r.tag, label: r.tag === "nightly" ? "nightly (main)" : r.tag }));
  const pick = preferred === "release" ? choices.find((c) => c.value !== "nightly") : choices.find((c) => c.value === preferred);
  return pick ? [pick, ...choices.filter((c) => c !== pick)] : choices;
}

/** An engine or voice CI build, for a pin npm does not have: none, or a release, a pull request with a build, a branch. */
export function buildChoices(listing) {
  if (!listing) return [{ value: "", label: "none" }];
  return [
    { value: "", label: "none" },
    ...(listing.releases ?? []).map((r) => ({ value: r.tag ?? r.name, label: `release ${r.tag ?? r.name}` })),
    ...(listing.pulls ?? []).filter((p) => p.build?.state === "available").map((p) => ({ value: `pull/${p.number}/head`, label: `#${p.number} ${p.title}` })),
    ...(listing.branches ?? []).map((b) => ({ value: b.name, label: `${b.name} @ ${b.sha.slice(0, 7)}` })),
  ];
}
