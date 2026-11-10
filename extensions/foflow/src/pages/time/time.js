// The Time page: a day or a week, where it went site by site, one site in
// depth, and focus with the sites it shuts — the browser's own Time surface,
// rebuilt against the extension's storage.
import { bars } from "../../ui/bars.js";
import { focusCard, shutEditor } from "../../ui/focus-card.js";
import { siteList, siteMark } from "../../ui/sites.js";
import { el, fill, glyphs, iconButton } from "../../ui/dom.js";
import { themeButton } from "../../ui/theme.js";
import { m } from "../../lib/messages.js";
import {
  currentPeriod,
  dayLabel,
  duration,
  hourLabel,
  liveBucket,
  shiftPeriod,
  weekdayShort,
  weekLabel,
} from "../../lib/time.js";

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(reply ?? null);
    });
  });

const state = {
  snapshot: null,
  span: new URLSearchParams(location.search).get("span") === "week" ? "week" : "day",
  period: null,
  report: null,
  focusDays: [],
  site: null,
  pointed: null,
};
state.period = currentPeriod(state.span);

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------- chrome

function bootToolbar() {
  const back = $("back");
  back.querySelector(".arrow").append(glyphs.arrowLeft(15));
  back.setAttribute("aria-label", m("back"));
  back.setAttribute("title", m("back"));
  $("page-title").textContent = m("time_title");
  back.addEventListener("click", () => {
    // Opened from the toolbar or a first run, so the browser's own history
    // decides where back is; a tab with none closes instead.
    if (history.length > 1) history.back();
    else if (opener) window.close();
    else void send({ type: "time:open", span: "day" });
  });

  // The theme choice and settings sit at the trailing edge of the toolbar, so
  // settings is always one click away and always one click back.
  const end = $("toolbar-end");
  end.append(
    themeButton(),
    iconButton(m("settings"), glyphs.settings, {
      onclick: () => chrome.runtime.openOptionsPage(),
    }),
  );
  end.querySelector(".icon-button:last-child").setAttribute(
    "title",
    `${m("settings_open")} · Ctrl+,`,
  );
}

$("settings-open")?.remove();
for (const node of $("span").querySelectorAll("button")) {
  node.textContent = node.dataset.span === "day" ? m("time_span_day") : m("time_span_week");
  node.addEventListener("click", () => show(node.dataset.span));
}
$("previous").append(glyphs.chevronLeft(15));
$("next").append(glyphs.chevronRight(15));
$("previous").addEventListener("click", () => shift(-1));
$("next").addEventListener("click", () => shift(1));
$("today").textContent = m("time_go_today");
$("today").addEventListener("click", () => {
  state.period = currentPeriod(state.period.span);
  state.site = null;
  void refresh();
});
$("crumb").append(glyphs.arrowLeft(13), m("time_all_sites"));
$("crumb").addEventListener("click", () => select(null));
$("shut-card").querySelector(".help").textContent = m("focus_shut_help");
$("shut-card").querySelector("h3").textContent = m("focus_shut_title");
fill($("local"), glyphs.lock(11), el("span", { text: m("time_local_only") }));
bootToolbar();

function show(span) {
  if (span === state.period.span) return;
  state.span = span;
  state.period = currentPeriod(span);
  state.site = null;
  void refresh();
}

function shift(by) {
  const next = shiftPeriod(state.period, by);
  if (next.start > currentPeriod(next.span).start) return;
  state.period = next;
  state.site = null;
  void refresh();
}

function select(site) {
  state.site = site === state.site ? null : site;
  void refresh();
}

// -------------------------------------------------------------------- focus

const focus = focusCard({
  snapshot: () => state.snapshot ?? emptySnapshot(),
  update: async (patch) => {
    const reply = await send({ type: "focus:settings", ...patch });
    if (reply?.snapshot) state.snapshot = reply.snapshot;
    await refresh();
    return reply;
  },
  actions: {
    start: (minutes, breaks) => send({ type: "focus:start", minutes, breaks }).then(after),
    stop: () => send({ type: "focus:stop" }).then(after),
    skip: () => send({ type: "focus:skip" }).then(after),
    sync: () => send({ type: "focus:snapshot" }).then(after),
  },
  size: "page",
  onmanage: () => {
    const card = $("shut-card");
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 900);
  },
  onchange: () => void refresh(),
});
$("focus").append(focus.root);

const editor = shutEditor({
  snapshot: () => state.snapshot ?? emptySnapshot(),
  update: async (patch) => {
    const reply = await send({ type: "focus:settings", ...patch });
    if (reply?.snapshot) state.snapshot = reply.snapshot;
    await refresh();
    return reply;
  },
  onchange: () => void refresh(),
});
$("shut-editor").append(editor.root);

function emptySnapshot() {
  return {
    session: null,
    minutes: 25,
    breaks: false,
    shut: [],
    suggestions: [],
    blocking: true,
    tracking: true,
  };
}

async function after(reply) {
  const snapshot = await send({ type: "focus:snapshot" });
  if (snapshot) state.snapshot = snapshot;
  await refresh();
  return reply;
}

// ------------------------------------------------------------------ reports

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const period = { span: state.period.span, start: state.period.start };
    const site = state.site;
    const [overview, narrowed, snapshot, focused] = await Promise.all([
      send({ type: "time:report", ...period }),
      site === null ? Promise.resolve(null) : send({ type: "time:report", ...period, site }),
      send({ type: "focus:snapshot" }),
      send({ type: "time:focusDays", from: period.start, days: period.span === "day" ? 1 : 7 }),
    ]);
    if (overview) state.overview = overview;
    state.report = narrowed ?? overview;
    if (snapshot) state.snapshot = snapshot;
    if (focused?.days) state.focusDays = focused.days;
  })();
  try {
    await refreshing;
  } finally {
    refreshing = null;
    draw();
  }
  return null;
}

const STEADY_SECONDS = 5 * 60;

const totals = (buckets) => buckets.reduce((sum, value) => sum + value, 0);

function elapsedBuckets(period, now = new Date()) {
  const live = liveBucket(period, now);
  return live >= 0 ? live + 1 : 0;
}

function comparison(period, current, previous) {
  const elapsed = elapsedBuckets(period);
  if (period.span === "day") {
    const running = elapsed < 24;
    return running || previous === 0 ? null : current - previous;
  }
  if (previous === 0 || elapsed === 0) return null;
  return current / elapsed - previous / 7;
}

// --------------------------------------------------------------------- draw

let chartNode = null;
const sitesView = siteList({
  sites: [],
  total: 0,
  size: "page",
  onpoint: (site) => {
    state.pointed = site;
    drawChart();
  },
  onselect: (site) => select(site),
});
$("sites").append(sitesView.root);

function draw() {
  const report = state.report;
  const period = state.period;
  const site = state.site;
  const buckets = report?.buckets ?? new Array(period.span === "day" ? 24 : 7).fill(0);
  const sum = totals(buckets);

  for (const node of $("span").querySelectorAll("button")) {
    const active = node.dataset.span === period.span;
    node.setAttribute("aria-pressed", String(active));
  }
  $("period-label").textContent = periodLabel(period);
  $("previous").setAttribute(
    "aria-label",
    period.span === "day" ? m("time_previous_day") : m("time_previous_week"),
  );
  $("next").setAttribute("aria-label", period.span === "day" ? m("time_next_day") : m("time_next_week"));
  $("next").disabled = period.start >= currentPeriod(period.span).start;
  $("today").hidden = period.start >= currentPeriod(period.span).start;

  $("site-head").hidden = site === null;
  if (site !== null) {
    fill($("site-mark"), siteMark(site, 22));
    $("site-name").textContent = site;
  }
  state.total = sum;
  $("total").textContent = duration(sum);
  $("sites-caption").textContent = site === null ? "" : m("time_site_total", { site });
  $("page-sub").textContent = site === null ? m("time_on_web") : m("time_site_total", { site });
  $("sub").textContent = site !== null ? m("time_site_total", { site }) : m("time_on_web");

  const change = site === null && report ? comparison(period, sum, report.previous ?? 0) : null;
  const average =
    site === null && period.span === "week" ? sum / Math.max(1, elapsedBuckets(period)) : null;
  const changeNode = $("change");
  if (change !== null && Math.abs(change) >= STEADY_SECONDS) {
    changeNode.textContent =
      change < 0
        ? `${duration(Math.abs(change))} less than before`
        : `${duration(Math.abs(change))} more than before`;
  } else if (change !== null) {
    changeNode.textContent = "About the same as before";
  } else if (average !== null) {
    changeNode.textContent = m("time_daily_average", { duration: duration(average) });
  } else {
    changeNode.textContent = "";
  }

  drawChart();
  drawSiteActions();
  sitesView.update(report?.sites ?? [], sum);

  const focused = state.focusDays.reduce(
    (sums, day) => ({
      seconds: sums.seconds + day.seconds,
      sessions: sums.sessions + day.sessions,
      completed: sums.completed + day.completed,
    }),
    { seconds: 0, sessions: 0, completed: 0 },
  );
  $("stats").hidden = focused.sessions === 0;
  $("stat-focused").textContent = duration(focused.seconds);
  $("stat-sessions").textContent = String(focused.sessions);
  $("stat-completed").textContent = String(focused.completed);

  editor.render();
  focus.setFailed(state.snapshot?.failed === true);
  focus.draw();
}

function drawChart() {
  const report = state.report;
  const period = state.period;
  const buckets = report?.buckets ?? new Array(period.span === "day" ? 24 : 7).fill(0);
  const values = [...buckets];
  const pointed = state.pointed;
  const entry = pointed === null ? null : report?.sites.find((row) => row.site === pointed);
  const highlight = entry?.series?.length ? entry.series : null;
  const average =
    period.span === "week" ? totals(buckets) / Math.max(1, elapsedBuckets(period)) : null;
  const ticks =
    period.span === "day"
      ? [0, 3, 6, 9, 12, 15, 18, 21].map((index) => ({ index, label: hourLabel(index) }))
      : values.map((_, index) => ({ index, label: weekdayShort(period.start + index) }));

  const next = bars({
    values,
    highlight,
    live: periodIsCurrent() ? liveBucket(period) : -1,
    average,
    ticks,
    height: 196,
    label: period.span === "day" ? m("time_chart_day") : m("time_chart_week"),
    describe: (index) => describeBucket(period, index),
    summary: duration(state.total ?? 0),
  });
  if (chartNode) chartNode.replaceWith(next);
  else $("chart").append(next);
  chartNode = next;
}

function describeBucket(period, index) {
  if (period.span === "day") {
    const start = new Date(2000, 0, 1, index);
    const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric" });
    if (index >= 23) return `${hourFormat.format(start)} – ${hourFormat.format(new Date(2000, 0, 1, 0))}`;
    return hourFormat.formatRange(start, new Date(2000, 0, 1, index + 1));
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dateOfDay(period.start + index));
}

function dateOfDay(day) {
  const utc = new Date(day * 86_400_000);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function drawSiteActions() {
  const site = state.site;
  const node = $("site-actions");
  fill(node);
  node.hidden = site === null;
  if (site === null) return;
  const shut = (state.snapshot?.shut ?? []).some(
    (entry) => site === entry || site.endsWith(`.${entry}`),
  );
  node.append(
    el(
      "button",
      {
        type: "button",
        class: "button",
        onclick: () => void chrome.tabs.create({ url: `https://${site}/` }),
      },
      m("time_open_site", { site }),
    ),
    el(
      "button",
      {
        type: "button",
        class: `button ${shut ? "" : "ghost"}`,
        "aria-pressed": String(shut),
        onclick: async () => {
          const sites = state.snapshot?.shut ?? [];
          const next = shut
            ? sites.filter((entry) => !(site === entry || site.endsWith(`.${entry}`)))
            : [...sites, site];
          await send({ type: "focus:settings", shut: next });
          await refresh();
        },
      },
      m("focus_shut_site"),
    ),
  );
}

function periodLabel(period) {
  const now = currentPeriod(period.span);
  const back = (now.start - period.start) / (period.span === "day" ? 1 : 7);
  if (period.span === "day") {
    return back === 0 ? m("time_today") : back === 1 ? m("time_yesterday") : dayLabel(period.start);
  }
  return back === 0 ? m("time_this_week") : back === 1 ? m("time_last_week") : weekLabel(period.start);
}

function periodIsCurrent() {
  return currentPeriod(state.period.span).start === state.period.start;
}

// ------------------------------------------------------------------ lifecycle

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "focus:changed") return;
  state.snapshot = message.snapshot;
  draw();
});

// Settings is one keystroke away, as in the browser.
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === ",") {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
setInterval(() => {
  if (document.visibilityState === "visible") void refresh();
}, 60_000);

void refresh().then(async () => {
  state.snapshot = await send({ type: "focus:snapshot" });
  draw();
});
