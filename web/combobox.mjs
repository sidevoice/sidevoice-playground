// Searchable selects: a <select> gets, beside it, a box that looks like one and opens onto its options under a filter
// (combobox/filter.mjs: case-insensitive, every word anywhere in the label). Arrow keys move, Enter picks, Escape and
// Tab close; opening puts the focus in the filter, and picking or Escape gives it back to the box.
//
// The <select> stays, hidden, and is still the one truth: the page's scripts fill it, read and set its value, disable
// it and listen for its change as before. The box follows it — its options, its value, its disabled state — and a pick
// sets its value and fires the input and change events a pick in the select itself would.

import { filterOptions, marks, move } from "./combobox/filter.mjs";

let made = 0;

const element = (tag, properties = {}, attributes = {}) => {
  const node = Object.assign(document.createElement(tag), properties);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
};

/** Makes `select` searchable; once. Its label's caption (`.label`) names the box and the list. */
export function searchable(select) {
  if (select.dataset.searchable) return;
  select.dataset.searchable = "1";
  const id = `combo-${++made}`;
  const label = select.closest("label");
  const caption = label?.querySelector(".label");
  if (caption && !caption.id) caption.id = `${id}-caption`;
  const named = caption ? { "aria-labelledby": caption.id } : {};

  // The box is a button after the select, so the select stays its label's control: a click on the caption focuses
  // the box (below) instead of opening it, and the forms' own buttons stay where their scripts look for them.
  const box = element("button", { type: "button", id: `${id}-box`, className: "combo-box" }, {
    "aria-haspopup": "listbox", "aria-expanded": "false", "aria-controls": `${id}-list`,
    ...(caption ? { "aria-labelledby": `${caption.id} ${id}-box` } : {}),
  });
  const text = element("span", { className: "combo-text" });
  box.append(text);
  const filter = element("input", { type: "text", className: "combo-filter", placeholder: "Filter…", autocomplete: "off", spellcheck: false }, {
    role: "combobox", "aria-autocomplete": "list", "aria-expanded": "true", "aria-controls": `${id}-list`,
    "aria-label": `Filter ${caption?.textContent.trim() || "the options"}`, autocapitalize: "off",
  });
  const list = element("ul", { id: `${id}-list`, className: "combo-list" }, { role: "listbox", ...named });
  const count = element("p", { className: "combo-count" }, { "aria-live": "polite" });
  const popup = element("div", { className: "combo-popup", hidden: true });
  popup.append(filter, list, count);
  const root = element("div", { className: "combo" });
  root.append(box, popup);
  select.classList.add("combo-source");
  select.after(root);

  /** The options the filter keeps, `{ label, index, disabled, title }` (`index` into the select's), and the one the
   * arrow keys are on. */
  let shown = [];
  let active = -1;
  const isOpen = () => !popup.hidden;

  /** The box as the select is; the list too, when open and the select's options changed under it. */
  function follow() {
    const picked = select.selectedOptions[0];
    text.textContent = box.title = picked?.label ?? "";
    box.disabled = select.disabled;
    if (select.disabled) close();
    if (!isOpen()) return;
    renderList();
    activate(shown[active] && !shown[active].disabled ? active : move(shown, -1, 1), false);
  }

  function renderList() {
    const query = filter.value;
    const all = [...select.options].map((option, index) => ({ label: option.label, index, disabled: option.disabled, title: option.title }));
    shown = filterOptions(all, query);
    list.replaceChildren(...shown.map((option, at) => {
      const item = element("li", { id: `${id}-option-${at}`, className: "combo-option", title: option.title }, {
        role: "option", "aria-selected": "false", "data-at": at, ...(option.disabled ? { "aria-disabled": "true" } : {}),
      });
      item.classList.toggle("current", option.index === select.selectedIndex);
      const name = element("span", { className: "combo-label" });
      name.append(...marks(option.label, query).map((part) => (part.match ? element("mark", { textContent: part.text }) : part.text)));
      item.append(name);
      return item;
    }));
    const words = query.trim();
    count.textContent = shown.length
      ? (words ? `${shown.length} of ${all.length}` : "")
      : (words ? `Nothing matches “${words}”.` : "Nothing to pick.");
  }

  /** Puts the arrow keys on the `at`th option shown (-1: none), scrolled into view unless the pointer put them there. */
  function activate(at, scroll = true) {
    active = at;
    for (const item of list.children) {
      const on = Number(item.dataset.at) === at;
      item.classList.toggle("active", on);
      item.setAttribute("aria-selected", String(on));
    }
    const item = list.children[at];
    if (item) {
      filter.setAttribute("aria-activedescendant", item.id);
      if (scroll) item.scrollIntoView({ block: "nearest" });
    } else {
      filter.removeAttribute("aria-activedescendant");
    }
  }

  /** Opens the list, `typed` already in the filter, the arrow keys on the picked option (on the first match if typed). */
  function open(typed = "") {
    if (select.disabled || isOpen()) return;
    filter.value = typed;
    popup.hidden = false;
    root.classList.add("open");
    box.setAttribute("aria-expanded", "true");
    renderList();
    // Upwards when the window has no room below the box for the list, and more above it.
    const room = root.getBoundingClientRect();
    const below = window.innerHeight - room.bottom;
    root.classList.toggle("up", below < popup.offsetHeight + 8 && room.top > below);
    const picked = shown.findIndex((option) => option.index === select.selectedIndex && !option.disabled);
    activate(typed || picked < 0 ? move(shown, -1, 1) : picked);
    filter.focus();
    filter.setSelectionRange(typed.length, typed.length);
  }

  function close(refocus = false) {
    if (!isOpen()) return;
    popup.hidden = true;
    root.classList.remove("open", "up");
    box.setAttribute("aria-expanded", "false");
    filter.removeAttribute("aria-activedescendant");
    if (refocus) box.focus();
  }

  function pick(option) {
    if (!option || option.disabled) return;
    close(true);
    if (select.selectedIndex === option.index) return;
    select.selectedIndex = option.index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Pressing the open box keeps the focus in the filter until the click closes it: Safari, which does not focus a
  // pressed button, would otherwise close it on the press and open it again on the click.
  box.addEventListener("mousedown", (event) => isOpen() && event.preventDefault());
  box.addEventListener("click", () => (isOpen() ? close(true) : open()));
  box.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open();
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the closed box opens it with what was typed in the filter.
      event.preventDefault();
      open(event.key);
    }
  });
  filter.addEventListener("input", () => {
    renderList();
    activate(move(shown, -1, 1));
  });
  filter.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activate(move(shown, active, event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault(); // nor does it submit the form the select is in
      pick(shown[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close();
    }
  });
  // A press in the list keeps the focus in the filter, and a click there is not passed on to the label's control.
  popup.addEventListener("mousedown", (event) => event.target !== filter && event.preventDefault());
  popup.addEventListener("click", (event) => event.target !== filter && event.preventDefault());
  list.addEventListener("click", (event) => pick(shown[Number(event.target.closest("li")?.dataset.at)]));
  list.addEventListener("pointermove", (event) => {
    const at = Number(event.target.closest("li")?.dataset.at);
    if (at >= 0 && at !== active && !shown[at].disabled) activate(at, false);
  });
  root.addEventListener("focusout", (event) => !root.contains(event.relatedTarget) && close());
  label?.addEventListener("click", (event) => !root.contains(event.target) && box.focus());

  // Following the select: its options, their labels and disabled states, its own disabled state (all in the DOM),
  // and its value, which the scripts set as a property: set through it, the box follows at once.
  new MutationObserver(follow).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
  for (const property of ["value", "selectedIndex"]) {
    const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, property);
    Object.defineProperty(select, property, {
      configurable: true,
      get: () => native.get.call(select),
      set: (value) => {
        native.set.call(select, value);
        follow();
      },
    });
  }
  select.addEventListener("change", follow);
  follow();
}
