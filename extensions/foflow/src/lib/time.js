// Time as Zephium keeps it: local hours on a wall-clock scale, so a day is
// always 24 hours long even where the offset is not whole hours.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Wall-clock milliseconds as the local zone reads them. */
export function localMs(date = new Date()) {
  return date.getTime() - date.getTimezoneOffset() * MINUTE_MS;
}

/** Local days since the epoch. */
export function localDay(date = new Date()) {
  return Math.floor(localMs(date) / DAY_MS);
}

/** Local hours since the epoch. */
export function localHour(date = new Date()) {
  return Math.floor(localMs(date) / HOUR_MS);
}

/** Local midnight of a local day. */
export function dateOfDay(day) {
  const utc = new Date(day * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** Local midnight of the day `ms` falls on. */
export function startOfDay(ms) {
  return dateOfDay(localDay(new Date(ms))).getTime();
}

/** 1 for Monday through 7 for Sunday, as the reader's locale counts weeks. */
export function firstDayOfWeek(language = globalThis.navigator?.language) {
  try {
    const locale = new Intl.Locale(language ?? "en");
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return first !== undefined && first >= 1 && first <= 7 ? first : 1;
  } catch {
    return 1;
  }
}

/** The first local day of the week holding `day`. Day 0 was a Thursday. */
export function weekStart(day, firstDay = firstDayOfWeek()) {
  const weekday = ((((day + 3) % 7) + 7) % 7) + 1;
  return day - ((weekday - firstDay + 7) % 7);
}

export function currentPeriod(span, now = new Date()) {
  const today = localDay(now);
  return { span, start: span === "day" ? today : weekStart(today) };
}

export function shiftPeriod(period, by) {
  return { span: period.span, start: period.start + by * (period.span === "day" ? 1 : 7) };
}

export function bucketCount(span) {
  return span === "day" ? 24 : 7;
}

/** Which bucket of the period is happening now, or -1 when it is not now. */
export function liveBucket(period, now = new Date()) {
  const ms = localMs(now);
  const index =
    period.span === "day"
      ? Math.floor((ms - period.start * DAY_MS) / HOUR_MS)
      : Math.floor(ms / DAY_MS) - period.start;
  return index >= 0 && index < bucketCount(period.span) ? index : -1;
}

const hourUnit = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "hour",
  unitDisplay: "narrow",
});
const minuteUnit = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "minute",
  unitDisplay: "narrow",
});
const secondUnit = new Intl.NumberFormat(undefined, {
  style: "unit",
  unit: "second",
  unitDisplay: "narrow",
});

/** "4h 52m", "38m", "45s": the two largest units that say something. */
export function duration(totalSeconds) {
  const whole = Math.max(0, Math.round(totalSeconds));
  if (whole < 60) return whole === 0 ? minuteUnit.format(0) : secondUnit.format(whole);
  const totalMinutes = Math.round(whole / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return minuteUnit.format(m);
  return m === 0 ? hourUnit.format(h) : `${hourUnit.format(h)} ${minuteUnit.format(m)}`;
}

/** A countdown as a clock reads it: "18:04", or "1:02:09" past an hour. */
export function countdown(totalSeconds) {
  const whole = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function weekdayLetter(day) {
  return new Intl.DateTimeFormat(undefined, { weekday: "narrow" }).format(dateOfDay(day));
}

export function weekdayShort(day) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateOfDay(day));
}

/** An hour of the day as the locale writes it: "9 AM", "21". */
export function hourLabel(hour) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
}

export function dayLabel(day) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(dateOfDay(day));
}

export function weekLabel(start) {
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  return format.formatRange(dateOfDay(start), dateOfDay(start + 6));
}

/** A wall-clock instant as the short time focus shows: "2:35 PM". */
export function clockLabel(ms) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(ms),
  );
}

/** Seconds as a share of a whole, clamped to 0..1. */
export function share(part, whole) {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
}

/** Seconds per bucket, rounded the way the counters are. */
export function seconds(ms) {
  return Math.max(0, Math.round(ms / 1000));
}
