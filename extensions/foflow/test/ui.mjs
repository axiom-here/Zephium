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
import { JSDOM, ROOT, open, settle, skip, text } from "./dom.mjs";

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
  // The figures are laid out by the popup itself, on the shared card skin.
  // The popup's figures are its own variant of the shared card.
  assert.deepEqual(declaration(document, ".stats.two", "grid-template-columns"), [
    "repeat(2, minmax(0px, 1fr))",
  ]);
});

test("the focus dial is a ring, never a filled disc", { skip }, async () => {
  const { document } = await open("src/pages/popup/popup.html");
  const svg = document.querySelector(".dial svg");
  assert.ok(svg, "the dial draws an svg");
  assert.deepEqual([...svg.children].map((node) => node.tagName), ["circle", "circle"]);
  assert.equal(svg.querySelector(".track").getAttribute("fill"), null);
  // Both circles are unfilled by rule, which is what stops the black disc —
  // and that rule is shared, not copy-pasted into one page.
  assert.deepEqual(declaration(document, ".ring .track", "fill"), ["none"]);
  assert.deepEqual(declaration(document, ".ring .arc", "fill"), ["none"]);
  assert.deepEqual(declaration(document, ".ring svg", "rotate"), ["-90deg"]);
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
  // The reference panel: a dot on the chosen row, a rule before the actions.
  assert.equal(menu.querySelectorAll('[aria-checked="true"]').length, 1);
  assert.match(menu.querySelector('[aria-checked="true"] .label').textContent, /^25 min$/u);
  assert.equal(menu.querySelectorAll(".menu-separator").length, 1);
  assert.equal(
    menu.children[menu.children.length - 2].className,
    "menu-separator",
    "the separator sits directly above the last item",
  );
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
  assert.equal(read("--color-canvas"), "#f6f7f9");
  assert.equal(read("--color-text"), "#1b2027");
  assert.equal(store.theme, "light");
  assert.equal(window.localStorage.getItem("foflow-theme"), "light", "the boot mirror follows");

  await setTheme("dark");
  assert.equal(read("--color-canvas"), "#0d1117");
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

test("a first run reads as empty, not as broken", { skip }, async () => {
  const { document } = await open("src/pages/time/time.html", { empty: true });
  assert.equal(document.querySelector("#total").textContent.trim(), "0m");
  // The chart is still a full day, not a blank box.
  assert.equal(document.querySelectorAll(".plot .column").length, 24);
  assert.equal(document.querySelectorAll(".plot .ticks span").length, 8);
  assert.equal(document.querySelectorAll(".plot .bar").length, 0, "an empty day draws no bars");
  // An empty list shows its empty state and no column header over it.
  assert.match(text(document.querySelector("#sites")), /Nothing counted yet/u);
  assert.equal(document.querySelectorAll("#sites .head").length, 0);
  assert.equal(document.querySelectorAll("#sites .row").length, 0);

  const popup = await open("src/pages/popup/popup.html", { empty: true });
  assert.match(text(popup.document.querySelector("#stats")), /0m/u);
  assert.match(text(popup.document.querySelector("#sites")), /Nothing counted yet|Time on the web/u);
});

test("a period you are not in says so, and offers the way back", { skip }, async () => {
  const { document } = await open("src/pages/time/time.html");
  const back = document.querySelector("#today");
  assert.equal(back.hidden, true, "today has nothing to go back to");
  document.querySelector("#previous").click();
  await settle(200);
  assert.equal(document.querySelector("#period-label").textContent.trim(), "Yesterday");
  assert.equal(back.hidden, false, "a past day offers the way back");
  back.click();
  await settle(200);
  assert.equal(back.hidden, true);
  assert.equal(document.querySelector("#period-label").textContent.trim(), "Today");
});

test("every stylesheet survives parsing, and shared components stay shared", { skip }, async () => {
  const sheets = [
    "src/styles/tokens.css",
    "src/styles/ui.css",
    "src/pages/time/time.css",
    "src/pages/popup/popup.css",
    "src/pages/options/options.css",
    "src/pages/cover/cover.css",
  ];
  // Selectors jsdom normalizes on the way in, plus keyframe steps.
  const squash = (selector) => selector.replace(/\s+/gu, " ").trim();
  const normalized = new Set(["*, *::before, *::after", "50%", "0%, 100%"]);
  for (const sheet of sheets) {
    const css = readFileSync(join(ROOT, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    const dom = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body></body></html>`);
    const parsed = [...dom.window.document.styleSheets[0].cssRules];
    const flatten = (rules) => rules.flatMap((rule) => (rule.cssRules?.length ? flatten([...rule.cssRules]) : [rule]));
    const present = new Set(
      flatten(parsed)
        .filter((rule) => rule.selectorText)
        .map((rule) => squash(rule.selectorText)),
    );
    const written = [...css.matchAll(/(?:^|\})\s*([^{}@;]+?)\s*\{/gu)]
      .map((match) => squash(match[1]))
      .filter((selector) => selector.length > 0);
    // A syntax error drops everything after it, so the last rule is the witness.
    assert.ok(present.has(written.at(-1)), `${sheet} parses to its last selector`);
    const dropped = written.filter((selector) => !present.has(selector) && !normalized.has(selector));
    assert.deepEqual(dropped, [], `${sheet} keeps every rule it writes`);
  }

  // The popup once shipped unstyled because a card's rules lived in the Time
  // page's stylesheet. Component rules belong to ui.css and nowhere else.
  const shared = [
    ".menu",
    ".button",
    ".switch",
    ".field",
    ".segmented button",
    ".ring svg",
    ".ring .arc",
    ".sites",
    ".sites .row",
    ".sites .head",
    ".sites .row .meter",
    ".focus",
    ".focus .body",
    ".shut-editor",
    ".stats",
  ];
  for (const sheet of sheets.slice(2)) {
    const css = readFileSync(join(ROOT, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    const selectors = new Set(
      [...css.matchAll(/(?:^|\})\s*([^{}@;]+?)\s*\{/gu)].map((match) => squash(match[1])),
    );
    const duplicated = shared.filter((selector) => selectors.has(selector));
    assert.deepEqual(duplicated, [], `${sheet} does not restyle a shared component`);
  }
});
