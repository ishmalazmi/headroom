const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, DAY } = require('./helpers');
const { headline, collect } = require('../src/main/providers');

const used = { display: 'used' };
const usage = (over) => ({ windows: [], stats: [], lock: null, ...over });
const win = (id, usedPct, resetsAt) => ({ id, label: id, usedPct, resetsAt, lengthMs: 5 * HOUR });

test('no usage gives a dash', () => {
  assert.equal(headline(null, used, NOW).text, '–');
  assert.equal(headline(usage({}), used, NOW).text, '–');
});

test('the most constrained window is the headline', () => {
  const h = headline(usage({ windows: [win('session', 12, NOW + HOUR), win('week', 61, NOW + DAY)] }), used, NOW);
  assert.equal(h.text, '61%');
  assert.equal(h.windowId, 'week');
  assert.equal(h.level, 'calm');
});

test('levels: warn from 75, critical from 90', () => {
  assert.equal(headline(usage({ windows: [win('s', 74, NOW + HOUR)] }), used, NOW).level, 'calm');
  assert.equal(headline(usage({ windows: [win('s', 75, NOW + HOUR)] }), used, NOW).level, 'warn');
  assert.equal(headline(usage({ windows: [win('s', 90, NOW + HOUR)] }), used, NOW).level, 'crit');
});

test('near the limit the headline becomes the time until reset', () => {
  const h = headline(usage({ windows: [win('s', 93, NOW + 72 * 60000)] }), used, NOW);
  assert.equal(h.text, '1h 12m');
  assert.equal(h.pct, 93);
  assert.equal(h.showsTime, true);
});

test('"left" setting flips the number but not the level', () => {
  const h = headline(usage({ windows: [win('s', 78, NOW + HOUR)] }), { display: 'left' }, NOW);
  assert.equal(h.text, '22%');
  assert.equal(h.pct, 78);
  assert.equal(h.level, 'warn');
});

test('an active lockout wins over everything', () => {
  const h = headline(usage({ lock: { until: NOW + 2 * HOUR }, windows: [win('s', 10, NOW + HOUR)] }), used, NOW);
  assert.equal(h.locked, true);
  assert.equal(h.text, '2h');
  assert.equal(h.level, 'crit');
});

test('an expired lockout is ignored', () => {
  const h = headline(usage({ lock: { until: NOW - 1 }, windows: [win('s', 10, NOW + HOUR)] }), used, NOW);
  assert.equal(h.text, '10%');
});

test('without a percentage, the first non-zero count is the headline', () => {
  const h = headline(usage({
    windows: [win('day', null, NOW + HOUR)],
    stats: [{ value: 0, label: 'requests today' }, { value: 286000, label: 'tokens today' }],
  }), used, NOW);
  assert.equal(h.text, '286K');
  assert.equal(h.sub, 'tokens today');
  assert.equal(h.pct, null);
});

test('collect lists every supported agent and reads none that are untracked', async () => {
  const agents = await collect({ tracked: [], display: 'used', claudeLive: false }, NOW);
  assert.deepEqual(agents.map((a) => a.id), ['claude', 'codex', 'gemini', 'antigravity', 'kimi', 'deepseek']);
  for (const a of agents) {
    assert.equal(a.usage, null);
    assert.equal(a.headline.text, '–');
    assert.equal(typeof a.detected, 'boolean');
  }
});
