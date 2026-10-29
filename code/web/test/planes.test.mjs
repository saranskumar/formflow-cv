import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaneLayout, guideLines, PLANE_VIEWS } from '../js/core/planes.js';
import { Sketch } from '../js/core/sketch.js';
import { buildHull, describeOutlines, sharedDimensions, classifyPlane } from '../js/core/hull.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const RECT = { x: 0, y: 0, w: 1000, h: 800 };
const mk = () => new PlaneLayout().set({ x: 100, y: 50, w: 800, h: 600 });

// drag a pinch through screen points with the sketch engine, in a given tool
function stroke(s, pts, tool = 'free') {
  s.setTool(tool);
  assert.ok(s.begin(pts[0][0], pts[0][1], RECT, 0), 'gesture must start');
  pts.slice(1).forEach(([x, y], i) => s.add(x, y, RECT, 0.01 * (i + 1)));
  return s.end();
}
const around = (cx, cy, w, h) => [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h], [cx - w, cy - h]];
const box = (cx, cy, w, h) => [[cx - w, cy - h], [cx + w, cy + h]]; // rect tool: two opposite corners

test('the four cells tile the area without overlap, drawing cells share one scale', () => {
  const L = mk();
  assert.equal(L.cellAt(L.centre('top').x, L.centre('top').y), 'top');
  assert.equal(L.cellAt(L.centre('front').x, L.centre('front').y), 'front');
  assert.equal(L.cellAt(L.centre('side').x, L.centre('side').y), 'side');
  assert.equal(L.cellAt(L.centre('preview').x, L.centre('preview').y), 'preview');
  assert.equal(L.cellAt(5, 5), null);
  near(L.cells.top.w, L.cells.front.w); near(L.cells.top.x, L.cells.front.x);
  near(L.cells.side.y, L.cells.front.y); near(L.cells.preview.y, L.cells.top.y);
});

test('screen <-> world round-trips in every view and lands on the right axes', () => {
  const L = mk();
  for (const name of ['front', 'side', 'top']) {
    const c = L.centre(name);
    const p = L.toWorld(name, c.x + 30, c.y - 45);
    const back = L.fromWorld(name, p);
    near(back.x, c.x + 30); near(back.y, c.y - 45);
    near(p[{ z: 2, x: 0, y: 1 }[PLANE_VIEWS[name].axis]], 0); // nothing along the viewing axis
  }
  const f = L.centre('front');
  const q = L.toWorld('front', f.x + L.scale, f.y - 2 * L.scale);
  near(q[0], 1); near(q[1], 2);
});

test('views agree: the same world point sits in the same column of Front and Top and the same row of Front and Side', () => {
  const L = mk();
  const P = [0.5, 0.3, -0.7];
  const fr = L.fromWorld('front', P), tp = L.fromWorld('top', P), sd = L.fromWorld('side', P);
  near(fr.x - L.centre('front').x, tp.x - L.centre('top').x);     // X: same offset in Front and Top
  near(L.centre('front').y - fr.y, L.centre('side').y - sd.y);    // Y: same height in Front and Side
  near(tp.y - L.centre('top').y, -(sd.x - L.centre('side').x)); // Z: down in Top is left in Side
});

test('strokes drawn in a cell become flat 3D outlines on that plane', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  for (const name of ['front', 'side', 'top']) {
    s.items.length = 0;
    const c = L.centre(name);
    const item = stroke(s, around(c.x, c.y, 80, 60));
    assert.ok(item, name);
    assert.equal(classifyPlane(item.pts), PLANE_VIEWS[name].axis, `${name} outline is flat on its own axis`);
  }
});

test('a gesture that starts outside the drawing cells (or in the preview) does not draw', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  assert.equal(s.begin(L.centre('preview').x, L.centre('preview').y, RECT, 0), false);
  assert.equal(s.begin(10, 10, RECT, 0), false);
});

test('a stroke stays in the cell it started in, even when the hand strays into another', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const f = L.centre('front'), t = L.centre('top');
  s.setTool('free');
  s.begin(f.x, f.y, RECT, 0);
  s.add(f.x + 40, f.y, RECT, 0.01);
  s.add(t.x, t.y, RECT, 0.02); // wandered up into the Top cell
  s.add(f.x + 60, f.y - 40, RECT, 0.03);
  const item = s.end();
  assert.equal(classifyPlane(item.pts), 'z');
});

test('rect and circle tools lie flat in the cell they were drawn in', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const sd = L.centre('side');
  for (const tool of ['rect', 'circle']) {
    s.items.length = 0;
    const item = stroke(s, [[sd.x - 60, sd.y - 50], [sd.x + 60, sd.y + 50]], tool);
    assert.ok(item && item.closed, tool);
    assert.equal(classifyPlane(item.pts), 'x', tool);
  }
});

test('three outlines drawn on screen in the cells build the hull of a box', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const k = L.scale;
  for (const [name, w, h] of [['front', 0.6 * k, 0.5 * k], ['top', 0.6 * k, 0.4 * k], ['side', 0.4 * k, 0.5 * k]]) {
    const c = L.centre(name);
    stroke(s, box(c.x, c.y, w, h), 'rect');
  }
  const d = describeOutlines(s.items);
  assert.deepEqual([d.front, d.side, d.top], [1, 1, 1]);
  const r = buildHull(s.items, { n: 40 });
  assert.ok(r.ok, r.reason);
  assert.ok(Math.min(...Object.values(r.stats.iou)) > 0.9);
});

test('move drags an outline within its own view only', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const c = L.centre('front');
  const item = stroke(s, box(c.x, c.y, 60, 50), 'rect');
  s.setTool('move');
  assert.ok(s.begin(c.x + 60, c.y, RECT, 0, 'move'));
  s.add(c.x + 60 + 30, c.y - 20, RECT, 0.01);
  s.end();
  assert.equal(classifyPlane(item.pts), 'z'); // still flat on the front plane
  assert.ok(Math.abs(item.pts[0][0] - (-60 + 30) / L.scale) < 1e-6);
});

test('shared dimensions: matching views give clean ranges, disagreeing ones are flagged', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const k = L.scale;
  const draw = (name, w, h) => { const c = L.centre(name); stroke(s, box(c.x, c.y, w * k, h * k), 'rect'); };
  draw('front', 0.6, 0.5); draw('top', 0.6, 0.4);
  let sh = sharedDimensions(s.items);
  assert.equal(sh.mismatch.x, false);
  near(sh.ranges.x[0], -0.6, 1e-6); near(sh.ranges.x[1], 0.6, 1e-6);
  s.clear();
  draw('front', 0.6, 0.5); draw('top', 1.0, 0.4); // the top view is much wider than the front
  sh = sharedDimensions(s.items);
  assert.equal(sh.mismatch.x, true);
  assert.ok(sh.warnings.some((w) => /width/.test(w)));
});

test('guide lines continue a dimension into the other views that measure it', () => {
  const sh = { ranges: { x: [-0.5, 0.5], y: null, z: null }, mismatch: { x: false, y: false, z: false } };
  const g = guideLines(sh);
  const views = new Set(g.map((l) => l.view));
  assert.deepEqual([...views].sort(), ['front', 'top']); // width X shows in Front and Top, not Side
  assert.equal(g.length, 4); // two edges in each
  for (const l of g) { near(Math.abs(l.pts[0][0]), 0.5); near(l.pts[0][0], l.pts[1][0]); } // vertical lines at x = +-0.5
});

test('in a cell whose photo is being adjusted, a drag moves the photo instead of drawing', () => {
  const L = mk(), s = new Sketch();
  s.layout = L;
  const moves = [];
  s.photoDrag = { active: (v) => v === 'front', move: (v, du, dv) => moves.push([v, du, dv]) };
  const c = L.centre('front');
  assert.ok(s.begin(c.x, c.y, RECT, 0));
  assert.ok(s.busy);
  s.add(c.x + L.scale, c.y - L.scale / 2, RECT, 0.05);
  assert.equal(s.end({ now: 0.1 }), null, 'nothing is drawn');
  assert.equal(s.items.length, 0);
  assert.equal(moves.length, 1); // screen right/up -> world units
  assert.equal(moves[0][0], 'front'); near(moves[0][1], 1, 1e-9); near(moves[0][2], 0.5, 1e-9);
  // other cells still draw
  const t = L.centre('side');
  assert.ok(stroke(s, [[t.x, t.y], [t.x + 40, t.y], [t.x + 40, t.y + 40]]));
});

// ------------------------------------------------------------------ one view full screen
import { PlaneLayout as FocusLayout, CELL_NAMES as FOCUS_CELLS } from '../js/core/planes.js';

test('a focused view fills the whole area, the others are gone and cannot be hit, and closing it restores the four cells', () => {
  const L = new FocusLayout();
  const area = { x: 24, y: 130, w: 1000, h: 420 };
  L.set(area);
  const four = JSON.stringify(L.cells), smallScale = L.scale;
  L.focus = 'front';
  L.set(area);
  assert.deepEqual(L.cells.front, area);
  for (const n of FOCUS_CELLS.filter((c) => c !== 'front')) assert.equal(L.cells[n].w, 0, `${n} is not shown`);
  assert.equal(L.cellAt(500, 300), 'front');
  assert.equal(L.cellAt(-5000, -5000), null);
  assert.ok(L.scale > smallScale * 1.3, 'the drawing is larger now');
  // a point drawn at the centre maps to the same world point as before: the origin
  assert.deepEqual(L.toWorld('front', area.x + area.w / 2, area.y + area.h / 2).map((v) => Math.abs(v) < 1e-9), [true, true, true]);
  L.focus = null;
  L.set(area);
  assert.equal(JSON.stringify(L.cells), four);
});
