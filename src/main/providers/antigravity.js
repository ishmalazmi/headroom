// Antigravity. It keeps no usage meter on disk, so this reports activity
// (conversations touched) and any quota lockout written to its logs.
const u = require('./util');
const { path, HOME, DAY } = u;

function roots() {
  return [path.join(HOME, '.gemini', 'antigravity-cli'), path.join(HOME, '.gemini', 'antigravity'), path.join(HOME, '.antigravity')];
}

async function appPath() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Antigravity.app', path.join(HOME, 'Applications', 'Antigravity.app')]
    : process.platform === 'win32'
      ? [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity')]
      : ['/usr/share/antigravity', '/opt/Antigravity'];
  return u.firstExisting(candidates);
}

async function detect() {
  const dir = await u.firstExisting(roots());
  const app = await appPath();
  const bin = await u.findBinary(['antigravity', 'agy']);
  return {
    detected: !!(dir || app || bin),
    evidence: [app && 'Antigravity app', bin && 'antigravity command', dir && u.tilde(dir)].filter(Boolean).join(', '),
    lastActive: dir ? await u.mtime(path.join(dir, 'conversations')) || await u.mtime(dir) : null,
  };
}

async function findLock(dir, now) {
  const logs = [{ file: path.join(dir, 'cli.log') }, ...(await u.walk(path.join(dir, 'log'), { since: now - 8 * DAY, exts: ['.log'], depth: 1, max: 4 }))];
  let best = null;
  for (const l of logs) {
    const text = await u.readTail(l.file, 400 * 1024);
    const re = /"quotaResetTimeStamp":\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) {
      const until = Date.parse(m[1]);
      if (!until || until <= now) continue;
      const before = text.slice(Math.max(0, m.index - 400), m.index);
      const model = (before.match(/"model":\s*"([^"]+)"/g) || []).pop();
      if (!best || until > best.until) best = { until, what: model ? model.replace(/.*"([^"]+)"$/, '$1') : null };
    }
  }
  return best;
}

async function read({ now }) {
  const dir = await u.firstExisting(roots());
  const out = {
    windows: [], stats: [], plan: null, action: null, lock: null,
    note: 'Antigravity keeps no usage meter on disk. Headroom shows activity and quota lockouts.',
  };
  if (!dir) { out.empty = 'Antigravity is installed but has not been used yet.'; return out; }

  const convs = await u.walk(path.join(dir, 'conversations'), { since: now - 7 * DAY, exts: ['.db', '.pb', '.json'], depth: 1, max: 5000 });
  const today = u.startOfDay(now);
  out.stats = [
    { value: convs.filter((c) => c.mtimeMs >= today).length, label: 'conversations today' },
    { value: convs.length, label: 'conversations in 7 days' },
  ];
  out.lock = await findLock(dir, now);
  if (!convs.length && !out.lock) out.empty = 'No Antigravity activity in the last 7 days.';
  return out;
}

module.exports = { id: 'antigravity', name: 'Antigravity', mark: 'Ag', detect, read };
