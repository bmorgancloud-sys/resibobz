/*
 * views/quote-edit.js: quote editor, #/quote/new and #/quote/<id>/edit (dispatched by views/quote.js).
 * Same form as New Receipt (js/editor.js) in 'quote' mode: Valid until + Notes / terms, no payment.
 * New quotes are numbered QT-0001... (own counter). Converted or cancelled quotes can't be edited.
 * Saving runs the shared auto-save of customer/products (respects Settings).
 */
(function () {
  'use strict';
  const { h, toast, empty } = ui;

  async function render(ctx) {
    const { el, params, setTitle } = ctx;
    const isNew = params[0] === 'new';
    let existing = null;
    if (!isNew) {
      existing = await db.get('quotes', Number(params[0]));
      if (!existing) {
        el.append(empty('This quote no longer exists.'), h('a', { class: 'btn btn-secondary btn-block', href: '#/quotes' }, 'Back to quotes'));
        return;
      }
      if (!quote.isActive(existing)) {
        setTitle(existing.number);
        el.append(empty(existing.number + ' is ' + quote.statusLabel(quote.status(existing)).toLowerCase() + ' and can\'t be edited.'),
          h('a', { class: 'btn btn-secondary btn-block', href: '#/quote/' + existing.id }, 'Back to quote'));
        return;
      }
    }
    setTitle(isNew ? 'New quote' : 'Edit ' + existing.number);

    const draft = isNew ? editor.newDraft('quote') : editor.fromDocument(existing, 'quote');
    await editor.mount(el, {
      draft,
      mode: 'quote',
      saveLabel: 'Save quote',
      docWord: 'Quote',
      save: async (input, settings) => {
        const now = new Date();
        const saved = isNew
          ? await db.saveNewDocument('quote', quote.buildQuote(input, settings, now))
          : await db.updateQuote(quote.buildQuote(input, settings, now, existing));
        toast('Saved ' + saved.number);
        ui.replaceRoute('#/quote/' + saved.id + (isNew ? '/saved' : ''));
        return saved;
      },
    });
  }

  (window.Views = window.Views || {}).quoteEdit = { render };
})();
