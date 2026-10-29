import test from 'node:test';
import assert from 'node:assert/strict';
import { Forearm } from '../js/core/forearm.js';
import { HandTracker } from '../js/core/tracker.js';
import { HandTrack } from '../js/core/track.js';
import { hand, det, ASPECT } from './helpers.mjs';

const FPS = 30;
const pose = (lw, rw) => ({ landmarks: [Array.from({ length: 33 }, (_, i) => (
  i === 15 && lw ? { x: lw[0], y: lw[1], visibility: 0.9 } : i === 16 && rw ? { x: rw[0], y: rw[1], visibility: 0.9 } : i === 13 && lw ? { x: lw[0], y: lw[1] + 0.2, visibility: 0.9 }
    : i === 14 && rw ? { x: rw[0], y: rw[1] + 0.2, visibility: 0.9 } : { x: 0.5, y: 0.5, visibility: 0 }))] });

test('pose wrists are read in the mirrored hand space and expire', () => {
  const f = new Forearm();
  f.update(pose([0.3, 0.6], null), 1);
  const a = f.fresh(1.2);
  assert.equal(a.length, 1);
  assert.ok(Math.abs(a[0].wrist.x - 0.7) < 1e-9 && a[0].wrist.y === 0.6);
  assert.ok(a[0].elbow && Math.abs(a[0].elbow.y - 0.8) < 1e-9);
  assert.equal(f.fresh(2).length, 0); // older than maxAge
  const h = f.hints(1.2)[0]; // back in the camera's own image
  assert.ok(Math.abs(h.cx - 0.3) < 1e-9 && h.cy === 0.6 && h.palm === 0.05);
});

test('a wrist that is not visible is ignored', () => {
  const f = new Forearm();
  f.update({ landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }))] }, 1);
  assert.equal(f.fresh(1).length, 0);
});

function dropout(withArm) {
  const tr = new HandTracker();
  const f = new Forearm();
  if (withArm) tr.setOptions({ forearm: f });
  let t = 0, mainFrames = 0;
  const at = [0.6, 0.5];
  for (let i = 0; i < 20; i++, t += 1 / FPS) tr.update([det('Right', at, 0.08, { pose: 'open' })], t, ASPECT);
  // the detector loses the hand for 0.6 s while the pose model still sees the wrist (mirrored x = 1 - 0.6 on the raw image)
  for (let i = 0; i < 18; i++, t += 1 / FPS) {
    f.update(pose(null, [1 - at[0], at[1]]), t);
    // note: hand wrist sits at the hand's wrist landmark (palm-unit origin) = `at`
    const out = tr.update([], t, ASPECT);
    if (out.main) mainFrames++;
  }
  return { mainFrames, tr, t };
}

test('a hand missed for 0.6 s is kept while its wrist is still seen, but dropped without that', () => {
  const without = dropout(false), withArm = dropout(true);
  assert.ok(withArm.mainFrames > without.mainFrames + 3, `${withArm.mainFrames} vs ${without.mainFrames}`);
  assert.equal(withArm.mainFrames, 18);
  assert.ok(withArm.tr.stats.armBridged >= 15);
});

test('the hand is found again where the arm went', () => {
  const tr = new HandTracker();
  const f = new Forearm();
  tr.setOptions({ forearm: f });
  let t = 0;
  for (let i = 0; i < 20; i++, t += 1 / FPS) tr.update([det('Right', [0.6, 0.5], 0.08)], t, ASPECT);
  // the hand is missed while the arm sweeps far to the left
  for (let i = 0; i < 12; i++, t += 1 / FPS) {
    f.update(pose(null, [1 - (0.6 - 0.02 * (i + 1)), 0.5]), t);
    tr.update([], t, ASPECT);
  }
  const out = tr.update([det('Right', [0.36, 0.5], 0.08)], t, ASPECT); // 0.24 away: beyond the plain match radius
  assert.ok(out.main && !out.main.held, 'same hand, re-acquired');
  assert.equal(tr.stats.promoted, 1, 'no second hand was created');
});

test('a new hand on a known wrist is accepted a frame sooner', () => {
  const run = (arm) => {
    const tr = new HandTracker();
    const f = new Forearm();
    if (arm) tr.setOptions({ forearm: f });
    let first = -1;
    for (let i = 0; i < 6; i++) {
      if (arm) f.update(pose(null, [0.4, 0.5]), i / FPS);
      const o = tr.update([det('Right', [0.6, 0.5], 0.08)], i / FPS, ASPECT);
      if (o.main && first < 0) first = i;
    }
    return first;
  };
  assert.ok(run(true) < run(false));
});

test('the cursor rides on the steady wrist/palm: fingertip jitter barely moves it', () => {
  const run = (anchor) => {
    const tk = new HandTrack();
    tk.apply({ anchor });
    const xs = [];
    for (let i = 0; i < 90; i++) {
      const lm = hand({ pose: 'pinch', at: [0.5, 0.5], size: 0.1 });
      const j = (i % 2 ? 1 : -1) * 0.004; // the two pinching fingertips jitter, the palm does not
      lm[8] = { ...lm[8], x: lm[8].x + j, y: lm[8].y + j };
      lm[4] = { ...lm[4], x: lm[4].x - j, y: lm[4].y + j };
      xs.push(tk.step(lm, i / FPS).cur);
    }
    const tail = xs.slice(30);
    return Math.max(...tail.map((p) => p[0])) - Math.min(...tail.map((p) => p[0])) + Math.max(...tail.map((p) => p[1])) - Math.min(...tail.map((p) => p[1]));
  };
  assert.ok(run(true) < run(false), `${run(true)} vs ${run(false)}`);
});
