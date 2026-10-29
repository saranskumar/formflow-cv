import test from 'node:test';
import assert from 'node:assert/strict';
import { Poly, Solid, meshVolume, buildItem } from '../js/core/shapes.js';
import { outlineRing, planeOf, facePlane, prismMesh, prismPreview, selfIntersects, triangulate } from '../js/core/extrude.js';
import { cutMesh, meshField, simplifyRing } from '../js/core/csg.js';
import { meshHealth } from '../js/core/meshops.js';
import { Sketch } from '../js/core/sketch.js';

const rel = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} not within ${tol * 100}% of ${b}`);
const closed = (pts) => [...pts, pts[0]];
const rectAt = (x0, y0, x1, y1, z = 0) => new Poly('rect', closed([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]]), true);
const circleAt = (cx, cy, r, z = 0, n = 48) => new Poly('circle', closed([...Array(n)].map((_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z])), true);
const planeFor = (it, eye = [0, 0, 5]) => facePlane(planeOf(outlineRing(it)), eye);

// ------------------------------------------------------------------ outlines and planes
test('a rectangle, a circle and a nearly closed hand-drawn loop are outlines; an open stroke and a line are not', () => {
  assert.equal(outlineRing(rectAt(-0.3, -0.2, 0.3, 0.2)).length, 4);
  assert.equal(outlineRing(circleAt(0, 0, 0.4)).length, 48);
  const loop = [...Array(40)].map((_, i) => [0.4 * Math.cos((2 * Math.PI * i) / 40), 0.4 * Math.sin((2 * Math.PI * i) / 40), 0]);
  assert.ok(outlineRing(new Poly('free', loop.slice(0, -1))), 'the ends almost meet (one step apart)');
  assert.equal(outlineRing(new Poly('free', loop.slice(0, 20))), null, 'half a circle is open');
  assert.equal(outlineRing(new Poly('line', [[0, 0, 0], [1, 0, 0]])), null);
  assert.equal(outlineRing(new Solid('cube', [0, 0, 0], 0.3)), null);
});

test('the plane of an outline: its normal, the flatness, and which way it faces', () => {
  const p = planeOf(outlineRing(rectAt(-0.3, -0.2, 0.3, 0.2, 0.5)));
  assert.ok(Math.abs(Math.abs(p.n[2]) - 1) < 1e-9 && p.flat < 1e-9);
  near3(p.origin, [0, 0, 0.5]);
  assert.equal(facePlane(p, [0, 0, 5]).n[2], 1);
  assert.equal(facePlane(p, [0, 0, -5]).n[2], -1);
  // the frame stays right-handed after turning: u x v = n
  const q = facePlane(p, [0, 0, -5]);
  const c = [q.u[1] * q.v[2] - q.u[2] * q.v[1], q.u[2] * q.v[0] - q.u[0] * q.v[2], q.u[0] * q.v[1] - q.u[1] * q.v[0]];
  near3(c, q.n);
  // a loop on a tilted plane
  const tilt = new Poly('free', closed([[-0.3, 0, -0.3], [0.3, 0, 0.3], [0.3, 0.4, 0.3], [-0.3, 0.4, -0.3]]), true);
  const t = planeOf(outlineRing(tilt));
  near3(t.n.map(Math.abs), [Math.SQRT1_2, 0, Math.SQRT1_2]);
  assert.equal(planeOf([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), null, 'a straight row of points has no area');
});
function near3(a, b, tol = 1e-9) { a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= tol, `${a} vs ${b}`)); }

// ------------------------------------------------------------------ extruding
test('an extruded rectangle is a closed box of exactly the right volume, whichever way the drag goes', () => {
  const plane = planeFor(rectAt(-0.3, -0.2, 0.3, 0.2, 0.1));
  const up = prismMesh(plane, 0.3), down = prismMesh(plane, -0.3);
  rel(meshVolume(up), 0.6 * 0.4 * 0.3, 1e-9);
  rel(meshVolume(down), 0.6 * 0.4 * 0.3, 1e-9);
  assert.equal(meshHealth(up).closed, true);
  assert.equal(meshHealth(down).closed, true);
  const zs = [...up.v].filter((_, i) => i % 3 === 2);
  near3([Math.min(...zs), Math.max(...zs)], [0.1, 0.4]);                // toward the viewer
  const zd = [...down.v].filter((_, i) => i % 3 === 2);
  near3([Math.min(...zd), Math.max(...zd)], [-0.2, 0.1]);               // away from the viewer
});

test('concave outlines are filled correctly (an L shape, and a circle)', () => {
  const L = new Poly('free', closed([[0, 0, 0], [0.6, 0, 0], [0.6, 0.2, 0], [0.2, 0.2, 0], [0.2, 0.6, 0], [0, 0.6, 0]]), true);
  const m = prismMesh(planeFor(L), 0.25);
  rel(meshVolume(m), (0.6 * 0.2 + 0.2 * 0.4) * 0.25, 1e-9);
  assert.equal(meshHealth(m).closed, true);
  const c = prismMesh(planeFor(circleAt(0, 0, 0.5, 0, 64)), 0.2);
  rel(meshVolume(c), 0.5 * 64 * 0.25 * Math.sin((2 * Math.PI) / 64) * 0.2, 1e-6); // area of the 64-gon times the depth
  assert.equal(meshHealth(c).closed, true);
});

test('an outline that crosses itself cannot be extruded, and says so by returning nothing', () => {
  const bow = new Poly('free', closed([[0, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0], [0.2, 0.5, 0], [0.2, -0.2, 0], [0, -0.2, 0]]), true); // the line down from (0.2, 0.5) cuts across the bottom edge
  assert.equal(selfIntersects(outlineRing(bow).map((p) => [p[0], p[1]])), true);
  assert.equal(prismMesh(planeFor(bow), 0.2), null);
  assert.ok(prismMesh(planeFor(bow), 0.2, { capped: false }), 'but a preview of the walls is still possible');
  assert.equal(triangulate([[0, 0], [1, 0], [1, 1], [0, 1]]).length, 2);
});

test('the preview carries what the renderer needs', () => {
  const pv = prismPreview(planeFor(rectAt(-0.3, -0.2, 0.3, 0.2)), 0.3, { color: 0xff6b6b });
  assert.equal(pv.volumetric, true);
  assert.equal(pv.color, 0xff6b6b);
  assert.ok(pv.mesh().f.length > 0 && pv.polylines().length >= 6);
});

// ------------------------------------------------------------------ cutting
const cube = () => new Solid('cube', [0, 0, 0], 0.5).mesh(); // 0.8 wide: faces at +-0.4

test('a square pocket is taken out of a cube: right volume, still one closed surface', () => {
  const plane = planeFor(rectAt(-0.15, -0.15, 0.15, 0.15, 0.6));        // drawn in front of the front face (z = 0.4)
  const r = cutMesh(cube(), plane, -0.5, 0.05, { resolution: 64 });      // 0.5 deep into the screen: ends at z = 0.1
  assert.ok(r.removed > 0);
  rel(meshVolume(r.mesh), 0.512 - 0.3 * 0.3 * 0.3, 0.01);
  assert.equal(meshHealth(r.mesh).closed, true);
});

test('a hole through a cube is a hole: the volume drops by the whole column and the genus is 1', () => {
  const plane = planeFor(circleAt(0, 0, 0.2, 0.6, 64));
  const r = cutMesh(cube(), plane, -2, 0.05, { resolution: 80 });
  rel(meshVolume(r.mesh), 0.512 - 0.5 * 64 * 0.04 * Math.sin((2 * Math.PI) / 64) * 0.8, 0.01);
  const h = meshHealth(r.mesh);
  assert.equal(h.closed, true);
  const V = r.mesh.v.length / 3, E = r.mesh.f.length / 2, F = r.mesh.f.length / 3;
  assert.equal(V - E + F, 0, 'Euler characteristic 0 = one handle (a torus-like solid)');
});

test('the cutter keeps the corner sharp: no vertex ends up inside the removed column', () => {
  const plane = planeFor(rectAt(-0.15, -0.15, 0.15, 0.15, 0.6));
  const r = cutMesh(cube(), plane, -2, 0.05, { resolution: 80 });
  const h = 0.8 / 72;
  for (let i = 0; i < r.mesh.v.length; i += 3) {
    const x = r.mesh.v[i], y = r.mesh.v[i + 1];
    assert.ok(Math.max(Math.abs(x), Math.abs(y)) >= 0.15 - 0.6 * h, `vertex (${x.toFixed(3)}, ${y.toFixed(3)}) is inside the hole`);
  }
});

test('cutting air changes nothing; cutting away everything leaves an empty mesh', () => {
  const away = planeFor(rectAt(0.6, 0.6, 0.8, 0.8, 0.9));
  assert.equal(cutMesh(cube(), away, -0.2, 0.05).removed, 0, 'the cutter never reaches the cube');
  const all = planeFor(rectAt(-1, -1, 1, 1, 1));
  const r = cutMesh(cube(), all, -3, 0.05, { resolution: 48 });
  assert.equal(r.mesh.f.length, 0);
  assert.ok(r.removed > 0);
});

test('a sphere can be cut too, and the exact distance field is positive inside and negative outside', () => {
  const s = new Solid('sphere', [0, 0, 0], 0.5).mesh();
  const n = 24, h = 1.4 / n, lo = [-0.7, -0.7, -0.7];
  const F = meshField(s, lo, h, n);
  const at = (x, y, z) => F[(Math.floor((x - lo[0]) / h) * n + Math.floor((y - lo[1]) / h)) * n + Math.floor((z - lo[2]) / h)];
  assert.ok(at(0, 0, 0) > 0.1 && at(0.65, 0, 0) < -0.05);
  const r = cutMesh(s, planeFor(rectAt(-0.1, -0.1, 0.1, 0.1, 0.8)), -0.5, 0.05, { resolution: 64 });
  assert.ok(r.removed > 0 && meshHealth(r.mesh).closed);
  assert.ok(meshVolume(r.mesh) < meshVolume(s));
});

test('a long hand-drawn outline is simplified without moving it by more than the tolerance', () => {
  const ring = [...Array(400)].map((_, i) => [Math.cos((2 * Math.PI * i) / 400), Math.sin((2 * Math.PI * i) / 400)]);
  const s = simplifyRing(ring, 0.01);
  assert.ok(s.length < 80 && s.length > 12, `${s.length} points`);
  for (const p of ring) {
    let d = Infinity;
    for (let i = 0; i < s.length; i++) {
      const a = s[i], b = s[(i + 1) % s.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
    }
    assert.ok(d < 0.011, `moved ${d}`);
  }
});

// ------------------------------------------------------------------ the gestures
const RECT = { x: 0, y: 0, w: 1000, h: 800 };
function front() { const s = new Sketch(); s.setView('front'); return s; }
const screen = (s, p) => { const q = s.project(p, RECT); return [q.x, q.y]; };

test('Extrude: pinch inside an outline, drag up, release: it becomes a solid, and one Undo brings the outline back', () => {
  const s = front();
  const o = s.addItem(rectAt(-0.3, -0.2, 0.3, 0.2, 0));
  s.setTool('extrude');
  const [x, y] = screen(s, [0, 0, 0]);
  const notes = []; s.onNote = (t, k) => notes.push([t, k]);
  assert.equal(s.begin(x, y, RECT, 1, 'extrude'), true);
  assert.equal(s.busy, true);
  s.add(x, y - 40, RECT, 1.1);
  assert.ok(s.preview() && s.preview().volumetric, 'a preview while dragging');
  s.add(x, y - 100, RECT, 1.2); // 100 px up = 0.5
  const item = s.end({ now: 1.3 });
  assert.equal(item.kind, 'mesh');
  assert.equal(s.items.length, 1);
  assert.ok(!s.items.includes(o));
  rel(meshVolume(item.mesh()), 0.6 * 0.4 * 0.5, 1e-6);
  const zs = [...item.mesh().v].filter((_, i) => i % 3 === 2);
  assert.ok(Math.max(...zs) > 0.49 && Math.min(...zs) > -1e-9, 'it grew toward the viewer');
  assert.equal(s.busy, false);
  s.undo();
  assert.deepEqual(s.items, [o]);
  assert.ok(notes.some(([t]) => /Extruded/.test(t)));
});

test('Extrude with no outline under the cursor, a tiny drag, or a crossing outline does nothing and says why', () => {
  const s = front();
  s.addItem(rectAt(-0.3, -0.2, 0.3, 0.2));
  const notes = []; s.onNote = (t, k) => notes.push([k, t]);
  const [fx, fy] = screen(s, [0.9, 0.9, 0]);
  assert.equal(s.begin(fx, fy, RECT, 1, 'extrude'), false, 'nothing there');
  assert.ok(notes[0][0] === 'warn');
  const [x, y] = screen(s, [0, 0, 0]);
  s.begin(x, y, RECT, 2, 'extrude'); s.add(x, y - 2, RECT, 2.1);
  assert.equal(s.end({ now: 2.2 }), null);
  assert.equal(s.items.length, 1);
  const bow = s.addItem(new Poly('free', closed([[0.5, 0, 0], [1, 0, 0], [1, 0.5, 0], [0.7, 0.5, 0], [0.7, -0.2, 0], [0.5, -0.2, 0]]), true));
  const [bx, by] = screen(s, [0.85, 0.25, 0]);
  s.begin(bx, by, RECT, 3, 'extrude'); s.add(bx, by - 100, RECT, 3.1);
  assert.equal(s.end({ now: 3.2 }), null);
  assert.ok(s.items.includes(bow));
  assert.ok(notes.some(([, t]) => /crosses itself/.test(t)));
});

test('Cut: an outline over a cube, dragged up, cuts a pocket; the outline is used up, and Undo restores both', () => {
  const s = front();
  const cubeItem = s.addItem(new Solid('cube', [0, 0, 0], 0.5));
  const o = s.addItem(rectAt(-0.15, -0.15, 0.15, 0.15, 0.6));
  const v0 = meshVolume(cubeItem.mesh());
  const [x, y] = screen(s, [0, 0, 0.6]);
  const notes = []; s.onNote = (t, k) => notes.push([k, t]);
  assert.equal(s.begin(x, y, RECT, 1, 'cut'), true);
  s.add(x, y - 100, RECT, 1.1); // 0.5 deep: from z = 0.6 to 0.1
  assert.ok(s.preview().color === 0xff6b6b, 'the cutter is shown in red');
  const item = s.end({ now: 1.2 });
  assert.equal(s.items.length, 1);
  assert.ok(item && s.items[0] === item && !s.items.includes(cubeItem) && !s.items.includes(o));
  rel(meshVolume(item.mesh()), v0 - 0.3 * 0.3 * 0.3, 0.02);
  s.undo();
  assert.equal(s.items.length, 2);
  assert.ok(s.items.includes(cubeItem) && s.items.includes(o));
  assert.ok(notes.some(([k, t]) => k === 'ok' && /Cut/.test(t)));
});

test('Cut with no solid behind the outline, or without dragging, changes nothing', () => {
  const s = front();
  s.addItem(rectAt(-0.15, -0.15, 0.15, 0.15, 0.6));
  const notes = []; s.onNote = (t, k) => notes.push([k, t]);
  const [x, y] = screen(s, [0, 0, 0.6]);
  s.begin(x, y, RECT, 1, 'cut'); s.add(x, y - 100, RECT, 1.1);
  assert.equal(s.end({ now: 1.2 }), null);
  assert.equal(s.items.length, 1);
  assert.ok(notes.some(([, t]) => /Nothing to cut/.test(t)));
  s.addItem(new Solid('cube', [0, 0, 0], 0.5));
  s.begin(x, y, RECT, 2, 'cut'); s.add(x, y + 50, RECT, 2.1); // dragging down: no depth
  assert.equal(s.end({ now: 2.2 }), null);
  assert.equal(s.items.length, 2);
});

test('the hand\'s release jitter is trimmed from the depth, as for Move and Scale', () => {
  const s = front();
  s.addItem(rectAt(-0.3, -0.2, 0.3, 0.2));
  const [x, y] = screen(s, [0, 0, 0]);
  s.begin(x, y, RECT, 1, 'extrude');
  s.add(x, y - 100, RECT, 1.0); s.add(x, y - 100, RECT, 1.1); s.add(x, y - 100, RECT, 1.2);
  s.add(x, y - 180, RECT, 1.28); // the fingers opening moves the hand
  const item = s.end({ trim: 0.15, now: 1.3 });
  rel(meshVolume(item.mesh()), 0.6 * 0.4 * 0.5, 1e-6);
});
