// Software exposure correction for the hand detector.
//
// A webcam meters the WHOLE picture. With a bright window or lamp behind the user it exposes for the background and the
// hand comes out as a dark, low-contrast shape; in a dim room the hand is dark and noisy. MediaPipe's palm detector then
// misses it, even though a person can still see the hand. We measure how bright the hand area really is (the tracked hand,
// or the middle of the picture while searching) and brighten the frame the detector sees until that area is mid-grey.
// The background may clip to white: that does not matter, the hand is what has to be visible.
//
// While no hand is found the brightness is varied frame to frame (normal, corrected, strong), so a hand that only one of
// them reveals is still picked up; the level that found it is then kept. Pure logic: the browser part only draws the
// video through a CSS filter (see filterCss).

export const TARGET = 0.45; // wanted median brightness (0..1) of the hand area
export const MAX_GAIN = 3.0;
export const SEARCH_AFTER = 0.8; // s without a hand before the brightness is varied to search for one
export const SEARCH_BOX = Object.freeze([0.15, 0.15, 0.85, 0.95]); // where hands usually are (image fractions, x0 y0 x1 y1)

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const lum = (d, i) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

/**
 * Brightness of a box of an RGBA image. box = [x0, y0, x1, y1] in image fractions.
 * Returns { median, p30, p90, mean } (0..1) of the box and the mean of the whole image, or null for an empty box.
 */
export function regionStats({ data, w, h }, box = [0, 0, 1, 1]) {
  const x0 = clamp(Math.floor(box[0] * w), 0, w - 1), x1 = clamp(Math.ceil(box[2] * w), x0 + 1, w);
  const y0 = clamp(Math.floor(box[1] * h), 0, h - 1), y1 = clamp(Math.ceil(box[3] * h), y0 + 1, h);
  const hist = new Uint32Array(64);
  let n = 0, sum = 0, all = 0, clipped = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = lum(data, (y * w + x) * 4);
    all += l;
    if (l > 0.97) clipped++;
    if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
    hist[Math.min(63, (l * 64) | 0)]++;
    sum += l; n++;
  }
  if (!n) return null;
  const pct = (q) => { let c = 0; for (let i = 0; i < 64; i++) { c += hist[i]; if (c >= q * n) return (i + 0.5) / 64; } return 1; };
  return { median: pct(0.5), p30: pct(0.3), p90: pct(0.9), mean: sum / n, global: all / (w * h), clip: clipped / (w * h) };
}

/** The correction for measured stats: { gain, contrast }. gain 1 = untouched. */
export function chooseCorrection(stats) {
  if (!stats) return { gain: 1, contrast: 1 };
  const m = Math.max(stats.median, 0.01);
  if (m < TARGET * 0.9) { // dark hand: backlight or a dim room
    const gain = clamp(TARGET / m, 1, MAX_GAIN);
    return { gain, contrast: 1 + 0.2 * clamp(gain - 1, 0, 1) }; // brightening flattens contrast; give a little back
  }
  if (stats.p90 > 0.97 && m > 0.7) return { gain: clamp(0.62 / m, 0.7, 1), contrast: 1.15 }; // washed-out hand (glare)
  return { gain: 1, contrast: 1 };
}

/** CSS canvas filter for a correction, or 'none' when it would do nothing. */
export function filterCss({ gain, contrast }) {
  if (Math.abs(gain - 1) < 0.04 && Math.abs(contrast - 1) < 0.02) return 'none';
  return `brightness(${gain.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
}

/** Bounding box (image fractions, unmirrored) around landmark sets, grown by `pad` palm sizes. */
export function handBox(hands, pad = 0.6) {
  if (!hands.length) return null;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const h of hands) {
    for (const p of h.lm) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const m = (h.palm || 0.05) * pad;
    x0 -= m; y0 -= m; x1 += m; y1 += m;
  }
  return [clamp(x0, 0, 1), clamp(y0, 0, 1), clamp(x1, 0, 1), clamp(y1, 0, 1)];
}

export class AutoExposure {
  constructor({ ease = 0.35 } = {}) {
    this.ease = ease;
    this.enabled = true;
    this.reset();
  }

  reset() {
    this.cur = { gain: 1, contrast: 1 }; // the correction used while a hand is tracked (or the measured one)
    this.lastHand = -Infinity;
    this.frame = 0;
    this.since = 0;
    this.variant = 'measured';
  }

  /**
   * Feed a fresh measurement (from regionStats). Eased, so the picture never flashes. onHand = the stats are of a
   * tracked hand's box; otherwise they are of the search area, where the user (darker than a bright window behind
   * them) is the darker part, so a lower percentile is metered.
   */
  measure(stats, onHand = true) {
    const want = chooseCorrection(stats && !onHand ? { ...stats, median: stats.p30 } : stats);
    this.cur = {
      gain: this.cur.gain + this.ease * (want.gain - this.cur.gain),
      contrast: this.cur.contrast + this.ease * (want.contrast - this.cur.contrast),
    };
  }

  get searching() { return this.since > SEARCH_AFTER; }

  /**
   * The correction to use for the next detector frame. handSeen = a hand is currently tracked; t = seconds.
   * Returns { gain, contrast, variant }.
   */
  next(handSeen, t) {
    this.frame++;
    if (!this.enabled) return { gain: 1, contrast: 1, variant: 'off' };
    if (handSeen) {
      this.lastHand = t;
      this.since = 0;
      this.variant = 'measured';
      return { ...this.cur, variant: 'measured' };
    }
    this.since = t - this.lastHand;
    if (this.since <= SEARCH_AFTER) { this.variant = 'measured'; return { ...this.cur, variant: 'measured' }; }
    // searching: cycle measured -> strong -> raw, so a hand only one of them shows is still found
    const strongGain = clamp(Math.max(this.cur.gain * 1.7, 2.2), 1, MAX_GAIN);
    const variants = [
      ['measured', this.cur],
      ['strong', { gain: strongGain, contrast: 1.2 }],
      ['raw', { gain: 1, contrast: 1 }],
    ];
    const [name, c] = variants[this.frame % variants.length];
    this.variant = name;
    return { ...c, variant: name };
  }

  /** A hand was found while searching with `variant`: start from that correction instead of re-measuring from scratch. */
  adopt(c) { this.cur = { gain: c.gain, contrast: c.contrast }; }
}
