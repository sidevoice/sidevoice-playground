import { test } from "node:test";
import assert from "node:assert/strict";
import { branchInput, engineAbilities, engineChoices } from "../web/engine/choices.mjs";
import { parseSpec } from "../web/engine/spec.mjs";

const SHA = "efa1d6d42715ed713605fb009f72538e90c6cfc7";
const listed = {
  releases: [
    { tag: "nightly", prerelease: true, published: "2026-10-07T18:44:21Z" },
    { tag: "v0.2.0", prerelease: false, published: "2026-10-01T09:00:00Z" },
    { tag: "v0.3.0-rc.1", prerelease: true, published: "2026-10-05T09:00:00Z" },
  ],
  latest: { tag: "v0.2.0", published: "2026-10-01T09:00:00Z" },
  pulls: [
    {
      number: 41, title: "feat(web): the transformers.js backend", author: "rubasace", draft: false,
      head: { label: "sidevoice:feat/web", sha: SHA }, build: { state: "available", expires: "2026-10-14T10:00:00Z" },
    },
    {
      number: 37, title: "chore(spike): MLX", author: "someone", draft: true,
      head: { label: "fork:spike/mlx", sha: SHA }, build: { state: "expired", expires: "2026-10-02T10:00:00Z" },
    },
    { number: 13, title: "chore(main): release 0.2.0", author: "github-actions[bot]", draft: false,
      head: { label: "sidevoice:release-please", sha: SHA }, build: { state: "none" } },
  ],
  branches: [{ name: "main", sha: SHA }, { name: "0.2.0", sha: SHA }],
};
const pairs = (list) => list.map((c) => [c.value, c.label]);

test("versions: the local build when there is one, nightly, latest naming its release, then every release", () => {
  const { version } = engineChoices({ local: { label: "local build (#41 @ efa1d6d)", version: "0.1.0", sha256: "ab".repeat(32) }, ...listed });
  assert.deepEqual(pairs(version), [
    ["local", "local build (#41 @ efa1d6d)"],
    ["nightly", "nightly"],
    ["latest", "latest release (v0.2.0)"],
    ["v0.2.0", "v0.2.0"],
    ["v0.3.0-rc.1", "v0.3.0-rc.1 (pre-release)"],
  ]);
  assert.deepEqual(version.map((c) => c.detail), [
    "version 0.1.0 · sha256 abababababab · the build this server was started with",
    "The latest green main, published 2026-10-07.",
    "The newest published release, v0.2.0, published 2026-10-01.",
    "Release v0.2.0, published 2026-10-01.",
    "Pre-release v0.3.0-rc.1, published 2026-10-05.",
  ]);
});

test("pull requests by number and title, with author, head and whether their CI build is there; branches by name", () => {
  const { pull, branch } = engineChoices(listed);
  assert.deepEqual(pairs(pull), [
    ["#41", "#41 feat(web): the transformers.js backend"],
    ["#37", "#37 chore(spike): MLX"],
    ["#13", "#13 chore(main): release 0.2.0"],
  ]);
  assert.equal(pull[0].detail, "by rubasace · sidevoice:feat/web @ efa1d6d · CI build available until 2026-10-14");
  assert.match(pull[1].detail, / · draft · CI build expired on 2026-10-02/);
  assert.match(pull[2].detail, /no CI build/);
  assert.deepEqual(pull.map((c) => c.state), ["available", "expired", "none"]);
  // The commit a native build is made at.
  assert.deepEqual([...pull, ...branch].map((c) => c.sha), Array(5).fill(SHA));
  assert.deepEqual(pairs(branch), [["main", "main"], ["https://github.com/sidevoice/sidevoice-engine/tree/0.2.0", "0.2.0"]]);
});

test("every choice loads by what spec.mjs reads it as", () => {
  const all = Object.values(engineChoices(listed)).flat();
  for (const { value } of all) if (value !== "local") assert.doesNotThrow(() => parseSpec(value), value);
  assert.deepEqual(parseSpec("#41"), { kind: "ref", ref: "pull/41/head", label: "#41" });
  for (const name of ["main", "feat/web", "0.2.0", "nightly", "latest", "efa1d6d"]) {
    assert.equal(parseSpec(branchInput(name)).ref, name, name);
  }
});

test("before anything is listed: nightly and latest, and no pull requests or branches yet; no release says so", () => {
  const before = engineChoices();
  assert.deepEqual(pairs(before.version), [["nightly", "nightly"], ["latest", "latest release"]]);
  assert.equal(before.pull, undefined);
  assert.equal(before.branch, undefined);
  const none = engineChoices({ latest: null, pulls: [], branches: [] });
  assert.deepEqual(none.version[1], { value: "latest", label: "latest release (none yet)", detail: "No release is published yet.", state: "none" });
  assert.deepEqual(none.pull, []);
});

test("an engine without the model interface says it cannot speak or transcribe", () => {
  assert.equal(engineAbilities(["backends", "models", "install", "uninstall", "load"]).usable, true);
  const old = engineAbilities(["backends", "offers"]);
  assert.equal(old.usable, false);
  assert.match(old.text, /cannot speak or transcribe here: its WebEngine exposes backends, offers/);
});
