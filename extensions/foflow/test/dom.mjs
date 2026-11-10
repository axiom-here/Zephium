// The DOM harness both browser-level suites share: a stand-in for the service
// worker, and a way to open a page with its real stylesheets applied.
//
// jsdom does not run module scripts or fetch <link>s, so each page is opened
// by splicing its sheets in and importing its module into the global scope.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The extension package, so pages resolve the way they do when installed. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let JSDOM = null;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // The DOM suites skip themselves when jsdom is absent.
}
export { JSDOM };
/** The reason to skip a DOM test, or false when jsdom is installed. */
export const skip = JSDOM === null ? "jsdom is not installed (npm install --no-save jsdom)" : false;

/** The service worker, answered locally. `session` seeds a running round. */
export function engine({ session = null } = {}) {
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
  const report = {
    span: "day",
    start: 0,
    buckets: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 3480 : 0)),
    total: 3480,
    previous: 0,
    sites: [{ site: "youtube.com", seconds: 3480, opens: 3, series: Array(24).fill(0) }],
    suggestions: ["youtube.com"],
  };
  const storage = {};
  const snapshot = () => ({ session, ...settings, now: Date.now() });
  return {
    storage,
    get session() {
      return session;
    },
    chrome: {
      runtime: {
        id: "test",
        lastError: null,
        getURL: (path) => `chrome-extension://test/${path}`,
        onMessage: { addListener() {} },
        openOptionsPage() {},
        sendMessage(message, reply) {
          const answer = (() => {
            switch (message.type) {
              case "focus:snapshot":
                return snapshot();
              case "time:report":
                return report;
              case "time:focusDays":
                return { days: [{ day: 0, seconds: 720, sessions: 1, completed: 0 }] };
              case "focus:settings":
                Object.assign(settings, message);
                return { ok: true, snapshot: snapshot(), settings };
              case "focus:start": {
                const now = Date.now();
                session = {
                  plan: { minutes: settings.minutes, breaks: false },
                  started_ms: now,
                  phase: "focus",
                  phase_started_ms: now,
                  phase_ends_ms: now + settings.minutes * 60_000,
                  rounds: 0,
                  focused_ms: 0,
                  allowances: [],
                  round: 1,
                };
                return { ok: true };
              }
              case "focus:stop":
                session = null;
                return { ok: true };
              case "cover:state":
                return { ...snapshot(), site: message.site, url: "https://www.youtube.com/watch?v=abc" };
              default:
                return { ok: true };
            }
          })();
          setTimeout(() => reply?.(answer), 0);
        },
      },
      storage: {
        local: {
          get: async (key) => (key in storage ? { [key]: storage[key] } : {}),
          set: async (values) => Object.assign(storage, values),
        },
        session: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener() {}, removeListener() {} },
      },
      tabs: { create: async () => ({}) },
    },
  };
}

/** Opens a page with its stylesheets spliced in, since a DOM does not fetch. */
export async function open(page, { search = "", session = null } = {}) {
  const file = join(ROOT, page);
  const html = readFileSync(file, "utf8");
  // A real extension page has a storage origin; file: does not, and the theme
  // mirror lives in localStorage.
  const dom = new JSDOM(html, { url: `https://localhost/${page}${search}`, pretendToBeVisual: true });
  const { window } = dom;
  const document = window.document;
  for (const link of [...document.querySelectorAll("link[rel=stylesheet]")]) {
    const href = new URL(link.getAttribute("href"), `file://${file}`).pathname;
    const style = document.createElement("style");
    style.textContent = readFileSync(href, "utf8");
    link.replaceWith(style);
  }
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const bind = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  bind("window", window);
  bind("document", document);
  bind("navigator", window.navigator);
  bind("location", window.location);
  bind("history", window.history);
  bind("HTMLElement", window.HTMLElement);
  bind("Node", window.Node);
  bind("matchMedia", () => ({ matches: false, addEventListener() {} }));
  bind("getComputedStyle", window.getComputedStyle.bind(window));
  bind("localStorage", window.localStorage);
  const harness = engine({ session });
  harness.calls = [];
  const send = harness.chrome.runtime.sendMessage.bind(harness.chrome.runtime);
  harness.chrome.runtime.sendMessage = (message, reply) => {
    harness.calls.push(message.type);
    send(message, reply);
  };
  bind("chrome", harness.chrome);
  await import(`${file.replace(/\.html$/, ".js")}?${Math.random().toString(36).slice(2)}`);
  await settle(180);
  return { window, document, harness };
}

export const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The text a person can read: `hidden` subtrees are dropped first, because
 * `textContent` happily returns the alert a surface is not showing.
 */
export function text(node) {
  const copy = node.cloneNode(true);
  for (const hidden of copy.querySelectorAll("[hidden]")) hidden.remove();
  return copy.textContent.replace(/\s+/gu, " ").trim();
}
