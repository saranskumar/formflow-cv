import test from 'node:test';
import assert from 'node:assert/strict';
import { Poly, meshVolume } from '../js/core/shapes.js';
import { buildHull } from '../js/core/hull.js';
import { assignViews } from '../js/ui/refimages.js';

const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} not within ${tol * 100}% of ${b}`);
const loop = (pts) => [...pts, pts[0]];
const front = (pts, z = 0) => new Poly('free', loop(pts).map(([x, y]) => [x, y, z]), true);
const side = (pts, x = 0) => new Poly('free', loop(pts).map(([zz, y]) => [x, y, zz]), true);
const top = (pts, y = 0) => new Poly('free', loop(pts).map(([x, zz]) => [x, y, zz]), true);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---------------------------------------------------------------- one view, round object
test('one front outline of a rectangle spun round makes a cylinder', () => {
  const r = buildHull([front(rect(-0.5, -0.6, 0.5, 0.6))], { n: 64, revolve: true });
  assert.ok(r.ok, r.reason);
  assert.ok(r.stats.round);
  rel(meshVolume(r.mesh), Math.PI * 0.25 * 1.2, 0.08);
  const box = buildHull([front(rect(-0.5, -0.6, 0.5, 0.6))], { n: 64 }); // without it: a slab, and it says how to get a round one
  assert.ok(!box.stats.round && box.stats.warnings.some((w) => /Round/.test(w)));
});

test('a triangle spun round makes a cone, a side outline works too, and the result is centred on the outline', () => {
  const tri = [[-0.5, -0.5], [0.5, -0.5], [0, 0.7]];
  const r = buildHull([front(tri)], { n: 64, revolve: true });
  assert.ok(r.ok);
  rel(meshVolume(r.mesh), (Math.PI * 0.25 * 1.2) / 3, 0.12);
  const v = r.mesh.v;
  let zs = 0, cnt = 0;
  for (let i = 2; i < v.length; i += 3) { zs += v[i]; cnt++; }
  assert.ok(Math.abs(zs / cnt) < 0.03, 'centred on the drawing plane');
  const s = buildHull([side(rect(-0.3, -0.5, 0.3, 0.5))], { n: 64, revolve: true });
  assert.ok(s.ok && s.stats.round);
  rel(meshVolume(s.mesh), Math.PI * 0.09 * 1.0, 0.1);
});

test('round only applies to a single Front or Side view', () => {
  const t = buildHull([top(rect(-0.5, -0.5, 0.5, 0.5))], { n: 48, revolve: true });
  assert.ok(t.ok && !t.stats.round, 'a top view alone is extruded');
  const two = buildHull([front(rect(-0.5, -0.5, 0.5, 0.5)), side(rect(-0.3, -0.5, 0.3, 0.5))], { n: 48, revolve: true });
  assert.ok(two.ok && !two.stats.round, 'two views make a true hull');
});

// ---------------------------------------------------------------- which photo goes on which view
test('photos are matched to views by their file names, the rest fill the empty views in order', () => {
  assert.deepEqual(assignViews(['mug_side.jpg', 'mug-FRONT.png', 'mug top.webp']), [['side', 0], ['front', 1], ['top', 2]]);
  assert.deepEqual(assignViews(['a.jpg', 'b.jpg']), [['front', 0], ['side', 1]]);
  assert.deepEqual(assignViews(['left.jpg', 'plan.jpg', 'x.jpg']), [['side', 0], ['top', 1], ['front', 2]]);
  assert.deepEqual(assignViews(['a.jpg', 'b.jpg'], ['front']), [['side', 0], ['top', 1]], 'views that already have a photo are skipped');
  assert.deepEqual(assignViews(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']).length, 3, 'at most three');
  assert.deepEqual(assignViews(['front1.jpg', 'front2.jpg']), [['front', 0], ['side', 1]], 'two "front"s: the second takes a free view');
  assert.deepEqual(assignViews(['a.jpg'], ['front', 'side', 'top']), [['front', 0]], 'all full: replace the front');
});
