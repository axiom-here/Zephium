// Settings, shaped like the browser's own "Time & focus" section: a card of
// rows, each one a label, a line of help, and a control at the end. The theme
// is a real menu rather than the browser's own select, so it matches the
// extension and follows the chosen theme.
import { el, fill, glyphs, iconButton } from "../../ui/dom.js";
import { themeButton, THEMES } from "../../ui/theme.js";
import { openMenu, isOpen } from "../../ui/menu.js";
import { m } from "../../lib/messages.js";

const send = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (reply) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(reply ?? null);
    });
  });

const $ = (id) => document.getElementById(id);
let settings = null;
let theme = document.documentElement.dataset.themeChoice ?? "system";

// ------------------------------------------------------------------- chrome

{
  const back = $("back");
  back.querySelector(".arrow").append(glyphs.arrowLeft(15));
  back.addEventListener("click", () => {
    // Settings is opened from the Time page, so back is the Time page; a tab
    // opened by itself has no history and opens one instead.
    if (history.length > 1) history.back();
    else void send({ type: "time:open" });
  });
  $("toolbar-end").append(
    iconButton("Open the Time page", glyphs.clock, {
      onclick: () => void send({ type: "time:open" }),
    }),
    themeButton({ onchange: (next) => {
      theme = next;
      draw();
    } }),
  );
  $("lock").append(glyphs.lock(11));
}

// -------------------------------------------------------------------- rows

function row({ label, help, control }) {
  return el(
    "div",
    { class: "row" },
    el(
      "div",
      { class: "text" },
      el("span", { class: "label", text: label }),
      help ? el("span", { class: "help", text: help }) : null,
    ),
    control,
  );
}

function toggle(key, label) {
  return el("button", {
    type: "button",
    class: "switch",
    role: "switch",
    "aria-checked": String(settings[key]),
    "aria-label": label,
    onclick: async (event) => {
      const button = event.currentTarget;
      const next = button.getAttribute("aria-checked") !== "true";
      button.setAttribute("aria-checked", String(next));
      settings[key] = next;
      await send({ type: "focus:settings", [key]: next });
    },
  });
}

/** A row control that opens the extension's own menu. */
function chooser({ label, value, items }) {
  const trigger = el(
    "button",
    {
      type: "button",
      class: "select-trigger",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-label": label,
      onclick: () => openMenu(trigger, { align: "end", label, items }),
    },
    el("span", { text: value() }),
    glyphs.chevronDown(12),
  );
  return trigger;
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
      draw();
    },
  });
  return el("div", { class: "minutes" }, input, el("span", { class: "unit", text: "min" }));
}

let confirming = false;

function draw() {
  fill($("groups"));

  const breaks = Math.min(20, Math.max(3, Math.floor(settings.minutes / 5)));
  const themeLabel = THEMES.find((entry) => entry.id === theme)?.label ?? "Follow the system";

  $("groups").append(
    el(
      "section",
      { class: "group" },
      el("h2", { text: m("focus_title") }),
      row({
        label: m("focus_length"),
        help: m("settings_round_help"),
        control: minutes(),
      }),
      row({
        label: m("focus_breaks"),
        help: m("focus_breaks_detail", { short: breaks, long: Math.min(30, breaks * 3) }),
        control: toggle("breaks", m("focus_breaks")),
      }),
      row({
        label: m("pref_blocking"),
        help: m("pref_blocking_help"),
        control: toggle("blocking", m("pref_blocking")),
      }),
      row({
        label: m("pref_notifications"),
        help: m("pref_notifications_help"),
        control: toggle("notify", m("pref_notifications")),
      }),
    ),
    el(
      "section",
      { class: "group" },
      el("h2", { text: m("time_title") }),
      row({
        label: m("pref_tracking"),
        help: m("pref_tracking_help"),
        control: toggle("tracking", m("pref_tracking")),
      }),
      row({
        label: m("pref_retention"),
        help: m("pref_retention_help"),
        control: chooser({
          label: m("pref_retention"),
          value: () => m(`retention_${settings.retentionDays}`),
          items: [
            { id: "30", label: m("retention_30"), checked: settings.retentionDays === 30 },
            { id: "90", label: m("retention_90"), checked: settings.retentionDays === 90 },
            { id: "365", label: m("retention_365"), checked: settings.retentionDays === 365 },
          ].map((entry) => ({
            ...entry,
            onselect: async () => {
              settings.retentionDays = Number(entry.id);
              await send({ type: "focus:settings", retentionDays: Number(entry.id) });
              draw();
            },
          })),
        }),
      }),
      row({
        label: m("pref_keep_open"),
        help: m("pref_keep_open_help"),
        control: toggle("openPage", m("pref_keep_open")),
      }),
      row({
        label: m("pref_clear"),
        help: m("pref_clear_help"),
        control: el("button", {
          type: "button",
          class: `button ${confirming ? "danger" : "ghost"}`,
          text: confirming ? m("time_delete_confirm") : m("pref_clear"),
          onblur: () => {
            if (!confirming) return;
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
        }),
      }),
    ),
    el(
      "section",
      { class: "group" },
      el("h2", { text: m("settings_appearance") }),
      row({
        label: m("theme"),
        help: m("settings_theme_help"),
        control: chooser({
          label: m("theme"),
          value: () => themeLabel,
          items: THEMES.map((entry) => ({
            id: entry.id,
            label: entry.label,
            checked: entry.id === theme,
            onselect: async () => {
              const { setTheme } = await import("../../ui/theme.js");
              theme = await setTheme(entry.id);
              draw();
            },
          })),
        }),
      }),
    ),
  );
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
  theme = document.documentElement.dataset.themeChoice ?? "system";
  draw();
})();

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !isOpen(document.body)) history.length > 1 ? history.back() : null;
});
