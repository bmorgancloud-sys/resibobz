/*
 * pdf.js: A4 receipt PDF using jsPDF + jspdf-autotable from /lib (lazy-loaded, offline).
 * Exposes global `pdf` with receiptBlob(receipt) -> Promise<Blob>.
 */
(function () {
  'use strict';

  const LIBS = ['lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js'];

  const PAGE_W = 210;
  const PAGE_H = 297;
  const M = 15;                      // page margin, mm
  const FOOTER_SPACE = 24;           // reserved at the bottom of each page
  const TEXT = [26, 31, 41];
  const MUTED = [91, 101, 117];
  const BRAND = [11, 92, 171];
  const RULE = [221, 226, 234];
  const PT_TO_MM = 0.3528;

  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(s);
    });
  }

  /** Load jsPDF then autotable, in order, once. */
  function ensureLibs() {
    if (window.jspdf && window.autoTable) return Promise.resolve();
    if (!loading) {
      loading = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .catch((err) => { loading = null; throw err; });
    }
    return loading;
  }

  function lineHeight(doc) {
    return doc.getFontSize() * PT_TO_MM * 1.25;
  }

  /** Write wrapped text; returns the y below it. */
  function textBlock(doc, text, x, y, { maxWidth = 90, align = 'left' } = {}) {
    if (!text) return y;
    const lines = doc.splitTextToSize(String(text), maxWidth);
    const lh = lineHeight(doc);
    lines.forEach((ln, i) => doc.text(ln, x, y + i * lh, { align, baseline: 'top' }));
    return y + lines.length * lh;
  }

  function setFont(doc, size, style = 'normal', color = TEXT) {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  }

  function build(r, logo) {
    const { jsPDF } = window.jspdf;
    const fmt = money.formatCents;
    const rateText = money.formatRate(r.gstRateBp) + '%';
    const b = r.business || {};

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    doc.setProperties({ title: 'Receipt ' + r.number, subject: b.name || 'Receipt', creator: 'ResiboBZ' });
    doc.setLineHeightFactor(1.25);

    // ---- Left: logo + business ----
    let leftY = M;
    if (logo && logo.dataUrl) {
      const scale = Math.min(45 / logo.width, 24 / logo.height);
      const w = logo.width * scale;
      const hgt = logo.height * scale;
      try {
        doc.addImage(logo.dataUrl, logo.format, M, M, w, hgt);
        leftY = M + hgt + 4;
      } catch (err) {
        console.warn('Logo could not be added to PDF', err);
      }
    }
    setFont(doc, 13, 'bold');
    leftY = textBlock(doc, b.name, M, leftY, { maxWidth: 100 });
    setFont(doc, 9, 'normal', MUTED);
    leftY = textBlock(doc, b.address, M, leftY + 1, { maxWidth: 100 });
    leftY = textBlock(doc, [b.phone, b.email].filter(Boolean).join('  ·  '), M, leftY, { maxWidth: 100 });
    if (b.gstTin) {
      setFont(doc, 9, 'bold');
      leftY = textBlock(doc, 'GST TIN: ' + b.gstTin, M, leftY + 1, { maxWidth: 100 });
    }

    // ---- Right: title + meta ----
    const R = PAGE_W - M;
    setFont(doc, 22, 'bold', BRAND);
    doc.text('RECEIPT', R, M, { align: 'right', baseline: 'top' });
    let rightY = M + 12;
    const meta = [
      ['Receipt no.', r.number],
      ['Date', receipt.formatDate(r.date)],
      ['Payment', receipt.paymentLabel(r.paymentMethod)],
    ];
    for (const [label, value] of meta) {
      setFont(doc, 9, 'normal', MUTED);
      doc.text(label, R - 58, rightY, { baseline: 'top' });
      setFont(doc, 9, 'bold');
      doc.text(String(value), R, rightY, { align: 'right', baseline: 'top' });
      rightY += 5.5;
    }

    // ---- Customer ----
    let y = Math.max(leftY, rightY) + 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(M, y, R, y);
    y += 5;
    setFont(doc, 8, 'bold', MUTED);
    doc.text('BILL TO', M, y, { baseline: 'top' });
    y += 4.5;
    setFont(doc, 11, 'bold');
    y = textBlock(doc, r.customer && r.customer.name ? r.customer.name : 'Walk-in customer', M, y, { maxWidth: 120 });
    if (r.customer && r.customer.phone) {
      setFont(doc, 9, 'normal', MUTED);
      y = textBlock(doc, r.customer.phone, M, y + 0.5);
    }
    y += 6;

    // ---- Line items ----
    window.autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, bottom: FOOTER_SPACE },
      head: [['Description', 'Qty', 'Unit price', 'GST', 'Amount']],
      body: r.lines.map((l) => [
        l.description,
        money.formatQty(l.qtyMilli),
        fmt(l.unitCents),
        l.zeroRated ? 'Zero-rated' : rateText,
        fmt(l.netCents),
      ]),
      theme: 'striped',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 2.5, textColor: TEXT, overflow: 'linebreak' },
      headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 246, 249] },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 16 },
        2: { halign: 'right', cellWidth: 28 },
        3: { halign: 'right', cellWidth: 24 },
        4: { halign: 'right', cellWidth: 30 },
      },
      didParseCell: (d) => {
        if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
      },
    });
    y = doc.lastAutoTable.finalY + 8;

    // Keep the GST summary and totals together on one page.
    const BLOCK_H = 40;
    if (y + BLOCK_H > PAGE_H - FOOTER_SPACE) {
      doc.addPage();
      y = M;
    }

    // ---- GST breakdown (left) ----
    const gstBody = [];
    if (r.taxableCents || !r.zeroRatedCents) gstBody.push(['Standard rated (' + rateText + ')', fmt(r.taxableCents), fmt(r.gstCents)]);
    if (r.zeroRatedCents) gstBody.push(['Zero-rated / exempt', fmt(r.zeroRatedCents), fmt(0)]);
    window.autoTable(doc, {
      startY: y,
      margin: { left: M, bottom: FOOTER_SPACE },
      tableWidth: 92,
      head: [['GST summary', 'Net', 'GST']],
      body: gstBody,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: TEXT, lineColor: RULE, lineWidth: 0.2 },
      headStyles: { fillColor: [244, 246, 249], textColor: MUTED, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', cellWidth: 24 }, 2: { halign: 'right', cellWidth: 22 } },
      didParseCell: (d) => {
        if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
      },
    });

    // ---- Totals (right) ----
    const labelX = R - 70;
    let ty = y + 1;
    const row = (label, value) => {
      setFont(doc, 10, 'normal', MUTED);
      doc.text(label, labelX, ty, { baseline: 'top' });
      setFont(doc, 10, 'normal');
      doc.text(value, R, ty, { align: 'right', baseline: 'top' });
      ty += 6;
    };
    row('Subtotal', fmt(r.subtotalCents));
    row('GST (' + rateText + ')', fmt(r.gstCents));
    doc.setDrawColor(...TEXT);
    doc.setLineWidth(0.4);
    doc.line(labelX, ty, R, ty);
    ty += 3;
    setFont(doc, 13, 'bold');
    doc.text('Total (BZD)', labelX, ty, { baseline: 'top' });
    doc.text(fmt(r.totalCents), R, ty, { align: 'right', baseline: 'top' });

    // ---- Footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      const fy = PAGE_H - FOOTER_SPACE + 6;
      if (p === pages && r.footer) {
        setFont(doc, 9, 'normal', MUTED);
        textBlock(doc, r.footer, PAGE_W / 2, fy, { maxWidth: PAGE_W - 2 * M - 30, align: 'center' });
      }
      setFont(doc, 8, 'normal', MUTED);
      doc.text(r.number, M, PAGE_H - 8);
      if (pages > 1) doc.text('Page ' + p + ' of ' + pages, R, PAGE_H - 8, { align: 'right' });
    }

    return doc;
  }

  /** Build the receipt PDF and return it as a Blob. Uses the current logo from Settings. */
  async function receiptBlob(r) {
    const [, logo] = await Promise.all([ensureLibs(), db.getSetting('logo')]);
    return build(r, logo).output('blob');
  }

  window.pdf = { ensureLibs, receiptBlob };
})();
