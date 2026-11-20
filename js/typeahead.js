/*
 * typeahead.js: suggestion matching (pure, unit-tested) and a small accessible combobox
 * used on New Receipt to pick saved products and customers. Exposes global `typeahead`.
 *
 * match(): names only, case- and accent-insensitive ("jose" finds "José"). Ranking:
 *   name starts with the query > a word in the name starts with it > name contains it.
 * matchPhone(): phone numbers only, compared as digits (spaces, dashes, brackets and a
 *   leading +501/501 ignored). Ranking: number starts with the query > contains it.
 * Ties keep the input order, so callers pass items already sorted by name.
 */
(function (root) {
  'use strict';

  /** Lowercase, strip accents, trim. */
  function norm(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  /** 0 = text starts with needle, 1 = a word starts with it, 2 = contains it, -1 = no match. */
  function score(text, needle) {
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
      if (i === 0) return 0;
      if (!/[a-z0-9]/.test(text[i - 1])) return 1;
    }
    return text.includes(needle) ? 2 : -1;
  }

  /** Keep items with scoreOf(item) !== -1, lowest score first, ties in input order. */
  function rank(items, scoreOf, limit) {
    const ranked = [];
    items.forEach((item, i) => {
      const s = scoreOf(item);
      if (s !== -1) ranked.push({ item, s, i });
    });
    ranked.sort((a, b) => a.s - b.s || a.i - b.i);
    return ranked.slice(0, limit).map((r) => r.item);
  }

  /**
   * Filter and rank items by name only. text(item) is the name to match.
   * An empty query returns the first `limit` items unchanged.
   */
  function match(items, query, { text, limit = 8 }) {
    const needle = norm(query);
    if (!needle) return items.slice(0, limit);
    return rank(items, (item) => score(norm(text(item)), needle), limit);
  }

  /** Phone as bare local digits: "+501 (622) 1234" -> "6221234". */
  function phoneDigits(s) {
    return String(s == null ? '' : s).replace(/\D/g, '').replace(/^501/, '');
  }

  /**
   * Filter and rank items by phone number only. phone(item) is the number to match.
   * Returns nothing until the query has `minDigits` digits (not counting a leading 501).
   */
  function matchPhone(items, query, { phone, limit = 8, minDigits = 3 }) {
    const needle = phoneDigits(query);
    if (needle.length < minDigits) return [];
    return rank(items, (item) => {
      const i = phoneDigits(phone(item)).indexOf(needle);
      return i === -1 ? -1 : i === 0 ? 0 : 1;
    }, limit);
  }

  // ---- Combobox (browser only) ----

  let seq = 0;

  /**
   * Turn a text input into a combobox. The suggestion list is inserted right after the input
   * the first time it opens, so call this before or after the input is placed in a field().
   *   search(query)       -> items to show (empty array closes the list)
   *   renderOption(item)  -> child node(s) for one option
   *   onPick(item)        called when the user taps or presses Enter on an option
   */
  function attach(input, { search, renderOption, onPick, label }) {
    const { h } = root.ui;
    const id = 'ta' + (++seq);
    const listbox = h('ul', { id, class: 'typeahead-list', role: 'listbox', 'aria-label': label, hidden: true });
    let results = [];
    let active = -1;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', id);

    function open() {
      results = search(input.value);
      if (!results.length) return close();
      if (!listbox.isConnected) {
        input.after(listbox);
        input.parentElement.classList.add('typeahead-host');
      }
      // Pin the list right under the input. Without an explicit top, an absolute child of a
      // flex column (.field) sits at the top of the field and covers the label and input.
      listbox.style.top = (input.offsetTop + input.offsetHeight) + 'px';
      active = -1;
      listbox.replaceChildren(...results.map((item, i) =>
        h('li', { id: id + '-' + i, class: 'typeahead-option', role: 'option', 'aria-selected': 'false',
          onclick: () => pick(i) }, renderOption(item))));
      listbox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    }

    function close() {
      listbox.hidden = true;
      results = [];
      active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }

    function setActive(i) {
      const opts = listbox.children;
      if (opts[active]) opts[active].setAttribute('aria-selected', 'false');
      active = i;
      if (opts[active]) {
        opts[active].setAttribute('aria-selected', 'true');
        opts[active].scrollIntoView({ block: 'nearest' });
        input.setAttribute('aria-activedescendant', opts[active].id);
      }
    }

    function pick(i) {
      const item = results[i];
      close();
      if (item) onPick(item);
    }

    input.addEventListener('input', open);
    input.addEventListener('focus', open);
    input.addEventListener('blur', close);
    input.addEventListener('keydown', (e) => {
      const isOpen = !listbox.hidden;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) { open(); if (listbox.hidden) return; }
        const n = results.length;
        setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n : active) - 1);
      } else if (e.key === 'Enter' && isOpen && active >= 0) {
        e.preventDefault(); // don't submit the form
        pick(active);
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        close();
      }
    });
    // Keep focus in the input while tapping an option, so blur doesn't close the list first.
    listbox.addEventListener('mousedown', (e) => e.preventDefault());

    return { close };
  }

  const api = { norm, score, match, phoneDigits, matchPhone, attach };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.typeahead = api;
})(typeof window !== 'undefined' ? window : globalThis);
