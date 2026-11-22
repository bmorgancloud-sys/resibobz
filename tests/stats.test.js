// Run with: node --test tests/
// Stats maths (js/stats.js). The cases live in tests/stats.cases.js so tests/stats.test.html runs
// exactly the same ones in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');

require('./stats.cases.js')({
  test,
  assert,
  stats: require('../js/stats.js'),
  summary: require('../js/summary.js'),
  fixtures: require('./fixtures.js'),
  backup: require('../js/backup.js'),
});
