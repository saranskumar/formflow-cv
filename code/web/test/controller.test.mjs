import test from 'node:test';
import assert from 'node:assert/strict';
import { Sketch } from '../js/core/sketch.js';
import { Solid } from '../js/core/shapes.js';
import { Controller, FREEZE_AFTER_RELEASE, HOLD_DRAW_S } from '../js/core/controller.js';

const R = { x: 0, y: 0, w: 1280, h: 720 };

function rig(hudRects = []) {
  const sketch = new Sketch();
  sketch.yaw = 0; sketch.pitch = 0;
  const pressed = [];
  const hit = (x, y) => hudRects.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) || null;
  const c = new Controller({ sketch, getRect: () => R, ui: { hit, press: (el) => pressed.push(el.id) } });
  let now = 0;
  const hand = (x, y, o = {}) => ({ x, y, cx: o.cx ?? x, cy: o.cy ?? y, pinch: false, grab: false, fist: false, peace: false, source: 'hand', ...o });
  const step = (main, second = null, dt = 1 / 30) => { now += dt; c.update({ main, second }, now); };
  const run = (n, f) => { for (let i = 0; i < n; i++) f(i); };
  // pinch and hold: a stroke only starts once the pinch has been held a moment (HOLD_DRAW_S); a quicker pinch is a click
  const hold = (x, y, o = {}) => run(Math.ceil(HOLD_DRAW_S * 30) + 1, () => step(hand(x, y, { pinch: true, ...o })));
  return { sketch, c, pressed, hand, step, run, hold, get now() { return now; } };
}

test('pinch + drag draws the current tool; hover alone does nothing', () => {
  const r = rig();
  r.sketch.setTool('cube');
  r.run(10, () => r.step(r.hand(640, 360)));
  assert.equal(r.sketch.items.length, 0);
  r.hold(640, 360);
  assert.ok(r.c.drawing);
  r.run(6, (i) => r.step(r.hand(640 + 12 * (i + 1), 360, { pinch: true })));
  r.step(r.hand(700, 360)); // release
  assert.equal(r.sketch.items.length, 1);
  assert.equal(r.sketch.items[0].kind, 'cube');
});

test('thumb+middle grab moves the nearest object whatever the tool is', () => {
  const r = rig();
  r.sketch.setTool('cube');
  r.hold(640, 360);
  r.run(5, (i) => r.step(r.hand(640 + 12 * (i + 1), 360, { pinch: true })));
  r.step(r.hand(700, 360));
  r.run(15, () => r.step(r.hand(700, 360))); // let the post-release pause end
  r.sketch.setTool('free'); // the active tool is NOT move
  const cube = r.sketch.items[0];
  const x0 = cube.center[0];
  r.step(r.hand(640, 360, { grab: true }));
  r.run(10, (i) => r.step(r.hand(640 + 10 * (i + 1), 360, { grab: true })));
  r.step(r.hand(760, 360));
  assert.equal(r.sketch.items.length, 1, 'grabbing never draws');
  assert.ok(cube.center[0] > x0 + 0.2);
});

test('a grab on empty space does nothing', () => {
  const r = rig();
  r.step(r.hand(200, 200, { grab: true }));
  r.run(5, (i) => r.step(r.hand(200 + 10 * i, 200, { grab: true })));
  assert.equal(r.sketch.items.length, 0);
  assert.ok(!r.c.drawing);
});

test('HUD buttons need an intentional pinch: hovering never presses', () => {
  const btn = { id: 'cube', x: 20, y: 100, w: 100, h: 40 };
  const r = rig([btn]);
  r.run(120, () => r.step(r.hand(60, 120))); // 4 seconds of hovering
  assert.deepEqual(r.pressed, []);
  r.step(r.hand(60, 120, { pinch: true }));
  assert.deepEqual(r.pressed, ['cube']);
  r.run(10, () => r.step(r.hand(60, 120, { pinch: true }))); // holding the pinch does not repeat or draw
  assert.deepEqual(r.pressed, ['cube']);
  assert.equal(r.sketch.items.length, 0);
});

test('a pinch that started on a HUD button never turns into a stroke when it slides into the scene', () => {
  const r = rig([{ id: 'x', x: 0, y: 0, w: 200, h: 720 }]);
  r.step(r.hand(100, 300, { pinch: true }));
  r.run(10, (i) => r.step(r.hand(100 + 40 * i, 300, { pinch: true })));
  assert.equal(r.sketch.items.length, 0);
  assert.ok(!r.c.drawing);
});

test('after a hand release input is ignored briefly, then works normally', () => {
  const r = rig();
  r.hold(640, 360);
  r.run(5, (i) => r.step(r.hand(660 + 8 * i, 360, { pinch: true })));
  r.step(r.hand(700, 360)); // release
  assert.equal(r.sketch.items.length, 1);
  r.step(r.hand(700, 340, { pinch: true })); // jittery re-pinch immediately
  assert.ok(!r.c.drawing);
  r.run(Math.ceil(FREEZE_AFTER_RELEASE * 30) + 2, () => r.step(r.hand(700, 340)));
  r.hold(700, 340);
  assert.ok(r.c.drawing);
});

test('the mouse has no release pause', () => {
  const r = rig();
  r.step(r.hand(640, 360, { pinch: true, source: 'mouse' }));
  r.run(5, (i) => r.step(r.hand(660 + 8 * i, 360, { pinch: true, source: 'mouse' })));
  r.step(r.hand(700, 360, { source: 'mouse' }));
  r.step(r.hand(700, 340, { pinch: true, source: 'mouse' }));
  assert.ok(r.c.drawing);
});

test('second-hand fist orbits while the main hand keeps drawing', () => {
  const r = rig();
  r.step(r.hand(500, 360, { pinch: true }), r.hand(300, 300, { fist: true }));
  const yaw0 = r.sketch.yaw;
  r.run(12, (i) => r.step(r.hand(500 + 5 * (i + 1), 360, { pinch: true }), r.hand(300, 300, { fist: true, cx: 300 + 8 * (i + 1), cy: 300 })));
  assert.ok(r.c.drawing && r.sketch.active.length > 3);
  assert.notEqual(r.sketch.yaw, yaw0);
});

test('second-hand fist release lets the view coast to a stop', () => {
  const r = rig();
  r.run(10, (i) => r.step(null, r.hand(300, 300, { fist: true, cx: 300 + 30 * i, cy: 300 })));
  r.step(null, r.hand(300, 300));
  assert.ok(r.sketch.coasting);
  const y = r.sketch.yaw;
  r.run(30, () => r.step(null, r.hand(300, 300)));
  assert.notEqual(r.sketch.yaw, y);
});

test('second-hand peace sign pans without orbiting or zooming', () => {
  const r = rig();
  const yaw = r.sketch.yaw, dist = r.sketch.dist;
  r.run(15, (i) => r.step(r.hand(600, 400), r.hand(300, 300, { peace: true, cx: 300 + 10 * i, cy: 300 - 4 * i })));
  assert.ok(Math.hypot(...r.sketch.target) > 0.2);
  assert.equal(r.sketch.yaw, yaw);
  assert.equal(r.sketch.dist, dist);
});

test('both hands pinched: apart zooms in, together zooms out', () => {
  const r = rig();
  r.step(r.hand(600, 400, { pinch: true }), r.hand(800, 400, { pinch: true }));
  const d0 = r.sketch.dist;
  r.run(25, (i) => r.step(r.hand(600 - 6 * i, 400, { pinch: true }), r.hand(800 + 6 * i, 400, { pinch: true })));
  assert.ok(r.sketch.dist < d0 * 0.7);
  const zoomed = r.sketch.dist;
  r.run(60, (i) => r.step(r.hand(450 + 5 * i, 400, { pinch: true }), r.hand(950 - 5 * i, 400, { pinch: true })));
  assert.ok(r.sketch.dist > zoomed * 1.4);
});

test('a single pinch of the second hand does nothing', () => {
  const r = rig();
  const d0 = r.sketch.dist;
  r.run(15, (i) => r.step(null, r.hand(300, 400 - 12 * i, { pinch: true })));
  assert.equal(r.sketch.dist, d0);
  assert.deepEqual(r.sketch.target, [0, 0, 0]);
});

test('starting the two-hand zoom cancels a stray stroke and blocks drawing right after', () => {
  const r = rig();
  r.hold(600, 300);
  r.run(4, (i) => r.step(r.hand(620 + 10 * i, 300, { pinch: true })));
  assert.ok(r.c.drawing);
  r.step(r.hand(650, 300, { pinch: true }), r.hand(900, 300, { pinch: true }));
  assert.ok(!r.c.drawing && r.sketch.items.length === 0 && !r.sketch.busy);
  r.step(r.hand(655, 300, { pinch: true }), r.hand(905, 300, { pinch: true }));
  r.step(r.hand(660, 300, { pinch: true }), null); // second hand lets go first
  r.step(r.hand(670, 300, { pinch: true }), null);
  assert.ok(!r.c.drawing && r.sketch.items.length === 0);
});

test('mouse-style navigation: main fist orbits, main peace pans (single-hand fallback)', () => {
  const r = rig();
  const yaw = r.sketch.yaw;
  r.run(10, (i) => r.step(r.hand(600, 300, { fist: true, cx: 600 + 8 * i, cy: 300, source: 'mouse' })));
  assert.notEqual(r.sketch.yaw, yaw);
  r.step(r.hand(600, 300, { source: 'mouse' }));
  r.run(10, (i) => r.step(r.hand(600, 300, { peace: true, cx: 600 + 8 * i, cy: 300, source: 'mouse' })));
  assert.ok(Math.hypot(...r.sketch.target) > 0.1);
});

test('losing the main hand mid-stroke abandons it cleanly', () => {
  const r = rig();
  r.step(r.hand(600, 300, { pinch: true }));
  r.run(4, (i) => r.step(r.hand(620 + 10 * i, 300, { pinch: true })));
  r.step(null);
  assert.ok(!r.c.drawing && !r.sketch.busy && r.sketch.items.length === 0);
});

// ------------------------------------------------------------------ point and hold
import { DWELL_S } from '../js/core/controller.js';

const button = (id, o = {}) => ({ id, tagName: 'BUTTON', disabled: false, x: 100, y: 100, w: 120, h: 60, ...o });

test('pointing at a button and holding presses it once, after DWELL_S, and shows its progress', () => {
  const b = button('undo');
  const r = rig([b]);
  r.run(3, () => r.step(r.hand(150, 130, { point: true })));
  assert.deepEqual(r.pressed, []);
  assert.ok(r.c.dwell.progress > 0 && r.c.dwell.progress < 1);
  r.run(Math.ceil(DWELL_S * 30), () => r.step(r.hand(150, 130, { point: true })));
  assert.deepEqual(r.pressed, ['undo']);
  assert.equal(r.c.dwell.progress, 1);
  r.run(60, () => r.step(r.hand(150, 130, { point: true })));
  assert.deepEqual(r.pressed, ['undo'], 'it does not repeat while the finger stays');
});

test('moving off the button cancels it; a short slip does not; a disabled button is never pressed', () => {
  const a = button('a'), b = button('b', { x: 400 }), off = button('off', { x: 700, disabled: true });
  const r = rig([a, b, off]);
  r.run(10, () => r.step(r.hand(150, 130, { point: true })));            // 0.33 s on a
  r.run(10, () => r.step(r.hand(450, 130, { point: true })));            // moved to b: starts over
  assert.deepEqual(r.pressed, []);
  r.run(3, () => r.step(r.hand(300, 400, { point: true })));             // a slip of 0.1 s into empty space
  r.run(Math.ceil(DWELL_S * 30), () => r.step(r.hand(450, 130, { point: true })));
  assert.deepEqual(r.pressed, ['b']);
  r.run(Math.ceil(DWELL_S * 30) + 10, () => r.step(r.hand(750, 130, { point: true })));
  assert.deepEqual(r.pressed, ['b'], 'the disabled button stays unpressed');
});

test('only a pointing finger selects: an open hand over a button does nothing, and a pinch still presses at once', () => {
  const b = button('go');
  const r = rig([b]);
  r.run(60, () => r.step(r.hand(150, 130)));
  assert.deepEqual(r.pressed, []);
  r.step(r.hand(150, 130, { pinch: true }));
  assert.deepEqual(r.pressed, ['go']);
});


// ------------------------------------------------------------------ pinch: a tap clicks, a hold draws, a drag on a panel scrolls
test('a quick pinch in the scene is a click (it selects), not a stroke; the same pinch held draws', () => {
  const r = rig();
  r.sketch.setTool('free');
  const cube = r.sketch.addItem(new Solid('cube', [0, 0, 0], 0.4));
  const p = r.sketch.project(cube.center, R);
  r.run(3, () => r.step(r.hand(p.x, p.y)));
  r.run(4, () => r.step(r.hand(p.x, p.y, { pinch: true }))); // 0.13 s: shorter than the hold
  assert.ok(r.c.hold.progress > 0 && r.c.hold.progress < 1, 'a ring shows the hold coming');
  r.run(12, () => r.step(r.hand(p.x, p.y)));                 // let go
  assert.equal(r.sketch.items.length, 1, 'no stroke');
  assert.equal(r.sketch.selected, cube, 'the cube was clicked');
  r.run(12, () => r.step(r.hand(R.w - 40, 40)));
  r.hold(R.w - 40, 40);                                      // a tap on empty space clears it ... when it is quick; held, it draws
  r.run(6, (i) => r.step(r.hand(R.w - 40 - 12 * i, 40, { pinch: true })));
  assert.ok(r.c.drawing);
});

test('a tap on empty space clears the selection, and the mouse draws at once', () => {
  const r = rig();
  const cube = r.sketch.addItem(new Solid('cube', [0, 0, 0], 0.4));
  r.sketch.selected = cube;
  r.run(3, () => r.step(r.hand(30, 30)));
  r.run(3, () => r.step(r.hand(30, 30, { pinch: true })));
  r.run(12, () => r.step(r.hand(30, 30)));
  assert.equal(r.sketch.selected, null);
  r.step(r.hand(640, 360, { pinch: true, source: 'mouse' }));
  assert.ok(r.c.drawing, 'no hold for the mouse');
});

test('a pinch that starts on a panel (not a button) scrolls it instead of pressing or drawing', () => {
  const scrolled = [];
  const sketch = new Sketch();
  const panel = { id: 'panel', tagName: 'DIV', x: 100, y: 100, w: 300, h: 300 };
  const c = new Controller({ sketch, getRect: () => R, ui: { hit: (x, y) => (x >= 100 && x <= 400 && y >= 100 && y <= 400 ? panel : null), press: () => scrolled.push('PRESS'), scrollBy: (x, y, dy) => { scrolled.push(Math.round(dy)); return true; } } });
  let now = 0;
  const step = (y, pinch) => { now += 1 / 30; c.update({ main: { x: 200, y, cx: 200, cy: y, pinch, grab: false, fist: false, peace: false, source: 'hand' }, second: null }, now); };
  for (let i = 0; i < 3; i++) step(300, false);
  step(300, true); step(280, true); step(250, true); step(250, false);
  assert.deepEqual(scrolled.filter((v) => v !== 'PRESS'), [20, 30], 'dragged up by 20 then 30 px: the content moves with the hand');
  assert.ok(!scrolled.includes('PRESS'));
  assert.equal(sketch.items.length, 0);
});
