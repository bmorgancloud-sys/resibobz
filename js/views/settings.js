/*
 * views/settings.js: business details, logo, GST rate, numbering, PDF page size, footer note,
 * and a Developer card to load demo data (js/demo.js).
 */
(function () {
  'use strict';
  const { h, field, setError, toast } = ui;

  const LOGO_MAX_W = 400;
  const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

  function previewNumber(prefix, counter, pad) {
    return prefix + String(counter + 1).padStart(pad, '0');
  }

  /**
   * Read a PNG/JPG/WebP file, shrink it to at most LOGO_MAX_W pixels wide (never enlarge),
   * and return { dataUrl, format, width, height } ready for jsPDF.addImage.
   * JPEG stays JPEG (smaller). PNG and WebP become PNG, which keeps transparency
   * and is a format jsPDF can embed.
   */
  async function processLogo(file) {
    if (!LOGO_TYPES.includes(file.type)) throw new Error('Choose a PNG, JPG or WebP image.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not read that image. Try a PNG or JPG.'));
        i.src = url;
      });
      const scale = Math.min(1, LOGO_MAX_W / img.naturalWidth);
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const c2d = canvas.getContext('2d');
      const format = file.type === 'image/jpeg' ? 'JPEG' : 'PNG';
      // A canvas starts fully transparent; only JPEG (no alpha) gets a white backing.
      if (format === 'JPEG') { c2d.fillStyle = '#fff'; c2d.fillRect(0, 0, width, height); }
      c2d.imageSmoothingQuality = 'high';
      c2d.drawImage(img, 0, 0, width, height);
      const dataUrl = format === 'JPEG' ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
      return { dataUrl, format, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Developer card: load sample data after confirming, then re-render to show it. */
  function developerSection(ctx) {
    async function onLoadDemo() {
      const ok = await ui.confirm(
        'Add sample data? This adds a Demo Store business (Belmopan, GST 12.5%), 6 products and 4 customers. ' +
        'Nothing is overwritten: existing products and customers are kept, and only empty business fields are filled. ' +
        'Unsaved changes on this screen will be lost.',
        { okText: 'Load demo data' });
      if (!ok) return;
      btn.disabled = true;
      try {
        const p = await demo.load();
        const skipped = p.skippedProducts + p.skippedCustomers;
        toast(`Added ${p.products.length} products, ${p.customers.length} customers` +
          (skipped ? ` (${skipped} already there)` : ''));
        ctx.el.replaceChildren();
        await render(ctx);
      } catch (err) {
        console.error(err);
        toast('Could not load demo data: ' + err.message);
        btn.disabled = false;
      }
    }
    const btn = h('button', { type: 'button', class: 'btn btn-secondary btn-block', onclick: onLoadDemo }, 'Load demo data');
    return h('section', { class: 'card' },
      h('h2', null, 'Developer'),
      btn,
      h('p', { class: 'field-hint' }, 'Fills in sample business details, products and customers for trying the app.'));
  }

  async function render(ctx) {
    const { el } = ctx;
    const s = await db.getSettings();
    const b = s.business;
    let logo = s.logo; // pending value; saved with the form

    const name = h('input', { type: 'text', value: b.name, autocomplete: 'organization', maxlength: 100 });
    const address = h('textarea', { rows: 3, maxlength: 300 });
    address.value = b.address;
    const phone = h('input', { type: 'tel', value: b.phone, inputmode: 'tel', autocomplete: 'tel', maxlength: 40 });
    const email = h('input', { type: 'email', value: b.email, inputmode: 'email', autocomplete: 'email', maxlength: 100 });
    const tin = h('input', { type: 'text', value: b.gstTin, maxlength: 40, autocapitalize: 'characters' });

    // Logo
    const logoPreview = h('div', { class: 'logo-preview' });
    const logoFile = h('input', {
      type: 'file', accept: LOGO_TYPES.join(','), class: 'file-input', id: 'logo-file',
      'aria-describedby': 'logo-hint',
    });
    const logoPick = h('label', { class: 'btn btn-secondary', for: 'logo-file' }, 'Choose image');
    const logoRemove = h('button', { type: 'button', class: 'btn btn-danger-outline' }, 'Remove logo');
    const logoErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });

    function drawLogo() {
      logoPreview.replaceChildren(logo ? h('img', { src: logo.dataUrl, alt: 'Business logo preview' }) : 'No logo');
      logoPick.textContent = logo ? 'Change image' : 'Choose image';
      logoRemove.hidden = !logo;
    }
    logoFile.addEventListener('change', async () => {
      const file = logoFile.files[0];
      logoFile.value = '';
      if (!file) return;
      logoErr.hidden = true;
      try {
        logo = await processLogo(file);
        drawLogo();
      } catch (err) {
        logoErr.textContent = err.message;
        logoErr.hidden = false;
      }
    });
    logoRemove.addEventListener('click', () => { logo = null; drawLogo(); });
    drawLogo();

    const rate = h('input', { type: 'text', inputmode: 'decimal', value: money.formatRate(s.gstRateBp), maxlength: 6 });
    const receiptPrefix = h('input', { type: 'text', value: s.receiptPrefix, maxlength: 10, autocapitalize: 'characters' });
    const quotePrefix = h('input', { type: 'text', value: s.quotePrefix, maxlength: 10, autocapitalize: 'characters' });
    const receiptPreview = h('span');
    const quotePreview = h('span');

    const footer = h('textarea', { rows: 2, maxlength: 300 });
    footer.value = s.receiptFooter;

    let pageSize = pdf.PAGE_SIZES[s.pageSize] ? s.pageSize : db.DEFAULT_SETTINGS.pageSize;
    const pageSizeGroup = h('fieldset', { class: 'segmented segmented-2', 'aria-describedby': 'page-size-hint' },
      h('legend', null, 'PDF page size'),
      Object.entries(pdf.PAGE_SIZES).map(([id, p]) => [
        h('input', {
          type: 'radio', name: 'page-size', id: 'page-' + id, value: id,
          checked: pageSize === id,
          onchange: () => { pageSize = id; },
        }),
        h('label', { for: 'page-' + id }, p.label),
      ]));

    function updatePreviews() {
      receiptPreview.textContent = previewNumber(receiptPrefix.value.trim(), s.counter_receipt, s.numberPadding);
      quotePreview.textContent = previewNumber(quotePrefix.value.trim(), s.counter_quote, s.numberPadding);
    }
    receiptPrefix.addEventListener('input', updatePreviews);
    quotePrefix.addEventListener('input', updatePreviews);
    updatePreviews();

    async function onSubmit(e) {
      e.preventDefault();
      let ok = true;

      const rateBp = money.parseRate(rate.value);
      setError(rate, rateBp == null ? 'Enter a rate from 0 to 100, e.g. 12.5' : '');
      if (rateBp == null) ok = false;

      for (const input of [receiptPrefix, quotePrefix]) {
        const v = input.value.trim();
        const msg = !v ? 'Required' : /\s/.test(v) ? 'No spaces' : '';
        setError(input, msg);
        if (msg) ok = false;
      }
      if (ok && receiptPrefix.value.trim() === quotePrefix.value.trim()) {
        setError(quotePrefix, 'Must differ from the receipt prefix');
        ok = false;
      }

      const em = email.value.trim();
      const emailBad = em && !email.checkValidity();
      setError(email, emailBad ? 'Check the email address' : '');
      if (emailBad) ok = false;

      if (!ok) {
        const firstBad = form.querySelector('[aria-invalid]');
        if (firstBad) firstBad.focus();
        return;
      }

      await db.setSettings({
        business: {
          name: name.value.trim(),
          address: address.value.trim(),
          phone: phone.value.trim(),
          email: em,
          gstTin: tin.value.trim(),
        },
        logo,
        gstRateBp: rateBp,
        receiptPrefix: receiptPrefix.value.trim(),
        quotePrefix: quotePrefix.value.trim(),
        receiptFooter: footer.value.trim(),
        pageSize,
      });
      toast('Settings saved');
    }

    const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      h('section', { class: 'card' },
        h('h2', null, 'Business'),
        h('div', { class: 'field', role: 'group', 'aria-labelledby': 'logo-label' },
          h('span', { class: 'field-label', id: 'logo-label' }, 'Business logo'),
          h('div', { class: 'logo-field' },
            logoPreview,
            h('div', { class: 'logo-actions' }, logoFile, logoPick, logoRemove)),
          h('p', { class: 'field-hint', id: 'logo-hint' },
            'Optional. PNG, JPG or WebP. Printed at the top left of the PDF. Tap Save settings to keep changes.'),
          logoErr),
        field('Business name', name, { hint: 'Shown at the top of every receipt.' }),
        field('Address', address),
        field('Phone', phone),
        field('Email', email),
        field('GST TIN', tin, { hint: 'Your GST registration number. Printed on every receipt.' })),
      h('section', { class: 'card' },
        h('h2', null, 'GST'),
        field('GST rate (%)', rate, { hint: 'Belize standard rate is 12.5%. Applies to new receipts only.' })),
      h('section', { class: 'card' },
        h('h2', null, 'Numbering'),
        field('Receipt prefix', receiptPrefix),
        h('p', { class: 'field-hint' }, 'Next receipt: ', receiptPreview),
        field('Quote prefix', quotePrefix),
        h('p', { class: 'field-hint' }, 'Next quote: ', quotePreview)),
      h('section', { class: 'card' },
        h('h2', null, 'Receipts'),
        h('div', { class: 'field' },
          pageSizeGroup,
          h('p', { class: 'field-hint', id: 'page-size-hint' },
            'Match the paper you print on. Applies to every PDF, including past receipts.')),
        field('Footer note', footer, { hint: 'Printed at the bottom of receipts.' })),
      developerSection(ctx),
      h('div', { class: 'sticky-bar' },
        h('button', { type: 'submit', class: 'btn btn-block' }, 'Save settings')));

    el.append(form);
  }

  (window.Views = window.Views || {}).settings = { render };
})();
