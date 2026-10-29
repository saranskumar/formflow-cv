// Mesh clean-up on plain { v: Float64Array(3n), f: Uint32Array(3m) } meshes. No dependencies.

/** Vertex neighbour lists (compressed rows) from the triangles. */
function neighbours(mesh) {
  const nv = mesh.v.length / 3, f = mesh.f;
  const deg = new Uint32Array(nv + 1);
  const edges = new Set();
  const add = (a, b) => { const key = a < b ? a * nv + b : b * nv + a; if (!edges.has(key)) { edges.add(key); deg[a]++; deg[b]++; } };
  for (let i = 0; i < f.length; i += 3) { add(f[i], f[i + 1]); add(f[i + 1], f[i + 2]); add(f[i + 2], f[i]); }
  const start = new Uint32Array(nv + 1);
  for (let i = 0; i < nv; i++) start[i + 1] = start[i] + deg[i];
  const fill = start.slice(0, nv), list = new Uint32Array(start[nv]);
  for (const key of edges) { const a = Math.floor(key / nv), b = key - a * nv; list[fill[a]++] = b; list[fill[b]++] = a; }
  return { start, list, nv };
}

/**
 * Taubin smoothing: a Laplacian step that shrinks the surface (lambda > 0) followed by one that expands it (mu < 0),
 * so noise and stair-steps flatten without the whole shape getting smaller. Changes mesh.v in place.
 */
export function taubinSmooth(mesh, iterations = 2, lambda = 0.5, mu = -0.53) {
  if (iterations <= 0 || !mesh.f.length) return mesh;
  const { start, list, nv } = neighbours(mesh);
  const v = mesh.v, tmp = new Float64Array(v.length);
  const pass = (k) => {
    for (let i = 0; i < nv; i++) {
      const a = start[i], b = start[i + 1];
      if (a === b) { tmp[3 * i] = v[3 * i]; tmp[3 * i + 1] = v[3 * i + 1]; tmp[3 * i + 2] = v[3 * i + 2]; continue; }
      let x = 0, y = 0, z = 0;
      for (let e = a; e < b; e++) { const j = list[e]; x += v[3 * j]; y += v[3 * j + 1]; z += v[3 * j + 2]; }
      const c = b - a;
      tmp[3 * i] = v[3 * i] + k * (x / c - v[3 * i]);
      tmp[3 * i + 1] = v[3 * i + 1] + k * (y / c - v[3 * i + 1]);
      tmp[3 * i + 2] = v[3 * i + 2] + k * (z / c - v[3 * i + 2]);
    }
    v.set(tmp);
  };
  for (let it = 0; it < iterations; it++) { pass(lambda); pass(mu); }
  return mesh;
}

/**
 * Is the mesh a closed, manifold surface? Every edge must be used by exactly two triangles, once in each direction
 * (consistent winding). Returns { closed, boundaryEdges, nonManifoldEdges, inconsistentEdges }.
 */
export function meshHealth(mesh) {
  const nv = mesh.v.length / 3, f = mesh.f;
  const count = new Map(), dir = new Map();
  for (let i = 0; i < f.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = f[i + e], b = f[i + ((e + 1) % 3)];
      const key = a < b ? a * nv + b : b * nv + a;
      count.set(key, (count.get(key) || 0) + 1);
      dir.set(key, (dir.get(key) || 0) + (a < b ? 1 : -1)); // two triangles sharing an edge traverse it in opposite directions
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  for (const [key, c] of count) {
    if (c === 1) boundaryEdges++;
    else if (c > 2) nonManifoldEdges++;
    else if (dir.get(key) !== 0) inconsistentEdges++;
  }
  return { closed: f.length > 0 && !boundaryEdges && !nonManifoldEdges && !inconsistentEdges, boundaryEdges, nonManifoldEdges, inconsistentEdges };
}
