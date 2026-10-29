// The onboarding "practice mode": the user must perform a valid pinch and a valid fist before entering the
// workspace, which proves the camera and hand tracking really work. While they do, we also measure their open
// and pinched finger spacing and turn it into personal pinch thresholds.

export const HOLD_S = 0.5; // a gesture must be held this long to count

export class PracticeSession {
  constructor() {
    this.done = { hand: false, pinch: false, grab: false, fist: false, peace: false };
    this.hold = { pinch: 0, grab: 0, fist: 0, peace: 0 };
    this.lastT = null;
    this.openRatios = [];
    this.pinchRatios = [];
    this.seenAt = null;
  }

  get ready() { return this.done.hand && this.done.pinch && this.done.fist; } // grab and peace are bonuses

  /** reading: a HandTrack reading of the main-or-only hand, or null when no hand is visible. */
  feed(reading, now) {
    const dt = this.lastT === null ? 0 : Math.min(now - this.lastT, 0.2);
    this.lastT = now;
    if (!reading) { for (const k of Object.keys(this.hold)) this.hold[k] = 0; this.seenAt = null; return; }
    if (this.seenAt === null) this.seenAt = now;
    if (now - this.seenAt > 0.3) this.done.hand = true;
    for (const k of Object.keys(this.hold)) {
      this.hold[k] = reading[k] ? this.hold[k] + dt : 0;
      if (this.hold[k] >= HOLD_S) this.done[k] = true;
    }
    const open = !reading.pinch && !reading.grab && !reading.fist && !reading.peace;
    if (open && this.openRatios.length < 300) this.openRatios.push(reading.rI);
    if (reading.pinch && this.pinchRatios.length < 300) this.pinchRatios.push(reading.rI);
  }

  progress(k) { return this.done[k] ? 1 : Math.min(this.hold[k] / HOLD_S, 1); }

  /** Personal thresholds from what the user showed us, or null if we did not see both poses. */
  calibration() {
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
    if (this.openRatios.length < 10 || this.pinchRatios.length < 5) return null;
    const open = med(this.openRatios), closed = med(this.pinchRatios);
    if (open < closed + 0.2) return null; // not enough separation to trust
    const on = closed + 0.30 * (open - closed);
    return { pinchOn: on, pinchOff: Math.max(on + 0.08, closed + 0.50 * (open - closed)) };
  }
}
