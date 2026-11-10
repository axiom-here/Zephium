// Drives the pages against a stand-in service worker, so the wiring between
// the markup, the modules and the engine is exercised, not only the domain
// logic in `run.mjs`.
//
//   node extensions/foflow/test/run.mjs       (no dependencies)
//   npm install --no-save jsdom && \
//   node --test-force-exit --test extensions/foflow/test/browser.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { open, settle, skip, text } from "./dom.mjs";

test("the Time page draws a day, a site list and the focus card", { skip }, async () => {
  const { document } = await open("src/pages/time/time.html");
  assert.match(text(document.querySelector("#total")), /58/);
  assert.equal(document.querySelectorAll("#sites .row").length, 1);
  assert.match(text(document.querySelector("#sites")), /youtube\.com/u);
  assert.equal(document.querySelectorAll(".bars .column").length, 24);
  assert.equal(document.querySelectorAll(".bars .ticks span").length, 8);
  assert.match(text(document.querySelector("#focus")), /Start focus/u);
  assert.equal(document.querySelectorAll("#shut-editor .shut-list li").length, 1);
});

test("the span and the day before move the chart", { skip }, async () => {
  const { document, harness } = await open("src/pages/time/time.html");
  document.querySelector('[data-span="week"]').click();
  await settle();
  assert.ok(harness.calls.includes("time:report"), "a new report is asked for");
  assert.equal(document.querySelector('[data-span="week"]').getAttribute("aria-pressed"), "true");
  assert.equal(document.querySelector('[data-span="day"]').getAttribute("aria-pressed"), "false");
  assert.equal(document.querySelector("#period-label").textContent.trim(), "This week");
  document.querySelector("#previous").click();
  await settle();
  assert.equal(document.querySelector("#period-label").textContent.trim(), "Last week");
  document.querySelector("#today").click();
  await settle();
  assert.equal(document.querySelector("#period-label").textContent.trim(), "This week");
});

test("the focus card opens its lengths, starts a round, and ends it", { skip }, async () => {
  const { document, harness } = await open("src/pages/time/time.html");
  const focus = document.querySelector("#focus");
  const card = () => text(focus);

  focus.querySelector(".focus-length").click();
  await settle();
  const lengths = [...document.querySelectorAll("body > .menu .menu-item .label")].map((node) =>
    node.textContent.trim(),
  );
  assert.ok(lengths.length > 3, `the menu opened (items: ${lengths.length})`);
  assert.deepEqual(lengths.slice(0, 3), ["15 min", "25 min", "30 min"]);
  assert.equal(lengths.at(-1), "Repeat with breaks");

  document.querySelectorAll("body > .menu .menu-item")[2].click();
  await settle();
  assert.match(card(), /^30min/u);
  assert.equal(document.querySelector("body > .menu"), null, "choosing closes the menu");

  [...focus.querySelectorAll("button")].find((node) => node.textContent.includes("Start focus")).click();
  await settle(160);
  assert.match(card(), /30:0\d/u, "the round is the length just chosen");
  assert.match(card(), /Round 1/u);
  assert.equal(harness.session?.phase, "focus");

  const end = () => [...focus.querySelectorAll("button")].find((node) => /^End/u.test(node.textContent.trim()));
  end().click();
  await settle();
  assert.equal(end().textContent.trim(), "End focus?");
  end().click();
  await settle(160);
  assert.match(card(), /Start focus/u);
  assert.equal(harness.session, null);
});

test("shutting a site writes it, and the list shows it", { skip }, async () => {
  const { document, harness } = await open("src/pages/time/time.html");
  const input = document.querySelector("#shut-editor input");
  input.value = "news.example.com";
  [...document.querySelectorAll("#shut-editor button")]
    .find((node) => /Add/u.test(node.textContent))
    .click();
  await settle(160);
  assert.ok(harness.calls.includes("focus:settings"));
  assert.match(text(document.querySelector("#shut-editor .shut-list")), /news\.example\.com/u);
  assert.equal(input.value, "", "the field is cleared once the site is in");
});

test("the toolbar popup shows focus, today's time and the top sites", { skip }, async () => {
  const { document } = await open("src/pages/popup/popup.html");
  assert.match(text(document.querySelector("#focus")), /Start focus/u);
  assert.match(text(document.querySelector("#stats")), /on the web/u);
  assert.equal(document.querySelectorAll("#sites .row").length, 1);
  assert.match(text(document.body), /Counted on this device only/u);
  // The two header controls, which used to be missing altogether.
  assert.equal(document.querySelectorAll("#head-actions .icon-button").length, 2);
});

test("the cover names the site, counts down, and offers both ways out", { skip }, async () => {
  const now = Date.now();
  const { document } = await open("src/pages/cover/cover.html", {
    search: "?site=youtube.com",
    session: {
      phase: "focus",
      plan: { minutes: 25, breaks: false },
      started_ms: now - 60_000,
      phase_started_ms: now - 60_000,
      phase_ends_ms: now + 24 * 60_000,
      rounds: 0,
      focused_ms: 60_000,
      allowances: [],
      round: 1,
    },
  });
  const body = text(document.body);
  assert.match(body, /Paused for focus/u);
  assert.match(body, /24:0\d/u);
  assert.match(body, /Allow 5 minutes/u);
  assert.match(body, /End focus/u);
  assert.match(body, /youtube\.com/u);
});

test("settings render every row and write what is changed", { skip }, async () => {
  const { document, harness } = await open("src/pages/options/options.html");
  assert.equal(document.querySelectorAll(".group").length, 3);
  const switches = document.querySelectorAll(".switch");
  assert.equal(switches.length, 5);
  switches[0].click();
  await settle();
  assert.equal(harness.calls.includes("focus:settings"), true);

  const retention = document.querySelectorAll(".select-trigger")[0];
  const before = retention.textContent.trim();
  retention.click();
  await settle();
  document.querySelectorAll("body > .menu .menu-item")[0].click();
  await settle();
  assert.equal(retention.textContent.trim(), before, "the chosen value stays shown");
  assert.equal(document.querySelector("body > .menu"), null);
});
