// Preview harness: the real page, the real modules, a stand-in engine.
const minutes = (value) => value * 60_000;
const hourMs = (hour) => new Date().setHours(hour, 0, 0, 0);

const settings = {
  minutes: 25,
  breaks: false,
  shut: ["youtube.com", "reddit.com"],
  blocking: true,
  tracking: true,
  openPage: false,
  notify: false,
  retentionDays: 90,
  suggestions: ["youtube.com", "github.com", "news.ycombinator.com"],
};

// A round already running, a little way in.
const started = Date.now() - minutes(9);
let session = {
  plan: { minutes: 25, breaks: false },
  started_ms: started,
  phase: "focus",
  phase_started_ms: started,
  phase_ends_ms: started + minutes(25),
  rounds: 0,
  focused_ms: 0,
  allowances: [],
  round: 1,
};

const buckets = new Array(24).fill(0);
for (const [hour, seconds] of [
  [9, 2280],
  [10, 3360],
  [11, 2640],
  [12, 960],
  [14, 1680],
  [16, 540],
]) {
  buckets[hour] = seconds;
}
const sites = [
  {
    site: "youtube.com",
    seconds: 6420,
    opens: 4,
    series: buckets.map((value, index) => (index >= 9 && index <= 11 ? value : 0)),
  },
  { site: "github.com", seconds: 3180, opens: 11, series: buckets.map(() => 0) },
  { site: "reddit.com", seconds: 1860, opens: 6, series: buckets.map(() => 0) },
  { site: "news.ycombinator.com", seconds: 1200, opens: 7, series: buckets.map(() => 0) },
  { site: "developer.mozilla.org", seconds: 720, opens: 3, series: buckets.map(() => 0) },
];
const total = buckets.reduce((sum, value) => sum + value, 0);

const report = { span: "day", start: 0, buckets, total, previous: 0, sites };
const snapshot = () => ({
  session,
  ...settings,
  now: Date.now(),
});

const reply = (message) => {
  switch (message.type) {
    case "focus:snapshot":
      return snapshot();
    case "time:report":
      return report;
    case "time:focusDays":
      return { days: [{ day: 0, seconds: 5100, sessions: 3, completed: 2 }] };
    case "focus:start": {
      const now = Date.now();
      session = {
        plan: { minutes: message.minutes ?? settings.minutes, breaks: message.breaks ?? false },
        started_ms: now,
        phase: "focus",
        phase_started_ms: now,
        phase_ends_ms: now + minutes(message.minutes ?? settings.minutes),
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
    case "focus:skip": {
      const now = Date.now();
      if (session && session.phase !== "focus") {
        session = {
          ...session,
          phase: "focus",
          phase_started_ms: now,
          phase_ends_ms: now + minutes(session.plan.minutes),
        };
      }
      return { ok: true };
    }
    case "focus:settings":
      Object.assign(settings, message);
      if (session) session = { ...session, plan: { ...session.plan, minutes: settings.minutes, breaks: settings.breaks } };
      return { ok: true, snapshot: snapshot(), settings };
    default:
      return { ok: true };
  }
};

// This page is served over HTTP, where the extension's APIs are not injected;
// a stand-in is installed before the page module is imported. `src/` only ever
// reaches `chrome` inside functions, never at module load.
globalThis.chrome = {
  runtime: {
    id: "preview",
    lastError: null,
    getURL: (path) => new URL(`../${path}`, globalThis.location.href).href,
    onMessage: { addListener() {} },
    openOptionsPage() {},
    sendMessage(message, callback) {
      setTimeout(() => callback?.(reply(message)), 0);
    },
  },
  storage: {
    // The theme is remembered between previews, as it is in the extension.
    local: {
      get: async (key) => {
        const value = globalThis.localStorage?.getItem(`foflow-preview-${key}`);
        return value === null || value === undefined ? {} : { [key]: value };
      },
      set: async (values) => {
        for (const [key, value] of Object.entries(values)) {
          globalThis.localStorage?.setItem(`foflow-preview-${key}`, value);
        }
      },
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {}, removeListener() {} },
  },
  tabs: { create: async ({ url }) => globalThis.window.open(url, "_blank", "noopener") },
};

// The preview has no browser to open settings for, so the one button that
// would leave the page cycles the theme instead: the three themes are the
// point of the preview as much as the layout is.
const { THEMES, applyStoredTheme, setTheme } = await import("../src/ui/theme.js");
await applyStoredTheme();
document.getElementById("cycle-theme")?.addEventListener("click", async () => {
  const order = THEMES.map((entry) => entry.id);
  const current = document.documentElement.dataset.themeChoice ?? "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  await setTheme(next);
  document.getElementById("cycle-theme").textContent = `Theme: ${THEMES.find((entry) => entry.id === next).label}`;
});

// The mark, as each real page draws it.
const { mark } = await import("../src/ui/dom.js");
document.getElementById("brand")?.append(mark(18));

document.getElementById("span")?.setAttribute("data-preview", "true");
await import("../src/pages/time/time.js");
