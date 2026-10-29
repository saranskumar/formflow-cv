// Three.js (WebGL) view of a Sketch. The engine owns all state; this module only draws it, every frame, on the GPU.
import * as THREE from '../../vendor/three.module.js';
import { FOV_DEG } from '../core/sketch.js';
import { add, mul } from '../core/vec.js';
import { PLANE_VIEWS, RANGE } from '../core/planes.js';

const COL = {
  solid: 0xE8890C, flat: 0x1473E6, preview: 0x1F2328, hot: 0x1F2328, floor: 0xB8BCC4, cube: 0x9AA1AC,
  axisX: 0xeb5050, axisY: 0x6ed26e, axisZ: 0x46aaeb, glass: 0x1473E6, mesh: 0x9AA6B8,
};
const TOP = new THREE.Color(0x1473E6); // freehand gradient: low = amber, high = mint
const BOT = new THREE.Color(0xE8590C);
const UP = new THREE.Vector3(0, 1, 0);
const AXIS_COL = [COL.axisX, COL.axisY, COL.axisZ];
const SPAN = RANGE + 0.3;

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function segmentsGeometry(polylines) {
  const pos = [];
  for (const pl of polylines) for (let i = 0; i < pl.length - 1; i++) pos.push(...pl[i], ...pl[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** A thick polyline: one instanced cylinder per segment (WebGL lines are always 1 px wide). */
function thickLine(pts, color, radius = 0.011, gradient = false) {
  const n = Math.max(pts.length - 1, 0);
  const geo = new THREE.CylinderGeometry(radius, radius, 1, 6, 1, false);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(n, 1));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  const base = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const a = v3(pts[i]), b = v3(pts[i + 1]);
    const dir = b.clone().sub(a);
    const len = dir.length() || 1e-6;
    q.setFromUnitVectors(UP, dir.clone().divideScalar(len));
    s.set(1, len, 1);
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, s);
    mesh.setMatrixAt(i, m);
    if (gradient) c.copy(BOT).lerp(TOP, Math.min(Math.max((pts[i][1] + 1) / 2, 0), 1));
    else c.copy(base);
    mesh.setColorAt(i, c);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function meshGeometry({ v, f }, flat = true) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(v), 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(f), 1));
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/**
 * A mesh drawn smooth where the surface is smooth and sharp where it has an edge. Each corner of a triangle is shaded with the
 * average normal of the triangles around that vertex that lean no more than `creaseDeg` away from its own triangle, so a
 * rounded nose cone looks round while the fins of a rocket and the corners of a box stay crisp (flat shading would show every
 * voxel step of a generated surface).
 */
function creasedGeometry({ v, f }, creaseDeg = 38) {
  const nt = f.length / 3, nv = v.length / 3, cosC = Math.cos((creaseDeg * Math.PI) / 180);
  const fn = new Float32Array(nt * 3), area = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = f[3 * t] * 3, b = f[3 * t + 1] * 3, c = f[3 * t + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    const x = uy * wz - uz * wy, y = uz * wx - ux * wz, z = ux * wy - uy * wx, l = Math.hypot(x, y, z) || 1;
    fn[3 * t] = x / l; fn[3 * t + 1] = y / l; fn[3 * t + 2] = z / l; area[t] = l;
  }
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < f.length; i++) start[f[i] + 1]++;
  for (let i = 0; i < nv; i++) start[i + 1] += start[i];
  const fill = start.slice(0, nv), adj = new Uint32Array(f.length);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) adj[fill[f[3 * t + k]]++] = t;
  const pos = new Float32Array(f.length * 3), nor = new Float32Array(f.length * 3);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const vid = f[3 * t + k], o = (3 * t + k) * 3;
    pos[o] = v[3 * vid]; pos[o + 1] = v[3 * vid + 1]; pos[o + 2] = v[3 * vid + 2];
    let x = 0, y = 0, z = 0;
    for (let q = start[vid]; q < start[vid + 1]; q++) {
      const u = adj[q];
      if (fn[3 * u] * fn[3 * t] + fn[3 * u + 1] * fn[3 * t + 1] + fn[3 * u + 2] * fn[3 * t + 2] < cosC) continue;
      x += fn[3 * u] * area[u]; y += fn[3 * u + 1] * area[u]; z += fn[3 * u + 2] * area[u];
    }
    const l = Math.hypot(x, y, z) || 1;
    nor[o] = x / l; nor[o + 1] = y / l; nor[o + 2] = z / l;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

export class SceneView {
  constructor(canvas, sketch) {
    this.sketch = sketch;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.key = new THREE.DirectionalLight(0xffffff, 0.9);
    this.scene.add(this.key, this.key.target);
    this.cache = new Map(); // item -> { group, stamp }
    this.dynamic = new THREE.Group(); // preview + highlight, rebuilt each frame
    this.scene.add(this.dynamic);
    this._buildStatic();
    this.resize();
  }

  _buildStatic() {
    const grid = [];
    for (let i = -4; i <= 4; i++) { const t = i / 4; grid.push([[t, -1, -1], [t, -1, 1]], [[-1, -1, t], [1, -1, t]]); }
    this.persp = new THREE.Group(); // decorations of the perspective view, hidden in the flat drawing cells
    this.scene.add(this.persp);
    this.persp.add(new THREE.LineSegments(segmentsGeometry(grid), new THREE.LineBasicMaterial({ color: COL.floor })));
    const k = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].map(([a, b]) => [k[a], k[b]]);
    this.persp.add(new THREE.LineSegments(segmentsGeometry(e), new THREE.LineBasicMaterial({ color: COL.cube })));
    for (const [end, col] of [[[1.3, 0, 0], COL.axisX], [[0, 1.3, 0], COL.axisY], [[0, 0, 1.3], COL.axisZ]]) {
      this.persp.add(thickLine([[0, 0, 0], end], col, 0.006));
    }
    this._buildFlatGrids();
    const gp = new THREE.BufferGeometry();
    gp.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3));
    this.glass = new THREE.Line(gp, new THREE.LineBasicMaterial({ color: COL.glass, transparent: true, opacity: 0.8 }));
    this.glass.frustumCulled = false;
    this.persp.add(this.glass);
    this.cursorDot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc85a }));
    this.dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
      new THREE.LineBasicMaterial({ color: 0x9AA1AC }));
    this.dropLine.frustumCulled = false;
    this.persp.add(this.dropLine);
    this.scene.add(this.cursorDot);
  }

  /** One grid per flat view, lying in that view's plane: 0.25 spacing, the workspace square, and the two axes through the origin. */
  _buildFlatGrids() {
    this.grids = {};
    for (const [name, v] of Object.entries(PLANE_VIEWS)) {
      const at = (a, b) => [0, 1, 2].map((k) => v.right[k] * a + v.up[k] * b);
      const g = new THREE.Group();
      const minor = [], frame = [];
      for (let i = -5; i <= 5; i++) { const t = i * 0.25; if (Math.abs(t) > 1.26) continue; minor.push([at(t, -SPAN), at(t, SPAN)], [at(-SPAN, t), at(SPAN, t)]); }
      frame.push([at(-1, -1), at(1, -1)], [at(1, -1), at(1, 1)], [at(1, 1), at(-1, 1)], [at(-1, 1), at(-1, -1)]);
      g.add(new THREE.LineSegments(segmentsGeometry(minor), new THREE.LineBasicMaterial({ color: 0xD0D3D9 })));
      g.add(new THREE.LineSegments(segmentsGeometry(frame), new THREE.LineBasicMaterial({ color: COL.cube })));
      const axisOf = (dir) => dir.findIndex((x) => x !== 0);
      g.add(new THREE.LineSegments(segmentsGeometry([[at(-SPAN, 0), at(SPAN, 0)]]), new THREE.LineBasicMaterial({ color: AXIS_COL[axisOf(v.right)], transparent: true, opacity: 0.55 })));
      g.add(new THREE.LineSegments(segmentsGeometry([[at(0, -SPAN), at(0, SPAN)]]), new THREE.LineBasicMaterial({ color: AXIS_COL[axisOf(v.up)], transparent: true, opacity: 0.55 })));
      g.visible = false;
      this.scene.add(g);
      this.grids[name] = g;
    }
    this.hullMesh = null;
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  }

  /** Translucent live hull shown in the preview cell. mesh = {v, f} or null. */
  setHull(mesh) {
    if (this.hullMesh) { this.scene.remove(this.hullMesh); dispose(this.hullMesh); this.hullMesh = null; }
    if (!mesh) return;
    this.hullMesh = new THREE.Mesh(meshGeometry(mesh, false), new THREE.MeshStandardMaterial({
      color: 0x1473E6, transparent: true, opacity: 0.55, roughness: 0.6, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.hullMesh.visible = false;
    this.scene.add(this.hullMesh);
  }

  /** Drawing resolution (1 = one pixel per CSS pixel). Lower = faster on a high-resolution screen. */
  setPixelRatio(r) {
    this.pixelRatio = r;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  static stamp(it) {
    if (it.kind === 'mesh') return 'm'; // its size is applied to the group, so scaling never rebuilds the surface
    if (it.volumetric) return `s|${it.r}`;
    const p = it.pts, n = p.length;
    return `p|${n}|${p[0]}|${p[n - 1]}|${p[n >> 1]}`;
  }

  _build(it, color, preview = false) {
    const g = new THREE.Group();
    if (it.kind === 'mesh') {
      const local = { v: it.display.v, f: it.display.f };
      const mesh = new THREE.Mesh(creasedGeometry(local), new THREE.MeshStandardMaterial({
        color: COL.mesh, roughness: 0.65, metalness: 0.05, side: THREE.DoubleSide,
      }));
      mesh.name = 'body';
      g.add(mesh);
    } else if (it.volumetric) {
      const m = it.mesh();
      const local = { v: Float64Array.from(m.v, (x, i) => x - it.center[i % 3]), f: m.f };
      const fill = new THREE.Mesh(meshGeometry(local, false), new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: preview ? 0.14 : 0.2, depthWrite: false, side: THREE.DoubleSide,
      }));
      g.add(fill);
      const wire = segmentsGeometry(it.polylines().map((pl) => pl.map((p) => [p[0] - it.center[0], p[1] - it.center[1], p[2] - it.center[2]])));
      g.add(new THREE.LineSegments(wire, new THREE.LineBasicMaterial({ color })));
    } else {
      g.add(thickLine(it.pts, color, 0.011, it.kind === 'free' && !preview));
    }
    return g;
  }

  _sync() {
    const live = new Set(this.sketch.items);
    for (const [it, e] of this.cache) if (!live.has(it)) { this.scene.remove(e.group); dispose(e.group); this.cache.delete(it); }
    for (const it of this.sketch.items) {
      const stamp = SceneView.stamp(it);
      let e = this.cache.get(it);
      if (!e || e.stamp !== stamp) {
        if (e) { this.scene.remove(e.group); dispose(e.group); }
        const color = it.volumetric ? COL.solid : COL.flat;
        e = { group: this._build(it, color), stamp };
        this.scene.add(e.group);
        this.cache.set(it, e);
      }
      if (it.volumetric) e.group.position.set(...it.center);
      if (it.kind === 'mesh') e.group.scale.setScalar(it.s);
    }
  }

  _dynamic(rect) {
    this.dynamic.children.slice().forEach((c) => { this.dynamic.remove(c); dispose(c); });
    const s = this.sketch;
    const pv = s.preview();
    if (pv) {
      const g = this._build(pv, pv.color || COL.preview, true);
      if (pv.volumetric) g.position.set(...pv.center);
      this.dynamic.add(g);
    }
    if (s.joinHint) { // the gap the user is being asked to close
      const [a, b] = s.joinHint;
      this.dynamic.add(thickLine([a, b], 0xE8590C, 0.014));
      for (const p of [a, b]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), new THREE.MeshBasicMaterial({ color: 0xE8590C }));
        dot.position.set(...p);
        this.dynamic.add(dot);
      }
    }
    for (const gl of (s.layout && this.guides) || []) { // shared-dimension guide lines, drawn only in the views they belong to
      const line = thickLine(gl.pts, gl.color, 0.004);
      line.userData.view = gl.view;
      this.dynamic.add(line);
    }
    if (s.hot) {
      const box = segmentsGeometry(s.hot.polylines().length > 0 && s.hot.kind === 'mesh' ? s.hot.polylines() : s.hot.polylines());
      this.dynamic.add(new THREE.LineSegments(box, new THREE.LineBasicMaterial({ color: COL.hot })));
    }
  }

  render(rect) {
    if (this.sketch.layout) return this._renderPlanes();
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.persp.visible = true;
    for (const g of Object.values(this.grids)) g.visible = false;
    if (this.hullMesh) this.hullMesh.visible = false;
    this._setItemsVisible(() => true);
    this._renderMain(rect);
  }

  _setItemsVisible(fn) {
    for (const [it, e] of this.cache) e.group.visible = fn(it);
  }

  /** The 3-plane workspace: three orthographic drawing cells and a perspective preview, one canvas, four viewports. */
  _renderPlanes() {
    const s = this.sketch, L = s.layout;
    const W = window.innerWidth, H = window.innerHeight;
    this._sync();
    this._dynamic();
    this.cursorDot.visible = !!s.cursor;
    if (s.cursor) this.cursorDot.position.set(...s.cursor);
    const r = this.renderer;
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.clear();
    r.setScissorTest(true);
    const dist = 12;
    for (const name of ['top', 'front', 'side', 'preview']) {
      const c = L.cells[name];
      if (c.w <= 0 || c.h <= 0) continue; // a view that is not open
      const vy = H - c.y - c.h;
      r.setViewport(c.x, vy, c.w, c.h);
      r.setScissor(c.x, vy, c.w, c.h);
      const flat = name !== 'preview';
      this.persp.visible = !flat;
      for (const [n, g] of Object.entries(this.grids)) g.visible = flat && n === name;
      if (this.hullMesh) this.hullMesh.visible = !flat;
      this._setItemsVisible((it) => !(flat && it.kind === 'mesh'));
      this.dynamic.children.forEach((o) => { o.visible = !o.userData.view || o.userData.view === name; });
      if (flat) {
        const v = PLANE_VIEWS[name];
        const hw = c.w / 2 / L.scale, hh = c.h / 2 / L.scale;
        Object.assign(this.ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
        this.ortho.updateProjectionMatrix();
        const axis = { z: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] }[v.axis];
        this.ortho.position.set(axis[0] * dist, axis[1] * dist, axis[2] * dist);
        this.ortho.up.set(...v.up);
        this.ortho.lookAt(0, 0, 0);
        this.key.position.set(axis[0] * 5, axis[1] * 5, axis[2] * 5);
        r.render(this.scene, this.ortho);
      } else {
        this._aim(c.w / c.h);
        r.render(this.scene, this.camera);
      }
    }
    r.setScissorTest(false);
  }

  _aim(aspect) {
    const s = this.sketch;
    const { eye, fwd, right, up } = s.basis();
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(...eye);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(...add(eye, fwd));
    this.key.position.set(...add(eye, add(mul(up, 2), mul(right, -2))));
    this.key.target.position.set(...s.target);
    return { eye, fwd, right, up };
  }

  _renderMain(rect) {
    const s = this.sketch;
    const { eye, fwd, right, up } = this._aim(window.innerWidth / window.innerHeight);
    this.dynamic.children.forEach((o) => { o.visible = !o.userData.view; });

    // the drawing plane ("glass") at the current depth
    const centre = add(eye, mul(fwd, s.dist - s.depth));
    const half = (1.1 * (s.dist - s.depth)) / s.dist;
    const corner = (a, b) => add(centre, add(mul(right, a * half), mul(up, b * half)));
    const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
    const pa = this.glass.geometry.attributes.position;
    q.forEach((p, i) => pa.setXYZ(i, ...p));
    pa.needsUpdate = true;

    // 3D cursor with a drop line to the floor
    const c = s.cursor;
    this.cursorDot.visible = this.dropLine.visible = !!c;
    if (c) {
      this.cursorDot.position.set(...c);
      const pos = this.dropLine.geometry.attributes.position;
      pos.setXYZ(0, ...c);
      pos.setXYZ(1, c[0], -1, c[2]);
      pos.needsUpdate = true;
    }
    this._sync();
    this._dynamic(rect);
    this.renderer.render(this.scene, this.camera);
  }
}
