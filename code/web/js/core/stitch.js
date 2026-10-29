// Joining hand-drawn lines. A hand never lands exactly on the start of a loop or the end of another line, so after a
// freehand stroke the app looks for (a) a stroke whose two ends almost meet, and (b) another line whose end is close,
// and offers to close or join them. Pure functions: they decide and build; the app asks and applies.
import { Poly } from './shapes.js';
import { add, sub, mul, len } from './vec.js';

export const JOIN_TOL = 0.12; // world units: ends closer than this are candidates (the workspace is 2.4 wide)
export const MIN_LOOP_LENGTH = 0.5; // a stroke must be at least this long before it is offered to be closed

/** Only hand-drawn lines and straight lines can be joined; shapes are already complete. */
export const isJoinable = (it) => it instanceof Poly && (it.kind === 'free' || it.kind === 'line') && !it.closed && it.pts.length >= 2;

export function pathLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += len(sub(pts[i], pts[i - 1]));
  return l;
}

export const endGap = (pts) => len(sub(pts[pts.length - 1], pts[0]));

export const endPoint = (it, which) => (which === 'start' ? it.pts[0] : it.pts[it.pts.length - 1]);

/** Can this single stroke be closed into a loop? Returns the gap, or null. */
export function closableGap(it, tol = JOIN_TOL) {
  if (!isJoinable(it) || pathLength(it.pts) < MIN_LOOP_LENGTH) return null;
  const g = endGap(it.pts);
  return g <= tol ? g : null;
}

/**
 * The best thing to offer for a stroke that was just drawn, or null.
 *   { type: 'close', item, gap }                       its own ends almost meet
 *   { type: 'join', a, b, ea, eb, gap }                an end of `a` is near an end of `b`
 * `ea` / `eb` say which end ('start' | 'end'). The smaller gap wins.
 */
export function suggestFor(items, item, tol = JOIN_TOL) {
  if (!isJoinable(item)) return null;
  let best = null;
  const loop = closableGap(item, tol);
  if (loop !== null) best = { type: 'close', item, gap: loop };
  for (const other of items) {
    if (other === item || !isJoinable(other)) continue;
    for (const ea of ['start', 'end']) for (const eb of ['start', 'end']) {
      const gap = len(sub(endPoint(item, ea), endPoint(other, eb)));
      if (gap <= tol && (!best || gap < best.gap)) best = { type: 'join', a: item, b: other, ea, eb, gap };
    }
  }
  return best;
}

/** Close a stroke into a loop: its last point becomes its first. Returns a NEW Poly (so it can be undone). */
export function closedCopy(it) {
  const pts = it.pts.map((p) => p.slice());
  pts[pts.length - 1] = pts[0].slice();
  return new Poly(it.kind, pts, true);
}

/**
 * Join two strokes end to end into one. The two touching end points are replaced by their midpoint so there is no
 * gap and no duplicate point. Returns a new Poly.
 */
export function joinedCopy(a, ea, b, eb) {
  const A = a.pts.map((p) => p.slice()), B = b.pts.map((p) => p.slice());
  // orient so A runs ... -> joint and B runs joint -> ...
  if (ea === 'start') A.reverse();
  if (eb === 'end') B.reverse();
  const mid = mul(add(A[A.length - 1], B[0]), 0.5);
  const pts = [...A.slice(0, -1), mid, ...B.slice(1)];
  return new Poly('free', pts, false);
}

/**
 * Join everything that can be joined and close everything that can be closed.
 * Returns { removed: [old items], added: [new items], joined, closed } and does not touch the input.
 */
export function stitchAll(items, tol = JOIN_TOL) {
  const originals = items.filter(isJoinable);
  let work = originals.slice();
  const removedOriginals = new Set();
  let joined = 0;
  for (;;) { // always merge the globally closest pair of ends first
    let best = null;
    for (let i = 0; i < work.length; i++) for (let j = i + 1; j < work.length; j++) {
      for (const ea of ['start', 'end']) for (const eb of ['start', 'end']) {
        const gap = len(sub(endPoint(work[i], ea), endPoint(work[j], eb)));
        if (gap <= tol && (!best || gap < best.gap)) best = { i, j, ea, eb, gap };
      }
    }
    if (!best) break;
    const a = work[best.i], b = work[best.j];
    const merged = joinedCopy(a, best.ea, b, best.eb);
    for (const x of [a, b]) if (originals.includes(x)) removedOriginals.add(x);
    work = work.filter((_, k) => k !== best.i && k !== best.j);
    work.push(merged);
    joined++;
  }
  let closed = 0;
  work = work.map((it) => {
    if (closableGap(it, tol) === null) return it;
    closed++;
    if (originals.includes(it)) removedOriginals.add(it);
    return closedCopy(it);
  });
  const added = work.filter((it) => !originals.includes(it));
  return { removed: [...removedOriginals], added, joined, closed };
}
