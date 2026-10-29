import test from 'node:test';
import assert from 'node:assert/strict';
import { Solid, Poly, TOOLS_3D, buildItem, meshVolume, normalizePolyline } from '../js/core/shapes.js';
import { parseOBJ, parseSTL, loadModel, fitToWorkspace, decimateForDisplay, MeshError } from '../js/core/meshio.js';
import { ImportedMesh } from '../js/core/imported.js';
import { sceneToOBJ, sceneToSTL } from '../js/core/exporters.js';

const close = (a, b, rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const buf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const enc = (s) => buf(new TextEncoder().encode(s));

function cubeOBJ(size = 1, off = 0, style = 'plain') {
  const v = [];
  for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) v.push(`v ${x * size + off} ${y * size + off} ${z * size + off}`);
  const quads = [[1, 3, 4, 2], [5, 6, 8, 7], [1, 2, 6, 5], [3, 7, 8, 4], [1, 5, 7, 3], [2, 4, 8, 6]];
  const faces = quads.map((q) => 'f ' + q.map((i) => (style === 'slash' ? `${i}/1/1` : style === 'neg' ? i - 9 : i)).join(' '));
  return [...v, ...faces].join('\n');
}

// ---------------------------------------------------------------- solids
for (const kind of TOOLS_3D) {
  test(`${kind}: closed manifold with outward winding`, () => {
    const m = new Solid(kind, [0.2, -0.1, 0.3], 0.5).mesh();
    assert.ok(meshVolume(m) > 0.05);
    const edges = new Map();
    for (let i = 0; i < m.f.length; i += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const key = [m.f[i + a], m.f[i + b]].sort((x, y) => x - y).join('-');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    assert.deepEqual([...new Set(edges.values())], [2]);
  });
}

test('known volumes match their formulas', () => {
  const c = [0, 0, 0];
  close(meshVolume(new Solid('cube', c, 1).mesh()), 1.6 ** 3);
  assert.ok(Math.abs(meshVolume(new Solid('sphere', c, 1).mesh()) / ((4 / 3) * Math.PI) - 1) < 0.05);
  assert.ok(Math.abs(meshVolume(new Solid('cylinder', c, 1).mesh()) / (Math.PI * 0.49 * 2) - 1) < 0.03);
  assert.ok(Math.abs(meshVolume(new Solid('cone', c, 1).mesh()) / ((Math.PI * 0.49 * 2) / 3) - 1) < 0.03);
  close(meshVolume(new Solid('pyramid', c, 1).mesh()), (1.6 ** 2 * 2) / 3);
});

test('build items from a drag', () => {
  const R = [1, 0, 0], U = [0, 1, 0];
  const a = [0, 0, 0], b = [0.4, 0.3, 0];
  close(buildItem('cube', a, b, R, U).r, 0.5);
  const rect = buildItem('rect', a, b, R, U);
  assert.equal(rect.pts.length, 5);
  assert.deepEqual(rect.pts[2], b);
  const circ = buildItem('circle', a, b, R, U);
  assert.ok(circ.pts.every((p) => Math.abs(Math.hypot(...p) - 0.5) < 1e-9));
  assert.equal(buildItem('sphere', a, [0.01, 0.01, 0], R, U), null);
});

test('translate, scale and snapshot/restore', () => {
  const s = new Solid('cube', [0, 0, 0], 1);
  const snap = s.snapshot();
  s.translate([1, 0, 0]);
  s.scale(100);
  assert.equal(s.r, 2.0); // clamped
  s.restore(snap);
  assert.deepEqual(s.center, [0, 0, 0]);
  assert.equal(s.r, 1);
  const p = new Poly('line', [[0, 0, 0], [2, 0, 0]]);
  p.scale(2);
  assert.deepEqual(p.pts, [[-1, 0, 0], [3, 0, 0]]);
});

// ----------------------------------------------------------- normalisation
test('stroke normalisation: even spacing, pinned endpoints, shape kept', () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.008;
  const t = [...Array(60)].map((_, i) => (0.3 * i) / 59).concat([...Array(8)].map((_, i) => 0.3 + (0.7 * (i + 1)) / 8));
  const raw = t.map((x) => [x + rnd(), Math.sin(x * 3) * 0.2 + rnd(), rnd()]);
  const out = normalizePolyline(raw, 0.03);
  assert.deepEqual(out[0], raw[0]);
  for (let k = 0; k < 3; k++) close(out[out.length - 1][k], raw[raw.length - 1][k], 1e-9);
  const d = out.slice(1).map((p, i) => Math.hypot(...p.map((x, k) => x - out[i][k])));
  const mean = d.reduce((a, b) => a + b) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
  assert.ok(sd / mean < 0.08);
  const arc = [...Array(200)].map((_, i) => [Math.cos((Math.PI * i) / 199), Math.sin((Math.PI * i) / 199), 0]);
  assert.ok(normalizePolyline(arc, 0.04).every((p) => Math.abs(Math.hypot(...p) - 1) < 0.01));
  assert.equal(normalizePolyline([[0, 0, 0], [0.5, 0, 0]]).length, 2);
});

// -------------------------------------------------------------- OBJ / STL
for (const style of ['plain', 'slash', 'neg']) {
  test(`OBJ quads become triangles (${style} indices)`, () => {
    const m = parseOBJ(cubeOBJ(1, 0, style));
    assert.equal(m.v.length / 3, 8);
    assert.equal(m.f.length / 3, 12);
  });
}

test('OBJ ignores comments, groups, normals and texture lines', () => {
  const m = parseOBJ('# hi\nmtllib x\no t\nv 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nvt 0 0\ns off\nf 1//1 2//1 3//1\n');
  assert.deepEqual([...m.f], [0, 1, 2]);
});

test('binary STL round trip with our exporter, welded corners', () => {
  const items = [new Solid('sphere', [0.1, 0.2, 0.3], 0.5)];
  const stl = sceneToSTL(items);
  const m = parseSTL(buf(stl));
  const orig = items[0].mesh();
  assert.equal(m.f.length, orig.f.length);
  assert.ok(m.v.length / 3 < m.f.length);
  assert.ok(Math.abs(meshVolume(m) - meshVolume(orig)) < 1e-3);
});

test('OBJ round trip with our exporter', () => {
  const m = parseOBJ(sceneToOBJ([new Solid('cube', [0, 0, 0], 1)]));
  assert.equal(m.v.length / 3, 8);
  close(meshVolume(m), 1.6 ** 3);
});

test('ASCII STL', () => {
  const m = parseSTL(enc('solid x\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid'));
  assert.equal(m.v.length / 3, 3);
  assert.equal(m.f.length / 3, 1);
});

test('bad files give clear errors', () => {
  const cases = [
    ['bad.stl', 'not a mesh', /STL/],
    ['a.obj', 'v 0 0 0\nv 1 0 0\n', /no faces/],
    ['a.obj', 'f 1 2 3\n', /no vertices/],
    ['a.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 9\n', /does not exist/],
    ['a.obj', 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 1 2\n', /degenerate/],
    ['a.obj', 'v a b c\n', /Malformed/],
    ['a.txt', 'hello', /Only \.obj/],
  ];
  for (const [name, body, re] of cases) assert.throws(() => loadModel(name, enc(body)), (e) => e instanceof MeshError && re.test(e.message), name);
  const trunc = new Uint8Array(84 + 50);
  new DataView(trunc.buffer).setUint32(80, 5, true);
  assert.throws(() => loadModel('t.stl', buf(trunc)), MeshError);
});

test('fit centres and scales any units', () => {
  for (const unit of [0.002, 1, 5000]) {
    const v = Float64Array.from([0, 0, 0, 4, 0, 0, 0, 2, 0, 0, 0, 1].map((x) => x * unit + 123 * unit));
    const { v: out } = fitToWorkspace(v, 0.85);
    const ext = [0, 1, 2].map((k) => { const a = [0, 3, 6, 9].map((i) => out[i + k]); return Math.max(...a) - Math.min(...a); });
    close(Math.max(...ext), 1.7, 1e-9);
  }
  assert.throws(() => fitToWorkspace(new Float64Array(9)), MeshError);
});

test('decimation keeps the shape and respects the budget', () => {
  const n = 120, v = [], f = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = 0.05 + ((Math.PI - 0.1) * i) / (n - 1), b = (2 * Math.PI * j) / n;
    v.push(Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b));
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n; j++) {
    const p = i * n + j, q = i * n + ((j + 1) % n);
    f.push(p, q, p + n, q, q + n, p + n);
  }
  const m = { v: Float64Array.from(v), f: Uint32Array.from(f) };
  const d = decimateForDisplay(m, 2500);
  assert.ok(d.f.length / 3 > 200 && d.f.length / 3 <= 2500);
  const radii = []; for (let i = 0; i < d.v.length; i += 3) radii.push(Math.hypot(d.v[i], d.v[i + 1], d.v[i + 2]));
  const mean = radii.reduce((a, b) => a + b) / radii.length;
  assert.ok(mean > 0.85 && mean < 1.01);
  assert.equal(decimateForDisplay({ v: m.v.slice(0, 30), f: m.f.slice(0, 15) }, 2500).f.length, 15);
});

// ------------------------------------------------------- imported models
test('imported model is fitted, interactable and exported with the scene', () => {
  for (const size of [0.01, 1, 900]) {
    const im = ImportedMesh.fromBuffer('part.obj', enc(cubeOBJ(size, 37 * size)));
    const m = im.mesh();
    const ext = [0, 1, 2].map((k) => { const a = [...Array(8)].map((_, i) => m.v[3 * i + k]); return Math.max(...a) - Math.min(...a); });
    close(Math.max(...ext), 1.7, 1e-9);
    assert.ok(im.volumetric && im.name === 'part');
  }
  const im = ImportedMesh.fromBuffer('c.obj', enc(cubeOBJ()));
  im.translate([0.5, 0, 0]);
  im.scale(2);
  const snap = im.snapshot();
  im.scale(3);
  im.restore(snap);
  close(im.s, 2);
  const obj = sceneToOBJ([im, new Poly('line', [[0, 0, 0], [1, 1, 1]])]);
  assert.equal((obj.match(/^f /gm) || []).length, 12);
  assert.equal((obj.match(/^l /gm) || []).length, 1);
  assert.equal(new DataView(buf(sceneToSTL([im]))).getUint32(80, true), 12);
  assert.equal(sceneToSTL([new Poly('line', [[0, 0, 0], [1, 1, 1]])]), null);
  assert.throws(() => sceneToOBJ([]), /Nothing/);
});

test('a huge import keeps the full mesh for export and a light copy for display', () => {
  const n = 90, v = [], f = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = 0.05 + ((Math.PI - 0.1) * i) / (n - 1), b = (2 * Math.PI * j) / n;
    v.push(`v ${Math.sin(a) * Math.cos(b)} ${Math.cos(a)} ${Math.sin(a) * Math.sin(b)}`);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n; j++) {
    const p = i * n + j + 1, q = i * n + ((j + 1) % n) + 1;
    f.push(`f ${p} ${q} ${p + n}`, `f ${q} ${q + n} ${p + n}`);
  }
  const im = ImportedMesh.fromBuffer('big.obj', enc([...v, ...f].join('\n')));
  assert.equal(im.faces.length / 3, f.length);
  assert.ok(im.display.f.length / 3 <= 1200);
});
