// Agents without a dedicated reader (Kimi, DeepSeek). Token counts are picked
// out of whatever session logs the agent writes, so treat them as estimates.
const u = require('./util');
const { path, HOME, DAY } = u;

const IN = /"(?:input_tokens|prompt_tokens|input_other|inputTokens|promptTokens)"\s*:\s*(\d+)/g;
const OUT = /"(?:output_tokens|completion_tokens|outputTokens|completionTokens)"\s*:\s*(\d+)/g;
const TS = /"(?:timestamp|created_at|createdAt|time)"\s*:\s*(?:"([^"]+)"|(\d{10,13}(?:\.\d+)?))/;

function sumAll(re, line) {
  let n = 0;
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(line))) n += Number(m[1]);
  return n;
}

function make({ id, name, mark, dirs, bins }) {
  const cache = new Map();
  const roots = () => dirs.map((d) => path.join(HOME, ...d));

  async function detect() {
    const dir = await u.firstExisting(roots());
    const bin = await u.findBinary(bins);
    return {
      detected: !!(dir || bin),
      evidence: [bin && `${bins[0]} command`, dir && u.tilde(dir)].filter(Boolean).join(', '),
      lastActive: dir ? await u.mtime(dir) : null,
    };
  }

  async function parseFile(file) {
    const events = [];
    const fallback = (await u.mtime(file)) || Date.now();
    await u.eachLine(file, 'tokens', (line) => {
      const tok = sumAll(IN, line) + sumAll(OUT, line);
      if (!tok) return;
      const m = line.match(TS);
      let t = fallback;
      if (m) {
        const parsed = m[1] ? Date.parse(m[1]) : Number(m[2]) * (m[2].length <= 11 ? 1000 : 1);
        if (parsed > 0) t = parsed;
      }
      events.push({ t, tok });
    });
    return events;
  }

  async function read({ now }) {
    const since = now - 7 * DAY;
    const files = [];
    for (const r of roots()) {
      files.push(...(await u.walk(r, { since, exts: ['.jsonl', '.json'], depth: 5, max: 200, maxSize: 32 * 1024 * 1024 })));
    }
    u.pruneCache(cache, files);
    const events = [];
    for (const f of files) events.push(...(await u.cached(cache, f, parseFile)));

    const today = u.startOfDay(now);
    const sum = (from) => events.reduce((n, e) => (e.t >= from ? n + e.tok : n), 0);
    const out = {
      windows: [], plan: null, action: null, lock: null,
      stats: [
        { value: sum(today), label: 'tokens today' },
        { value: sum(since), label: 'tokens in 7 days' },
      ],
      note: `Estimated from ${name}'s local session logs. ${name} does not publish plan limits to read.`,
    };
    if (!events.length) out.empty = `No ${name} token usage found in the last 7 days.`;
    return out;
  }

  return { id, name, mark, detect, read };
}

module.exports = {
  make,
  kimi: make({ id: 'kimi', name: 'Kimi', mark: 'Ki', dirs: [['.kimi'], ['.config', 'kimi']], bins: ['kimi'] }),
  deepseek: make({
    id: 'deepseek', name: 'DeepSeek', mark: 'Ds',
    dirs: [['.deepseek'], ['.deepseek-cli'], ['.config', 'deepseek']], bins: ['deepseek', 'deepseek-cli', 'dsk'],
  }),
};
