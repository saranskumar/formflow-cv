// Per-hand signal cleaning, so the cursor does what the user *meant*.
//   * One-Euro smoothing (steady when slow, no lag when fast)
//   * glitch rejection: a one-frame leap across the image is a tracking error, not a movement
//   * grasp latch: closing the fingers drags the cursor a little. At pinch/grab onset we rewind to where the
//     cursor was just before and hold it for a moment, so a stroke starts where you aimed. The same hold at
//     release stops the object drifting as the fingers open.
import { OneEuro } from './oneEuro.js';
import { GestureDecoder } from './gestures.js';

export class HandTrack {
  constructor(cal = {}) {
    this.decoder = new GestureDecoder();
    this.fCursor = new OneEuro();
    this.fCenter = new OneEuro();
    this.LOOKBACK = 0.15; // s: rewind this far at grasp onset
    this.RELEASE_LOOKBACK = 0.10;
    this.HOLD = 0.08; // s: freeze the cursor after onset / release
    this.GLITCH = 0.18; // image fraction: a bigger one-frame jump is rejected
    this.MAX_GLITCH_FRAMES = 3;
    this.baseCutoff = 1.0;
    this.anchor = true; // the cursor rides on the wrist/palm; only its offset from the palm is taken from the fingers
    this.apply(cal);
    this.reset();
  }

  apply({ pinchOn, pinchOff, smoothing, aspect, smoothRatio, anchor } = {}) {
    if (anchor !== undefined) this.anchor = anchor;
    if (pinchOn !== undefined) this.decoder.on = pinchOn;
    if (pinchOff !== undefined) this.decoder.off = pinchOff;
    if (aspect !== undefined) this.decoder.aspect = aspect;
    if (smoothRatio !== undefined) this.decoder.smooth = smoothRatio;
    if (smoothing !== undefined) {
      this.baseCutoff = smoothing;
      this.fCursor.minCutoff = smoothing;
      this.fCenter.minCutoff = smoothing;
    }
  }

  reset() {
    this.decoder.reset();
    this.fCursor.reset();
    this.fCenter.reset();
    this.hist = [];
    this.prev = null;
    this.prevT = 0;
    this.glitch = 0;
    this.wasGrasping = false;
    this.holdUntil = 0;
    this.latched = null;
    this.off = null;
  }

  _at(t) {
    for (const [ht, hp] of this.hist) if (ht >= t) return [hp[0], hp[1]];
    return this.hist[this.hist.length - 1][1].slice();
  }

  /** lm: 21 landmarks, now: seconds. Returns a Reading. */
  step(lm, now, label = '', world = null) {
    // A small (far-away) hand has noisier landmarks: its pixel error is a bigger fraction of the hand. Smooth harder
    // and require a gesture to persist one frame longer, so tiny hands still feel steady and never flicker.
    const palm = this.decoder.palmSize(lm);
    const k = Math.min(Math.max(palm / 0.08, 0.3), 1);
    this.fCursor.minCutoff = this.fCenter.minCutoff = this.baseCutoff * k;
    this.decoder.debounce = palm < 0.03 ? 3 : 2;
    const g = this.decoder.step(lm, world);
    let raw = g.cursor;
    if (this.anchor) {
      // Fingertips jitter far more than the wrist and palm base, and closing a pinch drags the fingertips around.
      // So follow the steady palm point (wrist + middle knuckle) and only low-pass the pinch point's offset from it.
      const off = [raw[0] - g.center[0], raw[1] - g.center[1]];
      const a = palm < 0.04 ? 0.2 : 0.35;
      this.off = this.off ? [this.off[0] + a * (off[0] - this.off[0]), this.off[1] + a * (off[1] - this.off[1])] : off;
      raw = [g.center[0] + this.off[0], g.center[1] + this.off[1]];
    }
    if (this.prev && now - this.prevT < 0.15 && this.glitch < this.MAX_GLITCH_FRAMES
      && Math.hypot(raw[0] - this.prev[0], raw[1] - this.prev[1]) > this.GLITCH) {
      raw = this.prev; // reject the leap
      this.glitch++;
    } else {
      this.glitch = 0;
    }
    this.prev = raw;
    this.prevT = now;

    let cur = this.fCursor.filter(raw, now);
    const center = this.fCenter.filter(g.center, now);
    this.hist.push([now, cur.slice()]);
    while (this.hist.length && now - this.hist[0][0] > 0.6) this.hist.shift();

    const grasping = g.pinch || g.grab;
    if (grasping && !this.wasGrasping) {
      this.latched = this._at(now - this.LOOKBACK);
      this.fCursor.setState(this.latched);
      this.holdUntil = now + this.HOLD;
    } else if (!grasping && this.wasGrasping) {
      this.latched = this._at(now - this.RELEASE_LOOKBACK);
      this.fCursor.setState(this.latched);
      this.holdUntil = now + this.HOLD;
    }
    this.wasGrasping = grasping;
    if (now < this.holdUntil && this.latched) cur = this.latched;

    return {
      cur, center, pinch: g.pinch, grab: g.grab, fist: g.fist, peace: g.peace, point: g.point,
      palm: g.palm, rI: g.rI, rM: g.rM, t: now, label, world: g.world,
    };
  }
}
