// Time per bucket as quiet columns, ported from `frame/src/shared/ui/data/Bars`:
// each bar is a full-height plate slid down inside a clipped track, so it rises
// by transform alone and keeps its rounded cap at every height.
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
 */
export function bars({
  values,
  highlight = null,
  live = -1,
  average = null,
  ticks = [],
  label,
  describe,
  height = 196,
  selected = -1,
}) {
  const count = values.length;
  let hover = -1;

  const peak = Math.max(average ?? 0, ...values, 1);
  const scale = timeScale(peak);
  const percent = (value) => Math.min(100, Math.max(0, (value / scale.top) * 100));
  // A bar with any time stands at least a few pixels tall, so a minute reads
  // as a minute rather than as nothing.
  const shown = (value) => (value > 0 ? Math.max(percent(value), (3 / height) * 100) : 0);

  const plot = el("div", {
    class: "plot",
    role: "slider",
    tabindex: "0",
    "aria-label": label,
    "aria-valuemin": "0",
    "aria-valuemax": String(Math.max(0, count - 1)),
    "aria-valuenow": String(Math.max(0, live)),
    "aria-valuetext": live >= 0 ? `${describe(live)}: ${duration(values[live] ?? 0)}` : label,
  });

  for (const line of gridLines(scale)) {
    plot.append(
      el(
        "span",
        { class: "rule", style: { bottom: `${percent(line)}%` } },
        el("span", { class: "value", text: duration(line) }),
      ),
    );
  }
  if (average !== null && average > 0) {
    plot.append(el("span", { class: "average", style: { bottom: `${percent(average)}%` } }));
  }

  const columnNodes = [];
  const columns = el("div", { class: "columns" });
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    const column = el(
      "span",
      {
        class: `column ${index === live ? "live" : ""} ${highlight !== null ? "dimmed" : ""}`,
        style: { "--rise": `${index * 14}ms` },
      },
      el(
        "span",
        { class: "track" },
        value > 0
          ? el("span", {
              class: "bar",
              style: { transform: `translateY(${100 - shown(value)}%)` },
            })
          : el("span", { class: "stub" }),
        highlight !== null && (highlight[index] ?? 0) > 0
          ? el("span", {
              class: "bar part",
              style: { transform: `translateY(${100 - shown(highlight[index] ?? 0)}%)` },
            })
          : null,
      ),
    );
    columnNodes.push(column);
    columns.append(column);
  }
  plot.append(columns);

  const readout = el("span", { class: "readout", "aria-hidden": "true", hidden: true });
  plot.append(readout);

  const point = (event) => {
    const box = plot.getBoundingClientRect();
    const width = box.width - (plot.offsetWidth - columns.offsetWidth);
    if (width <= 0) return;
    const x = event.clientX - box.left;
    const index = Math.min(count - 1, Math.max(0, Math.floor((x / columns.offsetWidth) * count)));
    if (index === hover) return;
    hover = index;
    columnNodes.forEach((node, at) => {
      node.classList.toggle("active", at === index);
      if (at === index) node.querySelectorAll(".bar").forEach((bar) => bar.classList.add("hot"));
      else node.querySelectorAll(".bar").forEach((bar) => bar.classList.remove("hot"));
    });
    fill(readout, el("span", { class: "when", text: describe(index) }), el("span", {
      class: "amount",
      text: duration(highlight?.[index] ?? values[index] ?? 0),
    }));
    readout.hidden = false;
    const half = readout.offsetWidth / 2 || 0;
    const center = ((index + 0.5) / count) * columns.offsetWidth;
    const left = Math.min(Math.max(center, half), Math.max(half, columns.offsetWidth - half));
    readout.style.insetInlineStart = `${left}px`;
  };
  plot.addEventListener("pointermove", point);
  plot.addEventListener("pointerleave", () => {
    hover = -1;
    readout.hidden = true;
    columnNodes.forEach((node) => {
      node.classList.remove("active");
      node.querySelectorAll(".bar").forEach((bar) => bar.classList.remove("hot"));
    });
  });

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
                  tick.index === 0 && count > 7
                    ? "0px"
                    : `${((tick.index + 0.5) / Math.max(1, count)) * 100}%`,
              },
              text: tick.label,
            }),
          ),
        )
      : null,
  );

  const figure = el("figure", { class: "bars axis", style: { "--plot-height": `${height}px` } }, plot);
  return figure;
}
