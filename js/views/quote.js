/*
 * views/quote.js: one saved quote (#/quote/<id>). Routes #/quote/new and #/quote/<id>/edit
 * go to the quote editor (views/quote-edit.js).
 *
 * Buttons: Share PDF, Download PDF, Edit and Cancel quote (open/expired only) and Convert to receipt,
 * which pre-fills New Receipt (Views.new.startConversion); the quote only becomes Converted when that
 * receipt is saved. Expired quotes warn before converting. Converted quotes link to their receipt.
 */
(function () {
  'use strict';
  const { h, toast, empty } = ui;

  const BADGE = { open: 'badge-open', expired: 'badge-expired', converted: 'badge-converted', cancelled: 'badge-void' };

  function statusBadge(status) {
    return h('span', { class: 'badge ' + BADGE[status] }, quote.statusLabel(status));
  }

  function statusNotice(q, status) {
    if (status === 'converted') {
      return h('div', { class: 'notice notice-ok', role: 'status' },
        h('span', null, 'Converted to '),
        h('a', { href: '#/receipt/' + q.receiptId }, q.receiptNumber || 'receipt'),
        h('span', null, q.convertedAt ? ' on ' + receipt.formatDate(q.convertedAt) + '.' : '.'),
        h('div', null, 'This quote is read-only.'));
    }
    if (status === 'cancelled') {
      return h('div', { class: 'notice notice-danger', role: 'status' },
        h('strong', null, 'Cancelled ' + receipt.formatDateTime(q.cancelledAt)),
        h('div', null, 'This quote can\'t be edited or converted. The number ' + q.number + ' will not be reused.'));
    }
    if (status === 'expired') {
      return h('div', { class: 'notice', role: 'status' },
        'This quote expired on ' + receipt.formatDay(q.validUntil) + '. You can still edit it or convert it.');
    }
    return null;
  }

  function quoteCard(q, status) {
    return h('section', { class: 'card' },
      h('div', { class: 'summary-head' },
        h('strong', null, q.number, statusBadge(status)),
        h('span', null, receipt.formatDate(q.date))),
      h('p', { class: 'detail-meta detail-valid' },
        h('span', { class: 'detail-label' }, 'Valid until: '), receipt.formatDay(q.validUntil) || '-'),
      detail.billTo(q.customer),
      detail.linesAndTotals(q),
      q.notes ? h('div', { class: 'detail-notes' },
        h('div', { class: 'detail-label' }, 'Notes / terms'),
        h('div', { class: 'pre-line' }, q.notes)) : null,
      h('p', { class: 'detail-meta' }, 'Quotes are not counted in sales or GST totals.'),
      q.footer ? h('p', { class: 'detail-meta' }, h('span', { class: 'detail-label' }, 'Note: '), q.footer) : null);
  }

  async function renderDetail(ctx) {
    const { el, params, setTitle } = ctx;
    const q = await db.get('quotes', Number(params[0]));
    if (!q) {
      el.append(empty('This quote no longer exists.'), h('a', { class: 'btn btn-secondary btn-block', href: '#/quotes' }, 'Back to quotes'));
      return;
    }
    setTitle(q.number);
    const status = quote.status(q);
    const active = quote.isActive(q);

    if (params[1] === 'saved') {
      history.replaceState(null, '', '#/quote/' + q.id);
      el.append(h('div', { class: 'notice notice-ok', role: 'status' },
        h('span', null, 'Saved ' + q.number + '.'), ' ', h('a', { href: '#/quotes' }, 'View in Quotes')));
    }

    const share = detail.sharePanel(q, {
      shareTitle: 'Quotation ' + q.number,
      shareText: 'Quotation ' + q.number + (status === 'cancelled' ? ' (CANCELLED)' : '') + ': ' + money.formatCents(q.totalCents),
    });
    const convertBtn = active ? h('button', { type: 'button', class: 'btn btn-secondary btn-block' }, 'Convert to receipt') : null;
    const editBtn = active ? h('a', { class: 'btn btn-secondary btn-block', href: '#/quote/' + q.id + '/edit' }, 'Edit') : null;
    const cancelBtn = active ? h('button', { type: 'button', class: 'btn btn-danger-outline btn-block' }, 'Cancel quote') : null;

    el.append(...[
      statusNotice(q, status),
      detail.businessCard(q.business),
      quoteCard(q, status),
      h('div', { class: 'form-actions' },
        share.nodes, convertBtn, editBtn,
        h('a', { class: 'btn btn-secondary btn-block', href: '#/quote/new' }, 'New quote'),
        cancelBtn),
    ].filter(Boolean));

    if (convertBtn) {
      convertBtn.addEventListener('click', async () => {
        const fresh = await db.get('quotes', q.id);
        if (!fresh || !quote.isActive(fresh)) { toast('This quote can no longer be converted'); return; }
        if (quote.status(fresh) === 'expired'
          && !(await ui.confirm('This quote expired on ' + receipt.formatDay(fresh.validUntil) + '. Convert anyway?',
            { okText: 'Convert anyway' }))) return;
        const newView = window.Views.new;
        const current = newView.convertingQuote();
        if (newView.hasDraft() && !(current && current.id === fresh.id)
          && !(await ui.confirm('New Receipt has an unsaved receipt. Replace it with this quote?',
            { okText: 'Replace', danger: true }))) return;
        if (!(current && current.id === fresh.id)) newView.startConversion(fresh);
        location.hash = '#/new';
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        const ok = await ui.confirm('Cancel quote ' + q.number + '? It stays in Quotes as Cancelled and can\'t be edited or converted.',
          { okText: 'Cancel quote', cancelText: 'Keep quote', danger: true });
        if (!ok) return;
        cancelBtn.disabled = true;
        try {
          await db.cancelQuote(q.id);
          toast(q.number + ' cancelled');
          el.replaceChildren();
          await renderDetail({ ...ctx, params: [String(q.id)] }); // redraw, with the CANCELLED PDF
        } catch (err) {
          console.error(err);
          toast('Could not cancel: ' + err.message);
          cancelBtn.disabled = false;
        }
      });
    }

    await share.start();
  }

  function render(ctx) {
    const [first, second] = ctx.params;
    if (first === 'new' || second === 'edit') return window.Views.quoteEdit.render(ctx);
    return renderDetail(ctx);
  }

  (window.Views = window.Views || {}).quote = { render, statusBadge };
})();
