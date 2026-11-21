/*
 * views/quotes.js: saved quotes list (#/quotes), newest first, with the History search, the same
 * date chips and a status chip row (All / Open / Expired / Converted / Cancelled).
 * Status is computed (quote.status), so Expired updates itself. Quotes never count toward
 * sales totals, so the list shows a count only. Detail is views/quote.js (#/quote/<id>).
 */
(function () {
  'use strict';
  const { h, empty } = ui;

  const DEBOUNCE_MS = 200;

  // Kept across visits, so coming back from a quote shows the same results.
  const state = { query: '', preset: 'all', fromDay: '', toDay: '', status: 'all' };

  function row(q, now) {
    const status = quote.status(q, now);
    return h('li', null,
      h('a', { class: 'list-row is-' + status, href: '#/quote/' + q.id },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, h('span', { class: 'list-title-text' }, q.number), window.Views.quote.statusBadge(status)),
          h('span', { class: 'list-sub' }, q.customer.name || 'No customer name'),
          h('span', { class: 'list-sub' }, 'Valid until ' + (receipt.formatDay(q.validUntil) || '-'))),
        h('span', { class: 'list-end' },
          h('span', { class: 'list-amount' }, money.formatCents(q.totalCents)),
          h('span', { class: 'list-sub' }, receipt.formatDate(q.date)))));
  }

  async function render({ el }) {
    const newBtn = h('a', { class: 'btn btn-block list-new', href: '#/quote/new' }, '+ New quote');
    const all = await db.getAll('quotes');
    if (!all.length) {
      el.append(empty('No quotes yet. A quote (estimate) can be turned into a receipt later.'), newBtn);
      return;
    }

    // ---- Controls ----
    const search = h('input', {
      type: 'search', value: state.query, placeholder: 'Number, name, phone or amount',
      'aria-label': 'Search quotes', autocomplete: 'off', enterkeyhint: 'search',
    });
    const preset = ui.chipGroup({
      name: 'date', legend: 'Date range', options: filter.PRESETS, value: state.preset,
      onChange: (id) => {
        state.preset = id;
        custom.hidden = id !== 'custom';
        update();
      },
    });
    const fromDay = h('input', { type: 'date', value: state.fromDay });
    const toDay = h('input', { type: 'date', value: state.toDay });
    const custom = h('div', { class: 'date-range', hidden: state.preset !== 'custom' },
      ui.field('From', fromDay), ui.field('To', toDay));
    const statusRow = ui.chipGroup({
      name: 'qstatus', legend: 'Status', options: quote.STATUSES, value: state.status,
      onChange: (id) => { state.status = id; update(); },
    });

    const summary = h('p', { class: 'list-summary', role: 'status', 'aria-live': 'polite' });
    const list = h('ul', { class: 'list' });

    function update() {
      const now = new Date();
      const shown = filter.apply(all, { ...state, now, statusOf: quote.status });
      summary.textContent = shown.length ? shown.length + (shown.length === 1 ? ' quote' : ' quotes') + ' · not counted in sales' : '';
      list.replaceChildren(...(shown.length ? shown.map((q) => row(q, now)) : [h('li', null, empty('No quotes found'))]));
    }

    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.query = search.value; update(); }, DEBOUNCE_MS);
    });
    search.addEventListener('search', () => { clearTimeout(timer); state.query = search.value; update(); });
    fromDay.addEventListener('change', () => { state.fromDay = fromDay.value; update(); });
    toDay.addEventListener('change', () => { state.toDay = toDay.value; update(); });

    el.append(
      newBtn,
      h('div', { class: 'filters' }, search, preset, custom, statusRow),
      summary,
      list);
    update();
  }

  (window.Views = window.Views || {}).quotes = { render };
})();
