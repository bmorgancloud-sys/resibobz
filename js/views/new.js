/*
 * views/new.js: New Receipt screen (#/new).
 *
 * The draft lives in memory (module scope), so switching tabs mid-receipt keeps it.
 * Inputs hold raw strings; they are parsed to cents/thousandths for totals and on save.
 */
(function () {
  'use strict';
  const { h, field, setError, checkbox, toast } = ui;

  let lineSeq = 0;
  const newLine = () => ({ key: ++lineSeq, description: '', qty: '1', price: '', zeroRated: false });
  const newDraft = () => ({ customerName: '', customerPhone: '', paymentMethod: 'cash', lines: [newLine()] });
  let draft = newDraft();

  function isBlank(l) {
    return !l.description.trim() && !l.price.trim();
  }

  /** Parsed line or null if any field is invalid. */
  function parseLine(l) {
    const qtyMilli = money.parseQty(l.qty);
    const unitCents = money.parseCents(l.price);
    if (!l.description.trim() || qtyMilli == null || unitCents == null) return null;
    return { description: l.description, qtyMilli, unitCents, zeroRated: l.zeroRated };
  }

  async function render({ el }) {
    const [settings, products, customers] = await Promise.all([
      db.getSettings(), db.getAll('products'), db.getAll('customers'),
    ]);
    const rateBp = settings.gstRateBp;
    const rateText = money.formatRate(rateBp) + '%';
    products.sort(ui.byName);
    customers.sort(ui.byName);
    const productByName = new Map(products.map((p) => [p.name.toLowerCase(), p]));
    const customerByName = new Map(customers.map((c) => [c.name.toLowerCase(), c]));

    // Suggestion lists from saved products/customers
    const productList = h('datalist', { id: 'dl-products' }, products.map((p) => h('option', { value: p.name })));
    const customerList = h('datalist', { id: 'dl-customers' }, customers.map((c) => h('option', { value: c.name })));

    // ---- Setup hint ----
    const setupHint = !settings.business.name || !settings.business.gstTin
      ? h('div', { class: 'card setup-hint' },
          'Add your business name and GST TIN in ',
          h('a', { href: '#/settings' }, 'Settings'),
          ' so they appear on receipts.')
      : null;

    // ---- Customer ----
    const custName = h('input', { type: 'text', value: draft.customerName, list: 'dl-customers', maxlength: 100, autocomplete: 'off' });
    const custPhone = h('input', { type: 'tel', value: draft.customerPhone, inputmode: 'tel', maxlength: 40, autocomplete: 'off' });
    custName.addEventListener('input', () => {
      draft.customerName = custName.value;
      const c = customerByName.get(custName.value.trim().toLowerCase());
      if (c && c.phone && !custPhone.value.trim()) {
        custPhone.value = c.phone;
        draft.customerPhone = c.phone;
      }
    });
    custPhone.addEventListener('input', () => { draft.customerPhone = custPhone.value; });

    // ---- Line items ----
    const linesEl = h('div');
    const totalsEl = h('div', { class: 'sticky-totals' });

    function renderLines() {
      linesEl.replaceChildren(...draft.lines.map((l, i) => lineCard(l, i)));
      updateTotals();
    }

    function lineCard(l, index) {
      const desc = h('input', { type: 'text', value: l.description, list: 'dl-products', maxlength: 120, autocomplete: 'off' });
      const qty = h('input', { type: 'text', class: 'num', inputmode: 'decimal', value: l.qty, maxlength: 9 });
      const price = h('input', { type: 'text', class: 'num', inputmode: 'decimal', value: l.price, placeholder: '0.00', maxlength: 14 });
      const zero = h('input', { type: 'checkbox', checked: l.zeroRated });
      const lineTotal = h('p', { class: 'line-total' });
      l.inputs = { desc, qty, price };

      function updateLineTotal() {
        const p = parseLine(l);
        if (!p) { lineTotal.textContent = ''; return; }
        const c = money.calcLine(p, rateBp);
        lineTotal.textContent = money.formatCents(c.netCents)
          + (l.zeroRated ? ' · zero-rated' : ' + GST ' + money.formatCents(c.gstCents));
      }
      l.updateLineTotal = updateLineTotal;

      desc.addEventListener('input', () => {
        l.description = desc.value;
        // Picked a saved product: fill its price and GST status.
        const prod = productByName.get(desc.value.trim().toLowerCase());
        if (prod) {
          l.price = money.centsToInput(prod.priceCents);
          price.value = l.price;
          l.zeroRated = !!prod.zeroRated;
          zero.checked = l.zeroRated;
          setError(price, '');
        }
        setError(desc, '');
        onChange();
      });
      qty.addEventListener('input', () => { l.qty = qty.value; setError(qty, ''); onChange(); });
      price.addEventListener('input', () => { l.price = price.value; setError(price, ''); onChange(); });
      zero.addEventListener('change', () => { l.zeroRated = zero.checked; onChange(); });

      function onChange() {
        updateLineTotal();
        updateTotals();
      }

      const remove = h('button', {
        type: 'button', class: 'icon-btn', 'aria-label': 'Remove item ' + (index + 1),
        onclick: () => {
          draft.lines = draft.lines.filter((x) => x !== l);
          if (!draft.lines.length) draft.lines.push(newLine());
          renderLines();
        },
      }, '×');

      updateLineTotal();
      return h('div', { class: 'card line-item' },
        h('div', { class: 'line-item-head' }, h('span', null, 'Item ' + (index + 1)), remove),
        field('Description', desc),
        h('div', { class: 'line-grid' },
          field('Qty', qty),
          field('Unit price ($)', price)),
        checkbox('Zero-rated / exempt', zero),
        lineTotal);
    }

    function updateTotals() {
      const parsed = draft.lines.map(parseLine).filter(Boolean);
      const t = money.calcTotals(parsed, rateBp);
      // Compact so the sticky bar stays short on a 360px-wide phone.
      totalsEl.replaceChildren(
        h('span', { class: 'sticky-sub' }, 'Subtotal ' + money.formatCents(t.subtotalCents)),
        h('span', { class: 'sticky-sub' }, 'GST (' + rateText + ') ' + money.formatCents(t.gstCents)
          + (t.zeroRatedCents ? ' · ' + money.formatCents(t.zeroRatedCents) + ' zero-rated' : '')),
        h('span', { class: 'sticky-total' }, h('small', null, 'Total '), money.formatCents(t.totalCents)));
    }

    const addItem = h('button', {
      type: 'button', class: 'btn btn-secondary btn-block',
      onclick: () => {
        const l = newLine();
        draft.lines.push(l);
        renderLines();
        l.inputs.desc.focus();
      },
    }, '+ Add item');

    // ---- Payment method ----
    const payment = h('fieldset', { class: 'segmented' },
      h('legend', null, 'Payment method'),
      receipt.PAYMENT_METHODS.map((m) => [
        h('input', {
          type: 'radio', name: 'payment', id: 'pay-' + m.id, value: m.id,
          checked: draft.paymentMethod === m.id,
          onchange: () => { draft.paymentMethod = m.id; },
        }),
        h('label', { for: 'pay-' + m.id }, m.label),
      ]));

    // ---- Save ----
    const saveBtn = h('button', { type: 'submit', class: 'btn' }, 'Save receipt');

    async function onSubmit(e) {
      e.preventDefault();
      // Drop fully blank lines, but keep at least one to show errors on.
      const candidates = draft.lines.filter((l) => !isBlank(l));
      if (!candidates.length) {
        const first = draft.lines[0];
        setError(first.inputs.desc, 'Add at least one item');
        first.inputs.desc.focus();
        return;
      }

      let firstBad = null;
      const parsed = [];
      for (const l of candidates) {
        const { desc, qty, price } = l.inputs;
        const dOk = !!l.description.trim();
        const qOk = money.parseQty(l.qty) != null;
        const pOk = money.parseCents(l.price) != null;
        setError(desc, dOk ? '' : 'Enter a description');
        setError(qty, qOk ? '' : 'Invalid');
        setError(price, pOk ? '' : 'Enter a price, e.g. 12.50');
        if (!firstBad) firstBad = !dOk ? desc : !qOk ? qty : !pOk ? price : null;
        const p = parseLine(l);
        if (p) parsed.push(p);
      }
      if (firstBad) { firstBad.focus(); return; }

      saveBtn.disabled = true;
      try {
        const fresh = await db.getSettings(); // in case settings changed in another tab
        const record = receipt.buildReceipt({
          customer: { name: draft.customerName, phone: draft.customerPhone },
          paymentMethod: draft.paymentMethod,
          lines: parsed,
        }, fresh);
        const saved = await db.saveNewDocument('receipt', record);
        draft = newDraft();
        toast('Saved ' + saved.number);
        location.hash = '#/history/' + saved.id;
      } catch (err) {
        console.error(err);
        toast('Could not save: ' + err.message);
        saveBtn.disabled = false;
      }
    }

    const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      setupHint,
      h('section', { class: 'card' },
        h('h2', null, 'Customer'),
        field('Name', custName, { hint: 'Optional. Leave blank for a walk-in sale.' }),
        field('Phone', custPhone, { hint: 'Optional. Used for the WhatsApp link.' })),
      h('section', { class: 'items-section' },
        h('h2', { class: 'section-title' }, 'Items'),
        h('p', { class: 'field-hint items-hint' }, 'Prices exclude GST.'),
        linesEl,
        addItem),
      h('section', { class: 'card' }, payment),
      h('div', { class: 'sticky-bar sticky-bar-split' }, totalsEl, saveBtn),
      productList, customerList);

    el.append(form);
    renderLines();
  }

  (window.Views = window.Views || {}).new = { render };
})();
