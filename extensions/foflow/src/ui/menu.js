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
  document.removeEventListener("keydown", escape, true);
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

function escape(event) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeMenu();
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

  let left = align === "end" ? box.right - width : box.left;
  left = Math.min(Math.max(8, left), Math.max(8, viewportWidth - width - 8));
  let top = box.bottom + margin;
  if (top + height > viewportHeight - 8 && box.top - margin - height > 8) {
    top = box.top - margin - height;
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
  document.addEventListener("keydown", escape, true);
  window.addEventListener("resize", reposition, true);
  window.addEventListener("scroll", reposition, true);
  // The first item takes focus so the keyboard can walk the menu at once.
  node.querySelector(".menu-item")?.focus();
  return node;
}

/** Whether a menu is open against this trigger. */
export function isOpen(trigger) {
  return open !== null && open.trigger === trigger;
}
