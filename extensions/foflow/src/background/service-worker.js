// The engine half of the extension: what is in front, what a focus round
// shuts, and the hour tallies the Time page reads. Everything that survives a
// browser restart lives in storage; everything transient lives here.
import { siteOf, coverUrl } from "../lib/site.js";
import {
  advance,
  allow as allowSite,
  blocks,
  focusedMs,
  nextChangeMs,
  phaseLengthMs,
  progress,
  remaining,
  skipBreak,
  start as startSession,
  stop as stopSession,
} from "../lib/focus.js";
import * as store from "../lib/store.js";

const { flush, loadSession, saveSession } = store;
import { m } from "../lib/messages.js";
import { localDay, seconds, weekStart, HOUR_MS } from "../lib/time.js";

const TICK_ALARM = "foflow-tick";
/** How often counted time is written down, matching the browser's own minute. */
const FLUSH_MS = 30_000;

/** @type {Awaited<ReturnType<typeof store.loadSettings>> | null} */
let settings = null;
let session = null;

// Attention: where the reader is, and since when. Durations come from the
// clock's own steps; only the placement of a segment uses wall time.
let attention = null; // { site, windowId, incognito, since }
let lastSite = new Map(); // windowId → site last come to
let ledger = null;
let ledgerDirty = false;

let readyResolve;
const ready = new Promise((resolve) => (readyResolve = resolve));

/** Tabs standing in for a shut page: tabId → { site, url }. Kept in session
 *  storage too, because a service worker can be stopped between a cover being
 *  shown and the reader asking for the page back. */
const covers = new Map();
const COVERS_KEY = "coveredTabs";

async function loadCovers() {
  try {
    const stored = await chrome.storage.session?.get?.(COVERS_KEY);
    for (const [tabId, entry] of Object.entries(stored?.[COVERS_KEY] ?? {})) {
      if (entry && typeof entry.url === "string") covers.set(Number(tabId), entry);
    }
  } catch {
    // No session storage: covers then live only as long as this worker.
  }
}

async function saveCovers() {
  try {
    await chrome.storage.session?.set?.({
      [COVERS_KEY]: Object.fromEntries([...covers].map(([tabId, entry]) => [tabId, entry])),
    });
  } catch {
    // Nothing to do; the map is still right for this worker's lifetime.
  }
}

async function boot() {
  settings = await store.loadSettings();
  await loadCovers();
  session = await loadSession();
  ledger = await store.loadLedger();
  if (session) {
    const result = syncSession(session, Date.now(), { announce: false, quiet: true });
    session = result.session;
    if (result.record) await persistRecord(result.record);
    if (result.finished || !session) {
      session = null;
      await saveSession(null);
    } else {
      await saveSession(session);
    }
  }
  await applyToolbar();
  scheduleTick();
  // Attention is read here directly: updateAttention waits for `ready`, which
  // is only settled at the end of boot.
  await applyAttention();
  broadcast();
  readyResolve();
}

/** The toolbar opens the Time page when the reader asked for that, and the
 *  popup otherwise; the popup has to be removed for a click to arrive at all. */
async function applyToolbar() {
  if (!chrome.action?.setPopup) return;
  try {
    await chrome.action.setPopup({
      popup: settings?.openPage === true ? "" : "src/pages/popup/popup.html",
    });
  } catch {
    // A browser that cannot switch keeps whichever it has.
  }
}

chrome.action?.onClicked?.addListener(() => {
  void handlers["time:open"]({});
});

chrome.commands?.onCommand?.addListener((command) => {
  void (async () => {
    await ready;
    if (command === "start-focus") {
      if (session === null) await startFocus({});
      else await endFocus();
      return;
    }
    if (command === "open-time") await handlers["time:open"]({});
  })();
});

function scheduleTick() {
  chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  schedulePhaseAlarm();
}

function schedulePhaseAlarm() {
  const name = "foflow-phase";
  if (session === null) {
    void chrome.alarms.clear(name);
    return;
  }
  const at = Math.min(nextChangeMs(session), Date.now() + 12 * HOUR_MS);
  chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, at) });
}

chrome.runtime.onInstalled.addListener(() => {
  void boot();
  // Where the Time page lives is a launch argument in the browser; here it is
  // one click away the first time.
  void chrome.tabs.create({ url: chrome.runtime.getURL("src/pages/time/time.html") });
});
chrome.runtime.onStartup.addListener(() => void boot());

// ---------------------------------------------------------------- attention

async function focusedWindow() {
  try {
    const win = await chrome.windows.getLastFocused();
    return win?.focused === false ? null : (win ?? null);
  } catch {
    return null;
  }
}

async function awake() {
  if (!chrome.idle?.queryState) return true;
  try {
    return (await chrome.idle.queryState(30)) === "active";
  } catch {
    return true;
  }
}

/** Where attention belongs right now, or null when nothing is being counted. */
async function currentAttention() {
  if (settings === null || !settings.tracking) return null;
  if (!(await awake())) return null;
  const win = await focusedWindow();
  if (!win || win.id === chrome.windows.WINDOW_ID_NONE) return null;
  if (win.state === "minimized") return null;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ active: true, windowId: win.id });
  } catch {
    return null;
  }
  const tab = tabs[0];
  if (!tab?.url) return null;
  // Private windows keep nothing.
  if (tab.incognito) return null;
  // A cover is not a place the reader is; the page behind it is off the stage.
  if (covers.has(tab.id)) return null;
  if (tab.url.startsWith(chrome.runtime.getURL(""))) return null;
  const site = siteOf(tab.url);
  if (site === null) return null;
  return { site, windowId: win.id, incognito: false };
}

function closeSegment(now = Date.now()) {
  if (attention === null || ledger === null) return;
  const spent = now - attention.since;
  if (spent > 0) store.spend(ledger, attention.site, now, spent);
  ledgerDirty = true;
  attention = null;
}

function openSegment(next, now = Date.now()) {
  attention = { ...next, since: now };
  if (lastSite.get(next.windowId) !== next.site) {
    lastSite.set(next.windowId, next.site);
    store.countOpen(ledger, next.site, now);
    ledgerDirty = true;
  }
}

/** Moves attention to whatever is in front, closing the segment behind it. */
async function updateAttention() {
  await ready;
  await applyAttention();
}

async function applyAttention() {
  const next = await currentAttention();
  const now = Date.now();
  if (next === null) {
    closeSegment(now);
    await persistLedger();
    return;
  }
  if (
    attention !== null &&
    attention.site === next.site &&
    attention.windowId === next.windowId
  ) {
    return;
  }
  closeSegment(now);
  openSegment(next, now);
  await persistLedger();
}

/** Reads the running segment up to now without closing it, so a report sees
 *  the time spent so far rather than only what the last flush took. */
function checkpoint(now = Date.now()) {
  if (attention === null || ledger === null) return;
  const spent = now - attention.since;
  if (spent <= 0) return;
  store.spend(ledger, attention.site, now, spent);
  attention = { ...attention, since: now };
  ledgerDirty = true;
}

async function persistLedger() {
  if (ledger === null || !ledgerDirty) return;
  ledgerDirty = false;
  await store.saveLedger(ledger);
}

let flushing = null;
async function flushLedger() {
  if (flushing) return flushing;
  flushing = (async () => {
    await ready;
    if (ledger === null) return;
    const taken = await flush(ledger, settings?.retentionDays ?? 90);
    if (taken) {
      for (const [hour, entries] of Object.entries(taken)) delete ledger[hour];
      await store.saveLedger(ledger);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ------------------------------------------------------------------- session

function syncSession(current, now, { announce = true, quiet = false } = {}) {
  const result = advance(current, now);
  if (announce && !quiet) {
    for (const event of result.events) {
      if (event.kind === "phase") announcePhase(event.began);
    }
  }
  return result;
}

function announcePhase(phase) {
  updateBadge();
  if (settings?.notify !== true || !chrome.notifications) return;
  const copy = {
    focus: { title: m("focus_phase_focus"), body: m("focus_round", { round: 1 }) },
    break: { title: m("focus_break_title"), body: m("focus_phase_break") },
    long_break: { title: m("focus_break_title"), body: m("focus_phase_long_break") },
  };
  const entry = copy[phase] ?? { title: m("focus_done_title"), body: "" };
  try {
    chrome.notifications.create(`focus-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icons/128.png"),
      title: entry.title,
      message: entry.body,
    });
  } catch {
    // A browser without notifications still runs the round.
  }
}

async function persistRecord(record) {
  await flushLedger();
  await store.recordFocus(record);
}

/** Advances the session to `now` and keeps whatever the step produced. */
async function step(now = Date.now()) {
  await ready;
  if (session === null) return null;
  const before = session.phase;
  const result = syncSession(session, now);
  session = result.session;
  if (result.record) {
    await persistRecord(result.record);
    await saveSession(null);
    session = null;
    await releaseCovers();
    updateBadge();
    broadcast();
    schedulePhaseAlarm();
    return null;
  }
  await saveSession(session);
  if (session.phase !== before && session.phase !== "focus") await releaseCovers();
  updateBadge();
  broadcast();
  schedulePhaseAlarm();
  return session;
}

/** A snapshot every surface reads the same way. */
function snapshot() {
  const now = Date.now();
  // The view is the session itself plus what a surface would otherwise
  // recompute: the round it is on, what is left, and how far in it is.
  const view =
    session === null
      ? null
      : {
          ...session,
          round: session.rounds + (session.phase === "focus" ? 1 : 0),
          phase_length_ms: phaseLengthMs(session.plan, session.phase),
          remaining_s: remaining(session, now),
          progress: progress(session, now),
          focused_s: Math.round(seconds(focusedMs(session, now))),
        };
  return {
    session: view,
    minutes: settings?.minutes ?? 25,
    breaks: settings?.breaks ?? false,
    shut: settings?.shut ?? [],
    blocking: settings?.blocking !== false,
    tracking: settings?.tracking !== false,
    openPage: settings?.openPage === true,
    notify: settings?.notify === true,
    retentionDays: settings?.retentionDays ?? 90,
    now,
  };
}

function broadcast() {
  const snap = snapshot();
  chrome.runtime.sendMessage({ type: "focus:changed", snapshot: snap }).catch(() => {
    // No surface is listening; the next one reads the snapshot itself.
  });
  return snap;
}

function updateBadge() {
  if (!chrome.action?.setBadgeText) return;
  if (session === null) {
    void chrome.action.setBadgeText({ text: "" });
    return;
  }
  const left = Math.ceil(remaining(session) / 60);
  void chrome.action.setBadgeText({ text: String(Math.max(0, left)) });
  void chrome.action.setBadgeBackgroundColor({
    color: session.phase === "focus" ? "#4a4a52" : "#2f4a3d",
  });
}

// ----------------------------------------------------------------- commands

async function startFocus({ minutes, breaks }) {
  await ready;
  if (session !== null) return { ok: false, reason: "running" };
  const plan = {
    minutes: Number(minutes ?? settings.minutes) || settings.minutes,
    breaks: breaks === undefined ? settings.breaks : breaks === true,
  };
  session = startSession(plan, Date.now());
  settings = await store.patchSettings({ minutes: plan.minutes, breaks: plan.breaks });
  await saveSession(session);
  await step();
  return { ok: true };
}

async function endFocus() {
  await ready;
  if (session === null) return { ok: false, reason: "idle" };
  const record = stopSession(session, Date.now());
  session = null;
  await persistRecord(record);
  await saveSession(null);
  await releaseCovers();
  updateBadge();
  broadcast();
  schedulePhaseAlarm();
  return { ok: true };
}

async function skipRest() {
  await ready;
  if (session === null || session.phase === "focus") return { ok: false, reason: "focusing" };
  session = skipBreak(session, Date.now());
  await saveSession(session);
  await releaseCovers();
  await step();
  return { ok: true };
}

async function allowSiteThrough(site) {
  await ready;
  if (session === null) return { ok: false, reason: "idle" };
  const result = allowSite(session, site, Date.now());
  if (!result.allowed) return { ok: false, reason: "refused" };
  session = result.session;
  await saveSession(session);
  await step();
  return { ok: true };
}

async function setShut(sites) {
  await ready;
  settings = await store.patchSettings({ shut: sites });
  await step();
  return { ok: true, shut: settings.shut };
}

async function updateSettings(patch) {
  await ready;
  const before = settings;
  settings = await store.patchSettings(patch);
  if (before.tracking && !settings.tracking) {
    closeSegment();
    await persistLedger();
  }
  if (!settings.blocking) await releaseCovers({ onlyShutPages: false });
  if ("openPage" in patch) await applyToolbar();
  if ("minutes" in patch || "breaks" in patch) updateBadge();
  broadcast();
  await updateAttention();
  return { ok: true, settings };
}

async function reportFor({ span = "day", start, site = null }) {
  await ready;
  checkpoint();
  await persistLedger();
  if (ledgerDirty) await store.saveLedger(ledger);
  // Counted time is folded in before reading, so a figure on screen is never
  // older than the moment it was asked for.
  await flushLedger();
  checkpoint();
  const history = await store.loadHistory();
  const period = {
    span: span === "week" ? "week" : "day",
    start: Number.isInteger(start) ? start : span === "week" ? weekStart(localDay()) : localDay(),
  };
  const body = store.report(history, period, site);
  return {
    ...body,
    previous: store.previousTotal(history, period),
    suggestions: store.suggestions(history),
  };
}

async function focusDays({ from, days = 1 }) {
  await ready;
  const stored = await store.loadFocusDays();
  const start = Number.isInteger(from) ? from : localDay();
  const period = { span: days === 1 ? "day" : "week", start };
  return { days: store.focusSeries(stored, period) };
}

// ----------------------------------------------------------------- the gate

async function coverTab(tabId, url, site) {
  const existing = covers.get(tabId);
  if (existing) {
    existing.url = url;
    return;
  }
  covers.set(tabId, { site, url });
  await saveCovers();
  try {
    await chrome.tabs.update(tabId, { url: coverUrl(site) });
  } catch {
    covers.delete(tabId);
    await saveCovers();
  }
}

/** Puts a shut page back once the round lets it through. */
async function releaseCovers({ onlyShutPages = true } = {}) {
  if (covers.size === 0) return;
  const open =
    session !== null && session.phase === "focus" && settings?.blocking !== false;
  for (const [tabId, entry] of [...covers]) {
    if (open && onlyShutPages) continue;
    covers.delete(tabId);
    await saveCovers();
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url?.startsWith(chrome.runtime.getURL("src/pages/cover/"))) {
        await chrome.tabs.update(tabId, { url: entry.url });
      }
    } catch {
      // The tab is gone; nothing to put back.
    }
  }
}

async function gate(tabId, url, incognito = false) {
  await ready;
  if (incognito) return;
  if (session === null || settings?.blocking !== true) return;
  if (!url || !/^https?:/iu.test(url)) return;
  const site = siteOf(url);
  if (site === null) return;
  if (session.phase !== "focus" || Date.now() >= session.phase_ends_ms) return;
  const host = new URL(url).hostname.replace(/\.$/u, "").toLowerCase();
  if (!blocks(session, settings.shut, host)) return;
  await coverTab(tabId, url, site);
}

chrome.webNavigation?.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return;
    void gate(details.tabId, details.url);
  },
  { url: [{ schemes: ["http", "https"] }] },
);

// A page can change its own address without a navigation the browser reports
// as one, so the tab's own updates are watched as well.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url) void gate(tabId, change.url, tab?.incognito === true);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (covers.delete(tabId)) void saveCovers();
  lastSite.delete(tabId);
  void updateAttention();
});

chrome.tabs.onActivated.addListener(() => void updateAttention());
chrome.tabs.onReplaced?.addListener(() => void updateAttention());
chrome.windows.onFocusChanged.addListener(() => void updateAttention());
chrome.windows.onRemoved.addListener(() => void updateAttention());
if (chrome.idle?.onStateChanged) chrome.idle.onStateChanged.addListener(() => void updateAttention());

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await ready;
  if (alarm.name === TICK_ALARM) {
    checkpoint();
    await persistLedger();
    await updateAttention();
    await step();
    if (session !== null) updateBadge();
    return;
  }
  if (alarm.name === "foflow-phase") {
    await step();
    await flushLedger();
  }
});

// --------------------------------------------------------------- messaging

const handlers = {
  "focus:snapshot": () => snapshot(),
  "focus:start": (payload) => startFocus(payload),
  "focus:stop": () => endFocus(),
  "focus:skip": () => skipRest(),
  "focus:allow": ({ site }) => allowSiteThrough(site),
  "focus:shut": ({ sites }) => setShut(sites),
  "focus:settings": (patch) => updateSettings(patch),
  "time:report": (payload) => reportFor(payload),
  "time:focusDays": (payload) => focusDays(payload),
  "time:clear": async () => {
    await store.clearTime();
    ledger = {};
    broadcast();
    return { ok: true };
  },
  "time:open": async ({ span } = {}) => {
    const url = chrome.runtime.getURL("src/pages/time/time.html");
    const existing = await chrome.tabs.query({ url: `${url}*` });
    if (existing[0]?.id) {
      await chrome.tabs.update(existing[0].id, { active: true });
      if (existing[0].windowId) await chrome.windows.update(existing[0].windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: span ? `${url}?span=${span}` : url });
    }
    return { ok: true };
  },
  "cover:state": async ({ site }, sender) => {
    await ready;
    await step();
    const tabId = sender?.tab?.id;
    return { ...snapshot(), site, url: tabId === undefined ? null : (covers.get(tabId)?.url ?? null) };
  },
  "cover:resume": async ({ site }, sender) => {
    const result = await allowSiteThrough(site);
    const url = sender?.tab?.id === undefined ? null : (covers.get(sender.tab.id)?.url ?? null);
    return { ...result, url };
  },
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  Promise.resolve(handler(message, sender))
    .then(reply)
    .catch((error) => reply({ ok: false, reason: String(error?.message ?? error) }));
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if ("settings" in changes) void (async () => {
    settings = await store.loadSettings();
    if (!settings.blocking) await releaseCovers({ onlyShutPages: false });
    void updateAttention();
    broadcast();
    updateBadge();
  })();
});

void boot();
