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

test("in the app the native engine comes first, and Other offers no git refs", () => {
  const choices = engineChoices({
    native: { label: "native 0.1.0 @ 6ae37d1", version: "0.1.0", rev: "6ae37d12be4b28d30d7566ff9915bb3ac0122f54" },
    releases: [{ tag: "v0.2.0", prerelease: false }],
  });
  assert.deepEqual(choices.map((c) => [c.value, c.label]), [
    ["native", "native 0.1.0 @ 6ae37d1 (built into this app)"],
    ["nightly", "nightly"],
    ["latest", "latest release"],
    ["v0.2.0", "v0.2.0"],
    [OTHER, "Other: a version or a release link…"],
  ]);
  assert.match(choices[0].hint, /6ae37d12be4b28d30d7566ff9915bb3ac0122f54, compiled into this app: the version the app was built with/);
});

test("an engine without the model interface says it cannot speak or transcribe", () => {
  assert.equal(engineAbilities(["backends", "models", "install", "uninstall", "load"]).usable, true);
  const old = engineAbilities(["backends", "offers"]);
  assert.equal(old.usable, false);
  assert.match(old.text, /cannot speak or transcribe here: its WebEngine exposes backends, offers/);
});
