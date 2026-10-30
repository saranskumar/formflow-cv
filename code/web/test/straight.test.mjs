import test from 'node:test';
import assert from 'node:assert/strict';
import { Sketch, straightEnds } from '../js/core/sketch.js';

const R = { x: 0, y: 0, w: 1280, h: 720 };
const fresh = (on = true) => { const s = new Sketch(); s.yaw = 0; s.pitch = 0; s.autoStraight = on; s.setTool('free'); return s; };
function stroke(s, pts) {
  s.begin(pts[0][0], pts[0][1], R, 1);
  pts.slice(1).forEach(([x, y], i) => s.add(x, y, R, 1 + 0.02 * (i + 1)));
  return s.end({ now: 3 });
}
const across = (n, f) => [...Array(n)].map((_, i) => [200 + (i * 600) / (n - 1), 300 + f(i)]);

test('auto-straight: a wobbly, nearly straight stroke becomes one exact straight line, and shows straight while it is drawn', () => {
  const s = fresh();
  const pts = across(40, (i) => Math.sin(i * 1.7) * 3);
  s.begin(pts[0][0], pts[0][1], R, 1);
  pts.slice(1).forEach(([x, y], i) => s.add(x, y, R, 1 + 0.02 * (i + 1)));
  assert.equal(s.preview().kind, 'line', 'what you see while drawing is already straight');
  const it = s.end({ now: 3 });
  assert.equal(it.kind, 'line');
  assert.equal(it.pts.length, 2);
  assert.ok(Math.abs(it.pts[0][1] - it.pts[1][1]) < 0.02, 'it joins the two ends of the stroke, which were level to within the wobble');
  assert.ok(s.items.includes(it));
});

test('auto-straight leaves curves, zigzags, loops and tiny strokes alone, and does nothing when it is off', () => {
  assert.equal(stroke(fresh(), across(40, (i) => Math.sin((i / 39) * Math.PI) * 120)).kind, 'free', 'a curve');
  assert.equal(stroke(fresh(), across(40, (i) => (i % 2 ? 30 : -30))).kind, 'free', 'a zigzag');
  const loop = [...Array(40)].map((_, i) => [640 + 120 * Math.cos((i / 39) * 6.2832), 360 + 120 * Math.sin((i / 39) * 6.2832)]);
  assert.equal(stroke(fresh(), loop).kind, 'free', 'a loop');
  assert.equal(stroke(fresh(), [[600, 360], [605, 361], [610, 360], [615, 360]]).kind, 'free', 'too short to mean a line');
  assert.equal(stroke(fresh(false), across(40, (i) => Math.sin(i * 1.7) * 3)).kind, 'free', 'switched off');
});

test('straightEnds: the tolerances, and only the free tool is straightened', () => {
  const line = (n, f) => [...Array(n)].map((_, i) => [i / (n - 1), f(i), 0]);
  assert.ok(straightEnds(line(20, () => 0)));
  assert.ok(straightEnds(line(20, (i) => (i % 2 ? 0.02 : -0.02))), 'a 2% wobble still counts');
  assert.equal(straightEnds(line(20, (i) => (i % 2 ? 0.2 : -0.2))), null, 'a zigzag does not');
  assert.equal(straightEnds([[0, 0, 0], [0.05, 0, 0]]), null);
  assert.equal(straightEnds([[0, 0, 0]]), null);
  const s = fresh();
  s.setTool('rect');
  s.begin(300, 300, R, 1);
  s.add(500, 420, R, 1.1);
  assert.equal(s.end({ now: 2 }).kind, 'rect');
});
