// Choose the user's own hands out of everything the camera sees (at most two: one left + one right).
import { LM, dist } from './gestures.js';

export const MIN_PALM = 0.035; // smaller than this (image fraction) = too far away to be the user
export const OPPOSITE_RATIO = 0.55; // a second hand of the opposite side must be at least this big vs the first
export const SAME_LABEL_RATIO = 0.70; // ...and stricter when both hands are labelled alike
export const MIN_SEPARATION = 0.15; // same-label hands must be at least this far apart (image width fraction)

/**
 * dets: [{ side: 'Left'|'Right', lm: landmarks }] (side = the user's own side, after mirroring).
 * A bystander behind the user has smaller hands, so the LARGEST hand is the user's, favouring the one near where
 * the main hand was last seen. A second hand is kept only if it is the opposite hand and close in size.
 * Returns indices into dets (length 0..2).
 */
export function selectUserHands(dets, prevMain = null, aspect = 16 / 9, minPalm = MIN_PALM) {
  const size = (lm) => dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP], aspect);
  let cand = dets.map((d, i) => [size(d.lm), i]).filter(([sz]) => sz >= minPalm);
  if (!cand.length) return [];
  const score = ([sz, i]) => {
    const w = dets[i].lm[LM.WRIST];
    const near = prevMain && Math.hypot(w.x - prevMain[0], w.y - prevMain[1]) < 0.2;
    return sz * (near ? 1.3 : 1.0);
  };
  cand.sort((a, b) => score(b) - score(a));
  const [firstSz, first] = cand[0];
  const chosen = [first];
  for (const [sz, i] of cand.slice(1)) {
    const same = dets[i].side === dets[first].side;
    const far = Math.abs(dets[i].lm[LM.WRIST].x - dets[first].lm[LM.WRIST].x) >= MIN_SEPARATION;
    if ((!same && sz >= OPPOSITE_RATIO * firstSz) || (same && far && sz >= SAME_LABEL_RATIO * firstSz)) {
      chosen.push(i);
      break;
    }
  }
  return chosen;
}

/** Role ('main' | 'second') for each chosen hand. */
export function assignRoles(sides, xs, dominant = 'Right') {
  if (sides.length === 1) return ['main'];
  const hits = sides.map((s, i) => (s === dominant ? i : -1)).filter((i) => i >= 0);
  let main;
  if (hits.length === 1) main = hits[0];
  else main = dominant === 'Right' ? xs.indexOf(Math.max(...xs)) : xs.indexOf(Math.min(...xs));
  return sides.map((_, i) => (i === main ? 'main' : 'second'));
}

// ------------------------------------------------------------------ helpers for the stable tracker
export const palmOf = (det, aspect = 16 / 9) => dist(det.lm[LM.WRIST], det.lm[LM.MIDDLE_MCP], aspect);
const wristOf = (det) => det.lm[LM.WRIST];

/**
 * MediaPipe sometimes reports ONE real hand twice (usually with opposite left/right labels), which looks like a second
 * hand. Two detections whose wrists sit within a fraction of a palm of each other are the same hand: keep the most
 * confident (then the largest). Returns the indices to keep, in input order.
 */
export function dedupeDetections(dets, aspect = 16 / 9, overlap = 0.6) {
  const order = dets.map((_, i) => i).sort((a, b) => ((dets[b].score ?? 1) - (dets[a].score ?? 1)) || (palmOf(dets[b], aspect) - palmOf(dets[a], aspect)));
  const kept = [];
  for (const i of order) {
    if (kept.every((k) => dist(wristOf(dets[i]), wristOf(dets[k]), aspect) > overlap * Math.max(palmOf(dets[i], aspect), palmOf(dets[k], aspect)))) kept.push(i);
  }
  return kept.sort((a, b) => a - b);
}

/** Could `b` be the user's second hand, given `a` is already tracked? (opposite hand and similar size, or well apart) */
export function compatible(a, b, aspect = 16 / 9) {
  const sa = palmOf(a, aspect), sb = palmOf(b, aspect);
  const ratio = Math.min(sa, sb) / Math.max(sa, sb, 1e-9);
  const same = a.side === b.side;
  const far = Math.abs(wristOf(a).x - wristOf(b).x) >= MIN_SEPARATION;
  return (!same && ratio >= OPPOSITE_RATIO) || (same && far && ratio >= SAME_LABEL_RATIO);
}
