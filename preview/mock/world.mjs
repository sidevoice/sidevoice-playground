// The mocked preview's world: what every mock answers from. A scenario (scenarios/*.json) says what there is — the
// page's target, the room, the machines this device knows or could pair with, the desktop app's local host — and
// the options the card offers on top of it, each value a set of fields it changes (`"machines.nuc.reach": "room"`).
// An option marked `reload` changes what the page finds when it loads (its storage, the view): the page is loaded
// again for it. Any other one is live: the mocks read the world at their next answer, and listeners hear of it.
// No DOM here, and no clock but the one handed in, so it runs the same in the shell and in Node.

/** Sets `value` at the dotted `path` of `target`, making the objects on the way. */
export function deepSet(target, path, value) {
  const keys = path.split(".");
  let at = target;
  for (const key of keys.slice(0, -1)) {
    if (at[key] === null || typeof at[key] !== "object") at[key] = {};
    at = at[key];
  }
  at[keys.at(-1)] = structuredClone(value);
}

/** Whether `value` is a scenario: `id`, `title`, `summary`, a `world`, and well-formed `options`. */
export function validMockScenario(value) {
  return (
    !!value && typeof value === "object" &&
    typeof value.id === "string" && /^[a-z0-9-]+$/.test(value.id) &&
    typeof value.title === "string" && typeof value.summary === "string" &&
    !!value.world && typeof value.world === "object" &&
    Array.isArray(value.options) &&
    value.options.every((option) =>
      typeof option.id === "string" && typeof option.label === "string" && typeof option.group === "string" &&
      Array.isArray(option.values) && option.values.length > 0 &&
      option.values.every((v) => typeof v.value === "string" && typeof v.label === "string" && v.set && typeof v.set === "object"),
    )
  );
}

/** The choices that hold for `scenario`: `chosen` where it names a value the option has, else each one's first. */
export function choicesFor(scenario, chosen = {}) {
  return Object.fromEntries(
    scenario.options.map((option) => [
      option.id,
      option.values.some((v) => v.value === chosen[option.id]) ? chosen[option.id] : option.values[0].value,
    ]),
  );
}

/** The world's state for `scenario` with `choices`: its world, each chosen value's fields set over it. */
export function stateFor(scenario, choices) {
  const state = structuredClone(scenario.world);
  for (const option of scenario.options) {
    const value = option.values.find((v) => v.value === choices[option.id]);
    for (const [path, field] of Object.entries(value?.set ?? {})) deepSet(state, path, field);
  }
  return state;
}

/** How many options are not at their first value: what the card counts. */
export function changedCount(scenario, choices) {
  return scenario.options.filter((option) => choices[option.id] !== option.values[0].value).length;
}

/**
 * A world for `scenario`. `chosen` is the card's choices; `now` the clock; `tick` waits a step of real time
 * (replaceable for tests). Its `speed` scales every `delay` the mocks take (0 holds them).
 */
export function createWorld(scenario, chosen = {}, { now = () => Date.now(), tick = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const listeners = new Set();
  let choices = choicesFor(scenario, chosen);
  const world = {
    scenario,
    state: stateFor(scenario, choices),
    get choices() {
      return { ...choices };
    },
    speed: 1,
    now,
    /** What the mocks were asked lately, newest last: `{ at, method, url, status, mocked }`. */
    activity: [],
    /** Changes option `id` to `value`: whether the page must load again for it. */
    choose(id, value) {
      const option = scenario.options.find((o) => o.id === id);
      if (!option || !option.values.some((v) => v.value === value)) return false;
      choices = { ...choices, [id]: value };
      for (const [path, field] of Object.entries(option.values.find((v) => v.value === value).set)) deepSet(world.state, path, field);
      world.changed();
      return !!option.reload;
    },
    /** Sets fields of the state (what a mock's own action changes: a host started, a code used). */
    patch(fields) {
      for (const [path, value] of Object.entries(fields)) deepSet(world.state, path, value);
      world.changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    changed() {
      for (const listener of [...listeners]) listener(world);
    },
    /** Waits `ms` of the world's time: faster or slower with `speed`, held while it is 0. */
    async delay(ms) {
      let left = ms;
      while (left > 0) {
        const step = Math.min(50, left / (world.speed || 1));
        await tick(step);
        left -= step * world.speed;
      }
    },
    log(entry) {
      world.activity.push({ at: now(), ...entry });
      if (world.activity.length > 50) world.activity.shift();
      world.changed();
    },
  };
  return world;
}
