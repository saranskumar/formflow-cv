// Visual hull: turn closed outlines drawn in the Front, Side and Top views into a 3D shape.
//
// Each outline is a silhouette. Extruding a silhouette along its viewing direction gives a solid that certainly contains
// the object; the object must lie inside ALL of them, so the best guess is their intersection (the "visual hull").
// Two views are enough to fix all three dimensions; one view is extruded to a default thickness.
//
//   Front  looks along Z : outline lies in the (X, Y) plane      key 'z'
//   Side   looks along X : outline lies in the (Z, Y) plane      key 'x'
//   Top    looks along Y : outline lies in the (X, Z) plane      key 'y'
//
// Pipeline: classify outlines by plane -> align shared dimensions -> exact signed distance field of each silhouette
// -> the 3D field is the minimum of the three (inside only where inside all) -> keep the largest piece -> surface nets
// on the field's zero level -> triangle mesh, with a re-projection score.
// Using distances instead of 0/1 voxels puts every vertex on the true outline to a fraction of a voxel, so curved and
// slanted outlines come out smooth at any grid size, and edges stay sharp where two views meet.
//
// One view only is ambiguous about depth. It is either extruded to a slab, or (revolve: true, for round objects such as
// a bottle, vase or cup photographed from the front) spun around its vertical centre line: each row of the outline
// becomes a circle as wide as that row (a lathe).
import { Poly, meshVolume } from './shapes.js';
import { endGap, pathLength, MIN_LOOP_LENGTH } from './stitch.js';
import { taubinSmooth, meshHealth } from './meshops.js';

export const VIEWS = {
  z: { name: 'front', u: 0, v: 1 }, // outline coordinates (u, v) are world coordinate indices (0=x, 1=y, 2=z)
  x: { name: 'side', u: 2, v: 1 },
  y: { name: 'top', u: 0, v: 2 },
};
const AXIS_NAME = ['width (X)', 'height (Y)', 'depth (Z)'];
export const PLANE_FLAT = 0.02; // an outline is "on a plane" if it varies less than this along that axis
export const AUTO_CLOSE = 0.25; // an almost-closed outline with a gap smaller than this is closed for the hull
export const MISMATCH = 0.35; // views that disagree about a dimension by more than this get a warning

/** Which axis an outline is perpendicular to ('x' | 'y' | 'z'), or null if it is not drawn on an axis-aligned plane. */
export function classifyPlane(pts, flat = PLANE_FLAT) {
  const r = [0, 1, 2].map((a) => Math.max(...pts.map((p) => p[a])) - Math.min(...pts.map((p) => p[a])));
  const flatAxes = [0, 1, 2].filter((a) => r[a] < flat);
  if (flatAxes.length !== 1) return null;
  const a = flatAxes[0];
  if (!r.every((v, i) => i === a || v > 0.06)) return null; // a degenerate sliver is not an outline
  return ['x', 'y', 'z'][a];
}

const isOutlineKind = (it) => it instanceof Poly && ['free', 'line', 'rect', 'circle'].includes(it.kind) && it.pts.length >= 3;

/** Sort the scene's outlines into views. Open ones that nearly close are closed; the rest are reported. */
export function collectOutlines(items, { autoClose = AUTO_CLOSE } = {}) {
  const views = { x: [], y: [], z: [] };
  const coords = { x: [], y: [], z: [] };
  let open = 0, oblique = 0, autoClosed = 0;
  for (const it of items) {
    if (!isOutlineKind(it)) continue;
    let closed = it.closed || endGap(it.pts) < 1e-6;
    if (!closed) {
      if (pathLength(it.pts) >= MIN_LOOP_LENGTH && endGap(it.pts) <= autoClose) { closed = true; autoClosed++; }
      else { open++; continue; }
    }
    const plane = classifyPlane(it.pts);
    if (!plane) { oblique++; continue; }
    const { u, v } = VIEWS[plane];
    views[plane].push(it.pts.map((p) => [p[u], p[v]]));
    const axis = ['x', 'y', 'z'].indexOf(plane);
    coords[plane].push(it.pts.reduce((a, p) => a + p[axis], 0) / it.pts.length);
  }
  return { views, coords, open, oblique, autoClosed };
}

/** The outlines of a scene as plain data, so they can be sent to a Web Worker (class instances cannot be). */
export function outlineData(items) {
  return items.filter(isOutlineKind).map((it) => ({ kind: it.kind, pts: it.pts, closed: it.closed }));
}

/** The inverse of outlineData: Poly objects buildHull understands. */
export function outlineItems(data) {
  return data.map((o) => new Poly(o.kind, o.pts, o.closed));
}

/** What the UI shows: how many usable outlines each view has, and how many were unusable. */
export function describeOutlines(items) {
  const c = collectOutlines(items);
  const n = (k) => c.views[k].length;
  return { front: n('z'), side: n('x'), top: n('y'), open: c.open, oblique: c.oblique, autoClosed: c.autoClosed,
    viewCount: ['x', 'y', 'z'].filter((k) => n(k)).length };
}

// ------------------------------------------------------------------------------------------ rasterising
/** Filled polygons (even-odd, unioned) into an n x n mask indexed [iu * n + iv]. */
export function rasterise(polys, n, loU, loV, h) {
  const mask = new Uint8Array(n * n);
  for (const poly of polys) {
    for (let iv = 0; iv < n; iv++) {
      const vc = loV + (iv + 0.5) * h;
      const xs = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        if ((p[1] <= vc) !== (q[1] <= vc)) xs.push(p[0] + ((vc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil((xs[k] - loU) / h - 0.5));
        const b = Math.min(n - 1, Math.floor((xs[k + 1] - loU) / h - 0.5));
        for (let iu = a; iu <= b; iu++) mask[iu * n + iv] = 1;
      }
    }
  }
  return mask;
}

function largestComponent(occ, n) {
  const n2 = n * n, total = occ.length;
  const label = new Int32Array(total);
  const sizes = [0];
  const stack = new Int32Array(total); // every voxel is pushed at most once
  for (let s0 = 0; s0 < total; s0++) {
    if (!occ[s0] || label[s0]) continue;
    const id = sizes.length;
    let size = 0, sp = 0;
    stack[sp++] = s0;
    label[s0] = id;
    while (sp) {
      const c = stack[--sp];
      size++;
      const k = c % n, j = ((c - k) / n) % n, i = (c - k - j * n) / n2;
      let q;
      if (k < n - 1 && occ[(q = c + 1)] && !label[q]) { label[q] = id; stack[sp++] = q; }
      if (k > 0 && occ[(q = c - 1)] && !label[q]) { label[q] = id; stack[sp++] = q; }
      if (j < n - 1 && occ[(q = c + n)] && !label[q]) { label[q] = id; stack[sp++] = q; }
      if (j > 0 && occ[(q = c - n)] && !label[q]) { label[q] = id; stack[sp++] = q; }
      if (i < n - 1 && occ[(q = c + n2)] && !label[q]) { label[q] = id; stack[sp++] = q; }
      if (i > 0 && occ[(q = c - n2)] && !label[q]) { label[q] = id; stack[sp++] = q; }
    }
    sizes.push(size);
  }
  if (sizes.length <= 2) return { occ, pieces: sizes.length - 1 };
  let best = 1;
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const out = new Uint8Array(total);
  for (let q = 0; q < total; q++) if (label[q] === best) out[q] = 1;
  return { occ: out, pieces: sizes.length - 1 };
}

// ------------------------------------------------------------------------------------------ distance fields
/**
 * Signed distance from every cell centre of an n x n view grid to the nearest outline edge: positive inside, negative
 * outside, exact (not stepped to the grid). Several outlines are unioned (the largest value wins). Indexed [iu * n + iv].
 * Inside is decided by even-odd, like the old raster fill.
 */
export function viewSdf(polys, n, loU, loV, h) {
  const out = new Float32Array(n * n).fill(-1e9);
  for (const poly of polys) {
    const E = poly.length;
    const ax = new Float64Array(E), ay = new Float64Array(E), bx = new Float64Array(E), by = new Float64Array(E);
    for (let e = 0; e < E; e++) { const p = poly[e], q = poly[(e + 1) % E]; ax[e] = p[0]; ay[e] = p[1]; bx[e] = q[0]; by[e] = q[1]; }
    for (let iv = 0; iv < n; iv++) {
      const vc = loV + (iv + 0.5) * h;
      for (let iu = 0; iu < n; iu++) {
        const uc = loU + (iu + 0.5) * h;
        let d2 = Infinity, inside = false;
        for (let e = 0; e < E; e++) {
          const x1 = ax[e], y1 = ay[e], dx = bx[e] - x1, dy = by[e] - y1;
          const l2 = dx * dx + dy * dy;
          let t = l2 ? ((uc - x1) * dx + (vc - y1) * dy) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = uc - x1 - t * dx, ey = vc - y1 - t * dy, dd = ex * ex + ey * ey;
          if (dd < d2) d2 = dd;
          if ((y1 <= vc) !== (by[e] <= vc) && x1 + ((vc - y1) / dy) * dx > uc) inside = !inside;
        }
        const sdist = inside ? Math.sqrt(d2) : -Math.sqrt(d2), idx = iu * n + iv;
        if (sdist > out[idx]) out[idx] = sdist;
      }
    }
  }
  return out;
}

/** Leftmost and rightmost point of the outlines on each row (centre of cell row iv): for spinning a view into a round object. */
function rowSpans(polys, n, loV, h) {
  const lo = new Float64Array(n).fill(Infinity), hi = new Float64Array(n).fill(-Infinity);
  for (let iv = 0; iv < n; iv++) {
    const vc = loV + (iv + 0.5) * h;
    for (const poly of polys) for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if ((p[1] <= vc) === (q[1] <= vc)) continue;
      const x = p[0] + ((vc - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
      if (x < lo[iv]) lo[iv] = x;
      if (x > hi[iv]) hi[iv] = x;
    }
  }
  return { lo, hi };
}

// ----------------------------------------------------------------------------------------- surface nets
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/**
 * Surface nets on a scalar field F (m x m x m, index (i * m + j) * m + k, inside where F >= iso). The outermost layer
 * must be outside so every surface is closed. Each mixed cell gets one vertex, the mean of where the surface crosses its
 * edges (linear interpolation of F), so a true distance field gives a surface that is smooth to well below a voxel.
 * Padded grid index p sits at world lo + (p - 1 + 0.5) * h.
 */
export function meshFromField(F, m, iso, lo, h) {
  const cm = m - 1, mm = m * m;
  const cellId = new Int32Array(cm * cm * cm).fill(-1);
  const verts = [];
  const f = new Float32Array(8);
  const off = [0, mm, m, mm + m, 1, mm + 1, m + 1, mm + m + 1]; // CORNERS as index offsets
  const world = (p, a) => lo[a] + (p - 1 + 0.5) * h;
  for (let ci = 0; ci < cm; ci++) for (let cj = 0; cj < cm; cj++) for (let ck = 0; ck < cm; ck++) {
    const base = (ci * m + cj) * m + ck;
    let mask = 0;
    for (let q = 0; q < 8; q++) { const v = F[base + off[q]]; f[q] = v; if (v >= iso) mask |= 1 << q; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = EDGES[e][0], b = EDGES[e][1];
      if ((f[a] >= iso) === (f[b] >= iso)) continue;
      const t = (iso - f[a]) / (f[b] - f[a]);
      sx += CORNERS[a][0] + t * (CORNERS[b][0] - CORNERS[a][0]);
      sy += CORNERS[a][1] + t * (CORNERS[b][1] - CORNERS[a][1]);
      sz += CORNERS[a][2] + t * (CORNERS[b][2] - CORNERS[a][2]);
      cnt++;
    }
    cellId[(ci * cm + cj) * cm + ck] = verts.length / 3;
    verts.push(world(ci + sx / cnt, 0), world(cj + sy / cnt, 1), world(ck + sz / cnt, 2));
  }
  const faces = [];
  const cs = [cm * cm, cm, 1], vs = [mm, m, 1];
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) {
    const idx = (i * m + j) * m + k;
    const here = F[idx] >= iso;
    const c = [i, j, k];
    for (let a = 0; a < 3; a++) {
      if (c[a] + 1 >= m) continue;
      if (here === (F[idx + vs[a]] >= iso)) continue;
      const b = (a + 1) % 3, d = (a + 2) % 3;
      if (c[b] < 1 || c[d] < 1 || c[a] > cm - 1 || c[b] > cm - 1 || c[d] > cm - 1) continue;
      const cell = (i * cm + j) * cm + k;
      const q0 = cellId[cell - cs[b] - cs[d]], q1 = cellId[cell - cs[d]], q2 = cellId[cell], q3 = cellId[cell - cs[b]];
      if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
      if (here) faces.push(q0, q1, q2, q0, q2, q3);
      else faces.push(q3, q2, q1, q3, q1, q0); // reversed
    }
  }
  const mesh = { v: Float64Array.from(verts), f: Uint32Array.from(faces) };
  if (meshVolume(mesh) < 0) for (let i = 0; i < mesh.f.length; i += 3) { const t = mesh.f[i + 1]; mesh.f[i + 1] = mesh.f[i + 2]; mesh.f[i + 2] = t; }
  return mesh;
}

/** Smooth, watertight mesh of a 0/1 occupancy grid (blocky voxels softened by a [1 4 1] / 6 blur). */
export function surfaceNets(occ, n, lo, h) {
  const m = n + 2; // one voxel of empty padding all round, so every surface is closed
  let F = new Float32Array(m * m * m);
  const at = (i, j, k) => (i * m + j) * m + k;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (occ[(i * n + j) * n + k]) F[at(i + 1, j + 1, k + 1)] = 1;
  for (let axis = 0; axis < 3; axis++) {
    const G = new Float32Array(F.length);
    const step = [m * m, m, 1][axis];
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) {
      const c = at(i, j, k), pos = [i, j, k][axis];
      G[c] = (4 * F[c] + (pos > 0 ? F[c - step] : 0) + (pos < m - 1 ? F[c + step] : 0)) / 6;
    }
    F = G;
  }
  return meshFromField(F, m, 0.5, lo, h);
}

// ------------------------------------------------------------------------------------------ the hull
const iou = (a, b) => {
  let i = 0, u = 0;
  for (let s = 0; s < a.length; s++) { const x = a[s], y = b[s]; if (x && y) i++; if (x || y) u++; }
  return u ? i / u : 1;
};

/**
 * Build the hull from the scene's outlines.
 * options: n (grid size, default 64), align (make shared dimensions agree, default true), autoClose,
 * revolve (one Front or Side view only: spin it into a round object instead of extruding it),
 * smooth (iterations of Taubin smoothing of the finished mesh, 0 = none).
 * Returns { ok: true, mesh: {v, f}, stats } or { ok: false, reason, stats }.
 */
export function buildHull(items, { n = 64, align = true, autoClose = AUTO_CLOSE, revolve = false, smooth = 0 } = {}) {
  const c = collectOutlines(items, { autoClose });
  const keys = ['z', 'x', 'y'].filter((k) => c.views[k].length);
  const skipped = { open: c.open, oblique: c.oblique };
  const stats = { views: keys.map((k) => VIEWS[k].name), skipped, autoClosed: c.autoClosed, warnings: [], n };
  if (!keys.length) {
    const why = [];
    if (c.open) why.push(`${c.open} open outline${c.open > 1 ? 's' : ''} (use Join lines to close them)`);
    if (c.oblique) why.push(`${c.oblique} outline${c.oblique > 1 ? 's were' : ' was'} not drawn in a Front, Side or Top view`);
    return { ok: false, reason: `No usable outlines. ${why.join('; ')}`.trim().replace(/\.$/, '') + (why.length ? '.' : 'Draw a closed outline in the Front, Side or Top view.'), stats };
  }

  // 1. bounding box of every view, in its own (u, v) coordinates
  const info = {};
  for (const k of keys) {
    const pts = c.views[k].flat();
    const [u, v] = [VIEWS[k].u, VIEWS[k].v];
    info[k] = { u, v, lo: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], hi: [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
  }
  // 2. what each world axis measures, according to every view that sees it
  const meas = [[], [], []];
  for (const k of keys) {
    const I = info[k];
    meas[I.u].push({ k, which: 0, ext: I.hi[0] - I.lo[0], ctr: (I.hi[0] + I.lo[0]) / 2 });
    meas[I.v].push({ k, which: 1, ext: I.hi[1] - I.lo[1], ctr: (I.hi[1] + I.lo[1]) / 2 });
  }
  const target = meas.map((list) => (list.length ? {
    ext: list.reduce((a, m) => a + m.ext, 0) / list.length,
    ctr: list.reduce((a, m) => a + m.ctr, 0) / list.length,
    spread: list.length > 1 ? Math.max(...list.map((m) => m.ext)) / Math.max(Math.min(...list.map((m) => m.ext)), 1e-9) : 1,
  } : null));
  target.forEach((t, a) => { if (t && t.spread - 1 > MISMATCH) stats.warnings.push(`${AXIS_NAME[a]} differs by ${Math.round((1 - 1 / t.spread) * 100)}% between views${align ? ' (averaged)' : ''}`); });

  // 3. align: stretch and shift each view so shared dimensions agree
  const polys = {};
  for (const k of keys) {
    const I = info[k];
    const map = [0, 1].map((w) => {
      const a = w === 0 ? I.u : I.v;
      const m = meas[a].find((q) => q.k === k && q.which === w);
      const t = target[a];
      return align && m.ext > 1e-9 ? (val) => (val - m.ctr) * (t.ext / m.ext) + t.ctr : (val) => val;
    });
    polys[k] = c.views[k].map((poly) => poly.map((p) => [map[0](p[0]), map[1](p[1])]));
  }
  // axis extents of the final grid; an axis nobody measures (single view) gets a default thickness
  const ext = [0, 1, 2].map((a) => (target[a] ? (align ? target[a].ext : Math.max(...meas[a].map((m) => m.ext))) : 0));
  const ctr = [0, 1, 2].map((a) => (target[a] ? target[a].ctr : 0));
  let slab = null, lathe = null;
  if (keys.length === 1) {
    const k = keys[0], axis = ['x', 'y', 'z'].indexOf(k);
    const others = [0, 1, 2].filter((a) => a !== axis);
    ctr[axis] = c.coords[k].reduce((a, b) => a + b, 0) / c.coords[k].length;
    if (revolve && k !== 'y') { // Front or Side: spin around the vertical (Y) centre line
      ext[axis] = ext[VIEWS[k].u];
      lathe = { axis, ua: VIEWS[k].u, view: k };
      stats.round = true;
      stats.warnings.push('One view, round object: the outline is spun around its centre line.');
    } else {
      const t = Math.max(0.3, 0.5 * Math.min(ext[others[0]], ext[others[1]]));
      ext[axis] = t;
      slab = { axis, half: t / 2 };
      stats.warnings.push('Only one view: the shape is extruded. Draw a second view for a true hull, or use Round for a round object.');
    }
  }
  const L = Math.max(...ext, 0.2) * 1.1;
  const lo = ctr.map((v) => v - L / 2);
  const h = L / n;

  // 4. one signed distance field per view (positive inside), then the 3D field: inside only where inside every view
  const sd = {}, masks = {};
  for (const k of keys) {
    sd[k] = viewSdf(polys[k], n, lo[info[k].u], lo[info[k].v], h);
    masks[k] = new Uint8Array(n * n);
    for (let q = 0; q < masks[k].length; q++) masks[k][q] = sd[k][q] > 0 ? 1 : 0;
  }
  // lathe: the centre and half-width of every row (j = height index) of the one view, exact from the outline
  let rowC = null, rowR = null;
  if (lathe) {
    const sp = rowSpans(polys[lathe.view], n, lo[1], h);
    rowC = new Float64Array(n); rowR = new Float64Array(n).fill(-1);
    for (let j = 0; j < n; j++) if (sp.hi[j] > sp.lo[j]) { rowC[j] = (sp.lo[j] + sp.hi[j]) / 2; rowR[j] = (sp.hi[j] - sp.lo[j]) / 2; }
  }
  const m = n + 2, mm = m * m;
  const F = new Float32Array(m * m * m).fill(-h); // padding layer = outside
  let occ = new Uint8Array(n * n * n);
  let voxels = 0;
  const sdz = sd.z, sdx = sd.x, sdy = sd.y;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let kk = 0; kk < n; kk++) {
    let v = Infinity;
    if (sdz && sdz[i * n + j] < v) v = sdz[i * n + j]; // front: (x, y)
    if (sdx && sdx[kk * n + j] < v) v = sdx[kk * n + j]; // side:  (z, y)
    if (sdy && sdy[i * n + kk] < v) v = sdy[i * n + kk]; // top:   (x, z)
    if (slab) {
      const p = lo[slab.axis] + ([i, j, kk][slab.axis] + 0.5) * h;
      v = Math.min(v, slab.half - Math.abs(p - ctr[slab.axis]));
    }
    if (lathe) {
      if (rowR[j] < 0) v = -h;
      else {
        const idx = [i, j, kk];
        const du = lo[lathe.ua] + (idx[lathe.ua] + 0.5) * h - rowC[j];
        const dd = lo[lathe.axis] + (idx[lathe.axis] + 0.5) * h - ctr[lathe.axis];
        v = Math.min(v, rowR[j] - Math.hypot(du, dd));
      }
    }
    F[(i + 1) * mm + (j + 1) * m + kk + 1] = v;
    if (v > 0) { occ[(i * n + j) * n + kk] = 1; voxels++; }
  }
  if (!voxels) return { ok: false, reason: 'The views do not overlap: their outlines describe no common shape. Check that each view is drawn around the same centre.', stats };
  const lc = largestComponent(occ, n);
  if (lc.pieces > 1) { // drop the smaller pieces from the field too
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let kk = 0; kk < n; kk++) {
      const q = (i * n + j) * n + kk;
      if (occ[q] && !lc.occ[q]) F[(i + 1) * mm + (j + 1) * m + kk + 1] = -1e-3 * h;
    }
    stats.warnings.push(`${lc.pieces} separate pieces: kept the largest`);
  }
  occ = lc.occ;
  voxels = occ.reduce((a, b) => a + b, 0);

  // 5. how well does the hull explain each drawing? (re-projection overlap)
  stats.iou = {};
  const proj = { z: new Uint8Array(n * n), x: new Uint8Array(n * n), y: new Uint8Array(n * n) };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let kk = 0; kk < n; kk++) {
    if (!occ[(i * n + j) * n + kk]) continue;
    proj.z[i * n + j] = 1; proj.x[kk * n + j] = 1; proj.y[i * n + kk] = 1;
  }
  for (const k of keys) stats.iou[VIEWS[k].name] = iou(masks[k], proj[k]);

  // 6. surface at the zero level of the field, then optional smoothing
  const mesh = meshFromField(F, m, 0, lo, h);
  if (smooth > 0) taubinSmooth(mesh, smooth);
  const health = meshHealth(mesh);
  stats.voxels = voxels;
  stats.triangles = mesh.f.length / 3;
  stats.volume = meshVolume(mesh);
  stats.size = ext.map((e) => +e.toFixed(3));
  stats.watertight = health.closed;
  stats.smooth = smooth;
  if (!health.closed) stats.warnings.push('The surface has small holes or non-manifold edges; it may need repair before printing.');
  return { ok: true, mesh, stats };
}

// ---------------------------------------------------------------------- shared dimensions (3-plane workspace)
const ranges = (pts, a, b) => [[Math.min(...pts.map((p) => p[a])), Math.max(...pts.map((p) => p[a]))], [Math.min(...pts.map((p) => p[b])), Math.max(...pts.map((p) => p[b]))]];

/** What has been drawn in each view, as the extent along each of its two axes (null where nothing is drawn). */
export function viewExtents(items) {
  const out = { front: null, side: null, top: null };
  const names = { z: 'front', x: 'side', y: 'top' };
  for (const it of items) {
    if (!(it instanceof Poly) || !['free', 'line', 'rect', 'circle'].includes(it.kind) || it.pts.length < 3) continue;
    const plane = classifyPlane(it.pts);
    if (!plane) continue;
    const [uR, vR] = ranges(it.pts, VIEWS[plane].u, VIEWS[plane].v);
    const cur = out[names[plane]];
    out[names[plane]] = cur ? { u: [Math.min(cur.u[0], uR[0]), Math.max(cur.u[1], uR[1])], v: [Math.min(cur.v[0], vR[0]), Math.max(cur.v[1], vR[1])] } : { u: uR, v: vR };
  }
  return out;
}

const span = (r) => r[1] - r[0];

/**
 * Each world axis is measured by two views (width X: front and top; height Y: front and side; depth Z: top and side).
 * Returns the union range per axis, and which axes the views disagree about by more than `tol`.
 */
export function sharedDimensions(items, tol = 0.15) {
  const e = viewExtents(items);
  const pairs = {
    x: [['front', e.front && e.front.u], ['top', e.top && e.top.u]],
    y: [['front', e.front && e.front.v], ['side', e.side && e.side.v]],
    z: [['top', e.top && e.top.v], ['side', e.side && e.side.u]],
  };
  const names = { x: 'width', y: 'height', z: 'depth' };
  const result = { ranges: {}, mismatch: {}, warnings: [] };
  for (const k of ['x', 'y', 'z']) {
    const have = pairs[k].filter(([, r]) => r);
    result.ranges[k] = have.length ? [Math.min(...have.map(([, r]) => r[0])), Math.max(...have.map(([, r]) => r[1]))] : null;
    result.mismatch[k] = false;
    if (have.length === 2) {
      const [a, b] = [span(have[0][1]), span(have[1][1])];
      const rel = Math.abs(a - b) / Math.max(a, b, 1e-9);
      if (rel > tol) {
        result.mismatch[k] = true;
        result.warnings.push(`${have[0][0]} and ${have[1][0]} disagree about the ${names[k]}: ${a.toFixed(2)} vs ${b.toFixed(2)} (${Math.round(rel * 100)}% apart)`);
      }
    }
  }
  return result;
}
