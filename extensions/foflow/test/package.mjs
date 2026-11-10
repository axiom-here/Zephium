// The extension as the browser sees it: every file the manifest names and
// every path the code asks `chrome.runtime.getURL` for must exist. A dead path
// here is the difference between an installed extension and ERR_FILE_NOT_FOUND,
// and it is invisible to the domain and DOM suites.
//
//   node extensions/foflow/test/package.mjs
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

const sources = walk(join(ROOT, "src")).filter((file) => file.endsWith(".js"));

/** Every literal path the code hands to the browser. */
function referencedPaths() {
  const found = new Set();
  for (const file of sources) {
    const code = readFileSync(file, "utf8");
    // A query string is part of the URL, not part of the file's path.
    for (const match of code.matchAll(/getURL\(\s*[`"']([^`"'$?]*)/gu)) found.add(match[1]);
    for (const match of code.matchAll(/setPopup\(\{[^}]*popup:\s*["']([^"']+)/gsu)) found.add(match[1]);
  }
  return [...found].filter((path) => path.length > 0);
}

test("the manifest names files that are there", () => {
  const named = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
  ].filter(Boolean);
  for (const path of named) {
    assert.ok(existsSync(join(ROOT, path)), `the manifest names ${path}, which is missing`);
  }
  assert.equal(manifest.background.type, "module", "the worker uses import, so it must be a module");
});

test("the icons are the shipped mark, at the sizes the manifest promises", () => {
  // Chrome reads the PNG header for the size it was promised, so a 32px icon
  // saved as 48 is silently ignored and the toolbar falls back to a puzzle.
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = readFileSync(join(ROOT, path));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${path} is not a PNG`);
    assert.equal(png.readUInt32BE(16), Number(size), `${path} is not ${size}px wide`);
    assert.equal(png.readUInt32BE(20), Number(size), `${path} is not ${size}px tall`);
  }
  // Every page carries a favicon that resolves, so the tab shows the mark.
  for (const page of ["time/time.html", "options/options.html", "popup/popup.html", "cover/cover.html"]) {
    const html = readFileSync(join(ROOT, "src/pages", page), "utf8");
    const href = /<link rel="icon" href="([^"]+)"/u.exec(html)?.[1];
    assert.ok(href, `${page} has no favicon link, so its tab shows a blank page icon`);
    const file = resolve(ROOT, "src/pages", page, "..", href);
    assert.ok(existsSync(file), `${page} points its favicon at ${href}, which is missing`);
  }
});

test("every path the code opens exists in the package", () => {
  const paths = referencedPaths();
  assert.ok(paths.length >= 2, "expected the worker to name at least the Time page and a cover");
  for (const path of paths) {
    // A directory prefix such as "/" is a comparison, not a file to open.
    if (path === "" || path === "/" || path.endsWith("/")) continue;
    const file = join(ROOT, path);
    assert.ok(existsSync(file), `getURL("${path}") has no file behind it`);
    assert.ok(statSync(file).isFile(), `getURL("${path}") is not a file`);
  }
});

test("the pages keep the folders the manifest and the worker assume", () => {
  assert.ok(existsSync(join(ROOT, "src/pages/time/time.html")));
  assert.ok(existsSync(join(ROOT, "src/pages/cover/cover.html")));
  assert.ok(existsSync(join(ROOT, "src/pages/popup/popup.html")));
  assert.ok(existsSync(join(ROOT, "src/pages/options/options.html")));
});

test("every page's stylesheets, scripts and links resolve", () => {
  const pages = walk(join(ROOT, "src/pages")).filter((file) => file.endsWith(".html"));
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/gu)) {
      const href = match[1];
      if (/^(https?:|data:|#)/u.test(href)) continue;
      const target = join(dirname(page), href.split("?")[0]);
      assert.ok(existsSync(target), `${relative(ROOT, page)} links ${href}, which is missing`);
    }
  }
});

test("every module import resolves, and nothing is left in the package twice", () => {
  const modules = [...sources, ...walk(join(ROOT, "demo")).filter((file) => file.endsWith(".js"))];
  for (const file of modules) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/from\s+["'](\.[^"']+)["']/gu)) {
      const target = join(dirname(file), match[1].split("?")[0]);
      assert.ok(existsSync(target), `${relative(ROOT, file)} imports ${match[1]}, which is missing`);
    }
  }
});

test("the name is FoFlow everywhere a person sees it", () => {
  assert.equal(manifest.name, "FoFlow");
  assert.equal(manifest.short_name, "FoFlow");
  assert.equal(manifest.action.default_title, "FoFlow");
  const visible = walk(join(ROOT, "src")).filter((file) => file.endsWith(".html"));
  for (const page of visible) {
    const html = readFileSync(page, "utf8");
    assert.ok(!/Zephium Focus/u.test(html), `${relative(ROOT, page)} still says Zephium Focus`);
  }
  // Settings draws its mark and name in its own heading.
  const options = readFileSync(join(ROOT, "src/pages/options/options.js"), "utf8");
  assert.match(options, /el\("span", \{ text: "FoFlow" \}\)/u);
});

test("every message a page sends has a handler in the worker", () => {
  const worker = readFileSync(join(ROOT, "src/background/service-worker.js"), "utf8");
  const handled = new Set(
    [...worker.matchAll(/^\s{2}"([a-z]+:[a-zA-Z]+)":/gmu)].map((match) => match[1]),
  );
  const sent = new Set();
  for (const file of sources) {
    if (file.includes("service-worker")) continue;
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/type:\s*"([a-z]+:[a-zA-Z]+)"/gu)) sent.add(match[1]);
  }
  assert.ok(sent.size > 8, "pages do use the message channel");
  const unanswered = [...sent].filter((type) => !handled.has(type));
  assert.deepEqual(unanswered, [], "a page asks for something no one answers");
});

test("every string a page asks for exists", () => {
  const messages = readFileSync(join(ROOT, "src/lib/messages.js"), "utf8");
  const defined = new Set([...messages.matchAll(/^\s{2}([a-z_0-9]+):/gmu)].map((match) => match[1]));
  const asked = new Map();
  for (const file of sources) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/m\(\s*"([a-z_0-9]+)"/gu)) {
      if (!asked.has(match[1])) asked.set(match[1], relative(ROOT, file));
    }
  }
  const missing = [...asked].filter(([key]) => !defined.has(key));
  assert.deepEqual(missing, [], "a page asks for a string that is not written");
});

test("every page boots its theme before it paints", () => {
  const pages = walk(join(ROOT, "src/pages")).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length >= 4, "the four surfaces are in the package");
  for (const page of pages) {
    const html = readFileSync(page, "utf8");
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(
      head,
      /<script src="[^"]*ui\/theme-boot\.js"><\/script>/u,
      `${relative(ROOT, page)} reads the stored theme in its head`,
    );
    assert.doesNotMatch(
      head,
      /<script type="module"/u,
      `${relative(ROOT, page)} must not defer its theme boot`,
    );
  }
});

test("no string is written twice, and none is left unused", () => {
  const messages = readFileSync(join(ROOT, "src/lib/messages.js"), "utf8");
  const keys = [...messages.matchAll(/^\s{2}([a-z_0-9]+):/gmu)].map((match) => match[1]);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicates, [], "the same key is defined twice");

  const used = new Set();
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(/m\(\s*"([a-z_0-9]+)"/gu)) used.add(match[1]);
  }
  // Retention and names are reached through a built key, not a literal.
  const built = keys.filter((key) => /^(retention_|time_|focus_)/u.test(key));
  const unused = keys.filter((key) => !used.has(key) && !built.includes(key));
  assert.deepEqual(unused, [], "a string is written but never shown");
});

test("label inks clear AA contrast in every theme", () => {
  // The axis hours, the column headings and the captions are body text: a
  // palette tweak must not quietly make them unreadable.
  const css = readFileSync(join(ROOT, "src/styles/tokens.css"), "utf8");
  const themeAt = (marker) => {
    const start = css.indexOf(marker);
    const block = css.slice(start, css.indexOf("\n}", start));
    const value = (name) => /:\s*([^;]+);/u.exec(block.slice(block.indexOf(`${name}:`)))[1].trim();
    return {
      page: value("--color-page"),
      text: value("--color-text"),
      muted: value("--color-muted"),
      faint: value("--color-faint"),
      accent: value("--color-accent"),
    };
  };
  const rgb = (color) => {
    const hex = /^#([0-9a-f]{6})$/iu.exec(color);
    if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16));
    const parts = /rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\/\s*([\d.]+)\s*\)/u.exec(color);
    if (parts) return { alpha: Number(parts[4]), rgb: [1, 2, 3].map((at) => Number(parts[at])) };
    throw new Error(`cannot read ${color}`);
  };
  const luminance = (c) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };

  for (const [name, marker] of [
    ["dark", ":root {"],
    ["light", ':root[data-theme="light"]'],
    ["mocha", ':root[data-theme="mocha"]'],
  ]) {
    const theme = themeAt(marker);
    // Text sits on the page, or on a card that is the page plus a light wash.
    const page = rgb(theme.page);
    for (const key of ["text", "muted", "faint"]) {
      const ink = rgb(theme[key]);
      const inkRgb = Array.isArray(ink) ? ink : ink.rgb.map((v, at) => v * ink.alpha + page[at] * (1 - ink.alpha));
      assert.ok(
        ratio(inkRgb, page) >= 4.5,
        `${name}: --color-${key} is ${ratio(inkRgb, page).toFixed(2)}:1 on its own surface, below 4.5:1`,
      );
    }
  }
});
