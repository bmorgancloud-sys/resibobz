/*
 * stats-ui.js: reusable pieces of the Stats tab (DOM only, no maths: that is js/stats.js).
 * Exposes global `statsUi`:
 *   emptyState({ have, need, text })   "Make 5 receipts to see your trends." card with a New receipt button
 *   rangePicker({ onChange, now })     Today / This week / This month / Last month / 90 days / Custom,
 *                                      remembered in localStorage (per device; works without it)
 *   card(title, ...children, opts)     a titled section for the stats grid
 *   glanceRow, rankList, waButton      tiles, ranked lists, WhatsApp button
 *   ensureChart, salesLine, weekdayBars, chartBox, destroyCharts   Chart.js charts (lib/, loaded on first use)
 */
(function () {
  'use strict';
  const { h } = ui;

  const STORAGE_KEY = 'resibobz.stats.range';

  function loadChoice() {
    try { return stats.parseSavedChoice(localStorage.getItem(STORAGE_KEY)); } catch { return stats.parseSavedChoice(null); }
  }

  function saveChoice(choice) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choice)); } catch {}
  }

  /** Empty state shown instead of blank boxes until there is enough data. */
  function emptyState({ have = 0, need = stats.MIN_RECEIPTS, text } = {}) {
    const left = Math.max(0, need - have);
    return h('div', { class: 'placeholder stats-empty' },
      h('p', { class: 'stats-empty-title' }, text || 'Make ' + need + ' receipts to see your trends.'),
      have > 0 && left > 0 ? h('p', null, have + ' so far, ' + left + ' to go.') : null,
      h('a', { class: 'btn', href: '#/new' }, 'New receipt'));
  }

  /**
   * A titled card. Options object last (optional): { wide: true } spans both desktop grid columns,
   * { cls } adds classes.
   */
  function card(title, ...children) {
    const last = children[children.length - 1];
    const opts = last && !(last instanceof Node) && !Array.isArray(last) && typeof last === 'object' ? children.pop() : {};
    const cls = 'card stats-card' + (opts.wide ? ' stats-wide' : '') + (opts.cls ? ' ' + opts.cls : '');
    return h('section', { class: cls }, h('h2', null, title), children);
  }

  const dayInput = (d) => (d ? filter.dayString(d) : '');

  /**
   * Date range picker. onChange(range) runs on every change, with null while a Custom range is
   * incomplete or backwards. range() returns the current range (or null).
   */
  function rangePicker({ onChange, now = () => new Date() }) {
    const choice = loadChoice();
    const fromIn = h('input', { type: 'date', value: choice.custom.from, 'aria-label': 'From' });
    const toIn = h('input', { type: 'date', value: choice.custom.to, 'aria-label': 'To' });
    const custom = h('div', { class: 'date-range', hidden: choice.preset !== 'custom' },
      ui.field('From', fromIn), ui.field('To', toIn));
    const label = h('p', { class: 'stats-range-label', 'aria-live': 'polite' });

    const range = () => stats.getRange(choice.preset, now(), choice.custom);

    function showLabel(r) {
      if (r) label.textContent = stats.rangeLabel(r) + ' · compared with ' + stats.rangeLabel(stats.previousRange(r));
      else if (fromIn.value && toIn.value) label.textContent = '"To" is before "From".';
      else label.textContent = 'Pick a From and a To date.';
    }

    function changed() {
      choice.custom = { from: fromIn.value, to: toIn.value };
      saveChoice(choice);
      const r = range();
      showLabel(r);
      onChange(r);
    }

    const chips = ui.chipGroup({
      name: 'stats-range', legend: 'Date range', options: stats.PRESETS, value: choice.preset,
      onChange: (id) => {
        // Starting a custom range: begin from whatever was showing, so both dates are filled in.
        if (id === 'custom' && !fromIn.value && !toIn.value) {
          const r = range();
          if (r) {
            fromIn.value = dayInput(r.from);
            toIn.value = dayInput(new Date(r.to.getFullYear(), r.to.getMonth(), r.to.getDate() - 1));
          }
        }
        choice.preset = id;
        custom.hidden = id !== 'custom';
        changed();
      },
    });
    chips.classList.add('chips-3x2');
    fromIn.addEventListener('change', changed);
    toIn.addEventListener('change', changed);
    showLabel(range());

    return { el: h('div', { class: 'filters stats-picker' }, chips, custom, label), range };
  }

  /**
   * Today / This week / This month tiles from stats.glance(): total, receipts, average, and the change
   * (green up, red down, grey otherwise; the arrow and words carry it too, not only the colour).
   */
  function glanceRow(tiles) {
    const fmt = stats.formatBZD;
    return h('div', { class: 'glance' },
      h('div', { class: 'glance-row' }, tiles.map((t) => {
        const c = t.current;
        return h('section', { class: 'card glance-tile', dataset: { period: t.id } },
          h('div', { class: 'glance-head' },
            h('h2', null, t.label),
            h('span', { class: 'glance-change is-' + t.change.kind }, t.text)),
          h('p', { class: 'glance-total' }, fmt(c.totalCents)),
          h('p', { class: 'glance-sub' },
            c.count + (c.count === 1 ? ' receipt' : ' receipts') + ' · avg ' + fmt(c.averageCents)));
      })),
      h('p', { class: 'list-summary glance-note' }, 'Each tile compares with the same point yesterday, last week and last month.'));
  }

  /**
   * Compact ranked list: rows = [{ name, value, sub, action, href }]. Names truncate with an ellipsis;
   * values (amounts) never do. `action` is an optional node (e.g. a WhatsApp button) at the end of the row;
   * `href` makes the name a link.
   */
  function rankList(rows, { numbered = true } = {}) {
    return h(numbered ? 'ol' : 'ul', { class: 'rank-list' + (numbered ? ' is-numbered' : '') }, rows.map((r) =>
      h('li', null,
        h('span', { class: 'rank-main' },
          r.href ? h('a', { class: 'rank-name', href: r.href }, r.name) : h('span', { class: 'rank-name' }, r.name),
          r.sub ? h('span', { class: 'rank-sub' }, r.sub) : null),
        h('span', { class: 'rank-value' }, r.value),
        r.action || null)));
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** Round green 48px WhatsApp link for `waUrl`, or a same-size spacer when there is no number (keeps rows aligned). */
  function waButton(waUrl, label) {
    if (!waUrl) return h('span', { class: 'wa-btn is-empty', 'aria-hidden': 'true' });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M4 20l1.3-3.9A8 8 0 1 1 8 18.7z');   // speech bubble with a tail
    svg.append(path);
    return h('a', { class: 'wa-btn', href: waUrl, target: '_blank', rel: 'noopener', 'aria-label': label, title: label }, svg);
  }

  // ---- Charts (Chart.js from lib/, loaded on first use, cached offline by sw.js) ----

  const CHART_LIB = 'lib/chart.umd.min.js';
  const BRAND = '#0D5DAA';     // the app's blue (css --brand): the single chart series
  const INK_MUTED = '#5b6575'; // --muted
  const GRID = '#e8ecf2';
  let chartLoading = null;
  const liveCharts = new Set();

  /** Load Chart.js once. */
  function ensureChart() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!chartLoading) {
      chartLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = CHART_LIB;
        s.onload = () => resolve(window.Chart);
        s.onerror = () => { chartLoading = null; reject(new Error('Could not load ' + CHART_LIB)); };
        document.head.append(s);
      });
    }
    return chartLoading;
  }

  /** Destroy every chart this module made (before redrawing, and when leaving the Stats tab). */
  function destroyCharts() {
    for (const c of liveCharts) c.destroy();
    liveCharts.clear();
  }

  function baseOptions(tooltipTitle, tooltipLabel) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },   // one series: the card title names it
        tooltip: {
          displayColors: false,
          callbacks: { title: (items) => tooltipTitle(items[0].dataIndex), label: (item) => tooltipLabel(item.dataIndex) },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { color: GRID }, ticks: { color: INK_MUTED, maxRotation: 0, autoSkip: true, maxTicksLimit: 7 } },
        y: { beginAtZero: true, grid: { color: GRID }, border: { display: false },
          ticks: { color: INK_MUTED, maxTicksLimit: 5, callback: (v) => stats.axisMoney(v) } },
      },
    };
  }

  function make(canvas, config) {
    // Phones: fewer date labels so "10 Nov" and "13 Nov" never run together.
    const narrow = (canvas.parentElement && canvas.parentElement.clientWidth) < 480;
    if (narrow && config.type === 'line') config.options.scales.x.ticks.maxTicksLimit = 4;
    const chart = new window.Chart(canvas, config);
    liveCharts.add(chart);
    return chart;
  }

  /** Line chart of stats.salesSeries() (values in cents; only the labels are formatted). */
  function salesLine(canvas, series) {
    const labels = stats.seriesLabels(series);
    const pts = series.points;
    return make(canvas, {
      type: 'line',
      data: {
        labels: labels.map((l) => l.short),
        datasets: [{
          data: pts.map((p) => p.totalCents), borderColor: BRAND, backgroundColor: BRAND, borderWidth: 2,
          pointRadius: pts.length > 45 ? 0 : 3, pointHoverRadius: 5, pointHitRadius: 12, tension: 0,
        }],
      },
      options: baseOptions((i) => labels[i].long,
        (i) => stats.formatBZD(pts[i].totalCents) + ' · ' + pts[i].count + (pts[i].count === 1 ? ' receipt' : ' receipts')),
    });
  }

  /** Bar chart of stats.weekdayAverages(). */
  function weekdayBars(canvas, avgs) {
    return make(canvas, {
      type: 'bar',
      data: {
        labels: avgs.map((w) => w.day),
        datasets: [{ data: avgs.map((w) => w.averageCents), backgroundColor: BRAND, maxBarThickness: 36,
          borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom' }],
      },
      options: baseOptions((i) => avgs[i].day,
        (i) => 'Average ' + stats.formatBZD(avgs[i].averageCents) + ' · ' + avgs[i].days + ' ' + avgs[i].day + (avgs[i].days === 1 ? '' : 's')),
    });
  }

  /** A fixed-height box for a responsive canvas, plus a "Show numbers" table (the chart's accessible view). */
  function chartBox(label, headers, rows) {
    const canvas = h('canvas', { role: 'img', 'aria-label': label });
    const table = h('details', { class: 'chart-table' },
      h('summary', null, 'Show numbers'),
      h('table', { class: 'totals' },
        h('thead', null, h('tr', null, headers.map((x, i) => h(i ? 'td' : 'th', null, x)))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((x, i) => h(i ? 'td' : 'th', null, x)))))));
    return { canvas, nodes: [h('div', { class: 'chart-box' }, canvas), table] };
  }

  window.statsUi = {
    emptyState, card, rangePicker, glanceRow, rankList, waButton,
    ensureChart, destroyCharts, salesLine, weekdayBars, chartBox, STORAGE_KEY,
  };
})();
