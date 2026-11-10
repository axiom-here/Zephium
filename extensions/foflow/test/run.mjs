// Run with: node extensions/foflow/test/run.mjs
// The suite covers the places a port drifts: the phase machine, the gate,
// allowances, site matching, the ledger and the report shape.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOWANCE_MS,
  MAX_ALLOWANCES,
  advance,
  allow,
  blocks,
  breakMinutes,
  focusedMs,
  nextChangeMs,
  phaseLengthMs,
  progress,
  remaining,
  skipBreak,
  start,
  stop,
  valid,
} from "../src/lib/focus.js";
import { normalizeSite, siteCovers, siteOf } from "../src/lib/site.js";
import { duration, countdown, currentPeriod, liveBucket, localDay, weekStart } from "../src/lib/time.js";
import { cleanSettings, report, spend, countOpen, flushLedger, suggestions } from "./shim.js";

const MIN = 60_000;

test("a round starts focused and ends when the plan says", () => {
  const session = start({ minutes: 25, breaks: false }, 1_000);
  assert.equal(session.phase, "focus");
  assert.equal(session.phase_ends_ms, 1_000 + 25 * MIN);
  assert.equal(session.rounds, 0);
  assert.equal(valid(session), true);
});

test("breaks follow the browser's cadence: a fifth of the round, 3 to 20, long is triple", () => {
  assert.deepEqual(breakMinutes(25), { short: 5, long: 15 });
  assert.deepEqual(breakMinutes(50), { short: 10, long: 30 });
  assert.deepEqual(breakMinutes(5), { short: 3, long: 9 });
  assert.deepEqual(breakMinutes(180), { short: 20, long: 30 });
});

test("a repeating session walks focus, break, focus and a long break every fourth", () => {
  let session = start({ minutes: 25, breaks: true }, 0);
  const seen = [session.phase];
  // Fast-forward a whole cycle: four rounds and their breaks.
  let now = 0;
  for (let step = 0; step < 8; step += 1) {
    now = session.phase_ends_ms;
    const result = advance(session, now);
    session = result.session;
    seen.push(session.phase);
  }
  assert.deepEqual(seen, [
    "focus",
    "break",
    "focus",
    "break",
    "focus",
    "break",
    "focus",
    "long_break",
    "focus",
  ]);
  assert.equal(session.rounds, 4);
});

test("a single round finishes instead of breaking", () => {
  const session = start({ minutes: 25, breaks: false }, 0);
  const result = advance(session, 25 * MIN);
  assert.equal(result.finished, true);
  assert.equal(result.record.completed, true);
  assert.equal(result.record.focused_ms, 25 * MIN);
  assert.equal(result.record.rounds, 1);
});

test("a long sleep crosses several phases and reports each in order", () => {
  const session = start({ minutes: 25, breaks: true }, 0);
  // 25 focus + 5 break + 25 focus + 5 break = 60 minutes.
  const result = advance(session, 60 * MIN);
  assert.equal(result.session.phase, "focus");
  assert.equal(result.session.rounds, 2);
  assert.equal(result.events.length, 4);
  assert.deepEqual(
    result.events.map((event) => `${event.ended}->${event.began}`),
    ["focus->break", "break->focus", "focus->break", "break->focus"],
  );
});

test("an invalid session is refused rather than resumed", () => {
  assert.equal(valid(null), false);
  assert.equal(valid({}), false);
  const good = start({ minutes: 25, breaks: false }, 1000);
  assert.equal(valid(good), true);
  assert.equal(valid({ ...good, phase_ends_ms: good.phase_started_ms }), false);
  assert.equal(valid({ ...good, plan: { minutes: 1, breaks: false } }), false);
  assert.equal(valid({ ...good, plan: { minutes: 200, breaks: false } }), false);
});

test("focused time counts the running round, clamped at its end", () => {
  const session = start({ minutes: 25, breaks: false }, 0);
  assert.equal(focusedMs(session, 10 * MIN), 10 * MIN);
  assert.equal(focusedMs(session, 30 * MIN), 25 * MIN);
  // A repeating session opens a break at the end, which adds no focus of its own.
  const repeating = start({ minutes: 25, breaks: true }, 0);
  const rest = advance(repeating, 25 * MIN).session;
  assert.equal(rest.phase, "break");
  assert.equal(focusedMs(rest, 27 * MIN), 25 * MIN);
});

test("a shut site is blocked during a round, open during a break", () => {
  const session = start({ minutes: 25, breaks: true }, 0);
  assert.equal(blocks(session, ["youtube.com"], "youtube.com", MIN), true);
  assert.equal(blocks(session, ["youtube.com"], "m.youtube.com", MIN), true);
  assert.equal(blocks(session, ["youtube.com"], "notyoutube.com", MIN), false);
  assert.equal(blocks(session, ["youtube.com"], "youtube.com.evil.test", MIN), false);
  assert.equal(blocks(session, [], "youtube.com", MIN), false);
  const resting = advance(session, 25 * MIN).session;
  assert.equal(resting.phase, "break");
  assert.equal(blocks(resting, ["youtube.com"], "youtube.com", 26 * MIN), false);
});

test("an allowance opens one site for five minutes, capped at the round's end", () => {
  const session = start({ minutes: 25, breaks: false }, 0);
  const { session: allowed } = allow(session, "youtube.com", MIN);
  assert.equal(blocks(allowed, ["youtube.com"], "youtube.com", 2 * MIN), false);
  assert.equal(blocks(allowed, ["youtube.com"], "m.youtube.com", 2 * MIN), false);
  // An allowance opens one site; a site that was never shut stays open.
  assert.equal(blocks(allowed, ["youtube.com"], "github.com", 2 * MIN), false);
  assert.equal(blocks(allowed, ["youtube.com", "github.com"], "github.com", 2 * MIN), true);
  // Five minutes from the allowance, and not a millisecond more.
  assert.equal(blocks(allowed, ["youtube.com"], "youtube.com", MIN + ALLOWANCE_MS - 1), false);
  assert.equal(blocks(allowed, ["youtube.com"], "youtube.com", MIN + ALLOWANCE_MS), true);
  // A short round ends the allowance with it.
  const short = start({ minutes: 5, breaks: false }, 0);
  const { session: held } = allow(short, "youtube.com", 4 * MIN);
  assert.equal(held.allowances[0][1], 5 * MIN);
});

test("allowances are bounded and only during a focus phase", () => {
  let session = start({ minutes: 25, breaks: false }, 0);
  for (let index = 0; index < MAX_ALLOWANCES; index += 1) {
    const result = allow(session, `site${index}.test`, MIN);
    assert.equal(result.allowed, true);
    session = result.session;
  }
  assert.equal(allow(session, "one-too-many.test", MIN).allowed, false);
  const resting = { ...session, phase: "break" };
  assert.equal(allow(resting, "youtube.com", MIN).allowed, false);
});

test("the next change is the earliest of the phase end and an allowance", () => {
  const session = start({ minutes: 25, breaks: true }, 0);
  assert.equal(nextChangeMs(session), 25 * MIN);
  const { session: allowed } = allow(session, "youtube.com", MIN);
  assert.equal(nextChangeMs(allowed), MIN + ALLOWANCE_MS);
});

test("stopping a repeating session counts a finished round as a completion", () => {
  const session = start({ minutes: 25, breaks: true }, 0);
  // Stopped after the first round: one finished round is a completion.
  const early = stop(session, 30 * MIN);
  assert.equal(early.rounds, 0);
  assert.equal(early.completed, false);
  // Stopped inside the first round: nothing to complete yet.
  const nothing = stop(session, 10 * MIN);
  assert.equal(nothing.rounds, 0);
  assert.equal(nothing.completed, false);
  const afterOne = advance(session, 30 * MIN).session;
  const record = stop(afterOne, 32 * MIN);
  assert.equal(record.rounds, 1);
  assert.equal(record.completed, true);
  // The break counted nothing, and the second round had two minutes in it.
  assert.equal(record.focused_ms, 27 * MIN);
});

test("skipping a break begins the next round now; skipping focus does nothing", () => {
  const session = start({ minutes: 25, breaks: true }, 0);
  const resting = advance(session, 25 * MIN).session;
  assert.equal(resting.phase, "break");
  const skipped = skipBreak(resting, 26 * MIN);
  assert.equal(skipped.phase, "focus");
  assert.equal(skipped.phase_ends_ms, 26 * MIN + 25 * MIN);
  assert.equal(skipBreak(session, MIN).phase_ends_ms, session.phase_ends_ms);
});

test("remaining, progress and the ring agree at the edges", () => {
  const session = start({ minutes: 10, breaks: false }, 0);
  assert.equal(remaining(session, 0), 600);
  assert.equal(remaining(session, 20 * MIN), 0);
  assert.equal(progress(session, 0), 0);
  assert.equal(progress(session, 5 * MIN), 0.5);
  assert.equal(progress(session, 20 * MIN), 1);
});

test("sites are one registrable domain, and hosts without a suffix stay whole", () => {
  assert.equal(siteOf("https://www.youtube.com/watch?v=1"), "youtube.com");
  assert.equal(siteOf("https://m.youtube.com/"), "youtube.com");
  assert.equal(siteOf("https://news.bbc.co.uk/story"), "bbc.co.uk");
  assert.equal(siteOf("https://foo.github.io/page"), "foo.github.io");
  assert.equal(siteOf("http://localhost:3000/"), null);
  assert.equal(siteOf("http://127.0.0.1:8080/"), null);
  assert.equal(siteOf("chrome://extensions"), null);
  assert.equal(siteOf("not a url"), null);
});

test("site matching covers subdomains and nothing that merely ends in the name", () => {
  assert.equal(siteCovers("youtube.com", "youtube.com"), true);
  assert.equal(siteCovers("youtube.com", "m.youtube.com"), true);
  assert.equal(siteCovers("youtube.com", "notyoutube.com"), false);
  assert.equal(siteCovers("youtube.com", "youtube.com.evil.test"), false);
});

test("a typed site is normalized the way the browser matches it", () => {
  assert.equal(normalizeSite("https://www.YouTube.com/watch"), "youtube.com");
  assert.equal(normalizeSite("youtube.com"), "youtube.com");
  assert.equal(normalizeSite("  reddit.com/r/all "), "reddit.com");
  assert.equal(normalizeSite("localhost"), null);
  assert.equal(normalizeSite("127.0.0.1"), null);
  assert.equal(normalizeSite("file:///etc/passwd"), null);
  assert.equal(normalizeSite(""), null);
});

test("durations and countdowns read the way the browser writes them", () => {
  assert.equal(countdown(64), "1:04");
  assert.equal(countdown(3725), "1:02:05");
  assert.equal(countdown(0), "0:00");
  assert.match(duration(58), /58/);
  assert.match(duration(0), /0/);
});

test("periods are local days and locale weeks", () => {
  const day = currentPeriod("day", new Date(2026, 10, 10, 15, 0));
  assert.equal(day.start, localDay(new Date(2026, 10, 10, 15, 0)));
  const week = currentPeriod("week", new Date(2026, 10, 10, 15, 0));
  assert.equal(week.start, weekStart(day.start));
  assert.equal(day.start - week.start >= 0 && day.start - week.start < 7, true);
  assert.equal(liveBucket({ span: "day", start: day.start }, new Date(2026, 10, 10, 15, 0)), 15);
  assert.equal(liveBucket({ span: "day", start: day.start }, new Date(2026, 10, 12, 1, 0)), -1);
});

test("the ledger spreads a segment across the hours it covers", () => {
  const ledger = {};
  const base = new Date(2026, 10, 10, 9, 0).getTime();
  spend(ledger, "youtube.com", base + 10 * MIN, 10 * MIN);
  const hours = Object.keys(ledger);
  assert.equal(hours.length, 1);
  const entry = Object.values(ledger[hours[0]])[0];
  assert.equal(entry.ms, 10 * MIN);
});

test("opens are counted as they happen", () => {
  const ledger = {};
  const base = new Date(2026, 10, 10, 9, 0).getTime();
  countOpen(ledger, "github.com", base);
  countOpen(ledger, "github.com", base + MIN);
  const entry = Object.values(Object.values(ledger)[0])[0];
  assert.equal(entry.opens, 2);
});

test("a report ranks sites and carries the leading sites' series", () => {
  const period = { span: "day", start: localDay(new Date(2026, 10, 10, 12, 0)) };
  const history = { days: {} };
  const day = String(period.start);
  history.days[day] = {
    buckets: { 9: 60_000, 10: 30_000 },
    sites: {
      "youtube.com": { ms: 60_000, opens: 1, hours: { 9: 60_000 } },
      "github.com": { ms: 30_000, opens: 2, hours: { 10: 30_000 } },
    },
  };
  const body = report(history, period);
  assert.equal(body.buckets.length, 24);
  assert.equal(body.buckets[9], 60);
  assert.equal(body.total, 90);
  assert.deepEqual(body.sites.map((site) => site.site), ["youtube.com", "github.com"]);
  assert.equal(body.sites[0].opens, 1);
  assert.equal(body.sites[0].series.length, 24);
});

test("settings are repaired rather than trusted", () => {
  const clean = cleanSettings({ minutes: 999, breaks: "yes", shut: ["a.com", "bad/one", 4], retentionDays: 12 });
  assert.equal(clean.minutes, 180);
  assert.equal(clean.breaks, false);
  assert.deepEqual(clean.shut, ["a.com"]);
  assert.equal(clean.retentionDays, 90);
  assert.deepEqual(cleanSettings(null).shut, []);
});

test("suggestions come from counted time, newest first, and nothing else", () => {
  const today = localDay();
  const history = { days: {} };
  history.days[String(today)] = {
    buckets: {},
    sites: { "youtube.com": { ms: 90_000, opens: 1, hours: {} } },
  };
  history.days[String(today - 1)] = {
    buckets: {},
    sites: { "reddit.com": { ms: 500_000, opens: 3, hours: {} } },
  };
  assert.deepEqual(suggestions(history, 2), ["reddit.com", "youtube.com"]);
  assert.deepEqual(suggestions({ days: {} }), []);
});

test("the flush folds hours into days and empties only what it took", () => {
  const ledger = {};
  const base = new Date(2026, 10, 10, 9, 0).getTime();
  spend(ledger, "youtube.com", base + 10 * MIN, 10 * MIN);
  // A fake storage area for the sweep.
  const stored = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])),
        set: async (values) => Object.assign(stored, values),
        remove: async (key) => delete stored[key],
      },
    },
  };
  return flushLedger(ledger).then((taken) => {
    assert.ok(taken && Object.keys(taken).length === 1);
    const history = stored.timeHistory;
    const day = String(localDay(new Date(base)));
    assert.ok(history.days[day], "the day was written");
    assert.equal(history.days[day].sites["youtube.com"].ms, 10 * MIN);
  });
});
