// Three looks, one attribute. The choice is kept in `chrome.storage.local`
// beside the other settings so every page and the popup agree, and it is
// applied before first paint by `applyStoredTheme()` at the top of each page.
import { glyphs } from "./dom.js";
import { openMenu } from "./menu.js";

export const THEMES = [
  { id: "system", label: "Follow the system", glyph: "palette" },
  { id: "light", label: "Light", glyph: "sun" },
  { id: "dark", label: "Dark", glyph: "moon" },
  { id: "mocha", label: "Catppuccin Mocha", glyph: "palette" },
];

const KEYS = { theme: "theme" };
/** The synchronous mirror the head script reads before the first paint. */
const MIRROR = "foflow-theme";

/** Puts a theme on the document. `system` removes the attribute. */
export function applyTheme(theme) {
  const root = document.documentElement;
  try {
    if (theme === "system") localStorage.removeItem(MIRROR);
    else localStorage.setItem(MIRROR, theme);
  } catch {
    // No mirror: the next page falls back to the system for one paint.
  }
  if (theme === "light" || theme === "dark" || theme === "mocha") {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
  root.dataset.themeChoice = theme;
}

/** The icon of the theme in force, for the toolbar button. */
export function themeGlyph(theme) {
  const chosen =
    theme === "system"
      ? globalThis.matchMedia?.("(prefers-color-scheme: light)")?.matches
        ? "light"
        : "dark"
      : theme;
  return chosen === "light" ? glyphs.sun : glyphs.moon;
}

/**
 * Applies the stored theme as early as possible. Each page loads this with
 * `theme-boot.js` in its head; that classic script reads the mirror and sets
 * the attribute before the body is even parsed.
 */
export async function applyStoredTheme() {
  try {
    const stored = await chrome.storage.local.get(KEYS.theme);
    applyTheme(typeof stored?.[KEYS.theme] === "string" ? stored[KEYS.theme] : "system");
  } catch {
    // No storage yet on a first run: the system decides.
    applyTheme("system");
  }
}

/** Keeps an open tab in step with a change made in another one. */
export function watchTheme(onChange) {
  const onStorage = (changes, area) => {
    if (area !== "local" || !(KEYS.theme in changes)) return;
    const next = changes[KEYS.theme].newValue ?? "system";
    applyTheme(next);
    onChange?.(next);
  };
  const onMirror = (event) => {
    if (event.key !== MIRROR) return;
    const next = event.newValue ?? "system";
    onChange?.(next);
  };
  chrome.storage.onChanged.addListener(onStorage);
  // The same change reaches the other pages of this extension through the
  // mirror, which is updated in the same tick.
  globalThis.addEventListener?.("storage", onMirror);
  return () => {
    chrome.storage.onChanged.removeListener?.(onStorage);
    globalThis.removeEventListener?.("storage", onMirror);
  };
}

export async function setTheme(theme) {
  const value = THEMES.some((entry) => entry.id === theme) ? theme : "system";
  applyTheme(value);
  await chrome.storage.local.set({ [KEYS.theme]: value });
  return value;
}

/**
 * The theme button: an icon that opens the choices. It reads the current
 * choice from storage each time, so it is right after any other page changed
 * it, and it is the same control on every surface.
 */
export function themeButton({ onchange } = {}) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "icon-button theme-button";
  node.setAttribute("aria-label", "Theme");
  node.setAttribute("title", "Theme");
  node.setAttribute("aria-haspopup", "menu");
  node.setAttribute("aria-expanded", "false");

  const draw = (choice) => {
    node.replaceChildren(themeGlyph(choice)());
  };
  draw(document.documentElement.dataset.themeChoice ?? "system");

  let current = document.documentElement.dataset.themeChoice ?? "system";
  node.addEventListener("click", async () => {
    const stored = await chrome.storage.local.get(KEYS.theme).catch(() => ({}));
    current = typeof stored?.[KEYS.theme] === "string" ? stored[KEYS.theme] : "system";
    openMenu(node, {
      align: "end",
      label: "Theme",
      items: THEMES.map((entry) => ({
        id: entry.id,
        label: entry.label,
        checked: entry.id === current,
        onselect: async () => {
          current = await setTheme(entry.id);
          draw(current);
          onchange?.(current);
        },
      })),
    });
  });

  const release = watchTheme((next) => {
    current = next;
    draw(next);
    onchange?.(next);
  });
  node.addEventListener("foflow:dispose", release, { once: true });
  node.dispose = release;

  return node;
}
