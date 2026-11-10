// Stands where a shut page would be while a focus round runs. The page itself
// is off the stage; this says why, how long, and offers the two honest ways out.
import { button, el, faviconMark, fill } from "../../ui/dom.js";
import { ring } from "../../ui/ring.js";
import { themeButton } from "../../ui/theme.js";
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
let original = null;
let now = Date.now();
let confirming = false;
let busy = false;

document.title = `${site} — ${m("focus_cover_title")}`;
document.body.append(themeButton());

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

  const length = session.phase_ends_ms - session.phase_started_ms;
  const left = length > 0 ? 1 - Math.min(1, Math.max(0, (now - session.phase_started_ms) / length)) : 1;
  stage.append(
    el(
      "div",
      { class: "panel" },
      el(
        "div",
        { class: "ring-wrap" },
        ring({
          value: left,
          size: 176,
          stroke: 8,
          tone: session.phase === "focus" ? "lead" : "rest",
          label: m("focus_cover_left"),
          center: [
            el("span", { class: "clock", text: countdown(remaining(session, now)) }),
            el("span", { class: "left", text: m("focus_cover_left") }),
          ],
        }),
      ),
      el("span", { class: "site" }, faviconMark(site, { size: 16 }), el("span", { text: site })),
      el("h1", { id: "title", text: m("focus_cover_title") }),
      el("p", { text: m("focus_cover_body", { site }) }),
      el(
        "div",
        { class: "actions" },
        button(m("focus_cover_allow"), {
          size: "regular",
          variant: "primary",
          pending: busy,
          onclick: () => void allow(),
        }),
        button(confirming ? m("focus_end_confirm") : m("focus_cover_end"), {
          size: "regular",
          variant: confirming ? "danger" : "ghost",
          onblur: () => {
            if (!confirming) return;
            confirming = false;
            draw();
          },
          onclick: (event) => {
            if (!confirming) {
              confirming = true;
              draw();
              return;
            }
            confirming = false;
            event.currentTarget.blur();
            void end();
          },
        }),
      ),
    ),
  );
}

function leave() {
  location.replace(original ?? `https://${site}/`);
}

async function refresh() {
  snapshot = await send({ type: "cover:state", site });
  original = snapshot?.url ?? original;
  if (snapshot?.session === null) {
    leave();
    return;
  }
  draw();
}

async function start() {
  busy = true;
  draw();
  await send({ type: "focus:start" });
  busy = false;
  await refresh();
}

async function allow() {
  busy = true;
  draw();
  const reply = await send({ type: "cover:resume", site });
  busy = false;
  if (reply?.ok) {
    location.replace(reply.url ?? original ?? `https://${site}/`);
    return;
  }
  draw();
}

async function end() {
  confirming = false;
  await send({ type: "focus:stop" });
  await refresh();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "focus:changed") return;
  const before = snapshot?.session;
  snapshot = message.snapshot;
  if (snapshot?.session === null) {
    leave();
    return;
  }
  // A break is not a shut round, so the page opens again.
  if (before && snapshot?.session && snapshot.session.phase !== "focus") {
    leave();
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
    leave();
    return;
  }
  draw();
})();
