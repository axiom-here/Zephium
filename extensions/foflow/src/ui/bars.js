// Time per bucket, as the browser draws it: a filled area under a hairline
// curve, with a marker on the hour that is happening and a rule for the
// average. The bars are still here — the area's own edge is the series — but
// the read is a shape rather than a row of competing columns, and it holds up
// when most buckets are empty, which is what a day of browsing looks like.
import { el, fill, svg } from "./dom.js";
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

let gradientCount = 0;

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
 * @param {string} [options.summary]       the total, written by the page
 */
export function bars({
  values,
  highlight = null,
  live = -1,
  average = null,
  ticks = [],
  label,
  describe,
  height = 200,
  selected = -1,
  summary = "",
}) {
  const count = Math.max(1, values.length);
  let hover = -1;

  const peak = Math.max(average ?? 0, ...values, 1);
  const scale = timeScale(peak);
  const lines = gridLines(scale);
  const id = `plot-${(gradientCount += 1)}`;

  // Geometry in the chart's own units: 100 wide, 100 tall, stretched to fit by
  // the viewBox. Non-scaling strokes keep every line exactly a hairline.
  const x = (index) => ((index + 0.5) / count) * 100;
  const y = (value) => 100 - Math.min(100, Math.max(0, (value / scale.top) * 100));
  const zero = y(0);

  const curve = (Series) => {
    // A monotone cubic through the bucket centres: no overshoot below zero and
    // no invented peaks between two quiet hours.
    const points = Series.map((value, index) => [x(index), y(value)]);
    if (points.length === 1) return `M${points[0][0]},${points[0][1]}`;
    let path = `M${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const [x0, y0] = points[index - 1] ?? points[index];
      const [x1, y1] = points[index];
      const [x2, y2] = points[index + 1];
      const [x3, y3] = points[index + 2] ?? points[index + 1];
      const tension = 0.16;
      const c1x = x1 + (x2 - x0) * tension;
      const c1y = y1 + (y2 - y0) * tension;
      const c2x = x2 - (x3 - x1) * tension;
      const c2y = y2 - (y3 - y1) * tension;
      path += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}`;
    }
    return path;
  };

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

  const area = svg(
    "svg",
    { class: "shape", viewBox: `0 0 100 100`, preserveAspectRatio: "none", "aria-hidden": "true" },
    svg("defs", {}, [
      svg("linearGradient", { id: `${id}-fill`, x1: "0", y1: "0", x2: "0", y2: "1" }, [
        svg("stop", { offset: "0", class: "stop-top", "stop-color": "currentColor", "stop-opacity": "0.26" }),
        svg("stop", { offset: "1", class: "stop-base", "stop-color": "currentColor", "stop-opacity": "0" }),
      ]),
    ]),
    svg("path", {
      class: "fill-area",
      d: `${curve(values)} L100,${zero} L0,${zero} Z`,
      fill: `url(#${id}-fill)`,
    }),
    svg("path", { class: "line", d: curve(values) }),
    highlight !== null
      ? svg("path", {
          class: "line part",
          d: curve(highlight.map((value) => Math.min(value, scale.top))),
        })
      : null,
  );
  plot.append(area);

  // The hours, as the quietest possible ruler.
  plot.append(
    el(
      "div",
      { class: "grid", "aria-hidden": "true" },
      lines.map((value) =>
        el("span", { class: "line-rule", style: { bottom: `${(value / scale.top) * 100}%` } }),
      ),
    ),
  );
  if (average !== null && average > 0) {
    plot.append(el("span", { class: "average", style: { bottom: `${(average / scale.top) * 100}%` } }));
  }

  plot.append(
    el("span", {
      class: "peak",
      "aria-hidden": "true",
      text: duration(scale.top),
    }),
  );

  const markers = el(
    "div",
    { class: "markers", "aria-hidden": "true" },
    [...Array(count).keys()].map((index) =>
      el("span", {
        class: `marker ${index === live ? "live" : ""} ${index === selected ? "selected" : ""} ${
          values[index] > 0 ? "set" : ""
        }`,
        style: { insetInlineStart: `${(x(index) / 100) * 100}%`, insetBlockEnd: `${100 - y(values[index] ?? 0)}%` },
      }),
    ),
  );
  plot.append(markers);

  const readout = el("span", { class: "readout", "aria-hidden": "true", hidden: true });
  plot.append(readout);

  const hot = (index) => {
    hover = index;
    for (const [at, node] of [...markers.children].entries()) node.classList.toggle("active", at === index);
    if (index < 0) {
      readout.hidden = true;
      return;
    }
    fill(
      readout,
      el("span", { class: "when", text: describe(index) }),
      el("span", {
        class: "amount",
        text: duration(highlight?.[index] ?? values[index] ?? 0),
      }),
    );
    readout.hidden = false;
    const box = markers.getBoundingClientRect();
    const half = readout.offsetWidth / 2 || 0;
    const center = (x(index) / 100) * box.width;
    const left = Math.min(Math.max(center, half), Math.max(half, box.width - half));
    readout.style.insetInlineStart = `${left}px`;
  };

  plot.addEventListener("pointermove", (event) => {
    const box = markers.getBoundingClientRect();
    if (box.width <= 0) return;
    const at = Math.min(count - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * count)));
    if (at !== hover) hot(at);
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
                  tick.index === 0 && count > 7 ? "0px" : `${(x(tick.index) / 100) * 100}%`,
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
