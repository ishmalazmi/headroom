const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, DAY, iso, jsonl, stat } = require('./helpers');
const claude = require('../src/main/providers/claude');

const turn = (t, id, usage, extra = {}) => ({
  type: 'assistant', timestamp: iso(t), requestId: 'req-' + id,
  message: { id, model: 'claude-test', usage, ...extra.message },
});

jsonl('.claude/projects/-work-app/session-1.jsonl', [
  { type: 'user', timestamp: iso(NOW - HOUR), message: { content: 'hi' } },
  // The same message is written once per content block: count it once.
  turn(NOW - HOUR, 'm1', { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 9999 }),
  turn(NOW - HOUR, 'm1', { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 9999 }),
  turn(NOW - 2 * DAY, 'm2', { input_tokens: 900, output_tokens: 100 }),
  turn(NOW - 10 * DAY, 'm3', { input_tokens: 5000, output_tokens: 5000 }),
  { ...turn(NOW - HOUR, 'm4', { input_tokens: 7777, output_tokens: 7777 }), message: { id: 'm4', model: '<synthetic>', usage: { input_tokens: 7777, output_tokens: 7777 } } },
  'not json at all',
]);

test('detects Claude Code from its data folder', async () => {
  const d = await claude.detect();
  assert.equal(d.detected, true);
  assert.match(d.evidence, /\.claude/);
});

test('sums tokens once per message, excluding cache reads', async () => {
  const u = await claude.read({ settings: { claudeLive: false }, now: NOW });
  assert.equal(stat(u, 'tokens this session'), 160);
  assert.equal(stat(u, 'tokens today'), 160);
  assert.equal(stat(u, 'tokens in 7 days'), 1160);
});

test('estimates the session window from the first message', async () => {
  const u = await claude.read({ settings: { claudeLive: false }, now: NOW });
  const w = u.windows[0];
  assert.equal(w.id, 'session');
  assert.equal(w.usedPct, null);
  assert.equal(w.exact, false);
  assert.equal(w.resetsAt, Math.floor((NOW - HOUR) / HOUR) * HOUR + 5 * HOUR);
});

test('offers live limits instead of calling the network when they are off', async () => {
  const u = await claude.read({ settings: { claudeLive: false }, now: NOW });
  assert.equal(u.action.kind, 'claude-live');
});

test('no session window once five hours have passed', async () => {
  const u = await claude.read({ settings: { claudeLive: false }, now: NOW + 6 * HOUR });
  assert.equal(u.windows.length, 0);
  assert.equal(stat(u, 'tokens this session'), undefined);
});
