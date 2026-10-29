// Web Worker: builds a hull off the main thread, so a fine preview never stalls drawing or hand tracking.
// Messages in:  { id, outlines (see outlineData), opts (buildHull options) }
// Messages out: { id, result } where result is buildHull's result (the mesh arrays are transferred, not copied).
import { buildHull, outlineItems } from './hull.js';

self.onmessage = (e) => {
  const { id, outlines, opts } = e.data;
  let result;
  try { result = buildHull(outlineItems(outlines), opts); } catch (err) { result = { ok: false, reason: `Could not build the shape: ${err.message}`, stats: {} }; }
  const transfer = result.ok ? [result.mesh.v.buffer, result.mesh.f.buffer] : [];
  self.postMessage({ id, result }, transfer);
};
