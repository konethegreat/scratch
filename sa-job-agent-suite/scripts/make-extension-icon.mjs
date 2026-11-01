// Draw the extension icon without a graphics dependency: a light tile, a teal
// ring and a small ink dot, written as a 128 px RGBA PNG.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 128;
const BACKGROUND = [247, 245, 240, 255];
const RING = [15, 118, 110, 255];
const DOT = [28, 27, 25, 255];

const table = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  table[index] = value >>> 0;
}
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const centre = (SIZE - 1) / 2;
const rows = [];
for (let y = 0; y < SIZE; y += 1) {
  const row = Buffer.alloc(1 + SIZE * 4);
  for (let x = 0; x < SIZE; x += 1) {
    const distance = Math.hypot(x - centre, y - centre);
    const onRing = distance <= 48 && distance >= 38;
    const onDot = distance <= 9;
    const colour = onDot ? DOT : onRing ? RING : BACKGROUND;
    row.set(colour, 1 + x * 4);
  }
  rows.push(row);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(path.resolve(import.meta.dirname, '..'), 'extension/icons/icon-128.png');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, png);
console.log(`wrote ${path.relative(process.cwd(), out)} (${png.length} bytes)`);
