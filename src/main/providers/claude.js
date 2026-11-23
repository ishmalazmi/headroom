// Claude Code.
// Tokens come from the session transcripts on disk. Limit percentages are not
// stored locally, so they are fetched from Anthropic (opt-in) with the sign-in
// Claude Code already saved.
//
// A machine can hold several Claude logins: each lives in its own config
// folder (~/.claude by default, others via CLAUDE_CONFIG_DIR, for example
// ~/.claude-work). Headroom lists them and tracks the one the user picks.
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const u = require('./util');
const { path, HOME, HOUR, DAY } = u;

const transcriptCache = new Map();
const liveCache = new Map(); // login id -> { at, data, error, plan }
let loginCache = { at: 0, list: null };
const NO_CLI = () => !!process.env.HEADROOM_NO_CLI; // tests never run the real claude command

// ---------- logins ----------

async function defaultDir() {
  return (await u.firstExisting([path.join(HOME, '.claude'), path.join(HOME, '.config', 'claude')]))
    || path.join(HOME, '.claude');
}

async function looksLikeConfigDir(dir) {
  for (const name of ['projects', '.claude.json', '.credentials.json']) {
    if (await u.exists(path.join(dir, name))) return true;
  }
  return false;
}

// ".claude-work" -> "work"
function loginName(dir, isDefault) {
  if (isDefault) return 'Default';
  return path.basename(dir).replace(/^\.?claude[-_.]?/i, '') || path.basename(dir);
}

// macOS Keychain item that holds a login's sign-in.
function keychainName(dir, isDefault) {
  if (isDefault) return 'Claude Code-credentials';
  return 'Claude Code-credentials-' + crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8);
}

async function configDirs() {
  const def = await defaultDir();
  const dirs = [{ dir: def, isDefault: true }];
  const seen = new Set([def]);
  const add = async (dir) => {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    if (await looksLikeConfigDir(dir)) dirs.push({ dir, isDefault: false });
  };
  for (const d of (process.env.CLAUDE_CONFIG_DIR || '').split(',')) await add(d.trim());
  const scan = async (parent, pattern) => {
    let entries = [];
    try { entries = await u.fsp.readdir(parent, { withFileTypes: true }); } catch {}
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.isDirectory() && pattern.test(e.name)) await add(path.join(parent, e.name));
    }
  };
  await scan(HOME, /^\.claude[-_.].+/i);
  await scan(path.join(HOME, '.config'), /^claude[-_.].+/i);
  return dirs;
}

function run(file, args, opts) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...opts }, (_err, stdout) => resolve(stdout || ''));
  });
}

// Ask Claude Code itself who a login belongs to. As a side effect Claude Code
// renews that login's saved sign-in if it has expired.
async function authStatus(login) {
  if (NO_CLI()) return null;
  const bin = await u.findBinary(['claude']);
  if (!bin) return null;
  const env = { ...process.env, PATH: path.dirname(bin) + path.delimiter + (process.env.PATH || '') };
  delete env.CLAUDE_CONFIG_DIR;
  if (!login.isDefault) env.CLAUDE_CONFIG_DIR = login.dir;
  const out = await run(bin, ['auth', 'status'], { env, cwd: os.tmpdir(), shell: u.WIN });
  try { return JSON.parse(out.slice(out.indexOf('{'))); } catch { return null; }
}

async function readCredential(login) {
  const parse = (raw) => {
    try { return JSON.parse(raw).claudeAiOauth || null; } catch { return null; }
  };
  const file = path.join(login.dir, '.credentials.json');
  if (await u.exists(file)) return parse(await u.fsp.readFile(file, 'utf8'));
  if (process.platform === 'darwin') {
    const raw = await run('/usr/bin/security', ['find-generic-password', '-s', keychainName(login.dir, login.isDefault), '-w']);
    return parse(raw.trim());
  }
  return null;
}

const isUsable = (oauth, now) => !!(oauth && oauth.accessToken && (!oauth.expiresAt || oauth.expiresAt > now));

// Every Claude login on this machine, with who it belongs to where Claude Code can say.
async function logins(now = Date.now()) {
  if (loginCache.list && now - loginCache.at < 30 * 60 * 1000) return loginCache.list;
  const list = [];
  for (const d of await configDirs()) {
    const login = { id: d.dir, dir: d.dir, isDefault: d.isDefault, name: loginName(d.dir, d.isDefault), path: u.tilde(d.dir) };
    const status = await authStatus(login);
    if (status) {
      login.loggedIn = !!status.loggedIn;
      login.email = status.email || null;
      login.plan = status.subscriptionType ? status.subscriptionType[0].toUpperCase() + status.subscriptionType.slice(1) : null;
    } else {
      login.loggedIn = !!((await readCredential(login)) || {}).accessToken;
      login.email = null;
      login.plan = null;
    }
    list.push(login);
  }
  loginCache = { at: now, list };
  return list;
}

async function pickLogin(settings, now) {
  const list = await logins(now);
  return list.find((l) => l.id === settings.claudeLogin) || list.find((l) => l.isDefault) || list[0];
}

// ---------- detection ----------

async function detect() {
  const dirs = [];
  for (const d of await configDirs()) if (await u.exists(d.dir)) dirs.push(d.dir);
  const bin = await u.findBinary(['claude']);
  const projects = dirs.length ? path.join(dirs[0], 'projects') : null;
  return {
    detected: !!(dirs.length || bin),
    evidence: [bin && 'claude command', ...dirs.map(u.tilde)].filter(Boolean).join(', '),
    lastActive: projects ? await u.mtime(projects) : null,
  };
}

// ---------- tokens from transcripts ----------

async function parseFile(file) {
  const entries = [];
  await u.eachLine(file, '"usage"', (line) => {
    if (!line.includes('"assistant"')) return;
    const d = JSON.parse(line);
    const m = d.message;
    if (!m || !m.usage || m.model === '<synthetic>') return;
    const us = m.usage;
    const t = Date.parse(d.timestamp);
    if (!t) return;
    entries.push({
      t,
      key: (m.id || '') + ':' + (d.requestId || ''),
      tok: (us.input_tokens || 0) + (us.output_tokens || 0) + (us.cache_creation_input_tokens || 0),
    });
  });
  return entries;
}

// ---------- limits from Anthropic ----------

async function requestUsage(oauth) {
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      Authorization: 'Bearer ' + oauth.accessToken,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'headroom',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'Anthropic rejected the saved sign-in' : 'Anthropic returned ' + res.status);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// The desktop app keeps its own sign-in, which other apps cannot read, so the
// claude command has to be signed in for this login as well.
const notSignedIn = (login) => `This login is not signed in for the claude command. Run "${login.isDefault ? 'claude' : `CLAUDE_CONFIG_DIR=${login.path} claude`}" in a terminal, sign in, then refresh`;
const CANNOT_RENEW = 'The saved sign-in has expired. Run claude in a terminal once, then refresh';

async function fetchLive(now, login) {
  const hit = liveCache.get(login.id);
  if (hit && now - hit.at < 5 * 60 * 1000) return hit;
  const live = { at: now, data: null, error: null };
  liveCache.set(login.id, live);
  try {
    let oauth = await readCredential(login);
    if (!isUsable(oauth, now)) {
      // Let Claude Code renew its own sign-in; Headroom never writes credentials.
      const status = await authStatus(login);
      if (status && !status.loggedIn) throw new Error(notSignedIn(login));
      oauth = await readCredential(login);
    }
    if (!oauth || !oauth.accessToken) throw new Error(notSignedIn(login));
    if (!isUsable(oauth, now)) throw new Error(CANNOT_RENEW);
    try {
      live.data = await requestUsage(oauth);
    } catch (e) {
      if (e.status !== 401) throw e;
      await authStatus(login);
      oauth = await readCredential(login);
      if (!isUsable(oauth, now)) throw new Error(CANNOT_RENEW);
      live.data = await requestUsage(oauth);
    }
  } catch (e) {
    live.error = e.name === 'TimeoutError' ? 'Anthropic did not answer in time' : e.message;
  }
  return live;
}

function liveWindow(id, label, lengthMs, w) {
  if (!w || w.utilization == null) return null;
  return {
    id, label, lengthMs, exact: true,
    usedPct: Math.max(0, Math.min(100, Number(w.utilization))),
    resetsAt: w.resets_at ? Date.parse(w.resets_at) : null,
  };
}

// ---------- read ----------

async function read({ settings, now }) {
  const login = await pickLogin(settings, now);
  const since = now - 7 * DAY;
  const files = await u.walk(path.join(login.dir, 'projects'), { since, depth: 4 });
  u.pruneCache(transcriptCache, files);

  const seen = new Map();
  for (const f of files) {
    for (const e of await u.cached(transcriptCache, f, parseFile)) {
      if (e.t < since) continue;
      const prev = seen.get(e.key);
      if (!prev || e.tok > prev.tok) seen.set(e.key, e);
    }
  }
  const entries = [...seen.values()].sort((a, b) => a.t - b.t);

  // Claude's session window opens with the first message and runs five hours.
  let blockStart = null;
  let blockTok = 0;
  for (const e of entries) {
    if (blockStart == null || e.t >= blockStart + 5 * HOUR) {
      blockStart = Math.floor(e.t / HOUR) * HOUR;
      blockTok = 0;
    }
    blockTok += e.tok;
  }
  const blockActive = blockStart != null && now < blockStart + 5 * HOUR;

  const today = u.startOfDay(now);
  const sum = (from) => entries.reduce((n, e) => (e.t >= from ? n + e.tok : n), 0);
  const stats = [
    { value: sum(today), label: 'tokens today' },
    { value: sum(since), label: 'tokens in 7 days' },
  ];
  if (blockActive) stats.unshift({ value: blockTok, label: 'tokens this session' });

  const out = { windows: [], stats, plan: login.plan || null, note: null, action: null, lock: null };
  // Say which login this is only when there is more than one to confuse it with.
  if ((await logins(now)).length > 1) out.login = login.email || login.name;

  if (settings.claudeLive) {
    const l = await fetchLive(now, login);
    if (l.data) {
      out.windows = [
        liveWindow('session', '5-hour window', 5 * HOUR, l.data.five_hour),
        liveWindow('week', 'weekly limit', 7 * DAY, l.data.seven_day),
        liveWindow('week-opus', 'weekly Opus limit', 7 * DAY, l.data.seven_day_opus),
        liveWindow('week-sonnet', 'weekly Sonnet limit', 7 * DAY, l.data.seven_day_sonnet),
      ].filter(Boolean);
    } else if (l.error) {
      out.note = `Couldn't read limits: ${l.error}.`;
    }
  } else {
    out.action = { kind: 'claude-live', label: 'Show limit percentages' };
  }

  if (!out.windows.length && blockActive) {
    out.windows = [{
      id: 'session', label: '5-hour window', lengthMs: 5 * HOUR, exact: false,
      usedPct: null, resetsAt: blockStart + 5 * HOUR,
    }];
  }
  if (!entries.length && !out.windows.length) out.empty = 'No Claude Code sessions in the last 7 days.';
  return out;
}

// Forget cached limits (and, when asked, who the logins belong to).
function resetLive(all) {
  liveCache.clear();
  if (all) loginCache = { at: 0, list: null };
}

module.exports = {
  id: 'claude', name: 'Claude Code', mark: 'Cl',
  detect, read, resetLive, logins, keychainName, loginName,
};
