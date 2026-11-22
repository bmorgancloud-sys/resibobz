/*
 * stats.cases.js: the Stats test cases, shared by two runners:
 *   - Node:    tests/stats.test.js (part of `node --test tests/`)
 *   - Browser: tests/stats.test.html (open it from the dev server)
 * Uses only assert.equal / assert.deepEqual / assert.ok, which both runners provide.
 * Expected values are hand-worked (see tests/fixtures.js), never copied from the code's output.
 */
(function (root) {
  'use strict';

  function define({ test, assert, stats, summary, fixtures, backup }) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    /** Range -> [from, to] as local "YYYY-MM-DD HH:MM" text, so failures read clearly. */
    const span = (r) => (r ? [stamp(r.from), stamp(r.to)] : null);
    const at = (y, m, d, hh = 12, mm = 0, ss = 0, ms = 0) => new Date(y, m - 1, d, hh, mm, ss, ms);
    const NOW = fixtures.NOW; // Sat 21 Nov 2026 12:00

    // ---- Step 0: getRange ----

    test('getRange today: local midnight to the next midnight', () => {
      assert.deepEqual(span(stats.getRange('today', NOW)), ['2026-11-21 00:00', '2026-11-22 00:00']);
      assert.deepEqual(span(stats.getRange('today', at(2026, 12, 31, 23, 59))), ['2026-12-31 00:00', '2027-01-01 00:00']);
    });

    test('getRange week starts on Monday (Saturday, Monday and Sunday all give Mon 16 Nov)', () => {
      const week = ['2026-11-16 00:00', '2026-11-23 00:00'];
      assert.deepEqual(span(stats.getRange('week', NOW)), week);                        // Saturday
      assert.deepEqual(span(stats.getRange('week', at(2026, 11, 16, 0, 0))), week);     // Monday 00:00
      assert.deepEqual(span(stats.getRange('week', at(2026, 11, 22, 23, 59))), week);   // Sunday night
      assert.deepEqual(span(stats.getRange('week', at(2026, 11, 23, 0, 0))), ['2026-11-23 00:00', '2026-11-30 00:00']);
      // A week that crosses a month and a year end: Thu 31 Dec 2026 -> Mon 28 Dec
      assert.deepEqual(span(stats.getRange('week', at(2026, 12, 31))), ['2026-12-28 00:00', '2027-01-04 00:00']);
    });

    test('getRange this month: 28-, 29-, 30- and 31-day months', () => {
      assert.deepEqual(span(stats.getRange('month', NOW)), ['2026-11-01 00:00', '2026-12-01 00:00']);
      const feb = stats.getRange('month', at(2026, 2, 15));
      assert.deepEqual(span(feb), ['2026-02-01 00:00', '2026-03-01 00:00']);
      assert.equal(stats.dayCount(feb), 28);
      assert.equal(stats.dayCount(stats.getRange('month', at(2028, 2, 29))), 29);   // leap year
      assert.equal(stats.dayCount(stats.getRange('month', at(2026, 4, 30))), 30);
      assert.equal(stats.dayCount(stats.getRange('month', at(2026, 1, 31))), 31);
      assert.deepEqual(span(stats.getRange('month', at(2026, 12, 31, 23, 59))), ['2026-12-01 00:00', '2027-01-01 00:00']);
    });

    test('getRange last month: month ends, leap years and the year boundary', () => {
      assert.deepEqual(span(stats.getRange('lastMonth', NOW)), ['2026-10-01 00:00', '2026-11-01 00:00']);
      const feb = stats.getRange('lastMonth', at(2026, 3, 31));   // 31 March -> February, not "March 3"
      assert.deepEqual(span(feb), ['2026-02-01 00:00', '2026-03-01 00:00']);
      assert.equal(stats.dayCount(feb), 28);
      assert.equal(stats.dayCount(stats.getRange('lastMonth', at(2028, 3, 1))), 29);
      assert.equal(stats.dayCount(stats.getRange('lastMonth', at(2026, 5, 31))), 30);  // April
      assert.deepEqual(span(stats.getRange('lastMonth', at(2027, 1, 15))), ['2026-12-01 00:00', '2027-01-01 00:00']);
    });

    test('getRange last 90 days: today and the 89 days before', () => {
      // 21 Nov back 89 days: -21 -> 31 Oct, -31 -> 30 Sep, -30 -> 31 Aug, -7 -> 24 Aug
      const r = stats.getRange('last90', NOW);
      assert.deepEqual(span(r), ['2026-08-24 00:00', '2026-11-22 00:00']);
      assert.equal(stats.dayCount(r), 90);
    });

    test('getRange custom: inclusive days; incomplete, backwards or impossible dates give null', () => {
      const r = stats.getRange('custom', NOW, { from: '2026-02-27', to: '2026-03-01' });
      assert.deepEqual(span(r), ['2026-02-27 00:00', '2026-03-02 00:00']);
      assert.equal(stats.dayCount(r), 3);
      assert.deepEqual(span(stats.getRange('custom', NOW, { from: '2026-11-05', to: '2026-11-05' })), ['2026-11-05 00:00', '2026-11-06 00:00']);
      assert.equal(stats.getRange('custom', NOW, { from: '2026-11-05', to: '2026-11-04' }), null);
      assert.equal(stats.getRange('custom', NOW, { from: '2026-11-05', to: '' }), null);
      assert.equal(stats.getRange('custom', NOW, { from: '2026-02-30', to: '2026-03-02' }), null);
      assert.equal(stats.getRange('custom', NOW), null);
      assert.equal(stats.getRange('nonsense', NOW), null);
    });

    // ---- Step 0: previousRange ----

    test('previousRange: the period just before, of the same kind', () => {
      const prev = (preset, now = NOW, custom) => span(stats.previousRange(stats.getRange(preset, now, custom)));
      assert.deepEqual(prev('today'), ['2026-11-20 00:00', '2026-11-21 00:00']);
      assert.deepEqual(prev('today', at(2026, 3, 1)), ['2026-02-28 00:00', '2026-03-01 00:00']);
      assert.deepEqual(prev('week'), ['2026-11-09 00:00', '2026-11-16 00:00']);
      assert.deepEqual(prev('month'), ['2026-10-01 00:00', '2026-11-01 00:00']);
      // Whole months go back by calendar month: March -> all of February, not 31 days.
      assert.deepEqual(prev('month', at(2026, 3, 10)), ['2026-02-01 00:00', '2026-03-01 00:00']);
      assert.deepEqual(prev('lastMonth'), ['2026-09-01 00:00', '2026-10-01 00:00']);
      assert.deepEqual(prev('lastMonth', at(2026, 1, 10)), ['2025-11-01 00:00', '2025-12-01 00:00']);
      // 24 Aug back 90 days: -24 -> 31 Jul, -31 -> 30 Jun, -30 -> 31 May, -5 -> 26 May
      assert.deepEqual(prev('last90'), ['2026-05-26 00:00', '2026-08-24 00:00']);
      assert.deepEqual(prev('custom', NOW, { from: '2026-11-10', to: '2026-11-12' }), ['2026-11-07 00:00', '2026-11-10 00:00']);
      assert.deepEqual(prev('custom', NOW, { from: '2026-01-01', to: '2026-03-31' }), ['2025-10-01 00:00', '2026-01-01 00:00']);
    });

    // ---- Step 0: inRange ----

    test('inRange includes 00:00:00 on the first day and 23:59:59 on the last, excludes the next 00:00', () => {
      const r = stats.getRange('custom', NOW, { from: '2026-10-01', to: '2026-10-31' });
      assert.ok(stats.inRange(at(2026, 10, 1, 0, 0, 0), r), 'first day 00:00:00');
      assert.ok(stats.inRange(at(2026, 10, 31, 23, 59, 59), r), 'last day 23:59:59');
      assert.ok(stats.inRange(at(2026, 10, 31, 23, 59, 59, 999), r), 'last day 23:59:59.999');
      assert.ok(!stats.inRange(at(2026, 11, 1, 0, 0, 0), r), 'next day 00:00:00');
      assert.ok(!stats.inRange(at(2026, 9, 30, 23, 59, 59), r), 'day before 23:59:59');
      assert.ok(stats.inRange(at(2026, 10, 15).toISOString(), r), 'ISO string');
      assert.ok(stats.inRange(at(2026, 10, 15).getTime(), r), 'milliseconds');
      assert.ok(!stats.inRange('not a date', r), 'invalid date');
      assert.ok(!stats.inRange(at(2026, 10, 15), null), 'no range');
    });

    // ---- Step 0: money ----

    test('formatBZD uses the app money format', () => {
      assert.equal(stats.formatBZD(123456), '$1,234.56');
      assert.equal(stats.formatBZD(0), '$0.00');
      assert.equal(stats.formatBZD(5), '$0.05');
      assert.equal(stats.formatBZD(-500), '-$5.00');
      assert.equal(stats.formatBZD(100000000), '$1,000,000.00');
    });

    test('toCents parses straight to integer cents, never through a float sum', () => {
      assert.equal(stats.toCents('12.50'), 1250);
      assert.equal(stats.toCents('$1,234.5'), 123450);
      assert.equal(stats.toCents(12.5), 1250);
      assert.equal(stats.toCents(0.1), 10);
      assert.equal(stats.toCents('0'), 0);
      assert.equal(stats.toCents('-3.25'), -325);
      assert.equal(stats.toCents('1.005'), null);
      assert.equal(stats.toCents('abc'), null);
      assert.equal(stats.toCents(NaN), null);
      assert.equal(stats.toCents(null), null);
    });

    // ---- Step 0: labels and the remembered picker choice ----

    test('rangeLabel', () => {
      const custom = (from, to) => stats.rangeLabel(stats.getRange('custom', NOW, { from, to }));
      assert.equal(stats.rangeLabel(stats.getRange('today', NOW)), '21 Nov 2026');
      assert.equal(stats.rangeLabel(stats.getRange('month', NOW)), '1 – 30 Nov 2026');
      assert.equal(custom('2026-10-28', '2026-11-03'), '28 Oct – 3 Nov 2026');
      assert.equal(custom('2025-12-29', '2026-01-04'), '29 Dec 2025 – 4 Jan 2026');
      assert.equal(stats.rangeLabel(null), '');
    });

    test('parseSavedChoice falls back to This month for missing or broken values', () => {
      const def = { preset: 'month', custom: { from: '', to: '' } };
      assert.deepEqual(stats.parseSavedChoice('{"preset":"lastMonth"}'), { preset: 'lastMonth', custom: { from: '', to: '' } });
      assert.deepEqual(stats.parseSavedChoice('{"preset":"custom","custom":{"from":"2026-11-01","to":"2026-11-10"}}'),
        { preset: 'custom', custom: { from: '2026-11-01', to: '2026-11-10' } });
      assert.deepEqual(stats.parseSavedChoice('{"preset":"custom","custom":{"from":"junk","to":"2026-13-01"}}'),
        { preset: 'custom', custom: { from: '', to: '' } });
      assert.deepEqual(stats.parseSavedChoice(null), def);
      assert.deepEqual(stats.parseSavedChoice('{not json'), def);
      assert.deepEqual(stats.parseSavedChoice('{"preset":"year"}'), def);
      assert.deepEqual(stats.parseSavedChoice('"month"'), def);
    });

    // ---- Fixture: built records match the hand-worked figures ----

    test('fixture: every receipt and quote matches its hand-worked figures', () => {
      for (const r of fixtures.receipts) {
        const [sub, gst, total] = fixtures.EXPECT.receipts[r.number];
        assert.deepEqual([r.subtotalCents, r.gstCents, r.totalCents], [sub, gst, total], r.number);
      }
      for (const q of fixtures.quotes) assert.equal(q.totalCents, fixtures.EXPECT.quotes[q.number], q.number);
    });

    test('fixture: preset ranges at "now" count the hand-worked receipts (quotes and voids left out)', () => {
      const all = [...fixtures.receipts, ...fixtures.quotes];
      const pick = (s) => ({ count: s.count, subtotalCents: s.subtotalCents, taxableCents: s.taxableCents,
        zeroRatedCents: s.zeroRatedCents, gstCents: s.gstCents, totalCents: s.totalCents });
      assert.deepEqual(pick(summary.summarize(all, stats.getRange('lastMonth', NOW))), fixtures.EXPECT.october);
      const nov = summary.summarize(all, stats.getRange('month', NOW));
      assert.deepEqual([nov.count, nov.subtotalCents, nov.gstCents, nov.totalCents],
        [fixtures.EXPECT.november.count, fixtures.EXPECT.november.subtotalCents, fixtures.EXPECT.november.gstCents, fixtures.EXPECT.november.totalCents]);
      const week = summary.summarize(all, stats.getRange('week', NOW));
      assert.deepEqual([week.count, week.totalCents], [fixtures.EXPECT.week.count, fixtures.EXPECT.week.totalCents]);
      const today = summary.summarize(all, stats.getRange('today', NOW));
      assert.deepEqual([today.count, today.totalCents], [fixtures.EXPECT.today.count, fixtures.EXPECT.today.totalCents]);
    });

    // ---- Step 1: monthly GST summary ----

    const ALL = [...fixtures.receipts, ...fixtures.quotes];
    const october = () => stats.gstSummary(ALL, '2026-10');

    /** Minimal CSV parser (quoted fields, "" escapes, CRLF) so the tests read the file like a spreadsheet would. */
    function parseCsv(text) {
      const rows = [];
      let row = [], field = '', quoted = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
          if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
          else if (c === '"') quoted = false;
          else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') continue;
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
      if (field || row.length) { row.push(field); rows.push(row); }
      return rows;
    }
    /** "12.50" -> 1250 without floats. */
    const cents = (s) => { const [d, c = '0'] = s.split('.'); return Number(d) * 100 + Number(c.padEnd(2, '0')); };

    test('GST: month helpers; the default month is last month', () => {
      assert.equal(stats.defaultGstMonth(NOW), '2026-10');
      assert.equal(stats.defaultGstMonth(at(2027, 1, 1, 0, 0)), '2026-12');
      assert.deepEqual(span(stats.monthRange('2026-02')), ['2026-02-01 00:00', '2026-03-01 00:00']);
      assert.deepEqual(span(stats.monthRange('2026-12')), ['2026-12-01 00:00', '2027-01-01 00:00']);
      assert.equal(stats.monthRange('2026-13'), null);
      assert.equal(stats.monthRange('2026-1'), null);
      assert.equal(stats.monthLabel('2026-10'), 'October 2026');
      // Months with data (oldest counted receipt is 30 Sep), newest first, up to this month.
      assert.deepEqual(stats.gstMonths(ALL, NOW), ['2026-11', '2026-10', '2026-09']);
      assert.deepEqual(stats.gstMonths([], NOW), ['2026-11', '2026-10']);
    });

    test('GST: October totals match the hand-worked fixture to the cent', () => {
      const s = october();
      const e = fixtures.EXPECT.october;
      assert.deepEqual(
        [s.count, s.totalCents, s.taxableCents, s.zeroRatedCents, s.gstCents, s.subtotalCents],
        [e.count, e.totalCents, e.taxableCents, e.zeroRatedCents, e.gstCents, e.subtotalCents]);
      assert.equal(s.label, 'October 2026');
    });

    test('GST: month edges: 1st 00:00:00 and last day 23:59 in; 30 Sep 23:59:59 and 1 Nov 00:00 out', () => {
      const nums = october().rows.map((r) => r.number);
      assert.deepEqual(nums, ['INV-0002', 'INV-0003', 'INV-0004', 'INV-0005', 'INV-0006', 'INV-0008']);
      const nov = stats.gstSummary(ALL, '2026-11').rows.map((r) => r.number);
      assert.equal(nov[0], 'INV-0009', '1 Nov 00:00:00 starts November');
      const sep = stats.gstSummary(ALL, '2026-09').rows.map((r) => r.number);
      assert.deepEqual(sep, ['INV-0001'], '30 Sep 23:59:59 stays in September');
      assert.equal(october().rows[5].date, '2026-10-31');
    });

    test('GST: mixed taxable and zero-rated lines split per receipt', () => {
      const rows = Object.fromEntries(october().rows.map((r) => [r.number, r]));
      // INV-0005: Rice 650 zero-rated + Batteries 1800 standard, GST 225
      assert.deepEqual([rows['INV-0005'].taxableCents, rows['INV-0005'].zeroRatedCents, rows['INV-0005'].gstCents, rows['INV-0005'].totalCents], [1800, 650, 225, 2675]);
      // INV-0006: Coke 150 standard (GST 18.75 -> 19) + Bread 400 zero-rated
      assert.deepEqual([rows['INV-0006'].taxableCents, rows['INV-0006'].zeroRatedCents, rows['INV-0006'].gstCents, rows['INV-0006'].totalCents], [150, 400, 19, 569]);
      // INV-0008: per-line rounding, 37.125 -> 37 and 0.5 -> 1
      assert.equal(rows['INV-0008'].gstCents, 38);
      assert.equal(rows['INV-0004'].customer, 'Walk-in');
      assert.equal(rows['INV-0006'].customer, 'ana lopez');   // saved receipts store the name trimmed
    });

    test('GST: receipts before and after a rate change each keep their own rate', () => {
      const s = october();
      // 10%: INV-0002 (300 -> 30) + INV-0003 (900 -> 90) = 1200 -> 120
      // 12.5%: 450 + 1800 + 150 + 301 = 2701 -> 56 + 225 + 19 + 38 = 338
      assert.deepEqual(s.byRate, [
        { gstRateBp: 1000, taxableCents: 1200, gstCents: 120 },
        { gstRateBp: 1250, taxableCents: 2701, gstCents: 338 },
      ]);
      const rows = Object.fromEntries(s.rows.map((r) => [r.number, r]));
      assert.deepEqual([rows['INV-0002'].gstRateBp, rows['INV-0002'].gstCents], [1000, 30]);
      assert.deepEqual([rows['INV-0004'].gstRateBp, rows['INV-0004'].gstCents], [1250, 56]);
    });

    test('GST: quotes and voided receipts are left out', () => {
      const s = october();
      assert.ok(!s.rows.some((r) => r.number === 'INV-0007'), 'voided INV-0007');
      assert.ok(!s.rows.some((r) => /^QT-/.test(r.number)), 'quotes (QT-0001 and QT-0002 are dated October)');
      assert.equal(s.excluded.voided, 1);
      const nov = stats.gstSummary(ALL, '2026-11');
      assert.equal(nov.count, fixtures.EXPECT.november.count);
      assert.equal(nov.gstCents, fixtures.EXPECT.november.gstCents);
    });

    test('GST CSV: BOM, header, one row per receipt, and the totals row equals the sum of the rows', () => {
      const csv = stats.gstCsv(october());
      assert.equal(csv.charCodeAt(0), 0xfeff, 'UTF-8 BOM');
      assert.ok(csv.includes('\r\n'), 'CRLF line ends');
      const rows = parseCsv(csv.slice(1));
      assert.deepEqual(rows[0], ['Date', 'Receipt no.', 'Customer', 'Taxable (excl. GST)', 'Zero-rated', 'GST', 'Total']);
      const data = rows.slice(1, -1);
      const total = rows[rows.length - 1];
      assert.equal(data.length, 6);
      assert.deepEqual(data[0], ['2026-10-01', 'INV-0002', 'Maria Chen', '3.00', '4.00', '0.30', '7.30']);
      assert.deepEqual(total, ['Total', '6 receipts', '', '39.01', '14.50', '4.58', '58.09']);   // hand-worked October
      for (let col = 3; col <= 6; col++) {
        assert.equal(data.reduce((sum, r) => sum + cents(r[col]), 0), cents(total[col]), rows[0][col] + ' column adds up');
      }
      assert.equal(stats.gstFileName(october(), 'csv'), 'gst-summary-2026-10.csv');
    });

    test('GST CSV: awkward customer names are quoted and never run as formulas', () => {
      assert.equal(stats.csvField('Smith, John'), '"Smith, John"');
      assert.equal(stats.csvField('Bob "The Builder"'), '"Bob ""The Builder"""');
      assert.equal(stats.csvField('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
      assert.equal(stats.csvField('+5016221234'), "'+5016221234");
      assert.equal(stats.csvField('José Peña'), 'José Peña');
      assert.equal(stats.plainAmount(123456), '1234.56');
      assert.equal(stats.plainAmount(5), '0.05');
      assert.equal(stats.plainAmount(-250), '-2.50');
    });

    // ---- Step 2: sales at a glance ----

    test('glance: percent change for up, down, flat, previous = 0 and both = 0 (never divides by zero)', () => {
      assert.deepEqual(stats.percentChange(1100, 1000), { kind: 'up', pct: 10 });
      assert.deepEqual(stats.percentChange(900, 1000), { kind: 'down', pct: 10 });
      assert.deepEqual(stats.percentChange(0, 500), { kind: 'down', pct: 100 });
      assert.deepEqual(stats.percentChange(3000, 1000), { kind: 'up', pct: 200 });
      assert.deepEqual(stats.percentChange(1000, 1000), { kind: 'flat', pct: 0 });
      assert.deepEqual(stats.percentChange(1004, 1000), { kind: 'flat', pct: 0 });   // 0.4% rounds to flat
      assert.deepEqual(stats.percentChange(1005, 1000), { kind: 'up', pct: 1 });     // 0.5% rounds up
      assert.deepEqual(stats.percentChange(500, 0), { kind: 'new', pct: null });
      assert.deepEqual(stats.percentChange(0, 0), { kind: 'none', pct: null });
      assert.equal(stats.changeText({ kind: 'up', pct: 12 }, 'last week'), '↑ 12% vs last week');
      assert.equal(stats.changeText({ kind: 'down', pct: 5 }, 'yesterday'), '↓ 5% vs yesterday');
      assert.equal(stats.changeText({ kind: 'flat', pct: 0 }, 'last month'), 'Same as last month');
      assert.equal(stats.changeText({ kind: 'new', pct: null }, 'yesterday'), 'New · nothing yesterday');
      assert.equal(stats.changeText({ kind: 'none', pct: null }, 'yesterday'), 'No sales yet');
    });

    test('glance: average receipt value is 0 with no receipts, else rounded half away from zero', () => {
      assert.equal(stats.averageCents(0, 0), 0);
      assert.equal(stats.averageCents(500, 0), 0);
      assert.equal(stats.averageCents(1000, 3), 333);   // 333.33
      assert.equal(stats.averageCents(1001, 2), 501);   // 500.5
      assert.equal(stats.averageCents(2339, 4), 585);   // 584.75
    });

    test('glance: periods compare up to the same point (yesterday, 7 days ago, same day last month)', () => {
      const p = (kind, now = NOW) => { const x = stats.periodToDate(kind, now); return [span(x.current), span(x.previous)]; };
      // NOW = Sat 21 Nov 12:00 (current `to` is 1 ms after now, shown as 12:00)
      assert.deepEqual(p('today'), [['2026-11-21 00:00', '2026-11-21 12:00'], ['2026-11-20 00:00', '2026-11-20 12:00']]);
      assert.deepEqual(p('week'), [['2026-11-16 00:00', '2026-11-21 12:00'], ['2026-11-09 00:00', '2026-11-14 12:00']]);
      assert.deepEqual(p('month'), [['2026-11-01 00:00', '2026-11-21 12:00'], ['2026-10-01 00:00', '2026-10-21 12:00']]);
      // 31 March: February has no 31st, so the whole of February.
      assert.deepEqual(p('month', at(2026, 3, 31, 9))[1], ['2026-02-01 00:00', '2026-03-01 00:00']);
      assert.deepEqual(p('month', at(2026, 3, 15, 9))[1], ['2026-02-01 00:00', '2026-02-15 09:00']);
      // 1 January compares with 1 December.
      assert.deepEqual(p('month', at(2027, 1, 1, 10))[1], ['2026-12-01 00:00', '2026-12-01 10:00']);
      // Monday just after midnight: last Monday 00:00 to 00:30.
      assert.deepEqual(p('week', at(2026, 11, 23, 0, 30))[1], ['2026-11-16 00:00', '2026-11-16 00:30']);
    });

    test('glance: the three tiles match the hand-worked fixture', () => {
      const tiles = Object.fromEntries(stats.glance(ALL, NOW).map((t) => [t.id, t]));
      // Today: INV-0016 338 (09:00); INV-0017 is void. Yesterday to 12:00: nothing (INV-0015 was at 17:30) -> New.
      assert.deepEqual(tiles.today.current, { count: 1, totalCents: 338, averageCents: 338 });
      assert.deepEqual(tiles.today.previous, { count: 0, totalCents: 0, averageCents: 0 });
      assert.equal(tiles.today.text, 'New · nothing yesterday');
      // Week: INV-0013..0016 = 338 + 650 + 1013 + 338 = 2339, avg 584.75 -> 585.
      // Last week Mon 9 -> Sat 14 12:00: INV-0011 1600 + INV-0012 1013 = 2613, avg 1306.5 -> 1307.
      // (2339 - 2613) / 2613 = -10.49% -> down 10
      assert.deepEqual(tiles.week.current, { count: 4, totalCents: 2339, averageCents: 585 });
      assert.deepEqual(tiles.week.previous, { count: 2, totalCents: 2613, averageCents: 1307 });
      assert.equal(tiles.week.text, '↓ 10% vs last week');
      // Month: November so far = 6471 (8 receipts), avg 808.875 -> 809.
      // October 1 -> 21 12:00: 730 + 990 + 506 + 2675 + 569 = 5470 (5), avg 1094. INV-0008 (31 Oct) is later.
      // (6471 - 5470) / 5470 = +18.3% -> up 18
      assert.deepEqual(tiles.month.current, { count: 8, totalCents: 6471, averageCents: 809 });
      assert.deepEqual(tiles.month.previous, { count: 5, totalCents: 5470, averageCents: 1094 });
      assert.equal(tiles.month.text, '↑ 18% vs last month');
    });

    test('glance: last week counts only up to the same moment, not the whole week', () => {
      const copy = (n, date) => ({ ...fixtures.receipts[15], id: 100 + n, number: 'X-' + n, date: date.toISOString() });
      const extra = [
        copy(1, at(2026, 11, 14, 11, 59)),   // last Saturday 11:59: before "now minus 7 days" -> counts
        copy(2, at(2026, 11, 14, 12, 1)),    // last Saturday 12:01: after it -> left out
        copy(3, at(2026, 11, 15, 10, 0)),    // last Sunday: left out
      ];
      const week = stats.glance([...ALL, ...extra], NOW).find((t) => t.id === 'week');
      assert.deepEqual(week.previous, { count: 3, totalCents: 2613 + 338, averageCents: 984 });   // 2951 / 3 = 983.67
      assert.deepEqual(week.current, { count: 4, totalCents: 2339, averageCents: 585 });
    });

    // ---- Step 3: top products and slow movers ----
    //
    // October 2026 (counted: INV-0002..0006, 0008; INV-0007's 10 batteries are void), net excl. GST:
    //   Batteries AA  900 (0003) + 1800 (0005)            = 2700, qty 3
    //   Coke 500ml    300 (0002) + 450 (0004) + 150 (0006) =  900, qty 2 + 3 + 1 = 6  ("coke 500ml ", "COKE  500ML" merge)
    //   Bread loaf    400 (0002) + 400 (0006)             =  800, qty 2
    //   Rice 5lb      650 (0005)                          =  650, qty 1
    //   Gum           297 (0008)                          =  297, qty 3
    //   Candy           4 (0008)                          =    4, qty 1

    const OCT = stats.getRange('lastMonth', NOW);
    const top = (by, extra = {}) => stats.topProducts(ALL, OCT, { by, products: fixtures.products, ...extra });
    const pick = (items) => items.map((i) => [i.name, i.netCents, i.qtyMilli]);

    test('top products by revenue (net excl. GST), voided and quotes left out', () => {
      const t = top('revenue');
      assert.equal(t.count, 6);
      assert.deepEqual(pick(t.items), [
        ['Batteries AA', 2700, 3000], ['Coke 500ml', 900, 6000], ['Bread loaf', 800, 2000],
        ['Rice 5lb', 650, 1000], ['Gum', 297, 3000], ['Candy', 4, 1000]]);
      assert.equal(t.items[1].receipts, 3, 'Coke is on 3 receipts');
    });

    test('top products by quantity; ties are ordered by name', () => {
      // Coke 6; Batteries AA 3 and Gum 3 tie -> by name; Bread 2; Candy 1 and Rice 1 tie -> by name
      assert.deepEqual(top('quantity').items.map((i) => i.name), ['Coke 500ml', 'Batteries AA', 'Gum', 'Bread loaf', 'Candy', 'Rice 5lb']);
      assert.deepEqual(top('quantity', { limit: 2 }).items.map((i) => i.name), ['Coke 500ml', 'Batteries AA']);
      assert.equal(top('quantity', { limit: 2 }).count, 6);
    });

    test('"Coke 500ml", " coke 500ml " and "COKE  500ML" merge into one item', () => {
      assert.equal(stats.normalizeName(' coke 500ml '), 'coke 500ml');
      assert.equal(stats.normalizeName('COKE  500ML'), 'coke 500ml');
      assert.equal(stats.normalizeName('Coke\t500ml'), 'coke 500ml');
      const coke = top('revenue').items.filter((i) => i.key === 'coke 500ml');
      assert.equal(coke.length, 1);
      // With no saved product, the spelling used most often is shown (tie: the first sold).
      const noSaved = stats.topProducts(ALL, OCT, { by: 'revenue' }).items.find((i) => i.key === 'coke 500ml');
      assert.equal(noSaved.name, 'Coke 500ml');   // "Coke 500ml", "coke 500ml", "COKE 500ML" once each: first sold wins
      const copy = (n, description) => ({ ...fixtures.receipts[15], id: 200 + n, number: 'Y-' + n, date: at(2026, 10, 3 + n).toISOString(),
        lines: [{ description, qtyMilli: 1000, unitCents: 300, zeroRated: false, netCents: 300, gstCents: 38 }] });
      const ice = stats.topProducts([copy(1, 'ICE BAG'), copy(2, 'Ice bag'), copy(3, ' ice  bag '), copy(4, 'Ice bag')], OCT).items;
      assert.deepEqual(ice.map((i) => [i.name, i.netCents, i.qtyMilli]), [['Ice bag', 1200, 4000]]);
    });

    test('top products: an empty range gives no items', () => {
      const t = stats.topProducts(ALL, stats.getRange('custom', NOW, { from: '2026-01-01', to: '2026-01-31' }), { products: fixtures.products });
      assert.deepEqual([t.items, t.count], [[], 0]);
    });

    test('slow movers: never sold first, then oldest last sale; anything sold in the last 30 days left out', () => {
      // At 15 Dec 2026 the 30 days are 16 Nov - 15 Dec. Last sales: Coke 21 Nov, Batteries 20 Nov, Rice 18 Nov (in);
      // Phone case 2 Nov, Bread 9 Nov (out); Phone charger never.
      const slow = stats.slowMovers(ALL, fixtures.products, at(2026, 12, 15, 12));
      assert.deepEqual(slow.map((p) => [p.name, p.lastSale && stamp(p.lastSale)]),
        [['Phone charger', null], ['Phone case', '2026-11-02 10:00'], ['Bread loaf', '2026-11-09 12:00']]);
      // At "now" (21 Nov) only the never-sold charger is slow.
      assert.deepEqual(stats.slowMovers(ALL, fixtures.products, NOW).map((p) => p.name), ['Phone charger']);
    });

    test('slow movers: the 30-day edge, and a voided sale is not a sale', () => {
      // Rice last sold 18 Nov 15:00 (its 21 Nov sale INV-0017 is void, so it doesn't count).
      // 17 Dec: window starts 18 Nov 00:00 -> Rice sold inside it. 18 Dec: window starts 19 Nov -> Rice is slow.
      assert.ok(!stats.slowMovers(ALL, fixtures.products, at(2026, 12, 17, 9)).some((p) => p.name === 'Rice 5lb'));
      const rice = stats.slowMovers(ALL, fixtures.products, at(2026, 12, 18, 9)).find((p) => p.name === 'Rice 5lb');
      assert.equal(stamp(rice.lastSale), '2026-11-18 15:00');
      assert.equal(stats.daysAgo(rice.lastSale, at(2026, 12, 18, 9)), 30);
      assert.equal(stats.daysAgo(at(2026, 11, 21, 23, 59), NOW), 0);
      // Ties by name: two never-sold products.
      const extra = [{ id: 98, name: 'Zinc nails' }, { id: 99, name: 'Anchor bolts' }];
      assert.deepEqual(stats.slowMovers(ALL, [...fixtures.products, ...extra], NOW).map((p) => p.name),
        ['Anchor bolts', 'Phone charger', 'Zinc nails']);
      assert.deepEqual(stats.slowMovers(ALL, [], NOW), []);
    });

    // ---- Step 4: top customers ----
    //
    // October 2026 (counted), incl. GST:
    //   Maria Chen (622-1234)          INV-0002 730 + INV-0005 2675 = 3405, 2 receipts
    //   Jose Garcia (610-5555 / +501 610 5555, one customer) INV-0003 990 + INV-0008 339 = 1329, 2 receipts
    //   "ana lopez" (no phone)         INV-0006 569, 1 receipt
    //   Walk-in                        INV-0004 506, 1 receipt (INV-0007 is void)
    // Repeat (2+ receipts ever, up to 31 Oct): Maria 2, Jose 2 -> repeat; Ana 1 -> one-time.  2 of 3 = 67% / 33%.
    // Last purchases (any time up to NOW): Maria 18 Nov (INV-0014), Jose 21 Nov (INV-0016), Ana 9 Nov (INV-0011).

    const custTop = (range, extra = {}) => stats.topCustomers(ALL, range, { customers: fixtures.customers, now: NOW, ...extra });

    test('top customers in October: ranking, totals, receipts and last purchase match the fixture', () => {
      const t = custTop(OCT);
      assert.deepEqual(t.items.map((i) => [i.name, i.totalCents, i.count, stamp(i.lastPurchase)]), [
        ['Maria Chen', 3405, 2, '2026-11-18 15:00'],
        ['Jose Garcia', 1329, 2, '2026-11-21 09:00'],
        ['Ana Lopez', 569, 1, '2026-11-09 12:00'],   // latest spelling ("Ana Lopez" on INV-0011)
      ]);
      assert.equal(t.count, 3);
    });

    test('top customers: Walk-in is a separate total, never ranked or counted as repeat/one-time', () => {
      const t = custTop(OCT);
      assert.deepEqual(t.walkIn, { count: 1, totalCents: 506 });
      assert.ok(!t.items.some((i) => i.name === '' || /walk/i.test(i.name)));
      assert.deepEqual(t.repeat, { repeat: 2, oneTime: 1, total: 3, repeatPct: 67, oneTimePct: 33 });
      // November so far: Maria 1350 + 650 = 2000 (2), Ana 1600 (1), Jose 1013 + 338 = 1351 (2);
      // walk-in 169 + 338 + 1013 = 1520 (3). Everyone has 2+ receipts ever -> 3 repeat, 100%.
      const nov = custTop(stats.getRange('month', NOW));
      assert.deepEqual(nov.items.map((i) => [i.name, i.totalCents, i.count]), [['Maria Chen', 2000, 2], ['Ana Lopez', 1600, 1], ['Jose Garcia', 1351, 2]]);
      assert.deepEqual(nov.walkIn, { count: 3, totalCents: 1520 });
      assert.deepEqual(nov.repeat, { repeat: 3, oneTime: 0, total: 3, repeatPct: 100, oneTimePct: 0 });
      // A range with nobody: no division by zero.
      const empty = custTop(stats.getRange('custom', NOW, { from: '2026-01-01', to: '2026-01-31' }));
      assert.deepEqual([empty.items, empty.walkIn, empty.repeat],
        [[], { count: 0, totalCents: 0 }, { repeat: 0, oneTime: 0, total: 0, repeatPct: null, oneTimePct: null }]);
    });

    test('top customers: phone formats merge, a name-only receipt joins its phone group, phone-only shows the number', () => {
      const copy = (n, customer, date) => ({ ...fixtures.receipts[15], id: 300 + n, number: 'Z-' + n, customer, date: date.toISOString() });
      const extra = [
        copy(1, { name: 'JOSE  GARCIA', phone: '' }, at(2026, 10, 8, 10)),   // name only -> Jose's phone group
        copy(2, { name: '', phone: '633 0000' }, at(2026, 10, 9, 10)),      // phone only
        copy(3, { name: '', phone: '+501-633-0000' }, at(2026, 10, 10, 10)), // same phone, other format
      ];
      const t = stats.topCustomers([...ALL, ...extra], OCT, { now: NOW });
      const jose = t.items.find((i) => i.key === 'p:5016105555');
      assert.deepEqual([jose.name, jose.totalCents, jose.count], ['Jose Garcia', 1329 + 338, 3]);
      const phoneOnly = t.items.find((i) => i.key === 'p:5016330000');
      assert.deepEqual([phoneOnly.name, phoneOnly.totalCents, phoneOnly.count, phoneOnly.waNumber], ['+501-633-0000', 676, 2, '5016330000']);
      assert.equal(t.walkIn.count, 1, 'phone-only receipts are not walk-ins');
    });

    test('WhatsApp numbers: 622-1234 and +501 622 1234 -> 5016221234; no phone, no button', () => {
      assert.equal(stats.waNumber('622-1234'), '5016221234');
      assert.equal(stats.waNumber('+501 622 1234'), '5016221234');
      assert.equal(stats.waNumber('501-622-1234'), '5016221234');
      assert.equal(stats.waNumber('00501 622 1234'), '5016221234');
      assert.equal(stats.waNumber(''), '');
      assert.equal(stats.waNumber(null), '');
      assert.equal(stats.waNumber('123'), '');
      assert.equal(stats.waLink('622-1234'), 'https://wa.me/5016221234');
      assert.equal(stats.waLink(''), '');
      const t = custTop(OCT);
      assert.deepEqual(t.items.map((i) => i.waNumber), ['5016221234', '5016105555', '']);   // Ana has no phone anywhere
      // No phone on the receipts, but the saved customer has one: use it.
      const saved = stats.topCustomers(ALL, OCT, { customers: [{ name: 'Ana Lopez', phone: '622-9999' }], now: NOW });
      assert.equal(saved.items.find((i) => i.name === 'Ana Lopez').waNumber, '5016229999');
    });

    // ---- Step 5: sales trend and busiest days ----

    test('daily series: exactly one point per day, zero-filled, matching the fixture', () => {
      const s = stats.salesSeries(ALL, OCT, NOW);
      assert.equal(s.unit, 'day');
      assert.equal(s.points.length, 31);
      assert.deepEqual(s.points.map((p) => stamp(p.from).slice(0, 10)).slice(0, 2), ['2026-10-01', '2026-10-02']);
      assert.equal(stamp(s.points[30].from).slice(0, 10), '2026-10-31');
      // 1 Oct 730, 5 Oct 990, 12 Oct 506, 15 Oct 2675, 20 Oct 569, 31 Oct 339; 25 Oct only has a void -> 0
      const byDay = Object.fromEntries(s.points.filter((p) => p.totalCents).map((p) => [p.from.getDate(), p.totalCents]));
      assert.deepEqual(byDay, { 1: 730, 5: 990, 12: 506, 15: 2675, 20: 569, 31: 339 });
      assert.equal(s.points[24].totalCents, 0, '25 Oct (void only)');
      assert.equal(s.points.reduce((a, p) => a + p.totalCents, 0), fixtures.EXPECT.october.totalCents);
      assert.equal(s.points.filter((p) => p.totalCents === 0).length, 25);
      // This month at NOW: 1-21 Nov only; the days still to come aren't plotted as zero sales.
      assert.equal(stats.salesSeries(ALL, stats.getRange('month', NOW), NOW).points.length, 21);
      assert.equal(stats.salesSeries(ALL, stats.getRange('today', NOW), NOW).points.length, 1);
      assert.equal(stats.salesSeries(ALL, stats.getRange('last90', NOW), NOW).points.length, 90);
    });

    test('weekly grouping switches on above 90 days (Monday weeks, partial first week)', () => {
      const r90 = stats.getRange('custom', NOW, { from: '2026-08-24', to: '2026-11-21' });   // 90 days
      const r91 = stats.getRange('custom', NOW, { from: '2026-08-23', to: '2026-11-21' });   // 91 days
      assert.equal(stats.dayCount(r90), 90);
      assert.equal(stats.salesSeries(ALL, r90, NOW).unit, 'day');
      assert.equal(stats.salesSeries(ALL, r91, NOW).unit, 'week');
      // 1 Aug (Sat) - 21 Nov: weeks start Mon 27 Jul (cut to 1 Aug), 3 Aug ... 16 Nov = 17 weeks.
      const w = stats.salesSeries(ALL, stats.getRange('custom', NOW, { from: '2026-08-01', to: '2026-11-21' }), NOW);
      assert.equal(w.points.length, 17);
      assert.equal(stamp(w.points[0].from).slice(0, 10), '2026-08-01');
      assert.equal(stamp(w.points[1].from).slice(0, 10), '2026-08-03');
      const week = (day) => w.points.find((p) => stamp(p.from).slice(0, 10) === day).totalCents;
      assert.equal(week('2026-09-28'), 169 + 730);   // 30 Sep + 1 Oct
      assert.equal(week('2026-10-12'), 506 + 2675);  // Mon 12 Oct + 15 Oct
      assert.equal(week('2026-10-26'), 339 + 169);   // Sat 31 Oct + Sun 1 Nov
      assert.equal(week('2026-11-16'), 2339);
      assert.equal(w.points.reduce((a, p) => a + p.totalCents, 0), 169 + 5809 + 6471);
      const labels = stats.seriesLabels(w);
      assert.deepEqual(labels[1], { short: '3 Aug', long: 'Week of 3 Aug 2026' });
      assert.deepEqual(stats.seriesLabels(stats.salesSeries(ALL, OCT, NOW))[0], { short: '1 Oct', long: 'Thu 1 Oct 2026' });
    });

    test('weekday averages divide by how often each weekday occurs (Oct 2026: five Thu/Fri/Sat, four of the rest)', () => {
      // Oct 2026 starts on a Thursday and has 31 days -> Thu, Fri, Sat x5; Mon, Tue, Wed, Sun x4.
      //   Mon: 990 (5th) + 506 (12th) = 1496 / 4 = 374
      //   Tue: 569 / 4 = 142.25 -> 142        Wed: 0 / 4 = 0
      //   Thu: 730 (1st) + 2675 (15th) = 3405 / 5 = 681
      //   Fri: 0 / 5 = 0    Sat: 339 / 5 = 67.8 -> 68    Sun: 0 / 4 = 0
      const w = stats.weekdayAverages(ALL, OCT, NOW);
      assert.deepEqual(w.map((x) => [x.day, x.days, x.totalCents, x.averageCents]), [
        ['Mon', 4, 1496, 374], ['Tue', 4, 569, 142], ['Wed', 4, 0, 0], ['Thu', 5, 3405, 681],
        ['Fri', 5, 0, 0], ['Sat', 5, 339, 68], ['Sun', 4, 0, 0]]);
      // A single day: only that weekday occurs; the others average 0 without dividing by zero.
      const today = stats.weekdayAverages(ALL, stats.getRange('today', NOW), NOW);
      assert.deepEqual(today.map((x) => x.days), [0, 0, 0, 0, 0, 1, 0]);
      assert.equal(today[5].averageCents, 338);
      // This week at NOW (Sat): Mon-Sat counted once each, Sunday (tomorrow) not yet.
      assert.deepEqual(stats.weekdayAverages(ALL, stats.getRange('week', NOW), NOW).map((x) => x.days), [1, 1, 1, 1, 1, 1, 0]);
    });

    test('axis money labels', () => {
      assert.equal(stats.axisMoney(120000), '$1,200');
      assert.equal(stats.axisMoney(1250), '$12.50');
      assert.equal(stats.axisMoney(0), '$0');
      assert.equal(stats.axisMoney(49.6), '$0.50');
    });

    // ---- Step 6: quote conversion ----
    //
    // Fixture quotes at NOW (21 Nov): QT-0001 10 Oct converted (INV-0005) · QT-0002 20 Oct expired (valid to 3 Nov)
    //   · QT-0003 15 Nov open (valid to 29 Nov), 4000 · QT-0004 1 Nov cancelled.

    const QUOTES = fixtures.quotes;

    test('quote conversion: sent, converted, rate and open value per range', () => {
      // October: QT-0001 (converted) + QT-0002 (expired) -> 1 of 2 = 50%; nothing still Open.
      assert.deepEqual(stats.quoteStats(QUOTES, OCT, NOW),
        { sent: 2, converted: 1, cancelled: 0, open: 0, expired: 1, ratePct: 50, openValueCents: 0 });
      // November so far: QT-0003 (open, 4000) + QT-0004 (cancelled) -> 0 of 2 = 0%.
      assert.deepEqual(stats.quoteStats(QUOTES, stats.getRange('month', NOW), NOW),
        { sent: 2, converted: 0, cancelled: 1, open: 1, expired: 0, ratePct: 0, openValueCents: 4000 });
      // Sep-Nov: all four, 1 converted -> 25%.
      assert.equal(stats.quoteStats(QUOTES, stats.getRange('custom', NOW, { from: '2026-09-01', to: '2026-11-30' }), NOW).ratePct, 25);
    });

    test('quote conversion: no quotes in the range gives a rate of null (shown as "—"), never a division by zero', () => {
      const none = stats.quoteStats(QUOTES, stats.getRange('custom', NOW, { from: '2026-01-01', to: '2026-01-31' }), NOW);
      assert.deepEqual(none, { sent: 0, converted: 0, cancelled: 0, open: 0, expired: 0, ratePct: null, openValueCents: 0 });
      assert.equal(stats.quoteStats([], OCT, NOW).ratePct, null);
      // Every quote has a known status, so none are left out of the rate as "unknown".
      const s = stats.quoteStats(QUOTES, stats.getRange('custom', NOW, { from: '2026-09-01', to: '2026-11-30' }), NOW);
      assert.equal(s.converted + s.cancelled + s.open + s.expired, s.sent);
    });

    test('follow-up list: open quotes only, oldest first, with age and a WhatsApp message', () => {
      // QT-0003 15 Nov -> 21 Nov = 6 days (open). QT-0002 is expired, QT-0001 converted, QT-0004 cancelled: not listed.
      const f = stats.followUps(QUOTES, { now: NOW, businessName: 'Fixture Shop' });
      assert.deepEqual(f.map((x) => [x.number, x.customer, x.totalCents, x.ageDays, x.status]), [['QT-0003', 'Ana Lopez', 4000, 6, 'open']]);
      assert.equal(stats.expiredCount(QUOTES, NOW), 1);
      assert.ok(f[0].waUrl.startsWith('https://wa.me/5016227777?text='), f[0].waUrl);
      assert.equal(decodeURIComponent(f[0].waUrl.split('?text=')[1]),
        'Hi Ana, just following up on quotation QT-0003 for $40.00 from Fixture Shop. Would you like to go ahead? Happy to answer any questions.');
      assert.equal(stats.followUpText(QUOTES[1], 'Fixture Shop'),
        'Hi Jose, just following up on quotation QT-0002 for $50.63 from Fixture Shop. Would you like to go ahead? Happy to answer any questions.');
      // Oldest first; a quote without a phone gets no button. (Earlier "now": QT-0002 is still open on 1 Nov.)
      const early = stats.followUps(QUOTES.map((q) => (q.number === 'QT-0002' ? { ...q, customer: { name: 'Jose Garcia', phone: '' } } : q)),
        { now: at(2026, 11, 1, 12) });
      assert.deepEqual(early.map((x) => [x.number, x.ageDays, x.waUrl]), [['QT-0002', 12, '']]);
      assert.equal(stats.followUpText({ number: 'QT-0009', totalCents: 500, customer: { name: '' } }, ''),
        'Hi, just following up on quotation QT-0009 for $5.00. Would you like to go ahead? Happy to answer any questions.');
    });

    test('converting a quote (receiptId set) removes it from the follow-up list and counts it as converted', () => {
      const converted = QUOTES.map((q) => (q.number === 'QT-0003'
        ? { ...q, convertedAt: at(2026, 11, 21, 11).toISOString(), receiptId: 99, receiptNumber: 'INV-0099' } : q));
      assert.deepEqual(stats.followUps(QUOTES, { now: NOW }).map((x) => x.number), ['QT-0003']);
      assert.deepEqual(stats.followUps(converted, { now: NOW }).map((x) => x.number), []);
      const nov = stats.quoteStats(converted, stats.getRange('month', NOW), NOW);
      assert.deepEqual([nov.converted, nov.open, nov.ratePct, nov.openValueCents], [1, 0, 50, 0]);
    });

    if (backup) {
      test('the quote -> receipt link (receiptId, receiptNumber, convertedAt) survives JSON export -> import', () => {
        const file = backup.build({ settings: { counter_receipt: 17, counter_quote: 4 }, products: fixtures.products,
          customers: fixtures.customers, receipts: fixtures.receipts, quotes: fixtures.quotes }, NOW);
        const back = backup.parse(JSON.stringify(file));
        const q1 = back.quotes.find((q) => q.number === 'QT-0001');
        assert.deepEqual([q1.receiptId, q1.receiptNumber, q1.convertedAt], [5, 'INV-0005', at(2026, 10, 15, 11).toISOString()]);
        assert.deepEqual([back.receipts[4].quoteId, back.receipts[4].quoteNumber], [1, 'QT-0001']);
        assert.deepEqual(stats.quoteStats(back.quotes, OCT, NOW), stats.quoteStats(fixtures.quotes, OCT, NOW));
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = define;
  else root.statsCases = define;
})(typeof window !== 'undefined' ? window : globalThis);
