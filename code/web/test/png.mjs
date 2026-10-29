// A tiny PNG reader for the tests (8-bit, RGBA or RGB, not interlaced): enough to run the tracer on real picture files in Node.
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(path) {
  const b = readFileSync(path);
  let o = 8, w = 0, h = 0, type = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), name = b.toString('ascii', o + 4, o + 8), body = b.subarray(o + 8, o + 8 + len);
    if (name === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); type = body[9]; if (body[8] !== 8 || body[12] !== 0) throw new Error('only 8-bit, non-interlaced PNG'); }
    else if (name === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : type === 0 ? 1 : 0;
  if (!bpp) throw new Error(`PNG colour type ${type} is not supported`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const px = new Uint8Array(w * h * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, up = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let add = 0;
      if (f === 1) add = a; else if (f === 2) add = up; else if (f === 3) add = (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = (v + add) & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (bpp === 4) data.set(px.subarray(i * 4, i * 4 + 4), i * 4);
    else if (bpp === 3) { data.set(px.subarray(i * 3, i * 3 + 3), i * 4); data[i * 4 + 3] = 255; }
    else { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = px[i]; data[i * 4 + 3] = 255; }
  }
  return { data, w, h };
}

/** The same picture mirrored left-to-right. */
export function flipPng({ data, w, h }) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return { data: out, w, h };
}
