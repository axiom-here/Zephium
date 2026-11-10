// One menu, drawn for every trigger in the extension. It is appended to the
// body rather than to the trigger, so a card with its own overflow or a popup
// with a fixed width can never clip it, and it is placed against the trigger's
// box on open rather than left to the page's layout.
import { el } from "./dom.js";

let open = null;

/** Closes whatever menu is open, as a click elsewhere would. */
export function closeMenu() {
  if (open === null) return;
  const { node, onClose, trigger } = open;
  open = null;
  document.removeEventListener("pointerdown", outside, true);
  document.removeEventListener("keydown", keys, true);
  window.removeEventListener("resize", reposition, true);
  window.removeEventListener("scroll", reposition, true);
  node.remove();
  trigger?.setAttribute("aria-expanded", "false");
  onClose?.();
}

function outside(event) {
  if (open === null) return;
  if (open.node.contains(event.target) || open.trigger?.contains(event.target)) return;
  closeMenu();
}

/** Escape closes the menu and goes no further, so the page behind it does not
 *  also react to the key; the arrows walk the items, Home and End jump. */
function keys(event) {
  if (open === null) return;
  const items = [...open.node.querySelectorAll(".menu-item")];
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    const trigger = open.trigger;
    closeMenu();
    trigger?.focus();
    return;
  }
  if (items.length === 0) return;
  if (event.key === "Tab") {
    // Tabbing out closes the menu, as a native menu would.
    closeMenu();
    return;
  }
  const at = items.indexOf(document.activeElement);
  const move = (to) => {
    event.preventDefault();
    event.stopPropagation();
    items[(to + items.length) % items.length].focus();
  };
  if (event.key === "ArrowDown") move(at + 1);
  else if (event.key === "ArrowUp") move(at - 1);
  else if (event.key === "Home") move(0);
  else if (event.key === "End") move(items.length - 1);
}

function reposition() {
  if (open !== null) place(open.node, open.trigger, open.align);
}

/** Where a menu fits: below the trigger, above it when there is no room. */
function place(node, trigger, align) {
  const box = trigger.getBoundingClientRect();
  const width = node.offsetWidth;
  const height = node.offsetHeight;
  const margin = 6;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  // A long menu in a short popup scrolls rather than running off the screen.
  node.style.maxBlockSize = `${Math.max(120, viewportHeight - 16)}px`;
  const usable = Math.min(height, viewportHeight - 16);
  let left = align === "end" ? box.right - width : box.left;
  left = Math.min(Math.max(8, left), Math.max(8, viewportWidth - width - 8));
  let top = box.bottom + margin;
  const fitsBelow = top + usable <= viewportHeight - 8;
  const fitsAbove = box.top - margin - usable > 8;
  if (!fitsBelow && fitsAbove) {
    top = box.top - margin - usable;
  } else if (!fitsBelow && !fitsAbove) {
    // Neither side has room: take the larger one and scroll.
    top = box.top > viewportHeight - box.bottom ? Math.max(8, viewportHeight - usable - 8) : 8;
  }
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
}

/**
 * Opens a menu against `trigger`.
 *
 * @param {HTMLElement} trigger
 * @param {{ items: object[], align?: "start" | "end", label?: string, onClose?: () => void }} options
 *   items are `{ id, label, hint?, checked?, kind?, onselect? }`; `kind` may be
 *   "separator" or "label".
 */
export function openMenu(trigger, { items, align = "start", label, onClose }) {
  const already = open !== null && open.trigger === trigger;
  closeMenu();
  trigger.setAttribute("aria-expanded", "true");
  if (already) return null;

  const node = el("div", { class: "menu", role: "menu", "aria-label": label ?? null });
  for (const item of items) {
    if (item.kind === "separator") {
      node.append(el("div", { class: "menu-separator", role: "separator" }));
      continue;
    }
    if (item.kind === "label") {
      node.append(el("div", { class: "menu-label", text: item.label }));
      continue;
    }
    node.append(
      el(
        "button",
        {
          type: "button",
          class: "menu-item",
          role: item.checked === undefined ? "menuitem" : "menuitemradio",
          "aria-checked": item.checked === undefined ? null : String(item.checked),
          onclick: (event) => {
            event.stopPropagation();
            closeMenu();
            item.onselect?.();
          },
        },
        el("span", { class: "mark", "aria-hidden": "true" }),
        el("span", { class: "label", text: item.label }),
        item.hint ? el("span", { class: "hint", text: item.hint }) : null,
      ),
    );
  }

  document.body.append(node);
  place(node, trigger, align);
  open = { node, trigger, onClose, align };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", keys, true);
  window.addEventListener("resize", reposition, true);
  window.addEventListener("scroll", reposition, true);
  // The chosen item takes focus, so the keyboard starts at the current value.
  (node.querySelector('[aria-checked="true"].menu-item') ?? node.querySelector(".menu-item"))?.focus();
  return node;
}

/** Whether a menu is open against this trigger. */
export function isOpen(trigger) {
  return open !== null && open.trigger === trigger;
}
