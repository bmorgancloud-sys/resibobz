/*
 * summary.js: sales summary maths (Daily Summary now, a stats tab later).
 * Pure functions, no DOM, no IndexedDB; depends on receipt.js (payment labels) and money.js.
 * Unit-tested in tests/summary.test.js.
 *
 * Counts only real, active receipts: quotes (type 'quote'), voided receipts and anything
 * cancelled are left out. Amounts are the receipts' own stored values (integer cents, GST
 * already rounded per line at the receipt's own rate when it was saved), so the summary always
 * matches the receipt PDFs exactly and never depends on the current GST setting.
 * Every total is a plain sum of those values, so the payment-method amounts add up to the total.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const receipt = isNode ? require('./receipt.js') : root.receipt;
  const money = isNode ? require('./money.js') : root.money;

  /** "2026-11-20" -> { from, to }: local 00:00:00.000 that day and local midnight after it (exclusive). null if invalid. */
  function dayBounds(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!m) return null;
    const from = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (from.getMonth() !== Number(m[2]) - 1 || from.getDate() !== Number(m[3])) return null;
    return { from, to: new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1) };
  }

  /** Local Date -> "2026-11-20". */
  function dayOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /** Is this a sale that counts: a receipt that isn't voided or cancelled? */
  function counts(r) {
    return !!r && r.type !== 'quote' && !r.voided && !r.cancelledAt;
  }

  function inRange(r, from, to) {
    const t = new Date(r.date).getTime();
    return (!from || t >= from.getTime()) && (!to || t < to.getTime());
  }

  /**
   * Summarize sales between `from` (inclusive) and `to` (exclusive), Dates or null for open ends.
   * Returns {
   *   count, subtotalCents, taxableCents, zeroRatedCents, gstCents, totalCents,
   *   byPayment: [{ id, label, count, totalCents }]   cash, card, transfer always (in that order), then any other method,
   *   byRate:    [{ gstRateBp, taxableCents, gstCents }]  standard-rated sales per GST rate, lowest rate first,
   *   receipts:  the counted receipts, oldest first,
   *   excluded:  { voided, cancelled }  receipts in range that were left out (quotes are not counted here)
   * }
   */
  function summarize(records, { from = null, to = null } = {}) {
    const out = {
      count: 0, subtotalCents: 0, taxableCents: 0, zeroRatedCents: 0, gstCents: 0, totalCents: 0,
      byPayment: receipt.PAYMENT_METHODS.map((p) => ({ id: p.id, label: p.label, count: 0, totalCents: 0 })),
      byRate: [],
      receipts: [],
      excluded: { voided: 0, cancelled: 0 },
    };
    for (const r of records || []) {
      if (!r || r.type === 'quote' || !inRange(r, from, to)) continue;
      if (!counts(r)) {
        if (r.voided) out.excluded.voided++;
        else out.excluded.cancelled++;
        continue;
      }
      out.receipts.push(r);
      out.count++;
      out.subtotalCents += r.subtotalCents;
      out.taxableCents += r.taxableCents;
      out.zeroRatedCents += r.zeroRatedCents;
      out.gstCents += r.gstCents;
      out.totalCents += r.totalCents;

      let pay = out.byPayment.find((p) => p.id === r.paymentMethod);
      if (!pay) {
        pay = { id: r.paymentMethod, label: receipt.paymentLabel(r.paymentMethod) || 'Other', count: 0, totalCents: 0 };
        out.byPayment.push(pay);
      }
      pay.count++;
      pay.totalCents += r.totalCents;

      if (r.taxableCents) {
        let rate = out.byRate.find((x) => x.gstRateBp === r.gstRateBp);
        if (!rate) {
          rate = { gstRateBp: r.gstRateBp, taxableCents: 0, gstCents: 0 };
          out.byRate.push(rate);
        }
        rate.taxableCents += r.taxableCents;
        rate.gstCents += r.gstCents;
      }
    }
    out.byRate.sort((a, b) => a.gstRateBp - b.gstRateBp);
    out.receipts.sort((a, b) => (new Date(a.date) - new Date(b.date)) || ((a.id || 0) - (b.id || 0)));
    return out;
  }

  /** Summary for one local calendar day ("YYYY-MM-DD"), 00:00:00 to 23:59:59.999. Adds `day`. */
  function daily(records, day) {
    const range = dayBounds(day);
    if (!range) throw new Error('Invalid date: ' + day);
    return { day, ...summarize(records, range) };
  }

  /** Plain-text version for WhatsApp / share text. */
  function summaryText(s, businessName) {
    const fmt = money.formatCents;
    const out = [];
    if (businessName) out.push(businessName);
    out.push('Daily summary ' + receipt.formatDay(s.day), '');
    out.push('Receipts: ' + s.count);
    out.push('Subtotal (excl. GST): ' + fmt(s.subtotalCents));
    out.push('GST collected: ' + fmt(s.gstCents));
    out.push('Total: BZD ' + fmt(s.totalCents), '');
    for (const p of s.byPayment) out.push(p.label + ': ' + p.count + ' · ' + fmt(p.totalCents));
    if (s.excluded.voided) out.push('', s.excluded.voided + ' voided, not counted');
    return out.join('\n');
  }

  /** "daily-summary-2026-11-20.pdf" */
  function pdfFileName(s) {
    return 'daily-summary-' + s.day + '.pdf';
  }

  const api = { dayBounds, dayOf, counts, summarize, daily, summaryText, pdfFileName };

  if (isNode) module.exports = api;
  else root.summary = api;
})(typeof window !== 'undefined' ? window : globalThis);
