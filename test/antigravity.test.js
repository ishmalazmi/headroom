const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, iso, write, stat } = require('./helpers');
const antigravity = require('../src/main/providers/antigravity');

write('.gemini/antigravity-cli/conversations/abc.db', 'x');
write('.gemini/antigravity-cli/cli.log', [
  'I0115 quota_manager.go:45] doRefreshQuota: starting reload',
  '  "reason": "QUOTA_EXHAUSTED",',
  '  "metadata": {',
  '    "model": "gemini-test-pro",',
  `    "quotaResetTimeStamp": "${iso(NOW + 2 * HOUR)}"`,
  '  }',
].join('\n'));

test('detects Antigravity from its data folder', async () => {
  assert.equal((await antigravity.detect()).detected, true);
});

test('finds an active quota lockout in the logs', async () => {
  const u = await antigravity.read({ now: NOW });
  assert.equal(u.lock.until, NOW + 2 * HOUR);
  assert.equal(u.lock.what, 'gemini-test-pro');
});

test('a lockout in the past is ignored', async () => {
  const u = await antigravity.read({ now: NOW + 3 * HOUR });
  assert.equal(u.lock, null);
});

test('counts recently touched conversations', async () => {
  const u = await antigravity.read({ now: NOW });
  assert.equal(stat(u, 'conversations in 7 days'), 1);
});
