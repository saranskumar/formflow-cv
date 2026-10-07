# FormFlow - Technical Specification

**Related:** [Roadmap](./00-roadmap.md) | [Architecture](../architecture.md) | [Pipeline](../pipeline.md)

This fixes the implementation details the existing docs leave open.

---

## 1. Environment

| Item | Choice | Note |
| ---- | ------ | ---- |
| OS | Windows 11 (your machine) | Webcam via OpenCV `CAP_DSHOW` or `CAP_MSMF`; try both if opening is slow |
| Python | **3.11** (3.10-3.12 acceptable) | Open3D and MediaPipe wheels lag newest Python. Verify wheels exist before upgrading |
| Env | `venv` in project root | `requirements.txt` with pinned versions |
| Core deps | `opencv-python`, `mediapipe`, `open3d`, `numpy` | |
| Extra deps | `scikit-image` (marching cubes), `scipy` (ndimage, filters), `pytest` | `numpy-stl` optional; Open3D can write STL |
| Lint/format | `ruff` | optional |

**Phase 0 verification:** import all four core libs, open webcam, open an Open3D window, all in one script. Resolve version conflicts here, not later.

---

## 2. Repository layout

```text
cv/
  docs/                      (existing)
  src/formflow/
    __main__.py              entry point
    app.py                   mode menu, main loop, state machine
    config.py                thresholds, gesture map, resolutions (dataclass + JSON)
    capture/                 webcam.py
    hands/                   tracker.py (MediaPipe wrapper), pinch.py, filters.py
    pencil/                  state_machine.py
    strokes/                 store.py, smoothing.py, undo.py
    mode_rapid3d/            mapping.py, session.py, render.py
    mode_multiview/          canvas.py, guides.py, session.py
    cv_process/              raster.py, silhouette.py
    align/                   normalize.py, consistency.py
    reconstruct/             hull.py, mesh.py
    viewer/                  o3d_viewer.py
    export/                  obj.py, stl.py, project_io.py
    ui/                      overlay.py, widgets.py, theme.py
  tests/
    fixtures/                synthetic silhouettes (generated)
    test_*.py
  tools/                     record_session.py, replay_session.py, bench.py
  samples/                   saved sketches, example exports
  requirements.txt
  CHANGELOG.md
```

Matches the module list in [architecture.md section 8](../architecture.md), plus `ui/` and `tools/`.

---

## 3. Coordinate conventions (decide once, test forever)

World axes (right-handed, Open3D default display):

| Axis | Meaning |
| ---- | ------- |
| +X | Width (to the right when looking at Front) |
| +Y | Height (up) |
| +Z | Depth (toward the viewer from Front view) |

View canvases (image coordinates have origin top-left, y down; convert to world once, at the boundary):

| View | Canvas axes | Maps to |
| ---- | ----------- | ------- |
| Front | u = X, v = Y (flip v) | `F[x, y]` |
| Top | u = X, v = Z | `T[x, z]` (looking down; top of canvas = back, so v = Z flipped as needed) |
| Side | u = Z, v = Y (flip v) | `S[z, y]` (decide left- vs right-side view; default: view from the right, so u = -Z) |

Visual hull is then one numpy line:

```python
V = F[:, :, None] & T[:, None, :] & S.T[None, :, :]   # shape (X, Y, Z)
```

Write a test with an asymmetric shape (an "L") to catch any mirrored axis. This is the most common bug in this project.

---

## 4. Gesture map (initial; configurable)

| Gesture | Action | Detection |
| ------- | ------ | --------- |
| Pinch (thumb tip + index tip close) | Pencil ON | normalized distance < `pinch_on`; release above `pinch_off` (hysteresis) |
| Index extended, no pinch | Hover / cursor | pencil OFF |
| Open palm held ~0.6 s | Pause / hand-off (do nothing) | all fingers extended |
| Fist held ~0.6 s | Undo last stroke | all fingers curled |
| Two fingers (index + middle) swipe | Switch view (Mode 2) or rotate (Mode 1) | stretch goal; keyboard fallback first |
| Dwell on button (hover 0.8 s) | Click on-screen button | pinch also works as click |

**Normalise pinch distance** by hand size (wrist to middle-finger MCP distance) so it works at any distance from the camera.

**Every gesture has a keyboard fallback.** Keyboard is the dev and demo-safety path:

| Key | Action |
| --- | ------ |
| `1` / `2` | Mode 1 / Mode 2 |
| `F` `T` `S` | Front / Top / Side view |
| `Z` / `Y` | Undo / redo |
| `C` | Clear current view |
| `R` | Reconstruct |
| `E` | Export |
| `Space` | Toggle pencil (when tracking is bad) |
| `Esc` | Back to menu / quit |

---

## 5. Data models

```python
@dataclass
class Stroke:
    id: int
    points: list[tuple[float, float]]    # canvas coordinates (Mode 2) or workspace xy (Mode 1)
    z: list[float] | None                # Mode 1 only
    color: tuple[int, int, int]
    created_at: float

class StrokeStore:   # per canvas / per workspace
    strokes: list[Stroke]
    add(), undo(), redo(), delete(id), clear()
```

Project file (JSON, versioned): mode, strokes per view, canvas size, config snapshot, schema `version`. Raster is derived, never stored as truth.

---

## 6. Main loop and threading

- **Single main thread** for OpenCV `imshow` + Open3D `poll_events` (both prefer main thread on Windows).
- Webcam read in a **small capture thread** with a 1-frame queue (drop old frames) to avoid latency build-up.
- Reconstruction is the only heavy step: run it on demand (`R`) in a worker thread; show a "Reconstructing..." indicator; swap mesh into the viewer on completion.
- Open3D: `Visualizer.create_window()`, then each loop `update_geometry()`, `poll_events()`, `update_renderer()`. Do not call blocking `draw_geometries`.

---

## 7. Parameters (defaults, tune later)

| Parameter | Default | Where |
| --------- | ------- | ----- |
| Camera resolution | 1280x720 request, 640x360 for tracking if needed | capture |
| Tracking | 1 hand, `max_num_hands=1`, detection/tracking confidence 0.6 | hands |
| Fingertip filter | One-Euro filter (min_cutoff ~1.0, beta ~0.007) | hands/filters |
| Stroke smoothing | Moving average window 5, then optional Chaikin or spline resample | strokes |
| Min point spacing | 2 px | strokes |
| View canvas | 512 x 512 per view | multiview |
| Brush thickness (raster) | 3 px | cv_process |
| Gap-close kernel | 5-9 px ellipse | cv_process |
| Voxel grid | 96 or 128 per axis (64 for live preview) | reconstruct |
| Mismatch warning threshold | 10% of extent difference | align |

---

## 8. Mesh and export details

- Surface: `skimage.measure.marching_cubes(V.astype(float), level=0.5)`; pad volume with a 1-voxel zero border so surfaces close.
- Smooth: optional Laplacian smoothing via Open3D (`filter_smooth_simple`), 1-3 iterations. Flag it as optional because it shrinks thin features.
- Scale: voxel size `s` in chosen unit (default 1 voxel = 1 mm so a 128-voxel object is 128 mm). Document it; STL has no units.
- Normals: `compute_vertex_normals()` and `compute_triangle_normals()` before writing STL.
- Writers: `open3d.io.write_triangle_mesh` for OBJ/STL. Verify watertightness via `mesh.is_watertight()` and report in the UI.
- Mode 1 export: polylines as OBJ `l` elements (line elements); optional tube mesh for STL (stretch).

---

## 9. Testing strategy

| Layer | How |
| ----- | --- |
| Geometry (hull, alignment, mesh) | pytest with synthetic masks: cube, cylinder, cone, L-shape, hollow-through hole |
| CV processing | Generated rasters: closed circle, open circle (gap), noisy circle, two blobs |
| Strokes | Property-style: smoothing reduces jitter; undo/redo round-trip |
| Hand/pencil state machine | Feed scripted landmark sequences (no camera) |
| Integration | `tools/record_session.py` stores landmark streams; `tools/replay_session.py` replays them so you can debug without waving your hand |
| Performance | `tools/bench.py` reports FPS, per-stage ms |

**Record/replay is the biggest productivity win in this project.** Build it in Phase 1.
