/*
 * editor.js: the document editor shared by New Receipt (views/new.js) and the quote editor
 * (views/quote-edit.js). Exposes global `editor`.
 *
 * Customer fields with type-ahead, line items with the zero-rated toggle, live totals, validation,
 * and auto-save of the customer/products after a successful save (js/autosave.js).
 * mode 'receipt' adds the payment method; mode 'quote' adds "Valid until" and "Notes / terms".
 *
 * The caller owns the draft (a plain object from newDraft()/fromDocument()); inputs hold raw
 * strings and are parsed to cents/thousandths for totals and on save. The caller does the saving:
 *   editor.mount(el, { draft, mode, saveLabel, docWord, save: async (input, settings) => savedDoc })
 * input = { customer, lines: [{description, qtyMilli, unitCents, zeroRated}], paymentMethod | validUntil+notes }
 */
(function () {
  'use strict';
  const { h, field, setError, checkbox, toast } = ui;

  let lineSeq = 0;
  const newLine = () => ({ key: ++lineSeq, description: '', qty: '1', price: '', zeroRated: false });

  const CUSTOMER_KEYS = ['customerName', 'customerPhone', 'customerTin', 'customerAddress'];

  /** Empty draft. Quote drafts also get validUntil (today + 14 days) and notes. */
  function newDraft(mode = 'receipt', now = new Date()) {
    const d = { customerName: '', customerPhone: '', customerTin: '', customerAddress: '', lines: [newLine()] };
    if (mode === 'quote') Object.assign(d, { validUntil: quote.defaultValidUntil(now), notes: '' });
    else d.paymentMethod = 'cash';
    return d;
  }

  /** Draft pre-filled from a saved receipt/quote (editing a quote, or converting one to a receipt). */
  function fromDocument(doc, mode = 'receipt') {
    const d = newDraft(mode);
    const c = doc.customer || {};
    Object.assign(d, { customerName: c.name || '', customerPhone: c.phone || '', customerTin: c.tin || '', customerAddress: c.address || '' });
    if (doc.lines && doc.lines.length) {
      d.lines = doc.lines.map((l) => ({
        ...newLine(), description: l.description, qty: money.formatQty(l.qtyMilli), price: money.centsToInput(l.unitCents), zeroRated: !!l.zeroRated,
      }));
    }
    if (mode === 'quote') Object.assign(d, { validUntil: doc.validUntil || d.validUntil, notes: doc.notes || '' });
    return d;
  }

  function isBlank(l) {
    return !l.description.trim() && !l.price.trim();
  }

  /** True if the draft has a customer detail or a non-blank line typed in. */
  function hasContent(draft) {
    return CUSTOMER_KEYS.some((k) => draft[k].trim()) || draft.lines.some((l) => !isBlank(l));
  }

  /** True if qty × price is too big to add up exactly (at the highest rate, 100%). */
  function lineTooLarge(line) {
    try { money.calcLine(line, 10000); return false; } catch { return true; }
  }

  /** Parsed line or null if any field is invalid. */
  function parseLine(l) {
    if (!l.description.trim() || money.qtyError(l.qty) || money.priceError(l.price)) return null;
    const qtyMilli = money.parseQty(l.qty);
    const unitCents = money.parseCents(l.price);
    if (lineTooLarge({ qtyMilli, unitCents, zeroRated: l.zeroRated })) return null;
    return { description: l.description, qtyMilli, unitCents, zeroRated: l.zeroRated };
  }

  async function mount(el, opts) {
    const { draft, mode = 'receipt', saveLabel = 'Save', docWord = 'Receipt' } = opts;
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
          ' so they appear on ' + (mode === 'quote' ? 'quotes.' : 'receipts.'))
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
      let t;
      try {
        t = money.calcTotals(parsed, rateBp);
      } catch {
        totalsEl.replaceChildren(h('span', { class: 'sticky-total' }, 'Total too large'));
        return;
      }
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

    // ---- Receipt: payment method / Quote: valid until + notes ----
    let extraSection;
    let validUntil = null;
    if (mode === 'quote') {
      validUntil = h('input', { type: 'date', value: draft.validUntil, required: true });
      validUntil.addEventListener('input', () => { draft.validUntil = validUntil.value; setError(validUntil, ''); });
      validUntil.addEventListener('change', () => { draft.validUntil = validUntil.value; setError(validUntil, ''); });
      const notes = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'e.g. 50% deposit required' });
      notes.value = draft.notes;
      notes.addEventListener('input', () => { draft.notes = notes.value; });
      extraSection = h('section', { class: 'card' },
        h('h2', null, 'Quote details'),
        field('Valid until', validUntil, { hint: 'After this day the quote shows as Expired. It can still be converted.' }),
        field('Notes / terms', notes, { hint: 'Optional. Printed on the quote above the footer.' }));
    } else {
      extraSection = h('section', { class: 'card' }, h('fieldset', { class: 'segmented' },
        h('legend', null, 'Payment method'),
        receipt.PAYMENT_METHODS.map((m) => [
          h('input', {
            type: 'radio', name: 'payment', id: 'pay-' + m.id, value: m.id,
            checked: draft.paymentMethod === m.id,
            onchange: () => { draft.paymentMethod = m.id; },
          }),
          h('label', { for: 'pay-' + m.id }, m.label),
        ])));
    }

    // ---- Save ----
    const saveBtn = h('button', { type: 'submit', class: 'btn' }, saveLabel);

    async function onSubmit(e) {
      e.preventDefault();
      if (saveBtn.disabled) return; // double tap: the first save is still running
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
        const qErr = money.qtyError(l.qty);
        let pErr = money.priceError(l.price);
        if (!qErr && !pErr && lineTooLarge({ qtyMilli: money.parseQty(l.qty), unitCents: money.parseCents(l.price) })) {
          pErr = 'This line total is too large';
        }
        const qOk = !qErr;
        const pOk = !pErr;
        setError(desc, dOk ? '' : 'Enter a description');
        setError(qty, qErr);
        setError(price, pErr);
        if (!firstBad) firstBad = !dOk ? desc : !qOk ? qty : !pOk ? price : null;
        const p = parseLine(l);
        if (p) parsed.push(p);
      }
      if (validUntil && !filter.parseDay(draft.validUntil)) {
        setError(validUntil, 'Pick the last day this quote is valid');
        if (!firstBad) firstBad = validUntil;
      }
      if (firstBad) { firstBad.focus(); return; }

      const input = {
        customer: { name: draft.customerName, phone: draft.customerPhone, tin: draft.customerTin, address: draft.customerAddress },
        lines: parsed,
      };
      if (mode === 'quote') Object.assign(input, { validUntil: draft.validUntil, notes: draft.notes });
      else input.paymentMethod = draft.paymentMethod;

      saveBtn.disabled = true;
      let saved;
      try {
        const fresh = await db.getSettings(); // in case settings changed in another tab
        saved = await opts.save(input, fresh);
      } catch (err) {
        console.error(err);
        safety.notSaved(err); // the form keeps everything typed
        saveBtn.disabled = false;
        return;
      }
      autoSaveFrom(saved); // after the document is safe; never throws
    }

    /**
     * Add the document's customer and items to saved Customers/Products (js/autosave.js).
     * The document is already saved, so a failure here only shows a notice.
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
        toast(docWord + ' saved, but customer/products were not updated');
      }
    }

    const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      setupHint,
      h('section', { class: 'card' },
        h('h2', null, 'Customer'),
        field('Name', custName, { hint: mode === 'quote' ? 'Optional.' : 'Optional. Leave blank for a walk-in sale.' }),
        field('Phone', custPhone, { hint: 'Optional. Used for the WhatsApp link.' }),
        field('TIN', custTin, { hint: 'Optional. Printed under Bill To.' }),
        field('Address', custAddress, { hint: 'Optional. Printed under Bill To.' })),
      h('section', { class: 'items-section' },
        h('h2', { class: 'section-title' }, 'Items'),
        h('p', { class: 'field-hint items-hint' }, 'Prices exclude GST.'),
        linesEl,
        addItem),
      extraSection,
      h('div', { class: 'sticky-bar sticky-bar-split' }, totalsEl, saveBtn));

    el.append(form);
    renderLines();
  }

  window.editor = { newDraft, fromDocument, hasContent, mount };
})();
