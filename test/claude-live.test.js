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
  assert.match(u.note, /not signed in/i);
  assert.deepEqual(u.action, { kind: 'sign-in', label: 'Sign in' });
  assert.equal(u.windows.every((w) => w.usedPct == null), true);
});

test('a sign-in that cannot be renewed is reported, without asking Anthropic', async () => {
  const { u, calls } = await readWith({ credentials: [expired], status: null, respond: () => usage });
  assert.deepEqual(calls, ['read', 'renew', 'read']);
  assert.match(u.note, /expired/);
  assert.deepEqual(u.action, { kind: 'sign-in', label: 'Sign in again' });
});

test('a working sign-in offers no sign-in button', async () => {
  const { u } = await readWith({ credentials: [fresh], respond: () => usage });
  assert.equal(u.action, null);
});

test('the sign-in command targets the right login', () => {
  const work = claude.signInCommand(login, '/opt/bin/claude', { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/somewhere/else' });
  assert.equal(work.file, '/opt/bin/claude');
  assert.deepEqual(work.args, ['auth', 'login']);
  assert.equal(work.env.CLAUDE_CONFIG_DIR, '/home/.claude-work');
  assert.ok(work.env.PATH.startsWith('/opt/bin'), 'node next to the command must be findable');

  const def = claude.signInCommand({ ...login, isDefault: true }, '/opt/bin/claude', { PATH: '/usr/bin', CLAUDE_CONFIG_DIR: '/somewhere/else' });
  assert.equal('CLAUDE_CONFIG_DIR' in def.env, false);
});

test('signing in runs Claude Code\'s own sign-in and then forgets cached limits', async () => {
  const { calls } = await readWith({ credentials: [null], status: { loggedIn: false }, respond: () => usage });
  const ran = [];
  claude.deps.findBinary = async () => '/opt/bin/claude';
  claude.deps.run = async (file, args, opts) => { ran.push([file, args.join(' '), opts.env.CLAUDE_CONFIG_DIR]); return ''; };
  assert.equal(await claude.signIn(login), true);
  assert.deepEqual(ran, [['/opt/bin/claude', 'auth login', '/home/.claude-work']]);

  // The next read must ask again instead of serving the cached failure.
  calls.length = 0;
  claude.deps.readCredential = async () => { calls.push('read'); return fresh; };
  const u = await claude.read({ settings: { claudeLive: true }, now: NOW + 1000, login });
  assert.deepEqual(calls, ['read', 'ask:fresh']);
  assert.equal(u.windows[0].usedPct, 25);
});

test('signing in reports failure when the claude command is missing', async () => {
  claude.deps.findBinary = async () => null;
  assert.equal(await claude.signIn(login), false);
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
