// Scene -> OBJ text and binary STL. Solids and imported models go out as triangle meshes, everything else as lines.
import { sub, cross, norm } from './vec.js';

const f5 = (x) => (Math.abs(x) < 5e-6 ? 0 : x).toFixed(5);

export function sceneToOBJ(items) {
  if (!items.length) throw new Error('Nothing to export');
  const out = ['# FormFlow air sketch'];
  let base = 1;
  items.forEach((it, n) => {
    out.push(`o ${it.kind}_${n}`);
    const m = it.mesh();
    if (m) {
      for (let i = 0; i < m.v.length; i += 3) out.push(`v ${f5(m.v[i])} ${f5(m.v[i + 1])} ${f5(m.v[i + 2])}`);
      for (let i = 0; i < m.f.length; i += 3) out.push(`f ${m.f[i] + base} ${m.f[i + 1] + base} ${m.f[i + 2] + base}`);
      base += m.v.length / 3;
    } else {
      for (const pl of it.polylines()) {
        pl.forEach((p) => out.push(`v ${f5(p[0])} ${f5(p[1])} ${f5(p[2])}`));
        out.push('l ' + pl.map((_, j) => base + j).join(' '));
        base += pl.length;
      }
    }
  });
  return out.join('\n') + '\n';
}

/** Binary STL of every solid (lines and flat shapes have no volume). Returns null if there are none. */
export function sceneToSTL(items) {
  const meshes = items.map((it) => it.mesh()).filter(Boolean);
  const tris = meshes.reduce((a, m) => a + m.f.length / 3, 0);
  if (!tris) return null;
  const buf = new ArrayBuffer(84 + 50 * tris);
  const dv = new DataView(buf);
  new TextEncoder().encodeInto('FormFlow air sketch', new Uint8Array(buf, 0, 80));
  dv.setUint32(80, tris, true);
  let o = 84;
  for (const { v, f } of meshes) {
    for (let i = 0; i < f.length; i += 3) {
      const p = [0, 1, 2].map((k) => [v[3 * f[i + k]], v[3 * f[i + k] + 1], v[3 * f[i + k] + 2]]);
      const n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
      [n, p[0], p[1], p[2]].forEach((vec) => vec.forEach((x) => { dv.setFloat32(o, x, true); o += 4; }));
      dv.setUint16(o, 0, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
