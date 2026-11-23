// Gemini CLI. Quota is counted in requests per day and resets at midnight
// Pacific. The allowance depends on the account, so only the count is shown.
const u = require('./util');
const { path, HOME, DAY } = u;

const cache = new Map();
const root = () => path.join(HOME, '.gemini');

async function detect() {
  const bin = await u.findBinary(['gemini']);
  const tmp = (await u.exists(path.join(root(), 'tmp'))) ? path.join(root(), 'tmp') : null;
  const settings = await u.exists(path.join(root(), 'settings.json'));
  return {
    detected: !!(bin || tmp || settings),
    evidence: [bin && 'gemini command', (tmp || settings) && '~/.gemini'].filter(Boolean).join(', '),
    lastActive: tmp ? await u.mtime(tmp) : null,
  };
}

// Milliseconds since the last midnight in Los Angeles.
function sincePacificMidnight(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(now));
  const get = (t) => Number(parts.find((p) => p.type === t).value) % 24;
  return ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000;
}

async function parseFile(file) {
  const out = [];
  let messages = [];
  const raw = await u.fsp.readFile(file, 'utf8');
  try {
    const doc = JSON.parse(raw);
    messages = Array.isArray(doc) ? doc : doc.messages || [];
  } catch {
    for (const line of raw.split('\n')) {
      try { messages.push(JSON.parse(line)); } catch {}
    }
  }
  for (const m of messages) {
    const tk = m && m.tokens;
    if (!tk) continue;
    const t = Date.parse(m.timestamp);
    if (!t) continue;
    out.push({ t, tok: (tk.input || 0) - (tk.cached || 0) + (tk.output || 0) + (tk.thoughts || 0) });
  }
  return out;
}

async function read({ now }) {
  const since = now - 7 * DAY;
  const files = (await u.walk(path.join(root(), 'tmp'), { since, depth: 3, exts: ['.json', '.jsonl'], maxSize: 64 * 1024 * 1024 }))
    .filter((f) => f.file.includes(`${path.sep}chats${path.sep}`));
  u.pruneCache(cache, files);
  const events = [];
  for (const f of files) events.push(...(await u.cached(cache, f, parseFile)));

  const elapsed = sincePacificMidnight(now);
  const dayStart = now - elapsed;
  const today = events.filter((e) => e.t >= dayStart);
  const out = {
    windows: [{ id: 'day', label: 'daily quota', lengthMs: DAY, usedPct: null, resetsAt: dayStart + DAY, exact: true }],
    stats: [
      { value: today.length, label: 'requests today' },
      { value: today.reduce((n, e) => n + e.tok, 0), label: 'tokens today' },
      { value: events.filter((e) => e.t >= since).length, label: 'requests in 7 days' },
    ],
    plan: null, action: null, lock: null,
    note: 'Gemini counts requests per day. Your allowance depends on your account, so no percentage is shown.',
  };
  if (!events.length) out.empty = 'No Gemini CLI sessions in the last 7 days.';
  return out;
}

module.exports = { id: 'gemini', name: 'Gemini CLI', mark: 'Ge', detect, read };
