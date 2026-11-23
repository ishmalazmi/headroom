// Limits from Anthropic: which sign-in is used, and what happens when it is stale.
// Network, Keychain and the claude command are replaced with fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { NOW, HOUR } = require('./helpers');
const claude = require('../src/main/providers/claude');

const login = { id: '/home/.claude-work', dir: '/home/.claude-work', isDefault: false, name: 'work', path: '~/.claude-work', plan: 'Max' };
const fresh = { accessToken: 'fresh', expiresAt: NOW + HOUR };
const expired = { accessToken: 'old', expiresAt: NOW - HOUR };
const usage = { five_hour: { utilization: 25, resets_at: new Date(NOW + HOUR).toISOString() }, seven_day: { utilization: 60, resets_at: null } };

// Runs read() with fakes; returns the usage plus a log of what was called.
async function readWith({ credentials, status = { loggedIn: true }, respond }) {
  const calls = [];
  const queue = [...credentials];
  claude.resetLive(true);
  claude.deps.logins = async () => [login];
  claude.deps.readCredential = async () => { calls.push('read'); return queue.length > 1 ? queue.shift() : queue[0]; };
  claude.deps.authStatus = async () => { calls.push('renew'); return status; };
  claude.deps.requestUsage = async (oauth) => { calls.push('ask:' + oauth.accessToken); return respond(oauth); };
  const u = await claude.read({ settings: { claudeLive: true }, now: NOW, login });
  return { u, calls };
}

test('a valid saved sign-in is used as it is', async () => {
  const { u, calls } = await readWith({ credentials: [fresh], respond: () => usage });
  assert.deepEqual(calls, ['read', 'ask:fresh']);
  assert.deepEqual(u.windows.map((w) => [w.id, w.usedPct]), [['session', 25], ['week', 60]]);
  assert.equal(u.note, null);
});

test('an expired sign-in is renewed by Claude Code, then used', async () => {
  const { u, calls } = await readWith({ credentials: [expired, fresh], respond: () => usage });
  assert.deepEqual(calls, ['read', 'renew', 'read', 'ask:fresh']);
  assert.equal(u.windows[0].usedPct, 25);
});

test('a login that is not signed in says which command to run', async () => {
  const { u, calls } = await readWith({ credentials: [null], status: { loggedIn: false }, respond: () => usage });
  assert.deepEqual(calls, ['read', 'renew']);
  assert.match(u.note, /not signed in/);
  assert.match(u.note, /CLAUDE_CONFIG_DIR=~\/\.claude-work claude/);
  assert.equal(u.windows.every((w) => w.usedPct == null), true);
});

test('a sign-in that cannot be renewed is reported, without asking Anthropic', async () => {
  const { u, calls } = await readWith({ credentials: [expired], status: null, respond: () => usage });
  assert.deepEqual(calls, ['read', 'renew', 'read']);
  assert.match(u.note, /expired/);
});

test('a rejected sign-in is renewed and retried once', async () => {
  const rejected = { accessToken: 'revoked', expiresAt: NOW + HOUR };
  const { u, calls } = await readWith({
    credentials: [rejected, fresh],
    respond: (oauth) => {
      if (oauth.accessToken === 'revoked') throw Object.assign(new Error('rejected'), { status: 401 });
      return usage;
    },
  });
  assert.deepEqual(calls, ['read', 'ask:revoked', 'renew', 'read', 'ask:fresh']);
  assert.equal(u.windows[0].usedPct, 25);
});

test('a server error is reported and not retried', async () => {
  const { u, calls } = await readWith({
    credentials: [fresh],
    respond: () => { throw Object.assign(new Error('Anthropic returned 500'), { status: 500 }); },
  });
  assert.deepEqual(calls, ['read', 'ask:fresh']);
  assert.match(u.note, /Anthropic returned 500/);
});

test('limits are cached for five minutes', async () => {
  const first = await readWith({ credentials: [fresh], respond: () => usage });
  assert.equal(first.calls.length, 2);
  const calls = [];
  claude.deps.requestUsage = async () => { calls.push('ask'); return usage; };
  await claude.read({ settings: { claudeLive: true }, now: NOW + 60000, login });
  assert.deepEqual(calls, []);
  await claude.read({ settings: { claudeLive: true }, now: NOW + 6 * 60000, login });
  assert.deepEqual(calls, ['ask']);
});
