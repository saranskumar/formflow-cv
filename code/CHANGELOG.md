# FormFlow - Changelog

## MVP Complete: Phases 0 through 6 (2026-10-07)

### What works
- **Phase 0 & 1: Hand Tracking & Interaction**
  - Threaded webcam capture with 1-frame queue and `CAP_DSHOW` backend
  - MediaPipe Hands tracking with 21 landmarks
  - One-Euro filter for fingertip jitter reduction
  - Pinch detection with hysteresis and hand-scale normalization
  - Virtual pencil state machine (NO_HAND -> HOVER -> DRAWING)
  - Stroke store with undo/redo, smoothing, outlier rejection, and 2D/3D support
- **Phase 2: Mode 1 — Rapid 3D Sketching**
  - Workspace coordinate mapping to normalized right-handed box `[-1, 1]^3`
  - Multiple depth strategies: Plane depth, Hand-scale depth, Landmark Z depth
  - Non-blocking Open3D Visualizer (`O3DViewer`) running synchronously in main loop
  - Live 3D stroke rendering as Open3D `LineSet` with distinct per-stroke color palette
  - Real-time 3D cursor sphere at live fingertip position
  - Preset camera viewpoints (Front, Top, Side, Iso) and keyboard orbiting (`J`/`L`/`K`)
  - Polyline Wavefront OBJ export (`l` elements)
- **Phase 3: Mode 2 — Multi-View Canvases**
  - Three orthographic drawing canvases: Front (X, Y), Top (X, Z), Side (Z, Y)
  - 512x512 canvas resolution with grid, reference axes, and center lines
  - Shared-dimension guide lines across companion views (X, Y, Z extents)
  - Snap-to-close helper for completing outlines
  - Mouse drawing & thumbnail click fallback
- **Phase 4: CV Processing & Alignment**
  - Deterministic stroke rasterization to binary mask
  - Morphological gap-closing escalation (elliptical kernels 7-21 px)
  - Connected component speck removal
  - Closure check and flood-fill interior extraction
  - Comprehensive `SilhouetteInfo` geometric features (bbox, area, centroid, solidity)
  - Cross-view dimension consistency validation with 10% mismatch warnings
  - Auto-scaling to reference view and auto-centering on common N x N grid
- **Phase 5: Visual Hull Reconstruction & Mesh Extraction**
  - Orthographic visual hull back-projection: `V = F[:, :, None] & T[:, None, :] & S.T[None, :, :]`
  - Largest connected component isolation and internal cavity filling
  - Re-projection IoU quality metrics per view
  - Zero-padded volume Marching Cubes surface extraction
  - Watertightness verification, mesh cleanup, and Laplacian smoothing
- **Phase 6: Integration, Viewer, & Export (MVP Done)**
  - Unified app state machine: MENU -> RAPID3D / MULTIVIEW -> Re-edit loop -> Export
  - Background threading for reconstruction keeping UI responsive at 30+ FPS
  - OBJ and binary STL mesh export with computed vertex/triangle normals
  - JSON project persistence (save and load) with versioned schema
  - 32 comprehensive unit tests covering all pure functions and algorithms
