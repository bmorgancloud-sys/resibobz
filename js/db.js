/*
 * db.js: small IndexedDB wrapper. The only file that touches IndexedDB.
 * Exposes a global `db` object. All methods return Promises.
 *
 * Money is always stored as integer cents. The GST rate is stored as basis points.
 */
(function () {
  'use strict';

  const DB_NAME = 'resibobz';
  const DB_VERSION = 1;

  const STORES = ['settings', 'products', 'customers', 'receipts', 'quotes'];

  const DEFAULT_SETTINGS = {
    business: { name: '', address: '', phone: '', email: '', gstTin: '' },
    logo: null,               // { dataUrl, format: 'PNG'|'JPEG', width, height } or null
    receiptFooter: 'Thank you for your business!',
    pageSize: 'letter',       // PDF page size: 'letter' | 'a4'
    gstRateBp: 1250,          // 12.5%
    receiptPrefix: 'INV-',
    quotePrefix: 'QT-',
    numberPadding: 4,
    counter_receipt: 0,       // last number issued
    counter_quote: 0,
  };

  let dbPromise = null;

  function upgrade(idb, oldVersion) {
    // Add a new `if (oldVersion < N)` block for each schema change; never edit earlier ones.
    if (oldVersion < 1) {
      idb.createObjectStore('settings', { keyPath: 'key' });

      const products = idb.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
      products.createIndex('name', 'name');

      const customers = idb.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
      customers.createIndex('name', 'name');

      for (const name of ['receipts', 'quotes']) {
        const s = idb.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        s.createIndex('number', 'number', { unique: true });
        s.createIndex('date', 'date');
        s.createIndex('customerId', 'customerId');
      }
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
      req.onsuccess = () => {
        const idb = req.result;
        // Another tab upgraded the schema: close so it can proceed.
        idb.onversionchange = () => { idb.close(); dbPromise = null; };
        resolve(idb);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked: close other ResiboBZ tabs.'));
    }).catch((err) => { dbPromise = null; throw err; });
    return dbPromise;
  }

  function promisify(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  function assertStore(store) {
    if (!STORES.includes(store)) throw new Error('Unknown store: ' + store);
  }

  /** Run fn(objectStore) in a transaction; resolves with fn's request result after commit. */
  async function withStore(store, mode, fn) {
    assertStore(store);
    const idb = await open();
    const tx = idb.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    const value = result instanceof IDBRequest ? promisify(result) : Promise.resolve(result);
    const [v] = await Promise.all([value, txDone(tx)]);
    return v;
  }

  // ---- Generic CRUD ----

  const get = (store, key) => withStore(store, 'readonly', (s) => s.get(key));
  const getAll = (store) => withStore(store, 'readonly', (s) => s.getAll());
  const count = (store) => withStore(store, 'readonly', (s) => s.count());
  /** Insert or update. Returns the record's key (new id for inserts). */
  const put = (store, record) => withStore(store, 'readwrite', (s) => s.put(record));
  const remove = (store, key) => withStore(store, 'readwrite', (s) => s.delete(key));
  const clear = (store) => withStore(store, 'readwrite', (s) => s.clear());

  /** All records whose `indexName` matches `query` (a value or IDBKeyRange). */
  const getAllByIndex = (store, indexName, query) =>
    withStore(store, 'readonly', (s) => s.index(indexName).getAll(query));

  // ---- Settings ----

  async function getSetting(key) {
    const row = await get('settings', key);
    if (row) return row.value;
    return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
      ? structuredClone(DEFAULT_SETTINGS[key])
      : undefined;
  }

  const setSetting = (key, value) => put('settings', { key, value });

  /** Save several settings in one transaction: { key: value, ... }. */
  async function setSettings(values) {
    const idb = await open();
    const tx = idb.transaction('settings', 'readwrite');
    const s = tx.objectStore('settings');
    for (const [key, value] of Object.entries(values)) s.put({ key, value });
    await txDone(tx);
  }

  /** All settings merged over defaults, as a plain object. */
  async function getSettings() {
    const rows = await getAll('settings');
    const out = structuredClone(DEFAULT_SETTINGS);
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Write any missing default settings. Safe to call on every start. */
  async function ensureDefaults() {
    const idb = await open();
    const tx = idb.transaction('settings', 'readwrite');
    const s = tx.objectStore('settings');
    const existing = new Set(await promisify(s.getAllKeys()));
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!existing.has(key)) s.put({ key, value });
    }
    await txDone(tx);
  }

  // ---- Document numbering ----

  /**
   * Atomically take the next number for 'receipt' or 'quote'.
   * Returns e.g. "INV-0001". Numbers are never reused, even if the document is later deleted.
   */
  const DOC_TYPES = {
    receipt: { store: 'receipts', prefixKey: 'receiptPrefix' },
    quote:   { store: 'quotes',   prefixKey: 'quotePrefix' },
  };

  /** Inside an open settings store: increment the counter and return the formatted number. */
  async function takeNumber(settingsStore, type) {
    const { prefixKey } = DOC_TYPES[type];
    const counterKey = 'counter_' + type;
    const [counterRow, prefixRow, padRow] = await Promise.all([
      promisify(settingsStore.get(counterKey)),
      promisify(settingsStore.get(prefixKey)),
      promisify(settingsStore.get('numberPadding')),
    ]);
    const n = (counterRow ? counterRow.value : 0) + 1;
    const prefix = prefixRow ? prefixRow.value : DEFAULT_SETTINGS[prefixKey];
    const pad = padRow ? padRow.value : DEFAULT_SETTINGS.numberPadding;
    settingsStore.put({ key: counterKey, value: n });
    return prefix + String(n).padStart(pad, '0');
  }

  function assertDocType(type) {
    if (!DOC_TYPES[type]) throw new Error('Unknown document type: ' + type);
  }

  /**
   * Atomically take the next number for 'receipt' or 'quote'.
   * Returns e.g. "INV-0001". Numbers are never reused, even if the document is later deleted.
   */
  async function nextNumber(type) {
    assertDocType(type);
    const idb = await open();
    const tx = idb.transaction('settings', 'readwrite');
    const number = await takeNumber(tx.objectStore('settings'), type);
    await txDone(tx);
    return number;
  }

  /**
   * Number and save a new receipt/quote in ONE transaction, so a failed save never burns a number.
   * Returns the saved record (with id and number).
   */
  async function saveNewDocument(type, record) {
    assertDocType(type);
    const { store } = DOC_TYPES[type];
    const idb = await open();
    const tx = idb.transaction(['settings', store], 'readwrite');
    const number = await takeNumber(tx.objectStore('settings'), type);
    const doc = { ...record, number };
    delete doc.id;
    const id = await promisify(tx.objectStore(store).add(doc));
    await txDone(tx);
    return { ...doc, id };
  }

  // ---- Backup ----

  /** Dump every store to a plain object (for export/backup). */
  async function exportAll() {
    const out = { app: 'ResiboBZ', dbVersion: DB_VERSION, exportedAt: new Date().toISOString() };
    for (const store of STORES) out[store] = await getAll(store);
    return out;
  }

  window.db = {
    STORES,
    DEFAULT_SETTINGS,
    open,
    get, getAll, getAllByIndex, count, put, remove, clear,
    getSetting, setSetting, setSettings, getSettings, ensureDefaults,
    nextNumber, saveNewDocument,
    exportAll,
  };
})();
