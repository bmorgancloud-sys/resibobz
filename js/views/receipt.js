/*
 * views/receipt.js: one saved receipt (#/receipt/<id>), with Share PDF, Download PDF,
 * WhatsApp fallback and Void. New Receipt lands on #/receipt/<id>/saved after saving.
 * A receipt converted from a quote links back to it ("From quote QT-0003").
 * Shared pieces (business card, lines, totals, share panel) live in js/detail.js.
 */
(function () {
  'use strict';
  const { h, toast, empty } = ui;

  function receiptCard(r) {
    return h('section', { class: 'card' + (r.voided ? ' is-void' : '') },
      h('div', { class: 'summary-head' },
        h('strong', null, r.number, r.voided ? h('span', { class: 'badge badge-void' }, 'VOID') : null),
        h('span', null, receipt.formatDateTime(r.date))),
      r.quoteId ? h('p', { class: 'detail-meta detail-link' },
        'From quote ', h('a', { href: '#/quote/' + r.quoteId }, r.quoteNumber || 'quote')) : null,
      detail.billTo(r.customer),
      detail.linesAndTotals(r),
      h('p', { class: 'detail-meta' }, 'Paid by ' + receipt.paymentLabel(r.paymentMethod)),
      r.footer ? h('p', { class: 'detail-meta' }, h('span', { class: 'detail-label' }, 'Note: '), r.footer) : null);
  }

  function voidNotice(r) {
    return h('div', { class: 'notice notice-danger', role: 'status' },
      h('strong', null, 'Voided ' + receipt.formatDateTime(r.voidedAt)),
      r.voidReason ? h('div', null, 'Reason: ' + r.voidReason) : null,
      h('div', null, 'Not counted in totals. The number ' + r.number + ' will not be reused.'),
      h('button', {
        type: 'button', class: 'btn btn-secondary btn-block void-copy',
        onclick: () => { Views.new.startCorrection(r); location.hash = '#/new'; },
      }, 'Issue corrected receipt'));
  }

  async function render(ctx) {
    const { el, params, setTitle } = ctx;
    const r = await db.get('receipts', Number(params[0]));
    if (!r) {
      el.append(empty('This receipt no longer exists.'), h('a', { class: 'btn btn-secondary btn-block', href: '#/history' }, 'Back to history'));
      return;
    }
    setTitle(r.number);

    // Just saved from New Receipt: say so once, then drop "/saved" so a reload doesn't repeat it.
    if (params[1] === 'saved') {
      history.replaceState(null, '', '#/receipt/' + r.id);
      el.append(h('div', { class: 'notice notice-ok', role: 'status' },
        h('span', null, 'Saved ' + r.number + (r.quoteNumber ? ' from quote ' + r.quoteNumber : '') + '.'), ' ',
        h('a', { href: '#/history' }, 'View in History')));
    }

    const share = detail.sharePanel(r, {
      shareTitle: 'Receipt ' + r.number,
      shareText: 'Receipt ' + r.number + (r.voided ? ' (VOID)' : '') + ': ' + money.formatCents(r.totalCents),
    });
    const voidBtn = r.voided ? null : h('button', { type: 'button', class: 'btn btn-danger-outline btn-block' }, 'Void receipt');

    el.append(...[
      r.voided ? voidNotice(r) : null,
      detail.businessCard(r.business),
      receiptCard(r),
      h('div', { class: 'form-actions' },
        share.nodes,
        h('a', { class: 'btn btn-secondary btn-block', href: '#/new' }, 'New receipt'),
        voidBtn),
    ].filter(Boolean)); // Element.append(null) would print "null"

    if (voidBtn) {
      voidBtn.addEventListener('click', async () => {
        // Saved receipts are never edited: void (reason required) and issue a new one.
        const reason = await ui.ask('Void receipt ' + r.number + '? It stays in History marked VOID, is left out of every total, ' +
          'and its number is never reused. This can\'t be undone.',
          'Reason', { okText: 'Void receipt', danger: true, required: 'Enter a reason, e.g. wrong price' });
        if (reason === null) return;
        voidBtn.disabled = true;
        try {
          await db.voidReceipt(r.id, reason);
          toast(r.number + ' voided');
          el.replaceChildren();
          await render({ ...ctx, params: [String(r.id)] }); // redraw, with the VOID PDF
        } catch (err) {
          console.error(err);
          safety.notSaved(err);
          voidBtn.disabled = false;
        }
      });
    }

    await share.start();
  }

  (window.Views = window.Views || {}).receipt = { render };
})();
