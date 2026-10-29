import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, ConditionMonitor, laplacianVariance, SharpnessTracker, HINTS, PRIORITY } from '../js/core/conditions.js';
import { baselinePlan, nextCompensation, openCamera, CameraAssist, COMP_EVERY, VIDEO_REQUESTS } from '../js/core/camera.js';
import { SessionLog, MAX_SAMPLES } from '../js/core/sessionlog.js';
import { regionStats } from '../js/core/enhance.js';

// ------------------------------------------------------------------ what is wrong with the picture
test('light behind the user is told apart from a dark room', () => {
  assert.deepEqual(classify({ mean: 0.6, clip: 0.2, subject: 0.15 }), ['backlight']);
  assert.deepEqual(classify({ mean: 0.1, clip: 0, subject: 0.08 }), ['lowLight']);
  assert.deepEqual(classify({ mean: 0.45, clip: 0.01, subject: 0.4 }), [], 'an ordinary room is fine');
  assert.ok(!classify({ mean: 0.1, clip: 0.3, subject: 0.02 }).includes('lowLight'), 'a blown-out window explains the dark hand, not the room');
});

test('slow camera, blur, washed-out hand and a small hand each have their own condition', () => {
  assert.deepEqual(classify({ fps: 12 }), ['lowFps']);
  assert.deepEqual(classify({ fps: 30 }), []);
  assert.deepEqual(classify({ sharp: 0.2 }), ['blur']);
  assert.deepEqual(classify({ subject: 0.9, clip: 0.3, mean: 0.9 }), ['overexposed']);
  assert.deepEqual(classify({ palm: 0.02 }), ['far']);
  assert.deepEqual(classify({}), [], 'missing measurements say nothing');
  for (const c of PRIORITY) assert.ok(HINTS[c] && HINTS[c][0] && HINTS[c][1], `${c} has a hint`);
});

test('a condition shows only after it has lasted, and goes only after it has really gone', () => {
  const m = new ConditionMonitor({ holdOn: 2, holdOff: 3 });
  const dark = { mean: 0.1 }, fine = { mean: 0.5 };
  assert.deepEqual(m.feed(dark, 0), { on: [], off: [] });
  assert.deepEqual(m.feed(dark, 1.9), { on: [], off: [] }, 'not yet');
  assert.deepEqual(m.feed(dark, 2.1).on, ['lowLight']);
  assert.equal(m.primary, 'lowLight');
  m.feed(fine, 3); m.feed(dark, 3.5); // a flicker back to fine does not clear it, and the dark frame resets the clearing timer
  assert.deepEqual(m.feed(fine, 4).off, []);
  assert.deepEqual(m.feed(fine, 7.1).off, ['lowLight']);
  assert.equal(m.primary, null);
  assert.deepEqual(m.events.map((e) => [e.condition, e.on]), [['lowLight', true], ['lowLight', false]]);
});

test('the most important condition is the one reported', () => {
  const m = new ConditionMonitor({ holdOn: 0, holdOff: 0 });
  m.feed({ fps: 10, mean: 0.5, clip: 0.3, subject: 0.1 }, 1);
  m.feed({ fps: 10, mean: 0.5, clip: 0.3, subject: 0.1 }, 2);
  assert.deepEqual([...m.active].sort(), ['backlight', 'lowFps']);
  assert.equal(m.primary, 'backlight');
});

// ------------------------------------------------------------------ measuring sharpness
const picture = (w, h, f) => { const data = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = f(x, y); data[i + 3] = 255; } return { data, w, h }; };
const checker = (x, y) => (((x >> 2) + (y >> 2)) & 1 ? 230 : 25);
const blurred = (x, y) => { let s = 0, n = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { s += checker(x + dx, y + dy); n++; } return s / n; }; // box blur of the same pattern

test('a blurred picture has a far smaller Laplacian variance than the sharp one', () => {
  const sharp = laplacianVariance(picture(64, 64, checker)), soft = laplacianVariance(picture(64, 64, blurred));
  assert.ok(sharp > 50 * soft, `sharp ${sharp.toFixed(0)} vs blurred ${soft.toFixed(1)}`);
  assert.equal(laplacianVariance(picture(64, 64, () => 100)), 0, 'a flat picture has no edges');
  assert.equal(laplacianVariance(picture(4, 4, checker), [0, 0, 0.5, 0.5]), null, 'a tiny box cannot be judged');
});

test('sharpness is judged against this camera\'s own best, and the reference fades with time', () => {
  const s = new SharpnessTracker(0.9);
  assert.equal(s.ratio(100), 1);
  near(s.ratio(30), 0.3);
  assert.equal(s.ratio(0), null);
  for (let i = 0; i < 60; i++) s.ratio(30);
  near(s.ratio(30), 1, 0.2); // a permanently softer scene becomes the new normal
});
function near(a, b, tol = 0.05) { assert.ok(Math.abs(a - b) <= tol, `${a} not near ${b}`); }

test('regionStats reports how much of the picture is pure white', () => {
  const px = picture(20, 10, (x) => (x < 5 ? 255 : 60));
  near(regionStats(px).clip, 0.25, 0.01);
});

// ------------------------------------------------------------------ camera controls
const fakeTrack = (caps, { refuse = [] } = {}) => ({
  label: 'Test cam', applied: [],
  getCapabilities: () => caps,
  getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
  async applyConstraints(c) {
    const [k] = Object.keys(c.advanced[0]);
    if (refuse.includes(k)) throw new Error('OverconstrainedError');
    this.applied.push(c.advanced[0]);
  },
});

test('only controls the camera lists are used, each on its own', async () => {
  assert.deepEqual(baselinePlan({}), [], 'nothing offered, nothing asked');
  assert.deepEqual(baselinePlan({ exposureMode: ['manual', 'continuous'], focusMode: ['manual'], backgroundBlur: [false, true] }), [{ exposureMode: 'continuous' }, { backgroundBlur: false }]);
  const t = fakeTrack({ exposureMode: ['continuous'], whiteBalanceMode: ['continuous'], focusMode: ['continuous'] }, { refuse: ['focusMode'] });
  const a = await new CameraAssist(t).start();
  assert.deepEqual(t.applied.map((c) => Object.keys(c)[0]), ['exposureMode', 'whiteBalanceMode'], 'a refused control does not stop the others');
  assert.deepEqual(a.rejected, ['focusMode']);
  assert.equal((await new CameraAssist(null).start()).track, null, 'no track, no crash');
});

test('exposure compensation steps up for backlight or darkness, down for glare, and stays inside the camera\'s range', () => {
  const cap = { min: -2, max: 2, step: 0.5 };
  assert.equal(nextCompensation(cap, 0, 'backlight'), 0.5);
  assert.equal(nextCompensation(cap, 1.5, 'lowLight'), 2);
  assert.equal(nextCompensation(cap, 2, 'backlight'), null, 'already at the limit');
  assert.equal(nextCompensation(cap, 1, 'overexposed'), 0.5);
  assert.equal(nextCompensation(cap, 1, 'blur'), null, 'blur is not an exposure problem we can fix here');
  assert.equal(nextCompensation(cap, 1, null), null, 'no problem: leave it (going back would make it oscillate)');
  assert.equal(nextCompensation({ min: -1, max: 1, step: 0.25 }, 1, 'backlight'), null, 'a camera that stops at +1 stops there');
  assert.equal(nextCompensation({ min: -10, max: 10, step: 1 }, 1, 'backlight'), 2, 'never above +2 EV');
  assert.equal(nextCompensation(undefined, 0, 'backlight'), null, 'camera has no such control');
});

test('the assistant waits between adjustments and reports what it did', async () => {
  const t = fakeTrack({ exposureCompensation: { min: -2, max: 2, step: 0.5 }, exposureMode: ['continuous'] });
  const a = await new CameraAssist(t).start();
  assert.equal(await a.adapt('backlight', 10), 0.5);
  assert.equal(await a.adapt('backlight', 10 + COMP_EVERY - 1), null, 'too soon');
  assert.equal(await a.adapt('backlight', 10 + COMP_EVERY), 1);
  const s = a.status();
  assert.equal(s.comp, 1); assert.equal(s.frameRate, 30); assert.ok(s.controls.includes('exposureCompensation'));
  const refused = await new CameraAssist(fakeTrack({ exposureCompensation: { min: -2, max: 2, step: 0.5 } }, { refuse: ['exposureCompensation'] })).start();
  assert.equal(await refused.adapt('backlight', 0), null);
  assert.equal(refused.comp, 0, 'a refused change is not remembered as applied');
});

test('the camera is opened with the strictest request it accepts, then relaxed; a denied permission is not retried', async () => {
  const tried = [];
  const md = (failFirst) => ({ async getUserMedia(c) { tried.push(c.video); if (tried.length <= failFirst) throw Object.assign(new Error('x'), { name: 'OverconstrainedError' }); return { id: 's' }; } });
  const r = await openCamera(md(1));
  assert.equal(r.request, 1);
  assert.equal(tried[0].frameRate.min, 24); assert.equal(tried[1].frameRate.min, 15);
  tried.length = 0;
  await assert.rejects(openCamera({ async getUserMedia(c) { tried.push(c); throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); } }), { name: 'NotAllowedError' });
  assert.equal(tried.length, 1, 'asked once');
  assert.ok(VIDEO_REQUESTS.length >= 3);
});

// ------------------------------------------------------------------ the log
test('the session log turns frames into one sample a second and measures how well the hand was held', () => {
  const log = new SessionLog(() => 0);
  // 3 s at 30 fps: hand present for the first 2 s, gone for the last 1 s
  for (let i = 0; i <= 90; i++) log.frame(i / 30, i < 60);
  assert.equal(log.samples.length, 3);
  assert.equal(log.samples[0].frames + log.samples[1].frames + log.samples[2].frames, 91); // frames 0..90 inclusive
  const s = log.summary();
  near(s.trackedFraction, 2 / 3, 0.03);
  near(s.longestGapSeconds, 1, 0.1);
  near(s.meanFps, 30, 1);
  assert.ok(log.rate(3) > 0.6 && log.rate(3) < 0.7);
  assert.equal(new SessionLog().rate(), null, 'no data, no rate');
});

test('measurements, conditions and meta end up in the saved file, which is valid JSON', () => {
  const log = new SessionLog(() => 0);
  log.setMeta({ delegate: 'GPU' });
  log.note({ mean: 0.2, conditions: ['lowLight'] });
  for (let i = 0; i <= 31; i++) log.frame(i / 30, true);
  log.event(1.5, 'lowLight', true);
  const back = JSON.parse(JSON.stringify(log));
  assert.equal(back.version, 1);
  assert.equal(back.meta.delegate, 'GPU');
  assert.deepEqual(back.samples[0].conditions, ['lowLight']);
  assert.deepEqual(back.summary.conditionSeconds, { lowLight: 1 });
  assert.deepEqual(back.events, [{ t: 1.5, name: 'lowLight', on: true }]);
});

test('the log stays bounded', () => {
  const log = new SessionLog(() => 0);
  for (let i = 0; i < (MAX_SAMPLES + 50) * 2; i++) log.frame(i * 0.5, true);
  assert.equal(log.samples.length, MAX_SAMPLES);
});
