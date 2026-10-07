# Phase 5 - Reconstruction (Track B)

**Track:** B | **Depends on:** Phase 4 data structures (can use hard-coded masks) | **Unlocks:** Phase 6
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

Aligned silhouettes to voxel visual hull to watertight mesh.

## Algorithm

```text
F[x,y], T[x,z], S[z,y]  (aligned masks, resampled to N x N)
V = F[:, :, None] & T[:, None, :] & S.T[None, :, :]
cleanup (largest component, optional close)
pad border
marching cubes -> mesh
optional smoothing, normals
```

## Tasks

### 5.1 Resampling
- [ ] Crop each mask to its bounding box using the shared extents
- [ ] Resample all masks to the voxel grid dimensions (X, Y, Z can differ; default cube N=96/128)
- [ ] Preserve aspect ratio; Front sets reference scale
- [ ] Preview resolution (64) vs final resolution (128)

### 5.2 Visual hull (reconstruct/hull.py)
- [ ] Orthographic back-projection by numpy broadcasting
- [ ] Verified axis conventions with asymmetric "L" test (R4)
- [ ] Voxel count and fill ratio stats
- [ ] Empty-result detection (views are incompatible) with clear message

### 5.3 Voxel cleanup
- [ ] Keep the largest connected component (`scipy.ndimage.label`)
- [ ] Optional 3D closing / opening
- [ ] Optional fill internal cavities (`binary_fill_holes`)
- [ ] Optional: remove thin spikes

### 5.4 Mesh extraction (reconstruct/mesh.py)
- [ ] Pad volume with zero border
- [ ] `marching_cubes` at level 0.5, scale by voxel size
- [ ] Convert to Open3D `TriangleMesh`
- [ ] Remove degenerate/duplicate triangles
- [ ] Optional Laplacian smoothing (1-3 iterations, toggleable)
- [ ] Compute vertex and triangle normals
- [ ] Watertight check; report manifold status

### 5.5 Quality metrics
- [ ] **Silhouette re-projection error:** project the hull back to F/T/S and compare with inputs (IoU per view). Hull is always a superset, so IoU should be ~1 for consistent inputs
- [ ] Voxel fill ratio
- [ ] Reconstruction time per stage

### 5.6 Tests (all synthetic, no camera)
- [ ] Cube: square/square/square gives a cube; volume ~ N^3 fraction
- [ ] Cylinder: circle (Top) + rectangle (Front) + rectangle (Side)
- [ ] Cone/pyramid: triangle/triangle/square
- [ ] L-shape: asymmetric orientation preserved (mirror test)
- [ ] Sphere: three circles
- [ ] Inconsistent views: empty or tiny result handled gracefully
- [ ] Re-projection IoU > 0.95 for all consistent fixtures

### 5.7 Performance
- [ ] 128^3 reconstruct in under about 2 s on CPU (target)
- [ ] Run in worker thread, UI stays responsive

## Exit criteria

- [ ] All fixture tests pass
- [ ] Mesh renders correctly in Open3D with correct orientation
- [ ] Re-projection IoU reported
- [ ] Reconstruction time acceptable for interactive use

## Risks touched
R4, R8, R12
