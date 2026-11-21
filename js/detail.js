/*
 * detail.js: building blocks shared by the receipt and quote detail screens
 * (views/receipt.js, views/quote.js). Exposes global `detail`.
 */
(function () {
  'use strict';
  const { h, toast } = ui;

  const fmt = (c) => money.formatCents(c);

  function businessCard(b) {
    b = b || {};
    return h('section', { class: 'card' },
      h('h2', null, b.name || 'Business'),
      b.address ? h('div', { class: 'pre-line' }, b.address) : null,
      b.phone || b.email ? h('div', { class: 'list-sub' }, [b.phone, b.email].filter(Boolean).join(' · ')) : null,
      b.gstTin ? h('div', null, h('strong', null, 'GST TIN: '), b.gstTin) : null);
  }

  /** "Bill to" block for a receipt/quote customer. */
  function billTo(c) {
    c = c || {};
    return [
      h('div', { class: 'detail-label' }, 'Bill to'),
      h('div', null, c.name || 'Walk-in customer'),
      c.phone ? h('div', { class: 'list-sub' }, c.phone) : null,
      c.tin ? h('div', { class: 'list-sub' }, 'TIN: ' + c.tin) : null,
      c.address ? h('div', { class: 'list-sub pre-line' }, c.address) : null,
    ];
  }

  /** Line items, then Subtotal / zero-rated / GST / Total (BZD) / Total (USD at the 2:1 peg). */
  function linesAndTotals(r) {
    const usd = money.bzdToUsdCents(r.totalCents);
    return [
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
    ];
  }

  /**
   * Share PDF / Download PDF / WhatsApp fallback for a receipt or quote.
   * Returns { nodes, start }: append nodes, then await start(), which builds the PDF up front so
   * Share runs straight from the tap (Web Share needs the user's tap to still be "fresh").
   * shareText: the short text sent along with the file.
   */
  function sharePanel(r, { shareTitle, shareText }) {
    const fileName = receipt.pdfFileName(r);
    const waUrl = receipt.whatsappUrl(r.customer && r.customer.phone, receipt.summaryText(r));

    const shareBtn = h('button', { type: 'button', class: 'btn btn-block', disabled: true }, 'Preparing PDF…');
    const downloadBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-block', disabled: true }, 'Download PDF');
    const waBtn = h('a', { class: 'btn btn-whatsapp btn-block', href: waUrl, target: '_blank', rel: 'noopener', hidden: true },
      'Send summary on WhatsApp');
    const hint = h('p', { class: 'share-hint', hidden: true, role: 'status' });

    async function start() {
      let file;
      try {
        const blob = await pdf.documentBlob(r);
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
          await navigator.share({ files: [file], title: shareTitle, text: shareText });
        } catch (err) {
          if (err.name === 'AbortError') return; // user closed the share sheet
          console.error(err);
          toast('Sharing failed, downloading instead');
          fallback();
        }
      });

      downloadBtn.addEventListener('click', () => ui.download(file, fileName));
    }

    return { nodes: [shareBtn, hint, waBtn, downloadBtn], start };
  }

  window.detail = { businessCard, billTo, linesAndTotals, sharePanel };
})();
