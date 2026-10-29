import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustImage, newImage, fitWidth, MIN_SIZE, MAX_SIZE } from '../js/ui/refimages.js';

test('a new image fits the 2 x 2 workspace with its own proportions', () => {
  assert.equal(fitWidth(2), 2);
  assert.equal(fitWidth(0.5), 1);
  const im = newImage(1.5);
  assert.equal(im.w, 2);
  assert.ok(im.w / im.aspect <= 2);
});

test('size, move, fade and flip adjust the image and respect their limits', () => {
  let im = newImage(1);
  assert.ok(adjustImage(im, 'bigger').w > im.w);
  assert.ok(adjustImage(im, 'smaller').w < im.w);
  for (let i = 0; i < 100; i++) im = adjustImage(im, 'bigger');
  assert.equal(im.w, MAX_SIZE);
  for (let i = 0; i < 200; i++) im = adjustImage(im, 'smaller');
  assert.equal(im.w, MIN_SIZE);
  const a = adjustImage(newImage(1), 'right');
  assert.ok(a.cx > 0 && a.cy === 0);
  assert.ok(adjustImage(newImage(1), 'up').cy > 0);
  let f = newImage(1);
  for (let i = 0; i < 20; i++) f = adjustImage(f, 'fadeOut');
  assert.equal(f.opacity, 0.1);
  for (let i = 0; i < 20; i++) f = adjustImage(f, 'fadeIn');
  assert.equal(f.opacity, 1);
  assert.equal(adjustImage(newImage(1), 'flip').flip, true);
  const base = newImage(1); adjustImage(base, 'right');
  assert.equal(base.cx, 0); // the original is not mutated
});

import { outlineFromTrace } from '../js/ui/refimages.js';
import { PLANE_VIEWS } from '../js/core/planes.js';
import { classifyPlane } from '../js/core/hull.js';

test('a traced outline lands on the view plane where the picture sits, and follows size, position and mirroring', () => {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const im = { cx: 0, cy: 0, w: 2, aspect: 2, opacity: 1, flip: false }; // 2 wide, 1 high
  const front = outlineFromTrace(sq, im, PLANE_VIEWS.front);
  assert.deepEqual(front[0], [-1, 0.5, 0]); // picture top-left -> world (-1, +0.5)
  assert.deepEqual(front[2], [1, -0.5, 0]);
  assert.equal(classifyPlane(front), 'z');
  const side = outlineFromTrace(sq, im, PLANE_VIEWS.side); // side: right = -Z
  assert.equal(classifyPlane(side), 'x');
  assert.equal(side[0][2], 1);
  const moved = outlineFromTrace(sq, { ...im, cx: 0.5, w: 1 }, PLANE_VIEWS.front);
  assert.ok(Math.abs(moved[0][0] - 0) < 1e-9 && Math.abs(moved[2][0] - 1) < 1e-9);
  const flipped = outlineFromTrace([[0.25, 0.5]], { ...im, flip: true }, PLANE_VIEWS.front);
  assert.ok(Math.abs(flipped[0][0] - 0.5) < 1e-9);
});

import { moveImage, scaleImage } from '../js/ui/refimages.js';

test('fade cycles through fixed steps; move and scale stay within limits', () => {
  let im = newImage(1); // opacity 0.6
  const seen = [];
  for (let i = 0; i < 5; i++) { im = adjustImage(im, 'fade'); seen.push(im.opacity); }
  assert.deepEqual(seen, [0.7, 1, 0.25, 0.45, 0.7]);
  const m = moveImage(newImage(1), 10, -10);
  assert.equal(m.cx, 3); assert.equal(m.cy, -3);
  assert.equal(scaleImage(newImage(1), 100).w, MAX_SIZE);
  assert.equal(scaleImage(newImage(1), 0.001).w, MIN_SIZE);
});
