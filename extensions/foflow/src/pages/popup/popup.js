// Time in the toolbar: focus, today's figures, and where the time went.
// Everything deeper lives on the Time page, one click away.
import { focusCard } from "../../ui/focus-card.js";
import { siteList } from "../../ui/sites.js";
import { glyphs, el, fill } from "../../ui/dom.js";
import { m } from "../../lib/messages.js";
import { duration } from "../../lib/time.js";

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(reply ?? null);
    });
  });

let snapshot = null;
let report = null;
let focusDays = [];

document.getElementById("open-glyph").append(glyphs.clock(15));
document.getElementById("settings-glyph").append(glyphs.settings(15));
document.getElementById("open-page").addEventListener("click", async () => {
  await send({ type: "time:open" });
  window.close();
});
document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

const card = focusCard({
  snapshot: () => snapshot ?? empty(),
  update: async (patch) => {
    const reply = await send({ type: "focus:settings", ...patch });
    await refresh();
    return reply;
  },
  actions: {
    start: (minutes, breaks) => send({ type: "focus:start", minutes, breaks }).then(after),
    stop: () => send({ type: "focus:stop" }).then(after),
    skip: () => send({ type: "focus:skip" }).then(after),
    sync: () => send({ type: "focus:snapshot" }).then(after),
  },
  size: "panel",
  manageInPlace: true,
  onchange: () => void refresh(),
});
document.getElementById("focus").append(card.root);

const sites = siteList({ sites: [], total: 0, size: "panel" });
document.getElementById("sites").append(sites.root);

function empty() {
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
  await refresh();
  return reply;
}

async function refresh() {
  const [next, today, focused] = await Promise.all([
    send({ type: "focus:snapshot" }),
    send({ type: "time:report", span: "day" }),
    send({ type: "time:focusDays", days: 1 }),
  ]);
  if (next) snapshot = next;
  if (today) report = today;
  if (focused?.days) focusDays = focused.days;
  draw();
}

function draw() {
  const total = report?.total ?? 0;
  const stats = document.getElementById("stats");
  const day = focusDays[0] ?? { seconds: 0, sessions: 0, completed: 0 };
  fill(stats);
  stats.append(
    el(
      "div",
      { class: "stat" },
      el("span", { class: "value", text: duration(total) }),
      el("span", { class: "label", text: m("time_on_web") }),
    ),
    el("span", { class: "divider", "aria-hidden": "true" }),
    el(
      "div",
      { class: "stat" },
      el("span", { class: "value", text: duration(day.seconds) }),
      el("span", { class: "label", text: m("focus_focused") }),
    ),
  );
  fill(document.getElementById("sites"));
  document.getElementById("sites").append(
    el("h3", { class: "section-title", text: m("time_sites") }),
  );
  sites.update((report?.sites ?? []).slice(0, 4));
  document.getElementById("sites").append(sites.root);
  fill(document.getElementById("local"), glyphs.lock(11), el("span", { text: m("time_local_only") }));
  card.draw();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "focus:changed") return;
  snapshot = message.snapshot;
  draw();
});

void refresh();
