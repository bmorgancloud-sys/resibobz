/*
 * views/receipt.js: one saved receipt (#/receipt/<id>), with Share PDF, Download PDF,
 * WhatsApp fallback and Void. New Receipt lands on #/receipt/<id>/saved after saving.
 */
(function () {
  'use strict';
  const { h, toast, empty } = ui;

  const fmt = (c) => money.formatCents(c);

  function businessCard(b) {
    b = b || {};
    return h('section', { class: 'card' },
      h('h2', null, b.name || 'Business'),
      b.address ? h('div', { class: 'pre-line' }, b.address) : null,
      b.phone || b.email ? h('div', { class: 'list-sub' }, [b.phone, b.email].filter(Boolean).join(' · ')) : null,
      b.gstTin ? h('div', null, h('strong', null, 'GST TIN: '), b.gstTin) : null);
  }

  function receiptCard(r) {
    const c = r.customer || {};
    const usd = money.bzdToUsdCents(r.totalCents);
    return h('section', { class: 'card' + (r.voided ? ' is-void' : '') },
      h('div', { class: 'summary-head' },
        h('strong', null, r.number, r.voided ? h('span', { class: 'badge badge-void' }, 'VOID') : null),
        h('span', null, receipt.formatDateTime(r.date))),
      h('div', { class: 'detail-label' }, 'Bill to'),
      h('div', null, c.name || 'Walk-in customer'),
      c.phone ? h('div', { class: 'list-sub' }, c.phone) : null,
      c.tin ? h('div', { class: 'list-sub' }, 'TIN: ' + c.tin) : null,
      c.address ? h('div', { class: 'list-sub pre-line' }, c.address) : null,
      h('ul', { class: 'summary-lines' }, r.lines.map((l) =>
        h('li', null,
          h('span', null,
            l.description,
            h('br'),
            h('span', { class: 'muted' },
              money.formatQty(l.qtyMilli) + ' × ' + fmt(l.unitCents) + (l.zeroRated ? ' · zero-rated' : ''))),
          h('span', { class: 'num' }, fmt(l.netCents))))),
      h('table', { class: 'totals' }, h('tbody', null,
        h('tr', null, h('th', null, 'Subtotal'), h('td', null, fmt(r.subtotalCents))),
        r.zeroRatedCents ? h('tr', null, h('th', null, 'Zero-rated / exempt'), h('td', null, fmt(r.zeroRatedCents))) : null,
        h('tr', null, h('th', null, 'GST (' + money.formatRate(r.gstRateBp) + '%)'), h('td', null, fmt(r.gstCents))),
        h('tr', { class: 'grand' }, h('th', null, 'Total (BZD)'), h('td', { class: 'total-value' }, fmt(r.totalCents))),
        h('tr', null, h('th', null, 'Total (USD at 2:1)'), h('td', { class: 'total-value' }, 'US' + fmt(usd))))),
      h('p', { class: 'detail-meta' }, 'Paid by ' + receipt.paymentLabel(r.paymentMethod)),
      r.footer ? h('p', { class: 'detail-meta' }, h('span', { class: 'detail-label' }, 'Note: '), r.footer) : null);
  }

  function voidNotice(r) {
    return h('div', { class: 'notice notice-danger', role: 'status' },
      h('strong', null, 'Voided ' + receipt.formatDateTime(r.voidedAt)),
      r.voidReason ? h('div', null, 'Reason: ' + r.voidReason) : null,
      h('div', null, 'Not counted in totals. The number ' + r.number + ' will not be reused.'));
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
        h('span', null, 'Saved ' + r.number + '.'), ' ', h('a', { href: '#/history' }, 'View in History')));
    }

    const fileName = receipt.pdfFileName(r);
    const waUrl = receipt.whatsappUrl(r.customer.phone, receipt.summaryText(r));

    // ---- Actions ----
    const shareBtn = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Preparing PDF…');
    const downloadBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block', disabled: true }, 'Download PDF');
    const waBtn = h('a', { class: 'btn btn-whatsapp btn-block', href: waUrl, target: '_blank', rel: 'noopener', hidden: true },
      'Send summary on WhatsApp');
    const hint = h('p', { class: 'share-hint', hidden: true, role: 'status' });
    const voidBtn = r.voided ? null : h('button', { type: 'button', class: 'btn btn-danger-outline btn-block' }, 'Void receipt');

    el.append(...[
      r.voided ? voidNotice(r) : null,
      businessCard(r.business),
      receiptCard(r),
      h('div', { class: 'form-actions' },
        shareBtn, hint, waBtn, downloadBtn,
        h('a', { class: 'btn btn-secondary btn-block', href: '#/new' }, 'New receipt'),
        voidBtn),
    ].filter(Boolean)); // Element.append(null) would print "null"

    if (voidBtn) {
      voidBtn.addEventListener('click', async () => {
        const reason = await ui.ask('Void receipt ' + r.number + '? This can\'t be undone.',
          'Reason (optional)', { okText: 'Void receipt', danger: true });
        if (reason === null) return;
        voidBtn.disabled = true;
        try {
          await db.voidReceipt(r.id, reason);
          toast(r.number + ' voided');
          el.replaceChildren();
          await render({ ...ctx, params: [String(r.id)] }); // redraw, with the VOID PDF
        } catch (err) {
          console.error(err);
          toast('Could not void: ' + err.message);
          voidBtn.disabled = false;
        }
      });
    }

    // Build the PDF up front so Share runs straight from the tap
    // (Web Share needs the user's tap to still be "fresh").
    let file;
    try {
      const blob = await pdf.receiptBlob(r);
      file = new File([blob], fileName, { type: 'application/pdf' });
    } catch (err) {
      console.error(err);
      shareBtn.textContent = 'PDF failed';
      hint.textContent = 'Could not create the PDF: ' + err.message;
      hint.hidden = false;
      waBtn.hidden = false;
      return;
    }

    const canShareFile = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    shareBtn.textContent = canShareFile ? 'Share PDF' : 'Download PDF & send on WhatsApp';
    shareBtn.disabled = false;
    downloadBtn.disabled = false;
    downloadBtn.hidden = !canShareFile; // in fallback mode the main button already downloads

    function fallback() {
      ui.download(file, fileName);
      hint.textContent = 'PDF saved to your downloads. Attach it in WhatsApp, or send the text summary below.';
      hint.hidden = false;
      waBtn.hidden = false;
    }

    shareBtn.addEventListener('click', async () => {
      if (!canShareFile) return fallback();
      try {
        await navigator.share({
          files: [file],
          title: 'Receipt ' + r.number,
          text: 'Receipt ' + r.number + (r.voided ? ' (VOID)' : '') + ': ' + fmt(r.totalCents),
        });
      } catch (err) {
        if (err.name === 'AbortError') return; // user closed the share sheet
        console.error(err);
        toast('Sharing failed, downloading instead');
        fallback();
      }
    });

    downloadBtn.addEventListener('click', () => ui.download(file, fileName));
  }

  (window.Views = window.Views || {}).receipt = { render };
})();
