/*
 * backup.js: backup file format, validation, summary and counter maths.
 * The pure functions are unit-tested (tests/backup.test.js); collect()/restore() use db.js.
 *
 * Backup file (JSON), schemaVersion 2:
 * {
 *   app: "ResiboBZ", schemaVersion: 2, exportedAt: ISO string,
 *   settings: { business, logo, gstRateBp, receiptPrefix, ... },   // no counters, no lastBackupAt
 *   counters: { receipt: 12, quote: 0 },                            // last number issued
 *   products: [...], customers: [...], receipts: [...], quotes: [...]   // records with their ids
 * }
 * Versions:
 *   1 (Phases 1-3): quotes and counters.quote may be missing; imported as [] and 0.
 *   2 (Phase 4): quotes is required. Quote records (js/quote.js) carry validUntil, notes and
 *     cancelledAt / convertedAt+receiptId; receipts made from a quote carry quoteId + quoteNumber.
 * Import replaces ALL data in one IndexedDB transaction (db.replaceAll), so a bad file or a
 * failure part-way leaves the existing data untouched.
 */
(function (root) {
  'use strict';

  const APP = 'ResiboBZ';
  const SCHEMA_VERSION = 2;
  const SUPPORTED_VERSIONS = [1, 2];
  const COUNTER_TYPES = ['receipt', 'quote'];
  const LIST_KEYS = ['products', 'customers', 'receipts', 'quotes'];
  /** Settings that belong to this device or to the counters section, never to `settings`. */
  const DEVICE_KEYS = ['lastBackupAt', 'counter_receipt', 'counter_quote'];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isInt = (v) => Number.isSafeInteger(v);
  const isStr = (v) => typeof v === 'string';

  /** Local date "YYYY-MM-DD". */
  function dayString(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fileName(now = new Date()) {
    return 'resibobz-backup-' + dayString(now) + '.json';
  }

  /**
   * Build the backup object from a dump: { settings (merged object), products, customers, receipts, quotes }.
   */
  function build(dump, now = new Date()) {
    const settings = {};
    for (const [k, v] of Object.entries(dump.settings || {})) {
      if (!DEVICE_KEYS.includes(k)) settings[k] = v;
    }
    const counters = {};
    for (const t of COUNTER_TYPES) counters[t] = (dump.settings && dump.settings['counter_' + t]) || 0;
    const out = { app: APP, schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), settings, counters };
    for (const k of LIST_KEYS) out[k] = dump[k] || [];
    return out;
  }

  /** Trailing number of "INV-0012" -> 12, or 0. */
  function numberValue(number) {
    const m = /(\d+)\s*$/.exec(String(number || ''));
    return m ? Number(m[1]) : 0;
  }

  /**
   * Counters to store after import: the higher of the file's counter and the highest
   * number among the imported documents, so a new receipt never repeats a number.
   */
  function countersFor(data) {
    const out = {};
    for (const t of COUNTER_TYPES) {
      const docs = data[t + 's'] || [];
      const highest = docs.reduce((m, d) => Math.max(m, numberValue(d.number)), 0);
      out[t] = Math.max((data.counters && data.counters[t]) || 0, highest);
    }
    return out;
  }

  // ---- Validation ----

  function fail(message) {
    throw new Error(message);
  }

  function checkSettings(s) {
    if (!isObj(s)) fail('Settings are missing.');
    if ('business' in s && !isObj(s.business)) fail('Business details are damaged.');
    if ('gstRateBp' in s && !(isInt(s.gstRateBp) && s.gstRateBp >= 0 && s.gstRateBp <= 10000)) fail('GST rate is damaged.');
    for (const k of ['receiptPrefix', 'quotePrefix']) {
      if (k in s && !(isStr(s[k]) && s[k].trim())) fail('Number prefix is damaged.');
    }
    if ('numberPadding' in s && !(isInt(s.numberPadding) && s.numberPadding >= 1 && s.numberPadding <= 10)) fail('Number padding is damaged.');
    if ('autoSaveContacts' in s && typeof s.autoSaveContacts !== 'boolean') fail('Auto-save setting is damaged.');
    if ('pageSize' in s && !['letter', 'a4'].includes(s.pageSize)) fail('PDF page size is damaged.');
    if ('logo' in s && s.logo !== null
      && !(isObj(s.logo) && isStr(s.logo.dataUrl) && /^data:image\/(png|jpeg);base64,/.test(s.logo.dataUrl))) {
      fail('The logo is damaged.');
    }
  }

  function checkIds(list, what) {
    const seen = new Set();
    for (const r of list) {
      if (!isObj(r)) fail('A ' + what + ' record is damaged.');
      if (!(isInt(r.id) && r.id > 0)) fail('A ' + what + ' record has no valid id.');
      if (seen.has(r.id)) fail('Two ' + what + ' records share id ' + r.id + '.');
      seen.add(r.id);
    }
  }

  function checkDocs(list, what) {
    checkIds(list, what);
    const numbers = new Set();
    for (const r of list) {
      if (!isStr(r.number) || !r.number) fail('A ' + what + ' has no number.');
      if (numbers.has(r.number)) fail('Two ' + what + 's share number ' + r.number + '.');
      numbers.add(r.number);
      if (!isStr(r.date) || isNaN(new Date(r.date))) fail(what + ' ' + r.number + ' has a damaged date.');
      if (!Array.isArray(r.lines) || !isObj(r.customer)) fail(what + ' ' + r.number + ' is damaged.');
      for (const k of ['subtotalCents', 'gstCents', 'totalCents']) {
        if (!isInt(r[k])) fail(what + ' ' + r.number + ' has a damaged amount.');
      }
    }
  }

  /**
   * Parse and validate backup file text. Returns the backup object or throws an Error
   * with a message fit to show the user.
   */
  function parse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      fail('This file is not valid JSON. It may be damaged or not a backup.');
    }
    if (!isObj(data) || data.app !== APP) fail('This is not a ResiboBZ backup file.');
    if (!SUPPORTED_VERSIONS.includes(data.schemaVersion)) {
      fail('This backup is from a different version of ResiboBZ (format ' + data.schemaVersion + ') and cannot be imported. Update the app and try again.');
    }
    if (!isStr(data.exportedAt) || isNaN(new Date(data.exportedAt))) fail('The backup date is damaged.');
    checkSettings(data.settings);
    if (!isObj(data.counters)) fail('Receipt counters are missing.');
    for (const t of COUNTER_TYPES) {
      const c = data.counters[t];
      if (c !== undefined && !(isInt(c) && c >= 0)) fail('Receipt counters are damaged.');
    }
    for (const k of ['products', 'customers', 'receipts']) {
      if (!Array.isArray(data[k])) fail('The ' + k + ' list is missing.');
    }
    if (data.schemaVersion >= 2 && !Array.isArray(data.quotes)) fail('The quotes list is missing.');
    if (data.quotes !== undefined && !Array.isArray(data.quotes)) fail('The quotes list is damaged.');
    checkIds(data.products, 'product');
    for (const p of data.products) {
      if (!isStr(p.name) || !isInt(p.priceCents)) fail('Product ' + p.id + ' is damaged.');
    }
    checkIds(data.customers, 'customer');
    for (const c of data.customers) if (!isStr(c.name)) fail('Customer ' + c.id + ' is damaged.');
    checkDocs(data.receipts, 'receipt');
    checkDocs(data.quotes || [], 'quote');
    for (const q of data.quotes || []) {
      if (q.validUntil !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(q.validUntil)) fail('quote ' + q.number + ' has a damaged valid-until date.');
    }
    // Version 1 (Phase 3) files: no quotes yet, quote counter starts at 0.
    return { ...data, quotes: data.quotes || [], counters: { quote: 0, ...data.counters } };
  }

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  /** "12 receipts, 3 quotes, 8 products, 5 customers, exported 2026-11-20" (quotes only when there are some) */
  function summary(data) {
    const quotes = (data.quotes || []).length;
    return plural(data.receipts.length, 'receipt') + ', ' + (quotes ? plural(quotes, 'quote') + ', ' : '')
      + plural(data.products.length, 'product') + ', '
      + plural(data.customers.length, 'customer') + ', exported ' + dayString(new Date(data.exportedAt));
  }

  // ---- Database glue (browser only) ----

  /** Read everything from IndexedDB and return the backup object. */
  async function collect(now = new Date()) {
    return build(await root.db.dumpAll(), now);
  }

  /** Replace all data with a parsed backup. Atomic: on failure nothing changes. */
  function restore(data) {
    return root.db.replaceAll({
      settings: data.settings,
      counters: countersFor(data),
      products: data.products,
      customers: data.customers,
      receipts: data.receipts,
      quotes: data.quotes || [],
      lastBackupAt: data.exportedAt,
    });
  }

  const api = { APP, SCHEMA_VERSION, SUPPORTED_VERSIONS, fileName, build, numberValue, countersFor, parse, summary, collect, restore };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.backup = api;
})(typeof window !== 'undefined' ? window : globalThis);
