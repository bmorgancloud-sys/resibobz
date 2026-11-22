/*
 * money.js: integer-cents money, quantity and GST helpers. Pure functions, no DOM.
 *
 *   money amounts  -> integer cents          ($12.50  = 1250)
 *   quantities     -> integer thousandths    (1.5     = 1500)
 *   GST rate       -> integer basis points   (12.5%   = 1250)
 *
 * Rounding: half away from zero, applied once per line (net, then GST).
 * Totals are sums of rounded line values, so the receipt always adds up.
 */
(function (root) {
  'use strict';

  function assertSafe(n, what) {
    if (!Number.isSafeInteger(n)) throw new RangeError(what + ' is out of range');
    return n;
  }

  /** Integer division rounded half away from zero. d must be a positive integer. */
  function roundDiv(n, d) {
    assertSafe(n, 'Amount');
    const sign = n < 0 ? -1 : 1;
    return sign * Math.floor((Math.abs(n) + Math.floor(d / 2)) / d);
  }

  /** Parse "12", "12.5", "$1,234.50" into an integer scaled by 10^places. Returns null if invalid. */
  function parseScaled(input, places, allowNegative) {
    if (input == null) return null;
    const s = String(input).trim().replace(/[$,\s]/g, '');
    const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
    if (!m) return null;
    const [, neg, whole, frac = ''] = m;
    if (whole === '' && frac === '') return null;
    if (frac.length > places) return null;
    if (neg && !allowNegative) return null;
    const scale = 10 ** places;
    const value = Number(whole || '0') * scale + Number(frac.padEnd(places, '0') || '0');
    if (!Number.isSafeInteger(value)) return null;
    return neg ? -value : value;
  }

  function groupThousands(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---- Money ----

  /** "$1,234.50" -> 123450. Up to 2 decimals. Returns null if invalid. */
  function parseCents(input, { allowNegative = false } = {}) {
    return parseScaled(input, 2, allowNegative);
  }

  /** 123450 -> "$1,234.50", -500 -> "-$5.00" */
  function formatCents(cents) {
    assertSafe(cents, 'Amount');
    const a = Math.abs(cents);
    const dollars = groupThousands(String(Math.floor(a / 100)));
    const c = String(a % 100).padStart(2, '0');
    return (cents < 0 ? '-$' : '$') + dollars + '.' + c;
  }

  /** 123450 -> "1234.50" (for prefilling inputs) */
  function centsToInput(cents) {
    assertSafe(cents, 'Amount');
    const a = Math.abs(cents);
    return (cents < 0 ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
  }

  // ---- Quantity ----

  /** "1.5" -> 1500. Up to 3 decimals, must be > 0. Returns null if invalid. */
  function parseQty(input) {
    const v = parseScaled(input, 3, false);
    return v != null && v > 0 ? v : null;
  }

  /** 1500 -> "1.5", 2000 -> "2" */
  function formatQty(milli) {
    assertSafe(milli, 'Quantity');
    const whole = Math.floor(milli / 1000);
    const frac = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
    return frac ? whole + '.' + frac : String(whole);
  }

  // ---- GST rate ----

  /** "12.5" or "12.5%" -> 1250. 0 to 100, up to 2 decimals. Returns null if invalid. */
  function parseRate(input) {
    const v = parseScaled(String(input == null ? '' : input).replace('%', ''), 2, false);
    return v != null && v <= 10000 ? v : null;
  }

  /** 1250 -> "12.5", 1200 -> "12" */
  function formatRate(bp) {
    assertSafe(bp, 'Rate');
    const whole = Math.floor(bp / 100);
    const frac = String(bp % 100).padStart(2, '0').replace(/0+$/, '');
    return frac ? whole + '.' + frac : String(whole);
  }

  // ---- GST maths ----

  /** GST on a GST-exclusive amount. */
  function gstOn(netCents, rateBp) {
    return roundDiv(assertSafe(netCents * rateBp, 'Amount'), 10000);
  }

  /**
   * One line. line = { qtyMilli, unitCents, zeroRated }.
   * Returns { netCents, gstCents, totalCents }.
   */
  function calcLine(line, rateBp) {
    const netCents = roundDiv(assertSafe(line.qtyMilli * line.unitCents, 'Line amount'), 1000);
    const gstCents = line.zeroRated ? 0 : gstOn(netCents, rateBp);
    return { netCents, gstCents, totalCents: netCents + gstCents };
  }

  /**
   * Whole document. Returns
   * { lines: [{netCents, gstCents, totalCents}], subtotalCents, taxableCents, zeroRatedCents, gstCents, totalCents }.
   */
  function calcTotals(lines, rateBp) {
    const out = { lines: [], subtotalCents: 0, taxableCents: 0, zeroRatedCents: 0, gstCents: 0, totalCents: 0 };
    for (const line of lines) {
      const r = calcLine(line, rateBp);
      out.lines.push(r);
      out.subtotalCents += r.netCents;
      if (line.zeroRated) out.zeroRatedCents += r.netCents;
      else out.taxableCents += r.netCents;
      out.gstCents += r.gstCents;
    }
    out.totalCents = out.subtotalCents + out.gstCents;
    return out;
  }

  // ---- USD ----

  /** The Belize dollar is pegged at BZD 2 = USD 1. */
  const BZD_PER_USD = 2;

  /** BZD cents -> USD cents at the fixed peg, rounded half away from zero. Display only. */
  function bzdToUsdCents(bzdCents) {
    return roundDiv(bzdCents, BZD_PER_USD);
  }

  // ---- Friendly validation (inline form errors) ----

  /** Sensible ceilings, so a typo can't make a line total too large to add up safely. */
  const MAX_PRICE_CENTS = 10000000000; // $100,000,000.00
  const MAX_QTY_MILLI = 99999000;    // 99,999

  /** True if `s` is a plain number with more than `places` decimals (e.g. "12.505" for money). */
  const tooManyDecimals = (s, places) => new RegExp('^-?[$\\d,\\s]*\\.\\d{' + (places + 1) + ',}$').test(s);

  /** '' if `input` is a valid price (0 or more, at most 2 decimals, up to $100,000,000), else a message. */
  function priceError(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return 'Enter a price, e.g. 12.50';
    if (/^-/.test(s.replace(/[$\s]/g, ''))) return 'Price can\'t be negative';
    const v = parseCents(s);
    if (v == null) return tooManyDecimals(s, 2) ? 'Use at most 2 decimals, e.g. 12.50' : 'Enter a price, e.g. 12.50';
    if (v > MAX_PRICE_CENTS) return 'Price is too large (max $100,000,000.00)';
    return '';
  }

  /** '' if `input` is a valid quantity (more than 0, at most 3 decimals, up to 99,999), else a message. */
  function qtyError(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return 'Enter a quantity';
    const v = parseScaled(s, 3, true);
    if (v == null) return tooManyDecimals(s, 3) ? 'Use at most 3 decimals' : 'Enter a number, e.g. 2 or 1.5';
    if (v <= 0) return 'Quantity must be more than 0';
    if (v > MAX_QTY_MILLI) return 'Quantity is too large (max 99,999)';
    return '';
  }

  const api = {
    roundDiv,
    parseCents, formatCents, centsToInput,
    parseQty, formatQty,
    parseRate, formatRate,
    gstOn, calcLine, calcTotals,
    MAX_PRICE_CENTS, MAX_QTY_MILLI, priceError, qtyError,
    BZD_PER_USD, bzdToUsdCents,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.money = api;
})(typeof window !== 'undefined' ? window : globalThis);
