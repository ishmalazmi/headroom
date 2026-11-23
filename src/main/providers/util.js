const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const readline = require('readline');

const HOME = os.homedir();
const HOUR = 36e5;
const DAY = 864e5;
const WIN = process.platform === 'win32';

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function mtime(p) {
  try { return (await fsp.stat(p)).mtimeMs; } catch { return null; }
}

async function firstExisting(paths) {
  for (const p of paths) if (p && (await exists(p))) return p;
  return null;
}

// Apps launched from the dock or Start menu don't inherit the shell PATH,
// so look in the usual install locations as well.
let binDirCache = null;
function binDirs() {
  if (binDirCache) return binDirCache;
  const dirs = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  const add = (...p) => dirs.add(path.join(...p));
  if (WIN) {
    if (process.env.APPDATA) add(process.env.APPDATA, 'npm');
    if (process.env.LOCALAPPDATA) add(process.env.LOCALAPPDATA, 'Programs');
    add(HOME, '.local', 'bin'); add(HOME, '.bun', 'bin'); add(HOME, 'scoop', 'shims');
  } else {
    ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin'].forEach((d) => dirs.add(d));
    add(HOME, '.local', 'bin'); add(HOME, '.bun', 'bin'); add(HOME, '.cargo', 'bin');
    add(HOME, '.npm-global', 'bin'); add(HOME, '.volta', 'bin'); add(HOME, '.deno', 'bin');
    add(HOME, '.claude', 'local');
    try {
      const nvm = path.join(HOME, '.nvm', 'versions', 'node');
      for (const v of fs.readdirSync(nvm)) add(nvm, v, 'bin');
    } catch {}
    try {
      const fnm = path.join(HOME, '.local', 'share', 'fnm', 'node-versions');
      for (const v of fs.readdirSync(fnm)) add(fnm, v, 'installation', 'bin');
    } catch {}
  }
  binDirCache = [...dirs];
  setTimeout(() => { binDirCache = null; }, 5 * 60 * 1000).unref?.();
  return binDirCache;
}

async function findBinary(names) {
  const exts = WIN ? ['.cmd', '.exe', '.ps1', ''] : [''];
  for (const name of names) {
    for (const dir of binDirs()) {
      for (const ext of exts) {
        const p = path.join(dir, name + ext);
        if (await exists(p)) return p;
      }
    }
  }
  return null;
}

// Recently modified files under dir, newest first.
async function walk(dir, { since = 0, exts = ['.jsonl'], depth = 5, max = 600, maxSize = 256 * 1024 * 1024 } = {}) {
  const out = [];
  async function go(d, left) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max * 4) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (left > 0 && e.name !== 'node_modules') await go(p, left - 1);
      } else if (exts.includes(path.extname(e.name))) {
        try {
          const st = await fsp.stat(p);
          if (st.mtimeMs >= since && st.size <= maxSize) out.push({ file: p, mtimeMs: st.mtimeMs, size: st.size });
        } catch {}
      }
    }
  }
  await go(dir, depth);
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out.slice(0, max);
}

// Stream a file line by line; only lines containing `needle` reach fn.
function eachLine(file, needle, fn) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (needle && !line.includes(needle)) return;
      try { fn(line); } catch {}
    });
    rl.on('close', resolve);
    stream.on('error', () => resolve());
  });
}

// Re-parse a file only when it changed on disk.
async function cached(cache, info, parse) {
  const hit = cache.get(info.file);
  if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit.value;
  const value = await parse(info.file);
  cache.set(info.file, { mtimeMs: info.mtimeMs, size: info.size, value });
  return value;
}

function pruneCache(cache, files) {
  const keep = new Set(files.map((f) => f.file));
  for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
}

function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function readTail(file, bytes) {
  try {
    const st = await fsp.stat(file);
    const fh = await fsp.open(file, 'r');
    try {
      const len = Math.min(bytes, st.size);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, st.size - len);
      return buf.toString('utf8');
    } finally { await fh.close(); }
  } catch { return ''; }
}

function tilde(p) {
  return p && p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}

module.exports = {
  fs, fsp, path, HOME, HOUR, DAY, WIN,
  exists, mtime, firstExisting, findBinary, walk, eachLine, cached, pruneCache,
  startOfDay, readTail, tilde,
};
