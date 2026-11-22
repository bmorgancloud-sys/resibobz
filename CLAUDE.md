# Toucan Bill — rules for every task
- A real client uses this app in production. Her data lives only on her phone.
- Always work on a new branch. Never merge or push to main unless I say "merge".
- Push the branch and give me the Netlify deploy preview link for testing.
- IndexedDB / localStorage changes must be additive only: new optional fields, indexes or stores. Never rename, delete, clear or recreate existing databases, stores or keys.
- Bump CACHE_VERSION whenever any cached file changes.
- Run all unit and browser tests before every commit and report pass/fail counts.
- Never add analytics, tracking, ads or third-party scripts. Vendor any library locally.
- Show me the manual checks I need to do on my phone at the end of every task.

# Toucan Bill (formerly ResiboBZ)

A GST receipt/invoice maker for Belize small businesses. Tagline: "Our national bird. Its bill is your receipt."

## Brand and theme

- Renamed from ResiboBZ to Toucan Bill. **Stored names kept the old name on purpose** (never rename them): IndexedDB
  `resibobz` / `resibobz-test`, localStorage `resibobz.*`, the backup file marker `app: "ResiboBZ"` (import also
  accepts `"Toucan Bill"`), and the manifest `id` `"./"`. `tests/browser/rebrand.e2e.js` builds a database with the
  pre-rebrand production app (commit 2c6b92f, read from git) and checks it survives the update untouched.
- Blue theme (tokens on `:root` in app.css; the yellow "Sunny" theme was removed): header `--header-bg` #0D5DAA
  with white text; primary buttons `--brand` #0D5DAA with `--brand-ink` white; selected chips/segments #0D5DAA with
  white text; the active nav tab is blue. PDF title/table header and the Stats chart series use the same #0D5DAA.
  Icons are a toucan on navy #10233F (manifest `background_color`; `theme_color` #0D5DAA). Accents
  (`--accent-green` #6DBE45, `--accent-orange` #F58220, `--accent-blue` #4FA3D9, `--accent-red` #E63B2E) are for
  charts and badges only, always with `--badge-ink` #111111 text. The pale yellow #fff8e1 boxes are warnings
  (backup reminder, setup hint), not theme. Never use yellow or orange for text on white.
- Live at **https://toucanbill.netlify.app** (renamed from resibobz.netlify.app). Saved data is tied to the web
  address: a device that used the old address keeps its data there, and moves it with Export/Import backup.

## Constraints

- Vanilla HTML/CSS/JS PWA. **No framework, no build step, no npm.** Open `index.html` via a static server and it works.
- **Must work fully offline.** No CDN links anywhere. Third-party libraries live in `/lib` and are cached by the service worker (`sw.js`). The service worker is cache-first, so **bump `CACHE_VERSION` on any change to a cached file** (edits included, not only adds/renames), or installed apps keep running the old code. When adding or renaming a file the app loads, also add it to `ASSETS`.
- One business per install. No logins, no accounts, no server.
- Mobile-first. Most users are on Android phones. Tap targets at least 48px. Nothing may be wider than the
  screen at 320, 360 or 390px (`tests/browser/layout.e2e.js`). On a phone one over-wide element widens the
  whole layout viewport, so every full-width control runs off the edge. Use `minmax(0, 1fr)` grid tracks,
  `min-width: 0` on flex/grid children, and ellipsis for names/numbers in list cards (never for amounts).

## Money

- Currency is BZD, shown as `$` (e.g. `$1,234.50`).
- **Store all money as integer cents.** Never store or add floats. Convert to dollars only for display, and parse user input straight to cents.
- GST is computed per line in cents and rounded half away from zero to the nearest cent at the line level; Subtotal, GST and Total are sums of the line values.

## GST

- One editable rate in Settings, default **12.5%**. Store it as basis points (`gstRateBp: 1250`) to keep it an integer.
- Each product/line can be marked **zero-rated/exempt** (`zeroRated: true`), meaning no GST on that line.
- Prices are entered **GST-exclusive**.
- Receipts show **Subtotal, GST, Total**.

## Storage

IndexedDB, accessed only through `js/db.js`. Object stores:

| Store       | Key                    | Notes                                    |
|-------------|------------------------|------------------------------------------|
| `settings`  | `key` (string)         | Key/value pairs, e.g. `business`, `logo`, `gstRateBp`, `receiptPrefix`, `pageSize`, `autoSaveContacts`, counters |
| `products`  | `id` (auto-increment)  | index: `name`                            |
| `customers` | `id` (auto-increment)  | index: `name`                            |
| `receipts`  | `id` (auto-increment)  | indexes: `number` (unique), `date`, `customerId` |
| `quotes`    | `id` (auto-increment)  | indexes: `number` (unique), `date`, `customerId` |

When the schema changes, bump `DB_VERSION` in `db.js` and add an upgrade step for the new version; never edit an earlier upgrade step.

Schema history: **v1** (Phase 0) created all five stores. **v2** (Phase 4) adds a `quoteId` index on `receipts`
(and creates `quotes` only if missing); no data is touched. `tests/browser/upgrade.e2e.js` builds a real v1
database and checks that the upgrade keeps everything.

## Numbering

- Receipts are sequential with a configurable prefix, default `INV-` → `INV-0001`, `INV-0002`, …
- Quotes use `QT-0001` (`quotePrefix`), with their own counter (`counter_quote`), independent of receipts.
- Numbers come from `db.nextNumber('receipt' | 'quote')`, which increments the counter inside a single transaction. Numbers are never reused.

## PDF

- Invoice layout using **jsPDF + jspdf-autotable**, files in `/lib` (not a CDN).
- PDF code lives in `js/pdf.js`. Page sizes are defined in `pdf.PAGE_SIZES`. `pdf.documentBlob(r)` builds
  receipts and quotes (`r.type === 'quote'` → QUOTATION layout); `receiptBlob`/`quoteBlob` are aliases.

## File layout

```
index.html          App shell + bottom nav
manifest.json       PWA manifest (id/start_url/scope "./", standalone, 192/512/maskable icons)
sw.js               Service worker: precaches every app file, cache-first; new versions wait for the update prompt
css/app.css         All styles
js/money.js         Cents / qty / GST-rate parsing, formatting and GST maths (pure, unit-tested)
js/receipt.js       Receipt record builder, WhatsApp summary/link, file names (pure, unit-tested)
js/quote.js         Quote record builder, computed status, default valid-until (pure, unit-tested)
js/filter.js        History/Quotes search/date/status filters (statusOf option), count + total, backup reminder (pure, unit-tested)
js/summary.js       Daily Summary maths: day bounds, totals, by payment method, by GST rate (pure, unit-tested)
js/stats.js         Stats tab maths: getRange/previousRange/inRange, labels, money helpers (pure; tests/stats.cases.js)
js/stats-ui.js      Stats tab pieces: empty state, remembered range picker, card
js/backup.js        Backup file build/validate/summary/counters (pure, unit-tested) + collect()/restore() via db.js
js/db.js            IndexedDB wrapper (the only file that touches IndexedDB)
js/ui.js            DOM helpers: h(), field(), toast(), confirm(), ask() (confirm + optional text), download(), chipGroup() (equal-width radio button row)
js/typeahead.js     Suggestion matching (pure, unit-tested) + combobox for picking saved products/customers
js/autosave.js      Add a saved document's customer/items to Customers/Products (plan() pure, unit-tested)
js/editor.js        Shared document editor (customer, lines, live totals, validation, auto-save) for New Receipt and quotes
js/pdf.js           Letter/A4 receipt, quote, Daily Summary and monthly GST summary PDF (lazy-loads /lib on first use)
js/detail.js        Shared detail-screen parts: business card, Bill to, lines + totals, Share/Download PDF panel (also used by the Daily Summary)
js/demo.js          Sample data for Settings > Developer > Load demo data (plan() is pure, unit-tested)
js/safety.js        Persistent storage, backup banner/export, "Something went wrong" bar, nearly-full warning, notSaved() (pure helpers unit-tested)
js/update.js        Service worker registration + "Update available, tap to reload" prompt
js/app.js           Router, nav, view rendering
js/views/*.js       One file per tab: new, history, quotes, stats, products, customers, settings; plus receipt (detail,
                    #/receipt/<id>), quote (detail, #/quote/<id>) and quote-edit (#/quote/new, #/quote/<id>/edit), summary (#/summary[/YYYY-MM-DD])
lib/                Vendored third-party libs (jsPDF, autotable, Chart.js); versions in lib/README.md
icons/              App icons: favicon.svg (source), favicon-32, apple-touch-icon (180), 192/512 PNGs, maskable 512 PNG
tests/              node:test unit tests for the pure modules
tests/browser/      *.e2e.js: headless-Chrome tests of the real app (no npm; drives Chrome over CDP)
tests/stats.test.html  Browser runner for tests/stats.cases.js (Node runs the same cases via stats.test.js)
tests/fixtures.js   Hand-worked Stats fixture: receipts, quotes, customers, products, totals in comments
tests/seed.html     Dev-only seed tool: fake data into the separate resibobz-test database (tests/seed-data.js)
install.html        Install guide at /install (netlify.toml rewrite): iPhone/Android/computer steps, how-to video,
install.css         WhatsApp help (wa.me/5016150551). CSS/JS in its own files (CSP). install.js picks the tab.
install.js          These three plus how-to.mp4 and how-to-poster.jpg are NOT precached: sw.js lets them go to
how-to.mp4          the network (GUIDE list), so the 2.5 MB video never enters the app's offline cache.
how-to-poster.jpg   Test: tests/browser/install.e2e.js
netlify.toml        Netlify hosting: publish the repo root, no build; no-cache on /, index.html, sw.js, install
start.bat           Windows double-click launcher for the dev server
tools/server.js     Dev static server (Node built-ins, port 3000). Not loaded by the app, not cached by sw.js
```

Keep files small and single-purpose. Add new files under `js/` instead of growing `app.js`.
Script load order in `index.html` matters: money, receipt, filter, summary, stats, quote, backup, db, ui, stats-ui, typeahead, autosave, editor, pdf, detail, demo, safety, views, update, then app.

## Updates

`sw.js` is cache-first, so after a deploy the page keeps running the old code while the new worker
installs. The new worker then **waits** (no `skipWaiting` on install) and `js/update.js` shows a fixed
"Update available, tap to reload" button at the top. Tapping it posts `SKIP_WAITING`; on `controllerchange`
the page reloads. If something unsaved is on screen it asks first ("Not now" keeps it): the New Receipt draft
(`Views.new.hasDraft()`, which includes a quote conversion in progress), Settings, product/customer edit
forms and the quote editor. A waiting worker is offered again on every load, and activates by itself
once every tab is closed. Other tabs that see the new worker take control reload straight away if nothing
is unsaved, otherwise at the next navigation once the draft is empty. The first install shows no prompt.
Installs up to `resibobz-v18` had no prompt, so `sw.js` skips waiting once when it finds one of those caches.
iOS resumes an installed app without reloading it, so `update.js` also calls `registration.update()` on
`visibilitychange` → visible and every 30 minutes while visible. Settings > App shows "App version" (the
controlling worker's `CACHE_VERSION`, asked via a `GET_VERSION` message) and "Check for updates"
(`appUpdate.check()`: shows the prompt if a worker is waiting, else toasts "You're up to date").

## Navigation

Bottom nav with seven tabs: **New, History, Quotes, Stats, Products, Customers, Settings**. At 320px each tab is ~46px
wide by 64px tall (the user accepted this exception to the 48px rule, for nav width only), so labels/icons shrink under
400px wide (layout.e2e.js fails if any label is cut off). `#view` gets `data-view="<tab>"`; Stats widens it to 1000px. Hash routing:
`#/<tab>[/<param>]`, e.g. `#/receipt/12`, `#/products/new`. Non-tab routes set `nav` in `TABS` (app.js)
to highlight a tab: `#/receipt/<id>` highlights History, `#/quote/...` highlights Quotes, `#/summary` highlights History. Old `#/history/<id>` links redirect to `#/receipt/<id>`.
New Receipt saves to `#/receipt/<id>/saved` (shows "Saved. View in History" once, then drops `/saved`).
`#/settings/backup` scrolls to the Backup card. Each view registers
`window.Views[<tab>] = { render(ctx) }` with `ctx = { el, params, setTitle }`.

## Receipts

- The record shape is documented at the top of `js/receipt.js`. A receipt stores a **snapshot** of the
  business details, GST rate, line values and footer, so later edits never change a past receipt.
  The logo and page size are the exception: the PDF uses the current values from Settings.
- Save with `db.saveNewDocument('receipt', record)`, which assigns the number in the same transaction.
- Customer name/phone are free text on the receipt; saved customers/products are only suggestions,
  offered as type-ahead on New Receipt (and filled in from saved receipts, see Auto-save below). Picking a product fills description, price and zero-rated;
  picking a customer fills name, phone, TIN and address.
- Payment methods: `cash`, `card`, `transfer`.
- The detail screen shows a USD total at the fixed peg BZD 2 = USD 1 (`money.bzdToUsdCents`). Display only, never stored.
- There is no per-receipt notes field; the detail screen shows the footer note snapshot as "Note".

## Auto-save customers and products

Logic in `js/autosave.js`, shared with quotes (the editor runs it after saving a receipt or a quote, new or edited). After `saveNewDocument` succeeds, New Receipt calls
`autosave.run(saved)`. Settings > Receipts > "Auto-save new customers & products" (`autoSaveContacts`, default on) turns it off.
- Customer: match by phone first (`typeahead.phoneDigits`, so spaces, dashes and +501 are ignored), then by name (trimmed,
  any case). No match: add one (if only a phone was typed, the phone is the name). Match: fill only EMPTY fields, never overwrite.
  A walk-in (no name and no phone) saves nothing.
- Products: match each line by name (trimmed, any case). No match: add with the unit price and zero-rated flag. A different
  price is never changed silently: one dialog lists the changes, and `autosave.applyPrices` runs only on "Update".
  Blank and $0.00 lines are skipped. A name repeated on one receipt uses its first line.
- Writes go through `db.putMany` in one transaction. Errors are caught and shown as a toast, and the receipt is never lost.

## Safety (before the first real client)

- `safety.init()` runs on start: `navigator.storage.persist()`, a global `error`/`unhandledrejection` handler that shows
  "Something went wrong" + "Export backup now", and a banner when storage is nearly full (90% or under 25 MB left).
  Settings > Backup shows "Storage: protected / not protected", "Last backup: N days ago" and the privacy line.
- **Every database write is wrapped.** On failure call `safety.notSaved(err)` ("Not saved — try again"), keep the
  form as typed, and never show a success message before the write finished. Save buttons guard against double taps.
- `db.saveNewDocument`, `db.saveConvertedReceipt` and `db.updateQuote` run `receipt.withTotals`: line values and
  totals are recalculated from qty/price/zero-rated/rate, and invalid lines are refused before any write.
- Input limits: `money.priceError` (0 to $100,000,000, 2 decimals) and `money.qtyError` (over 0, up to 99,999, 3
  decimals), plus a line-overflow check in the editor. Text fields have `maxlength`.
- Backup banner (New Receipt and History) after 7 days without an export. Import downloads a
  `…-before-import.json` safety copy first, then asks "Replace all data on this phone?".
- Logo: PNG/JPG/WebP, at most 400 px wide, 600 px tall and about 200 KB.
- **CSP** in netlify.toml (`default-src 'self'`, no `unsafe-inline`): no inline scripts, no inline `style=` attributes
  (set styles through `el.style`), no `<iframe>`/`<object>`, nothing from another origin. `tests/browser/harness.js`
  serves the same headers to every test, and `safety.e2e.js` checks escaping, CSP and that no request leaves the site.

## Void

- **Receipts are never deleted.** `db.voidReceipt(id, reason)` sets `voided: true`, `voidedAt`, `voidReason`.
  Voiding is one-way; the number is never reused. A reason is required. A voided receipt offers
  "Issue corrected receipt" (`Views.new.startCorrection`): a new receipt pre-filled from it, with the next number.
- Voided receipts stay in History (red VOID badge, total struck through) and are left out of every total
  (`filter.summarize`). Any future report must skip `r.voided` too.
- The PDF of a voided receipt has a see-through diagonal "VOID" watermark on every page and a Status: VOID row.

## History search

Logic in `js/filter.js`. One search box (200ms debounce) matches number (digits, so "0012" and "R-0012" both
find INV-0012), customer name, phone (3+ digits) and amount ("45" = $45.00 to $45.99). Date presets
Today / Week (Monday start) / Month / All / Custom (inclusive From/To), shown with `ui.chipGroup` (default All;
Quotes uses the same component): one row of equal-width 48px buttons styled like the segmented rows, never scrolling.
Keep chip labels to about 6 characters so five fit at 320px; longer ones (Quotes statuses) pass `wrapNarrow` and show
3 + 2 below 440px. Custom reveals From/To. Status All / Active / Voided.

## Daily Summary

`#/summary[/YYYY-MM-DD]`, opened from the "Daily summary" button at the top of History (no tab).
Date picker (defaults to today, updates the hash). Shows receipt count, subtotal (excl. GST), GST collected, total,
GST per rate when a day mixes rates, and count + amount per payment method (cash, card, transfer always shown),
then the day's receipts. A day with nothing counted shows "No receipts on this date".
- Maths in `js/summary.js` (pure; `summarize(records, {from, to})` is meant for a later stats tab, `daily()` wraps it).
  Day = local 00:00:00 to 23:59:59.999. Counts receipts only: quotes, voided and cancelled are skipped.
- Sums each receipt's **stored** values (line GST already rounded at that receipt's own rate), so figures always
  match the receipt PDFs and never use the current GST setting. All sums, so payment methods add up to the total.
- PDF: `pdf.summaryBlob(s)` (same header as receipts, current business/logo/page size), shared through
  `detail.sharePanel(null, { fileName, makeBlob, waText })`.

## Backup

- Settings > Backup. Export downloads `toucanbill-backup-YYYY-MM-DD.json`:
  `{ app: "ResiboBZ", schemaVersion: 1, exportedAt, settings (incl. logo data URL), counters: {receipt, quote},
  products, customers, receipts, quotes }`. Records keep their ids. `lastBackupAt` is per device, not exported.
- Import: `backup.parse` validates everything first, then the user confirms "Replace all data".
  `db.replaceAll` clears and writes all stores in **one transaction**, so a bad file or an error part-way
  leaves the old data untouched. Counters become max(file counter, highest imported number).
- Schema versions: **1** (Phases 1-3; quotes/quote counter may be missing → imported as `[]` and 0) and
  **2** (Phase 4: `quotes` required; quote fields `validUntil`, `notes`, `cancelledAt`, `convertedAt`, `receiptId`,
  `receiptNumber`; receipts may carry `quoteId`, `quoteNumber`). Export writes 2.
- **If you change the record shapes, bump `backup.SCHEMA_VERSION`**, keep reading the old version in
  `parse` (add it to `SUPPORTED_VERSIONS`, migrate on import), and add a test.
- History shows a reminder when there are receipts and no backup in 7 days (`lastBackupAt` setting).

## PDF and sharing

- Page size: **Letter (default) or A4**, chosen in Settings (`pageSize: 'letter' | 'a4'`).
  Layout: logo + business + GST TIN, receipt meta, Bill To, line table,
  GST summary (standard vs zero-rated), totals, footer note, page numbers when multi-page.
- Share: Web Share API with the PDF file when `navigator.canShare({files})` is true (Android Chrome).
  Otherwise download the PDF and show a `wa.me` link with a text summary. 7-digit numbers get the 501 code.
- The PDF is generated when the receipt screen opens, so `navigator.share` runs directly in the tap handler.
- Web Share and the service worker need a secure context: `localhost` or HTTPS. A phone hitting
  `http://192.168.x.x` gets neither.

## Quotes

- Record shape at the top of `js/quote.js`: a receipt-style snapshot (no `paymentMethod`) plus `validUntil`
  (local `YYYY-MM-DD`, inclusive) and `notes` ("Notes / terms"). Save new with `db.saveNewDocument('quote', …)`,
  edits with `db.updateQuote` (keeps number and date, refreshes the business/GST snapshot).
- Status is **computed, never stored** (`quote.status`): Converted (`receiptId`), Cancelled (`cancelledAt`),
  Expired (today after `validUntil`), else Open. Only Open/Expired can be edited, converted or cancelled
  (`quote.isActive`); db.js refuses the others too. Quotes are never deleted.
- **Quotes never count toward sales, GST or History totals.** Any report must read `receipts` only.
- Convert: the quote detail calls `Views.new.startConversion(q)` and opens New Receipt pre-filled, with a
  "Converting QT-…" banner and Discard. Expired quotes ask first. Only saving runs `db.saveConvertedReceipt`,
  which numbers the receipt, stores `quoteId`/`quoteNumber` on it and sets `convertedAt`/`receiptId`/`receiptNumber`
  on the quote, all in **one transaction**. Backing out leaves the quote Open.
- Quote PDF: same layout titled QUOTATION, Quote no. / Date / Valid until, no payment, Notes / terms above the
  footer, diagonal "CANCELLED" watermark when cancelled (shared watermark code with VOID). WhatsApp text says "Quotation".
- Quotes list (`#/quotes`) reuses `filter.apply` (with `statusOf: quote.status`) and two `ui.chipGroup` rows: dates and
  All / Open / Expired / Converted / Cancelled.

## Stats (Phase 6)

`#/stats`, built in steps 0-6, one at a time; the user says "next" between steps. Maths in `js/stats.js` (pure), pieces in
`js/stats-ui.js`, view in `js/views/stats.js`. Sales figures reuse `summary.summarize`, so they are sums of stored receipt
values and match the PDFs; quotes, voided and cancelled never count. Money shows as `$` (`stats.formatBZD` is
`money.formatCents`). Ranges are `{ preset, from, to }`, `to` exclusive, weeks start Monday. The picker choice is kept in
localStorage (`resibobz.stats.range`, wrapped in try/catch). With no receipts the tab is one empty state; below
`stats.MIN_RECEIPTS` (5) counted receipts the GST card shows and Trends shows the empty state.
- **At a glance** (Step 2, very top, from the first receipt, ignores the picker): Today / This week / This month tiles
  from `stats.glance(records, now)`: total, count, average (`averageCents`, 0 when none) and `percentChange` against the
  previous period **up to the same point** (`periodToDate`: yesterday to the same time, 7 days ago, same day last month
  capped at its end). Previous 0 shows "New", both 0 "No sales yet"; green up, red down.
- **Top products / slow movers** (Step 3, in the Trends grid): `stats.topProducts(records, range, { by, products })` groups
  lines by `normalizeName` (trim, lowercase, collapse spaces), ranks by net sales (excl. GST) or quantity, ties by name;
  shows the saved product's name, else the most-used spelling. `stats.slowMovers(records, products, now)`: saved products
  with no sale in the last 30 days (fixed, not the picker), never sold first, then oldest last sale.
- **Top customers** (Step 4, in the Trends grid): `stats.topCustomers(records, range, { customers })` groups receipts by
  phone (`waNumber`, any format) then name (`normalizeName`); a name-only receipt joins the phone group with that name.
  Top 10 by spend incl. GST, ties by name; walk-ins (no name, no phone) are a separate total, never ranked or in
  repeat/one-time. Repeat = 2+ receipts ever (up to the range end). WhatsApp button `stats.waLink` (receipt.whatsappNumber:
  7 digits get 501); falls back to the saved customer's phone by name.
- **Charts** (Step 5, Trends): Chart.js 4.4.7 at `lib/chart.umd.min.js`, precached, loaded on first use by
  `statsUi.ensureChart()`. `stats.salesSeries(records, range, now)`: one zero-filled point per day, weekly (Monday) when the
  range is over 90 days; `stats.weekdayAverages`: weekday total ÷ how often that weekday falls in the range. Both stop at
  today (`plotRange`), so future days are never shown as $0. Values stay in cents; only labels are formatted. Every redraw
  and leaving the tab calls `statsUi.destroyCharts()`. Single series in the brand blue, no legend, "Show numbers" table.
- **Quotes** (Step 6, Trends): `stats.quoteStats(quotes, range)` for quotes dated in the range: sent, converted, rate
  (converted ÷ sent, `null` → "—"), open value (status Open only). `stats.followUps(quotes)`: every Open quote, oldest
  first, any range, with a WhatsApp follow-up (`followUpText`); expired ones are a count with a link to Quotes. Uses the
  existing link (`receiptId`/`receiptNumber`/`convertedAt` from `db.saveConvertedReceipt`, in backups since schema 2), so
  there are no "unknown" legacy quotes and no new field.
- **Speed:** with 2,000 receipts and a 4x slower CPU, Stats renders in about 250–450 ms (median), logged to the console with
  `performance.now()` and kept on `window.statsTiming` (`ms`, `dbMs`, `chartsMs`). Stats code parses each date once
  (`timeOf`, a Symbol on the record; a WeakMap made GC slow) and narrows to the range before `summary.summarize`
  (`summarizeRange`); keep new calculations on that path. `tests/browser/release.e2e.js` checks it, plus a clean console,
  768/1280px, and that nothing under `tests/` is linked or precached.
- Desktop Trends layout is CSS columns (`columns: 2`, cards `break-inside: avoid`), so cards of any height pack.
- **Monthly GST summary** (Step 1, top of the tab, own month `<select>`, default last month): `stats.gstSummary(records, 'YYYY-MM')`
  sums stored receipt values, so each receipt keeps its own rate (`byRate` when mixed). CSV `stats.gstCsv`: UTF-8 BOM,
  CRLF, plain amounts ("12.50"), totals row, formula-safe text. One-page PDF `pdf.gstSummaryBlob(s, { pageSize })`.
Test cases live in `tests/stats.cases.js` and run in Node (`stats.test.js`) and the browser (`stats.test.html`).

**Test database (dev only):** `tests/seed.html` writes fake data into `resibobz-test` with `db.replaceAll`. db.js opens
`resibobz-test` only while localStorage `resibobz.useTestDb` is `1`, which the seed page's "Open the app on test data"
sets. The app then shows a red TEST DATABASE bar with "Back to real data". `sw.js` never caches or serves anything for
`tests/` (requests to or from those pages go to the network), and netlify.toml returns 404 for `/tests/*`.

## Before every commit

1. `node --check` on every project JS file (everything except `lib/`).
2. `node --test tests/`. All tests must pass.
   Touched CSS, any view, the type-ahead, backup, the PDF, `update.js`, `sw.js`, `manifest.json` or `index.html`? Also run
   `node --test --test-concurrency=1 "tests/browser/*.e2e.js"` (needs Chrome; set `CHROME=` if it isn't in the default
   install path). One file at a time: each starts its own Chrome, and ten at once time out on a normal laptop.
3. Changed any file the service worker caches? Bump `CACHE_VERSION` in `sw.js`. Added/renamed one? Also add it to `ASSETS`.

## Phases

- **Phase 0 (done):** folder structure, empty app shell with bottom nav, `db.js`, git.
- **Phase 1 (done):** Settings (business, logo, GST rate, prefix, footer), New Receipt (line items,
  zero-rated toggle, customer, payment method, live totals), save to IndexedDB, Letter/A4 PDF, share/WhatsApp.
  Also: basic Products and Customers lists (used as suggestions) and a History list + receipt detail.
- **Phase 2 (done):** Products (name, price, zero-rated; add/edit/delete), Customers (name, phone, email,
  TIN optional), type-ahead picking of saved products and customers on New Receipt.
- **Phase 3 (done):** History list with search and date/status filters, receipt detail with void
  (never delete) and VOID PDF watermark, JSON backup export/import with a 7-day reminder.
- **Phase 4 (done):** Quotes / estimates: quote editor (shared with New Receipt), computed statuses, Quotes list
  with search/date/status chips, quote detail with Share/Download/Edit/Cancel/Convert, QUOTATION PDF with
  CANCELLED watermark, DB v2, backup schema 2 (reads 1), six-tab nav.
- **Phase 5 (done):** Daily Summary (screen + PDF, pure summary maths), installable PWA (manifest id/start_url "./",
  iPhone meta + 180px touch icon, "Update available, tap to reload" prompt), `pwa.e2e.js` (installability,
  precache coverage, offline).
- **Phase 6 (done):** Stats tab (see Stats above): range picker, at-a-glance tiles, monthly GST summary (CSV + one-page PDF),
  top products, slow movers, top customers + WhatsApp, sales trend and busiest-days charts (Chart.js in lib/), quote
  conversion + follow-ups. Seventh nav tab. Dev-only test page, fixture and seed tool (separate `resibobz-test` database).
  No data fields added.
- Later phases are defined as we go. Do only the phase asked for.

## Hosting

Netlify deploys from the GitHub repo using `netlify.toml`: publish `.`, no build command. `/`, `index.html` and
`sw.js` are sent `Cache-Control: no-cache`; css/js/manifest are cached 1 hour, lib/icons 1 week. HTTPS on Netlify
gives the secure context Web Share and the service worker need.

## Running locally

Service workers need `http://localhost`, not `file://`. The dev server is `tools/server.js`: Node built-ins
only (no npm, works offline), serves the project root on port 3000 (localhost only), sends
`Cache-Control: no-cache`, and opens the default browser.

**Windows:** double-click `start.bat`. It `cd`s to its own folder and runs this, with Node's full path
(PATH isn't reliable on double-click):

```
"C:\Program Files\nodejs\node.exe" tools\server.js 3000
```

That window is titled "ResiboBZ server" and prints "Server running - keep this window open". Close it
(or press Ctrl+C) to stop the server. If Node isn't at that path, start.bat tries `where node.exe`, then
`%LOCALAPPDATA%\Programs\nodejs`. If ResiboBZ is already running on 3000, it just opens the browser and
closes. On any error (Node missing, port 3000 used by another program) it prints the reason and pauses.
Keep `start.bat` CRLF (`.gitattributes` enforces it); Git Bash's `grep`/`sed` hide the CRs.

**Elsewhere / by hand:** from the project root run `node tools/server.js [port]`, then open
http://localhost:3000. Set `RESIBOBZ_NO_OPEN=1` to skip opening the browser. The app and service
worker refer to the shell as `./`, never `index.html` (some static servers redirect it).

