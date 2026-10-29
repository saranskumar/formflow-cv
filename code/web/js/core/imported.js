// An imported OBJ/STL model as a scene item: fitted to the workspace and editable like any other object.
import { add, clamp } from './vec.js';
import { decimateForDisplay, fitToWorkspace, loadModel } from './meshio.js';

export class ImportedMesh {
  /** verts: local coordinates centred at the origin (already fitted). */
  constructor(name, mesh, displayTris = 1200) {
    this.kind = 'mesh';
    this.name = name;
    this.verts = mesh.v;
    this.faces = mesh.f;
    this.center = [0, 0, 0];
    this.s = 1;
    this.volumetric = true;
    this.display = decimateForDisplay(mesh, displayTris); // full mesh is kept for export
    let r2 = 0;
    for (let i = 0; i < this.verts.length; i += 3) r2 = Math.max(r2, this.verts[i] ** 2 + this.verts[i + 1] ** 2 + this.verts[i + 2] ** 2);
    this.radius0 = Math.sqrt(r2);
  }

  static fromBuffer(filename, buffer, half = 0.85) {
    const m = loadModel(filename, buffer);
    const { v } = fitToWorkspace(m.v, half);
    return new ImportedMesh(filename.replace(/\.[^.]+$/, ''), { v, f: m.f });
  }

  /** A mesh that already has scene coordinates (for example a visual hull): re-centred so picking and moving work. */
  static fromMesh(name, mesh) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.v[i + k]); hi[k] = Math.max(hi[k], mesh.v[i + k]); }
    const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    const v = new Float64Array(mesh.v.length);
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) v[i + k] = mesh.v[i + k] - c[k];
    // built here (hull, extrusion, cut): clean, regular surfaces that clustering would wreck, so they are drawn almost in full
    const it = new ImportedMesh(name, { v, f: mesh.f }, 150000);
    it.center = c;
    it.generated = true;
    return it;
  }

  get r() { return this.radius0 * this.s; }

  _place(v) {
    const out = new Float64Array(v.length);
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = v[i + k] * this.s + this.center[k];
    return out;
  }

  mesh() { return { v: this._place(this.verts), f: this.faces }; }
  displayMesh() { return { v: this._place(this.display.v), f: this.display.f }; }

  polylines() { // bounding box: used for picking and for the highlight
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.verts.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], this.verts[i + k]); hi[k] = Math.max(hi[k], this.verts[i + k]); }
    const c = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) c.push(add(this.center, [x * this.s, y * this.s, z * this.s]));
    return [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [c[a], c[b]]);
  }

  translate(d) { this.center = add(this.center, d); }
  snapshot() { return [this.center.slice(), this.s]; }
  restore(s) { this.center = s[0].slice(); this.s = s[1]; }
  scale(f) { this.s = clamp(this.s * f, 0.05, 6.0); }
}
