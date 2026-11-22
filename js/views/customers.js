/*
 * views/customers.js: customer list (#/customers) and add/edit form (#/customers/new, #/customers/<id>).
 *
 * Customer: { id, name, phone, email, address, tin, createdAt, updatedAt }
 * Receipts copy customer details, so editing or deleting a customer never changes past receipts.
 */
(function () {
  'use strict';
  const { h, field, setError, toast, confirm, byName, replaceRoute, empty } = ui;

  async function renderList({ el }) {
    const customers = await db.getAll('customers');
    customers.sort(byName);

    const list = h('ul', { class: 'list' });
    const search = h('input', {
      type: 'search', class: 'search', placeholder: 'Search name or phone', 'aria-label': 'Search customers',
      oninput: () => draw(search.value),
    });

    function draw(q) {
      const needle = q.trim().toLowerCase();
      const digits = needle.replace(/\D/g, '');
      const rows = customers.filter((c) => !needle
        || c.name.toLowerCase().includes(needle)
        || (digits && (c.phone || '').replace(/\D/g, '').includes(digits)));
      list.replaceChildren(...rows.map((c) =>
        h('li', null,
          h('a', { class: 'list-row', href: '#/customers/' + c.id },
            h('span', { class: 'list-main' },
              h('span', { class: 'list-title' }, h('span', { class: 'list-title-text' }, c.name)),
              h('span', { class: 'list-sub' }, [c.phone, c.email].filter(Boolean).join(' · ') || null))))));
      if (!rows.length) {
        list.append(h('li', null, empty(customers.length ? 'No customers match.' : 'No customers yet. Tap + to add one.')));
      }
    }

    el.append(
      customers.length ? search : null,
      list,
      h('a', { class: 'fab', href: '#/customers/new', 'aria-label': 'Add customer' }, '+'));
    draw('');
  }

  async function renderForm({ el, params, setTitle }) {
    const isNew = params[0] === 'new';
    const id = isNew ? null : Number(params[0]);
    const existing = isNew ? null : await db.get('customers', id);

    if (!isNew && !existing) {
      setTitle('Customer');
      el.append(empty('This customer no longer exists.'),
        h('a', { class: 'btn btn-secondary btn-block', href: '#/customers' }, 'Back to customers'));
      return;
    }
    setTitle(isNew ? 'Add customer' : 'Edit customer');
    const c = existing || { name: '', phone: '', email: '', address: '', tin: '' };

    const name = h('input', { type: 'text', value: c.name, maxlength: 100, required: true, autocomplete: 'off' });
    const phone = h('input', { type: 'tel', value: c.phone, inputmode: 'tel', maxlength: 40, autocomplete: 'off' });
    const email = h('input', { type: 'email', value: c.email, inputmode: 'email', maxlength: 100, autocomplete: 'off' });
    const address = h('textarea', { rows: 3, maxlength: 300 });
    address.value = c.address || '';
    const tin = h('input', { type: 'text', value: c.tin || '', maxlength: 40, autocapitalize: 'characters', autocomplete: 'off' });

    let saving = false;
    async function onSubmit(e) {
      e.preventDefault();
      if (saving) return; // double tap: the first save is still running
      const n = name.value.trim();
      const em = email.value.trim();
      const emailBad = em && !email.checkValidity();
      setError(name, n ? '' : 'Enter a name');
      setError(email, emailBad ? 'Check the email address' : '');
      if (!n) return name.focus();
      if (emailBad) return email.focus();

      const now = new Date().toISOString();
      const record = {
        ...c,
        name: n,
        phone: phone.value.trim(),
        email: em,
        address: address.value.trim(),
        tin: tin.value.trim(),
        createdAt: c.createdAt || now,
        updatedAt: now,
      };
      if (isNew) delete record.id;
      saving = true;
      try {
        await db.put('customers', record);
      } catch (err) {
        saving = false;
        safety.notSaved(err); // the form keeps what was typed
        return;
      }
      toast(isNew ? 'Customer added' : 'Customer saved');
      replaceRoute('#/customers');
    }

    async function onDelete() {
      if (!(await confirm('Delete "' + c.name + '"? Past receipts are not affected.', { okText: 'Delete', danger: true }))) return;
      try {
        await db.remove('customers', id);
      } catch (err) {
        console.error(err);
        toast('Not deleted — try again');
        return;
      }
      toast('Customer deleted');
      replaceRoute('#/customers');
    }

    el.append(h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      h('section', { class: 'card' },
        field('Name', name, { required: true }),
        field('Phone', phone),
        field('Email', email),
        field('Address', address),
        field('TIN', tin, { hint: 'Optional. For business customers who need it on their invoice.' })),
      isNew ? null : h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn btn-danger-outline btn-block', onclick: onDelete }, 'Delete customer')),
      h('div', { class: 'sticky-bar sticky-bar-buttons' },
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => replaceRoute('#/customers') }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn' }, isNew ? 'Add customer' : 'Save changes'))));

    if (isNew) name.focus();
  }

  (window.Views = window.Views || {}).customers = {
    render: (ctx) => (ctx.params.length ? renderForm(ctx) : renderList(ctx)),
  };
})();
