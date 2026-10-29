import test from 'node:test';
import assert from 'node:assert/strict';
import { HandTracker } from '../js/core/tracker.js';
import { GestureDecoder } from '../js/core/gestures.js';
import { dedupeDetections, compatible } from '../js/core/select.js';
import { hand3d, det, ASPECT } from './helpers.mjs';

const FPS = 30;
// run a scripted sequence: frames[i] is the list of detections the camera produced on frame i
function run(tracker, frames, t0 = 0) {
  const outs = [];
  frames.forEach((dets, i) => outs.push(tracker.update(dets, t0 + i / FPS, ASPECT)));
  return outs;
}
const repeat = (n, f) => [...Array(n)].map((_, i) => f(i));
const jump = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// --------------------------------------------------------------- label flipping
test('a hand whose left/right label flips every frame is still one steady hand (the old reset-on-flip bug)', () => {
  const tr = new HandTracker();
  const frames = repeat(90, (i) => [det(i % 2 ? 'Left' : 'Right', [0.5 + 0.001 * i, 0.5], 0.1, { pose: 'pinch', g: 0.05 })]);
  const outs = run(tr, frames);
  assert.ok(outs.slice(3).every((o) => o.main && !o.second), 'always exactly one hand, always the main hand');
  assert.equal(tr.stats.released, 0);
  assert.ok(tr.stats.flipsIgnored > 30);
  assert.ok(outs[60].main.reading.pinch, 'the pinch survives every label flip');
  const cur = outs.slice(10).map((o) => o.main.reading.cur);
  const worst = Math.max(...cur.slice(1).map((c, i) => jump(c, cur[i])));
  assert.ok(worst < 0.01, `cursor never jumps (${worst})`);
});

// ------------------------------------------------------------- duplicate ghosts
test('one real hand reported twice with opposite labels does not become a second hand', () => {
  const tr = new HandTracker();
  const frames = repeat(60, (i) => {
    const a = det('Right', [0.5, 0.5], 0.1, { score: 0.9 });
    const b = det('Left', [0.502, 0.503], 0.1, { score: 0.7 });
    return i % 2 ? [a, b] : [b, a];
  });
  const outs = run(tr, frames);
  assert.ok(outs.slice(3).every((o) => o.main && o.second === null));
  assert.equal(tr.stats.ghosts, 60);
});

test('dedupe keeps the most confident detection, and keeps two genuinely separate hands', () => {
  const a = det('Right', [0.5, 0.5], 0.1, { score: 0.6 }), b = det('Left', [0.503, 0.5], 0.1, { score: 0.95 });
  assert.deepEqual(dedupeDetections([a, b], ASPECT), [1]);
  const l = det('Left', [0.3, 0.5], 0.1), r = det('Right', [0.7, 0.5], 0.1);
  assert.deepEqual(dedupeDetections([l, r], ASPECT), [0, 1]);
  const clap = [det('Left', [0.45, 0.5], 0.1), det('Right', [0.56, 0.5], 0.1)]; // hands close together are still two hands
  assert.equal(dedupeDetections(clap, ASPECT).length, 2);
});

// ------------------------------------------------------------- false hands
test('a false second hand that lasts a frame or two is never accepted, a real one is', () => {
  const tr = new HandTracker();
  const main = (i) => det('Right', [0.65, 0.5], 0.1);
  const frames = [
    ...repeat(10, (i) => [main(i)]),
    ...repeat(2, (i) => [main(i), det('Left', [0.3, 0.5], 0.1)]), // 2-frame blip
    ...repeat(10, (i) => [main(i)]),
  ];
  const outs = run(tr, frames);
  assert.ok(outs.every((o) => o.second === null), 'the blip never shows');
  assert.ok(tr.stats.blips >= 1);
  const real = run(tr, repeat(8, () => [main(0), det('Left', [0.3, 0.5], 0.1)]), 2);
  assert.ok(real[1].second === null && real[7].second, 'a hand that stays is accepted after a moment');
});

test('a new hand needs a few frames before it is believed, even the first one', () => {
  const tr = new HandTracker();
  const outs = run(tr, repeat(6, () => [det('Right', [0.5, 0.5], 0.1)]));
  assert.deepEqual(outs.map((o) => !!o.main), [false, false, true, true, true, true]);
});

test('a bystander\'s small hands next to the user are not taken as the second hand', () => {
  const tr = new HandTracker();
  const frames = repeat(30, () => [det('Right', [0.65, 0.5], 0.1), det('Left', [0.25, 0.5], 0.04)]);
  const outs = run(tr, frames);
  assert.ok(outs.every((o) => o.second === null));
  assert.ok(!compatible(det('Right', [0.65, 0.5], 0.1), det('Left', [0.25, 0.5], 0.04), ASPECT));
  assert.ok(compatible(det('Right', [0.65, 0.5], 0.1), det('Left', [0.25, 0.5], 0.09), ASPECT));
});

test('a second hand with low confidence is ignored', () => {
  const tr = new HandTracker();
  const outs = run(tr, repeat(20, () => [det('Right', [0.65, 0.5], 0.1), det('Left', [0.3, 0.5], 0.1, { score: 0.3 })]));
  assert.ok(outs.every((o) => o.second === null));
  assert.ok(tr.stats.lowScore > 0);
});

// ----------------------------------------------------------------- dropouts
test('a hand missed for a few frames is held (a stroke is not cut), then released after the grace period', () => {
  const tr = new HandTracker();
  const h = () => det('Right', [0.5, 0.5], 0.1, { pose: 'pinch', g: 0.05 });
  const frames = [...repeat(20, () => [h()]), ...repeat(5, () => []), ...repeat(10, () => [h()])];
  const outs = run(tr, frames);
  assert.ok(outs.slice(3).every((o) => o.main), 'never lost during the 5-frame dropout');
  assert.ok(outs[22].main.held && outs[22].main.reading.pinch, 'held, and still pinching');
  assert.ok(!outs[26].main.held, 'back to live readings');
  assert.equal(tr.stats.released, 0);

  const tr2 = new HandTracker();
  const long = run(tr2, [...repeat(20, () => [h()]), ...repeat(14, () => []), ...repeat(2, () => [h()])]);
  assert.equal(long[33].main, null, 'gone after 14 missing frames');
  assert.equal(tr2.stats.released, 1);
});

test('after a dropout the hand is picked up again where it was, without a jump', () => {
  const tr = new HandTracker();
  const at = (i) => [0.5 + 0.002 * i, 0.5];
  const outs = run(tr, [...repeat(15, (i) => [det('Right', at(i), 0.1)]), ...repeat(4, () => []), ...repeat(10, (i) => [det('Right', at(i + 19), 0.1)])]);
  const cur = outs.filter((o) => o.main && !o.main.held).map((o) => o.main.reading.cur);
  assert.ok(Math.max(...cur.slice(1).map((c, i) => jump(c, cur[i]))) < 0.02);
});

// ---------------------------------------------------------------- two hands
test('two hands that cross keep their roles even when the detector briefly mislabels them', () => {
  const tr = new HandTracker({ dominant: 'Left' }); // A (left) draws, B (right) navigates
  const frames = repeat(80, (i) => {
    const t = i / 79;
    const a = [0.3 + 0.4 * t, 0.5], b = [0.7 - 0.4 * t, 0.58]; // A moves right, B moves left: they cross
    const confused = i >= 36 && i < 41; // while they overlap the detector gets the labels wrong for a moment
    return [det(confused ? 'Right' : 'Left', a, 0.1), det(confused ? 'Left' : 'Right', b, 0.1)];
  });
  const outs = run(tr, frames);
  const xs = (role) => outs.slice(8).map((o) => o[role].reading.cur[0]);
  const steps = (v) => Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
  assert.ok(steps(xs('main')) < 0.03 && steps(xs('second')) < 0.03, 'neither hand teleports across the crossing');
  assert.equal(tr.stats.swaps, 0, 'the mislabelled frames do not swap the roles');
  assert.ok(outs[79].main.reading.cur[0] > outs[8].main.reading.cur[0] + 0.2, 'the drawing hand really did travel right');
  assert.ok(tr.stats.flipsIgnored >= 8);
});

test('roles follow the chosen drawing hand, and only swap when nothing is happening', () => {
  const tr = new HandTracker({ dominant: 'Right' });
  const left = (pose = 'open') => det('Left', [0.3, 0.5], 0.1, { pose });
  const right = (pose = 'open') => det('Right', [0.7, 0.5], 0.1, { pose });
  // the left hand is alone at first, so it is the (only) drawing hand
  run(tr, repeat(10, () => [left()]));
  assert.equal(tr.slots.main.label, 'Left');
  // the right hand arrives while the left one is pinching: no swap in the middle of a gesture
  let outs = run(tr, repeat(25, () => [left('pinch'), right()]), 1);
  assert.ok(outs[24].main && tr.slots.main.label === 'Left' && tr.stats.swaps === 0, 'busy: roles are left alone');
  // the gesture ends: now the right (chosen) hand becomes the drawing hand
  outs = run(tr, repeat(12, () => [left(), right()]), 3);
  assert.equal(tr.slots.main.label, 'Right');
  assert.equal(tr.stats.swaps, 1);
  assert.equal(tr.slots.second.label, 'Left');
  run(tr, repeat(30, () => [left(), right()]), 5);
  assert.equal(tr.stats.swaps, 1, 'and it does not swap back and forth');
});

test('with the left hand chosen as the drawing hand the roles go the other way', () => {
  const tr = new HandTracker({ dominant: 'Left' });
  run(tr, repeat(40, () => [det('Right', [0.7, 0.5], 0.1), det('Left', [0.3, 0.5], 0.1)]));
  assert.equal(tr.slots.main.label, 'Left');
  assert.equal(tr.slots.second.label, 'Right');
});

test('when the drawing hand disappears the other hand takes over, and the hand count never exceeds two', () => {
  const tr = new HandTracker();
  const L = () => det('Left', [0.3, 0.5], 0.1), R = () => det('Right', [0.7, 0.5], 0.1);
  run(tr, repeat(20, () => [L(), R()]));
  const outs = run(tr, repeat(20, () => [L()]), 1);
  assert.ok(outs[19].main && !outs[19].second);
  const crowd = run(tr, repeat(20, () => [L(), R(), det('Right', [0.5, 0.2], 0.1), det('Left', [0.5, 0.8], 0.1)]), 3);
  assert.ok(crowd.every((o) => [o.main, o.second].filter(Boolean).length <= 2));
});

// ------------------------------------------------- turning the hand (foreshortening)
test('turning the wrist sideways fakes a pinch in flat image space but not with 3D world landmarks', () => {
  const run1 = (useWorld) => {
    const dec = new GestureDecoder();
    let pinched = 0;
    for (let deg = 0; deg <= 80; deg += 2) {
      const h = hand3d({ pose: 'pinch', g: 0.5, rotY: (deg * Math.PI) / 180 }); // an OPEN hand: thumb-index gap 0.5 palms
      for (let k = 0; k < 3; k++) if (dec.step(h.lm, useWorld ? h.world : null).pinch) pinched++;
    }
    return pinched;
  };
  assert.ok(run1(false) > 20, 'flat image space is fooled');
  assert.equal(run1(true), 0, 'world landmarks are not');
});

test('a real pinch is recognised at any turn angle with world landmarks', () => {
  for (const deg of [0, 30, 60, 80]) {
    const dec = new GestureDecoder();
    const h = hand3d({ pose: 'pinch', g: 0.05, rotY: (deg * Math.PI) / 180 });
    let r;
    for (let k = 0; k < 4; k++) r = dec.step(h.lm, h.world);
    assert.ok(r.pinch && r.world, `${deg} degrees`);
  }
});

// ----------------------------------------------------------- pose flicker
test('a one- or two-frame false fist does not fire; a real fist does', () => {
  const dec = new GestureDecoder();
  const open = hand3d({ pose: 'open' }), fist = hand3d({ pose: 'fist' });
  const feed = (h, n) => { let r; for (let i = 0; i < n; i++) r = dec.step(h.lm, h.world); return r; };
  feed(open, 5);
  assert.ok(!feed(fist, 2).fist, 'two bad frames');
  assert.ok(!feed(open, 1).fist);
  assert.ok(!feed(fist, 2).fist, 'two more, with an open frame between');
  assert.ok(feed(fist, 3).fist, 'a held fist');
  assert.ok(!feed(open, 4).fist);
  const peace = hand3d({ pose: 'peace' });
  assert.ok(!feed(peace, 2).peace && feed(peace, 2).peace);
});

test('smoothing the pinch ratio stops a noisy hand flickering around the threshold', () => {
  const toggles = (smooth) => {
    const dec = new GestureDecoder({ smooth, debounce: 1 }); // debounce off to expose the raw flicker
    let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    let prev = false, n = 0;
    for (let i = 0; i < 300; i++) {
      const h = hand3d({ pose: 'pinch', g: 0.37 + 0.14 * rnd() * 2 }); // hovering between the on (0.30) and off (0.45) thresholds
      const p = dec.step(h.lm, h.world).pinch;
      if (p !== prev) n++;
      prev = p;
    }
    return n;
  };
  assert.ok(toggles(0.4) < toggles(0), `${toggles(0.4)} vs ${toggles(0)}`);
});

// ----------------------------------------------------------------- the whole thing, noisy
test('a realistic glitchy session: flips, ghosts, blips and dropouts together still give one steady pinching hand', () => {
  const tr = new HandTracker();
  let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const frames = repeat(240, (i) => {
    const dets = [];
    const gap = i % 37 === 20 ? 3 : 1; // an occasional dropout of up to 3 frames
    if (i % 37 >= 20 && i % 37 < 20 + gap) return dets;
    const side = rnd() < 0.3 ? 'Left' : 'Right'; // the label flips on ~30% of frames
    const at = [0.55 + 0.04 * Math.sin(i / 20), 0.5];
    dets.push(det(side, at, 0.1, { pose: 'pinch', g: 0.05 }));
    if (rnd() < 0.5) dets.push(det(side === 'Left' ? 'Right' : 'Left', [at[0] + 0.002, at[1] + 0.003], 0.1)); // the same hand reported again
    if (i % 53 === 40) dets.push(det('Left', [0.2, 0.3], 0.1)); // a one-frame false hand
    return dets;
  });
  const outs = run(tr, frames);
  const live = outs.slice(5);
  assert.ok(live.every((o) => o.main), 'always a hand');
  assert.ok(live.every((o) => o.second === null), 'never a ghost or a blip as a second hand');
  assert.ok(live.every((o) => o.main.reading.pinch), 'the pinch never drops');
  assert.equal(tr.stats.released, 0);
  assert.equal(tr.stats.swaps, 0);
});
