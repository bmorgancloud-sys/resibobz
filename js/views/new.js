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
  const newDraft = () => ({
    customerName: '', customerPhone: '', customerTin: '', customerAddress: '', paymentMethod: 'cash', lines: [newLine()],
  });
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

    // Type-ahead suggestions from saved products/customers (free text is still allowed).
    const searchProducts = (q) => typeahead.match(products, q, { text: (p) => p.name });
    // Each customer field searches only its own data: names in Name, numbers in Phone.
    const searchCustomerNames = (q) => typeahead.match(customers, q, { text: (c) => c.name });
    const searchCustomerPhones = (q) => typeahead.matchPhone(customers, q, { phone: (c) => c.phone });

    function productOption(p) {
      return [
        h('span', { class: 'typeahead-main' },
          h('span', { class: 'typeahead-title' }, p.name),
          p.unit ? h('span', { class: 'typeahead-sub' }, 'per ' + p.unit) : null),
        h('span', { class: 'typeahead-end' },
          h('span', { class: 'list-amount' }, money.formatCents(p.priceCents)),
          p.zeroRated ? h('span', { class: 'badge' }, 'Zero-rated') : null),
      ];
    }

    // Name + phone in both customer fields, so same-name customers can be told apart.
    function customerOption(c) {
      return h('span', { class: 'typeahead-main' },
        h('span', { class: 'typeahead-title' }, c.name),
        h('span', { class: 'typeahead-sub' }, c.phone || 'No phone'));
    }

    // ---- Setup hint ----
    const setupHint = !settings.business.name || !settings.business.gstTin
      ? h('div', { class: 'card setup-hint' },
          'Add your business name and GST TIN in ',
          h('a', { href: '#/settings' }, 'Settings'),
          ' so they appear on receipts.')
      : null;

    // ---- Customer ----
    const custName = h('input', { type: 'text', value: draft.customerName, maxlength: 100, autocomplete: 'off' });
    const custPhone = h('input', { type: 'tel', value: draft.customerPhone, inputmode: 'tel', maxlength: 40, autocomplete: 'off' });
    const custTin = h('input', { type: 'text', value: draft.customerTin, maxlength: 40, autocapitalize: 'characters', autocomplete: 'off' });
    const custAddress = h('textarea', { rows: 2, maxlength: 300 });
    custAddress.value = draft.customerAddress;
    const custInputs = { customerName: custName, customerPhone: custPhone, customerTin: custTin, customerAddress: custAddress };
    for (const [key, input] of Object.entries(custInputs)) {
      input.addEventListener('input', () => { draft[key] = input.value; });
    }
    /** Put a value in a customer field (and the draft). onlyIfEmpty leaves typed text alone. */
    function fillCustomer(key, value, onlyIfEmpty) {
      if (!value || (onlyIfEmpty && custInputs[key].value.trim())) return;
      custInputs[key].value = draft[key] = value;
    }
    // Typing a saved name exactly fills empty fields; picking a suggestion replaces them.
    custName.addEventListener('input', () => {
      const c = customerByName.get(custName.value.trim().toLowerCase());
      if (c) fillDetails(c, true);
    });
    function fillDetails(c, onlyIfEmpty) {
      fillCustomer('customerPhone', c.phone, onlyIfEmpty);
      fillCustomer('customerTin', c.tin, onlyIfEmpty);
      fillCustomer('customerAddress', c.address, onlyIfEmpty);
    }
    // Picking a different customer than last time clears TIN/address first, so one
    // customer's details never carry over to another. Re-picking the same one keeps edits.
    let pickedId = null;
    function pickCustomer(c) {
      if (c.id !== pickedId) {
        custTin.value = draft.customerTin = '';
        custAddress.value = draft.customerAddress = '';
      }
      pickedId = c.id;
      custName.value = draft.customerName = c.name;
      fillDetails(c, false);
    }
    if (customers.length) {
      typeahead.attach(custName, {
        label: 'Saved customers', search: searchCustomerNames, renderOption: customerOption, onPick: pickCustomer,
      });
      typeahead.attach(custPhone, {
        label: 'Saved customers', search: searchCustomerPhones, renderOption: customerOption, onPick: pickCustomer,
      });
    }

    // ---- Line items ----
    const linesEl = h('div');
    const totalsEl = h('div', { class: 'sticky-totals' });

    function renderLines() {
      linesEl.replaceChildren(...draft.lines.map((l, i) => lineCard(l, i)));
      updateTotals();
    }

    function lineCard(l, index) {
      const desc = h('input', { type: 'text', value: l.description, maxlength: 120, autocomplete: 'off' });
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

      /** Fill the line's price and GST status from a saved product. */
      function applyProduct(prod) {
        l.price = money.centsToInput(prod.priceCents);
        price.value = l.price;
        l.zeroRated = !!prod.zeroRated;
        zero.checked = l.zeroRated;
        setError(price, '');
      }

      desc.addEventListener('input', () => {
        l.description = desc.value;
        // Typed a saved product's exact name: same as picking it.
        const prod = productByName.get(desc.value.trim().toLowerCase());
        if (prod) applyProduct(prod);
        setError(desc, '');
        onChange();
      });
      if (products.length) {
        typeahead.attach(desc, {
          label: 'Saved products',
          search: searchProducts,
          renderOption: productOption,
          onPick: (prod) => {
            desc.value = l.description = prod.name;
            applyProduct(prod);
            setError(desc, '');
            onChange();
          },
        });
      }
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
          customer: {
            name: draft.customerName, phone: draft.customerPhone, tin: draft.customerTin, address: draft.customerAddress,
          },
          paymentMethod: draft.paymentMethod,
          lines: parsed,
        }, fresh);
        const saved = await db.saveNewDocument('receipt', record);
        draft = newDraft();
        toast('Saved ' + saved.number);
        location.hash = '#/receipt/' + saved.id + '/saved';
        autoSaveFrom(saved); // after the receipt is safe; never throws
      } catch (err) {
        console.error(err);
        toast('Could not save: ' + err.message);
        saveBtn.disabled = false;
      }
    }

    /**
     * Add the receipt's customer and items to saved Customers/Products (js/autosave.js).
     * The receipt is already saved, so a failure here only shows a notice.
     */
    async function autoSaveFrom(saved) {
      try {
        const result = await autosave.run(saved);
        if (!result.priceChanges.length) return;
        const update = await ui.confirm(autosave.priceMessage(result.priceChanges, money.formatCents),
          { okText: 'Update', cancelText: 'Keep old prices' });
        if (update) {
          await autosave.applyPrices(result.priceChanges);
          toast('Saved prices updated');
        }
      } catch (err) {
        console.error('Auto-save of customer/products failed', err);
        toast('Receipt saved, but customer/products were not updated');
      }
    }

    const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      setupHint,
      h('section', { class: 'card' },
        h('h2', null, 'Customer'),
        field('Name', custName, { hint: 'Optional. Leave blank for a walk-in sale.' }),
        field('Phone', custPhone, { hint: 'Optional. Used for the WhatsApp link.' }),
        field('TIN', custTin, { hint: 'Optional. Printed under Bill To.' }),
        field('Address', custAddress, { hint: 'Optional. Printed under Bill To.' })),
      h('section', { class: 'items-section' },
        h('h2', { class: 'section-title' }, 'Items'),
        h('p', { class: 'field-hint items-hint' }, 'Prices exclude GST.'),
        linesEl,
        addItem),
      h('section', { class: 'card' }, payment),
      h('div', { class: 'sticky-bar sticky-bar-split' }, totalsEl, saveBtn));

    el.append(form);
    renderLines();
  }

  /** True if the in-progress receipt has anything typed in it (used to hold off update reloads). */
  function hasDraft() {
    return ['customerName', 'customerPhone', 'customerTin', 'customerAddress'].some((k) => draft[k].trim())
      || draft.lines.some((l) => !isBlank(l));
  }

  (window.Views = window.Views || {}).new = { render, hasDraft };
})();
