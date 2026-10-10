// The mocked preview's card: a panel over the page that is plainly not the product, shown and hidden with its
// header (or Alt+Shift+P). It picks the scenario, the view, the language and the scenario's options; gives pairing
// codes for the machines, to paste into the page; sets how fast the world's time runs; and lists what the mocks
// were asked. Rendered again whole on each change: it is small.

import { CODE_VARIANTS, LOCAL_ID, mintCode } from "./machines.mjs";

const VIEW_LABELS = { browser: "Browser", app: "Desktop app", phone: "Phone" };
const LANGUAGE_LABELS = { "": "System", es: "Español", en: "English" };
const SPEED_LABELS = { 1: "×1", 4: "×4", 0: "Pause" };
const VARIANT_LABELS = {
  valid: "valid", expired: "expired", used: "already used", plaintext: "plain http only", damaged: "damaged", impostor: "another machine answers",
};

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

function segmented(values, labels, current, pick) {
  return el("div", { className: "segmented" }, values.map((value) =>
    el("button", { type: "button", textContent: labels[value], className: value === current ? "on" : "", onclick: () => pick(value) }),
  ));
}

function select(values, current, pick) {
  const node = el("select", { onchange: () => pick(node.value) }, values.map(({ value, label }) => new Option(label, value, false, value === current)));
  return node;
}

/** Puts `code` in the page's pairing field, as typing it would, if the field is open. */
function paste(frame, code) {
  const field = frame.contentDocument?.getElementById("device-pairing-code");
  if (!field) return false;
  const setter = Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLTextAreaElement.prototype, "value").set;
  setter.call(field, code);
  field.dispatchEvent(new frame.contentWindow.Event("input", { bubbles: true }));
  field.focus();
  return true;
}

export function renderCard(root, { scenarios, scenario, world, identities, params, open, count, frame, toggle, pick, choose, speed, restart, clear }) {
  root.classList.toggle("closed", !open);
  const header = el("button", { type: "button", className: "card-header", onclick: toggle, title: "Alt+Shift+P" },
    el("strong", { textContent: "PREVIEW" }), count ? el("span", { className: "count", textContent: String(count) }) : null,
    el("span", { className: "chevron", textContent: open ? "▾" : "▸" }));
  if (!open) return root.replaceChildren(header);

  const groups = new Map();
  for (const option of scenario.options) {
    if (!groups.has(option.group)) groups.set(option.group, []);
    groups.get(option.group).push(option);
  }
  const machines = [
    ...Object.entries(world.state.machines ?? {}).map(([id, m]) => ({ id, host: m.host })),
    ...(world.state.local?.state === "running" ? [{ id: LOCAL_ID, host: `${world.state.local.computerName ?? "This computer"} (local host)` }] : []),
  ];
  let variant = root.dataset.variant || "valid";
  const note = el("p", { className: "note" });
  const codeRow = (machine) => el("div", { className: "code-row" },
    el("span", { textContent: machine.host }),
    el("button", { type: "button", textContent: "Paste", title: "Into the page's pairing field (open it first)", onclick: () => {
      const code = mintCode(world, identities, machine.id, variant);
      note.textContent = paste(frame, code) ? "" : "Open the page's pairing dialog first, or copy the code.";
    } }),
    el("button", { type: "button", textContent: "Copy", onclick: async () => {
      await navigator.clipboard.writeText(mintCode(world, identities, machine.id, variant));
      note.textContent = "Copied.";
    } }));

  root.replaceChildren(
    header,
    el("div", { className: "card-body" },
      el("label", {}, "Scenario", select(scenarios.map((s) => ({ value: s.id, label: s.title })), scenario.id, (id) => pick({ scenario: id }))),
      el("p", { className: "summary", textContent: scenario.summary }),
      el("div", { className: "row" }, "View", segmented(Object.keys(VIEW_LABELS), VIEW_LABELS, params.view, (view) => pick({ view }))),
      el("div", { className: "row" }, "Language", segmented(Object.keys(LANGUAGE_LABELS), LANGUAGE_LABELS, params.language, (language) => pick({ language }))),
      [...groups].map(([group, options]) => el("fieldset", {},
        el("legend", { textContent: group }),
        options.map((option) => el("label", {},
          option.reload ? `${option.label} ↻` : option.label,
          select(option.values, world.choices[option.id], (value) => choose(option.id, value)))),
      )),
      machines.length ? el("fieldset", {},
        el("legend", { textContent: "Pairing codes" }),
        el("label", {}, "Code", select(CODE_VARIANTS.map((v) => ({ value: v, label: VARIANT_LABELS[v] })), variant, (v) => {
          variant = v;
          root.dataset.variant = v;
        })),
        machines.map(codeRow), note) : null,
      el("div", { className: "row" }, "Time", segmented(Object.keys(SPEED_LABELS).map(Number), SPEED_LABELS, params.speed, speed)),
      el("div", { className: "actions" },
        el("button", { type: "button", textContent: "Restart scenario", onclick: restart }),
        el("button", { type: "button", textContent: "Copy link", onclick: () => navigator.clipboard.writeText(location.href) }),
        el("button", { type: "button", textContent: "Reset options", onclick: clear })),
      el("details", { className: "activity" },
        el("summary", { textContent: `What the mocks were asked (${world.activity.length})` }),
        el("ol", {}, world.activity.slice(-12).reverse().map((a) =>
          el("li", { textContent: `${a.method} ${shortUrl(a.url)} → ${a.status}` })))),
    ),
  );
}

/** Brings the list of what the mocks were asked up to date, leaving the rest of the card as it is. */
export function updateActivity(root, world) {
  const list = root.querySelector(".activity ol");
  if (!list) return;
  root.querySelector(".activity summary").textContent = `What the mocks were asked (${world.activity.length})`;
  list.replaceChildren(...world.activity.slice(-12).reverse().map((a) => el("li", { textContent: `${a.method} ${shortUrl(a.url)} → ${a.status}` })));
}

function shortUrl(url) {
  return String(url).replace(/^https:\/\/([a-z0-9-]+)\.machines\.sidevoice\.example/, "[$1]").replace("https://room.sidevoice.example", "[room]")
    .replace("http://127.0.0.1:47123", "[local]");
}
