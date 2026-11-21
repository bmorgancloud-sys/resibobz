/*
 * views/history.js: saved receipts list (#/history) with search, date and status filters,
 * a count/total summary (voided receipts excluded from the total) and a backup reminder.
 * Matching logic lives in js/filter.js. Receipt detail is views/receipt.js (#/receipt/<id>).
 */
(function () {
  'use strict';
  const { h, empty } = ui;

  const DEBOUNCE_MS = 200;

  // Kept across visits, so coming back from a receipt shows the same results.
  const state = { query: '', preset: 'all', fromDay: '', toDay: '', status: 'all' };

  function row(r) {
    return h('li', null,
      h('a', { class: 'list-row' + (r.voided ? ' is-void' : ''), href: '#/receipt/' + r.id },
        h('span', { class: 'list-main' },
          h('span', { class: 'list-title' }, h('span', { class: 'list-title-text' }, r.number), r.voided ? h('span', { class: 'badge badge-void' }, 'VOID') : null),
          h('span', { class: 'list-sub' }, r.customer.name || 'Walk-in'),
          h('span', { class: 'list-sub' }, receipt.formatDateTime(r.date))),
        h('span', { class: 'list-end' },
          h('span', { class: 'list-amount' }, money.formatCents(r.totalCents)),
          h('span', { class: 'list-sub' }, receipt.paymentLabel(r.paymentMethod)))));
  }

  function summaryText(s) {
    const parts = [s.count + (s.count === 1 ? ' receipt' : ' receipts'), 'Total ' + money.formatCents(s.totalCents)];
    let text = parts.join(' · ');
    if (s.voided) text += ' (' + s.voided + ' void, not counted)';
    return text;
  }

  async function render({ el, params }) {
    if (params.length) { ui.replaceRoute('#/receipt/' + encodeURIComponent(params[0])); return; } // old links

    const [all, lastBackupAt] = await Promise.all([db.getAll('receipts'), db.getSetting('lastBackupAt')]);
    if (!all.length) {
      el.append(empty('No receipts yet.'), h('a', { class: 'btn btn-block', href: '#/new' }, 'New receipt'));
      return;
    }

    if (filter.needsBackup(lastBackupAt, all.length)) {
      el.append(h('div', { class: 'notice', role: 'status' },
        h('span', null, lastBackupAt ? 'No backup in the last 7 days.' : 'You have never backed up your receipts.'),
        ' ',
        h('a', { href: '#/settings/backup' }, 'Back up now')));
    }

    // ---- Controls ----
    const search = h('input', {
      type: 'search', value: state.query, placeholder: 'Number, name, phone or amount',
      'aria-label': 'Search receipts', autocomplete: 'off', enterkeyhint: 'search',
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
    const statusGroup = h('fieldset', { class: 'segmented' },
      h('legend', { class: 'visually-hidden' }, 'Status'),
      filter.STATUSES.map((s) => [
        h('input', {
          type: 'radio', name: 'status', id: 'status-' + s.id, value: s.id, checked: state.status === s.id,
          onchange: () => { state.status = s.id; update(); },
        }),
        h('label', { for: 'status-' + s.id }, s.label),
      ]));

    const summary = h('p', { class: 'list-summary', role: 'status', 'aria-live': 'polite' });
    const list = h('ul', { class: 'list' });

    function update() {
      const shown = filter.apply(all, { ...state, now: new Date() });
      summary.textContent = shown.length ? summaryText(filter.summarize(shown)) : '';
      list.replaceChildren(...(shown.length ? shown.map(row) : [h('li', null, empty('No receipts found'))]));
    }

    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.query = search.value; update(); }, DEBOUNCE_MS);
    });
    search.addEventListener('search', () => { clearTimeout(timer); state.query = search.value; update(); }); // clear (x) / Enter
    fromDay.addEventListener('change', () => { state.fromDay = fromDay.value; update(); });
    toDay.addEventListener('change', () => { state.toDay = toDay.value; update(); });

    el.append(
      h('a', { class: 'btn btn-secondary btn-block summary-link', href: '#/summary' }, 'Daily summary'),
      h('div', { class: 'filters' }, search, preset, custom, statusGroup),
      summary,
      list);
    update();
  }

  (window.Views = window.Views || {}).history = { render };
})();
