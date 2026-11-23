# Adding an agent

An agent is one file in `src/main/providers` that answers two questions: is this agent installed, and what has it used?

## 1. Find out what the agent writes to disk

Use the agent for a few turns, then look in its config folder (usually a dot-folder in your home directory). You are looking for, in order of value:

1. **Limit percentages and reset times.** Codex writes these on every turn. This is the best case.
2. **Token or request counts with timestamps.** Enough for "tokens today".
3. **Quota errors with a reset time** in a log. Enough to show a lockout.

If none of those exist, the agent can still be detected and listed; say plainly in `note` what is missing.

## 2. Write the provider

```js
// src/main/providers/example.js
const u = require('./util');
const { path, HOME, DAY } = u;

const cache = new Map();
const root = () => path.join(HOME, '.example');

async function detect() {
  const dir = (await u.exists(root())) ? root() : null;
  const bin = await u.findBinary(['example']);
  return {
    detected: !!(dir || bin),
    evidence: [bin && 'example command', dir && u.tilde(dir)].filter(Boolean).join(', '),
    lastActive: dir ? await u.mtime(dir) : null,
  };
}

async function parseFile(file) {
  const events = [];
  await u.eachLine(file, '"usage"', (line) => {
    const d = JSON.parse(line);
    events.push({ t: Date.parse(d.timestamp), tok: d.usage.input + d.usage.output });
  });
  return events;
}

async function read({ now }) {
  const files = await u.walk(path.join(root(), 'sessions'), { since: now - 7 * DAY });
  u.pruneCache(cache, files);
  const events = [];
  for (const f of files) events.push(...(await u.cached(cache, f, parseFile)));

  const today = u.startOfDay(now);
  return {
    windows: [],
    stats: [{ value: events.filter((e) => e.t >= today).reduce((n, e) => n + e.tok, 0), label: 'tokens today' }],
    plan: null, lock: null, action: null,
    note: 'Example publishes no plan limits, so only tokens are shown.',
  };
}

module.exports = { id: 'example', name: 'Example', mark: 'Ex', detect, read };
```

Then add it to the `PROVIDERS` list in `src/main/providers/index.js`. The order of that list is the order agents appear in.

### What `read` returns

| Field | Meaning |
| --- | --- |
| `windows` | Limits. Each is `{ id, label, usedPct, resetsAt, lengthMs, exact }`. `usedPct` is 0 to 100, or `null` when only the reset time is known. `resetsAt` is a millisecond timestamp or `null`. `label` reads naturally after "of", for example `5-hour window` or `weekly limit`. |
| `stats` | Counts, most relevant first: `{ value, label }`, shown as "1.2M tokens today". |
| `plan` | Plan name if the agent records it, else `null`. |
| `lock` | `{ until, what }` when the agent is locked out right now, else `null`. |
| `note` | One plain sentence about where the numbers come from or what is missing. |
| `empty` | Set when there is nothing to show, for example "No sessions in the last 7 days." |
| `asOf` | Timestamp of the data, when it can be stale. |

The number in the bar is chosen from this by `headline()` in `providers/index.js`: an active lock first, then the most-used window, then the first non-zero stat.

### Rules for readers

- **Take `now` from the argument.** Never call `Date.now()` inside `read`; tests pass a fixed time.
- **Stream, filter, cache.** Session logs get large. Use `u.eachLine` with a needle so most lines are skipped before `JSON.parse`, and `u.cached` so unchanged files are not re-read. A refresh runs every minute and should take milliseconds.
- **Be forgiving.** Formats change. A line you cannot parse is skipped, not fatal.
- **Read only.** Never write to the agent's folder.
- **No network and no credentials** unless it is opt-in and discussed in an issue first.
- **Cross-platform paths.** Build paths with `path.join`; check where the agent keeps its data on Windows and Linux too.

## 3. Add its icon

Put a square SVG at `src/renderer/icons/<id>.svg` and add the id to `BRANDED` in `src/renderer/app.js`. Without an icon, the two-letter `mark` is shown. Record where the icon came from in `THIRD_PARTY_NOTICES.md`.

## 4. Test it

Copy `test/codex.test.js` as a starting point. Build a small synthetic fixture with the `jsonl` or `write` helpers, then assert on what `read` returns. Cover at least: detection, the main numbers, and one awkward case (duplicates, a rolled-over window, a malformed line).

```bash
npm test
```

## 5. Document it

Add a row to the table in the README saying what the agent can and cannot show.
