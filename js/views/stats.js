/*
 * views/stats.js: the Stats tab (#/stats). Phase 6, built step by step.
 *   Step 0: range picker + overview card for the chosen range (needs stats.MIN_RECEIPTS counted receipts,
 *           otherwise an empty state).
 *   Step 2: Today / This week / This month tiles at the top (fixed periods, ignore the picker; from the first receipt).
 *   Step 3: top 10 products in the picked range (by sales or quantity) and slow movers (last 30 days, fixed).
 *   Step 4: top 10 customers by spend in the range, walk-in total, repeat vs one-time, WhatsApp buttons.
 *   Step 5: sales trend line (daily, weekly over 90 days) and busiest-days bars (weekday averages), Chart.js
 *           from lib/ loaded on first use; old charts are destroyed before every redraw and when leaving the tab.
 *   Step 6: quote conversion for the range (sent, converted, rate, open value) and a follow-up list of every
 *           quote that can still be converted, with a WhatsApp follow-up message.
 *   Step 1: monthly GST summary with its own month picker (defaults to last month), CSV and PDF export.
 *           Shown from the first receipt: filing doesn't wait for trends.
 * Maths: js/stats.js and summary.summarize (Phase 5); pieces: js/stats-ui.js; PDF: pdf.gstSummaryBlob.
 * Quotes, voided and cancelled receipts never count.
 */
(function () {
  'use strict';
  const { h } = ui;
  const fmt = (c) => stats.formatBZD(c);

  function row(label, value, cls) {
    return h('tr', cls ? { class: cls } : null, h('th', null, label), h('td', null, value));
  }

  // ---- Step 1: monthly GST summary ----

  function gstTable(s) {
    const voided = s.excluded.voided;
    return [
      h('table', { class: 'totals gst-table' }, h('tbody', null,
        row('Receipts', String(s.count)),
        row('Gross sales (incl. GST)', fmt(s.totalCents)),
        row('Taxable sales (excl. GST)', fmt(s.taxableCents)),
        row('Zero-rated sales', fmt(s.zeroRatedCents)),
        s.byRate.length > 1 ? s.byRate.map((x) => row('GST at ' + money.formatRate(x.gstRateBp) + '%', fmt(x.gstCents))) : null,
        row('GST collected', h('span', { class: 'total-value' }, fmt(s.gstCents)), 'grand'))),
      h('p', { class: 'list-summary gst-note' },
        (s.count ? '' : 'No receipts in ' + s.label + '. ')
        + (voided ? voided + (voided === 1 ? ' voided receipt' : ' voided receipts') + ' not counted. ' : '')
        + 'Each receipt uses the GST rate it was issued with.'),
    ];
  }

  function gstCard(all) {
    const select = h('select', { name: 'gst-month' },
      stats.gstMonths(all).map((m) => h('option', { value: m }, stats.monthLabel(m))));
    select.value = stats.defaultGstMonth();
    const body = h('div', { class: 'gst-body' });
    const csvBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Export CSV');
    const pdfBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Export PDF');
    let current;

    function show() {
      current = stats.gstSummary(all, select.value);
      body.replaceChildren(...gstTable(current));
    }

    select.addEventListener('change', show);
    csvBtn.addEventListener('click', () => {
      ui.download(new Blob([stats.gstCsv(current)], { type: 'text/csv;charset=utf-8' }), stats.gstFileName(current, 'csv'));
    });
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      try {
        ui.download(await pdf.gstSummaryBlob(current), stats.gstFileName(current, 'pdf'));
      } catch (err) {
        console.error(err);
        ui.toast('Could not make the PDF: ' + (err && err.message ? err.message : err));
      } finally {
        pdfBtn.disabled = false;
      }
    });
    show();

    return statsUi.card('Monthly GST summary',
      ui.field('Month', select),
      body,
      h('div', { class: 'form-actions gst-actions' }, csvBtn, pdfBtn),
      { cls: 'gst-card' });
  }

  // ---- Step 3: top products and slow movers ----

  let topBy = 'revenue';   // By sales / By quantity, kept while the app is open

  function topProductsCard(counted, range, products) {
    const list = h('div');
    function draw() {
      const t = stats.topProducts(counted, range, { by: topBy, products });
      list.replaceChildren(t.items.length
        ? statsUi.rankList(t.items.map((i) => {
          const qty = money.formatQty(i.qtyMilli) + ' sold';
          const sales = fmt(i.netCents);
          return topBy === 'quantity'
            ? { name: i.name, value: qty, sub: sales + ' excl. GST' }
            : { name: i.name, value: sales, sub: qty };
        }))
        : h('p', { class: 'list-summary' }, 'No sales in this range.'));
    }
    const toggle = ui.chipGroup({
      name: 'top-by', legend: 'Rank products by', value: topBy,
      options: [{ id: 'revenue', label: 'By sales' }, { id: 'quantity', label: 'By quantity' }],
      onChange: (id) => { topBy = id; draw(); },
    });
    draw();
    return statsUi.card('Top products', toggle, list,
      h('p', { class: 'list-summary card-note' }, 'Sales are excl. GST. Items typed differently ("coke", "Coke ") count as one.'),
      { cls: 'top-products' });
  }

  function slowMoversCard(all, products) {
    const now = new Date();
    if (!products.length) {
      return statsUi.card('Slow movers', h('p', { class: 'list-summary' }, 'Save products to spot the ones that stop selling. '),
        h('a', { class: 'btn btn-secondary', href: '#/products/new' }, 'Add a product'), { cls: 'slow-movers' });
    }
    const slow = stats.slowMovers(all, products, now);
    const MAX = 20;
    const rows = slow.slice(0, MAX).map((p) => {
      if (!p.lastSale) return { name: p.name, value: 'Never sold' };
      const days = stats.daysAgo(p.lastSale, now);
      return { name: p.name, value: days + ' days ago', sub: 'Last sold ' + receipt.formatDate(p.lastSale.toISOString()) };
    });
    return statsUi.card('Slow movers',
      h('p', { class: 'list-summary card-note' }, 'Saved products with no sales in the last 30 days.'),
      slow.length ? statsUi.rankList(rows, { numbered: false }) : h('p', { class: 'list-summary' }, 'Every saved product sold in the last 30 days.'),
      slow.length > MAX ? h('p', { class: 'list-summary' }, '+ ' + (slow.length - MAX) + ' more') : null,
      { cls: 'slow-movers' });
  }

  // ---- Step 4: top customers ----

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  /** "20 Nov" this year, "20 Nov 2025" otherwise (short enough for a phone row). */
  function shortDay(d) {
    const opts = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString('en-GB', opts);
  }

  function topCustomersCard(counted, range, customers) {
    const t = stats.topCustomers(counted, range, { customers });
    const rows = t.items.map((c) => ({
      name: c.name,
      sub: plural(c.count, 'receipt') + (c.lastPurchase ? ' · last ' + shortDay(c.lastPurchase) : ''),
      value: fmt(c.totalCents),
      action: statsUi.waButton(stats.waLink(c.phone), 'WhatsApp ' + c.name),
    }));
    const r = t.repeat;
    return statsUi.card('Top customers',
      rows.length ? statsUi.rankList(rows) : h('p', { class: 'list-summary' }, 'No named customers in this range.'),
      h('table', { class: 'totals customer-mix' }, h('tbody', null,
        row('Walk-in (not ranked)', t.walkIn.count ? fmt(t.walkIn.totalCents) + ' · ' + plural(t.walkIn.count, 'receipt') : '—'),
        row('Repeat customers', r.total ? r.repeat + ' · ' + r.repeatPct + '%' : '—'),
        row('One-time customers', r.total ? r.oneTime + ' · ' + r.oneTimePct + '%' : '—'))),
      h('p', { class: 'list-summary card-note' },
        'Named customers who bought in this range. Repeat = 2 or more receipts ever. Spend includes GST.'),
      { cls: 'top-customers' });
  }

  // ---- Step 5: sales trend and busiest days (Chart.js) ----

  function trendCard(series) {
    const weekly = series.unit === 'week';
    const labels = stats.seriesLabels(series);
    const box = statsUi.chartBox(weekly ? 'Weekly sales chart' : 'Daily sales chart',
      [weekly ? 'Week of' : 'Day', 'Sales', 'Receipts'],
      series.points.map((p, i) => [labels[i].long.replace(/^Week of /, ''), fmt(p.totalCents), String(p.count)]));
    return {
      canvas: box.canvas,
      card: statsUi.card('Sales trend',
        h('p', { class: 'list-summary card-note chart-note' },
          weekly ? 'Weekly sales incl. GST (weeks start Monday; over 90 days).' : 'Daily sales incl. GST. Days with no sales show $0.'),
        box.nodes, { wide: true, cls: 'trend-card' }),
    };
  }

  function weekdayCard(avgs) {
    const box = statsUi.chartBox('Average sales by weekday chart', ['Day', 'Average', 'Days'],
      avgs.map((w) => [w.day, fmt(w.averageCents), String(w.days)]));
    return {
      canvas: box.canvas,
      card: statsUi.card('Busiest days',
        h('p', { class: 'list-summary card-note chart-note' },
          'Average sales per weekday (incl. GST): each weekday\'s total ÷ how many times it falls in this range.'),
        box.nodes, { cls: 'weekday-card' }),
    };
  }

  let drawSeq = 0;
  let lastDraw = Promise.resolve();

  /** Draw both charts once Chart.js is loaded, unless the range changed (or the tab closed) meanwhile. */
  function drawCharts(trend, series, days, avgs) {
    const mine = ++drawSeq;
    lastDraw = statsUi.ensureChart().then(() => {
      if (mine !== drawSeq || !trend.canvas.isConnected) return;
      statsUi.salesLine(trend.canvas, series);
      statsUi.weekdayBars(days.canvas, avgs);
    }).catch((err) => {
      console.error(err);
      for (const c of [trend.canvas, days.canvas]) {
        c.parentElement.replaceChildren(h('p', { class: 'list-summary' }, 'The chart could not load. Use "Show numbers" below.'));
      }
    });
  }

  // Charts hold resize observers: free them when the Stats tab is left.
  window.addEventListener('hashchange', () => {
    if (!/^#\/stats(\/|$)/.test(location.hash)) { drawSeq++; statsUi.destroyCharts(); }
  });

  // ---- Step 6: quote conversion and follow-ups ----

  function quoteCard(quotes, range) {
    const q = stats.quoteStats(quotes, range);
    return statsUi.card('Quote conversion',
      h('table', { class: 'totals' }, h('tbody', null,
        row('Quotes sent', String(q.sent)),
        row('Converted to receipts', String(q.converted)),
        row('Conversion rate', q.ratePct == null ? '—' : q.ratePct + '%'),
        row('Open quotes value', fmt(q.openValueCents)),
        q.expired || q.cancelled ? row('Expired · cancelled', q.expired + ' · ' + q.cancelled) : null)),
      h('p', { class: 'list-summary card-note' }, 'Quotes dated in this range. Rate = converted ÷ sent. Quotes never count as sales.'),
      { cls: 'quote-card' });
  }

  function followUpCard(quotes, businessName) {
    const list = stats.followUps(quotes, { businessName });
    const expired = stats.expiredCount(quotes);
    const MAX = 20;
    const rows = list.slice(0, MAX).map((f) => ({
      name: f.customer,
      href: '#/quote/' + f.id,
      sub: f.number + ' · ' + (f.ageDays === 0 ? 'today' : plural(f.ageDays, 'day') + ' old'),
      value: fmt(f.totalCents),
      action: statsUi.waButton(f.waUrl, 'WhatsApp follow-up on ' + f.number),
    }));
    return statsUi.card('Follow up',
      h('p', { class: 'list-summary card-note' }, 'Open quotes, oldest first.'),
      rows.length ? statsUi.rankList(rows, { numbered: false }) : h('p', { class: 'list-summary' }, 'No open quotes to follow up.'),
      list.length > MAX ? h('p', { class: 'list-summary' }, '+ ' + (list.length - MAX) + ' more in Quotes') : null,
      expired ? h('p', { class: 'list-summary card-note' }, plural(expired, 'expired quote') + ' can still be converted. ',
        h('a', { class: 'detail-link-inline', href: '#/quotes' }, 'See Quotes')) : null,
      { cls: 'follow-up' });
  }

  // ---- Step 0: range overview ----

  function overviewCard(s, prev) {
    return statsUi.card('Selected range',
      h('table', { class: 'totals' }, h('tbody', null,
        row('Receipts', String(s.count)),
        row('Sales (incl. GST)', fmt(s.totalCents)),
        row('Previous period', fmt(prev.totalCents) + ' · ' + prev.count + (prev.count === 1 ? ' receipt' : ' receipts')))),
      { cls: 'overview-card' });
  }

  /**
   * Render timing, logged with performance.now() (target: under 500 ms with 2,000 receipts on a mid-range phone).
   * `ms` = tab opened -> everything on screen except the charts (`dbMs` of it reading IndexedDB);
   * `chartsMs` = until both charts are drawn. Also kept on window.statsTiming for tests.
   */
  function logTiming(t0, dbMs, receipts, chartsDone) {
    const timing = { receipts, ms: Math.round(performance.now() - t0), dbMs: Math.round(dbMs), chartsMs: null };
    window.statsTiming = timing;
    const text = () => 'Stats: ' + receipts + ' receipts rendered in ' + timing.ms + ' ms (database ' + timing.dbMs + ' ms)'
      + (timing.chartsMs == null ? '' : ', charts drawn at ' + timing.chartsMs + ' ms');
    if (!chartsDone) {
      console.info(text());
      return;
    }
    chartsDone.then(() => {
      timing.chartsMs = Math.round(performance.now() - t0);
      console.info(text());
    });
  }

  async function render({ el }) {
    const t0 = performance.now();
    drawSeq++;
    statsUi.destroyCharts();
    const view = h('div', { class: 'stats-view' });
    el.append(view);

    const [all, products, customers, quotes, business] = await Promise.all([
      db.getAll('receipts'), db.getAll('products'), db.getAll('customers'), db.getAll('quotes'), db.getSetting('business')]);
    const dbMs = performance.now() - t0;
    const counted = all.filter(summary.counts);
    if (!counted.length) {
      view.append(statsUi.emptyState({ have: 0 }));
      logTiming(t0, dbMs, all.length);
      return;
    }

    view.append(statsUi.glanceRow(stats.glance(all)), gstCard(all), h('h2', { class: 'stats-heading' }, 'Trends'));
    if (counted.length < stats.MIN_RECEIPTS) {
      view.append(statsUi.emptyState({ have: counted.length }));
      logTiming(t0, dbMs, all.length);
      return;
    }

    const grid = h('div', { class: 'stats-grid' });
    const slow = slowMoversCard(all, products);   // last 30 days: doesn't follow the picker
    const follow = followUpCard(quotes, business && business.name);   // all open quotes: doesn't follow the picker

    function show(range) {
      drawSeq++;
      statsUi.destroyCharts();   // never stack charts on a redraw
      if (!range) {
        grid.replaceChildren(ui.empty('Choose both dates to see this range.'), slow, follow);
        return;
      }
      const s = stats.summarizeRange(counted, range);
      const prev = stats.summarizeRange(counted, stats.previousRange(range));
      const series = stats.salesSeries(counted, range);
      const avgs = stats.weekdayAverages(counted, range);
      const trend = trendCard(series);
      const days = weekdayCard(avgs);
      grid.replaceChildren(trend.card, overviewCard(s, prev), days.card, topProductsCard(counted, range, products), slow,
        topCustomersCard(counted, range, customers), quoteCard(quotes, range), follow);
      drawCharts(trend, series, days, avgs);
    }

    const picker = statsUi.rangePicker({ onChange: show });
    view.append(picker.el, grid);
    show(picker.range());
    logTiming(t0, dbMs, all.length, lastDraw);
  }

  (window.Views = window.Views || {}).stats = { render };
})();
