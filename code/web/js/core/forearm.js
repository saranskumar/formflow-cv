// The arm below the hand. MediaPipe's pose model sees the elbow and wrist even when the hand itself is too small, too
// blurry or turned away for the hand detector. The hand tracker uses that as a second opinion:
//   * a hand that vanishes right next to a known wrist is bridged for longer instead of being dropped,
//   * the held hand follows the wrist, so it is re-acquired where the arm went,
//   * a new hand that appears on a known wrist is believed one frame sooner,
//   * the auto-follow crop can aim at a wrist before the hand is detected again.
// Coordinates are in the same mirrored image space as the hand landmarks (x already flipped).
import { dist } from './gestures.js';

const WRIST = { left: 15, right: 16 }, ELBOW = { left: 13, right: 14 }; // BlazePose indices (the person's own left / right)
const MIN_VISIBLE = 0.4;

export class Forearm {
  constructor({ maxAge = 0.6 } = {}) {
    this.maxAge = maxAge;
    this.arms = { left: null, right: null };
    this.updates = 0;
  }

  reset() { this.arms = { left: null, right: null }; }

  /** result = PoseLandmarker output. x is flipped here so it matches the (mirrored) hand landmarks. */
  update(result, t) {
    const p = result && result.landmarks && result.landmarks[0];
    if (!p) return;
    this.updates++;
    for (const side of ['left', 'right']) {
      const w = p[WRIST[side]], e = p[ELBOW[side]];
      const seen = w && (w.visibility === undefined || w.visibility >= MIN_VISIBLE) && w.x > -0.02 && w.x < 1.02 && w.y > -0.02 && w.y < 1.02;
      if (!seen) continue;
      this.arms[side] = {
        wrist: { x: 1 - w.x, y: w.y },
        elbow: e && (e.visibility === undefined || e.visibility >= MIN_VISIBLE) ? { x: 1 - e.x, y: e.y } : null,
        t,
      };
    }
  }

  fresh(t) { return Object.values(this.arms).filter((a) => a && t - a.t <= this.maxAge); }

  /** The nearest fresh arm whose wrist is within `radius` (image-height fractions) of `point`, or null. */
  support(point, t, aspect, radius) {
    let best = null, bd = radius;
    for (const a of this.fresh(t)) {
      const d = dist(point, a.wrist, aspect);
      if (d <= bd) { best = a; bd = d; }
    }
    return best;
  }

  /** Wrists as crop hints for the auto-follow planner, in the camera's own (unmirrored) image. */
  hints(t) { return this.fresh(t).map((a) => ({ cx: 1 - a.wrist.x, cy: a.wrist.y, palm: 0.05 })); }
}
