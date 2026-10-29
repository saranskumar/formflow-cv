// Cut: take a prism (an outline swept along its normal) out of a closed mesh, as a pocket or a hole.
//
// The mesh is turned into a signed distance field on a grid (positive inside): exact distances to the triangles in a thin
// band around the surface, inside/outside from ray parity everywhere. The cutter's own field is exact too (distance to the
// outline, and to the two lids). "Mesh minus prism" is then min(mesh, -prism), and surface nets (core/hull.js) turns that
// field back into a closed mesh whose corners stay sharp to well under a voxel. Pure geometry, no DOM.
import { meshFromField } from './hull.js';
import { meshHealth } from './meshops.js';

export const BAND = 2; // cells either side of the surface where exact distances are computed

/** Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection). */
function ptTri2(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const d2s = (x, y, z) => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return d2s(apx, apy, apz);
  const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return d2s(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); return d2s(apx - t * abx, apy - t * aby, apz - t * abz); }
  const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return d2s(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); return d2s(apx - t * acx, apy - t * acy, apz - t * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return d2s(bpx - t * (c[0] - b[0]), bpy - t * (c[1] - b[1]), bpz - t * (c[2] - b[2])); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return d2s(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/**
 * Signed distance field of a closed mesh on an n^3 grid whose cell (i, j, k) has its centre at lo + (i + .5) h.
 * Returns Float32Array(n^3), index (i * n + j) * n + k, positive inside, magnitude capped at (BAND + 1) h.
 */
export function meshField(mesh, lo, h, n) {
  const { v, f } = mesh;
  const cap = (BAND + 1) * h;
  const occ = new Uint8Array(n * n * n);
  const D = new Float32Array(n * n * n).fill(Infinity);
  const cols = new Array(n * n); // z of every surface crossing, per (i, j) column
  const J1 = 1.3e-7 * h, J2 = 2.9e-7 * h; // nudge the rays off lattice points so a shared edge is never hit twice
  const P = (t) => [v[3 * t], v[3 * t + 1], v[3 * t + 2]];
  for (let t = 0; t < f.length; t += 3) {
    const a = P(f[t]), b = P(f[t + 1]), c = P(f[t + 2]);
    // --- parity along z
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (det !== 0) {
      const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - lo[0]) / h - 0.5)), i1 = Math.min(n - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - lo[0]) / h - 0.5));
      const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - lo[1]) / h - 0.5)), j1 = Math.min(n - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - lo[1]) / h - 0.5));
      for (let i = i0; i <= i1; i++) {
        const x = lo[0] + (i + 0.5) * h + J1;
        for (let j = j0; j <= j1; j++) {
          const y = lo[1] + (j + 0.5) * h + J2;
          const w1 = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / det;
          const w2 = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / det;
          if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
          (cols[i * n + j] || (cols[i * n + j] = [])).push(a[2] + w1 * (b[2] - a[2]) + w2 * (c[2] - a[2]));
        }
      }
    }
    // --- exact distance in the band around the triangle
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-14) continue;
    const reach = (BAND + 0.5) * h;
    const lim = (axis) => [
      Math.max(0, Math.floor((Math.min(a[axis], b[axis], c[axis]) - reach - lo[axis]) / h - 0.5)),
      Math.min(n - 1, Math.ceil((Math.max(a[axis], b[axis], c[axis]) + reach - lo[axis]) / h - 0.5)),
    ];
    const [bi0, bi1] = lim(0), [bj0, bj1] = lim(1), [bk0, bk1] = lim(2);
    for (let i = bi0; i <= bi1; i++) {
      const x = lo[0] + (i + 0.5) * h;
      for (let j = bj0; j <= bj1; j++) {
        const y = lo[1] + (j + 0.5) * h;
        const base = (i * n + j) * n;
        for (let k = bk0; k <= bk1; k++) {
          const z = lo[2] + (k + 0.5) * h;
          if (Math.abs(((x - a[0]) * nx + (y - a[1]) * ny + (z - a[2]) * nz) / nl) > reach) continue;
          const d2 = ptTri2(x, y, z, a, b, c);
          if (d2 < D[base + k]) D[base + k] = d2;
        }
      }
    }
  }
  for (let ij = 0; ij < n * n; ij++) {
    const z = cols[ij];
    if (!z || z.length < 2) continue;
    z.sort((p, q) => p - q);
    for (let s = 0; s + 1 < z.length; s += 2) {
      const k0 = Math.max(0, Math.ceil((z[s] - lo[2]) / h - 0.5)), k1 = Math.min(n - 1, Math.floor((z[s + 1] - lo[2]) / h - 0.5));
      for (let k = k0; k <= k1; k++) occ[ij * n + k] = 1;
    }
  }
  const out = new Float32Array(n * n * n);
  for (let q = 0; q < out.length; q++) {
    const d = Math.min(Math.sqrt(D[q]), cap);
    out[q] = occ[q] ? d : -d;
  }
  return out;
}

/** Ramer-Douglas-Peucker on a closed ring of [x, y]: fewer points for the per-cell distance loop. */
export function simplifyRing(ring, tol) {
  if (ring.length <= 24) return ring;
  const dpath = (pts) => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const [ax, ay] = pts[s], dx = pts[e][0] - ax, dy = pts[e][1] - ay, l = Math.hypot(dx, dy) || 1e-12;
      let m = -1, md = tol;
      for (let i = s + 1; i < e; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l; if (d > md) { md = d; m = i; } }
      if (m >= 0) { keep[m] = 1; stack.push([s, m], [m, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const half = Math.floor(ring.length / 2);
  const a = dpath(ring.slice(0, half + 1)), b = dpath([...ring.slice(half), ring[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Exact signed distance (positive inside) from (x, y) to a polygon. */
function polySd(ax, ay, bx, by, x, y) {
  let d2 = Infinity, inside = false;
  for (let e = 0; e < ax.length; e++) {
    const x1 = ax[e], y1 = ay[e], dx = bx[e] - x1, dy = by[e] - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - x1 - t * dx, ey = y - y1 - t * dy, dd = ex * ex + ey * ey;
    if (dd < d2) d2 = dd;
    if ((y1 <= y) !== (by[e] <= y) && x1 + ((y - y1) / dy) * dx > x) inside = !inside;
  }
  return inside ? Math.sqrt(d2) : -Math.sqrt(d2);
}

/**
 * Mesh minus prism. plane: { origin, n, u, v, ring2 } (core/extrude.js); the cutter fills heights w0..w1 above the plane.
 * Returns { mesh, removed } where mesh is the closed result ({ v, f }, empty when nothing is left) and removed is the
 * number of grid cells taken away (0: the cutter never touched the mesh, so there is nothing to replace).
 * resolution = grid cells along the longest side.
 */
export function cutMesh(mesh, plane, w0, w1, { resolution = 96 } = {}) {
  // Surface nets can leave an edge shared by four triangles where two sheets pass through one cell (a thin rim). That depends
  // on how the grid happens to line up, so a closed, manifold result is looked for by moving the grid a little.
  let last = null;
  for (const [dn, shift] of [[0, 0], [0, 0.37], [3, 0.5], [-3, 0.21], [7, 0.63]]) {
    const r = cutOnce(mesh, plane, w0, w1, resolution + dn, shift);
    if (!r.removed || !r.mesh.f.length || meshHealth(r.mesh).closed) return { ...r, closed: true };
    last = r;
  }
  return { ...last, closed: false };
}

function cutOnce(mesh, plane, w0, w1, resolution, shift) {
  const lo3 = [Infinity, Infinity, Infinity], hi3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.v.length; i += 3) for (let k = 0; k < 3; k++) { lo3[k] = Math.min(lo3[k], mesh.v[i + k]); hi3[k] = Math.max(hi3[k], mesh.v[i + k]); }
  const side = Math.max(hi3[0] - lo3[0], hi3[1] - lo3[1], hi3[2] - lo3[2]);
  const n = resolution, h = side / (n - 8), m = n + 2;
  const lo = [0, 1, 2].map((k) => (lo3[k] + hi3[k]) / 2 - (n * h) / 2 + shift * h);
  const A = meshField(mesh, lo, h, n);
  const F = new Float32Array(m * m * m).fill(-h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const src = (i * n + j) * n, dst = ((i + 1) * m + (j + 1)) * m + 1;
    for (let k = 0; k < n; k++) F[dst + k] = A[src + k];
  }
  // the cutter: its box in grid cells, then exact distances inside it
  const r2 = simplifyRing(plane.ring2, h / 3), E = r2.length;
  const ax = new Float64Array(E), ay = new Float64Array(E), bx = new Float64Array(E), by = new Float64Array(E);
  for (let e = 0; e < E; e++) { ax[e] = r2[e][0]; ay[e] = r2[e][1]; bx[e] = r2[(e + 1) % E][0]; by[e] = r2[(e + 1) % E][1]; }
  const bb = [Infinity, Infinity, Infinity], bt = [-Infinity, -Infinity, -Infinity];
  for (const [x, y] of r2) for (const w of [w0, w1]) for (let k = 0; k < 3; k++) {
    const p = plane.origin[k] + plane.u[k] * x + plane.v[k] * y + plane.n[k] * w;
    bb[k] = Math.min(bb[k], p); bt[k] = Math.max(bt[k], p);
  }
  const rng = (k) => [Math.max(0, Math.floor((bb[k] - lo[k]) / h - 0.5) - 2), Math.min(n - 1, Math.ceil((bt[k] - lo[k]) / h - 0.5) + 2)];
  const [i0, i1] = rng(0), [j0, j1] = rng(1), [k0, k1] = rng(2);
  let removed = 0;
  for (let i = i0; i <= i1; i++) {
    const x = lo[0] + (i + 0.5) * h;
    for (let j = j0; j <= j1; j++) {
      const y = lo[1] + (j + 0.5) * h;
      for (let k = k0; k <= k1; k++) {
        const z = lo[2] + (k + 0.5) * h;
        const dx = x - plane.origin[0], dy = y - plane.origin[1], dz = z - plane.origin[2];
        const w = dx * plane.n[0] + dy * plane.n[1] + dz * plane.n[2];
        const slab = Math.min(w - w0, w1 - w);
        if (slab < -3 * h) continue; // far above or below the cutter
        const p = Math.min(polySd(ax, ay, bx, by, dx * plane.u[0] + dy * plane.u[1] + dz * plane.u[2], dx * plane.v[0] + dy * plane.v[1] + dz * plane.v[2]), slab);
        const q = ((i + 1) * m + (j + 1)) * m + k + 1;
        if (F[q] >= 0 && p > 0) removed++;
        if (-p < F[q]) F[q] = -p;
      }
    }
  }
  if (!removed) return { mesh, removed: 0 };
  return { mesh: meshFromField(F, m, 0, lo, h), removed };
}

/** Axis-aligned box of a prism as [lo, hi], for finding which meshes a cutter can reach. */
export function prismBox(plane, w0, w1) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [x, y] of plane.ring2) for (const w of [w0, w1]) for (let k = 0; k < 3; k++) {
    const p = plane.origin[k] + plane.u[k] * x + plane.v[k] * y + plane.n[k] * w;
    lo[k] = Math.min(lo[k], p); hi[k] = Math.max(hi[k], p);
  }
  return [lo, hi];
}

export function meshBox(mesh) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.v[i + k]); hi[k] = Math.max(hi[k], mesh.v[i + k]); }
  return [lo, hi];
}

export const boxesOverlap = ([alo, ahi], [blo, bhi]) => [0, 1, 2].every((k) => alo[k] <= bhi[k] && blo[k] <= ahi[k]);
