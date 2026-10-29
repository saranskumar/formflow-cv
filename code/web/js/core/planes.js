// The 3-plane workspace: four cells laid out like an engineering drawing (third-angle projection).
//
//        +---------+---------+
//        |   TOP   | PREVIEW |      Front and Top share X (the vertical guide lines line up),
//        +---------+---------+      Front and Side share Y (the horizontal guide lines line up),
//        |  FRONT  |  SIDE   |      Top and Side share Z.
//        +---------+---------+
//
// Each of the three drawing cells is an orthographic view: the same scale in all three, centred on the origin. A point
// on screen maps to a point on that view's flat plane, so everything drawn there is automatically a true silhouette.
// Axes match the 3D camera presets (Sketch.setView): front looks along -Z, side along -X, top along -Y.

export const PLANE_VIEWS = {
  front: { axis: 'z', right: [1, 0, 0], up: [0, 1, 0], label: 'FRONT', hint: 'X →  Y ↑' },
  side: { axis: 'x', right: [0, 0, -1], up: [0, 1, 0], label: 'SIDE', hint: '← Z  Y ↑' },
  top: { axis: 'y', right: [1, 0, 0], up: [0, 0, -1], label: 'TOP', hint: 'X →  Z ↓' },
};
export const CELL_NAMES = ['top', 'preview', 'front', 'side'];
export const RANGE = 1.35; // world units visible each side of the centre in a drawing cell

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class PlaneLayout {
  constructor() {
    this.cells = null;
    this.scale = 100; // pixels per world unit, the same in every drawing cell
    this.focus = null; // a cell name: that cell fills the whole area and the other three are not shown
  }

  /** area = { x, y, w, h } in screen pixels. */
  set(area, gap = 12) {
    if (this.focus) {
      const gone = { x: -10000, y: -10000, w: 0, h: 0 }; // zero size: nothing is drawn there and nothing can be hit
      this.cells = Object.fromEntries(CELL_NAMES.map((n) => [n, n === this.focus ? { x: area.x, y: area.y, w: area.w, h: area.h } : { ...gone }]));
      this.scale = Math.min(area.w, area.h) / (2 * RANGE);
      return this;
    }
    const cw = (area.w - gap) / 2, ch = (area.h - gap) / 2;
    const col = [area.x, area.x + cw + gap], row = [area.y, area.y + ch + gap];
    this.cells = {
      top: { x: col[0], y: row[0], w: cw, h: ch },
      preview: { x: col[1], y: row[0], w: cw, h: ch },
      front: { x: col[0], y: row[1], w: cw, h: ch },
      side: { x: col[1], y: row[1], w: cw, h: ch },
    };
    this.scale = Math.min(cw, ch) / (2 * RANGE);
    return this;
  }

  centre(name) { const c = this.cells[name]; return { x: c.x + c.w / 2, y: c.y + c.h / 2 }; }

  contains(name, sx, sy) {
    const c = this.cells && this.cells[name];
    return !!c && sx >= c.x && sx <= c.x + c.w && sy >= c.y && sy <= c.y + c.h;
  }

  /** Which cell is under a screen point, or null. */
  cellAt(sx, sy) {
    if (!this.cells) return null;
    return CELL_NAMES.find((n) => this.contains(n, sx, sy)) || null;
  }

  axes(name) { return PLANE_VIEWS[name]; }

  /** Screen point -> point on that view's plane (the coordinate along the view axis is 0). */
  toWorld(name, sx, sy) {
    const { right, up } = PLANE_VIEWS[name];
    const c = this.centre(name);
    const u = (sx - c.x) / this.scale, v = -(sy - c.y) / this.scale;
    return [0, 1, 2].map((k) => right[k] * u + up[k] * v);
  }

  /** World point -> screen point in that view. */
  fromWorld(name, p) {
    const { right, up } = PLANE_VIEWS[name];
    const c = this.centre(name);
    return { x: c.x + dot(p, right) * this.scale, y: c.y - dot(p, up) * this.scale };
  }
}

const AXIS_COLOR = [0xeb5050, 0x6ed26e, 0x46aaeb];
const MISMATCH_COLOR = 0xffa040;

/**
 * Thin lines that carry a dimension from one view into the others: the width drawn in Front continues up into Top, the
 * height in Front continues across into Side, and so on. `shared` = sharedDimensions(items) from hull.js.
 * Returns [{ view, pts: [p, q], color }] with world-space end points.
 */
export function guideLines(shared, reach = RANGE + 0.3) {
  const out = [];
  ['x', 'y', 'z'].forEach((name, k) => {
    const r = shared.ranges[name];
    if (!r) return;
    const color = shared.mismatch[name] ? MISMATCH_COLOR : AXIS_COLOR[k];
    for (const [view, v] of Object.entries(PLANE_VIEWS)) {
      for (const [dir, other] of [[v.right, v.up], [v.up, v.right]]) {
        if (!dir[k]) continue;
        for (const c of r) {
          const a = dir[k] * c; // position along this view's axis
          const p = [0, 1, 2].map((i) => dir[i] * a - other[i] * reach);
          const q = [0, 1, 2].map((i) => dir[i] * a + other[i] * reach);
          out.push({ view, pts: [p, q], color });
        }
      }
    }
  });
  return out;
}
