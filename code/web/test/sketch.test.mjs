import test from 'node:test';
import assert from 'node:assert/strict';
import { Sketch, FOV_DEG, FOCAL_PER_HEIGHT } from '../js/core/sketch.js';
import { Poly, Solid } from '../js/core/shapes.js';

const R = { x: 0, y: 0, w: 1280, h: 720 };
const C = [640, 360];
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);
const front = () => { const s = new Sketch(); s.yaw = 0; s.pitch = 0; return s; };

function place(s, tool, dx = 60, at = C) {
  s.setTool(tool);
  s.begin(at[0], at[1], R, 0);
  s.add(at[0] + dx, at[1], R, 0.1);
  s.end({ now: 0.2 });
  return s.items[s.items.length - 1];
}

test('field of view matches the focal length used for picking', () => {
  near(Math.tan((FOV_DEG * Math.PI) / 360) * 2 * FOCAL_PER_HEIGHT, 1, 1e-9);
});

test('project / unproject round trip from any view, depth and pan', () => {
  const s = new Sketch();
  for (const [yaw, pitch, depth, pan] of [[0, 0, 0, 0], [0.55, 0.35, 0.4, 0], [-1.2, 0.9, -0.6, 0], [0.3, 0.2, 0.2, 80]]) {
    s.yaw = yaw; s.pitch = pitch;
    s.target = [0, 0, 0];
    if (pan) s.pan(pan, -40, R);
    const p = s.unproject(900, 250, R, depth);
    const q = s.project(p, R);
    near(q.x, 900, 1e-6); near(q.y, 250, 1e-6);
  }
});

test('screen centre hits the depth axis', () => {
  const s = front();
  const p = s.unproject(C[0], C[1], R, 0.5);
  near(p[0], 0, 1e-9); near(p[1], 0, 1e-9); near(p[2], 0.5, 1e-9);
});

test('freehand stroke lifecycle, normalisation and undo', () => {
  const s = front();
  s.begin(500, 360, R, 0);
  for (let i = 1; i < 30; i++) s.add(500 + i * 8, 360 + 6 * Math.sin(i / 3), R, i / 30);
  s.end({ now: 1.1 });
  assert.equal(s.items.length, 1);
  assert.ok(s.items[0] instanceof Poly && s.items[0].pts.length > 10);
  const d = s.items[0].pts.slice(1).map((p, i) => Math.hypot(...p.map((x, k) => x - s.items[0].pts[i][k])));
  const body = d.slice(0, -1);
  const mean = body.reduce((a, b) => a + b) / body.length;
  assert.ok(Math.sqrt(body.reduce((a, b) => a + (b - mean) ** 2, 0) / body.length) / mean < 0.1);
  s.undo();
  assert.equal(s.items.length, 0);
  assert.equal(s.undoCount, 1);
});

test('a single tap is not an item', () => {
  const s = front();
  s.begin(500, 300, R, 0); s.end({ now: 0.1 });
  s.setTool('cube'); s.begin(500, 300, R, 0); s.end({ now: 0.1 });
  assert.equal(s.items.length, 0);
});

for (const [tool, cls] of [['line', Poly], ['rect', Poly], ['circle', Poly], ['cube', Solid], ['sphere', Solid], ['cylinder', Solid], ['cone', Solid], ['pyramid', Solid]]) {
  test(`${tool} tool previews while dragging and commits on release`, () => {
    const s = front();
    s.setTool(tool);
    s.begin(C[0], C[1], R, 0);
    assert.equal(s.preview(), null);
    s.add(C[0] + 90, C[1] + 40, R, 0.1);
    assert.ok(s.preview() instanceof cls);
    s.end({ now: 0.2 });
    assert.ok(s.items[0] instanceof cls && s.items[0].kind === tool);
  });
}

test('a solid sits at the anchor and is sized by the drag', () => {
  const s = front();
  const it = place(s, 'sphere', 100);
  near(it.center[0], 0, 1e-6);
  near(it.r, (100 * s.dist) / s.focal(R), 1e-6);
});

test('depth steps clamp and move strokes along the viewing axis', () => {
  const s = front();
  for (let i = 0; i < 10; i++) s.stepDepth(1);
  assert.equal(s.depth, 1);
  s.begin(C[0], C[1], R, 0); s.add(C[0] + 30, C[1], R, 0.1); s.end({ now: 0.2 });
  s.items[0].pts.forEach((p) => near(p[2], 1, 1e-6));
});

test('move drags the picked object only', () => {
  const s = front();
  const a = place(s, 'cube', 60);
  const b = place(s, 'cube', 55, [C[0] + 150, C[1]]);
  const far = b.center.slice();
  s.setTool('move');
  s.hover(...C, R);
  assert.equal(s.hot, a);
  assert.ok(s.begin(...C, R, 1));
  s.add(C[0] + 80, C[1] - 40, R, 1.1);
  s.end({ now: 1.2 });
  assert.equal(s.moved, 1);
  assert.ok(a.center[0] > 0.3 && a.center[1] > 0.1);
  assert.deepEqual(b.center, far);
  assert.equal(s.begin(5, 5, R, 2), false);
});

test('a dropped object stays where it was let go (release commit)', () => {
  const s = front();
  const cube = place(s, 'cube', 60);
  s.setTool('move');
  const t0 = 100;
  s.begin(...C, R, t0);
  let x = C[0];
  for (let i = 1; i <= 30; i++) { x += 3; s.add(x, C[1], R, t0 + i / 30); }
  const held = cube.center.slice();
  for (let i = 31; i <= 35; i++) { x += 14; s.add(x, C[1] + (i - 30) * 9, R, t0 + i / 30); } // fingers open: hand drifts
  assert.ok(cube.center[0] > held[0] + 0.1);
  s.end({ trim: 0.15, now: t0 + 35 / 30 });
  assert.ok(Math.hypot(...cube.center.map((v, k) => v - held[k])) < 0.06);
});

test('a short drag is not erased by the rewind', () => {
  const s = front();
  const cube = place(s, 'cube', 60);
  const before = cube.center.slice();
  s.setTool('move');
  s.begin(...C, R, 5);
  s.add(C[0] + 40, C[1], R, 5.05);
  s.end({ trim: 0.5, now: 5.1 });
  assert.ok(cube.center[0] > before[0] + 0.05);
});

test('a stroke loses its release hook', () => {
  const s = front();
  const t = 50;
  s.begin(560, 360, R, t);
  for (let i = 1; i <= 30; i++) s.add(560 + i * 6, 360, R, t + i / 30);
  for (let i = 31; i <= 35; i++) s.add(740 + (i - 30) * 2, 360 + (i - 30) * 14, R, t + i / 30);
  s.end({ trim: 0.2, now: t + 35 / 30 });
  const ys = s.items[0].pts.map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) < 0.05);
});

test('scale tool grows, shrinks and clamps', () => {
  const s = front();
  const sph = place(s, 'sphere', 60);
  const r0 = sph.r;
  s.setTool('scale');
  s.begin(...C, R, 0);
  for (let i = 1; i <= 10; i++) s.add(C[0], C[1] - 10 * i, R, i / 10);
  assert.ok(sph.r > r0 * 1.5);
  for (let i = 1; i < 80; i++) s.add(C[0], C[1] + 30 * i, R, 1 + i / 10);
  s.end({ now: 20 });
  assert.ok(sph.r >= 0.03 && sph.r < r0);
});

test('cancel rewinds a drag and discards a stroke', () => {
  const s = front();
  const cube = place(s, 'cube', 60);
  const start = cube.center.slice();
  s.setTool('move');
  s.begin(...C, R, 0);
  s.add(C[0] + 100, C[1] + 50, R, 0.1);
  s.cancel();
  assert.deepEqual(cube.center, start);
  s.setTool('free'); s.begin(500, 300, R, 1); s.add(600, 330, R, 1.1); s.cancel(); s.end({ now: 2 });
  assert.equal(s.items.length, 1);
});

test('pan: the scene follows the hands and the target is limited', () => {
  const s = front();
  const p0 = s.project([0, 0, 0], R);
  s.pan(100, 0, R);
  const p1 = s.project([0, 0, 0], R);
  near(p1.x, p0.x + 100, 1); near(p1.y, p0.y, 1);
  for (let i = 0; i < 100; i++) s.pan(500, 500, R);
  assert.ok(Math.max(...s.target.map(Math.abs)) <= 2.5);
  s.resetView();
  assert.deepEqual(s.target, [0, 0, 0]);
});

test('drawing still lands under the cursor after panning and orbiting', () => {
  const s = new Sketch();
  s.pan(80, -40, R);
  s.yaw = 0.3; s.pitch = 0.2;
  s.begin(700, 280, R, 0); s.add(760, 300, R, 0.1); s.end({ now: 0.2 });
  const q = s.project(s.items[0].pts[0], R);
  near(q.x, 700, 1); near(q.y, 280, 1);
});

test('orbit caps glitch jumps, coasts and stops', () => {
  const s = new Sketch();
  const y0 = s.yaw;
  s.orbit(5000, 0, 0);
  near(Math.abs(s.yaw - y0), 60 * 0.009, 1e-9);
  const s2 = new Sketch();
  let t = 0;
  for (let i = 0; i < 10; i++) { s2.orbit(40, 0, t); t += 1 / 60; }
  s2.releaseOrbit(t);
  assert.ok(s2.coasting);
  const steps = [];
  for (let i = 0; i < 300; i++) { t += 1 / 60; const b = s2.yaw; s2.coast(t); steps.push(Math.abs(s2.yaw - b)); }
  assert.ok(steps[0] > steps[40] && steps[40] > steps[120]);
  assert.ok(!s2.coasting && steps[299] === 0);
  const s3 = new Sketch(); s3.orbit(1, 0, 0); s3.orbit(1, 0, 0.5); s3.releaseOrbit(0.5);
  assert.ok(!s3.coasting);
});

test('snap quantises points and skips smoothing', () => {
  const s = front();
  s.snap = true;
  s.begin(410, 311, R, 0); s.add(520, 333, R, 0.1); s.add(600, 340, R, 0.2); s.end({ now: 0.3 });
  s.items[0].pts.flat().forEach((v) => near(v / 0.1, Math.round(v / 0.1), 1e-9));
});

test('solidCount counts every volumetric item', () => {
  const s = front();
  place(s, 'cube', 60); place(s, 'line', 60, [300, 200]);
  assert.equal(s.solidCount, 1);
});

test('a quick flick shorter than the release rewind still makes its shape', () => {
  const s = front();
  s.setTool('cube');
  s.begin(C[0], C[1], R, 10);
  s.add(C[0] + 25, C[1] + 10, R, 10.03);
  s.add(C[0] + 60, C[1] + 20, R, 10.06);
  s.end({ trim: 0.10, now: 10.08 }); // the whole drag fits inside the 0.1 s rewind window
  assert.equal(s.items.length, 1);
  assert.ok(s.items[0].r > 0.1);
});

// ------------------------------------------------------------------ smooth navigation
test('smooth zoom glides to its goal and never overshoots; the goal moves with every wheel step', () => {
  const s = new Sketch();
  s.smooth = true;
  s.zoom(0.9); s.zoom(0.8);                     // two wheel steps
  near(s.zoomGoal, 4 * 0.72, 1e-9);
  assert.equal(s.dist, 4, 'nothing jumps');
  let prev = s.dist;
  for (let t = 0; t < 2; t += 1 / 60) { s.glide(t); assert.ok(s.dist <= prev + 1e-9 && s.dist >= s.zoomGoal - 1e-9, 'monotone, no overshoot'); prev = s.dist; }
  near(s.dist, 2.88, 1e-3);
  s.zoom(0.1); near(s.zoomGoal, 2.2, 1e-9); // the goal stops at the nearest allowed distance
});

test('smooth pan follows its goal, a view change takes the short way round, and touching the view stops the move', () => {
  const s = new Sketch();
  s.smooth = true;
  s.pan(100, 0, R);
  assert.deepEqual(s.target, [0, 0, 0]);
  for (let t = 0; t < 1; t += 1 / 60) s.glide(t);
  assert.ok(Math.abs(s.target[0]) > 0.05 && s.target.every((v, i) => Math.abs(v - s.panGoal[i]) < 1e-3));
  s.yaw = 3.0; s.setView('front'); // yaw 0 is 3.0 rad away the long way, 3.28 the short way
  s.glide(10); s.glide(10.1);
  assert.ok(s.yaw > 3.0 - 0.0001 || s.yaw < 3.0, 'moving');
  let last = s.yaw;
  for (let t = 10.2; t < 11; t += 1 / 60) { s.glide(t); last = s.yaw; }
  near(((last % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), 0, 1e-6);
  assert.equal(s.alignedView(), 'front');
  s.resetView(); s.glide(20); s.glide(20.1);
  s.orbit(5, 0, 20.2); // the user grabs the view: the move stops where it is
  assert.equal(s.tw, null);
});

test('with smoothing off (the default) everything is immediate, as before', () => {
  const s = new Sketch();
  s.zoom(0.5); assert.equal(s.dist, 2.2 > 2 ? 2.2 : 2);
  s.setView('top'); assert.equal(s.alignedView(), 'top');
});
