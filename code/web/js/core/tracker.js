// Stable hand tracking on top of MediaPipe's raw detections.
//
// Raw detections glitch in predictable ways, and each one used to leak straight into the app:
//   * the left/right label of a hand flips from frame to frame          -> identity is kept by POSITION, labels only vote
//   * one real hand is reported twice (opposite labels)                 -> duplicates are removed
//   * a false hand appears for a frame or two                           -> a new hand must persist before it is accepted
//   * a hand is missed for a few frames                                 -> the last reading is held for a short grace period
//   * two hands cross and their labels swap                             -> each hand keeps its role while it is tracked
// The roles are 'main' (the drawing hand) and 'second' (the navigation hand).
import { HandTrack } from './track.js';
import { LM, dist } from './gestures.js';
import { dedupeDetections, compatible, palmOf } from './select.js';

const opp = (h) => (h === 'Left' ? 'Right' : 'Left');
const VOTES = 10;

function vote(slot, label) {
  if (!label) return;
  slot.votes.push(label);
  if (slot.votes.length > VOTES) slot.votes.shift();
}

function stableLabel(slot) {
  const n = slot.votes.length;
  if (!n) return { label: '', share: 0, n };
  const left = slot.votes.filter((v) => v === 'Left').length;
  const label = left * 2 >= n ? 'Left' : 'Right';
  return { label, share: Math.max(left, n - left) / n, n };
}

export class HandTracker {
  constructor(opts = {}) {
    this.cfg = {
      minPalm: 0.035, // smallest palm (image-height fraction) still treated as a hand
      dominant: 'Right', // which physical hand is the drawing hand
      appearFrames: 3, // a new hand must be seen in this many frames before it is believed
      pendingGap: 0.15, // s a not-yet-believed hand may be missed without losing its count (blurry frames flicker)
      vanishGrace: 0.35, // seconds a missing hand is held before it is released
      matchRadius: 3.5, // a detection within this many palms of a tracked hand is that hand
      minSecondScore: 0.5, // handedness confidence required of a second hand
      forearm: null, // a Forearm (core/forearm.js): the wrist/elbow seen by the pose model, a second opinion about where hands are
      armGrace: 0.7, // seconds a missing hand is held when a wrist is still there
      aspect: 16 / 9,
      ...opts,
    };
    this.pool = [new HandTrack(), new HandTrack()];
    this.reset();
  }

  setOptions(o = {}) {
    const { trackOpts, ...rest } = o;
    Object.assign(this.cfg, rest);
    if (trackOpts) for (const t of this.pool) t.apply(trackOpts);
  }

  reset() {
    this.slots = { main: null, second: null };
    this.pending = [];
    this.pool.forEach((t) => t.reset());
    this.stats = { frames: 0, seen: 0, ghosts: 0, tooSmall: 0, blips: 0, held: 0, released: 0, flipsIgnored: 0, swaps: 0, promoted: 0, lowScore: 0, armBridged: 0, armBoost: 0 };
  }

  /** The arm (if any) whose wrist is where a hand was or is. */
  _arm(wrist, palm, t, aspect) {
    const f = this.cfg.forearm;
    return f ? f.support(wrist, t, aspect, Math.max(0.12, 4 * palm)) : null;
  }

  get active() { return ['main', 'second'].filter((r) => this.slots[r]); }

  _freeTrack() {
    const used = new Set(Object.values(this.slots).filter(Boolean).map((s) => s.track));
    return this.pool.find((t) => !used.has(t));
  }

  /**
   * dets: [{ side: 'Left'|'Right' (the user's own side), score, lm, world? }]. Returns { main, second }, each null or
   * { reading, lm, held, label } (held = the hand was missed this frame and the last reading is being bridged).
   */
  update(dets, t, aspect = this.cfg.aspect) {
    const cfg = this.cfg;
    const st = this.stats;
    st.frames++;
    st.seen += dets.length;
    dets.forEach((d) => { d._palm = palmOf(d, aspect); });

    // 1. one hand reported twice is still one hand
    const kept = dedupeDetections(dets, aspect).map((i) => dets[i]);
    st.ghosts += dets.length - kept.length;
    const cand = kept.filter((d) => (d._palm >= cfg.minPalm ? true : (st.tooSmall++, false)));

    // 2. continuity: each tracked hand claims the nearest detection to where it was
    const claimed = new Set();
    const matched = { main: null, second: null };
    const pairs = [];
    for (const role of ['main', 'second']) {
      const s = this.slots[role];
      if (!s) continue;
      cand.forEach((d) => {
        const dd = dist(d.lm[LM.WRIST], s.wrist, aspect);
        if (dd <= Math.max(0.10, cfg.matchRadius * s.palm)) pairs.push({ role, d, dd });
      });
    }
    pairs.sort((a, b) => a.dd - b.dd);
    for (const p of pairs) {
      if (matched[p.role] || claimed.has(p.d)) continue;
      matched[p.role] = p.d;
      claimed.add(p.d);
    }

    // 3. everything unclaimed is a possible NEW hand: it has to persist before it is believed
    // A real hand in a blurred or badly lit picture is detected in most frames, not all: one that is missed for a
    // moment keeps its count, so it still gets in. A false hand rarely lasts long enough either way.
    const fresh = cand.filter((d) => !claimed.has(d));
    const nextPending = [];
    const hitPending = new Set();
    for (const d of fresh) {
      const w = d.lm[LM.WRIST];
      const hit = this.pending.find((p) => !hitPending.has(p) && dist(w, p.wrist, aspect) <= Math.max(0.08, 2 * d._palm));
      if (hit) hitPending.add(hit);
      nextPending.push({ wrist: w, det: d, frames: hit ? hit.frames + 1 : 1, lastT: t });
    }
    for (const p of this.pending) {
      if (hitPending.has(p)) continue;
      if (t - p.lastT <= cfg.pendingGap) nextPending.push(p);
      else if (p.frames < cfg.appearFrames) st.blips++;
    }
    this.pending = nextPending;

    // 4. update the hands we are tracking
    for (const role of ['main', 'second']) {
      const s = this.slots[role];
      if (!s) continue;
      const d = matched[role];
      const arm = d ? null : this._arm(s.wrist, s.palm, t, aspect); // a wrist still there although the hand was missed
      if (d) {
        if (s.label && d.side !== s.label) st.flipsIgnored++;
        vote(s, d.side);
        s.label = stableLabel(s).label;
        s.det = d;
        s.wrist = { x: d.lm[LM.WRIST].x, y: d.lm[LM.WRIST].y };
        s.palm = d._palm;
        s.lastSeen = t;
        s.held = false;
        s.reading = s.track.step(d.lm, t, s.label, d.world);
        s.lm = d.lm;
      } else if (t - s.lastSeen <= (arm ? cfg.armGrace : cfg.vanishGrace)) {
        s.held = true; // missed this frame: keep the last reading so a stroke is not cut short
        st.held++;
        if (arm) { s.wrist = { x: arm.wrist.x, y: arm.wrist.y }; st.armBridged++; } // follow the arm, so the hand is re-found where it went
      } else {
        s.track.reset();
        this.slots[role] = null;
        st.released++;
      }
    }

    // 5. accept new hands that have persisted
    const need = (p) => (this._arm(p.wrist, p.det._palm, t, aspect) ? Math.max(2, cfg.appearFrames - 1) : cfg.appearFrames);
    for (const p of this.pending.filter((q) => q.lastT === t && q.frames >= need(q)).sort((a, b) => b.det._palm - a.det._palm)) {
      if (p.frames < cfg.appearFrames) st.armBoost++;
      const free = ['main', 'second'].filter((r) => !this.slots[r]);
      if (!free.length) break;
      const others = this.active.map((r) => this.slots[r].det);
      if (others.length && !others.every((o) => compatible(o, p.det, aspect))) continue; // a bystander, not the user's other hand
      if (others.length && p.det.score !== undefined && p.det.score < cfg.minSecondScore) { st.lowScore++; continue; }
      const role = free[0];
      const track = this._freeTrack();
      if (!track) break;
      track.reset();
      const slot = { track, det: p.det, wrist: { x: p.det.lm[LM.WRIST].x, y: p.det.lm[LM.WRIST].y }, palm: p.det._palm, lastSeen: t, held: false, votes: [], label: p.det.side, reading: null, lm: p.det.lm };
      vote(slot, p.det.side);
      slot.reading = track.step(p.det.lm, t, slot.label, p.det.world);
      this.slots[role] = slot;
      st.promoted++;
      this.pending = this.pending.filter((q) => q !== p);
    }

    // 6. a lone hand is always the drawing hand
    if (!this.slots.main && this.slots.second) { this.slots.main = this.slots.second; this.slots.second = null; }

    // 7. both hands are tracked: make sure the drawing hand really is the user's chosen hand (only when nothing is happening)
    const { main, second } = this.slots;
    if (main && second) {
      const a = stableLabel(main), b = stableLabel(second);
      const idle = (s) => s.reading && !s.reading.pinch && !s.reading.grab && !s.reading.fist && !s.reading.peace;
      if (a.n >= 6 && b.n >= 6 && a.share >= 0.75 && b.share >= 0.75
        && a.label === opp(cfg.dominant) && b.label === cfg.dominant && idle(main) && idle(second)) {
        this.slots.main = second;
        this.slots.second = main;
        st.swaps++;
      }
    }

    const out = (s) => (s && s.reading ? { reading: s.reading, lm: s.lm, held: s.held, label: s.label } : null);
    return { main: out(this.slots.main), second: out(this.slots.second) };
  }
}
