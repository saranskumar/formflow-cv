import test from 'node:test';
import assert from 'node:assert/strict';
import { Poly, meshVolume } from '../js/core/shapes.js';
import { buildHull, viewSdf, meshFromField, outlineData, outlineItems, describeOutlines } from '../js/core/hull.js';
import { taubinSmooth, meshHealth } from '../js/core/meshops.js';

const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} not within ${tol * 100}% of ${b}`);
const loop = (pts) => [...pts, pts[0]];
const front = (pts, z = 0) => new Poly('free', loop(pts).map(([x, y]) => [x, y, z]), true);
const side = (pts, x = 0) => new Poly('free', loop(pts).map(([zz, y]) => [x, y, zz]), true);
const top = (pts, y = 0) => new Poly('free', loop(pts).map(([x, zz]) => [x, y, zz]), true);
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ngon = (cx, cy, r, n = 64) => [...Array(n)].map((_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);

// ------------------------------------------------------------------ the 2D field
test('the signed distance of a square is exact: positive inside, negative outside, 0 on the edge', () => {
  const n = 16, h = 0.125, lo = -1; // cell centres at -0.9375, -0.8125 ... 0.9375
  const f = viewSdf([loop(rect(-0.5, -0.5, 0.5, 0.5))], n, lo, lo, h);
  const at = (x, y) => f[Math.floor((x - lo) / h) * n + Math.floor((y - lo) / h)];
  const cx = (i) => lo + (i + 0.5) * h;
  assert.ok(Math.abs(at(0.01, 0.01) - 0.4375) < 1e-6, `centre cell is 0.4375 from the nearest edge (${at(0.01, 0.01)})`); // cell centre 0.0625
  assert.ok(at(0.9, 0.9) < 0 && at(-0.9, 0.2) < 0, 'outside is negative');
  assert.ok(Math.abs(at(0.9, 0.0) - -(cx(15) - 0.5)) < 1e-6, 'outside distance is to the edge, not the grid (cell 15 centre 0.9375, edge 0.5)');
  for (let i = 0; i < n * n; i++) assert.ok(Number.isFinite(f[i]));
});

test('several outlines in one view are unioned, and a hole drawn inside is still outside the union', () => {
  const n = 32, h = 2 / 32;
  const f = viewSdf([loop(rect(-0.8, -0.2, -0.2, 0.2)), loop(rect(0.2, -0.2, 0.8, 0.2))], n, -1, -1, h);
  const at = (x, y) => f[Math.floor((x + 1) / h) * n + Math.floor((y + 1) / h)];
  assert.ok(at(-0.5, 0) > 0 && at(0.5, 0) > 0, 'both shapes are inside');
  assert.ok(at(0, 0) < 0, 'the gap between them is outside');
});

// ------------------------------------------------------------------ smoothness and accuracy of the 3D hull
const cyl = () => [top(ngon(0, 0, 0.5)), front(rect(-0.5, -0.6, 0.5, 0.6)), side(rect(-0.5, -0.6, 0.5, 0.6))];

test('the volume error shrinks steadily with the grid size and is already small at the default', () => {
  const exact = Math.PI * 0.25 * 1.2;
  const errs = [48, 64, 96, 128].map((n) => Math.abs(meshVolume(buildHull(cyl(), { n }).mesh) - exact) / exact);
  assert.ok(errs.every((e) => e < 0.01), `all under 1%: ${errs.map((e) => (e * 100).toFixed(2))}`);
  assert.ok(errs[3] <= errs[0], 'finer is not worse');
  // a slanted plane: the old 0/1 voxels were off by up to 6% at coarse sizes
  const tri = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6]];
  const wedge = [front(tri), top(rect(-0.6, -0.4, 0.6, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))];
  rel(meshVolume(buildHull(wedge, { n: 48 }).mesh), 0.5 * 1.2 * 1.2 * 0.8, 0.01);
});

test('a straight slanted edge is a flat face, not a staircase', () => {
  const tri = [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6]];
  const r = buildHull([front(tri), top(rect(-0.6, -0.4, 0.6, 0.4)), side(rect(-0.4, -0.6, 0.4, 0.6))], { n: 64 });
  // vertices of the slanted face satisfy x + y = 0 (the hypotenuse); they should all sit on it to a fraction of a voxel
  const h = 1.32 / 64; // voxel size
  let worst = 0, count = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) {
    const x = r.mesh.v[i], y = r.mesh.v[i + 1];
    if (Math.abs(x + y) < 0.15 && Math.abs(x) < 0.45 && Math.abs(y) < 0.45 && Math.abs(r.mesh.v[i + 2]) < 0.3) { worst = Math.max(worst, Math.abs(x + y) / Math.SQRT2); count++; }
  }
  assert.ok(count > 100, `vertices on the slanted face: ${count}`);
  assert.ok(worst < 0.12 * h, `worst deviation from the plane ${(worst / h).toFixed(3)} voxel`);
});

test('a hull built from distance fields is a closed manifold, and says so', () => {
  const r = buildHull(cyl(), { n: 64 });
  assert.equal(r.stats.watertight, true);
  const h = meshHealth(r.mesh);
  assert.deepEqual([h.boundaryEdges, h.nonManifoldEdges, h.inconsistentEdges], [0, 0, 0]);
  const broken = { v: r.mesh.v, f: r.mesh.f.slice(0, r.mesh.f.length - 3) }; // one triangle missing
  assert.equal(meshHealth(broken).closed, false);
  assert.ok(meshHealth(broken).boundaryEdges >= 3);
});

test('corners stay sharp where two views meet: a box is a box', () => {
  const r = buildHull([front(rect(-0.5, -0.4, 0.5, 0.4)), side(rect(-0.3, -0.4, 0.3, 0.4)), top(rect(-0.5, -0.3, 0.5, 0.3))], { n: 64 });
  rel(meshVolume(r.mesh), 1.0 * 0.8 * 0.6, 0.01);
  const v = r.mesh.v;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < v.length; i += 3) { xmax = Math.max(xmax, v[i]); ymax = Math.max(ymax, v[i + 1]); zmax = Math.max(zmax, v[i + 2]); }
  assert.ok(Math.abs(xmax - 0.5) < 0.012 && Math.abs(ymax - 0.4) < 0.012 && Math.abs(zmax - 0.3) < 0.012, `${xmax} ${ymax} ${zmax}`);
});

test('a spun outline (round object) is smooth in height too', () => {
  const profile = [[-0.3, -0.6], [0.3, -0.6], [0.5, 0], [0.3, 0.6], [-0.3, 0.6], [-0.5, 0]]; // a barrel
  const r = buildHull([front(profile)], { n: 96, revolve: true });
  assert.ok(r.ok && r.stats.watertight);
  // volume of the solid of revolution of the right half: integrate pi r(y)^2 dy
  const rAt = (y) => (y < 0 ? 0.3 + 0.2 * ((y + 0.6) / 0.6) : 0.5 - 0.2 * (y / 0.6));
  let exact = 0; for (let y = -0.6; y < 0.6; y += 0.0005) exact += Math.PI * rAt(y) ** 2 * 0.0005;
  rel(meshVolume(r.mesh), exact, 0.03);
});

// ------------------------------------------------------------------ smoothing
test('Taubin smoothing flattens noise but keeps the size of the shape', () => {
  const r = buildHull(cyl(), { n: 64 });
  const before = meshVolume(r.mesh), noisy = { v: Float64Array.from(r.mesh.v), f: r.mesh.f };
  let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  for (let i = 0; i < noisy.v.length; i++) noisy.v[i] += rnd() * 0.01;
  // distance of the side wall's vertices from the true cylinder (R = 0.5); sliding along the surface is not an error
  const rough = (m) => { let s = 0, c = 0; for (let i = 0; i < m.v.length; i += 3) if (Math.abs(m.v[i + 1]) < 0.5) { s += (Math.hypot(m.v[i], m.v[i + 2]) - 0.5) ** 2; c++; } return Math.sqrt(s / c); };
  const noisyErr = rough(noisy);
  taubinSmooth(noisy, 6);
  assert.ok(rough(noisy) < noisyErr * 0.5, `noise reduced ${noisyErr.toFixed(5)} -> ${rough(noisy).toFixed(5)}`);
  rel(meshVolume(noisy), before, 0.03); // plain Laplacian smoothing would shrink it far more
  assert.equal(meshHealth(noisy).closed, true, 'still closed');
  const smooth = buildHull(cyl(), { n: 64, smooth: 2 });
  assert.equal(smooth.stats.smooth, 2);
  rel(meshVolume(smooth.mesh), before, 0.02);
});

// ------------------------------------------------------------------ worker plumbing
test('outlines survive the trip to the worker as plain data and build the same shape', () => {
  const items = [...cyl(), new Poly('cube', [[0, 0, 0]], false)];
  const data = outlineData(items);
  assert.equal(data.length, 3, 'only outlines are sent');
  const roundTrip = JSON.parse(JSON.stringify(data)); // structured clone is at least this strict
  const back = outlineItems(roundTrip);
  assert.deepEqual(describeOutlines(back), describeOutlines(items));
  const a = buildHull(items, { n: 48 }), b = buildHull(back, { n: 48 });
  assert.equal(a.stats.triangles, b.stats.triangles);
  assert.equal(meshVolume(a.mesh), meshVolume(b.mesh));
});

test('meshFromField turns any padded distance field into a closed surface', () => {
  const n = 40, m = n + 2, h = 0.05, lo = [-1, -1, -1];
  const F = new Float32Array(m ** 3).fill(-h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const x = lo[0] + (i + 0.5) * h, y = lo[1] + (j + 0.5) * h, z = lo[2] + (k + 0.5) * h;
    F[((i + 1) * m + (j + 1)) * m + k + 1] = 0.7 - Math.hypot(x, y, z); // a sphere of radius 0.7
  }
  const mesh = meshFromField(F, m, 0, lo, h);
  assert.equal(meshHealth(mesh).closed, true);
  rel(meshVolume(mesh), (4 / 3) * Math.PI * 0.7 ** 3, 0.02);
  for (let i = 0; i < mesh.v.length; i += 3) assert.ok(Math.abs(Math.hypot(mesh.v[i], mesh.v[i + 1], mesh.v[i + 2]) - 0.7) < 0.15 * h, 'vertices lie on the sphere');
});
