// Focus is one dial, ported from `frame/src/features/time/components/FocusCard`.
// At rest its centre is the length, which opens the choices; running, it
// empties toward the end of the phase. The layout stays put between the two,
// so starting reads as the dial coming alive.
import { button, el, fill, glyphs, iconButton } from "./dom.js";
import { ring } from "./ring.js";
import { m } from "../lib/messages.js";
import { countdown, clockLabel } from "../lib/time.js";
import { remaining } from "../lib/focus.js";
import { normalizeSite } from "../lib/site.js";

const LENGTHS = [15, 25, 30, 45, 50, 60, 90];

/**
 * @param {object} options
 * @param {() => object} options.snapshot  the latest state, read when drawn
 * @param {(patch: object) => Promise<void>} options.update  settings changes
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
  let opened = false;
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

  function drawLive() {
    const snap = snapshot();
    if (snap.session === null) return;
    const clock = root.querySelector(".clock");
    const arc = root.querySelector(".dial .arc");
    const dial = root.querySelector(".dial");
    if (clock) clock.textContent = countdown(remaining(snap.session, now));
    const length = snap.session.phase_ends_ms - snap.session.phase_started_ms;
    if (arc && length > 0) {
      const left = 1 - Math.min(1, Math.max(0, (now - snap.session.phase_started_ms) / length));
      const radius = Number(arc.getAttribute("r"));
      const circumference = 2 * Math.PI * radius;
      arc.setAttribute("stroke-dashoffset", circumference * (1 - left));
      if (dial) dial.setAttribute("aria-valuenow", String(Math.round(left * 100)));
    }
    const badge = root.querySelector(".left");
    if (badge) badge.textContent = countdown(remaining(snap.session, now));
    // A phase that ends while this is open redraws into its next shape.
    if (now >= snap.session.phase_ends_ms) {
      void actions.sync().then(onchange);
    }
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    refused = false;
    draw();
    try {
      const result = await task();
      refused = Boolean(result && result.ok === false && result.reason !== "running");
    } catch {
      refused = true;
    } finally {
      busy = false;
      onchange?.();
      draw();
    }
  }

  function chooseLength(minutes) {
    opened = false;
    void run(() => update({ minutes }));
  }

  function drawChoices(anchor) {
    root.querySelector(".length-menu")?.remove();
    if (!opened) return;
    const snap = snapshot();
    const menu = el("div", { class: "length-menu", role: "menu" });
    for (const length of LENGTHS) {
      menu.append(
        el(
          "button",
          {
            type: "button",
            role: "menuitemradio",
            "aria-checked": String(length === snap.minutes),
            class: length === snap.minutes ? "chosen" : null,
            onclick: () => chooseLength(length),
          },
          m("focus_minutes", { minutes: length }),
        ),
      );
    }
    menu.append(el("div", { class: "separator", role: "separator" }));
    menu.append(
      el(
        "button",
        {
          type: "button",
          role: "menuitemcheckbox",
          "aria-checked": String(snap.breaks),
          class: snap.breaks ? "chosen" : null,
          onclick: () => {
            opened = false;
            void run(() => update({ breaks: !snapshot().breaks }));
          },
        },
        m("focus_breaks"),
      ),
    );
    anchor.append(menu);
    menu.querySelector("button")?.focus();
  }

  function draw() {
    const snap = snapshot();
    const session = snap.session;
    const shut = snap.shut;
    fill(body);
    fill(editor);
    failed.hidden = !(refused || snap.failed === true);

    if (session === null) {
      const dial = snap.minutes;
      const lengthButton = el(
        "button",
        {
          type: "button",
          class: "focus-length",
          "aria-label": `${m("focus_length")}: ${m("focus_minutes", { minutes: dial })}`,
          "aria-expanded": String(opened),
          "aria-haspopup": "menu",
          onclick: (event) => {
            event.stopPropagation();
            opened = !opened;
            draw();
            const anchor = root.querySelector(".dial");
            if (anchor) drawChoices(anchor);
            if (!opened) anchor?.querySelector(".focus-length")?.focus();
          },
        },
        el("span", { class: "length", text: String(dial) }),
        el("span", { class: "unit" }, "min", glyphs.chevronDown(11)),
      );
      const dialNode = el(
        "div",
        { class: "dial" },
        ring({ value: 0, size: size === "page" ? 148 : 112, stroke: size === "page" ? 8 : 6 }),
        lengthButton,
      );
      const shutLabel =
        shut.length === 0
          ? m("focus_none_shut")
          : shut.length === 1
            ? m("focus_shut_one")
            : m("focus_shut_count", { count: shut.length });
      const facts = el(
        "div",
        { class: "facts" },
        el("h3", { text: m("focus_title") }),
        el(
          "button",
          {
            type: "button",
            class: "shut",
            onclick: () => {
              if (onmanage) onmanage();
              else {
                editing = !editing;
                draw();
              }
            },
          },
          shutLabel,
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
      );
      body.append(dialNode, facts);
      return;
    }

    const resting = session.phase !== "focus";
    const phaseLabel =
      session.phase === "focus"
        ? m("focus_phase_focus")
        : session.phase === "break"
          ? m("focus_phase_break")
          : m("focus_phase_long_break");
    const dialNode = el(
      "div",
      { class: "dial live" },
      ring({
        value:
          1 -
          Math.min(
            1,
            Math.max(0, (now - session.phase_started_ms) / (session.phase_ends_ms - session.phase_started_ms)),
          ),
        size: size === "page" ? 148 : 112,
        stroke: size === "page" ? 8 : 6,
        tone: resting ? "rest" : "lead",
        label: phaseLabel,
        center: el("span", { class: "clock", text: countdown(remaining(session, now)) }),
      }),
    );
    const facts = el(
      "div",
      { class: "facts" },
      el("h3", { text: phaseLabel }),
      el(
        "span",
        { class: "detail" },
        `${m("focus_round", {
          round: session.rounds + (session.phase === "focus" ? 1 : 0),
        })} · ${m("focus_until", {
          time: clockLabel(session.phase_ends_ms),
        })}`,
      ),
      !resting && shut.length > 0
        ? el(
            "button",
            {
              type: "button",
              class: "shut",
              onclick: () => {
                if (onmanage) onmanage();
                else {
                  editing = !editing;
                  draw();
                }
              },
            },
            shut.length === 1 ? m("focus_shut_one") : m("focus_shut_count", { count: shut.length }),
          )
        : null,
      el(
        "div",
        { class: "actions" },
        resting
          ? button(m("focus_skip_break"), { onclick: () => run(() => actions.skip()) })
          : null,
        button(confirming ? m("focus_end_confirm") : m("focus_end"), {
          variant: confirming ? "danger" : null,
          onblur: () => {
            confirming = false;
          },
          onclick: () => {
            if (!confirming) {
              confirming = true;
              draw();
              return;
            }
            confirming = false;
            void run(() => actions.stop());
          },
        }),
      ),
    );
    body.append(dialNode, facts);

    if (editing && manageInPlace) {
      root.classList.add("editing");
      editor.append(
        el(
          "div",
          { class: "editor-inner" },
          el("h4", { text: m("focus_shut_title") }),
          shutEditor({ snapshot, update, onchange: draw }),
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
      document.removeEventListener("visibilitychange", pace);
    },
  };
}

/** The sites a focus round keeps shut. Suggestions come from the reader's own
 *  time, never from a list shipped with the extension. */
export function shutEditor({ snapshot, update, onchange }) {
  const draftInput = el("input", {
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
  const list = el("ul", { class: "shut-list", "aria-label": m("focus_shut_title") });
  const suggested = el("div", { class: "suggested" });

  const save = (sites) => update({ shut: sites.slice(0, 256) });

  const add = (input) => {
    const site = normalizeSite(input);
    if (site === null) {
      invalid.hidden = false;
      return;
    }
    invalid.hidden = true;
    draftInput.value = "";
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
        add(draftInput.value);
      },
    },
    draftInput,
    el(
      "button",
      { type: "submit", class: "submit" },
      glyphs.plus(13),
      m("focus_shut_add"),
    ),
  );

  const view = el("div", { class: "shut-editor" }, form, invalid, suggested, list);

  function render() {
    const snap = snapshot();
    const sites = snap.shut;
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
              {
                type: "button",
                class: "chip",
                onclick: () => add(site),
              },
              faviconMark(site, 14),
              el("span", { text: site }),
              glyphs.plus(12),
            ),
          ),
        ),
      );
    }
  }

  render();
  return Object.assign(view, { render });
}

function faviconMark(site, size = 16) {
  const image = el("img", {
    class: "favicon",
    alt: "",
    width: size,
    height: size,
    loading: "lazy",
    decoding: "async",
    src: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(site)}.ico`,
  });
  image.addEventListener("error", () => {
    image.replaceWith(
      el("span", {
        class: "favicon letter",
        style: {
          inlineSize: `${size}px`,
          blockSize: `${size}px`,
          fontSize: `${Math.round(size * 0.6)}px`,
        },
        text: (site[0] ?? "?").toUpperCase(),
        "aria-hidden": "true",
      }),
    );
  });
  return image;
}

function covers(shut, site) {
  return site === shut || site.endsWith(`.${shut}`);
}
