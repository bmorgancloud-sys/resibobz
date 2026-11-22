# Manual shots for Brandon (iPhone)

These are the shots a computer can't make: the real iOS share sheet, WhatsApp and the home screen.
Save them into `video-capture/manual/` with the exact file names below.

## The receipt to use (matches every captured shot)

| | |
|---|---|
| Receipt | **INV-0169** |
| Customer | **Maria Gonzalez**, 600-1201 |
| Items | Gel manicure $40.00 · Pedicure $35.00 · Nail art 4 × $5.00 |
| Subtotal / GST / Total | $95.00 / $11.88 / **$106.88** |
| Paid by | **Card** |
| Date on receipt | 18 Nov 2026, 10:41 am |

The PDF that WhatsApp shows will be named **INV-0169.pdf**.

## Step 0: put the demo data on your phone (and put your own back afterwards)

INV-0169 only exists in the demo data. Load it with the app's normal backup import:

> **Never do this on your client's phone.** Importing replaces all data on the phone.
> Use your own iPhone only.

1. Open the installed Toucan Bill app. Settings > Backup > **Export backup**. Keep that file: it's
   your own data, and you'll put it back at the end.
2. Get `video-capture/manual/glow-nails-demo-with-INV-0169.json` onto the phone (AirDrop, or email/WhatsApp
   it to yourself and save it to Files).
3. Settings > Backup > **Import backup** > pick that file > confirm "Replace all data".
   (The app first saves a `…-before-import.json` safety copy as well.)
4. Open History. You should see INV-0171, INV-0170, **INV-0169 (Maria Gonzalez, $106.88, Card)** at the top.
5. When you're done recording, import your own backup from step 1 the same way.

The demo file has 171 receipts, 6 quotes, 10 products and 8 customers for Glow Nails Belmopan, with the
salon logo. It is the app's state right after the capture run, so the numbers match the shots exactly.

## Before recording

- Use the **installed** app (home-screen icon), not a Safari tab.
- Light mode. Battery nearly full. **Do Not Disturb on** (Focus), so no banners pop in.
- Turn on screen recording in Control Centre (Settings > Control Centre > Screen Recording).
- For WhatsApp, use a test chat with a friend or your second number, never a customer.
- Clear any old INV-0169.pdf from that test chat first, so the new one is obviously the one being sent.

## M1-whatsapp-share.mov (required)

1. Start screen recording. Wait 1 second on the History screen.
2. Tap **INV-0169**. Pause about 1 second on the receipt.
3. Scroll down and tap **Share PDF**.
4. In the iOS share sheet, tap **WhatsApp** (use More if it isn't in the first row).
5. Pick the test chat. Tap **Send**.
6. Wait until **INV-0169.pdf** shows in the chat, then hold 2 seconds.
7. Stop recording.

Aim for 8–15 seconds. Move slowly and steadily; the editor will speed up the boring parts.
Save as `manual/M1-whatsapp-share.mov`.

## M2-home-screen.png (required)

A screenshot of a home screen with the **Toucan Bill** icon in view. A clean page with few icons looks
best. Put the icon where it's easy to spot (middle row works well). Hide or blur any personal
widgets. Save as `manual/M2-home-screen.png`.

## M3-open-from-home.mov (optional)

Screen-record tapping the Toucan Bill icon and the app opening on New receipt. 2–3 seconds.
Save as `manual/M3-open-from-home.mov`.

## Check before sending them over

- The receipt number in M1 is **INV-0169** and the total is **$106.88**.
- No real names, numbers or messages are visible in WhatsApp or on the home screen.
- Your own data is back on the phone (History shows your receipts, not Glow Nails).
