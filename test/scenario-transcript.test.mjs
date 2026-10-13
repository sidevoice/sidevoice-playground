import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMockScenarios } from "../preview/proxy.mjs";
import { createWorld } from "../preview/mock/world.mjs";
import { LOCAL_ID, LOCAL_URL, answer, directUrl, makeIdentities } from "../preview/mock/machines.mjs";

/* The scenarios the operator uses start with a transcript to read in the conversation on top of the machine in use:
 * six messages, both sides, one long, one naming a command or a file. The card's "Transcript" empties it, and a
 * Restart starts it seeded again: it is the scenario's world, not something the page was given once. */
const instant = { tick: () => new Promise((r) => setImmediate(r)) };
const PAGE = "https://preview.example";
const SEEDED = { "room-ready": ["nuc", "sidevoice-web"], "paired-machines": ["nuc", "sidevoice-web"], "desktop-local-host": [LOCAL_ID, "sidevoice-core"] };

/** A world for `scenario` with `chosen`, and how to read machine `id`'s history in it as the page does. */
async function room(scenario, id, chosen = {}) {
  const world = createWorld(scenario, chosen, instant);
  const identities = await makeIdentities(world.state);
  const url = `${id === LOCAL_ID ? LOCAL_URL : directUrl(id)}/api/presentation/history`;
  const history = async () => {
    const response = await answer(world, identities, { pageOrigin: PAGE, url, headers: { authorization: `Bearer ${identities[id].token}` } });
    assert.equal(response.status, 200);
    return response.body.messages;
  };
  return { world, history };
}

for (const [id, [machine, title]] of Object.entries(SEEDED)) {
  test(`${id} starts with a transcript in ${title}, and the card empties it`, async () => {
    const scenario = (await loadMockScenarios()).find((s) => s.id === id);
    assert.ok(scenario, id);
    assert.equal(scenario.options.find((o) => o.id === "transcript").values[0].value, "seeded");
    const seeded = await room(scenario, machine);
    const messages = await seeded.history();
    const thread = messages.find((m) => m.name === title)?.thread;
    const said = messages.filter((m) => m.thread === thread);
    assert.equal(said.length, 6);
    assert.deepEqual(said.map((m) => m.role), ["user", "assistant", "user", "assistant", "user", "assistant"]);
    assert.ok(said.every((m) => m.role === "user" ? m.name === "You" : m.name === title));
    assert.ok(said.some((m) => m.text.length > 300), "a long one");
    assert.ok(said.some((m) => /npm run build|cargo test/.test(m.text) && /\w\/\w+\.\w+/.test(m.text)), "a command and a path");
    assert.deepEqual(said.map((m) => m.time), said.map((m) => m.time).sort((a, b) => a - b), "oldest first");

    assert.deepEqual(await (await room(scenario, machine, { transcript: "empty" })).history(), []);
    // Chosen on a world whose room is already made (the page reloads for it): the room leaves them out too.
    assert.equal(seeded.world.choose("transcript", "empty"), true, "the page reloads for it");
    assert.deepEqual(await seeded.history(), []);
  });
}
