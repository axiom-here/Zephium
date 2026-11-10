// Focus sessions, ported from `crates/zephium-core/src/time.rs`: the same
// phases, the same break cadence, the same allowance rule, so a round here
// runs exactly as it does in Zephium.

export const MIN_FOCUS_MINUTES = 5;
export const MAX_FOCUS_MINUTES = 180;
/** A long break follows every fourth focus round. */
export const ROUNDS_PER_LONG_BREAK = 4;
/** Allowances one session holds at once; each is one site let through. */
export const MAX_ALLOWANCES = 32;
export const ALLOWANCE_MS = 5 * 60_000;
export const MINUTE_MS = 60_000;

export const PHASES = ["focus", "break", "long_break"];

/** Short and long break minutes: 25 rests 5 and 15, the classic cadence, and
 *  longer rounds rest in proportion up to half an hour. */
export function breakMinutes(minutes) {
  const short = Math.min(20, Math.max(3, Math.floor(minutes / 5)));
  return { short, long: Math.min(30, short * 3) };
}

export function planValid(plan) {
  return (
    plan !== null &&
    typeof plan === "object" &&
    Number.isInteger(plan.minutes) &&
    plan.minutes >= MIN_FOCUS_MINUTES &&
    plan.minutes <= MAX_FOCUS_MINUTES &&
    typeof plan.breaks === "boolean"
  );
}

export function phaseLengthMs(plan, phase) {
  const minutes =
    phase === "focus"
      ? plan.minutes
      : phase === "break"
        ? breakMinutes(plan.minutes).short
        : breakMinutes(plan.minutes).long;
  return minutes * MINUTE_MS;
}

export function start(plan, now = Date.now()) {
  if (!planValid(plan)) throw new Error("Invalid focus plan");
  return {
    plan: { minutes: plan.minutes, breaks: plan.breaks },
    started_ms: now,
    phase: "focus",
    phase_started_ms: now,
    phase_ends_ms: now + phaseLengthMs(plan, "focus"),
    rounds: 0,
    focused_ms: 0,
    allowances: [],
  };
}

/** A session restored from storage is trusted only if it is coherent. */
export function valid(session) {
  return (
    session !== null &&
    typeof session === "object" &&
    planValid(session.plan) &&
    Number.isFinite(session.started_ms) &&
    Number.isFinite(session.phase_started_ms) &&
    Number.isFinite(session.phase_ends_ms) &&
    session.started_ms <= session.phase_started_ms &&
    session.phase_started_ms < session.phase_ends_ms &&
    PHASES.includes(session.phase) &&
    Number.isInteger(session.rounds) &&
    session.rounds >= 0 &&
    Number.isFinite(session.focused_ms) &&
    session.focused_ms >= 0 &&
    Array.isArray(session.allowances) &&
    session.allowances.length <= MAX_ALLOWANCES &&
    session.allowances.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        Number.isFinite(entry[1]),
    )
  );
}

/** Focus time in finished rounds plus the running one. */
export function focusedMs(session, now = Date.now()) {
  const running =
    session.phase === "focus"
      ? Math.max(0, Math.min(now, session.phase_ends_ms) - session.phase_started_ms)
      : 0;
  return session.focused_ms + running;
}

function record(session, endedMs, completed) {
  return {
    started_ms: session.started_ms,
    ended_ms: endedMs,
    focused_ms: session.focused_ms,
    rounds: session.rounds,
    completed,
  };
}

/** Runs the clock forward to `now`. A long sleep may cross several phases at
 *  once, so it repeats until the session has caught up. */
export function advance(session, now = Date.now()) {
  const next = {
    ...session,
    allowances: session.allowances.filter(([, until]) => until > now),
  };
  const events = [];
  let finished = null;
  while (now >= next.phase_ends_ms) {
    const ended = next.phase;
    const endedAt = next.phase_ends_ms;
    if (ended === "focus") {
      next.rounds += 1;
      next.focused_ms += next.phase_ends_ms - next.phase_started_ms;
      if (!next.plan.breaks) {
        events.push({ kind: "finished" });
        finished = record(next, endedAt, true);
        return { session: next, events, record: finished, finished: true };
      }
    }
    const began =
      ended === "focus"
        ? next.rounds % ROUNDS_PER_LONG_BREAK === 0
          ? "long_break"
          : "break"
        : "focus";
    next.phase = began;
    next.phase_started_ms = endedAt;
    next.phase_ends_ms = endedAt + phaseLengthMs(next.plan, began);
    events.push({ kind: "phase", ended, began });
  }
  return { session: next, events, record: null, finished: false };
}

/** Ends the session now. Rounds of a repeating session count as finished
 *  work, so stopping one is a completion once a round is done. */
export function stop(session, now = Date.now()) {
  const done = record(session, now, session.plan.breaks && session.rounds > 0);
  done.focused_ms = focusedMs(session, now);
  return done;
}

/** Skips a break, the way children of the same session do in Zephium: the
 *  break ends and the next focus round begins at this moment. */
export function skipBreak(session, now = Date.now()) {
  if (session.phase === "focus") return session;
  return {
    ...session,
    phase: "focus",
    phase_started_ms: now,
    phase_ends_ms: now + phaseLengthMs(session.plan, "focus"),
  };
}

/** Whether `host` is shut right now. Breaks open everything. */
export function blocks(session, shut, host, now = Date.now()) {
  if (session === null || session.phase !== "focus" || now >= session.phase_ends_ms) return false;
  const target = String(host ?? "")
    .trim()
    .replace(/\.$/u, "")
    .toLowerCase();
  if (!target) return false;
  const covered = shut.some((site) => coversHost(site, target));
  if (!covered) return false;
  return !session.allowances.some(([site, until]) => until > now && coversHost(site, target));
}

function coversHost(site, host) {
  return host === site || (host.endsWith(site) && host[host.length - site.length - 1] === ".");
}

/** Lets `site` through for the allowance window, or until this round ends. */
export function allow(session, site, now = Date.now()) {
  if (session.phase !== "focus") return { session, allowed: false };
  const kept = session.allowances.filter(([name, until]) => until > now && name !== site);
  if (kept.length >= MAX_ALLOWANCES) return { session, allowed: false };
  const until = Math.min(now + ALLOWANCE_MS, session.phase_ends_ms);
  return { session: { ...session, allowances: [...kept, [site, until]] }, allowed: true };
}

/** The next moment the session changes on its own. */
export function nextChangeMs(session) {
  return session.allowances.reduce(
    (earliest, [, until]) => Math.min(earliest, until),
    session.phase_ends_ms,
  );
}

/** Seconds left in the running phase. */
export function remaining(session, now = Date.now()) {
  return Math.max(0, (session.phase_ends_ms - now) / 1000);
}

/** Phase progress from 0 to 1. */
export function progress(session, now = Date.now()) {
  const length = session.phase_ends_ms - session.phase_started_ms;
  return length > 0
    ? Math.min(1, Math.max(0, (now - session.phase_started_ms) / length))
    : 1;
}
