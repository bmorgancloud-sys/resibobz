/*
 * views/summary.js: Daily Summary (#/summary or #/summary/<YYYY-MM-DD>), opened from History.
 * Receipt count, subtotal, GST collected, total and a payment-method breakdown for one local day,
 * plus Share PDF / Download PDF. The maths is js/summary.js (pure); the PDF is pdf.summaryBlob.
 * Quotes and voided receipts are never counted.
 */
(function () {
  'use strict';
  const { h, empty } = ui;
  const fmt = (c) => money.formatCents(c);

  function row(label, value, cls) {
    return h('tr', cls ? { class: cls } : null, h('th', null, label), h('td', null, value));
  }

  function totalsCard(s) {
    return h('section', { class: 'card' },
      h('h2', null, 'Totals'),
      h('table', { class: 'totals' }, h('tbody', null,
        row('Receipts', String(s.count)),
        row('Subtotal (excl. GST)', fmt(s.subtotalCents)),
        s.zeroRatedCents ? row('of which zero-rated / exempt', fmt(s.zeroRatedCents)) : null,
        s.byRate.length > 1 ? s.byRate.map((x) => row('GST at ' + money.formatRate(x.gstRateBp) + '%', fmt(x.gstCents))) : null,
        row('GST collected', fmt(s.gstCents)),
        row('Total (BZD)', h('span', { class: 'total-value' }, fmt(s.totalCents)), 'grand'))));
  }

  function paymentCard(s) {
    return h('section', { class: 'card' },
      h('h2', null, 'By payment method'),
      h('table', { class: 'totals pay-table' },
        h('tbody', null, s.byPayment.map((p) =>
          h('tr', null,
            h('th', null, p.label),
            h('td', { class: 'pay-count' }, p.count + (p.count === 1 ? ' receipt' : ' receipts')),
            h('td', null, fmt(p.totalCents))))),
        h('tfoot', null, h('tr', { class: 'grand' },
          h('th', null, 'Total'),
          h('td', { class: 'pay-count' }, String(s.count)),
          h('td', null, fmt(s.totalCents))))));
  }

  function receiptsCard(s) {
    return h('section', { class: 'card' },
      h('h2', null, 'Receipts'),
      h('ul', { class: 'list' }, s.receipts.map((r) =>
        h('li', null, h('a', { class: 'list-row', href: '#/receipt/' + r.id },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, h('span', { class: 'list-title-text' }, r.number)),
            h('span', { class: 'list-sub' }, (r.customer && r.customer.name) || 'Walk-in')),
          h('span', { class: 'list-end' },
            h('span', { class: 'list-amount' }, fmt(r.totalCents)),
            h('span', { class: 'list-sub' },
              new Date(r.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
              + ' · ' + receipt.paymentLabel(r.paymentMethod))))))));
  }

  function voidNote(s) {
    const n = s.excluded.voided;
    return n ? h('p', { class: 'list-summary' }, n + (n === 1 ? ' voided receipt' : ' voided receipts') + ' not counted.') : null;
  }

  async function render({ el, params }) {
    const today = summary.dayOf(new Date());
    let day = summary.dayBounds(params[0]) ? params[0] : today;

    const dateInput = h('input', { type: 'date', value: day, max: today, required: true });
    const body = h('div', { class: 'summary-body' });
    el.append(h('div', { class: 'filters' }, ui.field('Date', dateInput)), body);

    const [all, business] = await Promise.all([db.getAll('receipts'), db.getSetting('business')]);
    let seq = 0;

    async function show() {
      const mine = ++seq;
      const s = summary.daily(all, day);
      if (!s.count) {
        body.replaceChildren(...[empty('No receipts on this date'), voidNote(s)].filter(Boolean));
        return;
      }
      const name = business && business.name;
      const share = detail.sharePanel(null, {
        shareTitle: 'Daily summary ' + receipt.formatDay(day),
        shareText: (name ? name + ' · ' : '') + 'Daily summary ' + receipt.formatDay(day) + ': ' + s.count
          + (s.count === 1 ? ' receipt, ' : ' receipts, ') + 'total ' + fmt(s.totalCents),
        waText: summary.summaryText(s, name),
        fileName: summary.pdfFileName(s),
        makeBlob: () => pdf.summaryBlob(s),
      });
      body.replaceChildren(...[
        totalsCard(s),
        paymentCard(s),
        h('div', { class: 'form-actions' }, share.nodes),
        receiptsCard(s),
        voidNote(s),
      ].filter(Boolean));
      if (mine === seq) await share.start();
    }

    dateInput.addEventListener('change', () => {
      if (!summary.dayBounds(dateInput.value)) return; // cleared or half-typed
      day = dateInput.value;
      history.replaceState(null, '', '#/summary/' + day);
      show();
    });

    await show();
  }

  (window.Views = window.Views || {}).summary = { render };
})();
