// User settings: which hand draws, how far the user stands from the camera, detection sensitivity, reach area.
// Presets exist because the typical setup differs a lot: a laptop webcam (hand large, close) versus a webcam
// across the room feeding a projector (hand small, far away).

export const DEFAULTS = {
  dominant: 'Right', // the hand that DRAWS (cyan). The other hand navigates (magenta).
  range: 'near', // near | medium | far | auto
  sensitivity: 'normal', // normal | high (small hands)
  region: null, // calibrated reach area [x0, y0, x1, y1] in image fractions, or null to use the range preset
  pinchOn: 0.30,
  pinchOff: 0.45,
  smoothing: 1.0,
  forearm: true, // also track the forearm (pose model) to keep hold of small or briefly lost hands
  light: true, // brighten the picture the detector sees when the hand is dark (backlight, dim room); see core/enhance.js
  askJoin: true, // after a freehand stroke, offer to close the loop / join it to a nearby line
};

export const RANGES = ['near', 'medium', 'far', 'auto'];

/**
 * What each range means for the pipeline.
 *  roi        crop of the camera image that is fed to the hand detector (square fractions keep the aspect ratio).
 *             null = follow the hands automatically.
 *  region     default reach area mapped onto the whole screen when the user has not calibrated one
 *  minPalm    smallest palm (fraction of image height) still treated as a hand
 *  detection  MediaPipe confidence thresholds
 */
export function rangeParams(range, sensitivity = 'normal') {
  const high = sensitivity === 'high';
  const base = {
    near: { roi: { x: 0, y: 0, w: 1, h: 1 }, region: [0.12, 0.10, 0.88, 0.80], minPalm: 0.028 },
    medium: { roi: { x: 0.15, y: 0.15, w: 0.7, h: 0.7 }, region: [0.30, 0.25, 0.70, 0.72], minPalm: 0.018 },
    far: { roi: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, region: [0.38, 0.32, 0.62, 0.68], minPalm: 0.010 },
    auto: { roi: null, region: [0.30, 0.25, 0.70, 0.72], minPalm: 0.010 },
  }[range] || null;
  if (!base) return rangeParams('near', sensitivity);
  // Moderate thresholds: strict ones (0.6+) drop a hand as soon as it is a little blurred or badly lit. A false hand
  // is still filtered out afterwards, because the tracker only believes a hand that persists for several frames.
  const detection = high || range === 'far' || range === 'auto'
    ? { detect: 0.3, presence: 0.3, track: 0.3 }
    : { detect: 0.45, presence: 0.4, track: 0.4 };
  return { ...base, detection };
}

export function normalizeSettings(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (s.dominant !== 'Left' && s.dominant !== 'Right') s.dominant = DEFAULTS.dominant;
  if (!RANGES.includes(s.range)) s.range = DEFAULTS.range;
  if (s.sensitivity !== 'normal' && s.sensitivity !== 'high') s.sensitivity = DEFAULTS.sensitivity;
  const r = s.region;
  if (!(Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[0] >= 0 && r[1] >= 0 && r[2] <= 1 && r[3] <= 1
    && r[2] - r[0] > 0.04 && r[3] - r[1] > 0.04)) s.region = null;
  for (const k of ['pinchOn', 'pinchOff', 'smoothing']) if (!Number.isFinite(s[k])) s[k] = DEFAULTS[k];
  if (s.pinchOff <= s.pinchOn) { s.pinchOn = DEFAULTS.pinchOn; s.pinchOff = DEFAULTS.pinchOff; }
  s.smoothing = Math.min(Math.max(s.smoothing, 0.2), 5);
  if (typeof s.forearm === 'string') s.forearm = s.forearm === 'true';
  if (typeof s.forearm !== 'boolean') s.forearm = DEFAULTS.forearm;
  if (typeof s.light === 'string') s.light = s.light === 'true';
  if (typeof s.light !== 'boolean') s.light = DEFAULTS.light;
  if (typeof s.askJoin === 'string') s.askJoin = s.askJoin === 'true'; // from a segmented control
  if (typeof s.askJoin !== 'boolean') s.askJoin = DEFAULTS.askJoin;
  return s;
}

/** The hand that navigates is always the other one. */
export const otherHand = (h) => (h === 'Left' ? 'Right' : 'Left');
export const swapDominant = (h) => otherHand(h);
