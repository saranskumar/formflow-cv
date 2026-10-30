import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, NOT_INSTALLED, summarize, describe, advice, extract, holisticAsHands } from '../js/core/benchmark.js';

test('a summary has the mean, the 95th percentile, the worst run, the rate it allows and the share that found something', () => {
  const r = summarize([10, 10, 10, 10, 10, 10, 10, 10, 10, 50], 6);
  assert.equal(r.runs, 10);
  assert.equal(r.mean, 14);
  assert.equal(r.p50, 10);
  assert.equal(r.p95, 50);
  assert.equal(r.max, 50);
  assert.ok(Math.abs(r.fps - 1000 / 14) < 1e-9);
  assert.equal(r.hitRate, 0.6);
  assert.deepEqual(summarize([]), { runs: 0, mean: 0, p50: 0, p95: 0, max: 0, fps: 0, hitRate: 0 });
});

test('a result is described in one plain line', () => {
  assert.equal(describe(summarize([8, 8, 9, 12], 4)), '9.3 ms per picture (95% under 12.0) · up to 108 fps · hand found in 100%');
  assert.match(describe(summarize([5, 5], 0), 'pose'), /person found in 0%/);
  assert.equal(describe(summarize([])), 'no pictures were tested');
});

test('advice compares a model on the two delegates and says nothing when they are close', () => {
  const fast = summarize([5, 5, 5], 3), slow = summarize([12, 12, 12], 3), same = summarize([5.5, 5.5, 5.5], 3);
  const gpu = advice({ 'hand-gpu': fast, 'hand-cpu': slow });
  assert.equal(gpu[0].best, 'GPU');
  assert.match(gpu[0].text, /2\.4× faster on the graphics card/);
  const cpu = advice({ 'hand-gpu': slow, 'hand-cpu': fast });
  assert.equal(cpu[0].best, 'CPU');
  assert.match(cpu[0].text, /Use the CPU setting/);
  assert.equal(advice({ 'hand-gpu': fast, 'hand-cpu': same })[0].best, null);
  assert.deepEqual(advice({ 'hand-gpu': fast }), [], 'one delegate tested: nothing to compare');
});

test('no hand in view is called out, so a slow-looking result is not blamed on the model', () => {
  const a = advice({ 'hand-gpu': summarize([5, 5, 5], 0), 'hand-cpu': summarize([6, 6, 6], 0) });
  assert.ok(a.some((x) => /Hold your open hand/.test(x.text)));
});

test('every model is an official MediaPipe file, either shipped with the app or fetched from Google on test', () => {
  assert.deepEqual(MODELS.map((m) => m.id), ['hand-gpu', 'hand-cpu', 'hand-640', 'gesture-gpu', 'holistic-gpu']);
  for (const m of MODELS) {
    assert.ok(['hand', 'gesture', 'holistic', 'pose'].includes(m.api) && ['GPU', 'CPU'].includes(m.delegate), m.id);
    assert.ok(m.file ? /\.task$/.test(m.file) : m.url.startsWith('https://storage.googleapis.com/mediapipe-models/') && m.url.endsWith('.task'), m.id);
  }
  assert.ok(NOT_INSTALLED.length >= 2 && NOT_INSTALLED.every((m) => m.title && m.how));
});

test('a smaller camera picture is recommended only when it is clearly faster and still finds the hand', () => {
  const full = summarize([50, 50, 50], 3), small = summarize([30, 30, 30], 3), blind = summarize([30, 30, 30], 0), same = summarize([48, 48, 48], 3);
  assert.equal(advice({ 'hand-gpu': full, 'hand-640': small }).find((a) => a.best === '640').kind, 'hand');
  assert.equal(advice({ 'hand-gpu': full, 'hand-640': blind }).some((a) => a.best === '640'), false, 'faster but blind is not better');
  assert.equal(advice({ 'hand-gpu': full, 'hand-640': same }).some((a) => a.best === '640'), false);
});

test('the result of each task is read into the same shape, and a gesture name comes through', () => {
  const pt = (x) => ({ x, y: 0.5 });
  assert.deepEqual(extract('hand', { landmarks: [[pt(0.1)]] }).hands, [[pt(0.1)]]);
  const g = extract('gesture', { landmarks: [[pt(0.2)]], gestures: [[{ categoryName: 'Pointing_Up' }]] });
  assert.equal(g.label, 'Pointing_Up');
  assert.equal(extract('gesture', { landmarks: [[pt(0.2)]], gestures: [[{ categoryName: 'None' }]] }).label, '');
  assert.deepEqual(extract('pose', { landmarks: [[pt(0.3), pt(0.4)]] }).pose.length, 2);
  const h = extract('holistic', { leftHandLandmarks: [[pt(0.1)]], rightHandLandmarks: [], poseLandmarks: [[pt(0.5)]] });
  assert.equal(h.hands.length, 1);
  assert.equal(h.pose.length, 1);
  assert.deepEqual(extract('hand', null), { hands: [], pose: [], label: '' });
});

test('a Holistic result can stand in for a Hand Landmarker result, with the sides as the tracker expects them', () => {
  const pt = (x) => ({ x, y: 0.5 });
  const r = holisticAsHands({ leftHandLandmarks: [[pt(0.7)]], rightHandLandmarks: [[pt(0.3)]], poseLandmarks: [[pt(0.5)]] });
  assert.equal(r.landmarks.length, 2);
  assert.deepEqual(r.handedness.map((h) => h[0].categoryName), ['Right', 'Left']);
  assert.deepEqual(r.worldLandmarks, []);
  assert.deepEqual(holisticAsHands({ leftHandLandmarks: [], rightHandLandmarks: [[pt(0.3)]] }).landmarks.length, 1);
  assert.deepEqual(holisticAsHands(null), { landmarks: [], handedness: [], worldLandmarks: [] });
});
