// Gesture decoding from the 21 MediaPipe hand landmarks (x, y normalised to the image, already mirrored).
//
//   pinch  = thumb + INDEX finger together    -> draw / place / press
//   grab   = thumb + MIDDLE finger together   -> pick up and move an object
//   fist   = all four fingers curled          -> orbit
//   peace  = index + middle up, others curled -> pan
//
// Distances are measured relative to palm size, so they work at any distance from the camera. When MediaPipe's 3D
// "world" landmarks (metres, rotation-invariant) are available they are used: in flat image space a hand turned
// sideways has a thumb-index gap that shrinks with the cosine of the rotation, which fakes a pinch. Gestures have
// separate on/off thresholds (hysteresis) and a frame debounce; poses (fist, peace) must hold longer than a pinch,
// so a single bad frame never fires an orbit or a pan.

export const LM = {
  WRIST: 0, THUMB_TIP: 4, INDEX_PIP: 6, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12,
  RING_PIP: 14, RING_TIP: 16, PINKY_PIP: 18, PINKY_TIP: 20,
};

const FINGERS = { index: [8, 6], middle: [12, 10], ring: [16, 14], pinky: [20, 18] };
const POSES = new Set(['fist', 'peace', 'point']);

export function dist(a, b, aspect = 16 / 9) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const mid = (a, b) => [(a.x + b.x) / 2, (a.y + b.y) / 2];

export class GestureDecoder {
  /**
   * debounce: frames a pinch/grab must persist. poseDebounce: frames a fist/peace must persist.
   * smooth: 0 = off, else the weight (0..1) of the newest pinch ratio in an exponential average (steadier thresholds).
   */
  constructor({ on = 0.30, off = 0.45, debounce = 2, poseDebounce = 3, aspect = 16 / 9, smooth = 0 } = {}) {
    this.on = on;
    this.off = off;
    this.debounce = debounce;
    this.poseDebounce = poseDebounce;
    this.aspect = aspect;
    this.smooth = smooth;
    this.reset();
  }

  reset() {
    this.state = { pinch: false, grab: false, fist: false, peace: false, point: false };
    this.streak = { pinch: 0, grab: 0, fist: 0, peace: 0, point: 0 };
    this.sI = this.sM = null;
  }

  /** Palm size in IMAGE space (height units). Used for mapping and for deciding how big a hand is. */
  palmSize(lm) {
    return dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP], this.aspect) || 1e-6;
  }

  _flip(key, want) {
    const need = POSES.has(key) ? this.poseDebounce : this.debounce;
    if (want !== this.state[key]) {
      if (++this.streak[key] >= need) {
        this.state[key] = want;
        this.streak[key] = 0;
      }
    } else {
      this.streak[key] = 0;
    }
    return this.state[key];
  }

  /** lm: image landmarks. world: optional 3D world landmarks (metres) for rotation-proof distances. */
  step(lm, world = null) {
    const W = world && world.length >= 21 ? world : null;
    const P = W || lm;
    const d = W ? d3 : (a, b) => dist(a, b, this.aspect);
    const palm = d(P[LM.WRIST], P[LM.MIDDLE_MCP]) || 1e-6;
    let rI = d(P[LM.THUMB_TIP], P[LM.INDEX_TIP]) / palm;
    let rM = d(P[LM.THUMB_TIP], P[LM.MIDDLE_TIP]) / palm;
    if (this.smooth > 0) { // steadier decisions: the thresholds see a lightly averaged ratio
      this.sI = this.sI === null ? rI : this.sI + this.smooth * (rI - this.sI);
      this.sM = this.sM === null ? rM : this.sM + this.smooth * (rM - this.sM);
      rI = this.sI;
      rM = this.sM;
    }
    const reach = (i) => d(P[i], P[LM.WRIST]);
    const curled = ([tip, pip]) => reach(tip) < reach(pip);
    const extended = ([tip, pip]) => reach(tip) > reach(pip) * 1.08;

    const fistRaw = Object.values(FINGERS).every(curled);
    const peaceRaw = extended(FINGERS.index) && extended(FINGERS.middle) && curled(FINGERS.ring)
      && curled(FINGERS.pinky) && Math.min(rI, rM) > this.on * 1.3;
    // pointing: only the index finger out, the thumb clear of it (a pinch brings them together)
    const pointRaw = extended(FINGERS.index) && curled(FINGERS.middle) && curled(FINGERS.ring) && curled(FINGERS.pinky) && rI > this.on * 1.3;
    const th = (k) => (this.state[k] ? this.off : this.on);
    const pinchRaw = !fistRaw && rI < th('pinch') && rI <= rM * 1.15;
    const grabRaw = !fistRaw && !pinchRaw && rM < th('grab') && rM < rI * 0.87;

    const fist = this._flip('fist', fistRaw);
    const peace = this._flip('peace', peaceRaw && !fist);
    const pinch = this._flip('pinch', pinchRaw && !fist);
    const grab = this._flip('grab', grabRaw && !fist && !pinch);
    const point = this._flip('point', pointRaw && !fist && !pinch && !grab && !peace);

    return {
      pinch: pinch && !fist,
      grab: grab && !fist && !pinch,
      fist,
      peace: peace && !fist,
      point: point && !fist && !pinch && !grab && !peace,
      palm: this.palmSize(lm),
      rI,
      rM,
      world: !!W,
      // thumb-index midpoint (or thumb-middle midpoint while grabbing): moves least as the fingers close
      // (when pointing, the cursor is the fingertip itself)
      cursor: point && !pinch && !grab ? lm[LM.INDEX_TIP] : mid(lm[LM.THUMB_TIP], grab && !pinch ? lm[LM.MIDDLE_TIP] : lm[LM.INDEX_TIP]),
      // steady palm centre, used for orbit and pan where the fingers are not the pointer
      center: mid(lm[LM.WRIST], lm[LM.MIDDLE_MCP]),
    };
  }
}
