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

/** A button, with the browser's three shapes. */
export function button(label, { onclick, variant, size = "compact", pending, ...rest } = {}) {
  const node = el(
    "button",
    { type: "button", class: ["button", variant, size === "regular" ? "regular" : null].filter(Boolean).join(" "), ...rest },
    pending ? el("span", { class: "pending" }, el("i"), el("i"), el("i")) : null,
    label,
  );
  if (pending) node.disabled = true;
  if (onclick) node.addEventListener("click", onclick);
  return node;
}

export function iconButton(label, glyph, { onclick, size = 13 } = {}) {
  return el(
    "button",
    { type: "button", class: "icon-button", "aria-label": label, title: label, onclick },
    glyph(size),
  );
}

/** A tiny favicon, drawn on a plate the way the browser draws one. */
export function favicon(site, size = 16) {
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
    // No icon to hold: the first letter is a better mark than a broken one.
    image.replaceWith(
      el("span", {
        class: "favicon letter",
        style: {
          inlineSize: `${size}px`,
          blockSize: `${size}px`,
          fontSize: `${Math.round(size * 0.62)}px`,
        },
        text: (site[0] ?? "?").toUpperCase(),
        "aria-hidden": "true",
      }),
    );
  });
  return image;
}

/** Local, dependency-free icons drawn as inline SVG paths. */
export const glyphs = {
  plus: (size) =>
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
  close: (size) =>
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
  chevronDown: (size) =>
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
  chevronLeft: (size) =>
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
  chevronRight: (size) =>
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
  arrowLeft: (size) =>
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
  globe: (size) =>
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
  lock: (size) =>
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
  clock: (size) =>
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
  settings: (size) =>
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
  shield: (size) =>
    svg(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
      svg("path", {
        d: "M12 3.5l7 2.6v5.4c0 4.2-2.9 7.5-7 9-4.1-1.5-7-4.8-7-9V6.1l7-2.6z",
        stroke: "currentColor",
        "stroke-width": 1.7,
        "stroke-linejoin": "round",
      }),
    ),
};
