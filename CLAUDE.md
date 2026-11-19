# ResiboBZ

A GST receipt/invoice maker for Belize small businesses.

## Constraints

- Vanilla HTML/CSS/JS PWA. **No framework, no build step, no npm.** Open `index.html` via a static server and it works.
- **Must work fully offline.** No CDN links anywhere. Third-party libraries live in `/lib` and are cached by the service worker (`sw.js`). When adding or renaming any file the app loads, add it to `ASSETS` in `sw.js` and bump `CACHE_VERSION`.
- One business per install. No logins, no accounts, no server.
- Mobile-first. Most users are on Android phones. Tap targets at least 48px. Test at 360px width.

## Money

- Currency is BZD, shown as `$` (e.g. `$1,234.50`).
- **Store all money as integer cents.** Never store or add floats. Convert to dollars only for display, and parse user input straight to cents.
- GST is computed per line in cents and rounded half-up to the nearest cent at the line level; Subtotal, GST and Total are sums of the line values.

## GST

- One editable rate in Settings, default **12.5%**. Store it as basis points (`gstRateBp: 1250`) to keep it an integer.
- Each product/line can be marked **zero-rated/exempt** (`zeroRated: true`), meaning no GST on that line.
- Prices are entered **GST-exclusive**.
- Receipts show **Subtotal, GST, Total**.

## Storage

IndexedDB, accessed only through `js/db.js`. Object stores:

| Store       | Key                    | Notes                                    |
|-------------|------------------------|------------------------------------------|
| `settings`  | `key` (string)         | Key/value pairs, e.g. `business`, `gstRateBp`, `receiptPrefix`, counters |
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

- A4 / Letter invoice layout using **jsPDF + jspdf-autotable**, files in `/lib` (not a CDN).
- PDF code lives in `js/pdf.js`.

## File layout

```
index.html          App shell + bottom nav
manifest.json       PWA manifest
sw.js               Service worker (offline cache)
css/app.css         All styles
js/db.js            IndexedDB wrapper (the only file that touches IndexedDB)
js/app.js           Router, nav, view rendering
js/pdf.js           PDF generation (later phase)
lib/                Vendored third-party libs (jsPDF, autotable)
icons/              App icons
```

Keep files small and single-purpose. Add new files under `js/` instead of growing `app.js`.

## Navigation

Bottom nav with five tabs: **New, History, Products, Customers, Settings**. Hash routing (`#/new`, `#/history`, …).

## Phases

- **Phase 0 (done):** folder structure, empty app shell with bottom nav, `db.js`, git.
- Later phases are defined as we go. Do only the phase asked for.

## Running locally

Service workers need `http://localhost`, not `file://`. For example:

```
python -m http.server 8000
```

Then open http://localhost:8000.
