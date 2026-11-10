// Settings, shaped like the browser's own "Time & focus" section: a card of
// rows, each one a label, a line of help, and a control at the end.
import { el, fill, glyphs } from "../../ui/dom.js";
import { m } from "../../lib/messages.js";

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(reply ?? null);
    });
  });

const groups = document.getElementById("groups");
document.getElementById("lock").append(glyphs.lock(11));

let settings = null;

function row({ label, help, control }) {
  return el(
    "div",
    { class: "row" },
    el("div", { class: "text" }, el("span", { class: "label", text: label }), help
      ? el("span", { class: "help", text: help })
      : null),
    control,
  );
}

function toggle(key) {
  const button = el("button", {
    type: "button",
    class: "switch",
    role: "switch",
    "aria-checked": String(settings[key]),
    "aria-label": key,
    onclick: async () => {
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      settings[key] = next;
      await send({ type: "focus:settings", [key]: next });
      draw();
    },
  });
  return button;
}

function choice(key, options) {
  const select = el(
    "select",
    {
      class: "select",
      onchange: async () => {
        const value = Number(select.value);
        settings[key] = value;
        await send({ type: "focus:settings", [key]: value });
      },
    },
    options.map(([value, label]) =>
      el("option", { value: String(value), selected: Number(settings[key]) === value }, label),
    ),
  );
  return select;
}

function minutes() {
  const input = el("input", {
    class: "number",
    type: "number",
    min: "5",
    max: "180",
    step: "5",
    value: String(settings.minutes),
    "aria-label": m("focus_length"),
    onchange: async () => {
      const value = Math.min(180, Math.max(5, Math.round(Number(input.value) || 25)));
      input.value = String(value);
      settings.minutes = value;
      await send({ type: "focus:settings", minutes: value });
    },
  });
  return el("div", { class: "minutes" }, input, el("span", { class: "unit", text: "min" }));
}

function draw() {
  fill(groups);
  groups.append(
    el(
      "section",
      { class: "group" },
      el("h2", { text: m("focus_title") }),
      row({
        label: m("focus_length"),
        help: "How long one round lasts when you start focus.",
        control: minutes(),
      }),
      row({
        label: m("focus_breaks"),
        help: m("focus_breaks_detail", {
          short: Math.min(20, Math.max(3, Math.floor(settings.minutes / 5))),
          long: Math.min(30, Math.min(20, Math.max(3, Math.floor(settings.minutes / 5))) * 3),
        }),
        control: toggle("breaks"),
      }),
      row({
        label: m("pref_blocking"),
        help: m("pref_blocking_help"),
        control: toggle("blocking"),
      }),
      row({
        label: m("pref_notifications") ?? "Tell me when a phase ends",
        help: "Uses the browser's own notifications; no sound.",
        control: toggle("notify"),
      }),
    ),
    el(
      "section",
      { class: "group" },
      el("h2", { text: m("time_title") }),
      row({
        label: m("pref_tracking"),
        help: m("pref_tracking_help"),
        control: toggle("tracking"),
      }),
      row({
        label: m("pref_retention"),
        help: m("pref_retention_help"),
        control: choice("retentionDays", [
          [30, m("retention_30")],
          [90, m("retention_90")],
          [365, m("retention_365")],
        ]),
      }),
      row({
        label: m("pref_keep_open"),
        help: m("pref_keep_open_help"),
        control: toggle("openPage"),
      }),
      el(
        "div",
        { class: "row" },
        el(
          "div",
          { class: "text" },
          el("span", { class: "label", text: m("pref_clear") }),
          el("span", {
            class: "help",
            text: "Sites and focus rounds are kept; counted time is not.",
          }),
        ),
        clearButton(),
      ),
    ),
  );
}

let confirming = false;
function clearButton() {
  const button = el("button", {
    type: "button",
    class: `button ${confirming ? "danger" : "ghost"}`,
    text: confirming ? m("time_delete_confirm") : m("time_delete"),
    onblur: () => {
      confirming = false;
      draw();
    },
    onclick: async () => {
      if (!confirming) {
        confirming = true;
        draw();
        return;
      }
      confirming = false;
      await send({ type: "time:clear" });
      draw();
    },
  });
  return button;
}

void (async () => {
  const snapshot = await send({ type: "focus:snapshot" });
  settings = {
    minutes: snapshot?.minutes ?? 25,
    breaks: snapshot?.breaks ?? false,
    blocking: snapshot?.blocking !== false,
    tracking: snapshot?.tracking !== false,
    retentionDays: snapshot?.retentionDays ?? 90,
    openPage: snapshot?.openPage === true,
    notify: snapshot?.notify === true,
  };
  draw();
})();

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "focus:changed") draw();
});
