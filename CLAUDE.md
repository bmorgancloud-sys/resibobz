# ResiboBZ

A GST receipt/invoice maker for Belize small businesses.

## Constraints

- Vanilla HTML/CSS/JS PWA. **No framework, no build step, no npm.** Open `index.html` via a static server and it works.
- **Must work fully offline.** No CDN links anywhere. Third-party libraries live in `/lib` and are cached by the service worker (`sw.js`). The service worker is cache-first, so **bump `CACHE_VERSION` on any change to a cached file** (edits included, not only adds/renames), or installed apps keep running the old code. When adding or renaming a file the app loads, also add it to `ASSETS`.
- One business per install. No logins, no accounts, no server.
- Mobile-first. Most users are on Android phones. Tap targets at least 48px. Test at 360px width.

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
| `settings`  | `key` (string)         | Key/value pairs, e.g. `business`, `logo`, `gstRateBp`, `receiptPrefix`, `pageSize`, counters |
| `products`  | `id` (auto-increment)  | index: `name`                            |
| `customers` | `id` (auto-increment)  | index: `name`                            |
| `receipts`  | `id` (auto-increment)  | indexes: `number` (unique), `date`, `customerId` |
| `quotes`    | `id` (auto-increment)  | indexes: `number` (unique), `date`, `customerId` |

When the schema changes, bump `DB_VERSION` in `db.js` and add an upgrade step for the new version; never edit an earlier upgrade step.

## Numbering

- Receipts are sequential with a configurable prefix, default `INV-` → `INV-0001`, `INV-0002`, …
- Quotes use `QT-0001`.
- Numbers come from `db.nextNumber('receipt' | 'quote')`, which increments the counter inside a single transaction. Numbers are never reused.

## PDF

- Invoice layout using **jsPDF + jspdf-autotable**, files in `/lib` (not a CDN).
- PDF code lives in `js/pdf.js`. Page sizes are defined in `pdf.PAGE_SIZES`.

## File layout

```
index.html          App shell + bottom nav
manifest.json       PWA manifest
sw.js               Service worker (offline cache)
css/app.css         All styles
js/money.js         Cents / qty / GST-rate parsing, formatting and GST maths (pure, unit-tested)
js/receipt.js       Receipt record builder, WhatsApp summary/link, file names (pure, unit-tested)
js/filter.js        History search/date/status filters, count + total, backup reminder (pure, unit-tested)
js/backup.js        Backup file build/validate/summary/counters (pure, unit-tested) + collect()/restore() via db.js
js/db.js            IndexedDB wrapper (the only file that touches IndexedDB)
js/ui.js            DOM helpers: h(), field(), toast(), confirm(), ask() (confirm + optional text), download()
js/typeahead.js     Suggestion matching (pure, unit-tested) + combobox for picking saved products/customers
js/pdf.js           Letter/A4 receipt PDF (lazy-loads /lib on first use)
js/demo.js          Sample data for Settings > Developer > Load demo data (plan() is pure, unit-tested)
js/update.js        Service worker registration + automatic reload when an update takes control
js/app.js           Router, nav, view rendering
js/views/*.js       One file per tab: new, history, products, customers, settings; plus receipt (detail, #/receipt/<id>)
lib/                Vendored third-party libs (jsPDF, autotable); versions in lib/README.md
icons/              App icons: icon.svg (source), 192/512 PNGs, maskable 512 PNG (from icon-maskable.svg)
tests/              node:test unit tests for the pure modules
tests/browser/      *.e2e.js: headless-Chrome tests of the real app (no npm; drives Chrome over CDP)
```

Keep files small and single-purpose. Add new files under `js/` instead of growing `app.js`.
Script load order in `index.html` matters: money, receipt, filter, backup, db, ui, typeahead, pdf, demo, views, update, then app.

## Updates

`sw.js` is cache-first, so the first load after a deploy runs the old code while the new worker
installs. `js/update.js` reloads the page when the new worker takes control: straight away if
nothing is unsaved, otherwise at the next navigation once the New Receipt draft is empty
(`Views.new.hasDraft()`). Settings and product/customer edit forms count as unsaved. The first
install never reloads.

## Navigation

Bottom nav with five tabs: **New, History, Products, Customers, Settings**. Hash routing:
`#/<tab>[/<param>]`, e.g. `#/receipt/12`, `#/products/new`. Non-tab routes set `nav` in `TABS` (app.js)
to highlight a tab: `#/receipt/<id>` highlights History. Old `#/history/<id>` links redirect to `#/receipt/<id>`.
New Receipt saves to `#/receipt/<id>/saved` (shows "Saved. View in History" once, then drops `/saved`).
`#/settings/backup` scrolls to the Backup card. Each view registers
`window.Views[<tab>] = { render(ctx) }` with `ctx = { el, params, setTitle }`.

## Receipts

- The record shape is documented at the top of `js/receipt.js`. A receipt stores a **snapshot** of the
  business details, GST rate, line values and footer, so later edits never change a past receipt.
  The logo and page size are the exception: the PDF uses the current values from Settings.
- Save with `db.saveNewDocument('receipt', record)`, which assigns the number in the same transaction.
- Customer name/phone are free text on the receipt; saved customers/products are only suggestions,
  offered as type-ahead on New Receipt. Picking a product fills description, price and zero-rated;
  picking a customer fills name, phone, TIN and address.
- Payment methods: `cash`, `card`, `transfer`.
- The detail screen shows a USD total at the fixed peg BZD 2 = USD 1 (`money.bzdToUsdCents`). Display only, never stored.
- There is no per-receipt notes field; the detail screen shows the footer note snapshot as "Note".

## Void

- **Receipts are never deleted.** `db.voidReceipt(id, reason)` sets `voided: true`, `voidedAt`, `voidReason`.
  Voiding is one-way; the number is never reused.
- Voided receipts stay in History (red VOID badge, total struck through) and are left out of every total
  (`filter.summarize`). Any future report must skip `r.voided` too.
- The PDF of a voided receipt has a see-through diagonal "VOID" watermark on every page and a Status: VOID row.

## History search

Logic in `js/filter.js`. One search box (200ms debounce) matches number (digits, so "0012" and "R-0012" both
find INV-0012), customer name, phone (3+ digits) and amount ("45" = $45.00 to $45.99). Date presets
Today / This week (Monday start) / This month / All / Custom (inclusive From/To). Status All / Active / Voided.

## Backup

- Settings > Backup. Export downloads `resibobz-backup-YYYY-MM-DD.json`:
  `{ app: "ResiboBZ", schemaVersion: 1, exportedAt, settings (incl. logo data URL), counters: {receipt, quote},
  products, customers, receipts, quotes }`. Records keep their ids. `lastBackupAt` is per device, not exported.
- Import: `backup.parse` validates everything first, then the user confirms "Replace all data".
  `db.replaceAll` clears and writes all stores in **one transaction**, so a bad file or an error part-way
  leaves the old data untouched. Counters become max(file counter, highest imported number).
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

## Before every commit

1. `node --check` on every project JS file (everything except `lib/`).
2. `node --test tests/`. All tests must pass.
   Touched New Receipt, the type-ahead, History, receipt detail, backup, `update.js` or `sw.js`? Also run `node --test "tests/browser/*.e2e.js"`
   (needs Chrome; set `CHROME=` if it isn't in the default install path).
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
- Later phases are defined as we go. Do only the phase asked for.

## Running locally

Service workers need `http://localhost`, not `file://`. On Windows, double-click `start.bat`
(or run it from a terminal): it starts the server in its own "ResiboBZ server" window and opens
http://localhost:3000 in the default browser. If the server is already running it just opens the
browser. Close that window to stop the server. Elsewhere, or by hand:

```
npx serve . -l 3000
```

Then open http://localhost:3000. Note `serve` redirects `/index.html` to `/index`, so the app and
service worker always refer to the shell as `./`.
