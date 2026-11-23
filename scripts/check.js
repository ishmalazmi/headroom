// Syntax-check every source file. Cheap guard that runs anywhere Node does.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
  });
}

const all = ['src', 'test', 'scripts'].flatMap((d) => files(path.join(__dirname, '..', d)));
for (const f of all) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`${all.length} files OK`);
