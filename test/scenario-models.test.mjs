import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { desktopEngine, webEngine } from "../preview/mock/models.mjs";

/* The models a scenario starts with are its `defaults`' (the shared "installed" option seeded per scenario), as the
 * server hands the scenarios over: in the desktop app's catalogue and in the browser's alike. Desktop local host seeds
 * those in use and three not used for a while — what Settings › Advanced lists and Remove all offers. A server that
 * did not apply the defaults (one started before they were) would start every scenario on the first value: only the
 * speech detector. */
const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const IN_USE = ["kokoro-82m-v1.0", "silero-vad", "smart-turn-v3.2", "whisper-base"];
const NOT_IN_USE = ["kokoro-82m-v0.19", "whisper-large-v3-turbo", "whisper-small"];
const installed = (models) => models.filter((m) => m.builds.some((b) => b.installed)).map((m) => m.id).sort();

for (const id of ["desktop-local-host", "paired-machines"]) {
  test(`${id} starts with the seeded models installed, in the desktop app's catalogue and the browser's`, async () => {
    const scenario = (await loadMockScenarios()).find((s) => s.id === id);
    assert.ok(scenario, id);
    assert.equal("defaults" in scenario, false, "the server hands the scenario over with its defaults applied");
    assert.equal(scenario.options.find((o) => o.id === "installed").values[0].value, "seeded");
    const world = createWorld(scenario, {}, instant);
    const desktop = (await desktopEngine(world).catalogs()).find((c) => c.id === "local");
    assert.deepEqual(installed(desktop.models), [...IN_USE, ...NOT_IN_USE].sort());
    const browser = await webEngine(world, { credential: async () => null }).catalog("local").models();
    assert.deepEqual(installed(browser), [...IN_USE, ...NOT_IN_USE].sort());
    // Those not in use say when they were last used: 12, 45 and 120 days ago.
    const days = Object.fromEntries(desktop.models.filter((m) => NOT_IN_USE.includes(m.id)).map((m) => [m.id, Math.round((world.now() - m.lastUsedAt) / 86_400_000)]));
    assert.deepEqual(days, { "whisper-large-v3-turbo": 12, "kokoro-82m-v0.19": 45, "whisper-small": 120 });
  });
}
