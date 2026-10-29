// Load OBJ and STL models into plain {v: Float64Array(3n), f: Uint32Array(3m)} meshes. No dependencies.
//   OBJ: `v` and `f` (v, v/vt, v//vn, v/vt/vn, negative indices; polygons fan-triangulated)
//   STL: binary and ASCII; duplicate corner vertices are welded
import { add, sub, mul, dot, cross, norm } from './vec.js';

export const MAX_FILE_MB = 80;

export class MeshError extends Error {
  constructor(msg) { super(msg); this.name = 'MeshError'; }
}

export function parseOBJ(text) {
  const verts = [];
  const faces = [];
  for (const raw of text.split('\n')) {
    if (raw.startsWith('v ')) {
      const p = raw.trim().split(/\s+/);
      const x = Number(p[1]), y = Number(p[2]), z = Number(p[3]);
      if (p.length < 4 || [x, y, z].some(Number.isNaN)) throw new MeshError('Malformed vertex line in OBJ');
      verts.push(x, y, z);
    } else if (raw.startsWith('f ')) {
      const idx = [];
      for (const tok of raw.trim().split(/\s+/).slice(1)) {
        const i = parseInt(tok.split('/')[0], 10);
        if (Number.isNaN(i)) throw new MeshError('Malformed face line in OBJ');
        idx.push(i > 0 ? i - 1 : verts.length / 3 + i); // negative = relative to the end
      }
      for (let k = 1; k < idx.length - 1; k++) faces.push(idx[0], idx[k], idx[k + 1]);
    }
  }
  if (!verts.length) throw new MeshError('OBJ has no vertices');
  return { v: Float64Array.from(verts), f: Uint32Array.from(faces) };
}

export function parseSTL(buffer) {
  const dv = new DataView(buffer);
  if (buffer.byteLength >= 84) {
    const n = dv.getUint32(80, true);
    if (buffer.byteLength === 84 + 50 * n) { // exact size match = binary
      if (n === 0) throw new MeshError('STL has no triangles');
      const corners = new Float64Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; // skip the normal
        for (let k = 0; k < 9; k++) corners[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return weld(corners);
    }
  }
  const text = new TextDecoder().decode(buffer);
  const found = [...text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)];
  if (!found.length || found.length % 3) throw new MeshError('STL is neither valid binary nor valid ASCII');
  const corners = new Float64Array(found.length * 3);
  found.forEach((m, i) => { for (let k = 0; k < 3; k++) corners[i * 3 + k] = Number(m[k + 1]); });
  if (corners.some(Number.isNaN)) throw new MeshError('Malformed vertex in ASCII STL');
  return weld(corners);
}

/** Triangle-soup corners -> shared vertices + faces. */
function weld(corners) {
  const map = new Map();
  const v = [];
  const f = new Uint32Array(corners.length / 3);
  for (let i = 0; i < corners.length; i += 3) {
    const key = `${Math.round(corners[i] * 1e5)},${Math.round(corners[i + 1] * 1e5)},${Math.round(corners[i + 2] * 1e5)}`;
    let id = map.get(key);
    if (id === undefined) { id = v.length / 3; map.set(key, id); v.push(corners[i], corners[i + 1], corners[i + 2]); }
    f[i / 3] = id;
  }
  return { v: Float64Array.from(v), f };
}

export function cleanMesh({ v, f }) {
  const nv = v.length / 3;
  if (!f.length) throw new MeshError('File has no faces');
  for (const i of f) if (i >= nv) throw new MeshError('Face refers to a vertex that does not exist');
  if (v.some((x) => !Number.isFinite(x))) throw new MeshError('Mesh contains invalid numbers');
  const keep = [];
  for (let i = 0; i < f.length; i += 3) {
    if (f[i] !== f[i + 1] && f[i + 1] !== f[i + 2] && f[i] !== f[i + 2]) keep.push(f[i], f[i + 1], f[i + 2]);
  }
  if (!keep.length) throw new MeshError('All faces are degenerate');
  const remap = new Int32Array(nv).fill(-1);
  const nvOut = [];
  const fOut = new Uint32Array(keep.length);
  keep.forEach((id, i) => {
    if (remap[id] < 0) { remap[id] = nvOut.length / 3; nvOut.push(v[3 * id], v[3 * id + 1], v[3 * id + 2]); }
    fOut[i] = remap[id];
  });
  return { v: Float64Array.from(nvOut), f: fOut };
}

/** Load a model from raw file bytes; throws MeshError with a readable message. */
export function loadModel(filename, buffer) {
  if (buffer.byteLength > MAX_FILE_MB * 1024 * 1024) throw new MeshError(`File is larger than ${MAX_FILE_MB} MB`);
  const ext = filename.toLowerCase().split('.').pop();
  let mesh;
  if (ext === 'obj') mesh = parseOBJ(new TextDecoder().decode(buffer));
  else if (ext === 'stl') mesh = parseSTL(buffer);
  else throw new MeshError('Only .obj and .stl files can be imported');
  return cleanMesh(mesh);
}

/** Centre on the origin and scale to fit [-half, half]^3, whatever the original units. */
export function fitToWorkspace(v, half = 0.85) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]); }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  if (!(extent > 0)) throw new MeshError('Mesh has zero size');
  const s = (2 * half) / extent;
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = (v[i + k] - (lo[k] + hi[k]) / 2) * s;
  return { v: out, scale: s };
}

function cluster(v, f, n, lo, extent) {
  const map = new Map();
  const sums = [];
  const inv = new Int32Array(v.length / 3);
  for (let i = 0; i < inv.length; i++) {
    const c = [0, 1, 2].map((k) => Math.floor(((v[3 * i + k] - lo[k]) / extent) * (n - 1e-6)));
    const key = (c[0] * n + c[1]) * n + c[2];
    let id = map.get(key);
    if (id === undefined) { id = sums.length; map.set(key, id); sums.push([0, 0, 0, 0]); }
    inv[i] = id;
    const s = sums[id];
    s[0] += v[3 * i]; s[1] += v[3 * i + 1]; s[2] += v[3 * i + 2]; s[3]++;
  }
  const nv = new Float64Array(sums.length * 3);
  sums.forEach((s, i) => { nv[3 * i] = s[0] / s[3]; nv[3 * i + 1] = s[1] / s[3]; nv[3 * i + 2] = s[2] / s[3]; });
  const nf = [];
  for (let i = 0; i < f.length; i += 3) {
    const a = inv[f[i]], b = inv[f[i + 1]], c = inv[f[i + 2]];
    if (a !== b && b !== c && a !== c) nf.push(a, b, c);
  }
  return { v: nv, f: Uint32Array.from(nf) };
}

/** Vertex-clustering decimation so a huge model still draws at full frame rate. Export keeps the full mesh. */
export function decimateForDisplay({ v, f }, maxTris = 2500) {
  if (f.length / 3 <= maxTris) return { v, f };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]); }
  const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
  let best = null;
  for (const n of [12, 16, 24, 32, 48, 64, 96, 128, 192, 256]) {
    const m = cluster(v, f, n, lo, extent);
    if (m.f.length / 3 > maxTris) break;
    best = m;
  }
  if (best) return best;
  const sel = new Uint32Array(maxTris * 3);
  for (let i = 0; i < maxTris; i++) {
    const t = Math.floor((i * (f.length / 3 - 1)) / (maxTris - 1));
    sel.set(f.subarray(3 * t, 3 * t + 3), 3 * i);
  }
  return { v, f: sel };
}

export function faceNormals({ v, f }) {
  const n = new Float64Array(f.length);
  for (let i = 0; i < f.length; i += 3) {
    const g = (id) => [v[3 * id], v[3 * id + 1], v[3 * id + 2]];
    const nn = norm(cross(sub(g(f[i + 1]), g(f[i])), sub(g(f[i + 2]), g(f[i]))));
    n.set(nn, i);
  }
  return n;
}

export { add, mul, dot };
