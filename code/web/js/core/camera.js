// Camera set-up and exposure help for hand detection.
//
// Webcams meter the whole picture. With light behind the user the camera exposes for the window and the hand goes dark;
// in a dim room it slows down to 10-15 fps with long exposures, which blurs a moving hand. Chrome exposes the camera's own
// controls (exposure compensation, exposure/white-balance/focus mode) as track constraints, but only the ones the driver
// supports, so every control is checked against track.getCapabilities() and applied on its own: one unsupported control
// never blocks the others. Raising the camera's exposure is better than brightening afterwards (core/enhance.js), because
// the sensor then collects more light instead of amplifying noise; the two work together.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Video constraints to try in order. The first adds a 24 fps floor (less motion blur); the later ones are fallbacks. */
export const VIDEO_REQUESTS = Object.freeze([
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 24 }, facingMode: 'user' },
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, min: 15 }, facingMode: 'user' },
  { facingMode: 'user' },
  true,
]);

/** Open the camera with the first request the device accepts. Returns { stream, request } (request = index tried). */
export async function openCamera(mediaDevices = navigator.mediaDevices) {
  let err;
  for (let i = 0; i < VIDEO_REQUESTS.length; i++) {
    try { return { stream: await mediaDevices.getUserMedia({ video: VIDEO_REQUESTS[i], audio: false }), request: i }; }
    catch (e) {
      err = e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')) throw e; // no point retrying
    }
  }
  throw err;
}

/** Controls to set once at start: let the camera keep adapting, and switch off OS picture effects that blur or crop hands. */
export function baselinePlan(caps = {}) {
  const plan = [];
  for (const k of ['exposureMode', 'whiteBalanceMode', 'focusMode']) if (Array.isArray(caps[k]) && caps[k].includes('continuous')) plan.push({ [k]: 'continuous' });
  for (const k of ['backgroundBlur', 'faceFraming', 'eyeGazeCorrection']) if (Array.isArray(caps[k]) && caps[k].includes(false)) plan.push({ [k]: false });
  return plan;
}

export const COMP_STEP = 0.5; // EV per adjustment
export const COMP_MAX = 2;    // never ask for more than +2 EV
export const COMP_EVERY = 3;  // seconds between adjustments, so the camera's own control loop can settle

/**
 * The next exposure compensation (EV) for a condition, or null to leave it. Light behind the user or a dark room step it up;
 * a washed-out hand steps it down. Without a problem it stays where it is (stepping back would make it oscillate).
 */
export function nextCompensation(cap, current, condition) {
  if (!cap || typeof cap.min !== 'number' || typeof cap.max !== 'number') return null;
  const lo = cap.min, hi = Math.min(cap.max, COMP_MAX);
  const step = Math.max(cap.step || COMP_STEP, COMP_STEP);
  let want = current;
  if (condition === 'backlight' || condition === 'lowLight') want = current + step;
  else if (condition === 'overexposed') want = current - step;
  else return null;
  want = clamp(Math.round(want / (cap.step || step)) * (cap.step || step), Math.min(lo, 0), Math.max(hi, 0));
  return Math.abs(want - current) < 1e-6 ? null : want;
}

export class CameraAssist {
  constructor(track) {
    this.track = track;
    this.caps = {};
    try { this.caps = (track && track.getCapabilities && track.getCapabilities()) || {}; } catch { this.caps = {}; }
    this.applied = {};    // control -> value that was accepted
    this.rejected = [];   // controls the camera refused
    this.comp = 0;        // exposure compensation currently asked for
    this.lastAdjust = -Infinity;
  }

  async _set(k, v) {
    try { await this.track.applyConstraints({ advanced: [{ [k]: v }] }); this.applied[k] = v; return true; }
    catch { if (!this.rejected.includes(k)) this.rejected.push(k); return false; }
  }

  /** Set the baseline controls. */
  async start() {
    if (!this.track) return this;
    for (const c of baselinePlan(this.caps)) { const [k, v] = Object.entries(c)[0]; await this._set(k, v); }
    return this;
  }

  /** Called as conditions change (condition = ConditionMonitor.primary, t in seconds). Returns the new compensation or null. */
  async adapt(condition, t) {
    if (!this.track || t - this.lastAdjust < COMP_EVERY) return null;
    const want = nextCompensation(this.caps.exposureCompensation, this.comp, condition);
    if (want === null) return null;
    this.lastAdjust = t;
    // compensation only acts while the camera meters automatically
    if (Array.isArray(this.caps.exposureMode) && this.caps.exposureMode.includes('continuous') && this.applied.exposureMode !== 'continuous') await this._set('exposureMode', 'continuous');
    if (!(await this._set('exposureCompensation', want))) return null;
    this.comp = want;
    return want;
  }

  /** What the camera actually delivers, for the diagnostics and the session log. */
  status() {
    let s = {};
    try { s = (this.track && this.track.getSettings && this.track.getSettings()) || {}; } catch { s = {}; }
    return {
      width: s.width || 0, height: s.height || 0, frameRate: s.frameRate || 0,
      exposureMode: s.exposureMode || '', exposureCompensation: s.exposureCompensation ?? null,
      label: (this.track && this.track.label) || '',
      controls: Object.keys(this.caps).filter((k) => ['exposureMode', 'exposureCompensation', 'exposureTime', 'brightness', 'contrast', 'whiteBalanceMode', 'focusMode', 'backgroundBlur'].includes(k)),
      comp: this.comp, applied: { ...this.applied }, rejected: [...this.rejected],
    };
  }
}
