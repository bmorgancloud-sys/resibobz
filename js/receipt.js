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
 *   footer
 * }
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

  /** Plain-text summary for WhatsApp / share text. */
  function summaryText(r) {
    const out = [];
    if (r.business && r.business.name) out.push(r.business.name);
    out.push('Receipt ' + r.number + ' (' + formatDate(r.date) + ')');
    out.push('');
    for (const l of r.lines) {
      out.push(money.formatQty(l.qtyMilli) + ' x ' + l.description + ': ' + money.formatCents(l.netCents)
        + (l.zeroRated ? ' (zero-rated)' : ''));
    }
    out.push('');
    out.push('Subtotal: ' + money.formatCents(r.subtotalCents));
    out.push('GST (' + money.formatRate(r.gstRateBp) + '%): ' + money.formatCents(r.gstCents));
    out.push('Total: BZD ' + money.formatCents(r.totalCents));
    out.push('Paid by: ' + paymentLabel(r.paymentMethod));
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

  const api = { PAYMENT_METHODS, paymentLabel, formatDate, buildReceipt, summaryText, whatsappNumber, whatsappUrl, pdfFileName };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.receipt = api;
})(typeof window !== 'undefined' ? window : globalThis);
