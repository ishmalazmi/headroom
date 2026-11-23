const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, DAY, iso, write, stat } = require('./helpers');
const gemini = require('../src/main/providers/gemini');

write('.gemini/tmp/project-hash/chats/session-1.json', JSON.stringify({
  sessionId: 's1',
  messages: [
    { type: 'user', timestamp: iso(NOW - 120000), content: 'hi' },
    { type: 'gemini', timestamp: iso(NOW - 60000), tokens: { input: 500, cached: 100, output: 50, thoughts: 10 } },
    { type: 'gemini', timestamp: iso(NOW - 3 * DAY), tokens: { input: 200, cached: 0, output: 20 } },
  ],
}));
// Files outside a chats folder are not sessions.
write('.gemini/tmp/project-hash/logs.json', JSON.stringify([{ timestamp: iso(NOW), tokens: { input: 99999 } }]));

test('detects Gemini CLI from its data folder', async () => {
  assert.equal((await gemini.detect()).detected, true);
});

test('counts requests and tokens since midnight Pacific', async () => {
  const u = await gemini.read({ now: NOW });
  assert.equal(stat(u, 'requests today'), 1);
  assert.equal(stat(u, 'tokens today'), 460);
  assert.equal(stat(u, 'requests in 7 days'), 2);
});

test('reports the daily reset but no percentage', async () => {
  const u = await gemini.read({ now: NOW });
  const w = u.windows[0];
  assert.equal(w.usedPct, null);
  assert.ok(w.resetsAt > NOW && w.resetsAt <= NOW + DAY);
});
