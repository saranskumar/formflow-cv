// Where does a frame's time go, and what can be given up when it runs over?
//
// Everything happens on the one browser thread: hand detection, the arm model, the light correction, the 3D drawing and the
// buttons. A hand detection that takes 25 ms makes every frame at least 25 ms long, which feels laggy even though the
// tracking itself is right. FrameProfiler measures each stage; QualityGovernor lowers the cost step by step when frames run
// long (a lower drawing resolution first, then fewer detections and arm checks) and raises it again when there is room.
// Pure logic: main.js supplies the clock and applies the levels.

// detect / pose / light: ms per run of that stage; draw: ms the 3D drawing takes to submit; work: all the JavaScript of one frame
export const STAGES = ['detect', 'pose', 'light', 'draw', 'work'];

export class FrameProfiler {
  constructor({ alpha = 0.1, window = 2 } = {}) {
    this.alpha = alpha;
    this.window = window; // seconds the "worst" value is remembered
    this.reset();
  }

  reset() {
    this.avg = { frame: 0, ...Object.fromEntries(STAGES.map((s) => [s, 0])) };
    this.worst = 0;
    this._worstAt = 0;
    this.frames = 0;
    this.over = 0; // frames longer than 33 ms (a visible hitch) since the start
  }

  /** ms a stage took this time it ran (a stage that did not run this frame needs no call). */
  stage(name, ms) { this.avg[name] = this.avg[name] ? this.avg[name] + this.alpha * (ms - this.avg[name]) : ms; }

  /** The time since the previous frame, in ms, at time t (seconds). */
  frame(ms, t) {
    this.frames++;
    this.avg.frame = this.frames === 1 ? ms : this.avg.frame + this.alpha * (ms - this.avg.frame);
    if (ms > 33) this.over++;
    if (ms >= this.worst || t - this._worstAt > this.window) { this.worst = ms; this._worstAt = t; }
  }

  get fps() { return this.avg.frame > 0 ? 1000 / this.avg.frame : 0; }

  /** The stage that costs the most per run (what to blame), or null while there is no data. 'work' is the sum, so it is not a candidate. */
  get heaviest() {
    let best = null;
    for (const s of ['detect', 'pose', 'light', 'draw']) if (this.avg[s] > 0.5 && (!best || this.avg[s] > this.avg[best])) best = s;
    return best;
  }

  /**
   * Why frames are long. 'js': the page's own JavaScript is taking most of the frame (detection, drawing). 'gpu': the
   * JavaScript finishes quickly yet frames are slow, so the graphics card or the compositor (blurred panels, a large canvas,
   * a high-resolution screen) is the limit. 'ok': frames are fast.
   */
  get bound() {
    if (this.frames < 30 || this.avg.frame < 20) return 'ok';
    return this.avg.work > 0.6 * this.avg.frame ? 'js' : 'gpu';
  }
}

/**
 * Quality levels, 0 (everything) to MAX_LEVEL. What each level asks for is in `settings(level)`; the governor only decides
 * when to move. Down is quick (a laggy second is felt at once); up is slow, so it does not flip back and forth.
 */
export const MAX_LEVEL = 3;
export const SLOW_MS = 26;   // frames this long on average = under 40 fps
export const FAST_MS = 17.5; // frames this short = a full 60 fps with room to spare
export const DOWN_AFTER = 1.5; // seconds of slow frames before quality drops
export const UP_AFTER = 8;     // seconds of fast frames before it comes back

export function settings(level, dpr = 1) {
  return {
    pixelRatio: Math.min(dpr, level === 0 ? 2 : level === 1 ? 1.5 : 1),
    detectEvery: level >= 2 ? 2 : 1,   // run the hand detector on every n-th camera frame
    poseEvery: level >= 3 ? 9 : level >= 1 ? 6 : 3, // the arm model, for lost or small hands
  };
}

export class QualityGovernor {
  constructor({ level = 0, locked = false } = {}) {
    this.level = level;
    this.locked = locked; // a user choice: never change by itself
    this.since = null;    // when the current run of slow / fast frames began
    this.mode = null;     // 'slow' | 'fast'
  }

  /** Feed the average frame time (ms) at time t (s). Returns the new level when it changed, else null. */
  update(avgMs, t) {
    if (this.locked) return null;
    const mode = avgMs > SLOW_MS ? 'slow' : avgMs < FAST_MS ? 'fast' : null;
    if (mode !== this.mode) { this.mode = mode; this.since = t; return null; }
    if (!mode) return null;
    const need = mode === 'slow' ? DOWN_AFTER : UP_AFTER;
    if (t - this.since < need) return null;
    this.since = t;
    const next = mode === 'slow' ? Math.min(this.level + 1, MAX_LEVEL) : Math.max(this.level - 1, 0);
    if (next === this.level) return null;
    this.level = next;
    return next;
  }
}
