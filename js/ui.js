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

  /**
   * Modal dialog. With `input` (a label), shows a text box and resolves its text on OK;
   * otherwise resolves true. Cancel resolves false (and null with `input`).
   */
  function dialog(message, { okText = 'OK', cancelText = 'Cancel', danger = false, input = null, required = null } = {}) {
    return new Promise((resolve) => {
      const ok = h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn' }, okText);
      const cancel = h('button', { type: 'button', class: 'btn btn-secondary' }, cancelText);
      const box = input ? h('input', { type: 'text', maxlength: 200, class: 'dialog-input' }) : null;
      const dlg = h('dialog', { class: 'dialog' },
        h('p', null, message),
        box ? field(input, box) : null,
        h('div', { class: 'dialog-actions' }, cancel, ok));
      const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
      ok.addEventListener('click', () => {
        // `required` (a message): OK with an empty box shows it inline and keeps the dialog open.
        if (box && required && !box.value.trim()) { setError(box, required); box.focus(); return; }
        done(box ? box.value.trim() : true);
      });
      if (box && required) box.addEventListener('input', () => setError(box, ''));
      cancel.addEventListener('click', () => done(box ? null : false));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(box ? null : false); });
      document.body.append(dlg);
      dlg.showModal();
      cancel.focus(); // safe default for destructive dialogs; no keyboard pop-up on phones
    });
  }

  /** Modal confirm. Resolves true/false. */
  function confirm(message, opts = {}) {
    return dialog(message, { ...opts, input: null });
  }

  /** Confirm with an optional text answer. Resolves the text ('' if left blank), or null if cancelled. */
  function ask(message, inputLabel, opts = {}) {
    return dialog(message, { ...opts, input: inputLabel });
  }

  /** Save a Blob as a file via a temporary download link. */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /**
   * One radio group as a row of equal-width buttons, styled like the other segmented rows
   * (History/Quotes date presets, Quotes statuses). One column per option, never scrolls.
   * Keep labels short (about 6 characters) so they fit at 320px.
   * wrapNarrow: for longer labels ("Converted"); below 440px wide the row shows as 3 + 2.
   * options: [{ id, label }]. onChange(id) runs when the selection changes.
   */
  function chipGroup({ name, legend, options, value, onChange, wrapNarrow = false }) {
    const row = h('fieldset', { class: 'segmented chips' + (wrapNarrow ? ' chips-wrap' : '') },
      h('legend', { class: 'visually-hidden' }, legend),
      options.map((o) => [
        h('input', {
          type: 'radio', name, id: name + '-' + o.id, value: o.id, checked: value === o.id,
          onchange: () => onChange(o.id),
        }),
        h('label', { for: name + '-' + o.id }, o.label),
      ]));
    row.style.setProperty('--chip-cols', options.length);
    return row;
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

  window.ui = { h, field, setError, checkbox, toast, confirm, ask, download, chipGroup, byName, replaceRoute, empty };
})();
