const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, DAY, iso, jsonl, stat } = require('./helpers');
const codex = require('../src/main/providers/codex');

const count = (t, total, primaryPct) => ({
  timestamp: iso(t), type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: total },
    rate_limits: {
      primary: { used_percent: primaryPct, window_minutes: 300, resets_at: (NOW + 3 * HOUR) / 1000 },
      secondary: { used_percent: 5, window_minutes: 10080, resets_at: (NOW + 5 * DAY) / 1000 },
      plan_type: 'plus',
    },
  },
});

jsonl('.codex/sessions/2026/01/15/rollout-a.jsonl', [
  { timestamp: iso(NOW - 2 * HOUR), type: 'session_meta', payload: {} },
  count(NOW - 2 * HOUR, { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100 }, 10),
  count(NOW - HOUR, { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 300 }, 42),
  // Codex repeats the event when only the limits change: no new tokens.
  count(NOW - HOUR + 1000, { input_tokens: 3000, cached_input_tokens: 2000, output_tokens: 300 }, 42),
]);

test('detects Codex from its data folder', async () => {
  assert.equal((await codex.detect()).detected, true);
});

test('reads exact limits from the latest turn', async () => {
  const u = await codex.read({ now: NOW });
  assert.equal(u.plan, 'Plus');
  assert.deepEqual(u.windows.map((w) => [w.id, w.label, w.usedPct, w.resetsAt]), [
    ['session', '5-hour window', 42, NOW + 3 * HOUR],
    ['week', 'weekly limit', 5, NOW + 5 * DAY],
  ]);
  assert.equal(u.asOf, NOW - HOUR + 1000);
  assert.match(u.note, /last Codex turn/);
});

test('counts new tokens only, without cached input', async () => {
  const u = await codex.read({ now: NOW });
  assert.equal(stat(u, 'tokens today'), 1300);
  assert.equal(stat(u, 'tokens in 7 days'), 1300);
});

test('a window that has rolled over since the last turn reads as empty', async () => {
  const u = await codex.read({ now: NOW + 4 * HOUR });
  assert.equal(u.windows[0].usedPct, 0);
  assert.equal(u.windows[0].resetsAt, null);
  assert.equal(u.windows[1].usedPct, 5);
});
