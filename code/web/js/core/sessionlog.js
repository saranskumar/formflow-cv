// A record of how hand detection went, to tune the thresholds from real sessions instead of guessing.
//
// frame(t, seen) is called for every camera frame the detector ran on (seen = a hand is tracked). Once a second the
// counters are closed into one sample together with the latest measurements given to note(). Nothing leaves the browser:
// the log is only written to a file when the user presses Save log in the diagnostics panel.

export const MAX_SAMPLES = 3600; // one hour at one sample per second

export class SessionLog {
  constructor(now = () => Date.now()) {
    this.clock = now;
    this.reset();
  }

  reset() {
    this.started = new Date(this.clock()).toISOString();
    this.samples = [];
    this.events = [];
    this.meta = {};
    this._note = {};
    this._frames = 0;
    this._seen = 0;
    this._t0 = null;
    this._gap = 0;       // seconds the current run without a hand has lasted
    this._longestGap = 0;
    this._lastFrame = null;
  }

  /** Static facts (camera name, resolution, delegate, user agent). */
  setMeta(meta) { Object.assign(this.meta, meta); }

  /** The latest measurements; they are copied into the next sample. */
  note(fields) { Object.assign(this._note, fields); }

  /** A condition appeared or went away. */
  event(t, name, on) { this.events.push({ t: +t.toFixed(2), name, on }); }

  /** One detector frame at time t (seconds). */
  frame(t, seen) {
    if (this._t0 === null) this._t0 = t;
    if (this._lastFrame !== null) {
      const dt = t - this._lastFrame;
      if (seen) this._gap = 0; else this._gap += dt;
      this._longestGap = Math.max(this._longestGap, this._gap);
    }
    this._lastFrame = t;
    this._frames++;
    if (seen) this._seen++;
    if (t - this._t0 >= 1) {
      this.samples.push({ t: +t.toFixed(2), frames: this._frames, tracked: this._seen, ...this._note });
      if (this.samples.length > MAX_SAMPLES) this.samples.shift();
      this._t0 = t; this._frames = 0; this._seen = 0;
    }
  }

  /** Fraction of frames with a tracked hand over the last `seconds` samples (1 sample = 1 s), or null with no data. */
  rate(seconds = 3) {
    const s = this.samples.slice(-seconds);
    const f = s.reduce((a, x) => a + x.frames, 0);
    return f ? s.reduce((a, x) => a + x.tracked, 0) / f : null;
  }

  summary() {
    const s = this.samples;
    const frames = s.reduce((a, x) => a + x.frames, 0), tracked = s.reduce((a, x) => a + x.tracked, 0);
    const seconds = {};
    for (const x of s) for (const c of x.conditions || []) seconds[c] = (seconds[c] || 0) + 1;
    return {
      seconds: s.length,
      frames,
      trackedFraction: frames ? +(tracked / frames).toFixed(3) : null,
      meanFps: s.length ? +(frames / s.length).toFixed(1) : null,
      longestGapSeconds: +this._longestGap.toFixed(2),
      conditionSeconds: seconds,
    };
  }

  toJSON() {
    return { version: 1, started: this.started, meta: this.meta, summary: this.summary(), events: this.events, samples: this.samples };
  }
}
