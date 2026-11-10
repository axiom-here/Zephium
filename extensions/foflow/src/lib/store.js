// Everything focus and time need to remember, kept the way Zephium keeps it:
// a session that survives a restart, hour tallies flushed into local days,
// and settings shared with the rest of the extension.
import { localDay, localHour, localMs, HOUR_MS } from "./time.js";
import { valid as sessionValid, MIN_FOCUS_MINUTES, MAX_FOCUS_MINUTES } from "./focus.js";

export const MAX_BLOCKED_SITES = 256;
/** Sites a day keeps; the tail is dropped rather than letting a storm of
 *  one-second visits grow storage without bound. */
export const MAX_SITES_PER_DAY = 400;
export const MAX_SITE_BYTES = 253;
/** Days of history kept whatever the setting says. */
const MAX_DAYS = 366;

export const SETTINGS_DEFAULT = Object.freeze({
  /** Focus length, `focus.minutes` in the browser. */
  minutes: 25,
  /** Repeats focus with breaks, `focus.breaks` in the browser. */
  breaks: false,
  /** Sites shut while a round runs, `focus.blocked` in the browser. */
  shut: [],
  /** Shut sites at all; off keeps the timer only. */
  blocking: true,
  /** Count time on websites, `time.track` in the browser. */
  tracking: true,
  /** Days of counted time kept, `time.retention` in the browser. */
  retentionDays: 90,
  /** The toolbar opens the Time page rather than the popup. */
  openPage: false,
  /** A system notification when a phase ends. */
  notify: false,
});

const KEY = {
  settings: "settings",
  session: "focusSession",
  focusDays: "focusDays",
  history: "timeHistory",
  ledger: "timeLedger",
};

const area = () => chrome.storage.local;

async function read(keys) {
  return area().get(keys);
}

async function write(values) {
  return area().set(values);
}

/**
 * Which keys are settings at all. A message carries its own `type` beside the
 * patch, and a whitelist is the only thing that keeps such a key out of the
 * saved record.
 */
export const SETTING_KEYS = Object.freeze(Object.keys(SETTINGS_DEFAULT));

/** Settings, repaired against the defaults so an older record still opens. */
export function cleanSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = { ...SETTINGS_DEFAULT };
  for (const key of SETTING_KEYS) {
    if (source[key] !== undefined) settings[key] = source[key];
  }
  const minutes = Number(settings.minutes);
  settings.minutes = Number.isFinite(minutes)
    ? Math.min(MAX_FOCUS_MINUTES, Math.max(MIN_FOCUS_MINUTES, Math.round(minutes)))
    : SETTINGS_DEFAULT.minutes;
  settings.breaks = settings.breaks === true;
  settings.blocking = settings.blocking !== false;
  settings.tracking = settings.tracking !== false;
  settings.openPage = settings.openPage === true;
  settings.notify = settings.notify === true;
  const retention = Number(settings.retentionDays);
  settings.retentionDays = [30, 90, 365].includes(retention) ? retention : 90;
  settings.shut = Array.isArray(settings.shut)
    ? settings.shut
        .filter(
          (site) =>
            typeof site === "string" &&
            site.length > 0 &&
            site.length <= MAX_SITE_BYTES &&
            !site.includes("/") &&
            !/\s/u.test(site),
        )
        .slice(0, MAX_BLOCKED_SITES)
    : [];
  return settings;
}

export async function loadSettings() {
  const stored = await read(KEY.settings);
  return cleanSettings(stored[KEY.settings]);
}

export async function saveSettings(settings) {
  const clean = cleanSettings(settings);
  await write({ [KEY.settings]: clean });
  return clean;
}

export async function patchSettings(patch) {
  const current = await loadSettings();
  return saveSettings({ ...current, ...patch });
}

export async function loadSession() {
  const stored = await read(KEY.session);
  const session = stored[KEY.session];
  return sessionValid(session) ? session : null;
}

export async function saveSession(session) {
  if (session === null) await area().remove(KEY.session);
  else await write({ [KEY.session]: session });
}

export async function loadFocusDays() {
  const stored = await read(KEY.focusDays);
  const days = stored[KEY.focusDays];
  return days && typeof days === "object" ? days : {};
}

/** Keeps one finished session against the day it began on. */
export async function recordFocus(record) {
  const days = await loadFocusDays();
  const day = String(localDay(new Date(record.started_ms)));
  const entry = days[day] ?? { seconds: 0, sessions: 0, completed: 0 };
  days[day] = {
    seconds: Math.max(0, Math.round(entry.seconds + record.focused_ms / 1000)),
    sessions: entry.sessions + 1,
    completed: entry.completed + (record.completed ? 1 : 0),
  };
  await write({ [KEY.focusDays]: pruneFocusDays(days) });
  return days[day];
}

function pruneFocusDays(days) {
  const oldest = localDay() - MAX_DAYS;
  for (const key of Object.keys(days)) {
    if (!/^\d+$/u.test(key) || Number(key) < oldest) delete days[key];
  }
  return days;
}

/** Focus for the days of a period, in order. */
export function focusSeries(days, period) {
  const count = period.span === "day" ? 1 : 7;
  return Array.from({ length: count }, (_, index) => {
    const day = period.start + index;
    const entry = days[String(day)];
    return {
      day,
      seconds: entry?.seconds ?? 0,
      sessions: entry?.sessions ?? 0,
      completed: entry?.completed ?? 0,
    };
  });
}

/** Tallies not yet in history,
 *  keyed by local hour of the epoch and then by site. */
export async function loadLedger() {
  const stored = await read(KEY.ledger);
  const ledger = stored[KEY.ledger];
  return ledger && typeof ledger === "object" ? ledger : {};
}

export async function saveLedger(ledger) {
  await write({ [KEY.ledger]: ledger });
}

function tallyIn(ledger, hour, site) {
  const hours = (ledger[String(hour)] ??= {});
  return (hours[site] ??= { ms: 0, opens: 0 });
}

/** Adds one segment, spread across the hours it covers, back from its end —
 *  the same placement the browser's own ledger uses. */
export function spend(ledger, site, endMs, durationMs) {
  let left = Math.max(0, Math.round(durationMs));
  let localEnd = localMs(new Date(endMs));
  while (left > 0) {
    const hourStart = Math.floor((localEnd - 1) / HOUR_MS) * HOUR_MS;
    const within = localEnd - hourStart;
    const taken = Math.min(left, Math.max(1, within));
    tallyIn(ledger, hourStart / HOUR_MS, site).ms += taken;
    left -= taken;
    localEnd -= taken;
  }
  return ledger;
}

/** One site newly come to. */
export function countOpen(ledger, site, atMs) {
  tallyIn(ledger, localHour(new Date(atMs)), site).opens += 1;
  return ledger;
}

export function ledgerIsEmpty(ledger) {
  return Object.keys(ledger).length === 0;
}

export async function loadHistory() {
  const stored = await read(KEY.history);
  const history = stored[KEY.history];
  return history && typeof history === "object" && history.days ? history : { days: {} };
}

export async function saveHistory(history) {
  await write({ [KEY.history]: history });
}

/** Folds the ledger into history and empties the hours it took. A day is
 *  written as its 24 buckets plus each site's own hours, which is what the
 *  Time page reads back. */
export async function flush(rawLedger) {
  const hours = Object.keys(rawLedger);
  if (hours.length === 0) return null;
  const history = await loadHistory();
  const taken = {};
  for (const hourKey of hours) {
    const hour = Number(hourKey);
    const entries = rawLedger[hourKey];
    if (!Number.isSafeInteger(hour) || !entries || typeof entries !== "object") {
      taken[hourKey] = entries;
      continue;
    }
    const day = String(Math.floor(hour / 24));
    const hourOfDay = ((hour % 24) + 24) % 24;
    const bucket = (history.days[day] ??= { buckets: {}, sites: {} });
    bucket.buckets ??= {};
    bucket.sites ??= {};
    for (const [site, tally] of Object.entries(entries)) {
      if (!tally || typeof tally !== "object") continue;
      const ms = Math.max(0, Math.round(Number(tally.ms) || 0));
      const opens = Math.max(0, Math.round(Number(tally.opens) || 0));
      if (ms > 0) bucket.buckets[hourOfDay] = (bucket.buckets[hourOfDay] ?? 0) + ms;
      if (ms > 0 || opens > 0) {
        const entry = (bucket.sites[site] ??= { ms: 0, opens: 0, hours: {} });
        entry.ms += ms;
        entry.opens += opens;
        if (ms > 0) entry.hours[hourOfDay] = (entry.hours[hourOfDay] ?? 0) + ms;
      }
    }
    // What the caller may forget: exactly the hours folded in above.
    taken[hourKey] = entries;
  }
  trimHistory(history);
  await saveHistory(history);
  return taken;
}

/** Drops days past retention, and a day's sites past the cap. */
export function trimHistory(history, retentionDays = 90) {
  const oldest = localDay() - Math.max(1, Math.min(MAX_DAYS, retentionDays)) + 1;
  for (const [day, bucket] of Object.entries(history.days)) {
    if (!/^\d+$/u.test(day)) {
      delete history.days[day];
      continue;
    }
    if (Number(day) < oldest) {
      delete history.days[day];
      continue;
    }
    const sites = Object.entries(bucket.sites ?? {});
    if (sites.length > MAX_SITES_PER_DAY) {
      sites
        .sort((a, b) => (b[1]?.ms ?? 0) - (a[1]?.ms ?? 0))
        .slice(MAX_SITES_PER_DAY)
        .forEach(([site]) => delete bucket.sites[site]);
    }
  }
  return history;
}

/** What a Time surface shows: bucket totals and ranked sites, with the
 *  per-bucket series carried for the leading sites only — the same shape the
 *  browser's report has. */
export function report(history, period, site = null) {
  const count = period.span === "day" ? 24 : 7;
  const buckets = new Array(count).fill(0);
  const sites = new Map();
  const days =
    period.span === "day"
      ? [period.start]
      : Array.from({ length: 7 }, (_, index) => period.start + index);
  days.forEach((day, dayIndex) => {
    const bucket = history.days[String(day)];
    if (!bucket) return;
    for (const [hourKey, ms] of Object.entries(bucket.buckets ?? {})) {
      const hour = Number(hourKey);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      buckets[period.span === "day" ? hour : dayIndex] += Math.max(0, Number(ms) || 0);
    }
    for (const [name, entry] of Object.entries(bucket.sites ?? {})) {
      if (site !== null && name !== site) continue;
      const held =
        sites.get(name) ??
        { site: name, ms: 0, opens: 0, series: new Array(count).fill(0), hours: {} };
      held.ms += Math.max(0, Number(entry?.ms) || 0);
      held.opens += Math.max(0, Math.round(Number(entry?.opens) || 0));
      for (const [hourKey, ms] of Object.entries(entry?.hours ?? {})) {
        const hour = Number(hourKey);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
        held.series[period.span === "day" ? hour : dayIndex] += Math.max(0, Number(ms) || 0);
      }
      sites.set(name, held);
    }
  });
  const ranked = [...sites.values()].sort(
    (a, b) => b.ms - a.ms || (a.site < b.site ? -1 : a.site > b.site ? 1 : 0),
  );
  return {
    span: period.span,
    start: period.start,
    buckets: buckets.map((ms) => Math.round(ms / 1000)),
    total: Math.round(buckets.reduce((sum, value) => sum + value, 0) / 1000),
    sites: ranked.map((entry, index) => ({
      site: entry.site,
      seconds: Math.round(entry.ms / 1000),
      opens: entry.opens,
      series: index < 4 ? entry.series.map((ms) => Math.round(ms / 1000)) : [],
    })),
  };
}

/** The same span just before, in seconds, for the comparison line. */
export function previousTotal(history, period) {
  const start = period.span === "day" ? period.start - 1 : period.start - 7;
  const days =
    period.span === "day" ? [start] : Array.from({ length: 7 }, (_, index) => start + index);
  let total = 0;
  for (const day of days) {
    const bucket = history.days[String(day)];
    if (!bucket) continue;
    for (const ms of Object.values(bucket.buckets ?? {})) total += Math.max(0, Number(ms) || 0);
  }
  return Math.round(total / 1000);
}

/** Sites ranked by counted time, newest days first, for the suggestions focus
 *  offers. Never a shipped list: only where the reader has actually been. */
export function suggestions(history, limit = 4) {
  const totals = new Map();
  const days = Object.keys(history.days).sort((a, b) => Number(b) - Number(a)).slice(0, 30);
  for (const day of days) {
    for (const [site, entry] of Object.entries(history.days[day]?.sites ?? {})) {
      totals.set(site, (totals.get(site) ?? 0) + Math.max(0, Number(entry?.ms) || 0));
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([site]) => site);
}

export async function clearTime() {
  await area().remove([KEY.history, KEY.ledger]);
}

export { KEY as STORAGE_KEYS };
