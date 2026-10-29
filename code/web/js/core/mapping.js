// Camera-image position -> screen position, normalised so the same physical movement feels the same
// everywhere: equal speed horizontally and vertically, and independent of how far the hand is from the camera.

/**
 * Adjust a reach region so 1 cm of hand travel moves the cursor equally far on both axes.
 * Region = fractions of the camera image, whose width and height differ in pixels; the screen has its own aspect.
 * Grows the short axis when it fits inside the image, otherwise shrinks the long one.
 */
export function isotropicRegion([x0, y0, x1, y1], camAspect, screenAspect) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let ex = x1 - x0;
  let ey = y1 - y0;
  const rw = ex * camAspect;
  const rh = ey;
  if (rw / rh > screenAspect) {
    const want = rw / screenAspect;
    if (want <= 1) ey = want;
    else ex = (rh * screenAspect) / camAspect;
  } else {
    const want = (rh * screenAspect) / camAspect;
    if (want <= 1) ex = want;
    else ey = rw / screenAspect;
  }
  const nx0 = Math.min(Math.max(cx - ex / 2, 0), 1 - ex);
  const ny0 = Math.min(Math.max(cy - ey / 2, 0), 1 - ey);
  return [nx0, ny0, nx0 + ex, ny0 + ey];
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

export class Mapper {
  constructor({ region = [0.12, 0.10, 0.88, 0.80], camAspect = 16 / 9, width = 1280, height = 720, palmRef = 0 } = {}) {
    Object.assign(this, { region, camAspect, width, height, palmRef });
    this._iso = null;
  }

  set(opts) {
    Object.assign(this, opts);
    this._iso = null;
  }

  /** Use a calibrated reach area, or the preset for the chosen range when there is none. */
  useRegion(region) { this.set({ region: region.slice() }); }

  get iso() {
    if (!this._iso) this._iso = isotropicRegion(this.region, this.camAspect, this.width / this.height);
    return this._iso;
  }

  /** cur = [x, y] image fractions (mirrored). palm = palm size, for distance normalisation. */
  map(cur, palm = 0) {
    const [x0, y0, x1, y1] = this.iso;
    let k = 1;
    if (this.palmRef > 0 && palm > 0) k = clamp(this.palmRef / palm, 0.6, 1.6); // a closer hand covers more image
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const u = clamp(0.5 + ((cur[0] - cx) * k) / (x1 - x0), 0, 1);
    const v = clamp(0.5 + ((cur[1] - cy) * k) / (y1 - y0), 0, 1);
    return { x: u * this.width, y: v * this.height };
  }
}
