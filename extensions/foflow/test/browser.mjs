// Renders each page and the focus card in a real DOM, and drives them, so the
// wiring between the pages and the engine is exercised as well as the domain
// logic in `run.mjs`.
//
//   node extensions/foflow/test/run.mjs       (no dependencies)
//   npm install --no-save jsdom && \
//   node extensions/foflow/test/browser.mjs  (this file)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // A browser DOM is only needed for this half of the suite.
}

const skip = JSDOM === null ? "jsdom is not installed (npm install --no-save jsdom)" : false;

/** A stand-in for the service worker: answers every message the pages send. */
function engine({ session = null, report = null } = {}) {
  const settings = {
    minutes: 25,
    breaks: false,
    shut: ["youtube.com"],
    blocking: true,
    tracking: true,
    openPage: false,
    notify: false,
    retentionDays: 90,
    suggestions: ["youtube.com"],
  };
  let current = session;
  const state = {
    calls: [],
    get session() {
      return current;
    },
    report:
      report ??
      {
        span: "day",
        start: 0,
        buckets: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 3480 : 0)),
        total: 3480,
        previous: 0,
        sites: [{ site: "youtube.com", seconds: 3480, opens: 1, series: Array(24).fill(0) }],
        suggestions: ["youtube.com"],
      },
  };
  const snapshot = () => ({ session: current, ...settings, now: Date.now() });
  state.chrome = {
    runtime: {
      id: "test",
      lastError: null,
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener() {} },
      openOptionsPage() {},
      sendMessage(message, reply) {
        state.calls.push(message.type);
        const answer = (() => {
          switch (message.type) {
            case "focus:snapshot":
              return snapshot();
            case "time:report":
              return state.report;
            case "time:focusDays":
              return { days: [{ day: 0, seconds: 720, sessions: 1, completed: 0 }] };
            case "focus:start":
              current = {
                phase: "focus",
                plan: { minutes: message.minutes ?? settings.minutes, breaks: message.breaks ?? false },
                started_ms: Date.now() - 60_000,
                phase_started_ms: Date.now() - 60_000,
                phase_ends_ms: Date.now() + 24 * 60_000,
                rounds: 0,
                focused_ms: 60_000,
                allowances: [],
                round: 1,
              };
              return { ok: true };
            case "focus:stop":
              current = null;
              return { ok: true };
            case "cover:state":
              return { ...snapshot(), site: message.site, url: "https://www.youtube.com/watch?v=abc" };
            case "cover:resume":
              return { ok: true, url: "https://www.youtube.com/watch?v=abc" };
            case "focus:settings":
              Object.assign(settings, message);
              return { ok: true, snapshot: snapshot(), settings };
            default:
              return { ok: true };
          }
        })();
        setTimeout(() => reply?.(answer), 0);
      },
    },
    storage: { session: { get: async () => ({}), set: async () => {} } },
    tabs: { create: async () => ({}) },
  };
  return state;
}

/** Loads a page's markup, installs the globals its module expects, and imports it. */
async function open(page, { search = "", world } = {}) {
  const html = readFileSync(join(ROOT, page.replace(/\.js$/u, ".html")), "utf8");
  const dom = new JSDOM(html, {
    url: `chrome-extension://test/${page.replace(/\.js$/u, ".html")}${search}`,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const bind = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  bind("window", window);
  bind("document", window.document);
  bind("navigator", window.navigator);
  bind("location", window.location);
  bind("history", window.history);
  bind("HTMLElement", window.HTMLElement);
  bind("Node", window.Node);
  bind("getComputedStyle", window.getComputedStyle.bind(window));
  const harness = engine(world);
  bind("chrome", harness.chrome);
  const errors = [];
  window.addEventListener("error", (event) => errors.push(String(event.message)));
  await import(`${ROOT}/${page}?${Math.random().toString(36).slice(2)}`);
  await settle(120);
  return { window, doc: window.document, harness, errors };
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (node) => node.textContent.replace(/\s+/gu, " ").trim();

test("the Time page draws a day, a site list and the focus card", { skip }, async () => {
  const { doc, errors } = await open("src/pages/time/time.js");
  assert.deepEqual(errors, []);
  assert.match(text(doc.querySelector("#total")), /58/);
  assert.equal(doc.querySelectorAll("#sites .row").length, 1);
  assert.match(text(doc.querySelector("#sites")), /youtube\.com/);
  assert.equal(doc.querySelectorAll(".bars .column").length, 24);
  assert.equal(doc.querySelectorAll(".bars .ticks span").length, 8);
  assert.match(text(doc.querySelector("#focus")), /Start focus/);
  assert.equal(doc.querySelectorAll("#shut-editor .shut-list li").length, 1);
});

test("the focus card opens its lengths, starts a round, and ends it", { skip }, async () => {
  const { doc, harness } = await open("src/pages/time/time.js");
  const focus = doc.querySelector("#focus");
  const card = () => focus.textContent.replace(/\s+/gu, " ").trim();

  focus.querySelector(".focus-length").click();
  await settle();
  const lengths = [...focus.querySelectorAll(".length-menu button")].map((node) => node.textContent.trim());
  assert.deepEqual(lengths.slice(0, 3), ["15 min", "25 min", "30 min"]);
  assert.equal(lengths.at(-1), "Repeat with breaks");

  focus.querySelectorAll(".length-menu button")[2].click();
  await settle();
  assert.match(card(), /^30min/);

  [...focus.querySelectorAll("button")].find((node) => node.textContent.includes("Start focus")).click();
  await settle(160);
  assert.match(card(), /24:0\d/);
  assert.match(card(), /Round 1/);
  assert.equal(harness.session?.phase, "focus");

  const end = () => [...focus.querySelectorAll("button")].find((node) => /^End/u.test(node.textContent.trim()));
  end().click();
  await settle();
  assert.equal(end().textContent.trim(), "End focus?");
  end().click();
  await settle(160);
  assert.match(card(), /Start focus/);
  assert.equal(harness.session, null);
});

test("the toolbar popup shows focus, today's time and the top sites", { skip }, async () => {
  const { doc, errors } = await open("src/pages/popup/popup.js");
  assert.deepEqual(errors, []);
  assert.match(text(doc.querySelector("#focus")), /Start focus/);
  assert.match(text(doc.querySelector("#stats")), /on the web/);
  assert.equal(doc.querySelectorAll("#sites .row").length, 1);
  assert.match(text(doc.body), /Counted on this device only/);
});

test("the cover names the site, counts down, and offers both ways out", { skip }, async () => {
  const { doc, errors } = await open("src/pages/cover/cover.js", {
    search: "?site=youtube.com",
    world: {
      session: {
        phase: "focus",
        plan: { minutes: 25, breaks: false },
        started_ms: Date.now() - 60_000,
        phase_started_ms: Date.now() - 60_000,
        phase_ends_ms: Date.now() + 24 * 60_000,
        rounds: 0,
        focused_ms: 60_000,
        allowances: [],
        round: 1,
      },
    },
  });
  assert.deepEqual(errors, []);
  const body = text(doc.body);
  assert.match(body, /Paused for focus/);
  assert.match(body, /24:0\d/);
  assert.match(body, /Allow 5 minutes/);
  assert.match(body, /End focus/);
  assert.match(body, /youtube\.com/);
});

test("settings render every row and write what is changed", { skip }, async () => {
  const { doc, harness } = await open("src/pages/options/options.js");
  assert.equal(doc.querySelectorAll(".group").length, 2);
  const switches = doc.querySelectorAll(".switch");
  assert.equal(switches.length, 5);
  switches[0].click();
  await settle();
  assert.equal(harness.calls.includes("focus:settings"), true);
});
