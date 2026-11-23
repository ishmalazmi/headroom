// Claude Code.
// Tokens come from the session transcripts on disk. Limit percentages are not
// stored locally, so they are fetched from Anthropic (opt-in) with the sign-in
// Claude Code already saved.
const { execFile } = require('child_process');
const u = require('./util');
const { path, HOME, HOUR, DAY } = u;

const cache = new Map();
let live = { at: 0, data: null, error: null };

function dataDirs() {
  const dirs = [];
  if (process.env.CLAUDE_CONFIG_DIR) dirs.push(...process.env.CLAUDE_CONFIG_DIR.split(','));
  dirs.push(path.join(HOME, '.claude'), path.join(HOME, '.config', 'claude'));
  return dirs;
}

async function detect() {
  const dir = await u.firstExisting(dataDirs().map((d) => path.join(d, 'projects')));
  const bin = await u.findBinary(['claude']);
  return {
    detected: !!(dir || bin),
    evidence: [bin && 'claude command', dir && u.tilde(path.dirname(dir))].filter(Boolean).join(', '),
    lastActive: dir ? await u.mtime(dir) : null,
  };
}

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

async function readCredentials() {
  for (const d of dataDirs()) {
    const p = path.join(d, '.credentials.json');
    if (await u.exists(p)) return JSON.parse(await u.fsp.readFile(p, 'utf8'));
  }
  if (process.platform === 'darwin') {
    const raw = await new Promise((resolve, reject) => {
      execFile('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 60000 }, (err, stdout) => (err ? reject(new Error('Keychain access was not granted')) : resolve(stdout)));
    });
    return JSON.parse(raw.trim());
  }
  throw new Error('Claude Code is not signed in');
}

async function fetchLive(now) {
  if (now - live.at < 5 * 60 * 1000 && (live.data || live.error)) return live;
  live = { at: now, data: null, error: null, plan: null };
  try {
    const creds = await readCredentials();
    const oauth = creds.claudeAiOauth || {};
    if (!oauth.accessToken) throw new Error('Claude Code is signed in with an API key, which has no plan limits');
    live.plan = oauth.subscriptionType || null;
    if (oauth.expiresAt && oauth.expiresAt < now) throw new Error('Sign-in expired. Open Claude Code once, then refresh');
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: 'Bearer ' + oauth.accessToken,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'headroom',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401) throw new Error('Sign-in expired. Open Claude Code once, then refresh');
    if (!res.ok) throw new Error('Anthropic returned ' + res.status);
    live.data = await res.json();
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

async function read({ settings, now }) {
  const dirs = [];
  for (const d of dataDirs()) {
    const p = path.join(d, 'projects');
    if (await u.exists(p)) dirs.push(p);
  }
  const since = now - 7 * DAY;
  let files = [];
  for (const d of dirs) files.push(...(await u.walk(d, { since, depth: 4 })));
  u.pruneCache(cache, files);

  const seen = new Map();
  for (const f of files) {
    for (const e of await u.cached(cache, f, parseFile)) {
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

  const out = { windows: [], stats, plan: null, note: null, action: null, lock: null };

  if (settings.claudeLive) {
    const l = await fetchLive(now);
    if (l.plan) out.plan = l.plan[0].toUpperCase() + l.plan.slice(1);
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

function resetLive() { live = { at: 0, data: null, error: null }; }

module.exports = { id: 'claude', name: 'Claude Code', mark: 'Cl', detect, read, resetLive };
