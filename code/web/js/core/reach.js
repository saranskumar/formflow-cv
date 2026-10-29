// Reach calibration: the user shows the two opposite corners of the area they will work in (for a projector, the
// part of the camera image that corresponds to the projected surface, or simply their comfortable reach).
// That box is then mapped onto the whole screen, so even a tiny, far-away hand can reach every corner.

export const HOLD = 1.0; // seconds of stillness to confirm a corner
export const STILL = 0.012; // max wander (image fraction) while holding
export const MIN_SPAN = 0.05; // the box must be at least this big in both directions

export class ReachCalibrator {
  constructor() { this.reset(); }

  reset() {
    this.step = 0; // 0 = top-left, 1 = bottom-right, 2 = done
    this.points = [];
    this.buf = [];
    this.progress = 0;
    this.message = 'Hold your hand at the TOP-LEFT of your working area';
    this.cool = 0;
  }

  get done() { return this.step >= 2; }

  /** p = [x, y] image fractions (mirrored) or null when no hand; now in seconds. */
  feed(p, now) {
    if (this.done || now < this.cool) return;
    if (!p) { this.buf = []; this.progress = 0; return; }
    this.buf.push([now, p[0], p[1]]);
    while (this.buf.length && now - this.buf[0][0] > HOLD + 0.15) this.buf.shift();
    const xs = this.buf.map((b) => b[1]), ys = this.buf.map((b) => b[2]);
    const still = Math.max(...xs) - Math.min(...xs) < STILL * 2 && Math.max(...ys) - Math.min(...ys) < STILL * 2;
    const span = now - this.buf[0][0];
    if (!still) { this.progress = 0; return; }
    this.progress = Math.min(span / HOLD, 1);
    if (span < HOLD * 0.98) return;
    const mean = [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length];
    if (this.step === 1) {
      const [a] = this.points;
      if (Math.abs(mean[0] - a[0]) < MIN_SPAN || Math.abs(mean[1] - a[1]) < MIN_SPAN) {
        this.message = 'Move further to the BOTTOM-RIGHT of your working area';
        return;
      }
    }
    this.points.push(mean);
    this.step++;
    this.buf = [];
    this.progress = 0;
    this.cool = now + 0.8;
    this.message = this.done ? 'Reach area saved' : 'Now hold your hand at the BOTTOM-RIGHT';
  }

  /** [x0, y0, x1, y1] expanded 4%, clamped to the image. */
  get region() {
    if (!this.done) return null;
    const [a, b] = this.points;
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    const px = 0.04 * (x1 - x0), py = 0.04 * (y1 - y0);
    return [Math.max(0, x0 - px), Math.max(0, y0 - py), Math.min(1, x1 + px), Math.min(1, y1 + py)];
  }
}
