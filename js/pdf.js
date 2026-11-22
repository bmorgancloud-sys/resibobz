/*
 * pdf.js: Letter/A4 receipt and quote PDF using jsPDF + jspdf-autotable from /lib (lazy-loaded, offline).
 * Exposes global `pdf` with documentBlob(doc) -> Promise<Blob> (receiptBlob/quoteBlob are aliases), summaryBlob
 * (Daily Summary), gstSummaryBlob (Stats: monthly GST summary) and PAGE_SIZES.
 * Quotes (doc.type === 'quote') are titled QUOTATION, show Valid until and Notes / terms, and no payment method.
 * Watermarks: VOID (voided receipt), CANCELLED (cancelled quote).
 */
(function () {
  'use strict';

  const LIBS = ['lib/jspdf.umd.min.js', 'lib/jspdf.plugin.autotable.min.js'];

  /** Supported page sizes (mm). Keys are the stored `pageSize` setting values. */
  const PAGE_SIZES = {
    letter: { label: 'Letter', format: 'letter', w: 215.9, h: 279.4 },
    a4:     { label: 'A4',     format: 'a4',     w: 210,   h: 297 },
  };
  const DEFAULT_PAGE_SIZE = 'letter';

  const M = 15;                      // page margin, mm
  const FOOTER_SPACE = 24;           // reserved at the bottom of each page
  const TEXT = [26, 31, 41];
  const MUTED = [91, 101, 117];
  const BRAND = [13, 93, 170]; // #0D5DAA, the app's blue (--brand): title and table header
  const RULE = [221, 226, 234];
  const DANGER = [179, 38, 30];
  const PT_TO_MM = 0.3528;
  const LOGO_MAX_W = 40;             // logo box, mm; the image is scaled to fit, never stretched
  const LOGO_MAX_H = 28;
  const LOGO_GAP = 5;                // space between logo and business details

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

  /**
   * Draw the logo at (x, y), scaled to fit LOGO_MAX_W x LOGO_MAX_H mm with its aspect ratio kept.
   * Returns the drawn size { w, h } in mm, or null when there is no logo or it can't be drawn.
   */
  function drawLogo(doc, logo, x, y) {
    if (!logo || !logo.dataUrl) return null;
    try {
      let { width, height } = logo;
      if (!(width > 0 && height > 0)) ({ width, height } = doc.getImageProperties(logo.dataUrl));
      const scale = Math.min(LOGO_MAX_W / width, LOGO_MAX_H / height);
      const w = width * scale;
      const h = height * scale;
      doc.addImage(logo.dataUrl, logo.format || 'PNG', x, y, w, h);
      return { w, h };
    } catch (err) {
      console.warn('Logo could not be added to PDF', err);
      return null;
    }
  }

  /**
   * Large diagonal word ("VOID", "CANCELLED") across the middle of the current page, see-through
   * so the document underneath stays readable. Rotated along the page diagonal; long words are
   * scaled down to fit within 80% of the diagonal.
   */
  function drawWatermark(doc, text, pageW, pageH) {
    const angle = Math.atan2(pageH, pageW);           // radians, bottom-left to top-right
    let size = 150;
    setFont(doc, size, 'bold', DANGER);
    const maxW = Math.hypot(pageW, pageH) * 0.8;
    if (doc.getTextWidth(text) > maxW) {
      size = Math.floor(size * maxW / doc.getTextWidth(text));
      setFont(doc, size, 'bold', DANGER);
    }
    const w = doc.getTextWidth(text);
    const capH = size * PT_TO_MM * 0.72;
    // jsPDF rotates text about its start point, so offset the start to centre the word.
    const x = pageW / 2 - (w / 2) * Math.cos(angle) + (capH / 2) * Math.sin(angle);
    const y = pageH / 2 + (w / 2) * Math.sin(angle) + (capH / 2) * Math.cos(angle);
    const seeThrough = typeof doc.GState === 'function';
    if (seeThrough) doc.setGState(new doc.GState({ opacity: 0.18 }));
    doc.text(text, x, y, { angle: angle * 180 / Math.PI });
    if (seeThrough) doc.setGState(new doc.GState({ opacity: 1 }));
  }

  /**
   * Page header shared by every document: logo + business details + GST TIN on the left,
   * big title and [label, value] meta rows on the right. Returns the y below the taller side.
   */
  function drawHeader(doc, { b, logo, title, meta, pageW }) {
    const R = pageW - M;
    const META_X = R - 58;           // left edge of the meta labels

    // ---- Left: logo, then business details beside it ----
    const logoBox = drawLogo(doc, logo, M, M);
    const textX = logoBox ? M + logoBox.w + LOGO_GAP : M;
    const textW = META_X - 6 - textX;
    setFont(doc, 13, 'bold');
    let leftY = textBlock(doc, b.name, textX, M, { maxWidth: textW });
    setFont(doc, 9, 'normal', MUTED);
    leftY = textBlock(doc, b.address, textX, leftY + 1, { maxWidth: textW });
    leftY = textBlock(doc, [b.phone, b.email].filter(Boolean).join('  ·  '), textX, leftY, { maxWidth: textW });
    if (b.gstTin) {
      setFont(doc, 9, 'bold');
      leftY = textBlock(doc, 'GST TIN: ' + b.gstTin, textX, leftY + 1, { maxWidth: textW });
    }
    if (logoBox) leftY = Math.max(leftY, M + logoBox.h);

    // ---- Right: title + meta ----
    setFont(doc, 22, 'bold', BRAND);
    doc.text(title, R, M, { align: 'right', baseline: 'top' });
    let rightY = M + 12;
    for (const [label, value] of meta) {
      setFont(doc, 9, 'normal', MUTED);
      doc.text(label, META_X, rightY, { baseline: 'top' });
      setFont(doc, 9, 'bold', label === 'Status' ? DANGER : TEXT);
      doc.text(String(value), R, rightY, { align: 'right', baseline: 'top' });
      rightY += 5.5;
    }
    return Math.max(leftY, rightY);
  }

  function newDoc(pageSize, props) {
    const { jsPDF } = window.jspdf;
    const page = PAGE_SIZES[pageSize] || PAGE_SIZES[DEFAULT_PAGE_SIZE];
    const doc = new jsPDF({ unit: 'mm', format: page.format });
    doc.setProperties({ ...props, creator: 'Toucan Bill' });
    doc.setLineHeightFactor(1.25);
    return { doc, pageW: page.w, pageH: page.h };
  }

  function build(r, logo, pageSize) {
    const fmt = money.formatCents;
    const rateText = money.formatRate(r.gstRateBp) + '%';
    const b = r.business || {};

    const isQuote = r.type === 'quote';
    const kind = isQuote ? 'Quotation' : 'Receipt';
    const watermark = r.voided ? 'VOID' : isQuote && r.cancelledAt ? 'CANCELLED' : null;

    const { doc, pageW, pageH } = newDoc(pageSize, { title: kind + ' ' + r.number, subject: b.name || kind });
    const R = pageW - M;

    const meta = isQuote
      ? [
        ['Quote no.', r.number],
        ['Date', receipt.formatDate(r.date)],
        ['Valid until', receipt.formatDay(r.validUntil) || '-'],
      ]
      : [
        ['Receipt no.', r.number],
        ['Date', receipt.formatDate(r.date)],
        ['Payment', receipt.paymentLabel(r.paymentMethod)],
      ];
    if (isQuote && r.cancelledAt) {
      meta.push(['Status', 'CANCELLED']);
      meta.push(['Cancelled', receipt.formatDate(r.cancelledAt)]);
    }
    if (r.voided) {
      meta.push(['Status', 'VOID']);
      if (r.voidedAt) meta.push(['Voided', receipt.formatDate(r.voidedAt)]);
    }
    const headerY = drawHeader(doc, { b, logo, title: kind.toUpperCase(), meta, pageW });

    // ---- Customer ----
    let y = headerY + 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(M, y, R, y);
    y += 5;
    setFont(doc, 8, 'bold', MUTED);
    doc.text('BILL TO', M, y, { baseline: 'top' });
    y += 4.5;
    setFont(doc, 11, 'bold');
    y = textBlock(doc, r.customer && r.customer.name ? r.customer.name : 'Walk-in customer', M, y, { maxWidth: 120 });
    const cust = r.customer || {};
    setFont(doc, 9, 'normal', MUTED);
    if (cust.phone) y = textBlock(doc, cust.phone, M, y + 0.5);
    if (cust.tin) y = textBlock(doc, 'TIN: ' + cust.tin, M, y + 0.5);
    if (cust.address) y = textBlock(doc, cust.address, M, y + 0.5, { maxWidth: 120 });
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
    if (y + BLOCK_H > pageH - FOOTER_SPACE) {
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

    // ---- Notes / terms (quotes), above the footer ----
    if (isQuote && r.notes) {
      let ny = Math.max(doc.lastAutoTable.finalY, ty + 8) + 10;
      setFont(doc, 9.5, 'normal');
      const lines = doc.splitTextToSize(r.notes, R - M);
      const needed = 5 + lines.length * lineHeight(doc);
      if (ny + needed > pageH - FOOTER_SPACE) {
        doc.addPage();
        ny = M;
      }
      setFont(doc, 8, 'bold', MUTED);
      doc.text('NOTES / TERMS', M, ny, { baseline: 'top' });
      setFont(doc, 9.5, 'normal');
      textBlock(doc, r.notes, M, ny + 5, { maxWidth: R - M });
    }

    // ---- Footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      const fy = pageH - FOOTER_SPACE + 6;
      if (p === pages && r.footer) {
        setFont(doc, 9, 'normal', MUTED);
        textBlock(doc, r.footer, pageW / 2, fy, { maxWidth: pageW - 2 * M - 30, align: 'center' });
      }
      setFont(doc, 8, 'normal', MUTED);
      doc.text(r.number, M, pageH - 8);
      if (pages > 1) doc.text('Page ' + p + ' of ' + pages, R, pageH - 8, { align: 'right' });
      if (watermark) drawWatermark(doc, watermark, pageW, pageH);
    }

    return doc;
  }

  /** A small label/amount table in the GST-summary style. */
  function gridTable(doc, startY, head, body, opts = {}) {
    window.autoTable(doc, {
      startY,
      margin: { left: M, right: M, bottom: FOOTER_SPACE },
      tableWidth: opts.width || 'auto',
      head: head ? [head] : undefined,
      body,
      foot: opts.foot ? [opts.foot] : undefined,
      showFoot: 'lastPage',
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.6, textColor: TEXT, lineColor: RULE, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: [244, 246, 249], textColor: MUTED, fontStyle: 'bold' },
      footStyles: { fillColor: [244, 246, 249], textColor: TEXT, fontStyle: 'bold' },
      columnStyles: opts.columnStyles || {},
      didParseCell: (d) => {
        const right = opts.rightFrom != null ? d.column.index >= opts.rightFrom : d.column.index > 0;
        if (right) d.cell.styles.halign = 'right';
      },
    });
    return doc.lastAutoTable.finalY;
  }

  function sectionTitle(doc, text, y, pageH) {
    if (y + 20 > pageH - FOOTER_SPACE) { doc.addPage(); y = M; }
    setFont(doc, 8, 'bold', MUTED);
    doc.text(text.toUpperCase(), M, y, { baseline: 'top' });
    return y + 4.5;
  }

  /**
   * Daily Summary PDF. s = summary.daily(...); b = current business settings.
   * Totals, GST by rate, payment methods (with a total row that equals the grand total),
   * then every counted receipt so the figures can be checked against the receipt PDFs.
   */
  function buildSummary(s, b, logo, pageSize, now) {
    const fmt = money.formatCents;
    b = b || {};
    const dayText = receipt.formatDay(s.day);
    const { doc, pageW, pageH } = newDoc(pageSize, { title: 'Daily summary ' + s.day, subject: b.name || 'Daily summary' });
    const R = pageW - M;

    let y = drawHeader(doc, {
      b, logo, pageW,
      title: 'DAILY SUMMARY',
      meta: [['Date', dayText], ['Receipts', String(s.count)], ['Printed', receipt.formatDateTime(now.toISOString())]],
    }) + 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(M, y, R, y);
    y += 6;

    // ---- Totals ----
    y = sectionTitle(doc, 'Totals', y, pageH);
    y = gridTable(doc, y, null, [
      ['Receipts', String(s.count)],
      ['Subtotal (excl. GST)', fmt(s.subtotalCents)],
      ['GST collected', fmt(s.gstCents)],
    ], { foot: ['Total (BZD)', fmt(s.totalCents)], width: 110, columnStyles: { 1: { cellWidth: 36 } } }) + 6;

    // ---- GST summary ----
    const gstBody = s.byRate.map((x) => ['Standard rated (' + money.formatRate(x.gstRateBp) + '%)', fmt(x.taxableCents), fmt(x.gstCents)]);
    if (s.zeroRatedCents) gstBody.push(['Zero-rated / exempt', fmt(s.zeroRatedCents), fmt(0)]);
    y = sectionTitle(doc, 'GST summary', y, pageH);
    y = gridTable(doc, y, ['', 'Net', 'GST'], gstBody, {
      foot: ['Total', fmt(s.subtotalCents), fmt(s.gstCents)],
      width: 110, columnStyles: { 1: { cellWidth: 30 }, 2: { cellWidth: 26 } },
    }) + 6;

    // ---- Payment methods ----
    y = sectionTitle(doc, 'Payment methods', y, pageH);
    y = gridTable(doc, y, ['Method', 'Receipts', 'Amount'],
      s.byPayment.map((p) => [p.label, String(p.count), fmt(p.totalCents)]),
      { foot: ['Total', String(s.count), fmt(s.totalCents)], width: 110, columnStyles: { 1: { cellWidth: 22 }, 2: { cellWidth: 34 } } }) + 6;

    // ---- Receipts ----
    y = sectionTitle(doc, 'Receipts', y, pageH);
    y = gridTable(doc, y, ['Receipt', 'Time', 'Customer', 'Payment', 'Subtotal', 'GST', 'Total'],
      s.receipts.map((r) => [
        r.number,
        new Date(r.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(),
        (r.customer && r.customer.name) || 'Walk-in',
        receipt.paymentLabel(r.paymentMethod),
        fmt(r.subtotalCents), fmt(r.gstCents), fmt(r.totalCents),
      ]),
      {
        foot: ['Total', '', '', '', fmt(s.subtotalCents), fmt(s.gstCents), fmt(s.totalCents)],
        rightFrom: 4,
        columnStyles: { 1: { cellWidth: 18 }, 3: { cellWidth: 20 }, 4: { cellWidth: 24 }, 5: { cellWidth: 20 }, 6: { cellWidth: 24 } },
      });

    if (s.excluded.voided) {
      y += 6;
      if (y + 8 > pageH - FOOTER_SPACE) { doc.addPage(); y = M; }
      setFont(doc, 9, 'normal', MUTED);
      doc.text(s.excluded.voided + (s.excluded.voided === 1 ? ' voided receipt' : ' voided receipts') + ' not counted. Quotes are never counted.', M, y, { baseline: 'top' });
    }

    // ---- Footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      setFont(doc, 8, 'normal', MUTED);
      doc.text('Daily summary ' + dayText, M, pageH - 8);
      if (pages > 1) doc.text('Page ' + p + ' of ' + pages, R, pageH - 8, { align: 'right' });
    }
    return doc;
  }

  /** Daily Summary PDF as a Blob, with the current business details, logo and page size. */
  async function summaryBlob(s, now = new Date()) {
    const [, settings] = await Promise.all([ensureLibs(), db.getSettings()]);
    return buildSummary(s, settings.business, settings.logo, settings.pageSize, now).output('blob');
  }

  /**
   * One-page monthly GST summary (Stats tab). s = stats.gstSummary(...); b = current business settings.
   * The figures for the GST return, the split by GST rate, and which receipts they come from.
   * The per-receipt list is in the CSV export, which keeps this to a single page.
   */
  function buildGstSummary(s, b, logo, pageSize, now) {
    const fmt = money.formatCents;
    b = b || {};
    const { doc, pageW, pageH } = newDoc(pageSize, { title: 'GST summary ' + s.label, subject: b.name || 'GST summary' });
    const R = pageW - M;
    const lastDay = new Date(s.range.to.getFullYear(), s.range.to.getMonth(), s.range.to.getDate() - 1);

    let y = drawHeader(doc, {
      b, logo, pageW,
      title: 'GST SUMMARY',
      meta: [['Period', s.label], ['From', receipt.formatDay(filter.dayString(s.range.from))],
        ['To', receipt.formatDay(filter.dayString(lastDay))], ['Printed', receipt.formatDateTime(now.toISOString())]],
    }) + 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.3);
    doc.line(M, y, R, y);
    y += 6;

    y = sectionTitle(doc, 'Sales and GST', y, pageH);
    y = gridTable(doc, y, null, [
      ['Receipts', String(s.count)],
      ['Gross sales (incl. GST)', fmt(s.totalCents)],
      ['Taxable sales (excl. GST)', fmt(s.taxableCents)],
      ['Zero-rated / exempt sales', fmt(s.zeroRatedCents)],
    ], { foot: ['GST collected', fmt(s.gstCents)], width: 120, columnStyles: { 1: { cellWidth: 40 } } }) + 6;

    const rateBody = s.byRate.map((x) => ['Standard rated (' + money.formatRate(x.gstRateBp) + '%)', fmt(x.taxableCents), fmt(x.gstCents)]);
    rateBody.push(['Zero-rated / exempt', fmt(s.zeroRatedCents), fmt(0)]);
    y = sectionTitle(doc, 'GST by rate', y, pageH);
    y = gridTable(doc, y, ['', 'Net sales', 'GST'], rateBody, {
      foot: ['Total', fmt(s.subtotalCents), fmt(s.gstCents)],
      width: 120, columnStyles: { 1: { cellWidth: 32 }, 2: { cellWidth: 28 } },
    }) + 8;

    setFont(doc, 9, 'normal', MUTED);
    const notes = [];
    if (s.count) {
      notes.push('Totals of ' + s.count + (s.count === 1 ? ' receipt' : ' receipts') + ', ' + s.rows[0].number
        + (s.count > 1 ? ' to ' + s.rows[s.count - 1].number : '') + ', each at the GST rate it was issued with.');
    } else {
      notes.push('No receipts in ' + s.label + '.');
    }
    if (s.excluded.voided) notes.push(s.excluded.voided + (s.excluded.voided === 1 ? ' voided receipt' : ' voided receipts') + ' not counted.');
    notes.push('Quotes are never counted. The per-receipt list is in the CSV export.');
    textBlock(doc, notes.join(' '), M, y, { maxWidth: R - M });

    setFont(doc, 8, 'normal', MUTED);
    doc.text('GST summary ' + s.label, M, pageH - 8);
    return doc;
  }

  /** GST summary PDF as a Blob, with the current business details, logo and page size (or `pageSize` if given). */
  async function gstSummaryBlob(s, { now = new Date(), pageSize } = {}) {
    const [, settings] = await Promise.all([ensureLibs(), db.getSettings()]);
    return buildGstSummary(s, settings.business, settings.logo, pageSize || settings.pageSize, now).output('blob');
  }

  /**
   * Build the PDF of a receipt or a quote (r.type === 'quote': titled QUOTATION) and return it as a Blob.
   * Uses the current logo and page size from Settings (neither is snapshotted on the document).
   */
  async function documentBlob(r) {
    const [, logo, pageSize] = await Promise.all([ensureLibs(), db.getSetting('logo'), db.getSetting('pageSize')]);
    return build(r, logo, pageSize).output('blob');
  }

  window.pdf = { ensureLibs, documentBlob, summaryBlob, buildSummary, gstSummaryBlob, buildGstSummary, receiptBlob: documentBlob, quoteBlob: documentBlob, PAGE_SIZES };
})();
