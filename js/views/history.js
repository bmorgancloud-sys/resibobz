/*
 * views/history.js: saved receipts (#/history) and receipt detail with PDF/share (#/history/<id>).
 */
(function () {
  'use strict';
  const { h, toast, empty } = ui;

  async function renderList({ el }) {
    const receipts = await db.getAll('receipts');
    receipts.sort((a, b) => b.id - a.id);
    if (!receipts.length) {
      el.append(empty('No receipts yet.'), h('a', { class: 'btn btn-block', href: '#/new' }, 'New receipt'));
      return;
    }
    el.append(h('ul', { class: 'list' }, receipts.map((r) =>
      h('li', null,
        h('a', { class: 'list-row', href: '#/history/' + r.id },
          h('span', { class: 'list-main' },
            h('span', { class: 'list-title' }, r.number),
            h('span', { class: 'list-sub' }, (r.customer.name || 'Walk-in') + ' · ' + receipt.formatDate(r.date))),
          h('span', { class: 'list-end' },
            h('span', { class: 'list-amount' }, money.formatCents(r.totalCents)),
            h('span', { class: 'list-sub' }, receipt.paymentLabel(r.paymentMethod))))))));
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function renderDetail({ el, params, setTitle }) {
    const r = await db.get('receipts', Number(params[0]));
    if (!r) {
      el.append(empty('This receipt no longer exists.'), h('a', { class: 'btn btn-secondary btn-block', href: '#/history' }, 'Back to history'));
      return;
    }
    setTitle(r.number);

    const fmt = money.formatCents;
    const fileName = receipt.pdfFileName(r);
    const waUrl = receipt.whatsappUrl(r.customer.phone, receipt.summaryText(r));

    // ---- Summary ----
    const summary = h('section', { class: 'card' },
      h('div', { class: 'summary-head' },
        h('strong', null, r.number),
        h('span', null, receipt.formatDate(r.date))),
      h('div', null, r.customer.name || 'Walk-in customer', r.customer.phone ? ' · ' + r.customer.phone : ''),
      h('div', { class: 'list-sub' }, 'Paid by ' + receipt.paymentLabel(r.paymentMethod)),
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
        h('tr', { class: 'grand' }, h('th', null, 'Total'), h('td', null, fmt(r.totalCents))))));

    // ---- Actions ----
    const shareBtn = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Preparing PDF…');
    const downloadBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block', disabled: true }, 'Download PDF');
    const waBtn = h('a', { class: 'btn btn-whatsapp btn-block', href: waUrl, target: '_blank', rel: 'noopener', hidden: true },
      'Send summary on WhatsApp');
    const hint = h('p', { class: 'share-hint', hidden: true, role: 'status' });

    el.append(summary, h('div', { class: 'form-actions' },
      shareBtn, hint, waBtn, downloadBtn,
      h('a', { class: 'btn btn-secondary btn-block', href: '#/new' }, 'New receipt')));

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
    shareBtn.textContent = canShareFile ? 'Share receipt' : 'Download PDF & send on WhatsApp';
    shareBtn.disabled = false;
    downloadBtn.disabled = false;
    downloadBtn.hidden = !canShareFile; // in fallback mode the main button already downloads

    function fallback() {
      downloadBlob(file, fileName);
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
          text: 'Receipt ' + r.number + ': ' + fmt(r.totalCents),
        });
      } catch (err) {
        if (err.name === 'AbortError') return; // user closed the share sheet
        console.error(err);
        toast('Sharing failed, downloading instead');
        fallback();
      }
    });

    downloadBtn.addEventListener('click', () => downloadBlob(file, fileName));
  }

  (window.Views = window.Views || {}).history = {
    render: (ctx) => (ctx.params.length ? renderDetail(ctx) : renderList(ctx)),
  };
})();
