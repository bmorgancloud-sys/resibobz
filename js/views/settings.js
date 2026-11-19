/*
 * views/settings.js: business details, logo, GST rate, numbering, footer note.
 */
(function () {
  'use strict';
  const { h, field, setError, toast } = ui;

  const LOGO_MAX_PX = 600;

  function previewNumber(prefix, counter, pad) {
    return prefix + String(counter + 1).padStart(pad, '0');
  }

  /**
   * Read an image file, shrink it to at most LOGO_MAX_PX on its longest side,
   * and return { dataUrl, format, width, height } ready for jsPDF.addImage.
   * JPEG stays JPEG (smaller); everything else becomes PNG (keeps transparency).
   */
  async function processLogo(file) {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file (PNG or JPG).');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not read that image.'));
        i.src = url;
      });
      const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const c2d = canvas.getContext('2d');
      const format = file.type === 'image/jpeg' ? 'JPEG' : 'PNG';
      if (format === 'JPEG') { c2d.fillStyle = '#fff'; c2d.fillRect(0, 0, width, height); }
      c2d.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL(format === 'JPEG' ? 'image/jpeg' : 'image/png', 0.88);
      return { dataUrl, format, width, height };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function render({ el }) {
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
    const logoFile = h('input', { type: 'file', accept: 'image/*', class: 'file-input', id: 'logo-file' });
    const logoPick = h('label', { class: 'btn btn-secondary btn-small', for: 'logo-file' }, 'Choose image');
    const logoRemove = h('button', { type: 'button', class: 'btn btn-danger-outline btn-small' }, 'Remove');
    const logoErr = h('p', { class: 'field-error', hidden: true, role: 'alert' });

    function drawLogo() {
      logoPreview.replaceChildren(logo ? h('img', { src: logo.dataUrl, alt: 'Logo preview' }) : 'No logo');
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
      });
      toast('Settings saved');
    }

    const form = h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      h('section', { class: 'card' },
        h('h2', null, 'Business'),
        field('Business name', name, { hint: 'Shown at the top of every receipt.' }),
        h('div', { class: 'field' },
          h('span', { class: 'field-label' }, 'Logo'),
          h('div', { class: 'logo-row' }, logoPreview, logoFile, logoPick, logoRemove),
          h('p', { class: 'field-hint' }, 'Optional. Printed on the PDF.'),
          logoErr),
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
        field('Footer note', footer, { hint: 'Printed at the bottom of receipts.' })),
      h('div', { class: 'form-actions sticky-actions' },
        h('button', { type: 'submit', class: 'btn btn-block' }, 'Save settings')));

    el.append(form);
  }

  (window.Views = window.Views || {}).settings = { render };
})();
