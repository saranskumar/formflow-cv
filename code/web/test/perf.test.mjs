import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameProfiler, QualityGovernor, settings, MAX_LEVEL, SLOW_MS, DOWN_AFTER, UP_AFTER } from '../js/core/perf.js';

test('the profiler averages stages per run and frames per frame, and remembers the worst one for a while', () => {
  const p = new FrameProfiler({ alpha: 0.5, window: 2 });
  p.stage('detect', 20); p.stage('detect', 10);
  assert.equal(p.avg.detect, 15, 'the first value starts the average, then it eases');
  p.frame(16, 0); p.frame(50, 0.1); p.frame(16, 0.2);
  assert.equal(p.worst, 50);
  assert.equal(p.over, 1, 'one frame over 33 ms');
  p.frame(16, 3); // the 50 ms hitch is older than the window
  assert.equal(p.worst, 16);
  assert.ok(p.fps > 30 && p.fps < 70);
});

test('the heaviest stage is named, and the work total is not a candidate', () => {
  const p = new FrameProfiler();
  p.stage('detect', 22); p.stage('pose', 12); p.stage('draw', 3); p.stage('work', 40);
  assert.equal(p.heaviest, 'detect');
  assert.equal(new FrameProfiler().heaviest, null);
});

test('slow frames are blamed on the page when its JavaScript fills them, and on the graphics card when it does not', () => {
  const busy = new FrameProfiler(), gpu = new FrameProfiler();
  for (let i = 0; i < 60; i++) { busy.frame(40, i / 25); gpu.frame(40, i / 25); }
  busy.stage('work', 36); gpu.stage('work', 6);
  assert.equal(busy.bound, 'js');
  assert.equal(gpu.bound, 'gpu');
  const fine = new FrameProfiler();
  for (let i = 0; i < 60; i++) fine.frame(16.7, i / 60);
  assert.equal(fine.bound, 'ok');
  assert.equal(new FrameProfiler().bound, 'ok', 'no data, no verdict');
});

test('quality drops quickly after a run of slow frames and returns only after a long run of fast ones', () => {
  const g = new QualityGovernor();
  assert.equal(g.update(40, 0), null);
  assert.equal(g.update(40, DOWN_AFTER - 0.1), null, 'not yet');
  assert.equal(g.update(40, DOWN_AFTER + 0.1), 1);
  assert.equal(g.update(40, 2 * DOWN_AFTER + 0.2), 2, 'still slow: another step');
  assert.equal(g.update(40, 3 * DOWN_AFTER + 0.3), 3);
  assert.equal(g.update(40, 99), null, 'there is a floor');
  assert.equal(g.level, MAX_LEVEL);
  g.update(12, 100);
  assert.equal(g.update(12, 100 + UP_AFTER - 1), null, 'raising it again is slow');
  assert.equal(g.update(12, 100 + UP_AFTER + 0.1), 2);
});

test('one good frame in a slow run does not reset the count, a medium frame does, and a locked governor never moves', () => {
  const g = new QualityGovernor();
  g.update(SLOW_MS + 5, 0);
  g.update(20, 0.5); // between slow and fast: the run is broken
  assert.equal(g.update(SLOW_MS + 5, 1.7), null, 'the run started again at 1.7');
  assert.equal(g.update(SLOW_MS + 5, 1.7 + DOWN_AFTER + 0.1), 1);
  const locked = new QualityGovernor({ locked: true });
  locked.update(50, 0);
  assert.equal(locked.update(50, 60), null);
  assert.equal(locked.level, 0);
});

test('each level asks for less: lower resolution, then fewer detections, then fewer arm checks', () => {
  const l = [0, 1, 2, 3].map((n) => settings(n, 2));
  assert.deepEqual(l.map((x) => x.pixelRatio), [2, 1.5, 1, 1]);
  assert.deepEqual(l.map((x) => x.detectEvery), [1, 1, 2, 2]);
  assert.ok(l[3].poseEvery > l[0].poseEvery);
  assert.equal(settings(0, 1).pixelRatio, 1, 'a normal screen is never scaled up');
});
