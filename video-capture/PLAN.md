# Capture plan: Toucan Bill feature video

Everything for this task lives in `video-capture/`. No app file is edited. Capture-only CSS and JS is
injected with `page.addInitScript` (styles go in through `document.adoptedStyleSheets`, so the app's
CSP stays on and nothing logs a CSP error).

## What the code says (checked before capturing)

- **Routes:** `#/new`, `#/history`, `#/quotes`, `#/stats`, `#/products`, `#/customers`, `#/settings`
  (`#/settings/backup` scrolls to Backup), `#/receipt/<id>[/saved]`, `#/quote/<id>`, `#/quote/new`,
  `#/summary[/YYYY-MM-DD]`.
- **Editor selectors:** fields are found by their `.field label` text (Name, Phone, Description, Qty,
  Unit price ($)). Type-ahead options are `[role=option]` in a listbox. Payment radios `#pay-cash|card|transfer`.
  Save is `button[type=submit]` "Save receipt". Totals are in `.sticky-totals`.
- **Data:** IndexedDB `resibobz` (stores settings, products, customers, receipts, quotes). Money is integer
  cents, GST rate in basis points (1250). Prices are **GST-exclusive**; GST is worked out per line and
  rounded half away from zero, totals are sums of the lines (`js/money.js`).
- **Seeding:** through the app's own backup format (`backup.parse` + `backup.restore`, the same calls as
  Settings > Import). File = `{ app: "ResiboBZ", schemaVersion: 2, exportedAt, settings, counters, products,
  customers, receipts, quotes }`. The seed is built in Node with the app's own pure `receipt.buildReceipt`
  and `quote.buildQuote`, so line values and totals are exactly what the app would store.
  `exportedAt` is the day before the frozen date, so no "back up" banner shows (it sets `lastBackupAt`).
- **PDF:** `pdf.documentBlob(r)` (receipt/quote), `pdf.summaryBlob(s)` (daily), `pdf.gstSummaryBlob(s)`.
  Page size comes from the `pageSize` setting, so A4 and Letter are made by switching that setting.
  PDFs are rendered to 300 dpi PNG with pdf.js in Chromium (no pdftoppm on this machine).
- **Share:** `detail.sharePanel` calls `navigator.share({ files: [File], title, text })` when
  `navigator.canShare({files})` is true. Captures stub both and save the payload + the shared PDF bytes.
- **Quotes:** status is computed: converted (`receiptId`), cancelled (`cancelledAt`), expired (today after
  `validUntil`), else open.
- **Stats:** range preset kept in localStorage `resibobz.stats.range` (default "This month"); GST month
  select defaults to last month. Sales = stored receipt values, voided excluded.
- **Update prompt:** `sw.js` waits after install; `js/update.js` shows `.update-bar` "Update available,
  tap to reload". The capture server can change `CACHE_VERSION` in the `sw.js` it serves (same trick as
  `tests/browser/update.e2e.js`), then `registration.update()` brings up the real prompt.

## Tooling

- `npm` packages in `video-capture/node_modules` only: `playwright-core` (drives the installed Chrome,
  no browser download), `ffmpeg-static`, `pdfjs-dist`.
- `server.js`: local static server for the repo with the same security headers as netlify.toml, plus
  `/__capture/*` for capture helper pages, and a switch to change the served `CACHE_VERSION`.
  (Used instead of `npx serve`, which can't change the service worker version.)
- Frozen clock: `page.clock.setFixedTime` at **Wednesday 18 Nov 2026, 10:41 AM**, timezone
  `America/Belize`. Timers keep running, so animations and debounces behave normally.
- Device: 393x852 CSS px, deviceScaleFactor 3, mobile + touch, light mode.
- Recordings: CDP `Page.startScreencast` PNG frames at full DPR with timestamps, then ffmpeg concat at
  real timing, 30 fps, H.264 CRF 16, veryfast, 1179x2556, yuv420p.

## Data story (same everywhere)

- Glow Nails Belmopan, 8 weeks of receipts (23 Sep to 18 Nov 2026 morning), gently rising.
- The hero receipt is made on camera in R1: **Maria Gonzalez, Gel manicure + Pedicure + Nail art x4,
  paid by card**. It always gets the next number after the seed, so the form, PDF, share payload, history,
  daily summary and the manual iPhone shots all show the same number and total.
- After R1, an open quote is converted on camera (05b), which takes the following receipt number.

## Order of work

1. Logo (SVG -> PNG), `make-seed.js` -> `seed.json`; check all maths in Node.
2. `server.js`, `lib.js` (browser, seed import, capture CSS, tap indicator, screencast, PDF render).
3. `capture.js`: stills and recordings in story order in one browser profile.
4. Look at every PNG and frame-check every MP4; re-capture problems.
5. `contact-sheet.png`, `shots.json`, `MANUAL_SHOTS.md`, `CLAUDE_DESIGN_PROMPT.md`.

## What changed during capture (notes)

- **Hero number is INV-0169** (not INV-0161 as first planned): extra seed receipts were added yesterday and
  early last week so the Stats tiles show believable growth (+37% / +81% / +63%, not +788%).
- The bridal-party quote converts in October, so a $607 spike doesn't distort November's charts.
- Screencast frames needed `--force-device-scale-factor=3`; without it Chrome sends 393x852 frames.
- Videos are 1178x2556: H.264 4:2:0 needs an even width, so 1px of plain background is cropped on the right.
- Offline: Playwright's `setOffline` alone didn't hold after the screencast sessions, so step 14 also uses
  DevTools' `Network.emulateNetworkConditions`. Proof is in capture-facts.json (onLine false, no page requests).
- Capture-only stubs: `navigator.share` (records the payload) and `navigator.storage.persist/persisted`
  (headless Chrome never grants persistent storage). Listed in shots.json.
- **App bug found (not fixed, app files untouched):** `body` is exactly one screen tall while content
  overflows it, so the sticky yellow header scrolls away after the first screen on long pages
  (Stats, History, Settings). Visible in 07a/07b/07c and 15.
- No pdftoppm on this machine: PDFs are rendered with pdf.js inside Chrome (`pdf.html`).

## Re-running

    node make-logo.js        # only if the logo SVG changes
    node make-seed.js        # writes seed.json and prints the maths checks
    node capture.js          # everything (about 4 minutes); ONLY=03,14 re-takes just those stills
    node make-contact-sheet.js
