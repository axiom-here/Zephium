// Focus is one dial, ported from `frame/src/features/time/components/FocusCard`.
// At rest its centre is the length, which opens the choices; running, it
// empties toward the end of the phase. The layout stays put between the two,
// so starting reads as the dial coming alive.
import { button, el, faviconMark, fill, glyphs, iconButton } from "./dom.js";
import { ring } from "./ring.js";
import { openMenu } from "./menu.js";
import { m } from "../lib/messages.js";
import { countdown, clockLabel } from "../lib/time.js";
import { remaining } from "../lib/focus.js";
import { normalizeSite } from "../lib/site.js";

const LENGTHS = [15, 25, 30, 45, 50, 60, 90];

/**
 * @param {object} options
 * @param {() => object} options.snapshot  the latest state, read when drawn
 * @param {(patch: object) => Promise<object>} options.update  settings changes
 * @param {object} options.actions  focus commands
 * @param {"panel" | "page"} [options.size]
 * @param {boolean} [options.manageInPlace]  whether the shut editor opens here
 * @param {() => void} [options.onmanage]  where shut sites are managed instead
 * @param {() => void} [options.onchange]  asked to redraw after a change
 */
export function focusCard({
  snapshot,
  update,
  actions,
  size = "panel",
  manageInPlace = false,
  onmanage,
  onchange,
}) {
  let now = Date.now();
  let confirming = false;
  let editing = false;
  let busy = false;
  let timer = null;
  /** A command this card sent that the engine refused. The engine's own
   *  failure flag is read too, but a refusal arrives as a reply and would
   *  otherwise be lost on the redraw that follows it. */
  let refused = false;

  const root = el("section", { class: `focus card ${size === "page" ? "page" : ""}` });
  const body = el("div", { class: "body" });
  const editor = el("div", { class: "editor" });
  const failed = el("p", { class: "failed", role: "alert", hidden: true }, m("focus_failed"));
  root.append(body, editor, failed);

  const pace = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (document.visibilityState !== "visible") return;
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      drawLive();
    }, 1000);
  };
  document.addEventListener("visibilitychange", pace);

  /** A running phase only updates what changes: the clock and the arc. */
  function drawLive() {
    const snap = snapshot();
    if (snap.session === null) return;
    const length = snap.session.phase_ends_ms - snap.session.phase_started_ms;
    const left = length > 0 ? 1 - Math.min(1, Math.max(0, (now - snap.session.phase_started_ms) / length)) : 1;
    const clock = root.querySelector(".clock");
    if (clock) clock.textContent = countdown(remaining(snap.session, now));
    const arc = root.querySelector(".dial .arc");
    if (arc) {
      const radius = Number(arc.getAttribute("r"));
      arc.setAttribute("stroke-dashoffset", 2 * Math.PI * radius * (1 - left));
    }
    root.querySelector(".dial")?.setAttribute("aria-valuenow", String(Math.round(left * 100)));
    // A phase that ends while this is open redraws into its next shape.
    if (now >= snap.session.phase_ends_ms) void actions.sync().then(onchange);
  }

  const dialSize = () => (size === "page" ? 148 : 112);
  const dialStroke = () => (size === "page" ? 8 : 6);

  async function run(task) {
    if (busy) return null;
    busy = true;
    refused = false;
    draw();
    let result = null;
    try {
      result = await task();
      refused = Boolean(result && result.ok === false && result.reason !== "running");
    } catch {
      refused = true;
    } finally {
      busy = false;
      onchange?.();
      draw();
    }
    return result;
  }

  function openLengths(trigger) {
    const snap = snapshot();
    openMenu(trigger, {
      align: "start",
      label: m("focus_length"),
      items: [
        ...LENGTHS.map((length) => ({
          id: String(length),
          label: m("focus_minutes", { minutes: length }),
          checked: length === snap.minutes,
          onselect: () => {
            if (length === snapshot().minutes) return;
            void run(() => update({ minutes: length }));
          },
        })),
        { kind: "separator" },
        {
          id: "breaks",
          label: m("focus_breaks"),
          checked: snap.breaks,
          onselect: () => void run(() => update({ breaks: !snapshot().breaks })),
        },
      ],
    });
  }

  function manage() {
    if (onmanage) onmanage();
    else {
      editing = !editing;
      draw();
    }
  }

  function draw() {
    const snap = snapshot();
    const session = snap.session;
    const shut = snap.shut;
    fill(body);
    fill(editor);
    failed.hidden = !(refused || snap.failed === true);

    if (session === null) {
      const lengthButton = el(
        "button",
        {
          type: "button",
          class: "focus-length",
          "aria-label": `${m("focus_length")}: ${m("focus_minutes", { minutes: snap.minutes })}`,
          "aria-haspopup": "menu",
          "aria-expanded": "false",
          onclick: (event) => {
            event.stopPropagation();
            openLengths(event.currentTarget);
          },
        },
        el("span", { class: "length", text: String(snap.minutes) }),
        el("span", { class: "unit" }, "min", glyphs.chevronDown(10)),
      );
      body.append(
        el("div", { class: "dial" }, ring({ value: 0, size: dialSize(), stroke: dialStroke() }), lengthButton),
        el(
          "div",
          { class: "facts" },
          el("h3", { text: m("focus_title") }),
          el(
            "button",
            { type: "button", class: "shut", "aria-expanded": String(editing), onclick: manage },
            shut.length === 0
              ? m("focus_none_shut")
              : shut.length === 1
                ? m("focus_shut_one")
                : m("focus_shut_count", { count: shut.length }),
          ),
          el(
            "div",
            { class: "actions" },
            button(m("focus_start"), {
              variant: "primary",
              size: size === "page" ? "regular" : "compact",
              pending: busy,
              onclick: () => run(() => actions.start(snap.minutes, snap.breaks)),
            }),
          ),
        ),
      );
    } else {
      const resting = session.phase !== "focus";
      const length = session.phase_ends_ms - session.phase_started_ms;
      const left = length > 0 ? 1 - Math.min(1, Math.max(0, (now - session.phase_started_ms) / length)) : 1;
      const phaseLabel =
        session.phase === "focus"
          ? m("focus_phase_focus")
          : session.phase === "break"
            ? m("focus_phase_break")
            : m("focus_phase_long_break");
      const facts = el(
        "div",
        { class: "facts" },
        el("h3", { text: phaseLabel }),
        el(
          "span",
          { class: "detail" },
          `${m("focus_round", { round: session.rounds + (session.phase === "focus" ? 1 : 0) })} · ${m(
            "focus_until",
            { time: clockLabel(session.phase_ends_ms) },
          )}`,
        ),
        !resting && shut.length > 0
          ? el(
              "button",
              { type: "button", class: "shut", onclick: manage },
              shut.length === 1 ? m("focus_shut_one") : m("focus_shut_count", { count: shut.length }),
            )
          : null,
        el(
          "div",
          { class: "actions" },
          resting ? button(m("focus_skip_break"), { onclick: () => run(() => actions.skip()) }) : null,
          button(confirming ? m("focus_end_confirm") : m("focus_end"), {
            variant: confirming ? "danger" : null,
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
              void run(() => actions.stop());
            },
          }),
        ),
      );
      body.append(
        el(
          "div",
          { class: "dial live" },
          ring({
            value: left,
            size: dialSize(),
            stroke: dialStroke(),
            tone: resting ? "rest" : "lead",
            label: phaseLabel,
            center: el("span", { class: "clock", text: countdown(remaining(session, now)) }),
          }),
        ),
        facts,
      );
    }

    if (editing && manageInPlace) {
      editor.append(
        el(
          "div",
          { class: "editor-inner" },
          el("h4", { text: m("focus_shut_title") }),
          shutEditor({ snapshot, update, onchange: draw }).root,
        ),
      );
    }
  }

  draw();
  pace();
  return {
    root,
    draw,
    /** A surface that read the engine's own failure flag says so here. */
    setFailed(shown) {
      refused = Boolean(shown);
      failed.hidden = !refused;
    },
    dispose() {
      if (timer !== null) clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", pace);
    },
  };
}

/**
 * The sites a focus round keeps shut. Suggestions come from the reader's own
 * time, never from a list shipped with the extension.
 */
export function shutEditor({ snapshot, update, onchange }) {
  const input = el("input", {
    type: "text",
    class: "field",
    inputmode: "url",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "2048",
    placeholder: m("focus_shut_placeholder"),
    "aria-label": m("focus_shut_placeholder"),
  });
  const invalid = el("p", { class: "invalid", role: "alert", hidden: true }, m("focus_shut_invalid"));
  const suggested = el("div", { class: "suggested" });
  const list = el("ul", { class: "shut-list", "aria-label": m("focus_shut_title") });

  const save = (sites) => update({ shut: sites.slice(0, 256) });

  const add = (value) => {
    const site = normalizeSite(value);
    if (site === null) {
      invalid.hidden = false;
      input.setAttribute("aria-invalid", "true");
      return;
    }
    invalid.hidden = true;
    input.removeAttribute("aria-invalid");
    input.value = "";
    const sites = snapshot().shut;
    if (!sites.includes(site)) void save([...sites, site]).then(onchange);
    onchange?.();
  };

  const form = el(
    "form",
    {
      class: "add",
      onsubmit: (event) => {
        event.preventDefault();
        add(input.value);
      },
    },
    input,
    el("button", { type: "submit", class: "button add-button" }, glyphs.plus(13), m("focus_shut_add")),
  );

  const root = el("div", { class: "shut-editor" }, form, invalid, suggested, list);

  function render() {
    const snap = snapshot();
    const sites = snap.shut ?? [];
    fill(list);
    if (sites.length === 0) {
      list.append(el("li", { class: "none-row" }, m("focus_none_shut")));
    }
    for (const site of sites) {
      list.append(
        el(
          "li",
          {},
          faviconMark(site),
          el("span", { class: "name", text: site }),
          iconButton(m("focus_shut_remove", { site }), glyphs.close, {
            onclick: () => void save(sites.filter((kept) => kept !== site)).then(onchange),
          }),
        ),
      );
    }
    fill(suggested);
    const offered = (snap.suggestions ?? [])
      .filter((site) => !sites.some((shut) => covers(shut, site)))
      .slice(0, 4);
    if (offered.length > 0) {
      suggested.append(
        el("span", { class: "caption", text: m("focus_suggested") }),
        el(
          "div",
          { class: "chips" },
          offered.map((site) =>
            el(
              "button",
              { type: "button", class: "chip", onclick: () => add(site) },
              faviconMark(site, { size: 14 }),
              el("span", { text: site }),
              glyphs.plus(11),
            ),
          ),
        ),
      );
    }
  }

  render();
  return { root, render };
}

function covers(shut, site) {
  return site === shut || site.endsWith(`.${shut}`);
}
