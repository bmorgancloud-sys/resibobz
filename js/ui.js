/*
 * ui.js: small DOM helpers shared by views. Exposes global `ui`.
 * Always set user data with text nodes / textContent, never innerHTML.
 */
(function () {
  'use strict';

  /**
   * h('div', { class: 'x', onclick: fn, dataset: {id: 1} }, 'text', childNode, [more])
   * Attributes with value false/null/undefined are skipped; true sets an empty attribute.
   */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) append(el, c);
      else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  let fieldSeq = 0;

  /** Labelled form field. control is an input/select/textarea element. */
  function field(label, control, { hint, required } = {}) {
    if (!control.id) control.id = 'f' + (++fieldSeq);
    const hintEl = hint ? h('p', { class: 'field-hint', id: control.id + '-hint' }, hint) : null;
    if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
    const errEl = h('p', { class: 'field-error', id: control.id + '-err', hidden: true, role: 'alert' });
    return h('div', { class: 'field' },
      h('label', { for: control.id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
      control, hintEl, errEl);
  }

  /** Show or clear a validation message on a control created via field(). */
  function setError(control, message) {
    const errEl = document.getElementById(control.id + '-err');
    control.toggleAttribute('aria-invalid', !!message);
    if (errEl) { errEl.textContent = message || ''; errEl.hidden = !message; }
  }

  /** Large checkbox row. */
  function checkbox(label, input, hint) {
    if (!input.id) input.id = 'f' + (++fieldSeq);
    return h('label', { class: 'check', for: input.id },
      input,
      h('span', null, h('span', { class: 'check-label' }, label), hint ? h('span', { class: 'field-hint' }, hint) : null));
  }

  let toastTimer;
  function toast(message) {
    let el = document.getElementById('toast');
    if (!el) {
      el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }

  /** Modal confirm. Resolves true/false. */
  function confirm(message, { okText = 'OK', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      const ok = h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn' }, okText);
      const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, cancelText);
      const dlg = h('dialog', { class: 'dialog' },
        h('p', null, message),
        h('div', { class: 'dialog-actions' }, cancel, ok));
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      ok.addEventListener('click', () => done(true));
      cancel.addEventListener('click', () => done(false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
      document.body.append(dlg);
      dlg.showModal();
      cancel.focus();
    });
  }

  /** Case-insensitive name sort. */
  function byName(a, b) {
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  }

  /** Go to a hash route, replacing the current history entry (used after save/cancel). */
  function replaceRoute(hash) {
    location.replace(hash);
  }

  /** Empty-state block. */
  function empty(text) {
    return h('div', { class: 'placeholder' }, text);
  }

  window.ui = { h, field, setError, checkbox, toast, confirm, byName, replaceRoute, empty };
})();
