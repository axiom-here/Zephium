// The surfaces as a person sees them: every page rendered with its real
// stylesheets in a DOM, at each theme, with the controls driven. This is the
// half that catches "the popup has no layout", "the dial is a black disc" and
// "there is no way back from settings".
//
//   npm install --no-save jsdom
//   node --test-force-exit --test extensions/foflow/test/ui.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { JSDOM, ROOT, open, settle, skip } from "./dom.mjs";

/** Declarations from every sheet on the page, for a selector and property. */
function declaration(document, selector, property) {
  return [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules];
      } catch {
        return [];
      }
    })
    .filter((rule) => rule.selectorText === selector && rule.style?.getPropertyValue(property))
    .map((rule) => rule.style.getPropertyValue(property));
}

test("the popup gets its own width and layout, not a bare document", { skip }, async () => {
  const { document } = await open("src/pages/popup/popup.html");
  assert.deepEqual(declaration(document, "body", "inline-size"), ["340px"]);
  assert.deepEqual(declaration(document, ".popup", "display"), ["grid"]);
  assert.deepEqual(declaration(document, ".stats", "display"), ["flex"]);
});

test("the focus dial is a ring, never a filled disc", { skip }, async () => {
  const { document } = await open("src/pages/popup/popup.html");
  const svg = document.querySelector(".dial svg");
  assert.ok(svg, "the dial draws an svg");
  assert.deepEqual([...svg.children].map((node) => node.tagName), ["circle", "circle"]);
  assert.equal(svg.querySelector(".track").getAttribute("fill"), null);
  // Both circles are unfilled by rule, which is what stops the black disc.
  assert.ok(declaration(document, ".focus .dial .track", "fill").includes("none"));
  assert.ok(declaration(document, ".focus .dial .arc", "fill").includes("none"));
});

test("every surface offers the theme and a way to the bigger one", { skip }, async () => {
  for (const page of ["src/pages/popup/popup.html", "src/pages/time/time.html"]) {
    const { document } = await open(page);
    assert.ok(document.querySelector("[aria-label=Theme]"), `${page} has the theme control`);
    assert.ok(document.querySelector("#head-actions, #toolbar-end"), `${page} has a toolbar end`);
  }
});

test("the Time page's back button and settings are both in the toolbar", { skip }, async () => {
  const { document } = await open("src/pages/time/time.html");
  const back = document.querySelector("#back");
  assert.ok(back, "a back button exists");
  assert.equal(back.getAttribute("aria-label"), "Back", "it is labelled for a screen reader");
  assert.ok(back.querySelector(".arrow svg"), "the arrow is drawn");
  assert.equal(document.querySelector("#toolbar-title").textContent.trim(), "Time");
  const end = document.querySelectorAll("#toolbar-end .icon-button");
  assert.equal(end.length, 2, "theme and settings");
  assert.ok(
    [...end].some((node) => node.getAttribute("aria-label") === "Theme"),
    "the theme is one of them",
  );
});

test("settings has a back button that returns to Time", { skip }, async () => {
  const { document } = await open("src/pages/options/options.html");
  const back = document.querySelector("#back");
  assert.ok(back);
  assert.match(back.textContent, /Time/u);
  assert.ok(document.querySelector("#toolbar-end .theme-button"));
});

test("the length menu is the extension's own, placed above the page", { skip }, async () => {
  const { document } = await open("src/pages/time/time.html");
  document.querySelector(".focus-length").click();
  await settle();
  const menu = document.querySelector("body > .menu");
  assert.ok(menu, "the menu is appended to the body, so nothing clips it");
  assert.deepEqual(
    [...menu.querySelectorAll(".menu-item .label")].map((node) => node.textContent),
    ["15 min", "25 min", "30 min", "45 min", "50 min", "60 min", "90 min", "Repeat with breaks"],
  );
  assert.ok(menu.style.left && menu.style.top, "it is placed against its trigger");
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
  await settle();
  assert.equal(document.querySelector("body > .menu"), null, "escape closes it");
});

test("a menu can be walked from the keyboard, and escape leaves it", { skip }, async () => {
  const { document, window } = await open("src/pages/options/options.html");
  const chooser = document.querySelectorAll(".select-trigger")[1];
  chooser.click();
  await settle();
  const focused = () => document.activeElement.textContent.replace(/\s+/gu, " ").trim();
  const press = (key) => {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(focused(), "Follow the system", "the current value takes focus");
  assert.equal(press("ArrowDown"), true);
  assert.equal(focused(), "Light");
  press("End");
  assert.equal(focused(), "Catppuccin Mocha");
  press("ArrowDown");
  assert.equal(focused(), "Follow the system", "the last item wraps to the first");
  assert.equal(press("Escape"), true);
  assert.equal(document.querySelector("body > .menu"), null);
  assert.equal(document.activeElement, chooser, "focus returns to the trigger");
});

test("no native select is left anywhere", { skip }, async () => {
  const { document } = await open("src/pages/options/options.html");
  assert.equal(document.querySelectorAll("select").length, 0);
  const choosers = [...document.querySelectorAll(".select-trigger")];
  assert.equal(choosers.length, 2, "retention and theme");
  choosers.at(-1).click();
  await settle();
  assert.deepEqual(
    [...document.querySelectorAll("body > .menu .menu-item .label")].map((node) => node.textContent),
    ["Follow the system", "Light", "Dark", "Catppuccin Mocha"],
  );
});

test("three themes plus the system, applied to the document and remembered", { skip }, async () => {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8")}</style></head><body></body></html>`,
    { url: "https://localhost/" },
  );
  const { window } = dom;
  const bind = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  bind("window", window);
  bind("document", window.document);
  bind("Node", window.Node);
  bind("localStorage", window.localStorage);
  const store = { theme: "mocha" };
  bind("chrome", {
    storage: {
      local: { get: async (key) => ({ [key]: store[key] }), set: async (values) => Object.assign(store, values) },
      onChanged: { addListener() {}, removeListener() {} },
    },
  });
  const { applyStoredTheme, setTheme, THEMES } = await import(
    `${join(ROOT, "src/ui/theme.js")}?${Math.random().toString(36).slice(2)}`
  );
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    ["system", "light", "dark", "mocha"],
  );
  const read = (property) =>
    window.getComputedStyle(window.document.documentElement).getPropertyValue(property).trim();

  await applyStoredTheme();
  assert.equal(window.document.documentElement.dataset.theme, "mocha");
  assert.equal(read("--color-canvas"), "#11111b");
  assert.equal(read("--color-accent"), "#cba6f7");

  await setTheme("light");
  assert.equal(window.document.documentElement.dataset.theme, "light");
  assert.equal(read("--color-canvas"), "#f4f4f5");
  assert.equal(read("--color-text"), "#1c1c1f");
  assert.equal(store.theme, "light");
  assert.equal(window.localStorage.getItem("foflow-theme"), "light", "the boot mirror follows");

  await setTheme("dark");
  assert.equal(read("--color-canvas"), "#1a1a1d");
  await setTheme("system");
  assert.equal(window.document.documentElement.dataset.theme, undefined);
  assert.equal(window.localStorage.getItem("foflow-theme"), null);
});

test("the theme boot script applies the mirror before the body paints", { skip }, async () => {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><p>x</p></body></html>`, {
    runScripts: "outside-only",
    url: "https://localhost/settings",
  });
  dom.window.localStorage.setItem("foflow-theme", "mocha");
  dom.window.eval(readFileSync(join(ROOT, "src/ui/theme-boot.js"), "utf8"));
  assert.equal(dom.window.document.documentElement.dataset.theme, "mocha");
  assert.equal(dom.window.document.documentElement.dataset.themeChoice, "mocha");
});

test("a theme control and a focus card release what they listen to", { skip }, async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://localhost/popup",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const bind = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  bind("window", window);
  bind("document", window.document);
  bind("Node", window.Node);
  bind("localStorage", window.localStorage);
  bind("matchMedia", () => ({ matches: false, addEventListener() {} }));
  const live = new Set();
  bind("chrome", {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: {
        addListener: (fn) => live.add(fn),
        removeListener: (fn) => live.delete(fn),
      },
    },
  });
  const suffix = Math.random().toString(36).slice(2);
  const { themeButton } = await import(`${join(ROOT, "src/ui/theme.js")}?${suffix}`);
  const { focusCard } = await import(`${join(ROOT, "src/ui/focus-card.js")}?${suffix}`);
  const buttons = [themeButton(), themeButton(), themeButton()];
  assert.equal(live.size, 3);
  for (const button of buttons) button.dispose();
  assert.equal(live.size, 0, "a released theme control stops listening");
  const card = focusCard({
    snapshot: () => ({ session: null, minutes: 25, breaks: false, shut: [], suggestions: [] }),
    update: async () => ({ ok: true }),
    actions: {
      start: async () => ({ ok: true }),
      stop: async () => ({ ok: true }),
      skip: async () => ({ ok: true }),
      sync: async () => ({ ok: true }),
    },
  });
  card.dispose();
  assert.equal(live.size, 0, "a disposed card leaves nothing behind");
});

test("the cover says why, how long, and offers both ways out", { skip }, async () => {
  const now = Date.now();
  const { document } = await open("src/pages/cover/cover.html", {
    search: "?site=youtube.com",
    session: {
      plan: { minutes: 25, breaks: false },
      started_ms: now - 60_000,
      phase: "focus",
      phase_started_ms: now - 60_000,
      phase_ends_ms: now + 24 * 60_000,
      rounds: 0,
      focused_ms: 60_000,
      allowances: [],
      round: 1,
    },
  });
  const body = document.body.textContent.replace(/\s+/gu, " ");
  assert.match(body, /Paused for focus/u);
  assert.match(body, /24:0\d/u);
  assert.match(body, /Allow 5 minutes/u);
  assert.match(body, /End focus/u);
  assert.ok(document.querySelector(".ring-wrap .ring svg"));
});
