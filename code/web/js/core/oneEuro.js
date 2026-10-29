// One-Euro filter: strong smoothing when the hand is slow (kills jitter), light when it is fast (no lag).
export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 6.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = [0, 0];
    this.t = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** p = [x, y], t in seconds. Returns the filtered [x, y]. */
  filter(p, t) {
    if (this.x === null) {
      this.x = [p[0], p[1]];
      this.t = t;
      this.dx = [0, 0];
      return [p[0], p[1]];
    }
    const dt = Math.max(t - this.t, 1e-3);
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = [0, 1].map((i) => ad * ((p[i] - this.x[i]) / dt) + (1 - ad) * this.dx[i]);
    const speed = Math.hypot(this.dx[0], this.dx[1]);
    const a = OneEuro.alpha(this.minCutoff + this.beta * speed, dt);
    this.x = [0, 1].map((i) => a * p[i] + (1 - a) * this.x[i]);
    this.t = t;
    return [this.x[0], this.x[1]];
  }

  /** Force the filter state (used by the pinch latch). */
  setState(p) {
    this.x = [p[0], p[1]];
  }
}
