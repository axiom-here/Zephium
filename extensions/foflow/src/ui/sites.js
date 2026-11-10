// The ranked sites list, ported from `frame/src/features/time/components/SiteList`:
// bars measure against the leading site, so the longest fills its row and the
// rest read against it rather than against a total they never reach.
import { el, fill, glyphs } from "./dom.js";
import { duration, share } from "../lib/time.js";
import { m } from "../lib/messages.js";

const percent = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

export function siteList({ sites, total = 0, size = "panel", selected = null, onselect, onpoint }) {
  const root = el("ul", { class: `sites ${size === "page" ? "page" : ""}`, "aria-label": m("time_sites") });

  function render() {
    fill(root);
    if (size === "page" && sites.length > 0) {
      root.append(
        el(
          "li",
          { class: "head", "aria-hidden": "true" },
          el("span"),
          el("span"),
          el("span", { text: m("time_opens") }),
          el("span", { text: m("time_share") }),
          el("span", { text: m("time_time") }),
        ),
      );
    }
    if (sites.length === 0) {
      root.append(
        el(
          "li",
          { class: "none" },
          el(
            "div",
            { class: "empty" },
            el("h2", { text: m("time_no_sites") }),
            el("p", { text: m("time_no_sites_help") }),
          ),
        ),
      );
      return;
    }
    const lead = sites[0]?.seconds ?? 0;
    sites.forEach((site, index) => {
      const mark = siteMark(site.site, size === "page" ? 18 : 16);
      const row = el(
        "button",
        {
          type: "button",
          class: `row ${selected === site.site ? "selected" : ""}`,
          "aria-pressed": onselect ? String(selected === site.site) : null,
          onpointerenter: () => onpoint?.(site.site),
          onpointerleave: () => onpoint?.(null),
          onfocus: () => onpoint?.(site.site),
          onblur: () => onpoint?.(null),
          onclick: () => onselect?.(site.site),
        },
        mark,
        el("span", { class: "name", text: site.site }),
        size === "page" ? el("span", { class: "number", text: String(site.opens) }) : null,
        size === "page"
          ? el("span", { class: "number", text: percent.format(share(site.seconds, total)) })
          : null,
        el("span", { class: "spent", text: duration(site.seconds) }),
        el(
          "span",
          { class: "meter", "aria-hidden": "true" },
          el("span", {
            class: "fill",
            style: { transform: `scaleX(${share(site.seconds, lead)})` },
          }),
        ),
      );
      root.append(el("li", { style: { "--enter": `${Math.min(index, 12) * 22}ms` } }, row));
    });
  }

  render();
  return {
    root,
    /** Replaces the rows, and the total their shares are measured against —
     *  a share of a total captured at construction is a share of nothing. */
    update(next, nextTotal = total) {
      sites = next;
      total = nextTotal;
      render();
    },
  };
}

/** A site's mark, with its first letter when no icon can be held. */
export function siteMark(site, size = 16) {
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
    const letter = el("span", {
      class: "favicon letter",
      style: {
        inlineSize: `${size}px`,
        blockSize: `${size}px`,
        fontSize: `${Math.round(size * 0.6)}px`,
      },
      text: (site[0] ?? "?").toUpperCase(),
      "aria-hidden": "true",
    });
    image.replaceWith(letter);
  });
  return image;
}

export { glyphs };
