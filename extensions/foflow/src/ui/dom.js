// A very small DOM kit: enough to build the browser's cards without a
// framework and without a build step.

const SVG = "http://www.w3.org/2000/svg";

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  apply(node, props);
  append(node, children);
  return node;
}

export function svg(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  apply(node, props);
  append(node, children);
  return node;
}

/** Properties that must be set as properties to mean anything (`hidden`,
 *  `value`, …). Everything else is an attribute: SVG names such as `viewBox`
 *  are read-only properties, and a page should never throw while drawing. */
const PROPS = new Set(["value", "checked", "disabled", "hidden", "selected", "textContent"]);

function apply(node, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.setAttribute("class", value);
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "style") node.setAttribute("style", String(value));
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "text") node.textContent = value;
    else if (PROPS.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces everything in `node`. */
export function fill(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

/**
 * A button, with the browser's shapes.
 * @param {string} label
 * @param {{ onclick?: Function, variant?: string, size?: "compact" | "regular", pending?: boolean }} [options]
 */
export function button(label, { onclick, variant, size = "compact", pending, ...rest } = {}) {
  const node = el(
    "button",
    {
      type: "button",
      class: ["button", variant, size === "regular" ? "regular" : null].filter(Boolean).join(" "),
      ...rest,
    },
    pending ? el("span", { class: "pending" }, el("i"), el("i"), el("i")) : null,
    label,
  );
  if (pending) node.disabled = true;
  if (onclick) node.addEventListener("click", onclick);
  return node;
}

/** An icon-only button; `glyph` is a factory such as `glyphs.close`. */
export function iconButton(label, glyph, { onclick, size = 14, ...rest } = {}) {
  return el(
    "button",
    { type: "button", class: "icon-button", "aria-label": label, title: label, onclick, ...rest },
    glyph(size),
  );
}

/**
 * A site's mark: its favicon, and its first letter when no icon can be held.
 * `src` is resolved by the caller so each context can use its own source.
 */
export function faviconMark(site, { size = 16, src } = {}) {
  const image = el("img", {
    class: "favicon",
    alt: "",
    width: size,
    height: size,
    loading: "lazy",
    decoding: "async",
    src: src ?? iconUrl(site),
    style: { inlineSize: `${size}px`, blockSize: `${size}px` },
  });
  const letter = () =>
    el("span", {
      class: "favicon letter",
      style: {
        inlineSize: `${size}px`,
        blockSize: `${size}px`,
        fontSize: `${Math.round(size * 0.6)}px`,
      },
      text: (site?.[0] ?? "?").toUpperCase(),
      "aria-hidden": "true",
    });
  image.addEventListener("error", () => image.replaceWith(letter()));
  return image;
}

function iconUrl(site) {
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(site)}.ico`;
}

/** Inline SVG glyphs, so nothing is fetched and nothing is missing. */
export const glyphs = {
  plus: (size = 14) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M12 5v14M5 12h14",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
      }),
    ),
  close: (size = 14) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M6 6l12 12M18 6L6 18",
        stroke: "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
      }),
    ),
  chevronDown: (size = 12) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M6 9.5l6 6 6-6",
        stroke: "currentColor",
        "stroke-width": 2.2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  chevronLeft: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M14.5 6l-6 6 6 6",
        stroke: "currentColor",
        "stroke-width": 2.2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  chevronRight: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M9.5 6l6 6-6 6",
        stroke: "currentColor",
        "stroke-width": 2.2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  arrowLeft: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M19 12H5m0 0l6-6m-6 6l6 6",
        stroke: "currentColor",
        "stroke-width": 1.9,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  clock: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("circle", { cx: 12, cy: 12, r: 9, stroke: "currentColor", "stroke-width": 1.7 }),
      svg("path", {
        d: "M12 7.5V12l3 2",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
      }),
    ),
  settings: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("circle", { cx: 12, cy: 12, r: 3.1, stroke: "currentColor", "stroke-width": 1.7 }),
      svg("path", {
        d: "M12 3.2v2.2M12 18.6v2.2M4.8 7.8l1.9 1.1M17.3 15.1l1.9 1.1M4.8 16.2l1.9-1.1M17.3 8.9l1.9-1.1",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linecap": "round",
      }),
    ),
  lock: (size = 12) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("rect", {
        x: 5,
        y: 10,
        width: 14,
        height: 10,
        rx: 2.5,
        stroke: "currentColor",
        "stroke-width": 1.7,
      }),
      svg("path", {
        d: "M8.5 10V7.5a3.5 3.5 0 117 0V10",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linecap": "round",
      }),
    ),
  expand: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  globe: (size = 16) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("circle", { cx: 12, cy: 12, r: 9, stroke: "currentColor", "stroke-width": 1.7 }),
      svg("path", {
        d: "M3.5 9h17M3.5 15h17M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18",
        stroke: "currentColor",
        "stroke-width": 1.5,
        "stroke-linecap": "round",
      }),
    ),
  sun: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("circle", { cx: 12, cy: 12, r: 4.2, stroke: "currentColor", "stroke-width": 1.8 }),
      svg("path", {
        d: "M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linecap": "round",
      }),
    ),
  moon: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M20 14.2A8.2 8.2 0 019.8 4a8.2 8.2 0 1010.2 10.2z",
        stroke: "currentColor",
        "stroke-width": 1.8,
        "stroke-linejoin": "round",
      }),
    ),
  palette: (size = 15) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M12 3a9 9 0 100 18c1.3 0 2-.9 2-1.9 0-1.6-1.4-1.8-1.4-3 0-1 .8-1.8 1.9-1.8H17a4 4 0 004-4C21 6.3 17 3 12 3z",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linejoin": "round",
      }),
      svg("circle", { cx: 8, cy: 9.5, r: 1.2, fill: "currentColor" }),
      svg("circle", { cx: 12, cy: 7.3, r: 1.2, fill: "currentColor" }),
      svg("circle", { cx: 16, cy: 9.2, r: 1.2, fill: "currentColor" }),
    ),
};
