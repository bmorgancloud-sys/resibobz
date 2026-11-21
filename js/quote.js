/*
 * quote.js: quote (estimate) domain helpers. Pure functions, no DOM; depends on receipt.js
 * and filter.js. Unit-tested in tests/quote.test.js.
 *
 * Saved quote record (store `quotes`, numbered QT-0001... by db.saveNewDocument('quote')):
 * {
 *   id, number, type: 'quote', date, createdAt, updatedAt,  // ISO strings; date = when first saved
 *   customer, lines, gstRateBp, subtotalCents, taxableCents, zeroRatedCents, gstCents, totalCents,
 *   business, footer,                                      // same snapshot as a receipt, no paymentMethod
 *   validUntil: 'YYYY-MM-DD',                              // local day, inclusive
 *   notes: '',                                             // "Notes / terms", printed above the footer
 *   cancelledAt?,                                          // db.cancelQuote; quotes are never deleted
 *   convertedAt?, receiptId?, receiptNumber?               // db.saveConvertedReceipt
 * }
 * Status is computed, never stored (status()): Converted, Cancelled, Expired (today is after
 * validUntil) or Open. Quotes never count toward sales, GST or History totals.
 * Editing a quote keeps its number and date and refreshes the business/GST snapshot.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const receipt = isNode ? require('./receipt.js') : root.receipt;
  const filter = isNode ? require('./filter.js') : root.filter;

  const VALID_DAYS = 14;

  const STATUSES = [
    { id: 'all', label: 'All' },
    { id: 'open', label: 'Open' },
    { id: 'expired', label: 'Expired' },
    { id: 'converted', label: 'Converted' },
    { id: 'cancelled', label: 'Cancelled' },
  ];

  /** Default "Valid until": today + 14 days, as a local "YYYY-MM-DD". */
  function defaultValidUntil(now = new Date()) {
    return filter.dayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + VALID_DAYS));
  }

  /** 'open' | 'expired' | 'converted' | 'cancelled'. Expired only once the valid-until day has passed. */
  function status(q, now = new Date()) {
    if (q.receiptId || q.convertedAt) return 'converted';
    if (q.cancelledAt) return 'cancelled';
    if (q.validUntil && filter.dayString(now) > q.validUntil) return 'expired'; // YYYY-MM-DD sorts as text
    return 'open';
  }

  function statusLabel(id) {
    const s = STATUSES.find((x) => x.id === id);
    return s ? s.label : id;
  }

  /** Open and expired quotes can be edited, converted and cancelled; converted/cancelled ones can't. */
  function isActive(q, now = new Date()) {
    const s = status(q, now);
    return s === 'open' || s === 'expired';
  }

  /**
   * Build a quote record from validated input.
   * input = { customer, lines: [{description, qtyMilli, unitCents, zeroRated}], validUntil, notes }
   * existing: the saved quote being edited (keeps id, number, date, createdAt).
   */
  function buildQuote(input, settings, now = new Date(), existing = null) {
    const r = receipt.buildReceipt({ ...input, paymentMethod: undefined }, settings, now);
    delete r.paymentMethod;
    const q = {
      ...r,
      type: 'quote',
      updatedAt: r.createdAt,
      validUntil: input.validUntil,
      notes: String(input.notes || '').trim(),
    };
    if (existing) {
      q.id = existing.id;
      q.number = existing.number;
      q.date = existing.date;
      q.createdAt = existing.createdAt;
    }
    return q;
  }

  const api = { VALID_DAYS, STATUSES, defaultValidUntil, status, statusLabel, isActive, buildQuote };

  if (isNode) module.exports = api;
  else root.quote = api;
})(typeof window !== 'undefined' ? window : globalThis);
