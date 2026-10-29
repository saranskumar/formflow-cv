// Zoom-and-follow cropping for small, distant hands.
//
// MediaPipe's palm detector looks at a small downscaled image, so a hand that fills 3% of a wide shot is only a few
// pixels there and is missed. Feeding it a CROP of the camera image around the hands makes them several times larger
// to the detector. Crops are squares in image fractions (w == h) so the video's aspect ratio is preserved and
// landmark coordinates map back to the full frame with a simple scale and offset.

export const MIN_CROP = 0.30; // never crop tighter than this fraction of the image
export const FULL = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Landmark in a crop (0..1 within the crop) -> full-frame image fraction. */
export function fromCrop(p, roi) {
  return { x: roi.x + p.x * roi.w, y: roi.y + p.y * roi.h, z: p.z };
}

/** Keep a crop inside the image. */
export function fitRoi(cx, cy, size) {
  const s = clamp(size, MIN_CROP, 1);
  return { x: clamp(cx - s / 2, 0, 1 - s), y: clamp(cy - s / 2, 0, 1 - s), w: s, h: s };
}

/**
 * A crop that follows the hands. hands = [{ cx, cy, palm }] in full-frame image fractions (palm = wrist to middle
 * knuckle, as a fraction of image HEIGHT). The crop shows `reach` palm-sizes around the hands, so a hand that is
 * small in the image gets a tight crop and a large one gets the whole frame.
 */
export function followRoi(hands, { reach = 9, aspect = 16 / 9 } = {}) {
  if (!hands.length) return { ...FULL };
  const xs = hands.map((h) => h.cx * aspect), ys = hands.map((h) => h.cy);
  const palm = Math.max(...hands.map((h) => h.palm));
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(spanX / aspect, spanY) + reach * palm; // fractions of the image HEIGHT-equivalent
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2 / aspect;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return fitRoi(cx, cy, size);
}

/** Ease the crop toward its target so the picture the detector sees does not jump. */
export function easeRoi(prev, next, k = 0.35) {
  if (!prev) return next;
  const lerp = (a, b) => a + (b - a) * k;
  return fitRoi(lerp(prev.x + prev.w / 2, next.x + next.w / 2), lerp(prev.y + prev.h / 2, next.y + next.h / 2), lerp(prev.w, next.w));
}

/** The source rectangle in video pixels, and the size to draw it at (never upscaled past maxW). */
export function cropRect(roi, vw, vh, maxW = 1280) {
  const sw = Math.round(roi.w * vw), sh = Math.round(roi.h * vh);
  const sx = Math.round(roi.x * vw), sy = Math.round(roi.y * vh);
  const k = Math.min(1, maxW / Math.max(sw, 1));
  return { sx, sy, sw, sh, dw: Math.max(2, Math.round(sw * k)), dh: Math.max(2, Math.round(sh * k)) };
}

/**
 * Decide what the detector looks at this frame: the followed crop normally, but the whole frame now and then (to
 * find a second hand or a new user entering) and whenever nothing is being tracked.
 */
export class RoiPlanner {
  constructor({ scanEvery = 20, lostAfter = 0.6, aspect = 16 / 9 } = {}) {
    Object.assign(this, { scanEvery, lostAfter, aspect });
    this.reset();
  }

  reset() { this.roi = { ...FULL }; this.frames = 0; this.lastSeen = -Infinity; this.full = true; }

  /** hands: tracked hands from the previous frame (may be empty). Returns the crop to use now. */
  plan(hands, now) {
    this.frames++;
    if (hands.length) this.lastSeen = now;
    const lost = now - this.lastSeen > this.lostAfter;
    const scan = this.frames % this.scanEvery === 0;
    if (lost || scan || !hands.length) {
      this.full = true;
      if (lost) this.roi = { ...FULL };
      return { ...FULL };
    }
    this.full = false;
    this.roi = easeRoi(this.roi, followRoi(hands, { aspect: this.aspect }));
    return this.roi;
  }
}
