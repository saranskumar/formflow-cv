import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, RANGES, rangeParams, normalizeSettings, otherHand } from '../js/core/settings.js';
import { followRoi, fromCrop, fitRoi, easeRoi, cropRect, RoiPlanner, MIN_CROP, FULL } from '../js/core/roi.js';
import { ReachCalibrator, HOLD } from '../js/core/reach.js';
import { CONTROLS, handName } from '../js/core/controls.js';
import { HandTrack } from '../js/core/track.js';
import { GestureDecoder } from '../js/core/gestures.js';
import { selectUserHands } from '../js/core/select.js';
import { Mapper } from '../js/core/mapping.js';
import { TOOL_INFO } from '../js/ui/hud.js';
import { hand, ASPECT } from './helpers.mjs';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

// ------------------------------------------------------------------ settings
test('settings: any garbage becomes safe defaults', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULTS);
  assert.deepEqual(normalizeSettings('x'), DEFAULTS);
  const s = normalizeSettings({ dominant: 'Middle', range: 'huge', sensitivity: 'max', region: [0.9, 0.1, 0.1, 0.8], pinchOn: 'a', smoothing: 99 });
  assert.equal(s.dominant, 'Right'); assert.equal(s.range, 'near'); assert.equal(s.sensitivity, 'normal');
  assert.equal(s.region, null); assert.equal(s.pinchOn, 0.30); assert.equal(s.smoothing, 5);
});

test('settings: valid choices are kept, hands are opposites', () => {
  const s = normalizeSettings({ dominant: 'Left', range: 'far', sensitivity: 'high', region: [0.3, 0.3, 0.6, 0.6] });
  assert.equal(s.dominant, 'Left'); assert.equal(s.range, 'far'); assert.equal(s.sensitivity, 'high');
  assert.deepEqual(s.region, [0.3, 0.3, 0.6, 0.6]);
  assert.equal(otherHand('Left'), 'Right'); assert.equal(otherHand('Right'), 'Left');
  assert.deepEqual(normalizeSettings({ pinchOn: 0.5, pinchOff: 0.4 }).pinchOn, 0.30); // off must exceed on
  assert.equal(normalizeSettings({ region: [0.1, 0.1, 0.12, 0.12] }).region, null); // a degenerate box is rejected
});

test('far ranges accept smaller hands, crop tighter and are more sensitive', () => {
  const p = Object.fromEntries(RANGES.map((r) => [r, rangeParams(r)]));
  assert.ok(p.near.minPalm > p.medium.minPalm && p.medium.minPalm > p.far.minPalm);
  assert.ok(p.near.roi.w > p.medium.roi.w && p.medium.roi.w > p.far.roi.w);
  assert.equal(p.auto.roi, null); // follows the hands
  assert.ok(p.far.detection.detect < p.near.detection.detect);
  assert.ok(rangeParams('near', 'high').detection.detect < rangeParams('near', 'normal').detection.detect);
  assert.deepEqual(rangeParams('nonsense'), rangeParams('near'));
  for (const r of RANGES) { const { roi } = p[r]; if (roi) assert.equal(roi.w, roi.h); } // aspect is preserved
});

// ------------------------------------------------------------------ crop
test('landmarks in a crop map back to the full frame', () => {
  const roi = { x: 0.25, y: 0.30, w: 0.5, h: 0.5 };
  const p = fromCrop({ x: 0.5, y: 0.5, z: 0.1 }, roi);
  near(p.x, 0.5, 1e-12); near(p.y, 0.55, 1e-12); assert.equal(p.z, 0.1);
  const corner = fromCrop({ x: 1, y: 1 }, roi);
  near(corner.x, 0.75, 1e-12); near(corner.y, 0.8, 1e-12);
});

test('a crop never leaves the image and never gets tighter than the minimum', () => {
  for (const [cx, cy, s] of [[0.02, 0.02, 0.4], [0.98, 0.98, 0.4], [0.5, 0.5, 0.05], [0.5, 0.5, 5]]) {
    const r = fitRoi(cx, cy, s);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 + 1e-12 && r.y + r.h <= 1 + 1e-12);
    assert.ok(r.w >= MIN_CROP && r.w <= 1 && r.w === r.h);
  }
});

test('the follow crop zooms in on small hands and widens for big ones', () => {
  const small = followRoi([{ cx: 0.5, cy: 0.5, palm: 0.02 }]);
  const big = followRoi([{ cx: 0.5, cy: 0.5, palm: 0.12 }]);
  assert.ok(small.w < big.w);
  assert.ok(small.w <= 0.4);
  assert.deepEqual(followRoi([]), FULL);
  const two = followRoi([{ cx: 0.2, cy: 0.5, palm: 0.02 }, { cx: 0.8, cy: 0.5, palm: 0.02 }]);
  assert.ok(two.w > small.w); // both hands must stay inside
  assert.ok(two.x <= 0.2 * 1 && two.x + two.w >= 0.8);
});

test('the crop follows a hand to the edge of the image and stays centred on it otherwise', () => {
  const r = followRoi([{ cx: 0.9, cy: 0.2, palm: 0.02 }]);
  assert.ok(0.9 >= r.x && 0.9 <= r.x + r.w && 0.2 >= r.y && 0.2 <= r.y + r.h);
  const c = followRoi([{ cx: 0.5, cy: 0.5, palm: 0.02 }]);
  near(c.x + c.w / 2, 0.5, 1e-9); near(c.y + c.h / 2, 0.5, 1e-9);
});

test('crop easing moves smoothly and converges', () => {
  const a = fitRoi(0.3, 0.3, 0.4), b = fitRoi(0.7, 0.7, 0.4);
  const mid = easeRoi(a, b, 0.35);
  assert.ok(mid.x > a.x && mid.x < b.x);
  let r = a; for (let i = 0; i < 40; i++) r = easeRoi(r, b);
  near(r.x, b.x, 1e-3);
  assert.deepEqual(easeRoi(null, b), b);
});

test('crop rectangle in video pixels, downscaled only when too large', () => {
  const r = cropRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 1920, 1080, 1280);
  assert.deepEqual([r.sx, r.sy, r.sw, r.sh], [480, 270, 960, 540]);
  assert.deepEqual([r.dw, r.dh], [960, 540]); // no upscaling past the source
  const big = cropRect(FULL, 1920, 1080, 1280);
  assert.equal(big.dw, 1280); assert.equal(big.dh, 720);
  assert.ok(Math.abs(big.dw / big.dh - 16 / 9) < 0.01);
});

test('planner: follows the hands, rescans the whole frame now and then, resets when they vanish', () => {
  const p = new RoiPlanner({ scanEvery: 5 });
  const hands = [{ cx: 0.5, cy: 0.5, palm: 0.02 }];
  const rois = [];
  for (let i = 1; i <= 10; i++) rois.push(p.plan(hands, i / 30));
  assert.ok(rois[0].w < 1 && rois[1].w < 1); // following
  assert.deepEqual(rois[4], FULL); // frame 5: a full scan
  assert.ok(rois[5].w < 1);
  const none = p.plan([], 5);
  assert.deepEqual(none, FULL);
  assert.deepEqual(p.roi, FULL); // after losing them it starts over
});

// ------------------------------------------------------------------ reach
const hold = (c, p, secs, t0, fps = 30) => { let t = t0; for (let i = 0; i < Math.round(secs * fps); i++) { c.feed(p, t); t += 1 / fps; } return t; };

test('reach calibration: two held corners give a region mapped to the whole screen', () => {
  const c = new ReachCalibrator();
  let t = hold(c, [0.42, 0.40], HOLD + 0.3, 0);
  assert.equal(c.step, 1);
  t = hold(c, [0.58, 0.55], HOLD + 0.3, t + 1);
  assert.ok(c.done);
  const [x0, y0, x1, y1] = c.region;
  assert.ok(x0 < 0.42 && y0 < 0.40 && x1 > 0.58 && y1 > 0.55);
  assert.ok(x1 - x0 < 0.2); // a small hand, far away, in a small box
  // …yet that small box now reaches every corner of the screen
  const m = new Mapper({ region: c.region, camAspect: ASPECT, width: 1920, height: 1080 });
  const tl = m.map([0.42, 0.40]), br = m.map([0.58, 0.55]);
  assert.ok(tl.x < 200 && tl.y < 150 && br.x > 1700 && br.y > 900);
});

test('reach calibration needs stillness, a visible hand, and a real second corner', () => {
  const c = new ReachCalibrator();
  let t = 0;
  for (let i = 0; i < 90; i++) { c.feed([0.3 + 0.01 * i, 0.4], t); t += 1 / 30; } // moving
  assert.equal(c.step, 0);
  hold(c, null, 2, t);
  assert.equal(c.step, 0 + 0);
  const d = new ReachCalibrator();
  let u = hold(d, [0.40, 0.40], HOLD + 0.3, 0);
  hold(d, [0.41, 0.405], HOLD + 0.3, u + 1); // the same spot again
  assert.equal(d.step, 1);
  assert.match(d.message, /BOTTOM-RIGHT/);
  assert.equal(d.region, null);
});

test('reach calibration works whichever order the corners are shown in', () => {
  const c = new ReachCalibrator();
  let t = hold(c, [0.6, 0.6], HOLD + 0.3, 0);
  hold(c, [0.4, 0.4], HOLD + 0.3, t + 1);
  assert.ok(c.done && c.region[0] < c.region[2] && c.region[1] < c.region[3]);
});

// ---------------------------------------------------------------- controls
test('controls table: every entry resolves to a real hand, tool and key', () => {
  assert.ok(CONTROLS.length >= 12);
  for (const c of CONTROLS) {
    assert.ok(c.action && c.id);
    assert.ok(['draw', 'nav', 'both', null].includes(c.hand), c.id);
    assert.ok(c.gesture || c.key || c.button, `${c.id} has no way to do it`);
  }
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, CONTROLS.length);
});

test('controls table: the hand that does each thing follows the drawing-hand setting', () => {
  assert.equal(handName('draw', 'Right'), 'Right hand');
  assert.equal(handName('nav', 'Right'), 'Left hand');
  assert.equal(handName('draw', 'Left'), 'Left hand');
  assert.equal(handName('nav', 'Left'), 'Right hand');
  assert.equal(handName('both', 'Left'), 'Both hands');
  assert.equal(handName(null, 'Left'), '');
  const draw = CONTROLS.filter((c) => c.hand === 'draw').map((c) => c.id);
  assert.ok(['draw', 'place', 'grab', 'press'].every((id) => draw.includes(id)));
  assert.deepEqual(CONTROLS.filter((c) => c.hand === 'nav').map((c) => c.id).sort(), ['orbit', 'pan']);
});

test('controls table: the tools it mentions exist in the HUD', () => {
  for (const t of ['free', 'line', 'rect', 'circle', 'cube', 'sphere', 'cylinder', 'cone', 'pyramid', 'move', 'scale']) assert.ok(TOOL_INFO[t], t);
});

// ------------------------------------------------- small, distant hands
test('a tiny hand is still recognised, steadily', () => {
  const small = { size: 0.02, at: [0.5, 0.5] };
  const open = new GestureDecoder();
  for (let i = 0; i < 4; i++) open.step(hand({ pose: 'open', ...small }));
  for (const pose of ['pinch', 'grab', 'fist', 'peace']) {
    const d = new GestureDecoder({ debounce: 3 });
    let r;
    for (let i = 0; i < 4; i++) r = d.step(hand({ pose, ...small }));
    assert.ok(r[pose], `${pose} at palm 0.02`);
  }
});

test('small hands get heavier smoothing and a longer debounce; big hands keep the defaults', () => {
  const t = new HandTrack({ smoothing: 1.0 });
  t.step(hand({ size: 0.02 }), 0);
  const smallCut = t.fCursor.minCutoff, smallDeb = t.decoder.debounce;
  t.step(hand({ size: 0.12 }), 0.03);
  assert.ok(smallCut < t.fCursor.minCutoff);
  assert.equal(smallDeb, 3);
  assert.equal(t.decoder.debounce, 2);
  near(t.fCursor.minCutoff, 1.0, 1e-9);
});

test('a small hand jitters less on screen with the adaptive smoothing than without it', () => {
  const run = (adaptive) => {
    const t = new HandTrack({ smoothing: 1.0 });
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004;
    const m = new Mapper({ region: [0.4, 0.4, 0.6, 0.6], camAspect: ASPECT, width: 1920, height: 1080 });
    const ys = [];
    for (let i = 0; i < 90; i++) {
      const lm = hand({ size: 0.02, at: [0.5 + rnd(), 0.5 + rnd()] });
      const r = t.step(lm, i / 30);
      if (!adaptive) { t.fCursor.minCutoff = 1.0; }
      ys.push(m.map(r.cur, r.palm).x);
    }
    const tail = ys.slice(30), mean = tail.reduce((a, b) => a + b) / tail.length;
    return Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
  };
  assert.ok(run(true) <= run(false));
});

test('hand selection accepts small hands when the range allows it, and ignores them when it does not', () => {
  const tiny = [{ side: 'Right', lm: hand({ size: 0.015, at: [0.5, 0.5] }) }];
  assert.deepEqual(selectUserHands(tiny, null, ASPECT, rangeParams('near').minPalm), []);
  assert.deepEqual(selectUserHands(tiny, null, ASPECT, rangeParams('far').minPalm), [0]);
  const pair = [{ side: 'Right', lm: hand({ size: 0.016, at: [0.55, 0.5] }) }, { side: 'Left', lm: hand({ size: 0.015, at: [0.45, 0.5] }) }];
  assert.equal(selectUserHands(pair, null, ASPECT, rangeParams('far').minPalm).length, 2);
  const withBystander = [...pair, { side: 'Right', lm: hand({ size: 0.007, at: [0.8, 0.5] }) }];
  assert.equal(selectUserHands(withBystander, null, ASPECT, rangeParams('far').minPalm).length, 2); // the far-off third hand is too small
});

// ------------------------------------------- the whole crop chain, end to end
const toCrop = (p, roi) => ({ x: (p.x - roi.x) / roi.w, y: (p.y - roi.y) / roi.h, z: p.z }); // what the detector would report

test('a small hand looks several times bigger to the detector and maps back to the exact same place', () => {
  const full = hand({ pose: 'pinch', size: 0.02, at: [0.62, 0.41] });
  const palmFull = new GestureDecoder().palmSize(full);
  const roi = followRoi([{ cx: 0.62, cy: 0.41, palm: palmFull }]);
  assert.ok(roi.w <= 0.4);
  const seenByDetector = full.map((p) => toCrop(p, roi));
  const palmCrop = new GestureDecoder().palmSize(seenByDetector);
  assert.ok(palmCrop / palmFull > 2.4, `magnified ${(palmCrop / palmFull).toFixed(1)}x`);
  const back = seenByDetector.map((p) => fromCrop(p, roi));
  full.forEach((p, i) => { near(back[i].x, p.x, 1e-12); near(back[i].y, p.y, 1e-12); });
  // gestures are measured relative to the palm, so they come out the same in the crop and in the full frame
  const g1 = new GestureDecoder(), g2 = new GestureDecoder();
  let a, b;
  for (let i = 0; i < 3; i++) { a = g1.step(full); b = g2.step(back); }
  assert.deepEqual([a.pinch, a.grab, a.fist, a.peace], [b.pinch, b.grab, b.fist, b.peace]);
  near(a.rI, b.rI, 1e-9);
});

test('the crop keeps a hand that wanders across the whole picture inside it', () => {
  const p = new RoiPlanner({ scanEvery: 1000 });
  let t = 0;
  for (let i = 0; i < 120; i++) {
    const cx = 0.15 + (0.7 * i) / 119, cy = 0.5 + 0.35 * Math.sin(i / 20); // stays inside the picture
    const roi = p.plan([{ cx, cy, palm: 0.02 }], t);
    t += 1 / 30;
    if (i > 5) { // after the crop has had a moment to catch up
      assert.ok(cx >= roi.x - 0.02 && cx <= roi.x + roi.w + 0.02 && cy >= roi.y - 0.02 && cy <= roi.y + roi.h + 0.02, `frame ${i}`);
    }
    assert.ok(roi.x >= 0 && roi.y >= 0 && roi.x + roi.w <= 1 + 1e-9 && roi.y + roi.h <= 1 + 1e-9);
  }
});

test('with the far preset a small hand drives the whole screen, equally on both axes', () => {
  const far = rangeParams('far');
  const m = new Mapper({ region: far.region, camAspect: ASPECT, width: 1920, height: 1080 });
  const [x0, y0, x1, y1] = m.iso;
  near(((x1 - x0) * ASPECT) / (y1 - y0), 1920 / 1080, 1e-9);
  const a = m.map([0.5, 0.5]), b = m.map([0.5 + 0.02 / ASPECT, 0.5]), c = m.map([0.5, 0.52]);
  near((b.x - a.x) / (c.y - a.y), 1, 0.01); // the same physical movement gives the same screen distance either way
  assert.ok(b.x - a.x > 50); // a movement of 2% of the picture height is a clearly visible cursor movement
});
