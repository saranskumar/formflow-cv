import test from 'node:test';
import assert from 'node:assert/strict';
import { Poly, meshVolume } from '../js/core/shapes.js';
import { ImportedMesh } from '../js/core/imported.js';
import { classifyPlane, collectOutlines, describeOutlines, rasterise, buildHull, surfaceNets } from '../js/core/hull.js';
import { sceneToOBJ, sceneToSTL } from '../js/core/exporters.js';
import { Sketch } from '../js/core/sketch.js';

const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} not within ${tol * 100}% of ${b}`);

// outlines on the three orthographic planes (closed: first point repeated)
const loop = (pts) => [...pts, pts[0]];
const front = (pts, z = 0) => new Poly('free', loop(pts).map(([x, y]) => [x, y, z]), true);
const side = (pts, x = 0) => new Poly('free', loop(pts).map(([zz, y]) => [x, y, zz]), true);
const top = (pts, y = 0) => new Poly('free', loop(pts).map(([x, zz]) => [x, y, zz]), true);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ngon = (cx, cy, r, n = 48) => [...Array(n)].map((_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

// L bracket: 1.2 wide, 1.2 high, 0.8 deep. Front is an L; top and side are plain rectangles. Volume = 0.8 * 0.8
const L_FRONT = [[-0.6, -0.6], [0.6, -0.6], [0.6, -0.2], [-0.2, -0.2], [-0.2, 0.6], [-0.6, 0.6]];
const lViews = () => [front(L_FRONT), top(rect(-0.6, -0.4, 0.6, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))];
const L_VOLUME = 0.8 * 0.8;

function edgeStats(mesh) {
  const edges = new Map();
  for (let i = 0; i < mesh.f.length; i += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const key = [mesh.f[i + a], mesh.f[i + b]].sort((x, y) => x - y).join('-');
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  const counts = new Set(edges.values());
  return { counts: [...counts].sort(), edges: edges.size };
}

// ----------------------------------------------------------------------- classification
test('outlines are sorted by the flat plane they were drawn on', () => {
  assert.equal(classifyPlane(front(rect(0, 0, 1, 1)).pts), 'z');
  assert.equal(classifyPlane(side(rect(0, 0, 1, 1)).pts), 'x');
  assert.equal(classifyPlane(top(rect(0, 0, 1, 1)).pts), 'y');
  assert.equal(classifyPlane(front(rect(0, 0, 1, 1), 0.7).pts), 'z'); // the plane may be offset in depth
});

test('oblique, degenerate and 3D strokes are not outlines', () => {
  assert.equal(classifyPlane([[0, 0, 0], [1, 1, 1], [0, 1, 0.5]]), null);
  assert.equal(classifyPlane([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), null); // a straight line is flat along two axes
  assert.equal(classifyPlane([[0, 0, 0], [0.01, 0.01, 0], [0.02, 0, 0]]), null); // a speck
  const tilted = rect(0, 0, 1, 1).map(([x, y]) => [x, y, 0.1 * x]);
  assert.equal(classifyPlane(tilted), null);
  assert.equal(classifyPlane([[0, 0, 0], [1, 0, 0], [0, 1, 0.015]]), 'z'); // slight hand wobble is fine
});

test('open outlines that nearly close are closed for the hull, others are reported', () => {
  const nearly = new Poly('free', ngon(0, 0, 0.5, 60).slice(0, 58).map(([x, y]) => [x, y, 0]), false);
  const wide = new Poly('free', ngon(0, 0, 0.5, 60).slice(0, 30).map(([x, y]) => [x, y, 0]), false);
  const c = collectOutlines([nearly, wide, new Poly('free', [[0, 0, 0], [1, 1, 1], [0, 1, 0.4], [1, 0, 0.9]], true)]);
  assert.equal(c.views.z.length, 1);
  assert.equal(c.autoClosed, 1);
  assert.equal(c.open, 1);
  assert.equal(c.oblique, 1);
});

test('the view summary counts outlines per view', () => {
  const d = describeOutlines([...lViews(), top(rect(-0.2, -0.2, 0.2, 0.2))]);
  assert.deepEqual([d.front, d.side, d.top, d.viewCount], [1, 1, 2, 3]);
  assert.deepEqual(describeOutlines([]), { front: 0, side: 0, top: 0, open: 0, oblique: 0, autoClosed: 0, viewCount: 0 });
});

// ------------------------------------------------------------------------- rasterising
test('a polygon fills about its own area', () => {
  const n = 64, h = 2 / n;
  const m = rasterise([rect(-0.5, -0.25, 0.5, 0.25)], n, -1, -1, h);
  const area = m.reduce((a, b) => a + b, 0) * h * h;
  rel(area, 0.5, 0.05);
  const two = rasterise([rect(-0.9, -0.9, -0.5, -0.5), rect(0.5, 0.5, 0.9, 0.9)], n, -1, -1, h); // unions
  rel(two.reduce((a, b) => a + b, 0) * h * h, 0.32, 0.1);
  const concave = rasterise([L_FRONT], n, -1, -1, h);
  rel(concave.reduce((a, b) => a + b, 0) * h * h, 0.8, 0.05);
});

// ----------------------------------------------------------------------------- the hull
test('three views of an L bracket give an L bracket: volume, watertight, outward', () => {
  const r = buildHull(lViews());
  assert.ok(r.ok, r.reason);
  rel(meshVolume(r.mesh), L_VOLUME, 0.08);
  assert.ok(meshVolume(r.mesh) > 0, 'outward winding');
  const e = edgeStats(r.mesh);
  assert.deepEqual(e.counts, [2], 'every edge is shared by exactly two faces');
  assert.deepEqual(r.stats.views.sort(), ['front', 'side', 'top']);
  for (const v of ['front', 'side', 'top']) assert.ok(r.stats.iou[v] > 0.9, `${v} overlap ${r.stats.iou[v]}`);
});

test('the L really is an L: the cut-out corner is empty and the foot is solid', () => {
  const r = buildHull(lViews());
  const { v, f } = r.mesh;
  const sub = (x, y) => x.map((q, k) => q - y[k]);
  const cross = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const inside = ([px, py, pz]) => { // Moeller-Trumbore ray along +x; a tiny offset avoids hitting edges exactly
    const p = [px, py + 1.3e-4, pz + 0.7e-4], d = [1, 0, 0];
    let hits = 0;
    for (let i = 0; i < f.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map((k) => [v[3 * f[i + k]], v[3 * f[i + k] + 1], v[3 * f[i + k] + 2]]);
      const e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
      if (Math.abs(det) < 1e-12) continue;
      const sv = sub(p, a), u = dot(sv, h) / det;
      if (u < 0 || u > 1) continue;
      const q = cross(sv, e1), w = dot(d, q) / det;
      if (w < 0 || u + w > 1) continue;
      if (dot(e2, q) / det > 1e-9) hits++;
    }
    return hits % 2 === 1;
  };
  assert.ok(inside([0.3, -0.4, 0]), 'foot');
  assert.ok(inside([-0.4, 0.4, 0]), 'upright');
  assert.ok(!inside([0.3, 0.3, 0]), 'cut-out above the foot');
  assert.ok(!inside([0.3, -0.4, 0.7]), 'outside in depth');
});

test('two views are enough', () => {
  const r = buildHull([front(L_FRONT), side(rect(-0.4, -0.6, 0.4, 0.6))]);
  assert.ok(r.ok);
  rel(meshVolume(r.mesh), L_VOLUME, 0.08);
  assert.deepEqual(r.stats.views.sort(), ['front', 'side']);
  assert.deepEqual(edgeStats(r.mesh).counts, [2]);
  for (const pair of [[front(L_FRONT), top(rect(-0.6, -0.4, 0.6, 0.4))], [top(rect(-0.6, -0.4, 0.6, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))]]) {
    assert.ok(buildHull(pair).ok);
  }
});

test('one view is extruded, and the user is told so', () => {
  const r = buildHull([front(rect(-0.5, -0.5, 0.5, 0.5))]);
  assert.ok(r.ok);
  assert.ok(r.stats.warnings.some((w) => /one view/i.test(w)));
  assert.ok(meshVolume(r.mesh) > 0.3 && meshVolume(r.mesh) < 1.0);
  assert.deepEqual(edgeStats(r.mesh).counts, [2]);
});

test('three circles make a rounded solid with the known volume (3 crossed cylinders)', () => {
  const r = buildHull([front(ngon(0, 0, 0.5)), top(ngon(0, 0, 0.5)), side(ngon(0, 0, 0.5))]);
  assert.ok(r.ok);
  rel(meshVolume(r.mesh), 8 * (2 - Math.SQRT2) * 0.5 ** 3, 0.08);
  assert.deepEqual(edgeStats(r.mesh).counts, [2]);
  const { v } = r.mesh;
  for (let i = 0; i < v.length; i += 3) assert.ok(Math.hypot(v[i], v[i + 1], v[i + 2]) < 0.62); // nothing sticks out
});

test('sloppy drawings are aligned: the views end up agreeing with the result, which they do not without alignment', () => {
  const sloppy = [front(L_FRONT), top(rect(-0.8, -0.4, 0.8, 0.4)), side(rect(-0.3, -0.6, 0.5, 0.6))]; // top 33% too wide, side shifted
  const aligned = buildHull(sloppy, { align: true });
  const raw = buildHull(sloppy, { align: false });
  assert.ok(aligned.ok && raw.ok);
  const worst = (r) => Math.min(...Object.values(r.stats.iou));
  assert.ok(worst(aligned) > 0.9, `aligned agreement ${worst(aligned)}`);
  assert.ok(worst(aligned) > worst(raw), `raw agreement ${worst(raw)}`);
  // the conflicting widths (1.2 and 1.6) are averaged to 1.4, so the volume is the bracket scaled by 1.4 / 1.2
  rel(meshVolume(aligned.mesh), L_VOLUME * (1.4 / 1.2), 0.08);
});

test('views that strongly disagree produce a readable warning, not silence', () => {
  const r = buildHull([front(L_FRONT), top(rect(-1.1, -0.4, 1.1, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))]);
  assert.ok(r.ok);
  assert.ok(r.stats.warnings.some((w) => /width \(X\) differs by \d+%/.test(w)), r.stats.warnings.join('|'));
});

test('separate blobs: the largest piece is kept and the user is told', () => {
  const r = buildHull([
    front([...rect(-0.9, -0.2, -0.5, 0.2).map((p) => p), ...[]]), // small blob on the left
    front(rect(0.2, -0.5, 0.9, 0.5)), // big blob on the right
    top(rect(-0.9, -0.3, 0.9, 0.3)),
  ]);
  assert.ok(r.ok);
  assert.ok(r.stats.warnings.some((w) => /separate pieces/.test(w)));
  const { v } = r.mesh;
  let minX = Infinity;
  for (let i = 0; i < v.length; i += 3) minX = Math.min(minX, v[i]);
  assert.ok(minX > 0, 'only the right-hand blob remains');
});

test('failure modes explain themselves', () => {
  assert.equal(buildHull([]).ok, false);
  assert.match(buildHull([]).reason, /Draw a closed outline/);
  const open = new Poly('free', ngon(0, 0, 0.5, 60).slice(0, 25).map(([x, y]) => [x, y, 0]), false);
  assert.match(buildHull([open]).reason, /open outline.*Join lines/);
  const oblique = new Poly('free', rect(0, 0, 1, 1).map(([x, y]) => [x, y, 0.4 * x + 0.3 * y]).concat([[0, 0, 0]]), true);
  assert.match(buildHull([oblique]).reason, /not drawn in a Front, Side or Top view/);
  const apart = buildHull([front(rect(-0.9, -0.9, -0.6, -0.6)), side(rect(0.6, 0.6, 0.9, 0.9)), top(rect(-0.2, -0.2, 0.2, 0.2))], { align: false });
  assert.equal(apart.ok, false);
  assert.match(apart.reason, /do not overlap/);
});

test('it is fast enough to press a button and see the result', () => {
  const t = performance.now();
  const r = buildHull(lViews(), { n: 64 });
  const ms = performance.now() - t;
  assert.ok(r.ok && ms < 3000, `${ms.toFixed(0)} ms`);
  const fine = buildHull(lViews(), { n: 96 });
  assert.ok(fine.ok && fine.stats.triangles > r.stats.triangles); // finer grid, more detail
  rel(meshVolume(fine.mesh), L_VOLUME, 0.06);
});

test('the surface of a plain voxel block is a closed box', () => {
  const n = 12, occ = new Uint8Array(n * n * n);
  for (let i = 3; i < 9; i++) for (let j = 3; j < 9; j++) for (let k = 3; k < 9; k++) occ[(i * n + j) * n + k] = 1;
  const m = surfaceNets(occ, n, [0, 0, 0], 1);
  assert.deepEqual(edgeStats(m).counts, [2]);
  assert.ok(meshVolume(m) > 100 && meshVolume(m) < 260);
});

// ---------------------------------------------------------------- using the result in the scene
test('the hull becomes an ordinary scene object: move, scale, export, undo and restore the outlines', () => {
  const s = new Sketch();
  const outlines = lViews().map((o) => s.addItem(o));
  const r = buildHull(s.items);
  const hull = ImportedMesh.fromMesh('hull', r.mesh);
  s.addItem(hull);
  assert.ok(hull.volumetric && hull.generated);
  const c0 = hull.center.slice();
  hull.translate([0.5, 0, 0]);
  hull.scale(1.5);
  assert.notDeepEqual(hull.center, c0);
  assert.equal(s.solidCount, 1);
  const stl = sceneToSTL(s.items);
  assert.equal(new DataView(stl.buffer).getUint32(80, true), r.mesh.f.length / 3);
  assert.ok(sceneToOBJ(s.items).includes('\nf '));
  s.undo(); // removes the hull, not the outlines
  assert.deepEqual(s.items, outlines);
});

test('a generated hull is re-centred so picking and moving use its real position', () => {
  const [dx, dy, dz] = [0.3, 0.2, 0.1]; // an off-centre bracket
  const sh = (pts, a, b) => pts.map(([u, v]) => [u + a, v + b]);
  const r = buildHull([front(sh(L_FRONT, dx, dy)), top(sh(rect(-0.6, -0.4, 0.6, 0.4), dx, dz)), side(sh(rect(-0.4, -0.6, 0.4, 0.6), dz, dy))]);
  assert.ok(r.ok);
  const hull = ImportedMesh.fromMesh('hull', r.mesh);
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(hull.center[k] - [dx, dy, dz][k]) < 0.05, `centre ${hull.center}`);
  const placed = hull.mesh();
  for (let i = 0; i < placed.v.length; i++) assert.ok(Math.abs(placed.v[i] - r.mesh.v[i]) < 1e-9); // same place in the scene
  const s = new Sketch();
  s.yaw = s.pitch = 0;
  s.addItem(hull);
  const rect2 = { x: 0, y: 0, w: 1280, h: 720 };
  const p = s.project(hull.center, rect2);
  assert.equal(s.pick(p.x, p.y, rect2), hull);
});

test('building the hull again after editing an outline gives a new, different shape', () => {
  const a = buildHull(lViews());
  const edited = [front(L_FRONT.map(([x, y]) => [x, y * 0.5])), top(rect(-0.6, -0.4, 0.6, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))];
  const b = buildHull(edited);
  assert.ok(b.ok);
  assert.ok(Math.abs(meshVolume(b.mesh) - meshVolume(a.mesh)) > 0.05);
});
