# Better 3D reconstruction from 1-3 silhouettes/photos, client-side (FormFlow)

Context: FormFlow currently builds a 64^3 voxel visual hull from orthographic Front/Side/Top closed outlines (even-odd raster), keeps the largest connected component, blurs [1 4 1]/6, and meshes with surface nets; single-view mode extrudes or lathes. Output OBJ / binary STL. Problems: blocky look, no concavities.

Research date: 2026-10-29. Tool budget was limited (~16 calls), so several algorithmic points below are labelled as inferences from general graphics knowledge, not sourced facts.

## Ranked improvement list (synthesis)

### Takeaway
The cheapest big gain is to stop rasterising to binary voxels. Build the hull from 2D signed distance fields of each outline (intersection = max of the per-view SDFs), sample it at 128^3-192^3 in a Web Worker, mesh it with surface nets or marching cubes using real zero-crossing positions, then run light Taubin smoothing and meshoptimizer simplification. Concavities need a second signal: monocular depth from Depth Anything V2 Small (Apache-2.0, about 19-27 MB quantised), sketch inflation, or a TripoSR-class image-to-3D model (MIT, about 485 MB int8, WebGPU).

### Cited Findings
- Depth Anything V2 Small is Apache-2.0, but Base/Large/Giant are CC-BY-NC-4.0 (non-commercial) — [onnx-community model card / search summary](https://huggingface.co/onnx-community/depth-anything-v2-small); [official repo](https://github.com/DepthAnything/Depth-Anything-V2)
- Depth Anything V2 Small ONNX sizes: fp32 99.1 MB, fp16 49.6 MB, int8/uint8/q4 about 27 MB, q4f16 19.1 MB — [HF file tree](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx)
- TripoSR runs fully in the browser on onnxruntime-web WebGPU: a 485 MB int8 triplane model plus a 0.2 MB decoder, MIT (DINO encoder Apache-2.0), commercial use allowed — [cgb/triposr-onnx-webgpu](https://huggingface.co/cgb/triposr-onnx-webgpu)
- Current npm versions and licences (checked with `npm view`, 2026-10-29): manifold-3d 3.5.4 Apache-2.0; meshoptimizer 1.3.0 MIT; three-mesh-bvh 0.9.17 MIT; @huggingface/transformers 4.3.2 Apache-2.0; onnxruntime-web 1.31.1 MIT; three 0.186.1 MIT — npm registry ([manifold-3d](https://www.npmjs.com/package/manifold-3d), [meshoptimizer](https://www.npmjs.com/package/meshoptimizer), [three-mesh-bvh](https://www.npmjs.com/package/three-mesh-bvh), [@huggingface/transformers](https://www.npmjs.com/package/@huggingface/transformers), [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web))

### Inferences
Ranked by quality gain per unit of effort. Complexity: S = a day or less, M = a few days, L = a week or more.
1. **SDF hull from 2D distance transforms (S-M, large gain in smoothness).** Compute a signed 2D distance field per view: an exact Euclidean distance transform such as Felzenszwalb-Huttenlocher, or direct point-to-polygon-segment distance. Then set phi(x,y,z) = max(sF(x,y), sS(z,y), sT(x,z)) and extract the 0-level set. Vertices land on true sub-voxel crossings instead of blurred binary steps, which removes most of the blockiness, and the 3-pass blur is no longer needed. Cost is O(N^3) max operations: about 2M at 128^3 and about 7M at 192^3, which takes tens of ms in a JS worker. Because the views are orthographic, each 2D SDF is computed once at high resolution (e.g. 512^2) and sampled bilinearly.
2. **Higher resolution plus a Web Worker (S).** Move hull building and meshing off the main thread with a Float32Array grid and transferables. 128^3 is 8 MB as float32. Narrow-band evaluation only needs cells where |phi| is under about 2 voxels, which is a cheap stand-in for an octree: the coarse sign is known from 2D tests. A full octree or sparse grid is only worth it above about 256^3.
3. **Post-processing chain (S).** Run Taubin lambda/mu smoothing (about 0.5 / -0.53, 5-10 iterations), which avoids the shrinkage of plain Laplacian; HC-Laplacian is an alternative. Then meshoptimizer `simplify` / `simplifyWithAttributes` with an error target. Then a manifold check through manifold-3d: constructing a `Manifold` from a mesh fails or reports status if the mesh is not manifold, which gives a watertightness check for STL export for free.
4. **Rounded cross-sections / better single-view modes (M).** Replace plain extrusion with inflation, either Teddy-style or a distance-transform height h = sqrt(d(2R - d)) for a circular-arc profile. Add lathe with a user-drawn (curved) axis: a sweep along a spline with radius taken from the outline width perpendicular to the axis. These are usually far closer to user intent than a hull built from a single view.
5. **Symmetry (S).** For front+side input, assume mirror symmetry about the side-view plane, or for top-view-less input use the front outline as the depth profile ("elliptical cross-section" assumption: at each height, an ellipse with semi-axes from the front and side half-widths). This fills the missing third view and gives rounder, less faceted results than the boxy intersection of two prisms. It is a well-known cheap trick in sketch modelling.
6. **Depth-assisted carving (M-L, recovers concavities on photos).** Depth Anything V2 Small (relative depth) through transformers.js WebGPU. Fit scale and offset so depth matches the hull's front surface at the silhouette rim, then carve voxels that sit in front of the predicted surface: phi = max(phi_hull, z_front(x,y) - z). This works only for photos, not for line sketches, and the depth is relative and affine-ambiguous.
7. **Image-to-3D model as an optional "AI mode" (L).** TripoSR WebGPU (485 MB download, MIT) is the only commercially clean option that is realistic in a browser. SF3D has a WebGPU ONNX port but uses the Stability Community Licence. Everything newer (TRELLIS.2, Hunyuan3D 2.x) is server-GPU only.
8. **Exact polyhedral visual hull (L, modest gain).** This gives crisp planar facets but only matches CAD-like inputs. Organic sketches would still look faceted, and robust implementation is hard (Franco-Boyer). Lower priority than the SDF approach.

### Gaps
- No measured browser timings were found for any method, so all ms estimates above are reasoning, not benchmarks.

## Visual hull improvements (resolution, adaptive voxels, polyhedral, SDF, workers/GPU)

### Takeaway
Exact polyhedral visual hulls are well established (Matusik 2001; Franco-Boyer 2003/2009) and produce watertight manifold output, but they are complex to build. For three orthographic views, an SDF hull (max of extruded 2D SDFs) gives most of the quality at a fraction of the effort.

### Cited Findings
- Franco and Boyer, "Exact Polyhedral Visual Hulls" (BMVC 2003): the exact hull polyhedron from polygonal contours in three stages (viewing edges, walk along cone-intersection boundaries, face contour identification) — [BMVC 2003 PDF](https://bmva-archive.org.uk/bmvc/2003/papers/18/paper018.pdf); [HAL](https://hal.archives-ouvertes.fr/inria-00349075)
- The journal version (IEEE TPAMI 31(3), 2009, pp. 414-427) reports manifold, watertight polyhedra on real data in a single pass — [Efficient Polyhedral Modeling from Silhouettes](https://typeset.io/pdf/efficient-polyhedral-modeling-from-silhouettes-14drbs450i.pdf)
- Matusik, Buehler and McMillan 2001, "Polyhedral Visual Hulls for Real-Time Rendering", computes an exact polyhedral representation directly from silhouettes. Liang and Wong 2008 compute exact voxel-edge/hull intersections for marching cubes ("Exact Visual Hull from Marching Cubes") — [SciTePress](https://www.scitepress.org/Papers/2008/10804)

### Inferences
- With orthographic, axis-aligned views, a polyhedral hull is simply the CSG intersection of three extruded prisms (outline polygon extruded along each view axis). manifold-3d (Apache-2.0, WASM) can do this directly: `CrossSection` from the polygon, then `extrude`, rotate, and `intersect`. This yields an exact, watertight, manifold hull in a few lines with no voxels. It is the cheapest route to the "exact polyhedral hull" and is much easier than implementing Franco-Boyer, which targets perspective cameras.
- The prism intersection is sharp-edged. For organic shapes, prefer the SDF hull (item 1 above), or apply a rounding operation to the SDF (subtract a radius r, giving a smooth-min style rounded intersection).
- The Liang-Wong idea applied to FormFlow: in the current pipeline, compute exact crossing points along voxel edges from the 2D polygons (ray-polygon intersection per edge) instead of from blurred occupancy. This is equivalent to using SDFs.
- GPU: a WebGPU compute shader can evaluate the max of three texture samples per voxel trivially at 256^3. Meshing on GPU is more involved, and a worker with plain JS is probably sufficient at 128^3.

### Gaps
- No public JS implementation of Franco-Boyer was found.
- No WebGPU marching cubes / surface nets library was verified in this session.

## Meshing, smoothing, decimation, watertightness

### Takeaway
Keep surface nets but feed them a real scalar field, so vertices are placed at interpolated zero crossings. Add Taubin smoothing, then meshoptimizer simplification. Use manifold-3d to validate or repair before STL export. Dual contouring only helps when sharp features are needed and Hermite normals are available, which an SDF provides.

### Cited Findings
- meshoptimizer JS exposes `MeshoptSimplifier.simplify`, `simplifyWithAttributes`, `simplifyWithUpdate`, `simplifySloppy`, `simplifyPrune`, `compactMesh`, `getScale`, and `simplifyPoints`. Flags: LockBorder, ErrorAbsolute, Sparse, Prune, Regularize/RegularizeLight, Permissive. Licence MIT — [meshoptimizer js README](https://github.com/zeux/meshoptimizer/tree/master/js)
- `simplifySloppy` ignores topology and can merge disconnected features, giving worse quality — [same](https://github.com/zeux/meshoptimizer/tree/master/js)
- manifold-3d is WASM-built, Apache-2.0, version 3.5.4 — [jsDelivr package.json](https://cdn.jsdelivr.net/npm/manifold-3d@3.4.1/package.json); [GitHub](https://github.com/elalish/manifold)
- three-mesh-bvh 0.9.17 MIT (npm) — useful for raycasts and closest-point queries (e.g. projecting smoothed vertices back toward the hull, or depth-carving tests) — [npm](https://www.npmjs.com/package/three-mesh-bvh)

### Inferences
- Marching cubes vs surface nets vs dual contouring: on a proper SDF at the same resolution, MC and surface nets look similar. Surface nets give about half the triangles and better-shaped quads. MC with a 256-case table has well-known ambiguity cases. Dual contouring (QEF per cell) keeps sharp creases, which suits the polyhedral prism hull, but can produce self-intersections. For FormFlow's organic sketches, surface nets plus SDF is the best fit. Switch to DC only if a "sharp/CAD" mode is wanted.
- Taubin smoothing prevents shrinkage. Plain Laplacian shrinks thin parts, which matters for 64^3-scale features.
- Watertightness: surface nets on a closed field bounded by a padded grid always give closed surfaces, but they can produce non-manifold edges at pinch points. Running the result through manifold-3d (`new Manifold(mesh)`; check `status()`) detects or repairs these before STL export.

### Gaps
- meshoptimizer WASM bundle size was not stated on the README page.
- The exact manifold-3d API for mesh import status in 3.5.x was not re-verified.

## Beyond silhouettes: monocular depth in the browser

### Takeaway
Depth Anything V2 Small is the clear pick: Apache-2.0, 19-27 MB quantised, a transformers.js `depth-estimation` pipeline, and real-time WebGPU demos exist. Depth Pro gives metric, sharper depth but its weights are about 0.6 GB at q4 or more, and its licence is Apple research-style, so treat it as non-commercial. MiDaS was not researched this session.

### Cited Findings
- onnx-community/depth-anything-v2-small works with Transformers.js through `pipeline('depth-estimation', ...)` and installs from npm as `@huggingface/transformers` — [model card](https://huggingface.co/onnx-community/depth-anything-v2-small)
- Xenova's Space does real-time depth estimation with Depth Anything V2 locally in the browser through Transformers.js (WebGPU) — [webgpu-realtime-depth-estimation](https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation/blob/main/index.html)
- File sizes are 19.1 MB (q4f16) up to 99.1 MB (fp32) — [HF tree](https://huggingface.co/onnx-community/depth-anything-v2-small/tree/main/onnx)
- Licences: Small is Apache-2.0; Base/Large/Giant are CC-BY-NC-4.0 — [model card](https://huggingface.co/onnx-community/depth-anything-v2-small)
- DepthPro-ONNX supports Transformers.js (example uses `dtype: "q4"`). Reported sizes are about 3.5 GB fp32, 1.8 GB fp16, 0.7 GB q4 and about 0.6 GB q4f16 (from secondary sources) — [onnx-community/DepthPro-ONNX](https://huggingface.co/onnx-community/DepthPro-ONNX)
- Depth Pro's licence metadata conflicts: the ONNX repo says `apple-ascl`, while apple/DepthPro-hf says `apple-amlr` (Apple ML Research licence) — [DepthPro-ONNX](https://huggingface.co/onnx-community/DepthPro-ONNX); [apple/DepthPro-hf](https://huggingface.co/apple/DepthPro-hf)

### Inferences
- Carving with depth: DA-V2 output is relative inverse depth (affine-invariant). Align it to the hull by least-squares fitting scale and shift over silhouette pixels near the rim, where hull depth is known to be about the silhouette's mid-depth. Then use it as a front-surface height field. Back faces stay unconstrained, so mirror the front depth or keep the hull for the back. This recovers concavities facing the camera (e.g. a bowl's dish viewed from above, or face details) but not hidden ones.
- Depth models trained on photos will produce poor or meaningless depth on clean line-art outlines. This feature only makes sense when users upload photos.
- The Apple ML Research licence is generally research-only, so flag Depth Pro as non-commercial pending confirmation.

### Gaps
- No browser latency numbers were found for DA-V2 Small on WebGPU vs WASM. The demo being "real-time" suggests tens of ms per frame on a desktop GPU, but this is unmeasured.
- MiDaS browser ports and licence (MIT upstream, from memory) were not verified this session.

## Single-image-to-3D models (client-side feasibility, licences, hosted alternatives)

### Takeaway
TripoSR is the only one that runs fully in the browser today and has a permissive (MIT) licence: about 485 MB int8, onnxruntime-web WebGPU. SF3D has a WebGPU ONNX port but uses the Stability AI Community Licence (free under $1M revenue). TRELLIS.2 (MIT weights, but NVIDIA research-licence dependencies) and Hunyuan3D 2.1 (excludes the EU, UK and South Korea) need a server GPU. The free hosted route is HF ZeroGPU Spaces, which only allows a few GPU-minutes per day per free user.

### Cited Findings
- TripoSR in browser: triplane int8 (block 32) 485 MB plus decoder 0.2 MB; onnxruntime-web WebGPU; 512x512 input; triplane 40x64x64 per plane; MIT + Apache-2.0 (DINO) — [cgb/triposr-onnx-webgpu](https://huggingface.co/cgb/triposr-onnx-webgpu)
- TripoSR input requirements: the subject must be cut out, fill 0.85 of the width, and sit on mid-grey. A white background produces phantom geometry. ORT WebGPU GridSample support is incomplete, so point sampling is done in caller code. Int8 block 32 agrees with the reference on 99.1% of occupied volume vs 96.6% for block 128 — [same](https://huggingface.co/cgb/triposr-onnx-webgpu)
- Upstream TripoSR is MIT — [stabilityai/TripoSR](https://huggingface.co/stabilityai/TripoSR)
- A full-precision community TripoSR ONNX bundle is about 3.4 GB — [Heliosoph/triposr-onnx](https://huggingface.co/Heliosoph/triposr-onnx)
- SF3D WebGPU ONNX port: image tokenizer, backbone (FP16) and decoder graphs plus tet-grid data. Stability AI Community Licence; sizes and speed not stated — [needle-tools/SF3D-webgpu](https://huggingface.co/needle-tools/SF3D-webgpu)
- SF3D needs an enterprise licence above $1M annual revenue — [stabilityai/stable-fast-3d](https://huggingface.co/stabilityai/stable-fast-3d/blob/refs%2Fpr%2F8/README.md); [jc-builds/sf3d-ios](https://huggingface.co/jc-builds/sf3d-ios)
- SF3D vs TripoSR constants: triplane size 384 vs 64, marching-cubes iso 10.0 vs 25.0 — [jc-builds/sf3d-ios](https://huggingface.co/jc-builds/sf3d-ios)
- Hunyuan3D 2.1 licence territory excludes the EU, UK and South Korea (seen via a mirror of the licence text, so verify on HF) — [licence mirror](https://gitserver.onethingai.com/ai-models/Hunyuan3D-2.1/raw/branch/main/LICENSE); [Hunyuan3D-2 LICENSE on HF](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE)
- TRELLIS.2 is reported as MIT (about 4B parameters), but the nvdiffrast/nvdiffrec dependencies use the NVIDIA Source Code License (research/evaluation only) — [cgworld.jp](https://cgworld.jp/flashnews/01-202601-TRELLIS2.html); [comfyui-wiki](https://comfyui-wiki.com/fr/models/trellis/trellis-2)
- HF ZeroGPU free quota: current docs say 5 GPU-minutes/day for free accounts and 40 for PRO; an older docs version said 3.5/25. One forum post claims a 3-runs/day request limit for free users (unverified) — [HF ZeroGPU docs](https://huggingface.co/docs/hub/spaces-zerogpu); [forum](https://discuss.huggingface.co/t/what-is-the-free-zerogpu-quota-for-1-space/178610)

### Inferences
- A practical "AI mode" design for FormFlow: lazy-load TripoSR WebGPU (485 MB, cached in the Cache API/OPFS after the first visit) only when the user opts in. Use FormFlow's own silhouette as a background-removal mask (it already has the outline), composite onto mid-grey at 0.85 framing, run it, then intersect the TripoSR SDF/occupancy with the user's hull to enforce the drawn silhouettes. Gate it on `navigator.gpu` and on adapter limits (maxBufferSize, maxStorageBufferBindingSize).
- TripoSR's 64-res triplane gives soft, low-detail meshes. It was trained on Objaverse renders, so results on hand sketches (not photos) are likely poor without image-style conversion.
- InstantMesh (multi-view diffusion + LRM) and TRELLIS/Hunyuan3D are multi-GB and diffusion-based, so they are not realistic in a browser in 2026. The hosted Gradio Spaces could be called with `@gradio/client`, but the free quota is tiny and Space availability is not guaranteed, so treat this only as a demo fallback.

### Gaps
- InstantMesh licence and size were not verified this session (Apache-2.0 from memory, but its Zero123++ dependency has its own licence).
- No measured TripoSR browser inference time was found.
- SF3D WebGPU file sizes were not listed.

## Symmetry, sketch-based modelling (Teddy, inflation, extrusion), variable-axis revolution

### Takeaway
Inflation-based single-view modelling (Teddy 1999, and Monster Mash 2020, which is open source under Apache-2.0 C++/Emscripten with a web demo) is the strongest upgrade for FormFlow's single-view mode. The core math (distance-transform or Poisson inflation of a 2D region) is easy to reimplement in JS.

### Cited Findings
- Monster Mash (Dvorožňák et al., ACM TOG 39(6), SIGGRAPH Asia 2020): sketch, inflate to 3D, and animate, all in the sketching plane. The `src` code is Apache-2.0 (third_party may be more restrictive). Web demo at MonsterMash.zone, built with Emscripten — [google/monster-mash](https://github.com/google/monster-mash)
- Monster Mash combines 3D inflation with a rigidity-preserving layered deformation model (ARAP-L) to make smooth, animation-ready meshes — [paper record](https://searchworks.jioinstitute.edu.in/articles/edsair__edsair.doi.dedup.....7fa3d3a70a619fae228ad8f1b0fd9d76)

### Inferences
- Teddy-style inflation in FormFlow: take the 2D SDF d(x,y) of the outline (already computed for the SDF hull) and set height z(x,y) = +/- sqrt(max(0, 2*R*d - d^2)), or use z ~ sqrt(d) for a rounded "pillow" shape. Mesh the two halves, or define a 3D SDF phi = |z| - h(x,y) and run it through the same surface-nets pipeline, which produces a watertight result automatically. This replaces flat extrusion for organic shapes at low cost (S).
- Combining inflation with the hull: for two-view input, inflate each view and intersect (max of SDFs). This gives rounded edges rather than prism-intersection boxes, a large perceived quality gain.
- Variable-axis revolution: let the user draw a spine curve (spline) in the view. For each point, radius = half-width of the outline measured perpendicular to the spine, or the distance to the outline along the normal. Then sweep circles (or ellipses scaled by a second view) along the spine with rotation-minimising frames. This generalises the current lathe to bent objects such as horns, handles and tails.
- Mirror symmetry: let the user tag a symmetry plane, then mirror and union. Or, for the depth-carving route, mirror the front depth to the back.
- SketchUp-like push/pull: manifold-3d's `CrossSection.extrude` (with twist and scale-top parameters) and boolean ops cover tapered extrusion and push/pull with guaranteed manifold output.

### Gaps
- The original Teddy paper (Igarashi et al., SIGGRAPH 1999) and later works (e.g. RigMesh, "Inflating 2D shapes") were not fetched this session, so only Monster Mash is cited.
- No maintained npm library for Teddy-style inflation was found or verified.
