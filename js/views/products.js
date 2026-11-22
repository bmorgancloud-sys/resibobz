/*
 * views/products.js: product list (#/products) and add/edit form (#/products/new, #/products/<id>).
 *
 * Product: { id, name, unit, priceCents, zeroRated, createdAt, updatedAt }
 * priceCents is GST-exclusive. Receipts copy product data into their lines,
 * so editing or deleting a product never changes past receipts.
 */
(function () {
  'use strict';
  const { h, field, setError, checkbox, toast, confirm, byName, replaceRoute, empty } = ui;

  async function renderList({ el }) {
    const [products, rateBp] = await Promise.all([db.getAll('products'), db.getSetting('gstRateBp')]);
    products.sort(byName);

    const list = h('ul', { class: 'list' });
    const search = h('input', {
      type: 'search', class: 'search', placeholder: 'Search products', 'aria-label': 'Search products',
      oninput: () => draw(search.value),
    });

    function draw(q) {
      const needle = q.trim().toLowerCase();
      const rows = products.filter((p) => !needle || p.name.toLowerCase().includes(needle));
      list.replaceChildren(...rows.map((p) => {
        const inc = p.priceCents + (p.zeroRated ? 0 : money.gstOn(p.priceCents, rateBp));
        return h('li', null,
          h('a', { class: 'list-row', href: '#/products/' + p.id },
            h('span', { class: 'list-main' },
              h('span', { class: 'list-title' }, h('span', { class: 'list-title-text' }, p.name)),
              h('span', { class: 'list-sub' },
                p.unit ? 'per ' + p.unit : null,
                p.zeroRated ? h('span', { class: 'badge' }, 'Zero-rated') : null)),
            h('span', { class: 'list-end' },
              h('span', { class: 'list-amount' }, money.formatCents(p.priceCents)),
              h('span', { class: 'list-sub' }, money.formatCents(inc) + ' incl.'))));
      }));
      if (!rows.length) {
        list.append(h('li', null, empty(products.length ? 'No products match.' : 'No products yet. Tap + to add one.')));
      }
    }

    el.append(
      products.length ? search : null,
      list,
      h('a', { class: 'fab', href: '#/products/new', 'aria-label': 'Add product' }, '+'));
    draw('');
  }

  async function renderForm({ el, params, setTitle }) {
    const isNew = params[0] === 'new';
    const id = isNew ? null : Number(params[0]);
    const rateBp = await db.getSetting('gstRateBp');
    const existing = isNew ? null : await db.get('products', id);

    if (!isNew && !existing) {
      setTitle('Product');
      el.append(empty('This product no longer exists.'),
        h('a', { class: 'btn btn-secondary btn-block', href: '#/products' }, 'Back to products'));
      return;
    }
    setTitle(isNew ? 'Add product' : 'Edit product');
    const p = existing || { name: '', unit: '', priceCents: 0, zeroRated: false };

    const name = h('input', { type: 'text', value: p.name, maxlength: 100, required: true, autocomplete: 'off' });
    const price = h('input', {
      type: 'text', inputmode: 'decimal', placeholder: '0.00', maxlength: 14,
      value: isNew ? '' : money.centsToInput(p.priceCents),
    });
    const unit = h('input', { type: 'text', value: p.unit || '', maxlength: 20, placeholder: 'e.g. each, lb, hour', autocomplete: 'off' });
    const zero = h('input', { type: 'checkbox', checked: p.zeroRated });
    const incl = h('p', { class: 'calc-line', 'aria-live': 'polite' });

    function updateIncl() {
      const cents = money.priceError(price.value) ? null : money.parseCents(price.value);
      if (cents == null) { incl.textContent = ''; return; }
      const gst = zero.checked ? 0 : money.gstOn(cents, rateBp);
      incl.textContent = zero.checked
        ? 'No GST. Customer pays ' + money.formatCents(cents)
        : 'GST ' + money.formatCents(gst) + ' (' + money.formatRate(rateBp) + '%). Customer pays ' + money.formatCents(cents + gst);
    }
    price.addEventListener('input', updateIncl);
    zero.addEventListener('change', updateIncl);
    updateIncl();

    let saving = false;
    async function onSubmit(e) {
      e.preventDefault();
      if (saving) return; // double tap: the first save is still running
      const n = name.value.trim();
      const priceErr = money.priceError(price.value);
      const cents = priceErr ? null : money.parseCents(price.value);
      setError(name, n ? '' : 'Enter a name');
      setError(price, priceErr);
      if (!n) return name.focus();
      if (cents == null) return price.focus();

      const now = new Date().toISOString();
      const record = {
        ...p,
        name: n,
        unit: unit.value.trim(),
        priceCents: cents,
        zeroRated: zero.checked,
        createdAt: p.createdAt || now,
        updatedAt: now,
      };
      if (isNew) delete record.id;
      saving = true;
      try {
        await db.put('products', record);
      } catch (err) {
        saving = false;
        safety.notSaved(err); // the form keeps what was typed
        return;
      }
      toast(isNew ? 'Product added' : 'Product saved');
      replaceRoute('#/products');
    }

    async function onDelete() {
      if (!(await confirm('Delete "' + p.name + '"? Past receipts are not affected.', { okText: 'Delete', danger: true }))) return;
      try {
        await db.remove('products', id);
      } catch (err) {
        console.error(err);
        toast('Not deleted — try again');
        return;
      }
      toast('Product deleted');
      replaceRoute('#/products');
    }

    el.append(h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      h('section', { class: 'card' },
        field('Name', name, { required: true }),
        field('Price excl. GST ($)', price, { required: true }),
        incl,
        field('Unit', unit, { hint: 'Optional.' }),
        checkbox('Zero-rated / exempt', zero, 'No GST is charged on this item.')),
      isNew ? null : h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onclick: onDelete }, 'Delete product')),
      h('div', { class: 'sticky-bar sticky-bar-buttons' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => replaceRoute('#/products') }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn' }, isNew ? 'Add product' : 'Save changes'))));

    if (isNew) name.focus();
  }

  (window.Views = window.Views || {}).products = {
    render: (ctx) => (ctx.params.length ? renderForm(ctx) : renderList(ctx)),
  };
})();
