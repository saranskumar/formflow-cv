// Display smoothing: hand movement that looks smooth at the screen's rate, not the detector's.
//
// The detector delivers a new hand position 15-30 times a second, unevenly, and every position has a little noise. Drawn
// as they arrive the hand and the cursor stand still between updates and then jump, and shake at rest. A Follower runs on
// every screen frame and glides toward the newest position. How hard it smooths depends on the distance still to cover:
//   close to the target (noise, a nearly still hand)  -> a long time constant: the shake is averaged away
//   far from the target (the hand is moving quickly)  -> a short one: the cursor keeps up, no sluggish lag
// so the same filter is steady at rest and responsive in motion. Pure logic; main.js feeds it and draws the result.

const smooth01 = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

export const DEFAULTS = Object.freeze({ near: 0.003, far: 0.03, slow: 0.16, fast: 0.025, gap: 0.3 });

/** The share of the remaining distance to cover this frame. dist in the same unit as near / far; dt in seconds. */
export function follow(dist, dt, { near, far, slow, fast }, strength = 1) {
  if (strength <= 0) return 1;
  const tau = (slow + (fast - slow) * smooth01(near, far, dist)) * strength;
  return 1 - Math.exp(-dt / tau);
}

/** One point (any number of coordinates). near / far are distances: below near = at rest, above far = moving fast. */
export class Follower {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.reset();
  }

  reset() { this.p = null; this.t = null; }

  /** target: [x, y, ...]; t: seconds. Returns the smoothed position (a new array). */
  follow(target, t, strength = 1) {
    if (!this.p || t - this.t > this.o.gap || strength <= 0) { this.p = target.slice(); this.t = t; return this.p.slice(); }
    const dt = Math.min(Math.max(t - this.t, 0), 0.1);
    this.t = t;
    const dist = Math.hypot(...target.map((v, i) => v - this.p[i]));
    const a = follow(dist, dt, this.o, strength);
    this.p = this.p.map((v, i) => v + (target[i] - v) * a);
    return this.p.slice();
  }
}

/** The 21 points of a hand, each followed on its own: a fingertip that shakes is calmed while the wrist that moves is not held back. */
export class LandmarkFollower {
  constructor(opts = {}) { this.opts = opts; this.pts = []; }
  reset() { this.pts.forEach((f) => f.reset()); }

  /** lm: [{x, y, z?}...]; returns the same shape. */
  follow(lm, t, strength = 1) {
    while (this.pts.length < lm.length) this.pts.push(new Follower(this.opts));
    return lm.map((q, i) => { const [x, y] = this.pts[i].follow([q.x, q.y], t, strength); return { ...q, x, y }; });
  }
}
