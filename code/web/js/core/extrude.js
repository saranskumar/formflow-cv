// Extrude: pull a closed outline out into a solid. The outline can be a rectangle, a circle or a hand-drawn loop, drawn on
// any plane; it is flattened onto its best-fit plane and swept along that plane's normal. Pure geometry, no DOM.
//
//   outlineRing(item)         the outline as a ring of points (no repeated last point), or null if it is not a closed loop
//   planeOf(ring)             best-fit plane { origin, n, u, v, ring2: [[u, v]...], flat } (flat = how far the points were from it)
//   facePlane(plane, eye)     the same plane with its normal turned toward `eye` (the viewer)
//   prismMesh(plane, depth)   { v, f } closed solid from the plane to `depth` along its normal, or null if the outline crosses itself
//   prismPreview(plane, ...)  something the renderer can draw while the depth is being dragged
import { add, sub, mul, dot, cross, len, norm } from './vec.js';
import { meshVolume } from './shapes.js';

export const CLOSE_GAP = 0.2;      // a hand-drawn loop counts as closed when its ends are this close ...
export const CLOSE_RATIO = 0.15;   // ... or within this fraction of its length
export const MIN_AREA = 2e-3;      // smaller than this is a speck, not an outline

const area2 = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/** The outline of a Poly as a ring (first point not repeated), or null when it is not a usable closed loop. */
export function outlineRing(it) {
  if (!it || !it.pts || it.kind === 'line' || it.kind === 'mesh' || it.volumetric) return null;
  let pts = it.pts;
  if (pts.length < 4) return null;
  let path = 0;
  for (let i = 1; i < pts.length; i++) path += len(sub(pts[i], pts[i - 1]));
  const gap = len(sub(pts[pts.length - 1], pts[0]));
  if (!it.closed && gap > Math.max(CLOSE_GAP, CLOSE_RATIO * path)) return null;
  if (gap < 1e-6) pts = pts.slice(0, -1);
  const ring = pts.filter((p, i) => i === 0 || len(sub(p, pts[i - 1])) > 1e-6).map((p) => p.slice());
  return ring.length >= 3 ? ring : null;
}

/** Best-fit plane of a ring (Newell's method). u, v, n form a right-handed frame with the ring counter-clockwise about n. */
export function planeOf(ring) {
  let n = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) n = add(n, cross(ring[i], ring[(i + 1) % ring.length]));
  const l = len(n);
  if (l < 2 * MIN_AREA) return null;
  n = mul(n, 1 / l);
  const origin = mul(ring.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / ring.length);
  let far = ring[0], best = -1;
  for (const p of ring) { const d = len(sub(p, origin)); if (d > best) { best = d; far = p; } }
  const w = sub(far, origin);
  const u = norm(sub(w, mul(n, dot(w, n))));
  const v = cross(n, u);
  let flat = 0;
  const ring2 = ring.map((p) => { const d = sub(p, origin); flat = Math.max(flat, Math.abs(dot(d, n))); return [dot(d, u), dot(d, v)]; });
  if (Math.abs(area2(ring2)) < MIN_AREA) return null;
  return { origin, n, u, v, ring2, flat };
}

/** Turn the plane's normal toward the viewer at `eye` (flipping v too, so the frame stays right-handed). */
export function facePlane(plane, eye) {
  if (dot(plane.n, sub(eye, plane.origin)) >= 0) return plane;
  return { ...plane, n: mul(plane.n, -1), v: mul(plane.v, -1), ring2: plane.ring2.map(([x, y]) => [x, -y]) };
}

const onSeg = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
const orient = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-12 ? 0 : v > 0 ? 1 : -1; };
function segmentsCross(a, b, c, d) {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(a, b, c)) || (o2 === 0 && onSeg(a, b, d)) || (o3 === 0 && onSeg(c, d, a)) || (o4 === 0 && onSeg(c, d, b));
}

/** Does the polygon cross itself? (Edges that merely share an end point are fine.) */
export function selfIntersects(ring2) {
  const n = ring2.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsCross(ring2[i], ring2[(i + 1) % n], ring2[j], ring2[(j + 1) % n])) return true;
  }
  return false;
}

/** Ear-clipping triangulation of a simple polygon. Returns triangles as index triples (counter-clockwise), or null. */
export function triangulate(ring2) {
  const n = ring2.length;
  const idx = [...Array(n).keys()];
  if (area2(ring2) < 0) idx.reverse();
  const inTri = (p, a, b, c) => orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0;
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = ring2[ia], b = ring2[ib], c = ring2[ic];
      if (orient(a, b, c) <= 0) continue; // reflex or flat corner: not an ear
      let ear = true;
      for (const j of idx) if (j !== ia && j !== ib && j !== ic && inTri(ring2[j], a, b, c)) { ear = false; break; }
      if (!ear) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) { // only flat corners left: drop them
      const flat = idx.findIndex((_, k) => orient(ring2[idx[(k + idx.length - 1) % idx.length]], ring2[idx[k]], ring2[idx[(k + 1) % idx.length]]) === 0);
      if (flat < 0) return null;
      idx.splice(flat, 1);
    }
  }
  if (idx.length === 3 && orient(ring2[idx[0]], ring2[idx[1]], ring2[idx[2]]) !== 0) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** World point of plane coordinates (x, y) at height w above the plane. */
export const planePoint = (plane, x, y, w = 0) => add(add(add(plane.origin, mul(plane.u, x)), mul(plane.v, y)), mul(plane.n, w));

/**
 * Closed, outward-wound solid between the plane (height w0) and height w1 along its normal. Returns null when the outline
 * crosses itself (no sensible solid). capped = false leaves the two lids off, only for a preview of a messy outline.
 */
export function prismMesh(plane, w1, { w0 = 0, capped = true } = {}) {
  const r = plane.ring2, n = r.length;
  let tris = [];
  if (capped) {
    if (selfIntersects(r)) return null;
    tris = triangulate(r);
    if (!tris || !tris.length) return null;
  }
  const ccw = area2(r) > 0;
  const order = ccw ? [...Array(n).keys()] : [...Array(n).keys()].reverse();
  const v = [];
  for (const w of [w0, w1]) for (const i of order) v.push(...planePoint(plane, r[i][0], r[i][1], w));
  const f = [];
  for (let i = 0; i < n; i++) { // walls
    const j = (i + 1) % n;
    f.push(i, j, n + j, i, n + j, n + i);
  }
  const rank = new Map(order.map((idx, k) => [idx, k]));
  for (const [a, b, c] of tris) { // lids: the bottom faces the other way
    const [ra, rb, rc] = [rank.get(a), rank.get(b), rank.get(c)];
    f.push(n + ra, n + rb, n + rc, rc, rb, ra);
  }
  const mesh = { v: Float64Array.from(v), f: Uint32Array.from(f) };
  if (meshVolume(mesh) < 0) for (let i = 0; i < mesh.f.length; i += 3) { const t = mesh.f[i + 1]; mesh.f[i + 1] = mesh.f[i + 2]; mesh.f[i + 2] = t; }
  return mesh;
}

/** Something the renderer can draw while the depth is dragged: a translucent solid and its outline edges. */
export function prismPreview(plane, w1, { w0 = 0, color = 0xf0f0f0 } = {}) {
  const mesh = prismMesh(plane, w1, { w0 }) || prismMesh(plane, w1, { w0, capped: false });
  const r = plane.ring2, step = Math.max(1, Math.floor(r.length / 12));
  const ring = (w) => [...r.map(([x, y]) => planePoint(plane, x, y, w)), planePoint(plane, r[0][0], r[0][1], w)];
  const lines = [ring(w0), ring(w1)];
  for (let i = 0; i < r.length; i += step) lines.push([planePoint(plane, r[i][0], r[i][1], w0), planePoint(plane, r[i][0], r[i][1], w1)]);
  return { kind: 'prism', volumetric: true, center: plane.origin, r: 1, color, mesh: () => mesh, polylines: () => lines };
}
