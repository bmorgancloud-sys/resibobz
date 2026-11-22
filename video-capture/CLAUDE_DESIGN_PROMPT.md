# Prompt for Claude Design (paste everything below the line)

---

Make a vertical feature video for **Toucan Bill**, a free GST receipt and invoice app for small businesses
in Belize. It runs in the phone's browser and installs to the home screen with no app store. Tagline:
"Our national bird. Its bill is your receipt."

The video shows a made-up nail salon, **Glow Nails Belmopan**, using the app. All screens are real
captures of the app with demo data. Every shot shows the same receipt where it appears: **INV-0169 for
Maria Gonzalez, $95.00 + GST $11.88 = $106.88, paid by card.**

## Output

- **Main cut:** about 60 seconds, 1080×1920 (9:16), 30 fps.
- **Short cut:** about 20 seconds, same format: make a receipt → PDF reveal → WhatsApp → end card.
- Export both as **MP4** (H.264).
- Made for silent autoplay: **big, short on-screen captions**, no voiceover.
- Music: an upbeat, light, royalty-free bed (warm acoustic/marimba or soft electronic pop, about
  100–115 BPM). Cut to the beat. Fade out under the end card.

## Look and brand

- **Colours (taken from the app):** sunny yellow `#FFC83D` (backgrounds, header), ink `#111111` (text and
  buttons, with yellow text on black buttons). Accents only for small badges or icon details:
  green `#6DBE45`, orange `#F58220`, blue `#4FA3D9`, red `#E63B2E`. Never put yellow or orange text on white.
- **Logo:** `assets/toucan-bill-logo-512.png` (also `assets/toucan-bill-logo.svg`): a black toucan on
  yellow whose beak is a receipt striped blue, green, orange and red. Do not use the Glow Nails logo as the
  brand; it is only the demo salon's logo inside the screens and PDFs.
- Clean modern sans-serif (for example Inter or SF Pro Display), bold for captions. Plenty of white space.
- Put phone screens inside a **clean, modern iPhone frame** (thin bezel, Dynamic Island) with an iOS
  status bar showing **9:41** and a **full battery**. The captures have no status bar or browser UI: the
  app's yellow header starts at the very top of each image, so the status bar sits above it.
  The phone captures are 1179×2556 px; the recordings are 1178×2556 px (scale to fit; the 1px difference
  is plain background at the right edge).
- Motion: **gentle** zooms and pans onto the key detail of each shot (listed below). Smooth eased cuts,
  soft slides or crossfades. No shaky, spinning, glitchy or flashy transitions.
- Captions: 2–6 words, large (about 72–96 px on 1080 wide), ink on yellow or white panels, top or bottom
  third so they never cover the detail being zoomed.

## Assets (all files in this folder)

Recordings (real time, human pace, soft gray tap circles already in the video):

| File | What it shows | Length |
|---|---|---|
| `R1-make-receipt.mp4` | History → New → type "Mar", pick Maria Gonzalez → add Gel manicure, Pedicure, Nail art ×4 from saved services → Card → Save → receipt INV-0169 | 16.5 s |
| `R2-share-start.mp4` | INV-0169 → scroll → tap **Share PDF** (ends as the share sheet would open) | 3.6 s |

Phone stills (1179×2556):

| File | Key detail to zoom on |
|---|---|
| `01-new-receipt.png` | Live totals bar: Subtotal $95.00, GST (12.5%) $11.88, Total $106.88; Card selected |
| `01a-new-receipt-customer.png` | Saved customer "Maria Gonzalez", 600-1201 |
| `01b-new-receipt-full.png` (1179×7062, tall) | Slow vertical pan through the whole form |
| `03-share-tap.png` | The black **Share PDF** button under the INV-0169 total |
| `04-products.png` | Saved services list with prices |
| `04b-pick-product.png` | "Ac" typed, suggestions Acrylic fill $45 / Acrylic full set $65 |
| `05a-quote-top.png` | Quote QT-0005, Open, valid until 27 Nov 2026 |
| `05-quote.png` | **Convert to receipt** button under the $202.50 total |
| `05b-convert.png` | "Converting quote QT-0005 to a receipt" banner, pre-filled form |
| `05b2-converted-receipt.png` | "Saved INV-0170 from quote QT-0005" |
| `05c-quote-statuses.png` | Open / Converted / Expired / Cancelled badges in the list |
| `06-history-search.png` | "Maria" in the search box and the results (33 receipts) |
| `06b-filters.png` | Today / Week / Month / All / Custom chips, Week selected |
| `07-stats.png` | Today $399.39 ↑37%, This week $1,158.80 ↑81%, This month $4,595.46 ↑63% |
| `07a-stats-trend.png` | Sales trend line chart |
| `07a2-top-products.png` | Top products ranking |
| `07b-top-customers.png` | Top customers with green WhatsApp buttons |
| `07c-quote-conversion.png` | Conversion rate 67% |
| `08-gst-monthly.png` | GST collected $628.58 (October 2026) and the **Export CSV / Export PDF** buttons |
| `09-daily-summary.png` | Today's total $399.39, GST $44.39, Cash / Card / Transfer rows |
| `10-walk-in.png`, `10b-walk-in-receipt.png` | Blank name ("Leave blank for a walk-in sale"); "Walk-in customer" on the receipt |
| `11-zero-rated.png` | Ticked "Zero-rated / exempt" on a gift voucher, "$50.00 zero-rated" |
| `12-void.png` | Red VOID badge and struck-through total |
| `13-customers.png` | Saved customers list |
| `14-offline.png` | A receipt saved with no internet (looks normal: pair it with an airplane-mode / no-wifi icon) |
| `15-backup.png` | **Export backup** / Import backup buttons |
| `16-update-prompt.png` | Black "Update available, tap to reload" bar at the top |
| `18-settings-gst.png` | Editable GST rate field showing 12.5 |

Documents and desktop:

| File | Use |
|---|---|
| `02-receipt-pdf.png` (2550×3300, 300 dpi) | The real receipt PDF for INV-0169. Show it as a sheet of paper. Zoom 1: logo + "GST TIN: 000123456" (top left). Zoom 2: GST $11.88 and **Total (BZD) $106.88** (lower right). |
| `02-receipt-pdf-a4.png` | Same receipt on A4 (optional "A4 or Letter" beat) |
| `08-gst-summary-pdf.png` | GST summary PDF for October 2026 |
| `09-daily-summary-pdf.png` | Daily summary PDF |
| `12b-void-pdf.png` | Receipt PDF with a diagonal VOID watermark |
| `17-desktop.png`, `17c-desktop-trends.png` (2880×1800) | The app on a computer. Show in a simple laptop or browser-window frame. |

To be supplied by the client (iPhone screen recordings; leave a placeholder slot if missing):

| File | What it will show |
|---|---|
| `manual/M1-whatsapp-share.mov` | Installed app: INV-0169 → Share PDF → iOS share sheet → WhatsApp → send → **INV-0169.pdf** in the chat. 8–15 s, real iOS screen recording (it already has a real status bar; don't add a second one). |
| `manual/M2-home-screen.png` | iPhone home screen with the Toucan Bill icon |
| `manual/M3-open-from-home.mov` (optional) | Tap the icon, app opens |

## Storyboard: main cut (about 60 s)

| Time | Shot | Caption |
|---|---|---|
| 0–3 s | Yellow background, Toucan Bill logo pops in with a small bounce, phone slides up behind it showing `01-new-receipt.png` | **Receipts in seconds. Sent on WhatsApp.** |
| 3–15 s | `R1-make-receipt.mp4` in the phone (trim to about 12 s: speed up the typing gently, keep the customer pick, the three items, Card and Save at normal speed). Slight push-in on the totals bar as it reaches $106.88. | **Pick the customer** → **Add saved services** → **GST done for you** |
| 15–20 s | Paper reveal of `02-receipt-pdf.png` (rises out of the phone). Slow zoom on the logo + GST TIN, then glide to GST $11.88 and Total $106.88. | **A real PDF receipt** · **Your logo. Your GST TIN.** |
| 20–27 s | `R2-share-start.mp4` (or `03-share-tap.png` with a tap pulse on Share PDF), then cut to `manual/M1-whatsapp-share.mov` | **One tap to WhatsApp** |
| 27–33 s | Quick trio, about 2 s each: `04b-pick-product.png` (zoom suggestions), `13-customers.png`, `10b-walk-in-receipt.png` | **Saved services** · **Saved customers** · **Walk-ins welcome** |
| 33–39 s | `05-quote.png` (zoom Convert to receipt) → `05b-convert.png` → `05c-quote-statuses.png` (zoom the badges) | **Send a quote** → **Convert it to a receipt** |
| 39–43 s | `06-history-search.png` (zoom "Maria" + results) → `06b-filters.png` (zoom the chips) | **Find any receipt** |
| 43–52 s | `09-daily-summary.png` (zoom total and payment rows) → `07-stats.png` (zoom the green ↑ badges) → `07a-stats-trend.png` → `08-gst-monthly.png` (zoom Export CSV / Export PDF) | **Close the day** · **Know your numbers** · **GST report in one tap** |
| 52–57 s | Icon montage, about 1 s each, a small icon plus 2–3 word label beside each mini screen: no-wifi icon + `14-offline.png` "**Works offline**"; phone + laptop + `M2-home-screen.png`/`17-desktop.png` "**iPhone, Android, computer**"; "**No app store**"; cloud/download icon + `15-backup.png` "**One-tap backup**"; refresh icon + `16-update-prompt.png` "**Updates itself**" | (labels as listed) |
| 57–60 s | End card on yellow: Toucan Bill logo, **toucanbill.netlify.app**, button-style pill "**Install free — no app store**" (ink pill, yellow text) | — |

Spare shots if a beat needs filling: `01a-new-receipt-customer.png`, `02-receipt-pdf-a4.png`, `07b-top-customers.png`,
`07c-quote-conversion.png`, `11-zero-rated.png`, `12-void.png`, `18-settings-gst.png`, `09-daily-summary-pdf.png`, `17c-desktop-trends.png`.

## Storyboard: short cut (about 20 s)

| Time | Shot | Caption |
|---|---|---|
| 0–2 s | Logo on yellow, phone slides in | **Receipts in seconds** |
| 2–10 s | `R1-make-receipt.mp4`, trimmed to about 8 s (customer pick, items, Card, Save) | **Make it** |
| 10–13 s | `02-receipt-pdf.png` paper reveal, zoom on Total $106.88 | **A real PDF** |
| 13–17 s | `R2-share-start.mp4` (last 1.5 s) → `manual/M1-whatsapp-share.mov` (the send and the PDF landing in chat) | **Sent on WhatsApp** |
| 17–20 s | End card: logo, **toucanbill.netlify.app**, "**Install free — no app store**" | — |

## Do not

- Invent screens, numbers or features that aren't in the assets.
- Change any amount, receipt number or name shown in the captures.
- Add a second status bar on top of `manual/*.mov` (those already have the real iOS one).
- Use the Glow Nails logo as the brand logo.
