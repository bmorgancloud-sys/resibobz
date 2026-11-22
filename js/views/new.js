/*
 * views/new.js: New Receipt screen (#/new). The form itself is the shared editor (js/editor.js).
 *
 * The draft lives in memory (module scope), so switching tabs mid-receipt keeps it.
 * Converting a quote (startConversion, from the quote detail screen) pre-fills the draft with the
 * quote's customer and lines and remembers the quote in draft.fromQuote. Only saving the receipt
 * marks the quote Converted (db.saveConvertedReceipt, one transaction); backing out leaves it Open.
 */
(function () {
  'use strict';
  const { h, toast } = ui;

  let draft = editor.newDraft('receipt');

  async function render(ctx) {
    const { el } = ctx;
    let banner = null;
    if (draft.fromQuote) {
      const q = await db.get('quotes', draft.fromQuote.id);
      if (!q || !quote.isActive(q)) {
        // Converted or cancelled elsewhere in the meantime: keep the typing, drop the link.
        toast('Quote ' + draft.fromQuote.number + ' can no longer be converted');
        draft.fromQuote = null;
      } else {
        banner = h('div', { class: 'notice', role: 'status' },
          h('span', null, 'Converting quote '),
          h('a', { href: '#/quote/' + q.id }, q.number),
          h('span', null, ' to a receipt. Pick the payment method and save. The quote stays open until you save.'),
          ' ',
          h('button', {
            type: 'button', class: 'link-btn',
            onclick: () => { draft = editor.newDraft('receipt'); el.replaceChildren(); render(ctx); },
          }, 'Discard'));
      }
    }
    if (banner) el.append(banner);
    if (!draft.fromQuote && draft.replaces) {
      el.append(h('div', { class: 'notice', role: 'status' },
        h('span', null, 'Copied from voided receipt ' + draft.replaces.number + '. Fix what was wrong and save. It gets a new number.'),
        ' ',
        h('button', {
          type: 'button', class: 'link-btn',
          onclick: () => { draft = editor.newDraft('receipt'); el.replaceChildren(); render(ctx); },
        }, 'Discard')));
    }
    const [lastBackupAt, receiptCount] = await Promise.all([db.getSetting('lastBackupAt'), db.count('receipts')]);
    const backupBanner = safety.backupBanner(lastBackupAt, receiptCount);
    if (backupBanner) el.append(backupBanner);

    await editor.mount(el, {
      draft,
      mode: 'receipt',
      saveLabel: 'Save receipt',
      docWord: 'Receipt',
      save: async (input, settings) => {
        const record = receipt.buildReceipt(input, settings);
        const saved = draft.fromQuote
          ? await db.saveConvertedReceipt(record, draft.fromQuote.id)
          : await db.saveNewDocument('receipt', record);
        draft = editor.newDraft('receipt');
        toast('Saved ' + saved.number);
        location.hash = '#/receipt/' + saved.id + '/saved';
        return saved;
      },
    });
  }

  /** Start a receipt from quote q (open or expired). Replaces the current draft. */
  function startConversion(q) {
    draft = editor.fromDocument(q, 'receipt');
    draft.fromQuote = { id: q.id, number: q.number };
  }

  /**
   * Start a corrected copy of voided receipt r: same customer, lines and payment method, saved as a
   * NEW receipt with the next number (the voided one stays in History). Replaces the current draft.
   */
  function startCorrection(r) {
    draft = editor.fromDocument(r, 'receipt');
    if (r.paymentMethod) draft.paymentMethod = r.paymentMethod;
    draft.replaces = { id: r.id, number: r.number };
  }

  /** The quote being converted in the current draft, or null. */
  function convertingQuote() {
    return draft.fromQuote || null;
  }

  /** True if the in-progress receipt has anything typed in it (used to hold off update reloads). */
  function hasDraft() {
    return !!draft.fromQuote || !!draft.replaces || editor.hasContent(draft);
  }

  (window.Views = window.Views || {}).new = { render, hasDraft, startConversion, startCorrection, convertingQuote };
})();
