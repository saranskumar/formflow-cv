import test from 'node:test';
import assert from 'node:assert/strict';
import { Follower, LandmarkFollower, follow, DEFAULTS } from '../js/core/smooth.js';

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

test('at rest the shake of the detector is calmed, at least by half', () => {
  const f = new Follower(), rnd = rng(5), raw = [], out = [];
  // 60 screen frames a second; the detector brings a new, noisy position (0.5 +- 0.004) every third frame (20 a second)
  let target = [0.5, 0.5];
  for (let i = 0; i < 360; i++) {
    const t = i / 60;
    if (i % 3 === 0) target = [0.5 + rnd() * 0.008, 0.5 + rnd() * 0.008];
    const p = f.follow(target, t);
    if (i > 60) { raw.push(target[0]); out.push(p[0]); }
  }
  assert.ok(std(out) < std(raw) * 0.5, `std ${std(out).toFixed(5)} vs ${std(raw).toFixed(5)}`);
});

test('a moving hand is followed closely: the lag stays small and it does not overshoot', () => {
  const f = new Follower();
  let worst = 0, overshoot = 0, target = [0, 0.5];
  for (let i = 0; i < 180; i++) {
    const t = i / 60;
    if (i % 3 === 0) target = [t * 0.5, 0.5];            // 0.5 image widths a second, in 20 steps a second
    const p = f.follow(target, t);
    if (i > 30) worst = Math.max(worst, Math.abs(target[0] - p[0]));
    overshoot = Math.max(overshoot, p[0] - target[0]);
  }
  assert.ok(worst < 0.05, `worst lag ${worst.toFixed(3)} of the image width`);
  assert.ok(overshoot <= 1e-9, 'it never runs ahead of the hand');
});

test('between detector updates the position glides instead of standing still', () => {
  const f = new Follower();
  f.follow([0, 0], 0);
  f.follow([0.2, 0], 0.016);
  const steps = [0.033, 0.05, 0.066].map((t) => f.follow([0.2, 0], t)[0]);
  assert.ok(steps[0] > 0 && steps[0] < steps[1] && steps[1] < steps[2] && steps[2] < 0.2, `${steps}`);
});

test('the first position, a long gap (the hand left) and strength 0 all snap to the target', () => {
  const f = new Follower();
  assert.deepEqual(f.follow([0.3, 0.4], 0), [0.3, 0.4]);
  f.follow([0.3, 0.4], 0.016);
  assert.deepEqual(f.follow([0.9, 0.1], 5), [0.9, 0.1]);
  assert.deepEqual(f.follow([0.2, 0.2], 5.016, 0), [0.2, 0.2]);
  assert.equal(follow(0.5, 0.016, DEFAULTS, 0), 1);
});

test('a bigger distance follows faster, and a higher strength smooths more', () => {
  const near = follow(0.001, 0.016, DEFAULTS), far = follow(0.05, 0.016, DEFAULTS);
  assert.ok(far > near * 3, `${far} vs ${near}`);
  assert.ok(follow(0.001, 0.016, DEFAULTS, 2) < near);
});

test('each of the 21 points is followed on its own, keeping its other fields', () => {
  const lm = new LandmarkFollower();
  const hand = (x) => [...Array(21)].map((_, i) => ({ x: x + i * 0.01, y: 0.5, z: -0.1 }));
  lm.follow(hand(0.2), 0);
  const out = lm.follow(hand(0.25), 0.016);
  assert.equal(out.length, 21);
  assert.equal(out[3].z, -0.1);
  assert.ok(out[0].x > 0.2 && out[0].x < 0.25);
  lm.reset();
  assert.equal(lm.follow(hand(0.8), 1)[0].x, 0.8);
});
