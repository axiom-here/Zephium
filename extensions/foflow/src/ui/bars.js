// Time per bucket as the browser draws it, ported from
// `frame/src/shared/ui/data/Bars`: a column per bucket standing on a dashed
// baseline, hairline rules across the plot with their values written at the
// plot's right edge, and tick labels under the baseline with the current one in
// ink. The columns are SVG plates, so a column is a rectangle with a rounded
// cap and its height is exactly the value's share of the axis.
import { el, svg } from "./dom.js";
import { duration } from "../lib/time.js";

/** Steps a time axis may count in, in seconds: from a minute to six hours. */
const STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

/**
 * The axis for a `peak`: the smallest step that reaches above it with room to
 * spare, in at most `lines` rules. The headroom matters — a column that touches
 * the top rule reads as clipped rather than as tall.
 */
export function timeScale(peak, lines = 3) {
  const value = Math.max(0, peak);
  const wanted = Math.max(value * 1.15, 60);
  for (const step of STEPS) {
    const top = Math.ceil(wanted / step) * step;
    if (top / step <= lines) return { top, step };
  }
  const step = STEPS.at(-1);
  return { top: Math.ceil(wanted / step) * step, step };
}

export function gridLines(scale) {
  const lines = [];
  for (let value = scale.step; value <= scale.top + 0.5; value += scale.step) lines.push(value);
  return lines;
}

const VIEW = 1000;

/**
 * @param {object} options
 * @param {number[]} options.values         seconds per bucket
 * @param {number[] | null} [options.highlight]  one site's share of each bucket
 * @param {number} [options.live]           the bucket happening now
 * @param {number | null} [options.average]
 * @param {{index: number, label: string}[]} [options.ticks]
 * @param {string} options.label
 * @param {(index: number) => string} options.describe
 * @param {number} [options.height]         plot height in px
 * @param {number} [options.selected]
 * @param {string} [options.summary]        the total, for the figure's caption
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
  summary = "",
}) {
  const count = Math.max(1, values.length);
  const plotHeight = Math.max(80, height);
  let hover = -1;

  const peak = Math.max(average ?? 0, ...values, 1);
  const scale = timeScale(peak);
  const share = (value) => Math.min(1, Math.max(0, value / scale.top));

  // The plot is one coordinate space: 1000 wide, as tall as the caller asks.
  // A bucket slot spans its column plus its gap, and the plot leaves room under
  // the baseline for the hours and at the right for the axis values.
  const tickRoom = 22;
  const plot = svg("svg", {
    class: "plot",
    viewBox: `0 0 ${VIEW} ${plotHeight + tickRoom}`,
    preserveAspectRatio: "none",
    role: "slider",
    tabindex: "0",
    "aria-label": label,
    "aria-valuemin": "0",
    "aria-valuemax": String(Math.max(0, count - 1)),
    "aria-valuenow": String(Math.max(0, live)),
    "aria-valuetext": live >= 0 ? `${describe(live)}: ${duration(values[live] ?? 0)}` : label,
  });

  const layer = (name) => svg("g", { class: name });

  const grid = layer("grid");
  for (const line of gridLines(scale)) {
    const y = plotHeight - share(line) * plotHeight;
    grid.append(svg("line", { x1: 0, x2: VIEW, y1: y, y2: y, class: "rule" }));
  }
  if (average !== null && average > 0) {
    const y = plotHeight - share(average) * plotHeight;
    grid.append(svg("line", { x1: 0, x2: VIEW, y1: y, y2: y, class: "average" }));
  }
  plot.append(grid);

  // One column per bucket, each 60% of its slot so the gaps stay even.
  const columns = layer("columns");
  const slot = VIEW / count;
  const barWidth = Math.max(6, slot * 0.56);
  const nodes = [];
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    const barHeight = share(value) * plotHeight;
    const group = svg("g", { class: "column" });
    if (barHeight > 0.5) {
      group.append(
        svg("rect", {
          class: `bar ${index === live ? "live" : ""} ${highlight !== null ? "dimmed" : ""}`,
          x: index * slot + (slot - barWidth) / 2,
          y: plotHeight - barHeight,
          width: barWidth,
          height: barHeight,
          rx: Math.min(2.5, barWidth / 4),
        }),
      );
    }
    const partHeight = share(highlight?.[index] ?? 0) * plotHeight;
    if (highlight !== null && partHeight > 0.5) {
      group.append(
        svg("rect", {
          class: "part",
          x: index * slot + slot * 0.28,
          y: plotHeight - partHeight,
          width: slot * 0.44,
          height: partHeight,
          rx: Math.min(2.5, barWidth / 4),
        }),
      );
    }
    // A bucket with no time still needs a target for the pointer.
    group.append(svg("rect", { class: "hit", x: index * slot, y: 0, width: slot, height: plotHeight }));
    nodes.push(group);
    columns.append(group);
  }
  plot.append(columns);

  // The values, in the room under the baseline, aligned to each column's centre.
  const hours = layer("hours");
  for (const tick of ticks) {
    const text = svg("text", {
      class: `hour ${tick.index === live || tick.index === selected ? "current" : ""}`,
      x: tick.index === 0 && count > 7 ? 0 : (tick.index + 0.5) * slot,
      y: plotHeight + 15,
      "text-anchor": tick.index === 0 && count > 7 ? "start" : "middle",
    });
    text.textContent = tick.label;
    hours.append(text);
  }
  plot.append(hours);

  const hot = (index) => {
    if (index === hover) return;
    hover = index;
    for (const [at, node] of nodes.entries()) node.classList.toggle("active", at === index);
  };

  plot.addEventListener("pointermove", (event) => {
    const box = plot.getBoundingClientRect();
    if (box.width <= 0) return;
    hot(Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count))));
  });
  plot.addEventListener("pointerleave", () => hot(-1));
  plot.addEventListener("blur", () => hot(-1));

  // The axis values are HTML beside the plot, so they keep their type size while
  // the plot stretches. Each value is placed at its rule's share of the whole
  // drawing — which scales with the figure, so it stays on its rule at any size.
  const drawing = plotHeight + tickRoom;
  const axis = el("div", { class: "axis-values", "aria-hidden": "true" });
  for (const line of [...gridLines(scale)].reverse()) {
    const y = plotHeight - share(line) * plotHeight;
    axis.append(el("span", { text: duration(line), style: { top: `${(y / drawing) * 100}%` } }));
  }

  return el(
    "figure",
    { class: "bars" },
    el("figcaption", { class: "visually-hidden", text: summary ? `${label}: ${summary}` : label }),
    plot,
    axis,
  );
}
