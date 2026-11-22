/*
 * stats.js: Stats tab maths (Phase 6). Pure functions, no DOM, no IndexedDB, no storage.
 * Depends on money.js, receipt.js, filter.js and summary.js. Rendering lives in js/stats-ui.js and js/views/stats.js.
 * Tested by tests/stats.cases.js (run in Node by tests/stats.test.js, in a browser by tests/stats.test.html).
 *
 * Ranges are { preset, from, to }: local Dates, `from` inclusive, `to` exclusive (the local midnight
 * after the last day), the same shape filter.dateRange and summary.summarize use. So the last day runs
 * to 23:59:59.999 and the next day's 00:00:00 is out. Weeks start on Monday. Local time is the
 * device's (America/Belize for real users).
 *
 * Sales figures reuse summary.summarize (Phase 5): sums of each receipt's stored, already-rounded
 * values, so stats always match the receipt PDFs. Quotes, voided and cancelled receipts never count.
 */
(function (root) {
  'use strict';

  const isNode = typeof module !== 'undefined' && module.exports;
  const money = isNode ? require('./money.js') : root.money;
  const filter = isNode ? require('./filter.js') : root.filter;
  const summary = isNode ? require('./summary.js') : root.summary;
  const receipt = isNode ? require('./receipt.js') : root.receipt;

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Range presets, in picker order. Labels stay short: three per row on phones. */
  const PRESETS = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'lastMonth', label: 'Last month' },
    { id: 'last90', label: '90 days' },
    { id: 'custom', label: 'Custom' },
  ];
  const DEFAULT_PRESET = 'month';

  /** Trend sections need this many counted receipts before they mean anything. */
  const MIN_RECEIPTS = 5;

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  // Speed (2,000 receipts on a phone): each record's date is parsed once and cached, and every calculation
  // first narrows the records to its own range, so summary.summarize only ever sees that range's receipts.
  // Kept on the record under a Symbol (not enumerable, never saved: db.getAll returns fresh copies each time).
  // A WeakMap made garbage collection slow with thousands of records per visit.
  const TIME = typeof Symbol === 'function' ? Symbol('statsTime') : '__statsTime';
  /** A record's date in ms, parsed once. */
  function timeOf(r) {
    let t = r[TIME];
    if (t === undefined) {   // copies ({ ...r, date }) don't carry it, so a changed date is always re-parsed
      t = new Date(r.date).getTime();
      try { Object.defineProperty(r, TIME, { value: t, configurable: true, writable: true }); } catch { return t; }
    }
    return t;
  }
  /** The records dated inside the range (from inclusive, to exclusive). */
  function within(records, range) {
    const from = range.from ? range.from.getTime() : -Infinity;
    const to = range.to ? range.to.getTime() : Infinity;
    return (records || []).filter((r) => { if (!r) return false; const t = timeOf(r); return t >= from && t < to; });
  }
  /** summary.summarize on just the range's records (same result, much less work). */
  const summarizeRange = (records, range) => summary.summarize(within(records, range), range);
  /** Counted receipts (summary.counts), oldest first. */
  function countedByDate(records) {
    const out = (records || []).filter(summary.counts);
    for (let i = 1; i < out.length; i++) {
      if (timeOf(out[i - 1]) > timeOf(out[i])) return out.sort((a, b) => (timeOf(a) - timeOf(b)) || ((a.id || 0) - (b.id || 0)));
    }
    return out;
  }
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  /**
   * Range for a preset at `now`. custom = { from, to } as "YYYY-MM-DD", both inclusive.
   * Returns null for an unknown preset or an incomplete/backwards custom range.
   *   today      today
   *   week       Monday to Sunday of this week
   *   month      1st to last day of this month
   *   lastMonth  1st to last day of last month
   *   last90     today and the 89 days before it
   */
  function getRange(preset, now = new Date(), custom = {}) {
    const today = startOfDay(now);
    let from, to;
    switch (preset) {
      case 'today':
      case 'week':
      case 'month':
        ({ from, to } = filter.dateRange(preset, now));
        break;
      case 'lastMonth':
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'last90':
        from = addDays(today, -89);
        to = addDays(today, 1);
        break;
      case 'custom': {
        const f = filter.parseDay(custom && custom.from);
        const t = filter.parseDay(custom && custom.to);
        if (!f || !t || t < f) return null;
        from = f;
        to = addDays(t, 1);
        break;
      }
      default:
        return null;
    }
    return { preset, from, to };
  }

  /** Whole calendar days in a range. */
  function dayCount(range) {
    return Math.round((range.to - range.from) / DAY_MS);
  }

  function isWholeMonths(range) {
    return range.from.getDate() === 1 && range.to.getDate() === 1
      && range.from.getHours() === 0 && range.to.getHours() === 0;
  }

  /**
   * The period just before `range`, of the same kind: whole calendar months go back the same number
   * of months (March -> February, whatever their lengths); anything else goes back the same number of days.
   */
  function previousRange(range) {
    if (isWholeMonths(range)) {
      const months = (range.to.getFullYear() - range.from.getFullYear()) * 12 + range.to.getMonth() - range.from.getMonth();
      return { preset: range.preset, from: new Date(range.from.getFullYear(), range.from.getMonth() - months, 1), to: new Date(range.from) };
    }
    return { preset: range.preset, from: addDays(range.from, -dayCount(range)), to: new Date(range.from) };
  }

  /** Is `date` (Date, ISO string or ms) inside the range? from inclusive, to exclusive. */
  function inRange(date, range) {
    if (!range) return false;
    const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
    return !Number.isNaN(t) && t >= range.from.getTime() && t < range.to.getTime();
  }

  /** "12.50", "$1,234.5" or 12.5 -> integer cents. null if not a valid amount (more than 2 decimals included). */
  function toCents(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? money.parseCents(String(value), { allowNegative: true }) : null;
    return money.parseCents(value, { allowNegative: true });
  }

  /** Integer cents -> "$1,234.56", the app's money format (money.formatCents). */
  function formatBZD(cents) {
    return money.formatCents(cents);
  }

  const dayText = (d, withYear = true) => d.getDate() + ' ' + MONTHS[d.getMonth()] + (withYear ? ' ' + d.getFullYear() : '');

  /** "21 Nov 2026", "1 – 30 Nov 2026", "28 Oct – 3 Nov 2026", "29 Dec 2025 – 4 Jan 2026". */
  function rangeLabel(range) {
    if (!range) return '';
    const a = range.from;
    const b = addDays(range.to, -1);
    if (a.getTime() === b.getTime()) return dayText(a);
    if (a.getFullYear() !== b.getFullYear()) return dayText(a) + ' – ' + dayText(b);
    if (a.getMonth() !== b.getMonth()) return dayText(a, false) + ' – ' + dayText(b);
    return a.getDate() + ' – ' + dayText(b);
  }

  /**
   * The remembered picker choice (a JSON string from storage, or anything else) -> { preset, custom }.
   * Falls back to the default for missing, broken or unknown values.
   */
  function parseSavedChoice(saved) {
    const fallback = { preset: DEFAULT_PRESET, custom: { from: '', to: '' } };
    let v;
    try { v = typeof saved === 'string' ? JSON.parse(saved) : saved; } catch { return fallback; }
    if (!v || typeof v !== 'object' || !PRESETS.some((p) => p.id === v.preset)) return fallback;
    const c = v.custom && typeof v.custom === 'object' ? v.custom : {};
    return {
      preset: v.preset,
      custom: { from: filter.parseDay(c.from) ? c.from : '', to: filter.parseDay(c.to) ? c.to : '' },
    };
  }

  // ---- Step 1: monthly GST summary ----

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
    'October', 'November', 'December'];

  /** Local Date -> "2026-10". */
  function monthKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  /** "2026-10" -> { preset: 'month', from: 1 Oct 00:00, to: 1 Nov 00:00 }, or null if invalid. */
  function monthRange(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(key || '');
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
    const y = Number(m[1]), mo = Number(m[2]) - 1;
    return { preset: 'month', from: new Date(y, mo, 1), to: new Date(y, mo + 1, 1) };
  }

  /** "2026-10" -> "October 2026". */
  function monthLabel(key) {
    const r = monthRange(key);
    return r ? MONTH_NAMES[r.from.getMonth()] + ' ' + r.from.getFullYear() : '';
  }

  /** The month being filed by default: last month. */
  function defaultGstMonth(now = new Date()) {
    return monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }

  /**
   * Months for the GST month picker, newest first: from the month of the oldest counted receipt
   * (or last month, if that is earlier) up to this month.
   */
  function gstMonths(records, now = new Date()) {
    let oldest = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    for (const r of records || []) {
      if (!summary.counts(r)) continue;
      const d = new Date(r.date);
      if (d < oldest) oldest = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const out = [];
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d >= oldest; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
      out.push(monthKey(d));
    }
    return out;
  }

  const customerText = (r) => (r.customer && (r.customer.name || r.customer.phone)) || 'Walk-in';

  /**
   * GST summary for one calendar month ("YYYY-MM"). Everything is a sum of each receipt's stored values,
   * so every receipt keeps the GST rate it was issued at (never the current setting) and the figures
   * match the receipt PDFs to the cent. Quotes, voided and cancelled receipts are left out.
   * Returns summary.summarize's result plus:
   *   month, label, range,
   *   rows: [{ date: "YYYY-MM-DD", number, customer, gstRateBp, taxableCents, zeroRatedCents, gstCents, totalCents }]  oldest first
   * Gross sales = totalCents, taxable sales (excl. GST) = taxableCents, zero-rated = zeroRatedCents.
   */
  function gstSummary(records, key) {
    const range = monthRange(key);
    if (!range) throw new Error('Invalid month: ' + key);
    const s = summarizeRange(records, range);
    return {
      ...s,
      month: key,
      label: monthLabel(key),
      range,
      rows: s.receipts.map((r) => ({
        date: filter.dayString(new Date(r.date)),
        number: r.number,
        customer: customerText(r),
        gstRateBp: r.gstRateBp,
        taxableCents: r.taxableCents,
        zeroRatedCents: r.zeroRatedCents,
        gstCents: r.gstCents,
        totalCents: r.totalCents,
      })),
    };
  }

  /** 123456 -> "1234.56" (plain number for spreadsheets: no $ and no thousands separator). */
  function plainAmount(cents) {
    const a = Math.abs(cents);
    return (cents < 0 ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
  }

  /** One CSV field: quoted when needed; text starting with = + - @ gets a ' so spreadsheets never run it as a formula. */
  function csvField(value) {
    let s = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_HEADER = ['Date', 'Receipt no.', 'Customer', 'Taxable (excl. GST)', 'Zero-rated', 'GST', 'Total'];

  /**
   * CSV for a gstSummary(): a header, one row per receipt, then a totals row. Starts with a UTF-8 BOM
   * so Excel reads accents correctly; CRLF line ends. Amounts are plain numbers in dollars ("12.50").
   */
  function gstCsv(s) {
    const lines = [CSV_HEADER];
    for (const r of s.rows) {
      lines.push([r.date, r.number, r.customer, plainAmount(r.taxableCents), plainAmount(r.zeroRatedCents),
        plainAmount(r.gstCents), plainAmount(r.totalCents)]);
    }
    lines.push(['Total', s.count + (s.count === 1 ? ' receipt' : ' receipts'), '', plainAmount(s.taxableCents),
      plainAmount(s.zeroRatedCents), plainAmount(s.gstCents), plainAmount(s.totalCents)]);
    return '﻿' + lines.map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n';
  }

  /** "gst-summary-2026-10.csv" / ".pdf" */
  function gstFileName(s, ext) {
    return 'gst-summary-' + s.month + '.' + ext;
  }

  // ---- Step 2: sales at a glance ----

  /** The same wall-clock time `days` days earlier (calendar days, safe across DST changes). */
  const shiftDays = (d, days) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days,
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

  const GLANCE = [
    { id: 'today', label: 'Today', vs: 'yesterday' },
    { id: 'week', label: 'This week', vs: 'last week' },
    { id: 'month', label: 'This month', vs: 'last month' },
  ];

  /**
   * Period so far, and the previous period of the same type up to the same point, so a tile never
   * compares part of a period with the whole of the last one:
   *   today  00:00 -> now          vs yesterday 00:00 -> the same time yesterday
   *   week   Monday 00:00 -> now   vs last Monday 00:00 -> the same moment 7 days ago
   *   month  1st 00:00 -> now      vs last month's 1st -> the same day and time (capped at last month's end,
   *                                   so 31 March compares with all of February)
   * Ranges are { from, to } with `to` exclusive; `to` is 1 ms after now so a receipt saved this instant counts.
   */
  function periodToDate(kind, now = new Date()) {
    const end = new Date(now.getTime() + 1);
    const from = getRange(kind, now).from;
    let prevFrom, prevTo;
    if (kind === 'today') {
      prevFrom = addDays(from, -1);
      prevTo = shiftDays(end, -1);
    } else if (kind === 'week') {
      prevFrom = addDays(from, -7);
      prevTo = shiftDays(end, -7);
    } else if (kind === 'month') {
      prevFrom = new Date(from.getFullYear(), from.getMonth() - 1, 1);
      prevTo = new Date(from.getFullYear(), from.getMonth() - 1, end.getDate(),
        end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds());
      if (prevTo > from) prevTo = new Date(from);   // the day doesn't exist last month (e.g. 31 Feb)
    } else {
      throw new Error('Unknown period: ' + kind);
    }
    return { current: { from, to: end }, previous: { from: prevFrom, to: prevTo } };
  }

  /** Average receipt value in cents (rounded half away from zero); 0 when there are no receipts. */
  function averageCents(totalCents, count) {
    return count > 0 ? money.roundDiv(totalCents, count) : 0;
  }

  /**
   * Change from `previous` to `current` (cents):
   *   { kind: 'up' | 'down', pct }  pct = whole percent, rounded (never 0: a change under 0.5% shows as flat)
   *   { kind: 'flat', pct: 0 }      the same (or within 0.5%)
   *   { kind: 'new', pct: null }    nothing last time, something now
   *   { kind: 'none', pct: null }   nothing either time
   * Never divides by zero.
   */
  function percentChange(current, previous) {
    if (!previous) return current > 0 ? { kind: 'new', pct: null } : { kind: 'none', pct: null };
    const pct = Math.round(Math.abs(current - previous) * 100 / previous);
    if (pct === 0) return { kind: 'flat', pct: 0 };
    return { kind: current > previous ? 'up' : 'down', pct };
  }

  /** "↑ 12% vs last week", "↓ 5% vs yesterday", "Same as last month", "New vs last week", "No sales yet". */
  function changeText(change, vs) {
    switch (change.kind) {
      case 'up': return '↑ ' + change.pct + '% vs ' + vs;
      case 'down': return '↓ ' + change.pct + '% vs ' + vs;
      case 'flat': return 'Same as ' + vs;
      case 'new': return 'New · nothing ' + vs;
      default: return 'No sales yet';
    }
  }

  function totalsFor(records, range) {
    const s = summarizeRange(records, range);
    return { count: s.count, totalCents: s.totalCents, averageCents: averageCents(s.totalCents, s.count) };
  }

  /**
   * The three fixed tiles (they ignore the range picker):
   * [{ id, label, vs, current: { count, totalCents, averageCents }, previous: {...}, change, text }]
   */
  function glance(records, now = new Date()) {
    return GLANCE.map((g) => {
      const p = periodToDate(g.id, now);
      const current = totalsFor(records, p.current);
      const previous = totalsFor(records, p.previous);
      const change = percentChange(current.totalCents, previous.totalCents);
      return { ...g, current, previous, change, text: changeText(change, g.vs) };
    });
  }

  // ---- Step 3: top products and slow movers ----

  /** " COKE  500ML " -> "coke 500ml": trimmed, lowercase, repeated spaces collapsed. Groups free-text items. */
  function normalizeName(name) {
    return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  const byName = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

  /**
   * Top items sold in `range` (counted receipts only), grouped by normalizeName(description).
   * opts = { by: 'revenue' | 'quantity', limit = 10, products = saved products }
   * Revenue is the lines' net value (excl. GST, as stored on each line). Ties go alphabetically.
   * The name shown is the saved product's name when one matches, else the spelling used most often
   * (ties: the first one sold).
   * Returns { items: [{ key, name, netCents, qtyMilli, receipts }], count } where count = distinct items in range.
   */
  function topProducts(records, range, { by = 'revenue', limit = 10, products = [] } = {}) {
    const saved = new Map(products.map((p) => [normalizeName(p.name), p.name]));
    const groups = new Map();
    for (const r of summarizeRange(records, range).receipts) {
      const seen = new Set();
      for (const l of r.lines || []) {
        const key = normalizeName(l.description);
        if (!key) continue;
        let g = groups.get(key);
        if (!g) groups.set(key, g = { key, netCents: 0, qtyMilli: 0, receipts: 0, spellings: new Map() });
        g.netCents += l.netCents;
        g.qtyMilli += l.qtyMilli;
        if (!seen.has(key)) { g.receipts++; seen.add(key); }
        const spelling = String(l.description).trim().replace(/\s+/g, ' ');
        g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);
      }
    }
    const metric = by === 'quantity' ? 'qtyMilli' : 'netCents';
    const items = [...groups.values()].map((g) => {
      let name = saved.get(g.key);
      if (!name) {
        let best = 0;
        for (const [s, n] of g.spellings) if (n > best) { best = n; name = s; }   // Map keeps first-sold order for ties
      }
      return { key: g.key, name, netCents: g.netCents, qtyMilli: g.qtyMilli, receipts: g.receipts };
    }).sort((a, b) => (b[metric] - a[metric]) || byName(a, b));
    return { items: items.slice(0, limit), count: items.length };
  }

  /** Whole calendar days from `date` to `now` (0 = today). */
  function daysAgo(date, now = new Date()) {
    return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  }

  /**
   * Saved products with no sale in the last `days` days (today and the days-1 before it), matched to receipt
   * lines by normalizeName. Never-sold products first, then the oldest last sale first; ties alphabetically.
   * Returns [{ id, name, lastSale: Date | null }]. Quotes, voided and cancelled receipts are not sales.
   */
  function slowMovers(records, products, now = new Date(), days = 30) {
    const since = addDays(startOfDay(now), -(days - 1));
    const last = new Map();
    for (const r of records || []) {
      if (!summary.counts(r)) continue;
      const t = timeOf(r);
      if (t > now.getTime()) continue;
      for (const l of r.lines || []) {
        const key = normalizeName(l.description);
        if (key && !(last.get(key) >= t)) last.set(key, t);
      }
    }
    return (products || [])
      .map((p) => {
        const ms = last.get(normalizeName(p.name));
        return { id: p.id, name: p.name, key: normalizeName(p.name), lastSale: ms == null ? null : new Date(ms) };
      })
      .filter((p) => p.key && !(p.lastSale && p.lastSale >= since))
      .sort((a, b) => ((a.lastSale ? a.lastSale.getTime() : -Infinity) - (b.lastSale ? b.lastSale.getTime() : -Infinity)) || byName(a, b))
      .map(({ id, name, lastSale }) => ({ id, name, lastSale }));
  }

  // ---- Step 4: top customers ----

  /**
   * Phone -> WhatsApp number (digits with country code): spaces, dashes, "+" and a leading 00 go;
   * 7-digit Belize numbers get 501. "622-1234" and "+501 622 1234" -> "5016221234". '' if unusable.
   * Same rule as receipt sharing (receipt.whatsappNumber).
   */
  function waNumber(phone) {
    return receipt.whatsappNumber(phone);
  }

  /** "https://wa.me/5016221234", or '' when there is no usable number. */
  function waLink(phone) {
    const n = waNumber(phone);
    return n ? 'https://wa.me/' + n : '';
  }

  /**
   * Group counted receipts (oldest first) by customer: by phone first (waNumber, so any formatting
   * matches), then by name (normalizeName). A receipt with only a name joins the phone group that
   * used the same name. Walk-ins (no name, no phone) get no group.
   * Returns Map(receipt -> key).
   */
  function customerKeys(receipts) {
    const keys = new Map();
    const nameToKey = new Map();
    for (const r of receipts) {
      const c = r.customer || {};
      const phone = waNumber(c.phone);
      if (!phone) continue;
      const key = 'p:' + phone;
      keys.set(r, key);
      const name = normalizeName(c.name);
      if (name && !nameToKey.has(name)) nameToKey.set(name, key);
    }
    for (const r of receipts) {
      if (keys.has(r)) continue;
      const name = normalizeName(r.customer && r.customer.name);
      if (name) keys.set(r, nameToKey.get(name) || 'n:' + name);
    }
    return keys;
  }

  /**
   * Top named customers by spend (incl. GST) in `range`, plus the walk-in total and repeat vs one-time.
   * opts = { limit = 10, customers = saved customers (phone fallback by name), now }
   * Returns {
   *   items: [{ key, name, phone, waNumber, totalCents, count, lastPurchase }]   ties by name;
   *          name/phone = the latest used (phone falls back to the saved customer); lastPurchase = latest ever (up to now)
   *   count:  named customers who bought in the range,
   *   walkIn: { count, totalCents }   receipts with no name and no phone: never ranked, never in repeat counts
   *   repeat: { repeat, oneTime, total, repeatPct, oneTimePct }  of the range's named customers, "repeat" = 2+ receipts
   *           ever (up to the end of the range); percentages are whole numbers adding up to 100, null when total = 0
   * }
   */
  function topCustomers(records, range, { limit = 10, customers = [], now = new Date() } = {}) {
    const all = countedByDate(records);
    const keys = customerKeys(all);
    const savedPhone = new Map();
    for (const c of customers) {
      const n = normalizeName(c.name);
      if (n && waNumber(c.phone) && !savedPhone.has(n)) savedPhone.set(n, c.phone);
    }
    const groups = new Map();
    const walkIn = { count: 0, totalCents: 0 };
    for (const r of all) {
      const t = timeOf(r);   // ms
      const key = keys.get(r);
      const inside = inRange(t, range);
      if (!key) {
        if (inside) { walkIn.count++; walkIn.totalCents += r.totalCents; }
        continue;
      }
      let g = groups.get(key);
      if (!g) groups.set(key, g = { key, name: '', phone: '', totalCents: 0, count: 0, everCount: 0, lastPurchase: null });
      const c = r.customer || {};
      if (t <= now.getTime()) {
        if (String(c.name || '').trim()) g.name = String(c.name).trim().replace(/\s+/g, ' ');
        if (waNumber(c.phone)) g.phone = c.phone;
        g.lastPurchase = t;
      }
      if (t < range.to.getTime()) g.everCount++;
      if (inside) { g.totalCents += r.totalCents; g.count++; }
    }
    const active = [...groups.values()].filter((g) => g.count > 0);
    const items = active.map((g) => {
      const name = g.name || g.phone;
      const phone = g.phone || savedPhone.get(normalizeName(g.name)) || '';
      return { key: g.key, name, phone, waNumber: waNumber(phone), totalCents: g.totalCents, count: g.count,
        lastPurchase: g.lastPurchase == null ? null : new Date(g.lastPurchase) };
    }).sort((a, b) => (b.totalCents - a.totalCents) || byName({ key: normalizeName(a.name) }, { key: normalizeName(b.name) }));
    const repeat = active.filter((g) => g.everCount >= 2).length;
    const total = active.length;
    const repeatPct = total ? Math.round(repeat * 100 / total) : null;
    return {
      items: items.slice(0, limit),
      count: total,
      walkIn,
      repeat: { repeat, oneTime: total - repeat, total, repeatPct, oneTimePct: total ? 100 - repeatPct : null },
    };
  }

  // ---- Step 5: sales trend and busiest days ----

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKLY_AFTER_DAYS = 90;
  const weekdayIndex = (d) => (d.getDay() + 6) % 7;   // Mon = 0 ... Sun = 6

  /** The range cut off at the end of today: days that haven't happened yet are never plotted or averaged. */
  function plotRange(range, now = new Date()) {
    const end = addDays(startOfDay(now), 1);
    const to = range.to > end ? end : range.to;
    return { from: range.from, to: to < range.from ? new Date(range.from) : to };
  }

  /**
   * Sales (incl. GST) over time for a chart, zero-filled: one point per day, or per week (Monday start)
   * when the range is longer than 90 days. Days after today are left out.
   * Returns { unit: 'day' | 'week', points: [{ from: Date, totalCents, count }] }
   * (a week's `from` is its Monday, or the range start for a first partial week).
   */
  function salesSeries(records, range, now = new Date()) {
    const r = plotRange(range, now);
    const days = dayCount(r);
    const daily = Array.from({ length: days }, (_, i) => ({ from: addDays(r.from, i), totalCents: 0, count: 0 }));
    for (const rec of summarizeRange(records, r).receipts) {
      const p = daily[Math.round((startOfDay(new Date(timeOf(rec))) - r.from) / DAY_MS)];
      p.totalCents += rec.totalCents;
      p.count++;
    }
    if (dayCount(range) <= WEEKLY_AFTER_DAYS) return { unit: 'day', points: daily };
    const weeks = [];
    for (const p of daily) {
      const last = weeks[weeks.length - 1];
      if (!last || weekdayIndex(p.from) === 0) weeks.push({ from: p.from, totalCents: p.totalCents, count: p.count });
      else { last.totalCents += p.totalCents; last.count += p.count; }
    }
    return { unit: 'week', points: weeks };
  }

  /**
   * Average sales (incl. GST) per weekday, Monday to Sunday: the weekday's total divided by how many
   * times that weekday occurs in the range (up to today), so a range with five Fridays and four Mondays
   * doesn't favour Friday. averageCents is 0 for a weekday that doesn't occur.
   * Returns [{ day: 'Mon', totalCents, days, averageCents }] x 7.
   */
  function weekdayAverages(records, range, now = new Date()) {
    const r = plotRange(range, now);
    const out = WEEKDAYS.map((day) => ({ day, totalCents: 0, days: 0, averageCents: 0 }));
    for (let i = 0, n = dayCount(r); i < n; i++) out[weekdayIndex(addDays(r.from, i))].days++;
    for (const rec of summarizeRange(records, r).receipts) out[weekdayIndex(new Date(timeOf(rec)))].totalCents += rec.totalCents;
    for (const w of out) w.averageCents = averageCents(w.totalCents, w.days);
    return out;
  }

  /** Chart labels: short for the axis ("21 Nov"), long for tooltips ("Sat 21 Nov 2026", "Week of 16 Nov 2026"). */
  function seriesLabels(series) {
    return series.points.map((p) => ({
      short: dayText(p.from, false),
      long: (series.unit === 'week' ? 'Week of ' : WEEKDAYS[weekdayIndex(p.from)] + ' ') + dayText(p.from),
    }));
  }

  /** Axis tick: "$1,200" for whole dollars, "$12.50" otherwise. */
  function axisMoney(cents) {
    const c = Math.round(cents);
    const s = formatBZD(c);
    return c % 100 === 0 ? s.slice(0, -3) : s;
  }

  // ---- Step 6: quote conversion ----
  //
  // A quote links to the receipt it became since quotes were added (Phase 4): db.saveConvertedReceipt sets
  // receiptId / receiptNumber / convertedAt on the quote in the same transaction that saves the receipt, and
  // backups carry those fields. So there are no "unknown" legacy quotes: every quote is open, expired,
  // converted or cancelled (quote.status).

  // quote.js loads after this file in index.html, so look it up when first used.
  const quoteApi = () => (isNode ? require('./quote.js') : root.quote);

  /**
   * Quote figures for quotes dated in `range`:
   * { sent, converted, cancelled, open, expired, ratePct, openValueCents }
   * ratePct = converted / sent as a whole percent, null when no quotes were sent (show "—").
   * openValueCents = total of the quotes still Open (not expired). Statuses are computed at `now`.
   */
  function quoteStats(quotes, range, now = new Date()) {
    const out = { sent: 0, converted: 0, cancelled: 0, open: 0, expired: 0, ratePct: null, openValueCents: 0 };
    for (const q of quotes || []) {
      if (!q || !inRange(q.date, range)) continue;
      out.sent++;
      const s = quoteApi().status(q, now);
      out[s]++;
      if (s === 'open') out.openValueCents += q.totalCents;
    }
    if (out.sent) out.ratePct = Math.round(out.converted * 100 / out.sent);
    return out;
  }

  /** WhatsApp follow-up text for a quote. */
  function followUpText(q, businessName) {
    const name = String((q.customer && q.customer.name) || '').trim().split(/\s+/)[0];
    return 'Hi' + (name ? ' ' + name : '') + ', just following up on quotation ' + q.number
      + ' for ' + formatBZD(q.totalCents) + (businessName ? ' from ' + businessName : '')
      + '. Would you like to go ahead? Happy to answer any questions.';
  }

  /**
   * Quotes to follow up: every Open quote (whatever the range), oldest first. Converted, cancelled and
   * expired quotes are not listed (count expired ones with expiredCount).
   * Returns [{ id, number, customer, phone, totalCents, ageDays, status, waUrl }]; waUrl is '' without a phone.
   */
  function followUps(quotes, { now = new Date(), businessName = '' } = {}) {
    const Q = quoteApi();
    return (quotes || [])
      .filter((q) => q && new Date(q.date) <= now && Q.status(q, now) === 'open')
      .sort((a, b) => (new Date(a.date) - new Date(b.date)) || String(a.number).localeCompare(String(b.number)))
      .map((q) => {
        const c = q.customer || {};
        const phone = waNumber(c.phone) ? c.phone : '';
        return {
          id: q.id, number: q.number,
          customer: String(c.name || '').trim() || String(c.phone || '').trim() || 'Walk-in',
          phone, totalCents: q.totalCents,
          ageDays: daysAgo(new Date(q.date), now),
          status: Q.status(q, now),
          waUrl: phone ? receipt.whatsappUrl(phone, followUpText(q, businessName)) : '',
        };
      });
  }

  /** Expired quotes (past their valid-until day, never converted or cancelled); the app can still convert them. */
  function expiredCount(quotes, now = new Date()) {
    return (quotes || []).filter((q) => q && quoteApi().status(q, now) === 'expired').length;
  }

  const api = {
    PRESETS, DEFAULT_PRESET, MIN_RECEIPTS, WEEKDAYS, WEEKLY_AFTER_DAYS,
    quoteStats, followUpText, followUps, expiredCount, summarizeRange,
    plotRange, salesSeries, weekdayAverages, seriesLabels, axisMoney,
    waNumber, waLink, topCustomers,
    normalizeName, topProducts, daysAgo, slowMovers,
    periodToDate, averageCents, percentChange, changeText, glance,
    getRange, previousRange, inRange, dayCount, toCents, formatBZD, rangeLabel, parseSavedChoice,
    monthKey, monthRange, monthLabel, defaultGstMonth, gstMonths, gstSummary, plainAmount, csvField, gstCsv, gstFileName,
  };

  if (isNode) module.exports = api;
  else root.stats = api;
})(typeof window !== 'undefined' ? window : globalThis);
