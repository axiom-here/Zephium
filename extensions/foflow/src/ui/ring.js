// A progress ring, ported from `frame/src/shared/ui/data/Ring`: the arc moves
// by stroke offset with a short linear glide, so a caller that steps it once a
// second reads as continuous without repainting every frame.
import { el, svg } from "./dom.js";

export function ring({ value, size = 148, stroke = 8, tone = "lead", label, center = null }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, value)));
  const inside = center === null ? [] : Array.isArray(center) ? center : [center];
  const dial = el(
    "div",
    {
      class: `ring ${tone === "rest" ? "rest" : ""}`,
      style: { inlineSize: `${size}px`, blockSize: `${size}px` },
      role: label ? "progressbar" : null,
      "aria-label": label ?? null,
      "aria-valuemin": label ? "0" : null,
      "aria-valuemax": label ? "100" : null,
      "aria-valuenow": label ? String(Math.round(Math.min(1, Math.max(0, value)) * 100)) : null,
    },
    svg(
      "svg",
      { viewBox: `0 0 ${size} ${size}`, "aria-hidden": "true" },
      svg("circle", {
        class: "track",
        cx: size / 2,
        cy: size / 2,
        r: radius,
        "stroke-width": stroke,
      }),
      svg("circle", {
        class: "arc",
        cx: size / 2,
        cy: size / 2,
        r: radius,
        "stroke-width": stroke,
        "stroke-dasharray": circumference,
        "stroke-dashoffset": offset,
      }),
    ),
    inside.length > 0 ? el("div", { class: "center" }, inside) : null,
  );
  return dial;
}
