/*
 * demo.js: sample data for trying the app (Settings > Developer > Load demo data).
 * Exposes global `demo`. plan() is pure and unit-tested; load() writes through db.js.
 *
 * Never overwrites: products and customers whose name already exists (ignoring case and
 * surrounding spaces) are skipped, only empty business fields are filled, and the GST rate
 * is only set when there is none.
 */
(function (root) {
  'use strict';

  const BUSINESS = {
    name: 'Demo Store',
    address: 'Belmopan, Cayo District, Belize',
    phone: '822-0000',
    email: 'demo@example.com',
    gstTin: '000123456',
  };
  const GST_RATE_BP = 1250; // 12.5%

  // priceCents are GST-exclusive.
  const PRODUCTS = [
    { name: 'Rice 25lb', unit: 'bag', priceCents: 2750, zeroRated: true },
    { name: 'Red kidney beans 4lb', unit: 'bag', priceCents: 1200, zeroRated: true },
    { name: 'Eggs (dozen)', unit: 'dozen', priceCents: 600, zeroRated: true },
    { name: 'Pizza', unit: 'each', priceCents: 500, zeroRated: false },
    { name: 'Soft drink 20oz', unit: 'each', priceCents: 250, zeroRated: false },
    { name: 'Delivery fee', unit: 'trip', priceCents: 1000, zeroRated: false },
  ];

  const CUSTOMERS = [
    { name: 'brandon Morgan', phone: '615-0551', email: '', address: '', tin: '' },
    { name: 'Eldon', phone: '610-0551', email: '', address: '', tin: '' },
    { name: 'Kimley Jone', phone: '622-9887', email: '', address: '', tin: '' },
    { name: 'Belmopan Hardware Ltd', phone: '822-1234', email: 'accounts@example.com',
      address: 'Constitution Drive, Belmopan', tin: '000654321' },
  ];

  const key = (name) => String(name || '').trim().toLowerCase();

  /**
   * Work out what to add, given what is already stored.
   * Returns { business, gstRateBp, products, customers, skippedProducts, skippedCustomers }:
   *   business   merged business details (existing non-empty fields win), or null if unchanged
   *   gstRateBp  1250 if no rate is stored, else null (keep the existing rate)
   *   products / customers  records to add (without id/timestamps)
   */
  function plan({ settings, products, customers }) {
    const current = (settings && settings.business) || {};
    const business = { ...current };
    let changed = false;
    for (const [field, value] of Object.entries(BUSINESS)) {
      if (!String(current[field] || '').trim()) { business[field] = value; changed = true; }
    }
    const rate = settings && settings.gstRateBp;
    const haveP = new Set((products || []).map((p) => key(p.name)));
    const haveC = new Set((customers || []).map((c) => key(c.name)));
    const addP = PRODUCTS.filter((p) => !haveP.has(key(p.name)));
    const addC = CUSTOMERS.filter((c) => !haveC.has(key(c.name)));
    return {
      business: changed ? business : null,
      gstRateBp: Number.isInteger(rate) ? null : GST_RATE_BP,
      products: addP.map((p) => ({ ...p })),
      customers: addC.map((c) => ({ ...c })),
      skippedProducts: PRODUCTS.length - addP.length,
      skippedCustomers: CUSTOMERS.length - addC.length,
    };
  }

  /** Load the demo data into IndexedDB. Returns the plan that was applied. */
  async function load() {
    const db = root.db;
    const [settings, products, customers] = await Promise.all([
      db.getSettings(), db.getAll('products'), db.getAll('customers'),
    ]);
    const p = plan({ settings, products, customers });
    const now = new Date().toISOString();
    const values = {};
    if (p.business) values.business = p.business;
    if (p.gstRateBp !== null) values.gstRateBp = p.gstRateBp;
    if (Object.keys(values).length) await db.setSettings(values);
    for (const r of p.products) await db.put('products', { ...r, createdAt: now, updatedAt: now });
    for (const r of p.customers) await db.put('customers', { ...r, createdAt: now, updatedAt: now });
    return p;
  }

  const api = { BUSINESS, GST_RATE_BP, PRODUCTS, CUSTOMERS, plan, load };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.demo = api;
})(typeof window !== 'undefined' ? window : globalThis);
