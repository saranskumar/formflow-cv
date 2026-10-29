import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureDecoder } from '../js/core/gestures.js';
import { HandTrack } from '../js/core/track.js';
import { OneEuro } from '../js/core/oneEuro.js';
import { selectUserHands, assignRoles } from '../js/core/select.js';
import { isotropicRegion, Mapper } from '../js/core/mapping.js';
import { hand, feed, ASPECT } from './helpers.mjs';

const run = (dec, opts, n = 3) => { let r; for (let i = 0; i < n; i++) r = dec.step(hand(opts)); return r; };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// ------------------------------------------------------------------ gestures
test('each pose is recognised and only that pose', () => {
  const cases = {
    open: {}, pinch: { pinch: true }, grab: { grab: true }, fist: { fist: true }, peace: { peace: true },
  };
  for (const [pose, expect] of Object.entries(cases)) {
    const r = run(new GestureDecoder(), { pose });
    for (const k of ['pinch', 'grab', 'fist', 'peace']) assert.equal(r[k], !!expect[k], `${pose}: ${k}`);
  }
});

test('thumb+index pinch and thumb+middle grab are told apart', () => {
  const d = new GestureDecoder();
  const p = run(d, { pose: 'pinch' });
  assert.ok(p.pinch && !p.grab);
  const g = run(new GestureDecoder(), { pose: 'grab' });
  assert.ok(g.grab && !g.pinch);
});

test('pinch has hysteresis and debounce', () => {
  const d = new GestureDecoder({ on: 0.30, off: 0.45, debounce: 2 });
  assert.ok(!d.step(hand({ pose: 'open' })).pinch);
  assert.ok(!d.step(hand({ pose: 'pinch', g: 0.1 })).pinch, 'first closed frame is debounced');
  assert.ok(d.step(hand({ pose: 'pinch', g: 0.1 })).pinch, 'second frame confirms');
  assert.ok(d.step(hand({ pose: 'pinch', g: 0.40 })).pinch, 'between thresholds it stays pinched');
  d.step(hand({ pose: 'open' }));
  assert.ok(!d.step(hand({ pose: 'open' })).pinch, 'clearly open releases');
});

test('one noisy frame never toggles a gesture', () => {
  const d = new GestureDecoder();
  run(d, { pose: 'open' });
  assert.ok(!d.step(hand({ pose: 'pinch', g: 0.05 })).pinch);
  assert.ok(!d.step(hand({ pose: 'open' })).pinch);
  assert.ok(!d.step(hand({ pose: 'open' })).pinch);
});

test('pinch is scale invariant', () => {
  for (const size of [0.04, 0.1, 0.25]) assert.ok(run(new GestureDecoder(), { pose: 'pinch', size }).pinch, `size ${size}`);
});

test('a fist is never also a pinch', () => {
  const r = run(new GestureDecoder(), { pose: 'fist' });
  assert.ok(r.fist && !r.pinch && !r.grab && !r.peace);
});

test('peace needs index+middle up and ring+pinky down; a wide-open hand is not peace', () => {
  assert.ok(run(new GestureDecoder(), { pose: 'peace' }).peace);
  assert.ok(!run(new GestureDecoder(), { pose: 'open' }).peace);
});

test('cursor sits between thumb and finger; palm centre is steady', () => {
  const r = new GestureDecoder().step(hand({ pose: 'pinch', at: [0.4, 0.6] }));
  near(r.cursor[1], 0.6 - 0.1 * 1.45, 0.005);
  near(r.center[1], 0.6 - 0.05, 0.002);
});

// --------------------------------------------------------------------- filter
test('one-euro smooths jitter when still and follows fast sweeps', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.008;
  const f = new OneEuro();
  const out = [];
  for (let i = 0; i < 60; i++) out.push(f.filter([0.5 + rnd(), 0.5 + rnd()], i / 30)[0]);
  const tail = out.slice(20);
  const mean = tail.reduce((a, b) => a + b) / tail.length;
  const sd = Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
  assert.ok(sd < 0.004, `still jitter ${sd}`);
  const g = new OneEuro();
  let last;
  for (let i = 0; i < 30; i++) last = g.filter([i * 0.03, 0.5], i / 30);
  near(last[0], 29 * 0.03, 0.08);
});

// ----------------------------------------------------------------- hand track
test('a one-frame teleport is rejected, a sustained move is accepted', () => {
  const t = new HandTrack();
  let [r, now] = feed(t, 0.5, { at: [0.3, 0.4] });
  const base = r.cur.slice();
  r = t.step(hand({ at: [0.8, 0.8] }), now);
  assert.ok(Math.hypot(r.cur[0] - base[0], r.cur[1] - base[1]) < 0.05);
  for (let i = 1; i < 8; i++) r = t.step(hand({ at: [0.8, 0.8] }), now + i / 30);
  assert.ok(r.cur[0] > 0.6);
});

test('pinch onset is latched to where the cursor was before the fingers closed', () => {
  const t = new HandTrack();
  let [r, now] = feed(t, 1.0, { pose: 'open', at: [0.5, 0.5] });
  const before = r.cur[0]; // where the cursor was just before the fingers started closing
  const steps = [[0.7, 0.505], [0.5, 0.52], [0.1, 0.54], [0.1, 0.56], [0.1, 0.56], [0.1, 0.56]];
  steps.forEach(([g, x], i) => { r = t.step(hand({ pose: 'pinch', g, at: [x, 0.5] }), now + i / 30); });
  assert.ok(r.pinch);
  assert.ok(Math.abs(r.cur[0] - before) < 0.01, `latched at ${r.cur[0]}, before was ${before}`);
});

test('release freezes the cursor so the hand opening does not drag the object', () => {
  const t = new HandTrack();
  let [r, now] = feed(t, 1.0, { pose: 'pinch', g: 0.05, at: [0.5, 0.5] });
  assert.ok(r.pinch);
  [[0.3, 0.5], [0.8, 0.53], [1.0, 0.56], [1.0, 0.58]].forEach(([g, x], i) => {
    r = t.step(hand({ pose: g > 0.5 ? 'open' : 'pinch', g, at: [x, 0.5] }), now + i / 30);
  });
  assert.ok(!r.pinch);
  assert.ok(Math.abs(r.cur[0] - 0.5) < 0.03, `cursor ${r.cur[0]}`);
});

// ---------------------------------------------------------------- selection
const det = (side, x, size) => ({ side, lm: hand({ at: [x, 0.6], size }) });

test('a bystander with small hands is ignored', () => {
  const dets = [det('Right', 0.5, 0.05), det('Right', 0.7, 0.14), det('Left', 0.3, 0.13)];
  assert.deepEqual(selectUserHands(dets, null, ASPECT).sort(), [1, 2]);
  assert.deepEqual(selectUserHands([det('Right', 0.7, 0.14), det('Right', 0.5, 0.05)], null, ASPECT), [0]);
});

test('never more than two hands, tiny far hands dropped', () => {
  const four = [det('Right', 0.7, 0.14), det('Left', 0.3, 0.13), det('Right', 0.5, 0.12), det('Left', 0.1, 0.12)];
  assert.equal(selectUserHands(four, null, ASPECT).length, 2);
  assert.deepEqual(selectUserHands([det('Right', 0.5, 0.02)], null, ASPECT), []);
});

test('same-label pair accepted only when apart and comparable', () => {
  const a = det('Right', 0.7, 0.14);
  assert.deepEqual(selectUserHands([a, det('Right', 0.3, 0.13)], null, ASPECT), [0, 1]);
  assert.deepEqual(selectUserHands([a, det('Right', 0.72, 0.13)], null, ASPECT), [0]);
  assert.deepEqual(selectUserHands([a, det('Right', 0.3, 0.07)], null, ASPECT), [0]);
});

test('the hand near the previous main position is preferred', () => {
  const left = det('Left', 0.2, 0.125);
  const right = det('Right', 0.8, 0.13);
  assert.equal(selectUserHands([left, right], [0.2, 0.6], ASPECT)[0], 0);
  assert.equal(selectUserHands([left, right], null, ASPECT)[0], 1);
});

test('roles follow the dominant hand, with a position fallback', () => {
  assert.deepEqual(assignRoles(['Left'], [0.3]), ['main']);
  assert.deepEqual(assignRoles(['Right', 'Left'], [0.7, 0.3], 'Right'), ['main', 'second']);
  assert.deepEqual(assignRoles(['Left', 'Right'], [0.3, 0.7], 'Left'), ['main', 'second']);
  assert.deepEqual(assignRoles(['Right', 'Right'], [0.3, 0.7], 'Right'), ['second', 'main']);
});

// ------------------------------------------------------------------ mapping
test('isotropic region equalises axis speed and stays inside the image', () => {
  for (const box of [[0.1, 0.2, 0.9, 0.6], [0.4, 0.05, 0.6, 0.95], [0, 0, 1, 0.3], [0.05, 0.05, 0.95, 0.95]]) {
    const [x0, y0, x1, y1] = isotropicRegion(box, ASPECT, ASPECT);
    near(((x1 - x0) * ASPECT) / (y1 - y0), ASPECT, 1e-9);
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 1 + 1e-12 && y1 <= 1 + 1e-12);
  }
  const same = isotropicRegion([0.2, 0.2, 0.8, 0.8], ASPECT, ASPECT);
  same.forEach((v, i) => near(v, [0.2, 0.2, 0.8, 0.8][i], 1e-9));
});

test('closer hands are scaled back; the centre never moves; no palmRef = no correction', () => {
  const m = new Mapper({ region: [0.25, 0.25, 0.75, 0.75], camAspect: 2, width: 1000, height: 500, palmRef: 0.1 });
  const far = m.map([0.65, 0.5], 0.1);
  const close = m.map([0.65, 0.5], 0.2);
  assert.ok(far.x > close.x && close.x > 500);
  near(m.map([0.5, 0.5], 0.2).x, 500, 1e-6);
  const plain = new Mapper({ region: [0.25, 0.25, 0.75, 0.75], camAspect: 2, width: 1000, height: 500 });
  assert.equal(plain.map([0.65, 0.5], 0.1).x, plain.map([0.65, 0.5], 0.3).x);
});

// ------------------------------------------------------------------ pointing
test('a pointing hand (index out, the rest curled, thumb clear) is recognised, and is not mistaken for peace, fist or pinch', () => {
  const r = run(new GestureDecoder(), { pose: 'point' }, 4);
  assert.equal(r.point, true);
  for (const k of ['pinch', 'grab', 'fist', 'peace']) assert.equal(r[k], false, k);
  for (const pose of ['open', 'fist', 'peace', 'pinch', 'grab']) assert.equal(run(new GestureDecoder(), { pose }, 4).point, false, `${pose} is not pointing`);
});

test('while pointing the cursor is the fingertip itself', () => {
  const lm = hand({ pose: 'point' });
  const r = run(new GestureDecoder(), { pose: 'point' }, 4);
  near(r.cursor.x, lm[8].x, 1e-9); near(r.cursor.y, lm[8].y, 1e-9);
});
