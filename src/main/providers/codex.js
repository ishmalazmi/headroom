// Codex. Every turn writes a token_count event with the plan's rate limits to
// the session log, so limits are exact as of the last turn and need no network.
const u = require('./util');
const { path, HOME, HOUR, DAY } = u;

const cache = new Map();

function home() {
  return process.env.CODEX_HOME || path.join(HOME, '.codex');
}

async function detect() {
  const dir = (await u.exists(home())) ? home() : null;
  const bin = await u.findBinary(['codex']);
  return {
    detected: !!(dir || bin),
    evidence: [bin && 'codex command', dir && u.tilde(dir)].filter(Boolean).join(', '),
    lastActive: dir ? Math.max((await u.mtime(path.join(dir, 'sessions'))) || 0, (await u.mtime(dir)) || 0) || null : null,
  };
}

const fresh = (t) => (t ? (t.input_tokens || 0) - (t.cached_input_tokens || 0) + (t.output_tokens || 0) : 0);

async function parseFile(file) {
  const events = [];
  let rate = null;
  let prev = 0;
  await u.eachLine(file, '"token_count"', (line) => {
    const d = JSON.parse(line);
    const p = d.payload;
    if (!p || p.type !== 'token_count') return;
    const t = Date.parse(d.timestamp);
    if (!t) return;
    const total = fresh(p.info && p.info.total_token_usage);
    if (total > prev) events.push({ t, tok: total - prev });
    if (total) prev = total;
    if (p.rate_limits && (p.rate_limits.primary || p.rate_limits.secondary)) rate = { t, limits: p.rate_limits };
  });
  return { events, rate };
}

function windowLabel(mins) {
  if (mins === 300) return '5-hour window';
  if (mins === 10080) return 'weekly limit';
  if (mins && mins % 1440 === 0) return `${mins / 1440}-day limit`;
  if (mins && mins % 60 === 0) return `${mins / 60}-hour window`;
  return 'limit';
}

function toWindow(id, w, asOf, now) {
  if (!w || w.used_percent == null) return null;
  const lengthMs = (w.window_minutes || 0) * 60000;
  let resetsAt = w.resets_at ? w.resets_at * 1000
    : w.resets_in_seconds != null ? asOf + w.resets_in_seconds * 1000 : null;
  let usedPct = Number(w.used_percent);
  // The window rolled over since Codex last ran.
  if (resetsAt && resetsAt <= now) { usedPct = 0; resetsAt = null; }
  return { id, label: windowLabel(w.window_minutes), lengthMs, usedPct, resetsAt, exact: true };
}

async function read({ now }) {
  const since = now - 7 * DAY;
  const files = await u.walk(path.join(home(), 'sessions'), { since: since - DAY, depth: 4 });
  u.pruneCache(cache, files);

  let rate = null;
  const events = [];
  for (const f of files) {
    const parsed = await u.cached(cache, f, parseFile);
    events.push(...parsed.events);
    if (parsed.rate && (!rate || parsed.rate.t > rate.t)) rate = parsed.rate;
  }

  const today = u.startOfDay(now);
  const sum = (from) => events.reduce((n, e) => (e.t >= from ? n + e.tok : n), 0);
  const out = {
    windows: [], plan: null, note: null, action: null, lock: null,
    stats: [
      { value: sum(today), label: 'tokens today' },
      { value: sum(since), label: 'tokens in 7 days' },
    ],
  };

  if (rate) {
    const l = rate.limits;
    out.windows = [toWindow('session', l.primary, rate.t, now), toWindow('week', l.secondary, rate.t, now)].filter(Boolean);
    if (l.plan_type) out.plan = l.plan_type[0].toUpperCase() + l.plan_type.slice(1);
    out.asOf = rate.t;
    if (now - rate.t > 10 * 60000) out.note = 'Limits are as of your last Codex turn.';
  } else if (!events.length) {
    out.empty = 'No Codex sessions in the last 7 days.';
  }
  return out;
}

module.exports = { id: 'codex', name: 'Codex', mark: 'Cx', detect, read };
