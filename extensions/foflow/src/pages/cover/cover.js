// Stands where a shut page would be while a focus round runs. The page itself
// is off the stage; this says why, how long, and offers the two honest ways out.
import { button, el, fill } from "../../ui/dom.js";
import { ring } from "../../ui/ring.js";
import { siteMark } from "../../ui/sites.js";
import { m } from "../../lib/messages.js";
import { countdown } from "../../lib/time.js";
import { remaining } from "../../lib/focus.js";

const site = new URLSearchParams(location.search).get("site") ?? "";
const stage = document.getElementById("stage");

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(reply ?? null);
    });
  });

let snapshot = null;
let now = Date.now();
let confirming = false;
let busy = false;

document.title = `${site} — ${m("focus_cover_title")}`;

function draw() {
  const session = snapshot?.session ?? null;
  fill(stage);

  if (session === null) {
    // The round ended between ticks: the page is free to come back.
    stage.append(
      el(
        "div",
        { class: "panel" },
        el("h1", { id: "title", text: m("focus_title") }),
        el("p", { text: site }),
        button(m("focus_start"), {
          variant: "primary",
          size: "regular",
          onclick: () => void start(),
        }),
      ),
    );
    return;
  }

  const actions = el(
    "div",
    { class: "actions" },
    button(m("focus_cover_allow"), {
      size: "regular",
      pending: busy,
      onclick: () => void allow(),
    }),
    button(confirming ? m("focus_end_confirm") : m("focus_cover_end"), {
      size: "regular",
      variant: confirming ? "danger" : "ghost",
      onblur: () => {
        confirming = false;
        draw();
      },
      onclick: () => {
        if (!confirming) {
          confirming = true;
          draw();
          return;
        }
        void end();
      },
    }),
  );

  stage.append(
    el(
      "div",
      { class: "panel" },
      ring({
        value:
          1 -
          Math.min(
            1,
            Math.max(0, (now - session.phase_started_ms) / (session.phase_ends_ms - session.phase_started_ms)),
          ),
        size: 176,
        stroke: 8,
        tone: session.phase === "focus" ? "lead" : "rest",
        label: m("focus_cover_left"),
        center: [
          el("span", { class: "clock", text: countdown(remaining(session, now)) }),
          el("span", { class: "left", text: m("focus_cover_left") }),
        ],
      }),
      el("span", { class: "site" }, siteMark(site, 16), el("span", { text: site })),
      el("h1", { id: "title", text: m("focus_cover_title") }),
      el("p", { text: m("focus_cover_body", { site }) }),
      actions,
    ),
  );
}

async function refresh() {
  snapshot = await send({ type: "cover:state", site });
  if (snapshot?.session === null) {
    // Nothing holds this page any more; put the reader where they were.
    location.replace(pendingUrl() ?? `https://${site}/`);
    return;
  }
  draw();
}

async function start() {
  busy = true;
  await send({ type: "focus:start" });
  await refresh();
  busy = false;
}

async function allow() {
  busy = true;
  draw();
  const reply = await send({ type: "cover:resume", site });
  busy = false;
  if (reply?.ok) {
    location.replace(reply.url ?? pendingUrl() ?? `https://${site}/`);
    return;
  }
  draw();
}

async function end() {
  confirming = false;
  await send({ type: "focus:stop" });
  await refresh();
}

let original = null;
function pendingUrl() {
  return original;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "focus:changed") return;
  const next = message.snapshot;
  const before = snapshot?.session;
  snapshot = next;
  if (next?.session === null) {
    location.replace(pendingUrl() ?? `https://${site}/`);
    return;
  }
  // A new phase opens the page again; a break is not a shut round.
  if (before && next?.session && next.session.phase !== "focus") {
    location.replace(pendingUrl() ?? `https://${site}/`);
    return;
  }
  draw();
});

setInterval(() => {
  if (document.visibilityState !== "visible") return;
  now = Date.now();
  const session = snapshot?.session;
  if (session && now >= session.phase_ends_ms) {
    void refresh();
    return;
  }
  draw();
}, 1000);

void (async () => {
  snapshot = await send({ type: "cover:state", site });
  original = snapshot?.url ?? null;
  now = Date.now();
  if (snapshot?.session === null) {
    location.replace(`https://${site}/`);
    return;
  }
  draw();
})();
