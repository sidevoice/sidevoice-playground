import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../preview/mock/world.mjs";
import { loadIdentities, makeIdentities, saveIdentities } from "../preview/mock/machines.mjs";
import { KEEP_KEY, keeping, mergeSeed, restorable, snapshotOf } from "../preview/mock/shell.mjs";

const scenario = { id: "s", title: "S", summary: "s", world: { machines: { nuc: { host: "NUC", paired: true } } }, options: [] };
const storage = (items) => ({ getItem: (key) => items[key] ?? null });

test("identities saved and loaded again sign as before", async () => {
  const identities = await makeIdentities(scenario.world);
  const back = await loadIdentities(JSON.parse(JSON.stringify(await saveIdentities(identities))));
  assert.deepEqual(Object.keys(back), Object.keys(identities));
  const { privateKey, ...rest } = back.nuc;
  const { privateKey: _, ...was } = identities.nuc;
  assert.deepEqual(rest, was);
  const data = new TextEncoder().encode("nonce");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, data);
  const publicKey = await crypto.subtle.importKey("spki", Buffer.from(identities.nuc.publicKey, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, data));
});

test("reloads keep the state unless it was turned off", () => {
  assert.equal(keeping(storage({})), true);
  assert.equal(keeping(storage({ [KEEP_KEY]: "on" })), true);
  assert.equal(keeping(storage({ [KEEP_KEY]: "off" })), false);
  assert.equal(keeping({ getItem() { throw new Error("denied"); } }), true);
});

test("a snapshot restores only at the address and scenario it was taken at", () => {
  const world = createWorld(scenario);
  world.patch({ "machines.nuc.revoked": true });
  const text = JSON.stringify(snapshotOf(world, { nuc: {} }, "?s=s&lang=es"));
  assert.equal(restorable(text, "s", "?s=s&lang=es").state.machines.nuc.revoked, true);
  assert.equal(restorable(text, "s", "?s=s"), null);
  assert.equal(restorable(text, "other", "?s=s&lang=es"), null);
  assert.equal(restorable(null, "s", ""), null);
  assert.equal(restorable("{not json", "s", ""), null);
});

test("a view, language or ↻ option changes only what the world owns of the page's storage", () => {
  const mine = { fp: "mine", host: "Paired in the page" };
  const current = {
    "sidevoice.onboarding": JSON.stringify({ version: 1, basics_done: true }),
    "sidevoice.pairings": JSON.stringify({ in_use: "mine", pairings: [mine, { fp: "nuc", host: "old" }] }),
    "sidevoice.settings": JSON.stringify({ ui_language: "en", theme: "dark" }),
    "sidevoice.local-host-selected": "true",
    "sidevoice.provider-key.openai": "sk-old",
    "sidevoice.voice": "{}",
  };
  const seeded = {
    "sidevoice.onboarding": JSON.stringify({ version: 1, completed_at: 1 }),
    "sidevoice.pairings": JSON.stringify({ in_use: "nuc", pairings: [{ fp: "nuc", host: "NUC" }] }),
    "sidevoice.settings": JSON.stringify({ ui_language: "es" }),
  };
  const { set, remove } = mergeSeed(current, seeded);
  assert.equal(set["sidevoice.onboarding"], undefined, "the page's progress stays");
  assert.deepEqual(JSON.parse(set["sidevoice.pairings"]), { in_use: "nuc", pairings: [mine, { fp: "nuc", host: "NUC" }] });
  assert.deepEqual(JSON.parse(set["sidevoice.settings"]), { theme: "dark", ui_language: "es" });
  assert.deepEqual(remove.sort(), ["sidevoice.local-host-selected", "sidevoice.provider-key.openai"]);
  assert.equal("sidevoice.voice" in set || remove.includes("sidevoice.voice"), false);

  // A language back to the system's drops it; settings left empty go.
  const back = mergeSeed({ "sidevoice.settings": JSON.stringify({ ui_language: "es" }) }, {});
  assert.deepEqual(back, { set: {}, remove: ["sidevoice.settings"] });
  // What the page does not have yet comes from the world as it is.
  assert.deepEqual(mergeSeed({}, seeded).set["sidevoice.onboarding"], seeded["sidevoice.onboarding"]);
});
