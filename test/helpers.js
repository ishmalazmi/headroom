// Every test file runs in its own process, so each gets a private, empty home
// folder. Require this before any provider so they resolve paths inside it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'headroom-test-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));

const HOUR = 36e5;
const DAY = 864e5;
// A fixed "now" in the past, so results don't depend on when the tests run.
const NOW = new Date(2026, 0, 15, 12, 17, 0).getTime();
const iso = (t) => new Date(t).toISOString();

function write(rel, content) {
  const file = path.join(home, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const jsonl = (rel, rows) => write(rel, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const stat = (usage, label) => (usage.stats.find((s) => s.label === label) || {}).value;

module.exports = { home, HOUR, DAY, NOW, iso, write, jsonl, stat };
