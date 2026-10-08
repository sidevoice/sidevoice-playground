import { test } from "node:test";
import assert from "node:assert/strict";
import { engineAbilities, engineChoices, OTHER } from "../web/engine/choices.mjs";

test("the local build comes first when there is one; then nightly, latest, the releases, and Other", () => {
  const choices = engineChoices({
    local: { label: "local build (#41 @ efa1d6d)" },
    releases: [{ tag: "nightly", prerelease: true }, { tag: "v0.2.0", prerelease: false }, { tag: "v0.3.0-rc.1", prerelease: true }],
  });
  assert.deepEqual(choices.map((c) => [c.value, c.label]), [
    ["local", "local build (#41 @ efa1d6d)"],
    ["nightly", "nightly"],
    ["latest", "latest release"],
    ["v0.2.0", "v0.2.0"],
    ["v0.3.0-rc.1", "v0.3.0-rc.1 (pre-release)"],
    [OTHER, "Other: a version, pull request, branch or commit…"],
  ]);
  assert.ok(choices.every((c) => c.hint));
  assert.equal(engineChoices().at(0).value, "nightly");
});

test("an engine without the model interface says it cannot speak or transcribe", () => {
  assert.equal(engineAbilities(["backends", "models", "install", "uninstall", "load"]).usable, true);
  const old = engineAbilities(["backends", "offers"]);
  assert.equal(old.usable, false);
  assert.match(old.text, /cannot speak or transcribe here: its WebEngine exposes backends, offers/);
});
