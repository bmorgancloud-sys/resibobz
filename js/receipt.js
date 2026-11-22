/*
 * receipt.js: receipt domain helpers. Pure functions, no DOM; depends on money.js.
 *
 * Saved receipt record:
 * {
 *   id, number, type: 'receipt', date, createdAt,          // ISO strings
 *   customer: { name, phone, tin, address },               // tin/address: '' or missing on older receipts
 *   paymentMethod: 'cash' | 'card' | 'transfer',
 *   lines: [{ description, qtyMilli, unitCents, zeroRated, netCents, gstCents }],
 *   gstRateBp, subtotalCents, taxableCents, zeroRatedCents, gstCents, totalCents,
 *   business: { name, address, phone, email, gstTin },      // snapshot at time of sale
 *   footer,
 *   voided?, voidedAt?, voidReason?,                        // set by db.voidReceipt; receipts are never deleted
 *   quoteId?, quoteNumber?                                  // set by db.saveConvertedReceipt when made from a quote
 * }
 * Quotes share this shape (minus paymentMethod, plus validUntil/notes/status fields): see js/quote.js.
 * A voided receipt keeps its number (never reused), shows VOID on screen and in the PDF,
 * and is left out of all totals (filter.summarize).
 * Everything needed to reprint is stored on the receipt, so later changes to
 * settings, products or the GST rate never alter a past receipt.
 */
(function (root) {
  'use strict';

  const money = typeof module !== 'undefined' && module.exports ? require('./money.js') : root.money;

  const PAYMENT_METHODS = [
    { id: 'cash', label: 'Cash' },
    { id: 'card', label: 'Card' },
    { id: 'transfer', label: 'Transfer' },
  ];

  function paymentLabel(id) {
    const m = PAYMENT_METHODS.find((p) => p.id === id);
    return m ? m.label : id;
  }

  /** "2026-11-19T..." -> "19 Nov 2026" (day-first, unambiguous). */
  function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** Local day "2026-12-04" -> "04 Dec 2026". Parsed as a local date, never UTC (no off-by-one in Belize). */
  function formatDay(day) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '');
    if (!m) return '';
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  /** "2026-11-19T15:45..." -> "19 Nov 2026, 3:45 pm" (local time). */
  function formatDateTime(iso) {
    const d = new Date(iso);
    return formatDate(iso) + ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  }

  /**
   * Build a receipt record (without id/number) from validated input.
   * input = { customer: {name, phone, tin?, address?}, paymentMethod, lines: [{description, qtyMilli, unitCents, zeroRated}] }
   */
  function buildReceipt(input, settings, now = new Date()) {
    const lines = input.lines.map((l) => ({
      description: l.description.trim(),
      qtyMilli: l.qtyMilli,
      unitCents: l.unitCents,
      zeroRated: !!l.zeroRated,
    }));
    const t = money.calcTotals(lines, settings.gstRateBp);
    const iso = now.toISOString();
    return {
      type: 'receipt',
      date: iso,
      createdAt: iso,
      customer: {
        name: (input.customer.name || '').trim(),
        phone: (input.customer.phone || '').trim(),
        tin: (input.customer.tin || '').trim(),
        address: (input.customer.address || '').trim(),
      },
      paymentMethod: input.paymentMethod,
      lines: lines.map((l, i) => ({ ...l, netCents: t.lines[i].netCents, gstCents: t.lines[i].gstCents })),
      gstRateBp: settings.gstRateBp,
      subtotalCents: t.subtotalCents,
      taxableCents: t.taxableCents,
      zeroRatedCents: t.zeroRatedCents,
      gstCents: t.gstCents,
      totalCents: t.totalCents,
      business: { ...settings.business },
      footer: settings.receiptFooter || '',
    };
  }

  /**
   * The record with every line value and total recalculated from its lines (qtyMilli, unitCents,
   * zeroRated) and gstRateBp, so a save never trusts a total it was handed. Throws if a line or the
   * rate is not a valid whole number in range. Used by db.js on every receipt/quote save.
   */
  function withTotals(record) {
    const bad = (msg) => { throw new Error('Not saved: ' + msg); };
    const rate = record.gstRateBp;
    if (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000) bad('the GST rate must be 0 to 100%.');
    if (!Array.isArray(record.lines) || !record.lines.length) bad('add at least one item.');
    record.lines.forEach((l, i) => {
      const n = 'line ' + (i + 1);
      if (!String(l.description || '').trim()) bad(n + ' needs a description.');
      if (!Number.isSafeInteger(l.qtyMilli) || l.qtyMilli <= 0 || l.qtyMilli > money.MAX_QTY_MILLI) bad(n + ' has an invalid quantity.');
      if (!Number.isSafeInteger(l.unitCents) || l.unitCents < 0 || l.unitCents > money.MAX_PRICE_CENTS) bad(n + ' has an invalid price.');
    });
    const t = money.calcTotals(record.lines.map((l) => ({ qtyMilli: l.qtyMilli, unitCents: l.unitCents, zeroRated: !!l.zeroRated })), rate);
    return {
      ...record,
      lines: record.lines.map((l, i) => ({ ...l, zeroRated: !!l.zeroRated, netCents: t.lines[i].netCents, gstCents: t.lines[i].gstCents })),
      subtotalCents: t.subtotalCents,
      taxableCents: t.taxableCents,
      zeroRatedCents: t.zeroRatedCents,
      gstCents: t.gstCents,
      totalCents: t.totalCents,
    };
  }

  /** Plain-text summary for WhatsApp / share text. Works for receipts and quotes (type 'quote'). */
  function summaryText(r) {
    const isQuote = r.type === 'quote';
    const out = [];
    if (r.business && r.business.name) out.push(r.business.name);
    out.push((isQuote ? 'Quotation ' : 'Receipt ') + r.number + ' (' + formatDate(r.date) + ')'
      + (r.voided ? ' - VOID' : '') + (isQuote && r.cancelledAt ? ' - CANCELLED' : ''));
    out.push('');
    for (const l of r.lines) {
      out.push(money.formatQty(l.qtyMilli) + ' x ' + l.description + ': ' + money.formatCents(l.netCents)
        + (l.zeroRated ? ' (zero-rated)' : ''));
    }
    out.push('');
    out.push('Subtotal: ' + money.formatCents(r.subtotalCents));
    out.push('GST (' + money.formatRate(r.gstRateBp) + '%): ' + money.formatCents(r.gstCents));
    out.push('Total: BZD ' + money.formatCents(r.totalCents));
    if (isQuote) {
      if (r.validUntil) out.push('Valid until: ' + formatDay(r.validUntil));
      if (r.notes) out.push('', r.notes);
    } else {
      out.push('Paid by: ' + paymentLabel(r.paymentMethod));
    }
    if (r.business && r.business.gstTin) out.push('GST TIN: ' + r.business.gstTin);
    return out.join('\n');
  }

  /**
   * Phone number for wa.me (digits only, with country code).
   * Belize numbers are 7 digits; those get the 501 country code. Returns '' if unusable.
   */
  function whatsappNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 7) d = '501' + d;
    return d.length >= 8 ? d : '';
  }

  /** wa.me link. With no usable phone, WhatsApp asks who to send to. */
  function whatsappUrl(phone, text) {
    return 'https://wa.me/' + whatsappNumber(phone) + '?text=' + encodeURIComponent(text);
  }

  /** "INV-0001" -> "INV-0001.pdf" (safe for any filesystem). */
  function pdfFileName(r) {
    return String(r.number).replace(/[^\w.-]+/g, '_') + '.pdf';
  }

  const api = { PAYMENT_METHODS, paymentLabel, formatDate, formatDay, formatDateTime, buildReceipt, withTotals, summaryText, whatsappNumber, whatsappUrl, pdfFileName };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.receipt = api;
})(typeof window !== 'undefined' ? window : globalThis);
