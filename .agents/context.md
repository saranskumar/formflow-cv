# Project Context

## Stack
- Python 3.12.8
- OpenCV (opencv-python 4.10)
- MediaPipe Hands 0.10.14 (fixed compatibility with solutions.hands)
- Open3D 0.20
- NumPy 2.5, SciPy 1.18, scikit-image 0.26
- pytest 9.1

## Active Task
FormFlow is running in interactive session (Task ID: `task-138`, PID 34600).

## Recent Decisions
- **Phase 0 & 1 (Hand interaction):** Threaded webcam capture, MediaPipe 21 landmarks, One-Euro fingertip filter, pinch detection with hysteresis & debounce, virtual pencil state machine, StrokeStore with 2D/3D stroke support.
- **Phase 2 (Mode 1 / Rapid 3D):** 2D to 3D coordinate mapping in [-1, 1]^3 workspace, depth sources (`PlaneDepth`, `HandScaleDepth`, `LandmarkZDepth`), synchronized non-blocking Open3D visualizer, dynamic `LineSet` rendering, 3D cursor sphere, viewpoint controls, OBJ polyline export (`export/obj.py`).
- **Phase 3 (Mode 2 / Multi-view canvases):** `ViewCanvas` (512x512) for Front, Top, and Side orthographic views, grid/axes/center lines, shared-dimension reference guide lines, snap-to-close outline completion, mouse drawing fallback.
- **Phase 4 (CV processing & alignment):** Deterministic stroke rasterization, morphological gap closing escalation (7-21 px), connected component speck filtering, flood-fill closure verification, `SilhouetteInfo` geometric features, cross-view extent consistency check (10% threshold warnings), auto-scaling to reference view and centering on common grid (`align/normalize.py`).
- **Phase 5 (Visual hull reconstruction):** Orthographic voxel back-projection `V = F[:, :, None] & T[:, None, :] & S.T[None, :, :]` verified with asymmetric L-shape test, largest connected component extraction, re-projection IoU metric, zero-padded Marching Cubes, Open3D `TriangleMesh` with Laplacian smoothing, vertex/triangle normals, watertightness validation.
- **Phase 6 (Integration & Export):** Unified application shell in `app.py`, background thread for reconstruction, Wavefront OBJ and binary STL exporters (`export/obj.py`, `export/stl.py`), versioned JSON project save/load (`export/project_io.py`), full UI composite layout.
- **Test Suite:** 32 unit tests passing in `tests/`. End-to-end sample project verified with watertight OBJ and STL outputs in `samples/`.

## Open Blockers
- None. MVP is complete and fully functional.
