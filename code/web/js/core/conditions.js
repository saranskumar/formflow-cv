// Why is hand detection struggling? Cheap measurements of the camera picture are turned into a plain-language cause
// (too dark, light behind the user, blurry, slow camera, hand too small), shown as a hint, and used to steer the camera
// (core/camera.js). Pure logic: main.js supplies the measurements.
//
// A condition is only reported after it has held for HOLD_ON seconds and only cleared after it has been gone for HOLD_OFF
// seconds, so a passing shadow never flashes a warning. The thresholds are starting points, not calibrated numbers: tune
// them from the session log (core/sessionlog.js) recorded on the real camera.

export const HOLD_ON = 2;
export const HOLD_OFF = 3;
export const PRIORITY = ['backlight', 'lowLight', 'lowFps', 'blur', 'overexposed', 'far'];

export const HINTS = Object.freeze({
  backlight: ['Light behind you', 'A bright window or lamp is behind you. Face the light, close the blind, or move so it is not in the picture.'],
  lowLight: ['Too dark', 'Turn on a light in front of you. A dim room makes the camera slow and noisy.'],
  lowFps: ['Camera is slow', 'The camera is running below 20 frames per second, usually because the room is dim. Add light.'],
  blur: ['Picture is blurry', 'Move your hand a little slower, or add light so the camera can use a faster shutter.'],
  overexposed: ['Picture is washed out', 'Too much light on your hand. Move away from the lamp or window.'],
  far: ['Hand is small', 'Your hand is far from the camera. Move closer or set Distance to Far.'],
});

/**
 * Which conditions the measurements show right now (before any holding). All fields are optional.
 *   mean      brightness of the whole picture, 0..1
 *   clip      fraction of the picture that is pure white
 *   subject   brightness (0..1) of the hand, or while searching of the darker part of where hands usually are
 *   fps       frames per second the camera really delivers
 *   sharp     sharpness relative to this camera's recent best (1 = as sharp as ever seen), measured on the hand
 *   palm      tracked hand's palm size in image-height fractions
 */
export function classify({ mean, clip = 0, subject, fps, sharp, palm } = {}) {
  const out = [];
  const ratio = mean > 0 && subject != null ? subject / mean : null;
  if (mean != null && ratio != null && ((clip > 0.06 && ratio < 0.65) || (mean > 0.45 && ratio < 0.5))) out.push('backlight');
  else if (mean != null && mean < 0.2) out.push('lowLight');
  if (fps != null && fps > 0 && fps < 20) out.push('lowFps');
  if (sharp != null && sharp < 0.4) out.push('blur');
  if (subject != null && subject > 0.82 && clip > 0.1) out.push('overexposed');
  if (palm != null && palm > 0 && palm < 0.04) out.push('far');
  return out;
}

export class ConditionMonitor {
  constructor({ holdOn = HOLD_ON, holdOff = HOLD_OFF } = {}) {
    this.holdOn = holdOn;
    this.holdOff = holdOff;
    this.reset();
  }

  reset() {
    this.active = new Set();
    this.since = new Map(); // condition -> time it started holding / time it stopped
    this.last = [];
    this.events = []; // { t, condition, on }
  }

  /** The condition worth telling the user about (the most important of those active), or null. */
  get primary() { return PRIORITY.find((c) => this.active.has(c)) || null; }

  /** Feed one set of measurements at time t (seconds). Returns the conditions that switched on ('on') and off ('off'). */
  feed(sample, t) {
    const raw = new Set(classify(sample));
    this.last = [...raw];
    const change = { on: [], off: [] };
    for (const c of PRIORITY) {
      const holding = raw.has(c), isOn = this.active.has(c);
      if (holding === isOn) { this.since.delete(c); continue; }
      if (!this.since.has(c)) this.since.set(c, t);
      if (t - this.since.get(c) >= (holding ? this.holdOn : this.holdOff)) {
        if (holding) { this.active.add(c); change.on.push(c); } else { this.active.delete(c); change.off.push(c); }
        this.since.delete(c);
        this.events.push({ t, condition: c, on: holding });
      }
    }
    return change;
  }
}

/** Variance of the Laplacian of the brightness inside box (image fractions): high = sharp edges, low = blurred. */
export function laplacianVariance({ data, w, h }, box = [0, 0, 1, 1]) {
  const x0 = Math.max(1, Math.floor(box[0] * w)), x1 = Math.min(w - 1, Math.ceil(box[2] * w));
  const y0 = Math.max(1, Math.floor(box[1] * h)), y1 = Math.min(h - 1, Math.ceil(box[3] * h));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;
  const l = (x, y) => { const i = (y * w + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  let n = 0, s = 0, s2 = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const v = 4 * l(x, y) - l(x - 1, y) - l(x + 1, y) - l(x, y - 1) - l(x, y + 1);
    s += v; s2 += v * v; n++;
  }
  const mean = s / n;
  return s2 / n - mean * mean;
}

/**
 * Turns raw Laplacian variances into "how sharp compared with this camera's best lately" (0..1+). The reference is the
 * recent maximum, decaying slowly so a change of room or lighting is eventually forgotten. A single number is not
 * comparable between cameras or scenes, which is why the ratio is used.
 */
export class SharpnessTracker {
  constructor(decay = 0.995) { this.decay = decay; this.ref = 0; }
  reset() { this.ref = 0; }
  ratio(v) {
    if (v == null || !(v > 0)) return null;
    this.ref = Math.max(v, this.ref * this.decay);
    return v / this.ref;
  }
}
