// Time per bucket as the browser draws it, ported from
// `frame/src/shared/ui/data/Bars`: a column per bucket that grows from a dashed
// baseline, hairline rules across the plot with the axis values written at the
// plot's right edge, and tick labels under the baseline. The current bucket's
// label is in ink; the rest are quiet.
//
// The columns are plates slid down inside a clipped track, so a column rises by
// transform alone and keeps its rounded cap at every height.
import { el, fill } from "./dom.js";
import { duration } from "../lib/time.js";

/** Steps a time axis may count in, in seconds: from a minute to six hours. */
const STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

/** The smallest axis of at most `lines` steps that holds `peak`. */
export function timeScale(peak, lines = 3) {
  const value = Math.max(0, peak);
  for (const step of STEPS) {
    if (value <= step * lines) return { top: Math.max(step, Math.ceil(value / step) * step), step };
  }
  const step = STEPS.at(-1);
  return { top: Math.ceil(value / step) * step, step };
}

export function gridLines(scale) {
  const lines = [];
  for (let value = scale.step; value <= scale.top + 0.5; value += scale.step) lines.push(value);
  return lines;
}

/**
 * @param {object} options
 * @param {number[]} options.values        seconds per bucket
 * @param {number[] | null} [options.highlight]  one site's share of each bucket
 * @param {number} [options.live]          the bucket happening now
 * @param {number | null} [options.average]
 * @param {{index: number, label: string}[]} [options.ticks]
 * @param {string} options.label
 * @param {(index: number) => string} options.describe
 * @param {number} [options.height]
 * @param {number} [options.selected]
 * @param {string} [options.summary]       the total, for the figure's caption
 */
export function bars({
  values,
  highlight = null,
  live = -1,
  average = null,
  ticks = [],
  label,
  describe,
  height = 240,
  selected = -1,
  summary = "",
}) {
  const count = Math.max(1, values.length);
  let hover = -1;

  const peak = Math.max(average ?? 0, ...values, 1);
  const scale = timeScale(peak);
  const percent = (value) => Math.min(100, Math.max(0, (value / scale.top) * 100));

  const plot = el("div", {
    class: "plot",
    role: "slider",
    tabindex: "0",
    "aria-label": label,
    "aria-valuemin": "0",
    "aria-valuemax": String(Math.max(0, count - 1)),
    "aria-valuenow": String(Math.max(0, live)),
    "aria-valuetext": live >= 0 ? `${describe(live)}: ${duration(values[live] ?? 0)}` : label,
    style: { "--plot-height": `${height}px` },
  });

  // The rules, and their values at the plot's right edge.
  for (const line of gridLines(scale)) {
    plot.append(
      el(
        "span",
        { class: "rule", style: { bottom: `${percent(line)}%` }, "aria-hidden": "true" },
        el("span", { class: "value", text: duration(line) }),
      ),
    );
  }
  if (average !== null && average > 0) {
    plot.append(el("span", { class: "average", style: { bottom: `${percent(average)}%` } }));
  }

  const columns = el("div", { class: "columns" });
  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    const column = el(
      "span",
      {
        class: `column ${index === live ? "live" : ""} ${highlight !== null ? "dimmed" : ""}`,
        style: { "--rise": `${Math.min(index, 16) * 12}ms` },
      },
      el(
        "span",
        { class: "track" },
        value > 0
          ? el("span", { class: "bar", style: { transform: `translateY(${100 - percent(value)}%)` } })
          : null,
        highlight !== null && (highlight[index] ?? 0) > 0
          ? el("span", {
              class: "bar part",
              style: { transform: `translateY(${100 - percent(highlight[index] ?? 0)}%)` },
            })
          : null,
      ),
    );
    nodes.push(column);
    columns.append(column);
  }
  plot.append(columns);

  const readout = el("span", { class: "readout", "aria-hidden": "true", hidden: true });
  plot.append(readout);

  const hot = (index) => {
    if (index === hover) return;
    hover = index;
    nodes.forEach((node, at) => node.classList.toggle("active", at === index));
    if (index < 0) {
      readout.hidden = true;
      return;
    }
    fill(
      readout,
      el("span", { class: "when", text: describe(index) }),
      el("span", { class: "amount", text: duration(highlight?.[index] ?? values[index] ?? 0) }),
    );
    readout.hidden = false;
    const box = columns.getBoundingClientRect();
    const half = readout.offsetWidth / 2 || 0;
    const center = ((index + 0.5) / count) * box.width;
    readout.style.insetInlineStart = `${Math.min(Math.max(center, half), Math.max(half, box.width - half))}px`;
  };

  plot.addEventListener("pointermove", (event) => {
    const box = columns.getBoundingClientRect();
    if (box.width <= 0) return;
    hot(Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count))));
  });
  plot.addEventListener("pointerleave", () => hot(-1));
  plot.addEventListener("blur", () => hot(-1));

  plot.append(
    ticks.length > 0
      ? el(
          "div",
          { class: "ticks", "aria-hidden": "true" },
          ticks.map((tick) =>
            el("span", {
              class: `${tick.index === live || tick.index === selected ? "current" : ""} ${
                tick.index === 0 && count > 7 ? "first" : ""
              }`,
              style: {
                insetInlineStart:
                  tick.index === 0 && count > 7 ? "0px" : `${((tick.index + 0.5) / count) * 100}%`,
              },
              text: tick.label,
            }),
          ),
        )
      : null,
  );

  return el(
    "figure",
    { class: "bars axis" },
    el("figcaption", { class: "visually-hidden", text: summary ? `${label}: ${summary}` : label }),
    plot,
  );
}
