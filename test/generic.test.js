const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR, DAY, iso, jsonl, stat } = require('./helpers');
const { make } = require('../src/main/providers/generic');

const agent = make({ id: 'zz', name: 'Zed', mark: 'Zz', dirs: [['.zz-agent']], bins: ['zz-agent-binary-that-does-not-exist'] });

test('an agent with no folder and no command is not detected', async () => {
  assert.equal((await agent.detect()).detected, false);
});

test('picks token counts out of session logs in common shapes', async () => {
  jsonl('.zz-agent/sessions/a.jsonl', [
    { timestamp: iso(NOW - HOUR), usage: { prompt_tokens: 100, completion_tokens: 20 } },
    { created_at: Math.round((NOW - 2 * DAY) / 1000), input_tokens: 5, output_tokens: 5 },
    { timestamp: iso(NOW - HOUR), note: 'no tokens here' },
  ]);
  assert.equal((await agent.detect()).detected, true);
  const u = await agent.read({ now: NOW });
  assert.equal(stat(u, 'tokens today'), 120);
  assert.equal(stat(u, 'tokens in 7 days'), 130);
  assert.match(u.note, /Estimated/);
});
