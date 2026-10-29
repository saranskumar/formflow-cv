import test from 'node:test';
import assert from 'node:assert/strict';
import { PracticeSession, HOLD_S } from '../js/core/practice.js';

// ---------------------------------------------------------------- practice
const reading = (o = {}) => ({ pinch: false, grab: false, fist: false, peace: false, rI: 0.9, ...o });

function hold(p, r, secs, t0, fps = 30) {
  let t = t0;
  for (let i = 0; i < Math.round(secs * fps); i++) { p.feed(r, t); t += 1 / fps; }
  return t;
}

test('entering needs a real pinch AND a real fist, each held', () => {
  const p = new PracticeSession();
  let t = hold(p, reading(), 0.6, 0);
  assert.ok(p.done.hand && !p.ready);
  t = hold(p, reading({ pinch: true, rI: 0.1 }), HOLD_S + 0.2, t);
  assert.ok(p.done.pinch && !p.ready, 'pinch alone is not enough');
  t = hold(p, reading({ fist: true }), HOLD_S + 0.2, t);
  assert.ok(p.done.fist && p.ready);
  assert.ok(!p.done.grab && !p.done.peace, 'bonus gestures are optional');
});

test('a flicker is not a gesture: it must be held, and losing it resets the clock', () => {
  const p = new PracticeSession();
  let t = hold(p, reading(), 0.6, 0);
  t = hold(p, reading({ pinch: true }), 0.3, t);
  t = hold(p, reading(), 0.1, t);
  t = hold(p, reading({ pinch: true }), 0.3, t);
  assert.ok(!p.done.pinch);
  assert.ok(p.progress('pinch') > 0.4 && p.progress('pinch') < 1);
});

test('no hand in view means no progress at all', () => {
  const p = new PracticeSession();
  hold(p, null, 3, 0);
  assert.ok(!p.done.hand && !p.ready && p.progress('pinch') === 0);
});

test('a long gap between frames cannot fake a held gesture', () => {
  const p = new PracticeSession();
  p.feed(reading({ pinch: true }), 0);
  p.feed(reading({ pinch: true }), 30); // 30 s later: a stall, not 30 s of pinching
  assert.ok(!p.done.pinch);
});

test('personal pinch thresholds come from the open and pinched spacing the user showed', () => {
  const p = new PracticeSession();
  let t = hold(p, reading({ rI: 1.0 }), 0.6, 0);
  t = hold(p, reading({ pinch: true, rI: 0.1 }), 0.6, t);
  const c = p.calibration();
  assert.ok(Math.abs(c.pinchOn - (0.1 + 0.3 * 0.9)) < 1e-9);
  assert.ok(c.pinchOff > c.pinchOn);
});

test('no calibration without both poses, or without enough separation', () => {
  assert.equal(new PracticeSession().calibration(), null);
  const p = new PracticeSession();
  let t = hold(p, reading({ rI: 0.35 }), 0.6, 0);
  hold(p, reading({ pinch: true, rI: 0.3 }), 0.6, t);
  assert.equal(p.calibration(), null);
});
