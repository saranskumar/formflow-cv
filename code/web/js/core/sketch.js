// The 3D sketch engine: orbit camera, "drawing on glass" plane, tools, picking and drag with an exact release commit.
// Pure logic (no Three.js, no DOM) so it is unit-tested in Node. The renderer reads this state every frame.
//
// World: X right, Y up, Z toward the viewer at yaw 0. Workspace = cube [-1, 1]^3, points clamped to +-1.2.
// The camera matches Three's PerspectiveCamera with fov = 2 atan(1 / (2 * 1.35)), so what the engine unprojects is
// exactly what the renderer draws.
import { add, sub, mul, dot, len, clamp, clampVec } from './vec.js';
import { Poly, Solid, buildItem, normalizePolyline } from './shapes.js';
import { PLANE_VIEWS } from './planes.js';
import { outlineRing, planeOf, facePlane, prismMesh, prismPreview } from './extrude.js';
import { cutMesh, prismBox, meshBox, boxesOverlap } from './csg.js';
import { ImportedMesh } from './imported.js';

export const LIMIT = 1.2;
export const SNAP_STEP = 0.1;
export const DEPTH_STEP = 0.2;
export const MAX_ORBIT_PX = 60;
export const ORBIT_DECAY = 0.25; // s
export const STROKE_SPACING = 0.03;
export const DEPTH_PER_PX = 0.005; // Extrude / Cut: world units of depth per pixel dragged up
export const MAX_DEPTH = 2.4;
export const MIN_DEPTH = 0.03;
export const CUT_RESOLUTION = 80; // grid cells along the longest side of a mesh being cut
export const CUT_LIFT = 0.05; // the cutter starts this far in front of the outline, so it opens through a face lying on it
export const FOCAL_PER_HEIGHT = 1.35;
export const FOV_DEG = (2 * Math.atan(1 / (2 * FOCAL_PER_HEIGHT)) * 180) / Math.PI;

/** Distance from (px, py) to the segment a-b, in screen pixels. */
function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

export class Sketch {
  constructor() {
    this.items = [];
    this.ops = []; // undo history: what each undoable thing did
    this.tool = 'free';
    this.joinHint = null; // [p, q]: a gap the user is being asked to close
    this.layout = null; // PlaneLayout while the 3-plane workspace is on: drawing happens in flat orthographic cells
    this.cellView = null; // the cell ('front' | 'side' | 'top') the current gesture started in
    this.photoDrag = null; // { active(view), move(view, du, dv) }: dragging in a cell whose photo is being adjusted moves the photo
    this.yaw = 0.55; this.pitch = 0.35; this.dist = 4.0;
    this.target = [0, 0, 0];
    this.depth = 0;
    this.snap = false;
    // smooth navigation (main.js turns it on): zoom, pan and view changes glide to where they are going instead of jumping
    this.smooth = false;
    this.zoomGoal = this.dist; this.panGoal = [0, 0, 0]; this.tw = null; this._gt = null;
    this.rotated = 0; this.undoCount = 0; this.moved = 0;
    this.hot = null; // item under the cursor
    this.selected = null; // the item last clicked (a quick pinch or a mouse click without drawing)
    this.onNote = null; // (text, kind) => void: told what an Extrude or Cut did (or why it did nothing)
    this.cursor = null; // last 3D cursor position
    this._resetGesture();
    this.vel = [0, 0]; this.orbitT = null; this.coasting = false; this.coastT = 0;
    this._bk = null; this._basis = null;
  }

  _resetGesture() {
    this.active = null; this.times = []; this.anchor = null; this.mode = this.tool;
    this.cursorHist = []; this.drag = null; this.dragLast = null; this.dragDepth = 0;
    this.dragY = 0; this.dragMoved = false; this.dragHist = [];
    this.cellView = null;
    this.imgDrag = null;
    this.op = null; // Extrude / Cut in progress: { kind, outline, plane, y0, depth, hist }
  }

  // ------------------------------------------------------------------ camera
  basis() {
    const key = `${this.yaw},${this.pitch},${this.dist},${this.target}`;
    if (this._bk === key) return this._basis;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const offset = [this.dist * cp * sy, this.dist * sp, this.dist * cp * cy];
    const fwd = mul(offset, -1 / this.dist);
    let right = [-fwd[2], 0, fwd[0]];
    right = mul(right, 1 / Math.hypot(right[0], right[2]));
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    this._bk = key;
    this._basis = { eye: add(this.target, offset), fwd, right, up };
    return this._basis;
  }

  focal(rect) { return rect.h * FOCAL_PER_HEIGHT; }

  /** world point -> {x, y, z} screen pixels and camera-space depth */
  project(p, rect) {
    const { eye, fwd, right, up } = this.basis();
    const v = sub(p, eye);
    const zc = Math.max(dot(v, fwd), 1e-3);
    const f = this.focal(rect);
    return { x: rect.x + rect.w / 2 + (f * dot(v, right)) / zc, y: rect.y + rect.h / 2 - (f * dot(v, up)) / zc, z: zc };
  }

  /** Point where the cursor ray meets the camera-facing plane at `depth`. */
  unproject(sx, sy, rect, depth) {
    const { eye, fwd, right, up } = this.basis();
    const zc = this.dist - depth;
    const f = this.focal(rect);
    const xc = ((sx - rect.x - rect.w / 2) * zc) / f;
    const yc = (-(sy - rect.y - rect.h / 2) * zc) / f;
    return add(add(add(eye, mul(right, xc)), mul(up, yc)), mul(fwd, zc));
  }

  // -------------------------------------------------------------------- view
  _rotate(dx, dy) {
    this.yaw -= dx * 0.009;
    this.pitch = clamp(this.pitch + dy * 0.009, -1.45, 1.45);
  }

  orbit(dx, dy, now) {
    this._stopTween();
    dx = clamp(dx, -MAX_ORBIT_PX, MAX_ORBIT_PX);
    dy = clamp(dy, -MAX_ORBIT_PX, MAX_ORBIT_PX);
    this._rotate(dx, dy);
    this.rotated += (Math.abs(dx) + Math.abs(dy)) * 0.009;
    if (this.orbitT !== null && now > this.orbitT) {
      const dt = Math.max(now - this.orbitT, 1e-3);
      this.vel = [0, 1].map((i) => 0.6 * this.vel[i] + 0.4 * clamp(([dx, dy][i]) / dt, -1500, 1500));
    }
    this.orbitT = now;
    this.coasting = false;
  }

  releaseOrbit(now) { // the fist opened: keep spinning, slowing down smoothly
    this.coasting = Math.hypot(...this.vel) > 60;
    this.coastT = now;
    this.orbitT = null;
  }

  coast(now) {
    if (!this.coasting) return;
    const dt = Math.min(Math.max(now - this.coastT, 0), 0.05);
    this.coastT = now;
    const k = Math.exp(-dt / ORBIT_DECAY);
    this.vel = [this.vel[0] * k, this.vel[1] * k];
    if (Math.hypot(...this.vel) < 20) { this.vel = [0, 0]; this.coasting = false; return; }
    this._rotate(this.vel[0] * dt, this.vel[1] * dt);
  }

  /** Slide the view by a hand/mouse delta in pixels: the scene follows the hand. */
  pan(dx, dy, rect) {
    const { right, up } = this.basis();
    const k = this.dist / this.focal(rect);
    this._stopTween();
    const next = clampVec(add(this.smooth ? this.panGoal : this.target, mul(add(mul(right, -dx), mul(up, dy)), k)), 2.5);
    this.panGoal = next;
    if (!this.smooth) this.target = next;
  }

  zoom(factor) {
    this._stopTween();
    const g = clamp((this.smooth ? this.zoomGoal : this.dist) * factor, 2.2, 9.0);
    this.zoomGoal = g;
    if (!this.smooth) this.dist = g;
  }

  /** Set the camera distance directly (the two-hand zoom eases it itself). */
  setDist(v) { this._stopTween(); this.dist = this.zoomGoal = v; }

  resetView() { this.moveView({ yaw: 0.55, pitch: 0.35, dist: 4.0, target: [0, 0, 0] }); }

  _stopTween() { if (this.tw) { this.tw = null; this.zoomGoal = this.dist; this.panGoal = this.target.slice(); } }

  /** Go to a camera position: at once, or (when smooth) by a short eased move that takes the shortest way round. */
  moveView(to) {
    if (!this.smooth) {
      Object.assign(this, { yaw: to.yaw, pitch: to.pitch, dist: to.dist, target: to.target.slice(), zoomGoal: to.dist, panGoal: to.target.slice() });
      this.tw = null;
      return;
    }
    const d = ((to.yaw - this.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    this.tw = { from: { yaw: this.yaw, pitch: this.pitch, dist: this.dist, target: this.target.slice() }, to: { ...to, yaw: this.yaw + d }, t0: null, dur: 0.45 };
  }

  /** Advance zoom, pan and view moves; call once per frame with the time in seconds. */
  glide(now) {
    const dt = this._gt === null ? 0 : clamp(now - this._gt, 0, 0.05);
    this._gt = now;
    if (this.tw) {
      const w = this.tw;
      if (w.t0 === null) w.t0 = now;
      const u = clamp((now - w.t0) / w.dur, 0, 1), e = u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
      const mixv = (a, b) => a + (b - a) * e;
      this.yaw = mixv(w.from.yaw, w.to.yaw); this.pitch = mixv(w.from.pitch, w.to.pitch); this.dist = mixv(w.from.dist, w.to.dist);
      this.target = w.from.target.map((v, i) => mixv(v, w.to.target[i]));
      if (u >= 1) { this.tw = null; this.zoomGoal = this.dist; this.panGoal = this.target.slice(); }
      return;
    }
    if (!this.smooth) return;
    const kz = 1 - Math.exp(-dt / 0.09), kp = 1 - Math.exp(-dt / 0.07);
    if (Math.abs(this.zoomGoal - this.dist) > 1e-4) this.dist += (this.zoomGoal - this.dist) * kz; else this.dist = this.zoomGoal;
    if (this.panGoal.some((v, i) => Math.abs(v - this.target[i]) > 1e-4)) this.target = this.target.map((v, i) => v + (this.panGoal[i] - v) * kp); else this.target = this.panGoal.slice();
  }

  /**
   * Look straight down an axis, so an outline drawn now lies on a true orthographic plane:
   *   front = along -Z (outline in X,Y)   side = along -X (outline in Z,Y)   top = along -Y (outline in X,Z)
   */
  setView(name) {
    const v = { front: [0, 0], side: [Math.PI / 2, 0], top: [0, 1.57] }[name]; // 1.57: just short of straight down, which has no 'right'
    if (!v) return false;
    this.moveView({ yaw: v[0], pitch: v[1], dist: 4.0, target: [0, 0, 0] });
    this.depth = 0;
    this.vel = [0, 0];
    this.coasting = false;
    return true;
  }

  stepDepth(sign) { this.depth = clamp(Math.round((this.depth + sign * DEPTH_STEP) * 100) / 100, -1, 1); }

  /** 'front' | 'side' | 'top' when the camera looks straight down that axis (so a drawn outline is orthographic). */
  alignedView(tol = 0.03) {
    const { fwd } = this.basis();
    const hit = (a) => Math.abs(Math.abs(fwd[a]) - 1) < tol * tol / 2 + 1e-6 || Math.hypot(...fwd.map((v, i) => (i === a ? 0 : v))) < tol;
    if (hit(2)) return 'front';
    if (hit(0)) return 'side';
    if (hit(1)) return 'top';
    return null;
  }

  setTool(tool, now = 0) { this.end({ now }); this.tool = tool; this.hot = null; }

  // ------------------------------------------------------------------- input
  /** The drawing cell for a gesture: the one it started in (it stays there while the hand strays), else the one under (sx, sy). */
  _cell(sx, sy) {
    if (this.cellView) return this.cellView;
    const c = this.layout.cellAt(sx, sy);
    return c && c !== 'preview' ? c : null;
  }

  place(sx, sy, rect, depth) {
    if (this.layout) {
      const c = this._cell(sx, sy);
      if (!c) return this.cursor || [0, 0, 0];
      let q = clampVec(this.layout.toWorld(c, sx, sy), LIMIT);
      if (this.snap) q = q.map((x) => Math.round(x / SNAP_STEP) * SNAP_STEP);
      return q;
    }
    let p = clampVec(this.unproject(sx, sy, rect, depth), LIMIT);
    if (this.snap) p = p.map((x) => Math.round(x / SNAP_STEP) * SNAP_STEP);
    return p;
  }

  hover(sx, sy, rect, highlight = false) {
    this.cursor = this.place(sx, sy, rect, this.depth);
    this.hot = highlight || this.tool === 'move' || this.tool === 'scale' ? this.pick(sx, sy, rect) : null;
  }

  /** Item nearest to a screen point (for move / scale / grab). */
  pick(sx, sy, rect) {
    let best = null, bestD = Infinity;
    const f = this.focal(rect);
    const cell = this.layout ? this._cell(sx, sy) : null;
    if (this.layout && !cell) return null;
    for (const it of this.items) {
      if (cell) { // flat view: nearest point of the item as drawn in this cell
        if (it.kind === 'mesh') continue;
        let near = Infinity;
        for (const pl of it.polylines()) {
          const sp = pl.map((q) => this.layout.fromWorld(cell, q));
          for (let i = 0; i < sp.length; i++) near = Math.min(near, i ? segDist(sx, sy, sp[i - 1], sp[i]) : Math.hypot(sp[0].x - sx, sp[0].y - sy));
        }
        if (near <= 26 && near < bestD) { best = it; bestD = near; }
        continue;
      }
      let d;
      if (it.volumetric) {
        const p = this.project(it.center, rect);
        d = Math.hypot(p.x - sx, p.y - sy);
        const reach = Math.max(28, (f * it.r) / p.z);
        if (d > reach) d = Infinity;
      } else {
        d = Infinity;
        for (const pl of it.polylines()) for (const q of pl) {
          const p = this.project(q, rect);
          d = Math.min(d, Math.hypot(p.x - sx, p.y - sy));
        }
        if (d > 26) d = Infinity;
      }
      if (d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  /** The smallest closed outline under a screen point (inside it, or within a few pixels of its edge), for Extrude and Cut. */
  pickOutline(sx, sy, rect) {
    let best = null, bestArea = Infinity;
    for (const it of this.items) {
      const ring = outlineRing(it);
      if (!ring) continue;
      const sp = ring.map((q) => this.project(q, rect));
      let inside = false, near = Infinity, area = 0;
      for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
        if ((sp[i].y > sy) !== (sp[j].y > sy) && sx < ((sp[j].x - sp[i].x) * (sy - sp[i].y)) / (sp[j].y - sp[i].y) + sp[i].x) inside = !inside;
        near = Math.min(near, segDist(sx, sy, sp[j], sp[i]));
        area += sp[j].x * sp[i].y - sp[i].x * sp[j].y;
      }
      if (!inside && near > 18) continue;
      area = Math.abs(area) / 2;
      if (area < bestArea) { best = it; bestArea = area; }
    }
    return best;
  }

  _note(text, kind = 'ok') { if (this.onNote) this.onNote(text, kind); }

  /** A click in the scene: select the item under the point, or nothing when there is none. */
  click(sx, sy, rect) {
    this.selected = this.layout ? null : this.pick(sx, sy, rect);
    this.hot = null;
    return this.selected;
  }

  /** Remove the selected item (one undo step). */
  deleteSelected() {
    const it = this.selected;
    if (!it || !this.items.includes(it)) return false;
    this.replaceItems([it], []);
    return true;
  }

  /** Start a gesture. mode = the tool, or 'move' / 'scale' to act on an existing object. Returns false if nothing to act on. */
  begin(sx, sy, rect, now, mode = this.tool) {
    this._resetGesture();
    this.mode = mode;
    if (this.layout) {
      this.cellView = this._cell(sx, sy);
      if (!this.cellView) return false; // started outside the three drawing cells
      if (this.photoDrag && this.photoDrag.active(this.cellView)) { this.imgDrag = { view: this.cellView, x: sx, y: sy }; return true; }
    }
    if (mode === 'extrude' || mode === 'cut') {
      const outline = this.layout ? null : this.pickOutline(sx, sy, rect);
      const flat = outline && planeOf(outlineRing(outline));
      if (!flat) {
        this._note('Pinch inside a closed outline (rectangle, circle or a loop you closed). Draw one first, then extrude or cut with it.', 'warn');
        this.cellView = null;
        return false;
      }
      const plane = facePlane(flat, this.basis().eye); // the normal points at the viewer: up = toward you
      this.op = { kind: mode, outline, plane, y0: sy, depth: 0, hist: [[now, 0]] };
      this.hot = outline;
      return true;
    }
    if (mode === 'move' || mode === 'scale') {
      const it = this.pick(sx, sy, rect);
      if (!it) { this.cellView = null; return false; }
      const { eye, fwd } = this.basis();
      this.drag = it;
      this.dragDepth = this.dist - dot(sub(it.center, eye), fwd);
      this.dragLast = this.layout ? this.layout.toWorld(this.cellView, sx, sy) : this.unproject(sx, sy, rect, this.dragDepth);
      this.dragY = sy;
      this.dragMoved = false;
      this.dragHist = [[now, it.snapshot()]];
      return true;
    }
    const p = this.place(sx, sy, rect, this.depth);
    this.cursor = p;
    this.times = [now];
    if (mode === 'free') this.active = [p]; else this.anchor = p;
    return true;
  }

  get busy() { return !!(this.drag || this.active || this.anchor || this.imgDrag || this.op); }

  add(sx, sy, rect, now) {
    if (this.imgDrag) {
      const g = this.imgDrag, k = this.layout.scale;
      if (sx !== g.x || sy !== g.y) this.photoDrag.move(g.view, (sx - g.x) / k, -(sy - g.y) / k);
      g.x = sx; g.y = sy;
      return;
    }
    if (this.op) { // drag up = deeper / further out
      const o = this.op;
      o.depth = clamp((o.y0 - sy) * DEPTH_PER_PX, o.kind === 'cut' ? 0 : -MAX_DEPTH, MAX_DEPTH);
      o.hist.push([now, o.depth]);
      if (o.hist.length > 128) o.hist.shift();
      return;
    }
    if (this.drag) {
      if (this.mode === 'scale') { // drag up = bigger, down = smaller
        const dy = sy - this.dragY;
        this.dragY = sy;
        if (dy) { this.drag.scale(Math.exp(-dy * 0.005)); this.dragMoved = true; }
      } else {
        const p = this.layout ? this.layout.toWorld(this.cellView, sx, sy) : this.unproject(sx, sy, rect, this.dragDepth);
        const d = sub(p, this.dragLast);
        if (d.some((x) => x)) { this.drag.translate(d); this.dragLast = p; this.dragMoved = true; }
      }
      this.dragHist.push([now, this.drag.snapshot()]);
      if (this.dragHist.length > 128) this.dragHist.shift();
      return;
    }
    if (!this.active && !this.anchor) return;
    const p = this.place(sx, sy, rect, this.depth);
    this.cursor = p;
    this.cursorHist.push([now, p]);
    if (this.cursorHist.length > 64) this.cursorHist.shift();
    if (this.active && len(sub(p, this.active[this.active.length - 1])) >= 0.012) {
      this.active.push(p);
      this.times.push(now);
    }
  }

  /** The cutter / extrusion as it is now, for the renderer; null when nothing has been pulled out yet. */
  _opShape(depth = this.op && this.op.depth) {
    const o = this.op;
    if (!o || Math.abs(depth) < 0.005) return null;
    if (o.kind === 'extrude') return prismPreview(o.plane, depth);
    return prismPreview(o.plane, CUT_LIFT, { w0: -depth, color: 0xff6b6b });
  }

  preview() {
    if (this.op) return this._opShape();
    if (this.active && this.active.length > 1) return new Poly('free', this.active);
    if (this.anchor && this.cursor) {
      const { right, up } = this.cellView ? PLANE_VIEWS[this.cellView] : this.basis();
      return buildItem(this.mode, this.anchor, this.cursor, right, up);
    }
    return null;
  }

  /**
   * Finish the current gesture.
   * trim: drop the last `trim` seconds of input. Opening the fingers to release a pinch moves the hand before the
   * pinch is seen to end, so strokes would get a hook and dropped objects would drift. Rewinding to just before
   * the release makes everything stay exactly where the user let go.
   */
  end({ trim = 0, now = 0 } = {}) {
    if (this.imgDrag) { this._resetGesture(); return null; }
    if (this.op) { const item = this._commitOp(trim, now); this._resetGesture(); return item; }
    if (this.drag) {
      if (trim > 0 && this.dragHist.length >= 3) {
        const older = this.dragHist.filter(([t]) => t <= now - trim);
        if (older.length) this.drag.restore(older[older.length - 1][1]);
      }
      if (this.dragMoved) this.moved++;
    }
    let item = null;
    if (this.active) {
      let pts = this.active;
      if (trim > 0 && pts.length > 2 && this.times.length === pts.length) {
        const kept = pts.filter((_, i) => this.times[i] <= now - trim);
        if (kept.length >= 2) pts = kept;
      }
      if (pts.length >= 2) item = new Poly('free', this.snap ? pts : normalizePolyline(pts, STROKE_SPACING));
    } else if (this.anchor) {
      const final = this.cursor;
      if (trim > 0 && this.cursorHist.length) {
        const older = this.cursorHist.filter(([t]) => t <= now - trim);
        if (older.length) this.cursor = older[older.length - 1][1];
      }
      item = this.preview();
      if (!item && final) { this.cursor = final; item = this.preview(); } // a quick flick must not be rewound to nothing
    }
    if (item) { this.items.push(item); this.ops.push({ kind: 'add', item }); }
    this._resetGesture();
    return item;
  }

  /** Finish an Extrude or Cut. Returns the new item (or the first of several), or null when nothing happened. */
  _commitOp(trim, now) {
    const o = this.op;
    let depth = o.depth;
    if (trim > 0) { // the hand moves while the fingers open: use the depth from just before the release
      const older = o.hist.filter(([t]) => t <= now - trim);
      if (older.length) depth = older[older.length - 1][1];
    }
    if (Math.abs(depth) < MIN_DEPTH) { this._note(o.kind === 'cut' ? 'Drag up to set how deep to cut.' : 'Drag up to pull the outline out.', 'info'); return null; }
    const flatNote = o.plane.flat > 0.08 ? ' The outline was not flat; it was flattened first.' : '';
    if (o.kind === 'extrude') {
      const mesh = prismMesh(o.plane, depth);
      if (!mesh) { this._note('That outline crosses itself, so it cannot be extruded. Undo and redraw it without crossings.', 'warn'); return null; }
      const item = ImportedMesh.fromMesh('extrusion', mesh);
      this.replaceItems([o.outline], [item]);
      this._note(`Extruded ${Math.abs(depth).toFixed(2)} ${depth > 0 ? 'toward you' : 'away from you'}. Grab it to move it, or Undo.${flatNote}`);
      return item;
    }
    // Cut: from just in front of the outline (so the cut opens through a face lying on it) down into the scene
    const w0 = -depth, box = prismBox(o.plane, w0, CUT_LIFT);
    const targets = this.items.filter((it) => it.volumetric && it !== o.outline && boxesOverlap(meshBox(it.mesh()), box));
    if (!targets.length) { this._note('Nothing to cut: the outline is not in front of a solid. Draw it over the solid, then drag up to cut into it.', 'warn'); return null; }
    const results = [], cut = [];
    for (const t of targets) {
      const r = cutMesh(t.mesh(), o.plane, w0, CUT_LIFT, { resolution: CUT_RESOLUTION });
      if (!r.removed) continue;
      cut.push(t);
      if (r.mesh.f.length) results.push(ImportedMesh.fromMesh(`${t.name || t.kind} (cut)`, r.mesh));
    }
    if (!cut.length) { this._note('The cut does not reach the solid. Drag further up, or move the outline closer to it.', 'warn'); return null; }
    this.replaceItems([o.outline, ...cut], results);
    this._note(`Cut ${depth.toFixed(2)} deep into ${cut.length === 1 ? 'the solid' : `${cut.length} solids`}. Undo brings it back.${flatNote}`);
    return results[0] || null;
  }

  /** Abandon the gesture in progress without committing it (a drag is rewound to its start). */
  cancel() {
    if (this.drag && this.dragHist.length) this.drag.restore(this.dragHist[0][1]);
    this._resetGesture();
  }

  addItem(item) { this.items.push(item); this.ops.push({ kind: 'add', item }); return item; }

  /** Replace some items by others (a join, or a visual hull) as one undoable step. */
  replaceItems(removed, added) {
    const at = removed.map((it) => this.items.indexOf(it));
    this.items = this.items.filter((it) => !removed.includes(it));
    this.items.push(...added);
    this.ops.push({ kind: 'replace', removed, at, added });
    this.hot = null;
    if (this.selected && !this.items.includes(this.selected)) this.selected = null;
  }

  undo() {
    const op = this.ops.pop();
    if (op && op.kind === 'replace') {
      this.items = this.items.filter((it) => !op.added.includes(it));
      op.removed.forEach((it, k) => this.items.splice(Math.min(op.at[k] >= 0 ? op.at[k] : this.items.length, this.items.length), 0, it));
    } else if (op && op.kind === 'add') {
      const i = this.items.indexOf(op.item);
      if (i >= 0) this.items.splice(i, 1);
    } else if (this.items.length) {
      this.items.pop();
    } else return;
    this.undoCount++;
    this.hot = null;
    if (this.selected && !this.items.includes(this.selected)) this.selected = null;
    this.joinHint = null;
  }

  /** Remove everything as one undoable step. */
  clear() {
    this._resetGesture();
    if (this.items.length) this.replaceItems(this.items.slice(), []);
    this.hot = null; this.joinHint = null;
  }

  get solidCount() { return this.items.filter((i) => i.volumetric).length; }
}

export { Solid };
