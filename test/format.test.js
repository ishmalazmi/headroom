const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/shared/format');

const MIN = 60000;
const HOUR = 36e5;

test('dur formats minutes, hours and days', () => {
  assert.equal(F.dur(0), 'now');
  assert.equal(F.dur(-5), 'now');
  assert.equal(F.dur(30 * 1000), '1m');
  assert.equal(F.dur(59 * MIN), '59m');
  assert.equal(F.dur(2 * HOUR), '2h');
  assert.equal(F.dur(2 * HOUR + 14 * MIN), '2h 14m');
  assert.equal(F.dur(24 * HOUR), '1d');
  assert.equal(F.dur(76 * HOUR), '3d 4h');
});

test('num abbreviates large counts', () => {
  assert.equal(F.num(null), '0');
  assert.equal(F.num(999), '999');
  assert.equal(F.num(1500), '1.5K');
  assert.equal(F.num(412000), '412K');
  assert.equal(F.num(1234567), '1.2M');
  assert.equal(F.num(12000000), '12M');
  assert.equal(F.num(2500000000), '2.5B');
});

test('ago', () => {
  assert.equal(F.ago(10000), 'just now');
  assert.equal(F.ago(5 * MIN), '5m ago');
});

test('pace says nothing without a measured window', () => {
  assert.equal(F.pace({ usedPct: null, resetsAt: 1, lengthMs: 1 }, 0), '');
  assert.equal(F.pace({ usedPct: 50, resetsAt: null, lengthMs: 5 * HOUR }, 0), '');
});

test('pace says nothing in the first minutes of a window', () => {
  const now = 1e12;
  assert.equal(F.pace({ usedPct: 2, resetsAt: now + 4.9 * HOUR, lengthMs: 5 * HOUR }, now), '');
});

test('pace warns when usage is ahead of the clock', () => {
  const now = 1e12;
  // 80% used halfway through: 20% left at 80% per 2.5h lasts 37.5 minutes.
  const text = F.pace({ usedPct: 80, resetsAt: now + 2.5 * HOUR, lengthMs: 5 * HOUR }, now);
  assert.equal(text, 'At this pace you run out in 38m, 1h 53m before it resets.');
});

test('pace reassures when usage is behind the clock', () => {
  const now = 1e12;
  const text = F.pace({ usedPct: 20, resetsAt: now + 2.5 * HOUR, lengthMs: 5 * HOUR }, now);
  assert.equal(text, 'On pace to finish this window at about 40%.');
});

test('pace reports a reached limit', () => {
  const now = 1e12;
  assert.equal(F.pace({ usedPct: 100, resetsAt: now + HOUR, lengthMs: 5 * HOUR }, now), 'Limit reached. It lifts in 1h.');
});
