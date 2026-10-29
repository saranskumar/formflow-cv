// Drawable items: flat shapes and axis-aligned solids (Y up), plus imported models.
//   polylines()  wireframe for display and OBJ line export
//   mesh()       {v: Float64Array(3n), f: Uint32Array(3m)} with outward winding, or null for flat items
// Every solid is convex, so each triangle is oriented away from the centre: outward winding by construction.
import { add, sub, mul, dot, cross, len, norm, clamp } from './vec.js';

export const TOOLS_2D = ['free', 'line', 'rect', 'circle'];
export const TOOLS_3D = ['cube', 'sphere', 'cylinder', 'cone', 'pyramid'];
export const ALL_TOOLS = [...TOOLS_2D, ...TOOLS_3D, 'move', 'scale', 'extrude', 'cut'];
const RING = 40;

export function circle(c, u, v, r, n = RING) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push(add(c, add(mul(u, r * Math.cos(t)), mul(v, r * Math.sin(t)))));
  }
  return out;
}

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const flat = (rows) => Float64Array.from(rows.flat());

export class Poly {
  constructor(kind, pts, closed = false) {
    this.kind = kind;
    this.pts = pts;
    this.closed = closed; // a closed outline (first point == last point) can be used as a silhouette
    this.volumetric = false;
  }
  get center() {
    const n = this.pts.length;
    return this.pts.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / n);
  }
  polylines() { return [this.pts]; }
  mesh() { return null; }
  translate(d) { this.pts = this.pts.map((p) => add(p, d)); }
  snapshot() { return this.pts.map((p) => p.slice()); }
  restore(s) { this.pts = s.map((p) => p.slice()); }
  scale(f) { const c = this.center; this.pts = this.pts.map((p) => add(c, mul(sub(p, c), f))); }
}

export class Solid {
  constructor(kind, center, r) {
    this.kind = kind;
    this.center = center;
    this.r = r;
    this.volumetric = true;
  }
  get half() { return this.kind === 'cube' || this.kind === 'pyramid' ? this.r * 0.8 : this.r; }
  get rad() { return this.kind === 'cylinder' || this.kind === 'cone' ? this.r * 0.7 : this.r; }
  translate(d) { this.center = add(this.center, d); }
  snapshot() { return [this.center.slice(), this.r]; }
  restore(s) { this.center = s[0].slice(); this.r = s[1]; }
  scale(f) { this.r = clamp(this.r * f, 0.03, 2.0); }

  polylines() {
    const c = this.center;
    const k = this.kind;
    if (k === 'cube') {
      const h = this.half;
      const v = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(add(c, [sx * h, sy * h, sz * h]));
      return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
        .map(([a, b]) => [v[a], v[b]]);
    }
    if (k === 'sphere') {
      const r = this.r;
      return [circle(c, X, Y, r), circle(c, X, Z, r), circle(c, Y, Z, r),
        circle(add(c, mul(Y, r * 0.55)), X, Z, r * 0.835), circle(sub(c, mul(Y, r * 0.55)), X, Z, r * 0.835)];
    }
    if (k === 'cylinder') {
      const r = this.rad, h = this.r;
      const top = circle(add(c, mul(Y, h)), X, Z, r), bot = circle(sub(c, mul(Y, h)), X, Z, r);
      const side = [];
      for (let i = 0; i < RING; i += RING / 8) side.push([bot[i], top[i]]);
      return [top, bot, ...side];
    }
    if (k === 'cone') {
      const r = this.rad, h = this.r;
      const base = circle(sub(c, mul(Y, h)), X, Z, r), apex = add(c, mul(Y, h));
      const side = [];
      for (let i = 0; i < RING; i += RING / 8) side.push([base[i], apex]);
      return [base, ...side];
    }
    if (k === 'pyramid') {
      const h = this.half, r = this.r;
      const b = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => add(c, [sx * h, -r, sz * h]));
      const apex = add(c, [0, r, 0]);
      return [[...b, b[0]], ...b.map((p) => [p, apex])];
    }
    throw new Error(`unknown solid ${k}`);
  }

  mesh() {
    const { v, f } = this._rawMesh();
    const c = this.center;
    for (let i = 0; i < f.length; i++) {
      const [a, b, d] = f[i];
      const n = cross(sub(v[b], v[a]), sub(v[d], v[a]));
      const mid = mul(add(add(v[a], v[b]), v[d]), 1 / 3);
      if (dot(n, sub(mid, c)) < 0) f[i] = [a, d, b];
    }
    return { v: flat(v), f: Uint32Array.from(f.flat()) };
  }

  _rawMesh() {
    const c = this.center, k = this.kind;
    if (k === 'cube') {
      const h = this.half;
      const v = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) v.push(add(c, [sx * h, sy * h, sz * h]));
      return { v, f: [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]] };
    }
    if (k === 'pyramid') {
      const h = this.half, r = this.r;
      return {
        v: [[-h, -r, -h], [h, -r, -h], [h, -r, h], [-h, -r, h], [0, r, 0]].map((p) => add(c, p)),
        f: [[0, 1, 2], [0, 2, 3], [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]],
      };
    }
    if (k === 'cylinder' || k === 'cone') {
      const n = 32, rad = this.rad, r = this.r;
      const ring = [...Array(n)].map((_, i) => [Math.cos((2 * Math.PI * i) / n) * rad, 0, Math.sin((2 * Math.PI * i) / n) * rad]);
      const bot = ring.map((p) => add(c, add(p, [0, -r, 0])));
      const f = [];
      if (k === 'cylinder') {
        const top = ring.map((p) => add(c, add(p, [0, r, 0])));
        const v = [...bot, ...top, add(c, [0, -r, 0]), add(c, [0, r, 0])];
        const cb = 2 * n, ct = 2 * n + 1;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          f.push([i, n + j, j], [i, n + i, n + j], [cb, j, i], [ct, n + i, n + j]);
        }
        return { v, f };
      }
      const v = [...bot, add(c, [0, r, 0]), add(c, [0, -r, 0])];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        f.push([i, j, n], [n + 1, j, i]);
      }
      return { v, f };
    }
    if (k === 'sphere') {
      const nu = 16, nv = 32, r = this.r;
      const v = [add(c, [0, r, 0])];
      for (let i = 1; i < nu; i++) {
        const a = (Math.PI * i) / nu;
        for (let j = 0; j < nv; j++) {
          const b = (2 * Math.PI * j) / nv;
          v.push(add(c, [r * Math.sin(a) * Math.cos(b), r * Math.cos(a), r * Math.sin(a) * Math.sin(b)]));
        }
      }
      v.push(add(c, [0, -r, 0]));
      const f = [];
      for (let j = 0; j < nv; j++) f.push([0, 1 + ((j + 1) % nv), 1 + j]);
      for (let i = 0; i < nu - 2; i++) {
        for (let j = 0; j < nv; j++) {
          const a = 1 + i * nv + j, b = 1 + i * nv + ((j + 1) % nv), cc = a + nv, d = b + nv;
          f.push([a, b, cc], [b, d, cc]);
        }
      }
      const last = v.length - 1;
      for (let j = 0; j < nv; j++) f.push([last, 1 + (nu - 2) * nv + j, 1 + (nu - 2) * nv + ((j + 1) % nv)]);
      return { v, f };
    }
    throw new Error(`unknown solid ${k}`);
  }
}

/** Signed volume of a closed mesh (positive when the winding is outward). */
export function meshVolume({ v, f }) {
  let vol = 0;
  for (let i = 0; i < f.length; i += 3) {
    const a = [v[3 * f[i]], v[3 * f[i] + 1], v[3 * f[i] + 2]];
    const b = [v[3 * f[i + 1]], v[3 * f[i + 1] + 1], v[3 * f[i + 1] + 2]];
    const c = [v[3 * f[i + 2]], v[3 * f[i + 2] + 1], v[3 * f[i + 2] + 2]];
    vol += dot(a, cross(b, c));
  }
  return vol / 6;
}

/** Item from a drag A->B on the camera-facing plane, or null if too small. */
export function buildItem(kind, a, b, right, up) {
  const d = sub(b, a);
  const size = len(d);
  if (size < 0.03) return null;
  if (kind === 'line') return new Poly('line', [a, b]);
  if (kind === 'rect') {
    const dx = dot(d, right), dy = dot(d, up);
    return new Poly('rect', [a, add(a, mul(right, dx)), b, add(a, mul(up, dy)), a], true);
  }
  if (kind === 'circle') return new Poly('circle', circle(a, right, up, size), true);
  if (TOOLS_3D.includes(kind)) return new Solid(kind, a.slice(), size);
  return null;
}

/**
 * Smooth and evenly resample a hand-drawn stroke: Laplacian smoothing with pinned endpoints removes tremor,
 * arc-length resampling gives uniform point spacing regardless of drawing speed.
 */
export function normalizePolyline(pts, spacing = 0.03, iters = 3) {
  if (pts.length < 3) return pts;
  let p = pts.filter((q, i) => i === 0 || len(sub(q, pts[i - 1])) > 1e-9);
  if (p.length < 3) return p;
  for (let k = 0; k < iters; k++) {
    const q = p.map((x) => x.slice());
    for (let i = 1; i < p.length - 1; i++) q[i] = add(add(mul(p[i - 1], 0.25), mul(p[i], 0.5)), mul(p[i + 1], 0.25));
    p = q;
  }
  const arc = [0];
  for (let i = 1; i < p.length; i++) arc.push(arc[i - 1] + len(sub(p[i], p[i - 1])));
  const total = arc[arc.length - 1];
  if (total < spacing * 1.5) return p;
  const n = Math.max(2, Math.round(total / spacing) + 1);
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = (total * i) / (n - 1);
    while (j < arc.length - 2 && arc[j + 1] < t) j++;
    const seg = arc[j + 1] - arc[j] || 1;
    out.push([0, 1, 2].map((a) => p[j][a] + ((p[j + 1][a] - p[j][a]) * (t - arc[j])) / seg));
  }
  return out;
}

export { norm };
