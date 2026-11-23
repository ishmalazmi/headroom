const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { png, ring, digits } = require('../src/main/trayIcon');

const alpha = (buf, size, x, y) => buf[(y * size + x) * 4 + 3];

test('png writes a valid header and all pixel rows', () => {
  const out = png(3, 2, Buffer.alloc(3 * 2 * 4, 255));
  assert.deepEqual([...out.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(out.readUInt32BE(16), 3);
  assert.equal(out.readUInt32BE(20), 2);
  const idatAt = out.indexOf('IDAT');
  const len = out.readUInt32BE(idatAt - 4);
  const raw = zlib.inflateSync(out.subarray(idatAt + 4, idatAt + 4 + len));
  assert.equal(raw.length, (3 * 4 + 1) * 2);
});

test('ring fills clockwise from the top', () => {
  const size = 36;
  const buf = ring(size, 50, [0, 0, 0], null);
  assert.equal(alpha(buf, size, 30, 18), 255, 'right side is filled at 50%');
  const left = alpha(buf, size, 5, 18);
  assert.ok(left > 40 && left < 120, 'left side is the dim track');
  assert.equal(alpha(buf, size, 18, 18), 0, 'centre is empty');
});

test('ring with no value is an even, dim circle', () => {
  const buf = ring(36, null, [0, 0, 0], null);
  assert.equal(alpha(buf, 36, 30, 18), alpha(buf, 36, 5, 18));
});

test('digits draws something for any percentage', () => {
  for (const pct of [0, 7, 42, 100]) {
    const buf = digits(32, pct, [255, 255, 255], null);
    let opaque = 0;
    for (let i = 3; i < buf.length; i += 4) if (buf[i] === 255) opaque++;
    assert.ok(opaque > 20, `pct ${pct}`);
  }
});
