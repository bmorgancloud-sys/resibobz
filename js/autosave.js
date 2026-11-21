/*
 * autosave.js: add the customer and items from a saved receipt (or quote) to saved Customers
 * and Products. Exposes global `autosave`. plan() is pure and unit-tested; run() and
 * applyPrices() read and write through db.js.
 *
 * Rules (Settings > "Auto-save new customers & products", setting `autoSaveContacts`, default on):
 * - Customer: match by phone first (digits only, leading 501 ignored), then by name (trimmed,
 *   any case). No match: add one. Match: fill only its EMPTY fields, never overwrite.
 *   Walk-in (no name and no phone): nothing. Phone only: the phone is used as the name.
 * - Products: match each line by name (trimmed, any case). No match: add it with the unit price
 *   and zero-rated flag. Same price: nothing. Different price: never changed here; returned in
 *   priceChanges so the caller can ask, then applyPrices() if the user agrees.
 *   Blank lines and $0.00 lines are skipped. A name repeated on one document uses its first line.
 *
 * Callers run this AFTER the document is saved and catch its errors: a failure here must never
 * lose the document.
 */
(function (root) {
  'use strict';

  const typeahead = typeof module !== 'undefined' && module.exports ? require('./typeahead.js') : root.typeahead;

  const CUSTOMER_FIELDS = ['name', 'phone', 'email', 'tin', 'address'];
  const str = (v) => String(v == null ? '' : v).trim();
  const nameKey = (v) => str(v).toLowerCase();

  /**
   * Work out what to write.
   * doc = { customer: { name, phone, email?, tin?, address? }, lines: [{ description, unitCents, zeroRated }] }
   * Returns {
   *   customers: records to put (a new one without id, or an existing one with empty fields filled),
   *   products:  new product records to put (without id),
   *   priceChanges: [{ id, name, oldCents, newCents }],
   * }
   */
  function plan(doc, { customers = [], products = [] } = {}, now = new Date()) {
    const iso = now.toISOString();
    const out = { customers: [], products: [], priceChanges: [] };

    // ---- Customer ----
    const c = (doc && doc.customer) || {};
    const typed = {};
    for (const f of CUSTOMER_FIELDS) typed[f] = str(c[f]);
    if (typed.name || typed.phone) {
      const digits = typeahead.phoneDigits(typed.phone);
      const match = (digits && customers.find((x) => typeahead.phoneDigits(x.phone) === digits))
        || (typed.name && customers.find((x) => nameKey(x.name) === nameKey(typed.name)))
        || null;
      if (!match) {
        out.customers.push({ ...typed, name: typed.name || typed.phone, createdAt: iso, updatedAt: iso });
      } else {
        const filled = { ...match };
        let changed = false;
        for (const f of CUSTOMER_FIELDS) {
          if (typed[f] && !str(match[f])) { filled[f] = typed[f]; changed = true; }
        }
        if (changed) { filled.updatedAt = iso; out.customers.push(filled); }
      }
    }

    // ---- Products ----
    const byName = new Map();
    for (const p of products) if (!byName.has(nameKey(p.name))) byName.set(nameKey(p.name), p);
    const seen = new Set();
    for (const l of (doc && doc.lines) || []) {
      const name = str(l.description);
      const k = name.toLowerCase();
      const cents = l.unitCents;
      if (!name || !Number.isInteger(cents) || cents <= 0 || seen.has(k)) continue;
      seen.add(k);
      const existing = byName.get(k);
      if (!existing) {
        out.products.push({ name, unit: '', priceCents: cents, zeroRated: !!l.zeroRated, createdAt: iso, updatedAt: iso });
      } else if (existing.priceCents !== cents) {
        out.priceChanges.push({ id: existing.id, name: existing.name, oldCents: existing.priceCents, newCents: cents });
      }
    }
    return out;
  }

  /**
   * Auto-save from a saved document if the setting is on.
   * Returns { skipped: true } when off, else the plan (with priceChanges for the caller to ask about).
   */
  async function run(doc, now = new Date()) {
    const db = root.db;
    const enabled = await db.getSetting('autoSaveContacts');
    if (enabled === false) return { skipped: true, customers: [], products: [], priceChanges: [] };
    const [customers, products] = await Promise.all([db.getAll('customers'), db.getAll('products')]);
    const p = plan(doc, { customers, products }, now);
    if (p.customers.length || p.products.length) await db.putMany({ customers: p.customers, products: p.products });
    return p;
  }

  /** Save the new prices from priceChanges (after the user tapped Update). */
  async function applyPrices(changes, now = new Date()) {
    const db = root.db;
    const iso = now.toISOString();
    const products = [];
    for (const ch of changes) {
      const p = await db.get('products', ch.id);
      if (p) products.push({ ...p, priceCents: ch.newCents, updatedAt: iso });
    }
    if (products.length) await db.putMany({ products });
    return products.length;
  }

  /** Dialog text, one change per line: "Update saved prices?\nChicken plate: $12.00 → $14.00". */
  function priceMessage(changes, formatCents) {
    return ['Update saved prices?', ...changes.map((c) =>
      c.name + ': ' + formatCents(c.oldCents) + ' → ' + formatCents(c.newCents))].join('\n');
  }

  const api = { CUSTOMER_FIELDS, plan, run, applyPrices, priceMessage };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.autosave = api;
})(typeof window !== 'undefined' ? window : globalThis);
