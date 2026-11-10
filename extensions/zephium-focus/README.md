# Zephium Focus

The Zephium browser's **Focus** and **Time** surfaces, as a Chromium extension:
focus rounds that keep chosen sites shut, and a Time page that shows where the
time on the web went.

It is a port of the browser's own implementation, not a look-alike:

| Browser source | Ported to |
| --- | --- |
| `crates/zephium-core/src/time.rs` (session, ledger, gate) | `src/lib/focus.js`, `src/lib/store.js` |
| `crates/zephium-app/src/shell/time.rs` (attention, `site_of`) | `src/background/service-worker.js`, `src/lib/site.js` |
| `frame/src/domain/time/time-model.ts` (periods, formatting) | `src/lib/time.js` |
| `frame/src/features/time/components/FocusCard.svelte` | `src/ui/focus-card.js` |
| `frame/src/features/time/components/ShutSites.svelte` | `src/ui/focus-card.js` (`shutEditor`) |
| `frame/src/features/time/components/FocusCover.svelte` | `src/pages/cover/` |
| `frame/src/features/time/components/TimePage.svelte` | `src/pages/time/` |
| `frame/src/shared/ui/data/Ring`, `Bars`, `SiteList` | `src/ui/ring.js`, `bars.js`, `sites.js` |
| `frame/src/styles/tokens.css` | `src/styles/tokens.css` |
| `frame/messages/en.json` (`focus_*`, `time_*`) | `src/lib/messages.js` |

## What it does

**Focus.** One dial. At rest its centre is the length — 15, 25, 30, 45, 50, 60 or
90 minutes — and it opens the choices, with *Repeat with breaks*. Running, it
empties toward the end of the phase, and the layout stays put between the two so
starting reads as the dial coming alive. Rounds repeat the Pomodoro way, with
the browser's own break arithmetic: a short break of a fifth of the round
clamped to 3–20 minutes, a long break three times that (up to 30) after every
fourth round. A repeating session keeps going until it is ended.

**Shut sites.** Every listed site is closed while a round runs: the tab is taken
to a cover that says why, how long is left, and offers *Allow 5 minutes* or *End
focus* — the same two ways out the browser gives. An allowance lasts five
minutes or until the round ends, whichever comes first, and covers the site's
subdomains. Breaks open everything. Matching is by registrable domain, so
shutting `youtube.com` also covers `m.youtube.com` and `www.youtube.com`, and
never covers `notyoutube.com`. Suggestions for the list come from your own
counted time, never from a shipped list.

**Time.** A day or a week of time on the web: a chart by hour (or by day), the
ranked sites with opens and share, one site in depth, focus figures for the
period, and the shut list. Counted on this device only, in local time, the way
the browser counts it: a segment is the time between two changes of attention
while the browser is in front, placed into local hours and folded into days. A
site's *opens* are the times it was come to rather than returned to.

**Where the browser's habits are kept.** A round survives a browser restart and
catches up on phases it slept through, one phase at a time. Private windows are
never counted and never shut. Everything is stored under `chrome.storage.local`
and nothing is sent anywhere.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `extensions/zephium-focus` folder.

Chrome 116 or newer, and the Chromium browsers built on it: Edge, Brave, Arc,
Vivaldi, Opera, and so on.

## Use

- Click the toolbar icon for focus, today's figures and the top sites. If you
  turn on *Toolbar opens the Time page*, the icon opens the full page instead.
- **Alt+Shift+F** starts or ends a round; **Alt+Shift+T** opens the Time page.
- The shut list lives on the Time page's *Shut during focus* card, and in the
  popup's focus card.
- Settings sit behind the gear: round length, breaks, whether sites are shut at
  all, whether time is counted, how long it is kept, notifications when a phase
  ends, and clearing counted time.

## What a Chromium extension can and cannot do

Two things the native browser does are out of reach of the extension APIs, and
the port is honest about them rather than pretending otherwise:

- **A shut page cannot be held back before it renders.** Chromium gives an
  extension no way to refuse a request and then let the browser retry it, and a
  declarative `redirect` cannot be lifted when the round ends. So a shut page is
  taken to the cover as it starts to load, and returned to its exact address
  when the round ends, the break begins, or you allow it. On the sites people
  actually shut, the page body never paints.
- **Incognito windows are counted from their own context.** With *Allow in
  Incognito* on, private windows are still never counted and never shut, as in
  the browser; with it off they cannot reach the extension at all.

## Design notes

- **No build step.** Plain ES modules and CSS with the browser's semantic
  tokens, so the folder loads unpacked exactly as it ships. There is no
  bundler, no framework and no dependency in `src/`.
- **No network calls.** Site marks come from DuckDuckGo's favicon service — the
  same place the Time page's marks come from — and nothing else leaves the
  machine. There is no analytics, no account and no sync.
- **Storage.** `settings`, `focusSession`, `timeLedger` (hour tallies not yet
  folded into days), `timeHistory` (days), `focusDays`, and `coveredTabs` in
  session storage, so a cover is still known after the service worker sleeps.
- **Bounded.** At most 256 shut sites, 400 sites a day, 32 allowances a round,
  366 days of focus figures, and a retention setting for counted time.

## Checks

```sh
node extensions/zephium-focus/test/run.mjs        # domain logic, no dependencies
npm install --no-save jsdom
node --test-force-exit --test extensions/zephium-focus/test/browser.mjs
```

The first suite covers the phase machine, the gate, allowances, site matching,
the ledger, the flush and the report — the places where a port drifts, including
a session that sleeps through several phases, an allowance that runs out
mid-round, and settings that arrive malformed. The second renders the Time page,
the popup, the cover and settings in a real DOM and drives the focus card:
opening the length menu, starting a round, ending it, and a refused command
showing its line.

Both suites run green as of this commit. The background service worker was also
driven against a mocked `chrome.*` API to check the paths the suites cannot
reach in a DOM: a navigation to a shut site being covered, a site that is not
shut loading untouched, an allowance letting the page back, and a break opening
everything.
