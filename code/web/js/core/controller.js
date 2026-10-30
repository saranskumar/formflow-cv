// Gesture state machine: turns hand (or mouse) frames into sketch actions.
//
//   Main hand    pinch (thumb+index) + drag  -> draw / size and place a shape / press a HUD button
//                grab  (thumb+middle)        -> pick up and move the nearest object
//   Second hand  fist + move                 -> orbit (with inertia)
//                peace sign + move           -> pan
//   Both hands   pinch together, closer/apart -> zoom
//
// A frame is { main, second } where each hand is null or
//   { x, y, cx, cy, pinch, grab, fist, peace, source }   (x,y = cursor, cx,cy = steady palm centre, screen pixels)
// The mouse produces the same frame: left=pinch, shift+left=grab, right=fist, middle=peace.
import { clamp } from './vec.js';

export const FREEZE_AFTER_RELEASE = 0.3; // s: input ignored after a hand release, so jitter cannot disturb the result
export const TRIM_DRAW = 0.10;
export const TRIM_DRAG = 0.15;
export const DWELL_S = 0.8;     // s: point at a button this long and it is pressed
export const HOLD_DRAW_S = 0.22; // s: a pinch is held this long before a stroke or shape starts; a quicker pinch is a click
export const DWELL_GRACE = 0.2; // s: the fingertip may stray off the button this long without starting over

export class Controller {
  /**
   * sketch: Sketch;  getRect(): {x,y,w,h};
   * ui: { hit(x, y) -> element|null, press(el) }  (the HUD; hit() is null over the open 3D scene)
   */
  constructor({ sketch, getRect, ui = { hit: () => null, press() {} }, onCommit = null }) {
    this.onCommit = onCommit; // (item) => void: called when a gesture creates a new item
    this.sketch = sketch;
    this.getRect = getRect;
    this.ui = ui;
    this.reset();
  }

  reset() {
    this.gesture = null; // 'pinch' | 'grab' | null: what the main hand is currently doing in the scene
    this.consumed = false; // the current pinch was used to press a HUD button
    this.freezeUntil = 0;
    this.twoNav = null;
    this.nav = { kind: null, last: null }; // orbit / pan source tracking
    this.prev = { pinch: false, grab: false };
    this.events = []; // human-readable log of what happened, for the status line
    this.hold = { t0: null, x: 0, y: 0, progress: 0 }; // a pinch in the scene that may turn into a stroke (hold) or a click (tap)
    this.scroll = null; // a pinch that started on a panel and is dragging it
    this.dwell = { el: null, t0: 0, lastOn: -Infinity, fired: false, progress: 0 }; // point-and-hold on a button
  }

  get drawing() { return this.gesture !== null; }

  _trim(main) {
    if (main.source !== 'hand') return 0;
    return ['move', 'scale', 'extrude', 'cut'].includes(this.sketch.mode) ? TRIM_DRAG : TRIM_DRAW;
  }

  _finish(main, now) {
    const item = this.sketch.end({ trim: this._trim(main), now });
    this.gesture = null;
    if (item && this.onCommit) this.onCommit(item);
    if (main.source === 'hand') this.freezeUntil = now + FREEZE_AFTER_RELEASE;
  }

  /**
   * Point-and-hold: with the index finger out (and not pinching), a button the fingertip rests on is pressed after DWELL_S.
   * It fires once; moving to another button, or lifting the finger away, arms it again. dwell.progress (0..1) drives the ring
   * the app draws, so the user sees it coming and can move away to cancel.
   */
  _dwell(main, grasp, now, frozen) {
    const d = this.dwell;
    const el = main && main.point && !grasp && !frozen ? this.ui.hit(main.x, main.y) : null;
    const btn = el && el.tagName === 'BUTTON' && !el.disabled ? el : null;
    if (btn) {
      d.lastOn = now;
      if (d.el !== btn) { d.el = btn; d.t0 = now; d.fired = false; }
      d.progress = d.fired ? 1 : clamp((now - d.t0) / DWELL_S, 0, 1);
      if (!d.fired && d.progress >= 1) { d.fired = true; this.ui.press(btn); }
    } else if (now - d.lastOn > DWELL_GRACE) {
      d.el = null; d.progress = 0; d.fired = false;
    }
  }

  update(frame, now) {
    const s = this.sketch;
    const rect = this.getRect();
    const main = frame.main;
    const second = frame.second;

    // ---- both hands pinched: zoom -------------------------------------------------------
    if (main && second && main.pinch && second.pinch && main.source === 'hand') {
      const d = Math.hypot(main.x - second.x, main.y - second.y);
      if (!this.twoNav) {
        if (s.busy) { s.cancel(); this.gesture = null; } // a stray single-hand gesture gives way to navigation
        this.twoNav = { d0: Math.max(d, 40), dist0: s.dist };
      } else {
        const target = clamp((this.twoNav.dist0 * this.twoNav.d0) / Math.max(d, 40), 2.2, 9.0);
        s.setDist(s.dist + 0.35 * (target - s.dist)); // eased: no jumps
      }
      this.prev = { pinch: true, grab: false };
      return;
    }
    if (this.twoNav) { this.twoNav = null; this.freezeUntil = now + FREEZE_AFTER_RELEASE; }

    // ---- navigation: the second hand (or the main hand / mouse buttons when alone) -------
    const navHand = second && (second.fist || second.peace) ? second : main && (main.fist || main.peace) ? main : null;
    let navigating = false;
    if (navHand) {
      const kind = navHand.fist ? 'orbit' : 'pan';
      if (this.gesture && navHand === main) this._finish(main, now);
      if (this.nav.kind !== kind) { // pose changed: don't let the first frame jump
        if (this.nav.kind === 'orbit') s.releaseOrbit(now);
        this.nav = { kind, last: null };
      }
      if (this.nav.last) {
        const dx = navHand.cx - this.nav.last[0], dy = navHand.cy - this.nav.last[1];
        if (kind === 'orbit') s.orbit(dx, dy, now);
        else if (Math.hypot(dx, dy) >= 1.0) s.pan(dx, dy, rect); // tremor under 1 px does not move the view
      }
      this.nav.last = [navHand.cx, navHand.cy];
      navigating = true;
    } else if (this.nav.kind) {
      if (this.nav.kind === 'orbit') s.releaseOrbit(now);
      this.nav = { kind: null, last: null };
    }
    if (!navigating) s.coast(now);
    if (navHand && navHand === main) return; // the main hand is busy navigating (single-hand / mouse fallback)

    if (!main) {
      this._dwell(null, null, now, false);
      this.hold = { t0: null, x: 0, y: 0, progress: 0 }; this.scroll = null;
      if (this.gesture) { this.gesture = null; s.cancel(); }
      this.prev = { pinch: false, grab: false };
      return;
    }

    // ---- main hand: HUD press, draw, grab ------------------------------------------------
    const frozen = now < this.freezeUntil;
    const grasp = main.pinch ? 'pinch' : main.grab ? 'grab' : null;
    const onHud = !!this.ui.hit(main.x, main.y);
    const risingPinch = main.pinch && !this.prev.pinch;

    const isHand = main.source === 'hand';
    if (risingPinch && onHud && !frozen) {
      const el = this.ui.hit(main.x, main.y);
      if (el && el.tagName && el.tagName !== 'BUTTON' && this.ui.scrollBy) this.scroll = { y: main.y }; // a pinch on the panel itself: drag to scroll it
      else this.ui.press(el); // a pinch on a button is a click
      this.consumed = true;
    }
    if (this.scroll && main.pinch) { const dy = this.scroll.y - main.y; this.scroll.y = main.y; if (dy) this.ui.scrollBy(main.x, main.y, dy); }
    if (!main.pinch) { this.consumed = false; this.scroll = null; }
    this._dwell(main, grasp, now, frozen);

    if (!this.gesture) {
      if (grasp === 'pinch' && isHand && !frozen && !this.consumed && !onHud) {
        // pinch and hold to draw: the stroke (or shape) starts once the pinch has been held a moment, from where it began
        if (this.hold.t0 === null && grasp !== this.prevGrasp) this.hold = { t0: now, x: main.x, y: main.y, progress: 0 };
        if (this.hold.t0 !== null) {
          this.hold.progress = clamp((now - this.hold.t0) / HOLD_DRAW_S, 0, 1);
          if (this.hold.progress >= 1) {
            const { x, y } = this.hold;
            this.hold = { t0: null, x: 0, y: 0, progress: 0 };
            if (s.begin(x, y, rect, now, s.tool)) { this.gesture = 'pinch'; s.add(main.x, main.y, rect, now); }
          }
        }
      } else {
        if (this.hold.t0 !== null) { // the pinch ended (or moved onto a button) before it was held long enough
          if (!main.pinch && !grasp && !frozen) s.click(this.hold.x, this.hold.y, rect); // a quick pinch in the scene = a click: select what is there
          this.hold = { t0: null, x: 0, y: 0, progress: 0 };
        }
        if (grasp && !frozen && !this.consumed && !onHud && (grasp !== this.prevGrasp)) {
          const mode = grasp === 'grab' ? 'move' : s.tool; // grab (thumb + middle) and a mouse press start at once
          if (s.begin(main.x, main.y, rect, now, mode)) this.gesture = grasp;
        } else if (!grasp && !frozen) {
          s.hover(main.x, main.y, rect, false);
        }
      }
    } else if (grasp === this.gesture && !onHud) {
      s.add(main.x, main.y, rect, now);
    } else {
      this._finish(main, now);
    }
    this.prevGrasp = grasp;
    this.prev = { pinch: main.pinch, grab: main.grab };
  }
}
