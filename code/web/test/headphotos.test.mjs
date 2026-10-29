// The three pencil drawings of a head and shoulders in samples/head (front, top, side): the tracer must outline the whole
// figure, not just its strokes, even though the drawing runs off the bottom of the picture; and the three outlines must
// build one closed 3D bust.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readPng } from './png.mjs';
import { traceSilhouette } from '../js/core/trace.js';
import { outlineFromTrace } from '../js/ui/refimages.js';
import { buildHull } from '../js/core/hull.js';
import { meshVolume, Poly } from '../js/core/shapes.js';
import { PLANE_VIEWS } from '../js/core/planes.js';
import { meshHealth } from '../js/core/meshops.js';

const photo = (n) => readPng(fileURLToPath(new URL(`../../samples/head/${n}.png`, import.meta.url)));
const area2 = (pts) => { let a = 0; for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(a) / 2; };

test('each drawing is outlined as a solid figure, filled in from the corners, and the outline is fine enough', () => {
  const want = { front: [0.25, 0.8], top: [0.25, 0.8], side: [0.15, 0.6] }; // the picture fraction the figure covers
  for (const [name, [lo, hi]] of Object.entries(want)) {
    const r = traceSilhouette(photo(name));
    assert.ok(r.ok, `${name}: ${r.reason}`);
    assert.match(r.method, /\+corners$/, `${name}: the figure runs off the picture, so the corner fill is the right one (${r.method})`);
    const a = area2(r.pts);
    assert.ok(a > lo && a < hi, `${name}: covers ${(a * 100).toFixed(0)}% of the picture`);
    assert.ok(r.pts.length >= 25, `${name}: ${r.pts.length} outline points`);
    assert.deepEqual(r.pts[0], r.pts[r.pts.length - 1], 'closed');
  }
});

test('the head is inside its outline, and the empty paper above the shoulders is not', () => {
  const inside = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if ((pts[i][1] > y) !== (pts[j][1] > y) && x < ((pts[j][0] - pts[i][0]) * (y - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c; return c; };
  const front = traceSilhouette(photo('front')).pts;
  assert.ok(inside(front, 0.5, 0.3), 'the middle of the face');
  assert.ok(inside(front, 0.5, 0.95), 'the chest, at the bottom edge');
  assert.ok(!inside(front, 0.1, 0.2), 'paper beside the head');
  assert.ok(!inside(front, 0.9, 0.5), 'paper beside the shoulder');
  const side = traceSilhouette(photo('side')).pts;
  assert.ok(inside(side, 0.5, 0.4), 'the middle of the head, side view');
  assert.ok(!inside(side, 0.9, 0.2), 'paper behind the head');
});

test('front + top + side build one closed bust', () => {
  const views = { front: photo('front'), top: photo('top'), side: photo('side') };
  const items = [];
  for (const [view, px] of Object.entries(views)) {
    const t = traceSilhouette(px);
    const pts = outlineFromTrace(t.pts, { cx: 0, cy: 0, w: 2, aspect: px.w / px.h, flip: false }, PLANE_VIEWS[view]);
    items.push(new Poly('free', pts, true));
  }
  const r = buildHull(items, { n: 64 });
  assert.ok(r.ok, r.reason);
  assert.equal(r.stats.watertight, true);
  for (const [view, iou] of Object.entries(r.stats.iou)) assert.ok(iou > 0.8, `the model re-projects onto the ${view} outline (${iou})`);
  assert.equal(meshHealth(r.mesh).closed, true);
  assert.ok(meshVolume(r.mesh) > 0.05, `volume ${meshVolume(r.mesh)}`);
});
