/*
 * filter.js: History search, date-range and status filters, and list summary.
 * Pure functions, no DOM, no IndexedDB. Unit-tested in tests/filter.test.js.
 *
 * Search matches (case-insensitive):
 *   - receipt number: "0012", "12", "INV-0012", or another prefix like "R-0012" (digits are compared)
 *   - customer name: substring
 *   - customer phone: 3+ digits, ignoring spaces, dashes and a leading +501
 *   - amount: "45" matches totals $45.00-$45.99; "45.5" matches $45.50-$45.59
 */
(function (root) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;

  const PRESETS = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'all', label: 'All' },
    { id: 'custom', label: 'Custom' },
  ];

  const STATUSES = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'voided', label: 'Voided' },
  ];

  const digits = (s) => String(s || '').replace(/\D/g, '');

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /** "2026-11-20" -> local midnight Date, or null. */
  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null;
  }

  /** Local Date -> "2026-11-20" (for <input type="date"> and file names). */
  function dayString(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * Date range for a preset, in local time: { from, to } as Dates, `to` exclusive; null = open.
   * Weeks start on Monday. 'custom' uses fromDay/toDay ("YYYY-MM-DD", both inclusive, either optional).
   */
  function dateRange(preset, now = new Date(), fromDay = '', toDay = '') {
    const today = startOfDay(now);
    const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    switch (preset) {
      case 'today':
        return { from: today, to: addDays(today, 1) };
      case 'week': {
        const monday = addDays(today, -((today.getDay() + 6) % 7));
        return { from: monday, to: addDays(monday, 7) };
      }
      case 'month':
        return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 1) };
      case 'custom': {
        const f = parseDay(fromDay);
        const t = parseDay(toDay);
        return { from: f, to: t ? addDays(t, 1) : null };
      }
      default:
        return { from: null, to: null };
    }
  }

  function inRange(r, { from, to }) {
    const t = new Date(r.date).getTime();
    return (!from || t >= from.getTime()) && (!to || t < to.getTime());
  }

  function matchesStatus(r, status) {
    if (status === 'active') return !r.voided;
    if (status === 'voided') return !!r.voided;
    return true;
  }

  /** Whole-dollar and cents text of an amount: 4550 -> "45.50". */
  function plainAmount(cents) {
    return Math.floor(cents / 100) + '.' + String(cents % 100).padStart(2, '0');
  }

  function matchesAmount(r, q) {
    const s = q.replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{0,2})?$/.test(s)) return false;
    const amount = plainAmount(r.totalCents);
    // Leading zeros ("0012") are receipt numbers, not amounts.
    if (/^0\d/.test(s)) return false;
    if (!s.includes('.')) return amount.split('.')[0] === s;
    return amount.startsWith(s);
  }

  function matchesNumber(r, q) {
    const num = String(r.number || '').toLowerCase();
    if (num.includes(q)) return true;
    // "R-0012", "#12", "12": compare digits only, when the query is just an optional prefix + digits.
    const m = /^[a-z#]*-?(\d+)$/.exec(q);
    return !!m && digits(num).includes(m[1]);
  }

  function matchesPhone(r, q) {
    if (!/^[\d\s+().-]+$/.test(q)) return false;
    let qd = digits(q);
    if (q.trim().startsWith('+501')) qd = qd.slice(3);
    return qd.length >= 3 && digits(r.customer && r.customer.phone).includes(qd);
  }

  function matchesName(r, q) {
    return String((r.customer && r.customer.name) || '').toLowerCase().includes(q);
  }

  /** Does receipt r match the search text? Empty text matches everything. */
  function matchesQuery(r, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return matchesNumber(r, q) || matchesName(r, q) || matchesPhone(r, q) || matchesAmount(r, q);
  }

  /** Newest first: by date, then by id for receipts saved in the same millisecond. */
  function newestFirst(a, b) {
    return (new Date(b.date) - new Date(a.date)) || ((b.id || 0) - (a.id || 0));
  }

  /**
   * Filter and sort receipts.
   * opts = { query, preset, fromDay, toDay, status, now }
   */
  function apply(receipts, opts = {}) {
    const range = dateRange(opts.preset || 'all', opts.now || new Date(), opts.fromDay, opts.toDay);
    return receipts
      .filter((r) => matchesStatus(r, opts.status || 'all') && inRange(r, range) && matchesQuery(r, opts.query))
      .sort(newestFirst);
  }

  /** Count of listed receipts, and the total of the non-voided ones (integer cents). */
  function summarize(list) {
    let totalCents = 0;
    let gstCents = 0;
    let voided = 0;
    for (const r of list) {
      if (r.voided) { voided++; continue; }
      totalCents += r.totalCents;
      gstCents += r.gstCents;
    }
    return { count: list.length, active: list.length - voided, voided, totalCents, gstCents };
  }

  /** True when there are receipts and no backup in the last `days` days. */
  function needsBackup(lastBackupAt, receiptCount, now = new Date(), days = 7) {
    if (!receiptCount) return false;
    if (!lastBackupAt) return true;
    const t = new Date(lastBackupAt).getTime();
    return !(t > 0) || now.getTime() - t > days * DAY_MS;
  }

  const api = {
    PRESETS, STATUSES,
    parseDay, dayString, dateRange, matchesQuery, apply, summarize, needsBackup,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.filter = api;
})(typeof window !== 'undefined' ? window : globalThis);
