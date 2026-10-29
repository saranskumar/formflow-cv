import test from 'node:test';
import assert from 'node:assert/strict';
import { Poly } from '../js/core/shapes.js';
import { Sketch } from '../js/core/sketch.js';
import { Controller } from '../js/core/controller.js';
import {
  JOIN_TOL, MIN_LOOP_LENGTH, isJoinable, pathLength, closableGap, suggestFor, closedCopy, joinedCopy, stitchAll,
} from '../js/core/stitch.js';

const line = (pts, kind = 'free') => new Poly(kind, pts.map((p) => [p[0], p[1], p[2] ?? 0]));
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const circlePts = (r, gap, n = 60) => { // a circle drawn almost all the way round
  const sweep = 2 * Math.PI - gap / r;
  return [...Array(n)].map((_, i) => [r * Math.cos((sweep * i) / (n - 1)), r * Math.sin((sweep * i) / (n - 1)), 0]);
};

test('only open freehand and line strokes can be joined', () => {
  assert.ok(isJoinable(line([[0, 0], [1, 0]])));
  assert.ok(isJoinable(line([[0, 0], [1, 0]], 'line')));
  assert.ok(!isJoinable(new Poly('rect', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]], true)));
  assert.ok(!isJoinable(new Poly('free', [[0, 0, 0], [1, 0, 0], [0, 0, 0]], true))); // already closed
  assert.ok(!isJoinable(line([[0, 0]])));
});

test('a loop whose ends almost meet is offered to be closed', () => {
  const loop = line(circlePts(0.5, 0.06));
  const g = closableGap(loop);
  assert.ok(g !== null && g < JOIN_TOL);
  const s = suggestFor([loop], loop);
  assert.equal(s.type, 'close');
  near(s.gap, g);
});

test('a stroke with a big gap, or a tiny scribble, is not offered to be closed', () => {
  assert.equal(closableGap(line(circlePts(0.5, 0.4))), null);
  const scribble = line([[0, 0], [0.05, 0.02], [0.03, 0.01]]);
  assert.ok(pathLength(scribble.pts) < MIN_LOOP_LENGTH);
  assert.equal(closableGap(scribble), null);
  assert.equal(suggestFor([scribble], scribble), null);
});

test('a line whose end is near another line\'s end is offered to be joined, naming the right ends', () => {
  const a = line([[0, 0], [0.5, 0], [1, 0]]);
  const b = line([[1.05, 0.02], [1.5, 0.3], [2, 0.5]]);
  const s = suggestFor([a, b], b);
  assert.equal(s.type, 'join');
  assert.deepEqual([s.ea, s.eb], ['start', 'end']);
  assert.ok(s.gap < 0.06);
  const far = line([[3, 3], [4, 3]]);
  assert.equal(suggestFor([a, far], far), null);
});

test('the closest candidate wins, and a join beats a close only when the gap is smaller', () => {
  const loop = line(circlePts(0.5, 0.10)); // closable with gap 0.10
  const near1 = line([[loop.pts[loop.pts.length - 1][0] + 0.02, loop.pts[loop.pts.length - 1][1], 0], [2, 2]]);
  assert.equal(suggestFor([loop, near1], loop).type, 'join'); // 0.02 < 0.10
  const farther = line([[loop.pts[loop.pts.length - 1][0] + 0.11, loop.pts[loop.pts.length - 1][1], 0], [2, 2]]);
  assert.equal(suggestFor([loop, farther], loop).type, 'close');
});

test('closing makes the last point the first and flags the outline closed, without touching the original', () => {
  const loop = line(circlePts(0.5, 0.06));
  const before = loop.pts.map((p) => p.slice());
  const c = closedCopy(loop);
  assert.ok(c.closed);
  assert.deepEqual(c.pts[c.pts.length - 1], c.pts[0]);
  assert.equal(c.pts.length, loop.pts.length);
  assert.deepEqual(loop.pts, before);
  assert.ok(!loop.closed);
});

test('joining orients both strokes correctly whichever ends touch, with no gap and no duplicate point', () => {
  const A = [[0, 0], [1, 0]], B = [[1.04, 0], [2, 0]];
  const cases = [
    ['end', 'start', A, B],
    ['end', 'end', A, B.slice().reverse()],
    ['start', 'start', A.slice().reverse(), B],
    ['start', 'end', A.slice().reverse(), B.slice().reverse()],
  ];
  for (const [ea, eb, pa, pb] of cases) {
    const j = joinedCopy(line(pa), ea, line(pb), eb);
    assert.equal(j.pts.length, 3, `${ea}/${eb}`);
    near(j.pts[1][0], 1.02, 1e-9); // the joint is the midpoint
    const outer = [j.pts[0][0], j.pts[2][0]].sort((p, q) => p - q);
    near(outer[0], 0, 1e-9); near(outer[1], 2, 1e-9); // the far ends of both strokes are the ends of the result
    assert.ok(!j.closed);
  }
});

test('stitchAll joins a chain of three strokes and closes the loop they make', () => {
  const a = line([[0, 0], [1, 0]]);
  const b = line([[1.03, 0], [1, 1]]);
  const c = line([[1.02, 1.02], [0.02, 1.0], [0.0, 0.04]]);
  const r = stitchAll([a, b, c]);
  assert.equal(r.joined, 2);
  assert.equal(r.closed, 1);
  assert.deepEqual(new Set(r.removed), new Set([a, b, c]));
  assert.equal(r.added.length, 1);
  assert.ok(r.added[0].closed);
  assert.ok(pathLength(r.added[0].pts) > 3.5);
});

test('stitchAll leaves unrelated strokes alone and is idempotent', () => {
  const a = line([[0, 0], [1, 0]]);
  const far = line([[3, 3], [4, 3]]);
  const r = stitchAll([a, far]);
  assert.deepEqual([r.joined, r.closed, r.removed.length, r.added.length], [0, 0, 0, 0]);
  const loop = line(circlePts(0.5, 0.05));
  const first = stitchAll([loop, far]);
  const second = stitchAll([...first.added, far]);
  assert.deepEqual([second.joined, second.closed], [0, 0]);
});

test('stitchAll never mutates its input and merges the closest ends first', () => {
  const a = line([[0, 0], [1, 0]]);
  const b = line([[1.10, 0], [2, 0]]);
  const c = line([[1.01, 0], [1.5, 1]]);
  const snapshot = JSON.stringify([a.pts, b.pts, c.pts]);
  const r = stitchAll([a, b, c]);
  assert.equal(JSON.stringify([a.pts, b.pts, c.pts]), snapshot);
  assert.ok(r.joined >= 1);
});

// --------------------------------------------------- applying it in the sketch (undo)
const R = { x: 0, y: 0, w: 1280, h: 720 };

test('joining is one undoable step that restores the original strokes in place', () => {
  const s = new Sketch();
  const a = s.addItem(line([[0, 0], [1, 0]]));
  const mid = s.addItem(new Poly('free', [[5, 5, 0], [5.5, 5, 0]]));
  const b = s.addItem(line([[1.04, 0], [2, 0]]));
  const joined = joinedCopy(a, 'end', b, 'start');
  s.replaceItems([a, b], [joined]);
  assert.deepEqual(s.items, [mid, joined]);
  s.undo();
  assert.deepEqual(s.items, [a, mid, b]); // back in their old order
  s.undo();
  assert.deepEqual(s.items, [a, mid]);
});

test('undo still removes the last drawn item, imported item, and can undo a clear()', () => {
  const s = new Sketch();
  s.begin(500, 360, R, 0); s.add(560, 380, R, 0.1); s.end({ now: 0.2 });
  s.addItem(line([[0, 0], [1, 1]]));
  s.undo();
  assert.equal(s.items.length, 1);
  s.undo();
  assert.equal(s.items.length, 0);
  s.undo(); // nothing left: must not throw or count
  assert.equal(s.undoCount, 2);
  s.addItem(line([[0, 0], [1, 1]]));
  s.clear();
  assert.equal(s.items.length, 0);
  s.undo(); // clearing is one undoable step: undo brings everything back
  assert.equal(s.items.length, 1);
});

test('ending a stroke returns the new item, and the controller reports it', () => {
  const sk = new Sketch();
  sk.yaw = sk.pitch = 0;
  const committed = [];
  const c = new Controller({ sketch: sk, getRect: () => R, onCommit: (it) => committed.push(it) });
  let t = 0;
  const hand = (x, y, pinch) => ({ main: { x, y, cx: x, cy: y, pinch, grab: false, fist: false, peace: false, source: 'mouse' }, second: null });
  c.update(hand(500, 360, false), t += 0.03);
  c.update(hand(500, 360, true), t += 0.03);
  for (let i = 1; i <= 10; i++) c.update(hand(500 + 15 * i, 360 + 5 * i, true), t += 0.03);
  c.update(hand(650, 410, false), t += 0.03);
  assert.equal(committed.length, 1);
  assert.equal(committed[0], sk.items[0]);
  assert.equal(committed[0].kind, 'free');
});

test('rectangles and circles come out closed, strokes do not', () => {
  const s = new Sketch();
  s.yaw = s.pitch = 0;
  for (const tool of ['rect', 'circle']) {
    s.setTool(tool);
    s.begin(640, 360, R, 0); s.add(700, 400, R, 0.1); s.end({ now: 0.2 });
  }
  assert.deepEqual(s.items.map((i) => i.closed), [true, true]);
  s.setTool('free');
  s.begin(500, 360, R, 1); s.add(560, 380, R, 1.1); s.add(620, 360, R, 1.2); s.end({ now: 1.3 });
  assert.equal(s.items[2].closed, false);
});

test('the camera snaps to the front, side and top views, looking straight down each axis', () => {
  const s = new Sketch();
  s.target = [1, 1, 1];
  for (const [view, axis] of [['front', 2], ['side', 0], ['top', 1]]) {
    assert.ok(s.setView(view));
    const { fwd, right, up } = s.basis();
    assert.ok(Math.abs(Math.abs(fwd[axis]) - 1) < 1e-3, `${view}: looking along ${axis}`);
    assert.ok(right.every(Number.isFinite) && up.every(Number.isFinite), `${view}: finite basis`);
    assert.deepEqual(s.target, [0, 0, 0]);
  }
  assert.equal(s.setView('bottom'), false);
});

test('a stroke drawn in a snapped view lies on one flat plane perpendicular to that axis', () => {
  const s = new Sketch();
  for (const [view, axis] of [['front', 2], ['side', 0], ['top', 1]]) {
    s.setView(view);
    s.begin(500, 300, R, 0); s.add(700, 320, R, 0.1); s.add(760, 420, R, 0.2); s.end({ now: 0.3 });
    const pts = s.items[s.items.length - 1].pts;
    const range = Math.max(...pts.map((p) => p[axis])) - Math.min(...pts.map((p) => p[axis]));
    assert.ok(range < 0.01, `${view}: spread along its axis ${range}`);
  }
});

// ------------------------------------------------- settings and view detection for these features
import { normalizeSettings, DEFAULTS } from '../js/core/settings.js';
import { CONTROLS } from '../js/core/controls.js';

test('asking to join is on by default and accepts the values a segmented control sends', () => {
  assert.equal(DEFAULTS.askJoin, true);
  assert.equal(normalizeSettings(null).askJoin, true);
  assert.equal(normalizeSettings({ askJoin: 'false' }).askJoin, false);
  assert.equal(normalizeSettings({ askJoin: 'true' }).askJoin, true);
  assert.equal(normalizeSettings({ askJoin: false }).askJoin, false);
  assert.equal(normalizeSettings({ askJoin: 42 }).askJoin, true);
});

test('controls table lists joining, the views and the hull', () => {
  const ids = CONTROLS.map((c) => c.id);
  for (const id of ['join', 'views', 'hull']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the sketch knows which orthographic view the camera is in', () => {
  const s = new Sketch();
  assert.equal(s.alignedView(), null); // the default iso view
  for (const v of ['front', 'side', 'top']) { s.setView(v); assert.equal(s.alignedView(), v); }
  s.setView('front');
  s.orbit(40, 0, 0);
  assert.equal(s.alignedView(), null); // orbit away and it is no longer orthographic
  s.resetView();
  assert.equal(s.alignedView(), null);
});

// ------------------------------------------------------------------ the prompt (needs a DOM: a tiny stand-in)
test('an unanswered join prompt expires and clears itself, so a later "yes" cannot apply a stale join', async () => {
  const els = [];
  const mk = () => { const e = { hidden: true, children: [], listeners: {}, textContent: '', _q: {}, append() {}, addEventListener(t, f) { this.listeners[t] = f; },
    querySelector(sel) { return (this._q[sel] ||= { textContent: '', hidden: false }); } }; els.push(e); return e; };
  globalThis.document = { createElement: mk };
  const { JoinPrompt } = await import('../js/ui/prompt.js');
  let expired = 0, answered = [];
  const p = new JoinPrompt({ append() {} }, (a) => answered.push(a), { timeout: 20, onExpire: () => expired++ });
  p.show({ title: 'Join?', detail: 'x', yes: 'Join', no: 'No' });
  assert.ok(p.open);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(!p.open);
  assert.equal(expired, 1);
  p.show({ title: 'again', detail: 'x', yes: 'Join', no: 'No' });
  p.hide(); // a normal dismissal does not count as an expiry
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(expired, 1);
  p.el.listeners.click({ target: { closest: () => ({ dataset: { ans: 'yes' } }) } }); // a press reaches the callback
  assert.deepEqual(answered, ['yes']);
  delete globalThis.document;
});
