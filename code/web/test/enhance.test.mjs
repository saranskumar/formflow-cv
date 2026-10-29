import test from 'node:test';
import assert from 'node:assert/strict';
import { regionStats, chooseCorrection, filterCss, handBox, AutoExposure, TARGET, MAX_GAIN, SEARCH_AFTER } from '../js/core/enhance.js';
import { HandTracker } from '../js/core/tracker.js';
import { det, ASPECT } from './helpers.mjs';

/** A grey picture (0..255) with an optional rectangle of another grey, as RGBA. */
function picture(w, h, bg, rect = null, fg = 0) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = rect && x >= rect[0] * w && x < rect[2] * w && y >= rect[1] * h && y < rect[3] * h;
    const v = inside ? fg : bg, i = (y * w + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, w, h };
}

test('region brightness reads the box, not the whole picture', () => {
  // backlight: a bright window everywhere, a dark hand in the middle
  const px = picture(96, 54, 240, [0.4, 0.4, 0.6, 0.8], 40);
  const hand = regionStats(px, [0.4, 0.4, 0.6, 0.8]);
  assert.ok(hand.median < 0.2, `hand is dark (${hand.median})`);
  assert.ok(hand.global > 0.8, 'the picture overall is bright');
  assert.equal(regionStats(px, [0.5, 0.5, 0.5, 0.5]).median, hand.median); // a degenerate box still reads a pixel
});

test('a dark hand is brightened to mid-grey, a normal one is left alone', () => {
  const dark = chooseCorrection({ median: 0.15, p90: 0.3 });
  assert.ok(dark.gain > 2.5 && dark.gain <= MAX_GAIN && dark.contrast > 1);
  near(Math.min(0.15 * dark.gain, 1), TARGET, 0.01);
  assert.deepEqual(chooseCorrection({ median: 0.5, p90: 0.8 }), { gain: 1, contrast: 1 });
  assert.equal(chooseCorrection({ median: 0.01, p90: 0.02 }).gain, MAX_GAIN); // never more than the maximum
  const glare = chooseCorrection({ median: 0.85, p90: 1 });
  assert.ok(glare.gain < 1 && glare.contrast > 1, 'a washed-out hand is darkened');
  assert.equal(filterCss({ gain: 1, contrast: 1 }), 'none');
  assert.equal(filterCss({ gain: 2, contrast: 1.2 }), 'brightness(2.00) contrast(1.20)');
});

test('the hand box follows the hands and stays inside the picture', () => {
  const box = handBox([{ lm: [{ x: 0.02, y: 0.5 }, { x: 0.2, y: 0.7 }], palm: 0.05 }]);
  assert.equal(box[0], 0);
  assert.ok(box[1] < 0.5 && box[2] > 0.2 && box[3] > 0.7 && box[3] <= 1);
  assert.equal(handBox([]), null);
});

test('auto exposure eases toward the correction instead of jumping', () => {
  const ae = new AutoExposure();
  ae.measure({ median: 0.15, p90: 0.3 });
  const first = ae.next(true, 0).gain;
  assert.ok(first > 1 && first < 2, `eased (${first})`);
  for (let i = 0; i < 20; i++) ae.measure({ median: 0.15, p90: 0.3 });
  assert.ok(ae.next(true, 1).gain > 2.8, 'settles on the full correction');
  ae.enabled = false;
  assert.equal(filterCss(ae.next(true, 2)), 'none');
});

test('with no hand for a while it searches with different brightness levels, then keeps the one that worked', () => {
  const ae = new AutoExposure();
  const t0 = 10;
  assert.equal(ae.next(true, t0).variant, 'measured');
  assert.equal(ae.next(false, t0 + SEARCH_AFTER / 2).variant, 'measured', 'a short dropout is not a search');
  const seen = new Set();
  for (let i = 1; i <= 6; i++) seen.add(ae.next(false, t0 + SEARCH_AFTER + i / 30).variant);
  assert.deepEqual([...seen].sort(), ['measured', 'raw', 'strong']);
  assert.ok(ae.searching);
  let strong;
  do { strong = ae.next(false, t0 + 2); } while (strong.variant !== 'strong');
  assert.ok(strong.gain >= 2.2);
  ae.adopt(strong); // that frame found the hand
  const after = ae.next(true, t0 + 2.05);
  assert.equal(after.variant, 'measured');
  assert.equal(after.gain, strong.gain);
  assert.ok(!ae.searching);
});

// ------------------------------------------------------------------ flickering detections (blur, bad light)
const FPS = 30;
test('a real hand that the detector only finds in most frames is still accepted quickly', () => {
  const tr = new HandTracker();
  // detected, missed, detected, detected, missed, detected...: typical for a blurred hand
  const pattern = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
  let firstAt = -1;
  pattern.forEach((on, i) => {
    const out = tr.update(on ? [det('Right', [0.5, 0.5], 0.1)] : [], i / FPS, ASPECT);
    if (out.main && firstAt < 0) firstAt = i;
  });
  assert.ok(firstAt >= 0 && firstAt <= 4, `accepted at frame ${firstAt}`);
});

test('a false hand that flashes up now and then, far apart in time, is still never accepted', () => {
  const tr = new HandTracker();
  for (let i = 0; i < 90; i++) {
    const out = tr.update(i % 15 === 0 ? [det('Right', [0.5, 0.5], 0.1)] : [], i / FPS, ASPECT);
    assert.equal(out.main, null);
  }
  assert.ok(tr.stats.blips >= 5);
});

function near(a, b, tol) { assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`); }

test('while searching, the darker part of the picture is metered (a user in front of a bright window)', () => {
  const px = picture(96, 54, 245, [0.35, 0.3, 0.65, 1], 45); // the user covers ~40% of the search area
  const stats = regionStats(px, [0.15, 0.15, 0.85, 0.95]);
  assert.ok(stats.median > 0.8, 'the window dominates the middle value');
  const onHand = new AutoExposure({ ease: 1 }), search = new AutoExposure({ ease: 1 });
  onHand.measure(stats, true); search.measure(stats, false);
  assert.equal(onHand.next(true, 0).gain <= 1, true);
  assert.ok(search.next(true, 0).gain > 2, 'the user is brightened');
});
