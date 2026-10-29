import test from 'node:test';
import assert from 'node:assert/strict';
import { traceSilhouette, boundary, simplify, otsu } from '../js/core/trace.js';

const W = 120, H = 90;
// white page with a shape painted by predicate (colour c)
function picture(pred, { bg = [255, 255, 255], c = [200, 40, 40], alpha = false } = {}) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, on = pred(x, y);
    const col = on ? c : bg;
    data.set([...col, alpha && !on ? 0 : 255], i);
  }
  return { data, w: W, h: H };
}
const polyArea = (p) => Math.abs(p.slice(0, -1).reduce((a, [x, y], i) => { const [x2, y2] = p[i + 1]; return a + (x * y2 - x2 * y); }, 0) / 2);
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

test('a rectangle on a plain background is outlined with its true size and position', () => {
  const r = traceSilhouette(picture(rect(30, 20, 90, 70)));
  assert.ok(r.ok, r.reason);
  const xs = r.pts.map((p) => p[0] * W), ys = r.pts.map((p) => p[1] * H);
  assert.ok(Math.abs(Math.min(...xs) - 30) <= 1.5 && Math.abs(Math.max(...xs) - 90) <= 1.5);
  assert.ok(Math.abs(Math.min(...ys) - 20) <= 1.5 && Math.abs(Math.max(...ys) - 70) <= 1.5);
  assert.ok(r.pts.length <= 12, `simplified: ${r.pts.length} points`);
  assert.deepEqual(r.pts[0], r.pts[r.pts.length - 1]); // closed
});

test('a circle keeps its area and an L shape keeps its notch', () => {
  const c = traceSilhouette(picture((x, y) => (x - 60) ** 2 + (y - 45) ** 2 < 30 * 30));
  assert.ok(c.ok);
  const real = Math.PI * 900, got = polyArea(c.pts.map(([x, y]) => [x * W, y * H]));
  assert.ok(Math.abs(got - real) / real < 0.06, `${got} vs ${real}`);
  const L = traceSilhouette(picture((x, y) => rect(20, 10, 50, 80)(x, y) || rect(20, 50, 100, 80)(x, y)));
  assert.ok(L.ok);
  const a = polyArea(L.pts.map(([x, y]) => [x * W, y * H]));
  assert.ok(Math.abs(a - (30 * 70 + 50 * 30)) / (30 * 70 + 50 * 30) < 0.05, `L area ${a}`);
});

test('holes are filled, specks are ignored, and only the largest object counts', () => {
  const pred = (x, y) => (rect(20, 15, 80, 75)(x, y) && !rect(40, 35, 60, 55)(x, y)) || rect(100, 5, 103, 8)(x, y) || rect(90, 80, 95, 85)(x, y);
  const r = traceSilhouette(picture(pred));
  assert.ok(r.ok);
  const a = polyArea(r.pts.map(([x, y]) => [x * W, y * H]));
  assert.ok(Math.abs(a - 60 * 60) / 3600 < 0.06, `area ${a} (hole must be filled)`);
});

test('dark-on-light and light-on-dark modes, and transparent cut-outs', () => {
  const dark = traceSilhouette(picture(rect(30, 20, 90, 70), { c: [20, 20, 20] }), { mode: 'dark' });
  assert.ok(dark.ok);
  const light = traceSilhouette(picture(rect(30, 20, 90, 70), { bg: [10, 10, 10], c: [240, 240, 240] }), { mode: 'light' });
  assert.ok(light.ok);
  const cut = traceSilhouette(picture(rect(30, 20, 90, 70), { alpha: true }));
  assert.ok(cut.ok);
  for (const r of [dark, light, cut]) assert.ok(Math.abs(polyArea(r.pts.map(([x, y]) => [x * W, y * H])) - 3000) / 3000 < 0.06);
});

test('an empty or all-object picture gives a helpful reason instead of a shape', () => {
  assert.equal(traceSilhouette(picture(() => false)).ok, false);
  const all = traceSilhouette(picture(() => true));
  assert.equal(all.ok, false);
  assert.ok(all.reason.length > 10);
});

test('helpers: otsu splits two clusters, simplify keeps corners and drops straight runs', () => {
  const h = new Array(256).fill(0); h[40] = 100; h[200] = 100;
  const t = otsu(h); assert.ok(t >= 40 && t < 200);
  const ring = [];
  for (let x = 0; x < 20; x++) ring.push([x, 0]);
  for (let y = 0; y < 20; y++) ring.push([20, y]);
  for (let x = 20; x > 0; x--) ring.push([x, 20]);
  for (let y = 20; y > 0; y--) ring.push([0, y]);
  const s = simplify(ring, 0.5);
  assert.ok(s.length >= 4 && s.length <= 6, `${s.length}`);
});

// ------------------------------------------------------------- real-photo conditions
// a deterministic pseudo-random noise source, so the tests are repeatable
function rng(seed = 7) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }
/** Like picture(), with a background colour that varies over the picture and per-pixel noise. */
function photo(pred, { bgAt, c = [150, 60, 50], noise = 18, seed = 7 } = {}) {
  const rand = rng(seed);
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const col = pred(x, y) ? c : bgAt(x, y);
    const n = (rand() - 0.5) * 2 * noise;
    data.set([col[0] + n, col[1] + n, col[2] + n, 255], (y * W + x) * 4);
  }
  return { data, w: W, h: H };
}
const areaOf = (r) => polyArea(r.pts.map(([x, y]) => [x * W, y * H]));

test('an object on an unevenly lit background (gradient + vignette) is still outlined', () => {
  const bgAt = (x, y) => { const v = 250 - 90 * (x / W) - 40 * ((y - H / 2) / H) ** 2 * 4; return [v, v, v - 5]; };
  const r = traceSilhouette(photo(rect(35, 20, 85, 70), { bgAt }));
  assert.ok(r.ok, r.reason);
  const a = areaOf(r);
  assert.ok(Math.abs(a - 2500) / 2500 < 0.12, `area ${a} vs 2500`);
});

test('camera noise does not break the outline into specks or swallow the background', () => {
  const bgAt = () => [225, 222, 215];
  const r = traceSilhouette(photo((x, y) => (x - 60) ** 2 + (y - 45) ** 2 < 28 * 28, { bgAt, c: [90, 85, 80], noise: 40 }));
  assert.ok(r.ok, r.reason);
  const a = areaOf(r), real = Math.PI * 28 * 28;
  assert.ok(Math.abs(a - real) / real < 0.12, `area ${a} vs ${real}`);
});

test('a background that is darker on one side than the object is on the other still finds the object', () => {
  // the left edge is darker than the (mid-grey) object, the right edge is much lighter: one global colour fails
  const bgAt = (x) => { const v = 70 + 180 * (x / W); return [v, v, v]; };
  const r = traceSilhouette(photo(rect(45, 25, 75, 65), { bgAt, c: [130, 40, 40], noise: 8 }));
  assert.ok(r.ok, r.reason);
  const a = areaOf(r);
  assert.ok(Math.abs(a - 1200) / 1200 < 0.15, `area ${a} vs 1200`);
});
