// The demo photo sets in samples/ (made by samples/make_samples.py): each must trace cleanly and build a closed model that
// matches its own pictures. The pictures are drawn at 250 px per world unit, so a picture 720 px wide is 2.88 units wide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readPng } from './png.mjs';
import { traceSilhouette } from '../js/core/trace.js';
import { outlineFromTrace } from '../js/ui/refimages.js';
import { buildHull } from '../js/core/hull.js';
import { meshVolume, Poly } from '../js/core/shapes.js';
import { PLANE_VIEWS } from '../js/core/planes.js';
import { meshHealth } from '../js/core/meshops.js';

const PX_PER_UNIT = 250;
const load = (set, view) => readPng(fileURLToPath(new URL(`../../samples/${set}/${view}.png`, import.meta.url)));

function outlines(set, views = ['front', 'side', 'top']) {
  return views.map((view) => {
    const px = load(set, view), t = traceSilhouette(px);
    assert.ok(t.ok, `${set}/${view}: ${t.reason}`);
    const pts = outlineFromTrace(t.pts, { cx: 0, cy: 0, w: px.w / PX_PER_UNIT, aspect: px.w / px.h, flip: false }, PLANE_VIEWS[view]);
    return new Poly('free', pts, true);
  });
}

// ground truth, from the shapes the pictures were made from
const revolved = (profile, lo, hi, steps = 4000) => { let v = 0; for (let i = 0; i < steps; i++) { const y = lo + ((hi - lo) * (i + 0.5)) / steps; let r = 0; for (let k = 0; k < profile.length - 1; k++) if (y >= profile[k][0] && y <= profile[k + 1][0]) r = profile[k][1] + ((profile[k + 1][1] - profile[k][1]) * (y - profile[k][0])) / (profile[k + 1][0] - profile[k][0]); v += Math.PI * r * r * ((hi - lo) / steps); } return v; };

test('every sample set is present and every picture is traced as one clean figure', () => {
  for (const set of ['rocket', 'house', 'vase', 'airplane', 'castle', 'robot', 'car']) for (const view of ['front', 'side', 'top']) {
    assert.ok(existsSync(fileURLToPath(new URL(`../../samples/${set}/${view}.png`, import.meta.url))), `${set}/${view}.png`);
    const t = traceSilhouette(load(set, view));
    assert.ok(t.ok && t.pts.length >= 5, `${set}/${view}`);
    assert.ok(t.area > 0.02 && t.area < 0.7, `${set}/${view}: covers ${(t.area * 100).toFixed(0)}%`);
  }
});

test('rocket: three views give the body, the nose and all four fins', () => {
  const r = buildHull(outlines('rocket'), { n: 96, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  for (const [v, iou] of Object.entries(r.stats.iou)) assert.ok(iou > 0.97, `${v}: ${iou}`);
  // body + nose of revolution, plus four fins of 0.07 thickness: between 0.28 and 0.36 world units cubed
  const vol = meshVolume(r.mesh);
  assert.ok(vol > 0.25 && vol < 0.4, `volume ${vol}`);
  // the fins reach 0.62 from the axis along X and along Z, and nowhere diagonally
  let reach = 0, diag = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) {
    const x = r.mesh.v[i], y = r.mesh.v[i + 1], z = r.mesh.v[i + 2];
    if (y < -0.4) { reach = Math.max(reach, Math.abs(x), Math.abs(z)); if (Math.abs(x) > 0.35 && Math.abs(z) > 0.35) diag++; }
  }
  assert.ok(reach > 0.58 && reach < 0.66, `fins reach ${reach}`);
  assert.equal(diag, 0, 'nothing sticks out diagonally between the fins');
});

test('house: the chimney lands where it is, and the walls are a box', () => {
  const r = buildHull(outlines('house'), { n: 96, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  for (const [v, iou] of Object.entries(r.stats.iou)) assert.ok(iou > 0.97, `${v}: ${iou}`);
  let chimney = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) if (r.mesh.v[i + 1] > 0.58) chimney++; // above the ridge (0.55): only the chimney
  assert.ok(chimney > 0, 'a chimney sticks out above the ridge');
  for (let i = 0; i < r.mesh.v.length; i += 3) if (r.mesh.v[i + 1] > 0.58) assert.ok(Math.abs(r.mesh.v[i] - 0.32) < 0.14 && Math.abs(r.mesh.v[i + 2] + 0.12) < 0.14, 'and it is at x = 0.32, z = -0.12');
  assert.equal(meshHealth(r.mesh).closed, true);
});

test('vase: one picture spun round gives the right volume; three views alone can only over-fill it', () => {
  const profile = [[-0.8, 0.2], [-0.72, 0.27], [-0.4, 0.4], [-0.05, 0.46], [0.25, 0.34], [0.5, 0.17], [0.62, 0.15], [0.75, 0.2], [0.8, 0.26]];
  const exact = revolved(profile, -0.8, 0.8);
  const round = buildHull(outlines('vase', ['front']), { n: 96, revolve: true });
  assert.ok(round.ok && round.stats.watertight, round.reason);
  assert.ok(Math.abs(meshVolume(round.mesh) - exact) / exact < 0.07, `round ${meshVolume(round.mesh).toFixed(3)} vs ${exact.toFixed(3)}`);
  // from three plain views the model can only be bigger than the vase (a square-ish column clipped by the widest circle), which
  // is exactly why a round object should be made with One view: Round
  const three = buildHull(outlines('vase'), { n: 96, align: false });
  assert.ok(three.ok && three.stats.watertight);
  const v3 = meshVolume(three.mesh);
  assert.ok(v3 > exact && v3 < 1.3 * exact, `three views ${v3.toFixed(3)} vs ${exact.toFixed(3)}`);
});

// ---- the sets drawn as SVG (samples/svg -> samples/<set>) -------------------------------------------------------------
const extent = (mesh, axis) => { let lo = Infinity, hi = -Infinity; for (let i = axis; i < mesh.v.length; i += 3) { lo = Math.min(lo, mesh.v[i]); hi = Math.max(hi, mesh.v[i]); } return [lo, hi]; };

test('airplane: the wings sweep back as drawn from above, and the fin stands on the tail', () => {
  const r = buildHull(outlines('airplane'), { n: 110, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  const [x0, x1] = extent(r.mesh, 0), [z0, z1] = extent(r.mesh, 2), [y0, y1] = extent(r.mesh, 1);
  assert.ok(x1 > 0.8 && x1 < 0.9 && x0 < -0.8, `wing span ${x0.toFixed(2)}..${x1.toFixed(2)}`);
  assert.ok(z1 > 0.85 && z0 < -0.85, `length ${z0.toFixed(2)}..${z1.toFixed(2)} (nose at +Z)`);
  assert.ok(y1 > 0.33 && y1 < 0.43, `the fin reaches ${y1.toFixed(2)}`);
  // a wing tip is far behind the wing root: its Z is negative, the root's is positive
  let tip = 0, n = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) if (Math.abs(r.mesh.v[i]) > 0.8 && Math.abs(r.mesh.v[i + 1]) < 0.05) { tip += r.mesh.v[i + 2]; n++; }
  assert.ok(n > 0 && tip / n < -0.1, `wing tips trail the nose (mean Z ${(tip / n).toFixed(2)})`);
});

test('castle: four towers and a keep, and the flag is a flat blade', () => {
  const r = buildHull(outlines('castle'), { n: 110, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  let corners = 0, keepTop = -Infinity;
  for (let i = 0; i < r.mesh.v.length; i += 3) {
    const x = r.mesh.v[i], y = r.mesh.v[i + 1], z = r.mesh.v[i + 2];
    if (y > 0.3 && y < 0.5 && Math.abs(x) > 0.4 && Math.abs(z) > 0.4) corners++;        // tower roofs at the corners
    if (Math.abs(x) < 0.2 && Math.abs(z) < 0.2) keepTop = Math.max(keepTop, y);          // the centre
  }
  assert.ok(corners > 50, 'the four corner towers');
  assert.ok(keepTop > 0.85, `the keep and its flag pole reach ${keepTop.toFixed(2)}`);
});

test('robot: every part takes its size from the right view', () => {
  const r = buildHull(outlines('robot'), { n: 110, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  const [y0, y1] = extent(r.mesh, 1);
  assert.ok(y0 < -0.75 && y1 > 0.95, `height ${y0.toFixed(2)}..${y1.toFixed(2)}`);
  let armDepth = 0, armN = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) if (Math.abs(r.mesh.v[i]) > 0.34 && Math.abs(r.mesh.v[i]) < 0.4 && r.mesh.v[i + 1] > 0) { armDepth = Math.max(armDepth, Math.abs(r.mesh.v[i + 2])); armN++; }
  assert.ok(armN > 0 && armDepth < 0.12, `the arms are thin front to back (${armDepth.toFixed(2)})`);
});

test('car: the side picture makes the wheels round', () => {
  const r = buildHull(outlines('car'), { n: 110, align: false });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  // wheel vertices: |x| in the tyre band, below the body. Each lies on the circle of radius 0.17 around (z = +-0.45, y = -0.25)
  let n = 0, worst = 0;
  for (let i = 0; i < r.mesh.v.length; i += 3) {
    const ax = Math.abs(r.mesh.v[i]), y = r.mesh.v[i + 1], z = r.mesh.v[i + 2];
    if (ax > 0.33 && ax < 0.39 && y < -0.26) { n++; worst = Math.max(worst, Math.abs(Math.hypot(Math.abs(z) - 0.45, y + 0.25) - 0.17)); }
  }
  assert.ok(n > 50, `${n} wheel points`);
  assert.ok(worst < 0.03, `wheel points sit on the circle (worst ${worst.toFixed(3)})`);
});

test('pawn: one picture spun round, closed and the right height', () => {
  const r = buildHull(outlines('pawn', ['front']), { n: 96, revolve: true });
  assert.ok(r.ok && r.stats.watertight, r.reason);
  const [y0, y1] = extent(r.mesh, 1);
  assert.ok(y0 < -0.75 && y1 > 0.55 && y1 < 0.62, `height ${y0.toFixed(2)}..${y1.toFixed(2)}`);
});
