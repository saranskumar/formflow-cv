# FormFlow

> Draw it. Reconstruct it. Experience it.

Webcam-based rapid 3D prototyping and visual hull reconstruction using hand gestures as a virtual pencil.

---

## Quick start

```powershell
# Install dependencies (Python 3.11-3.12)
pip install -r requirements.txt

# Run the app
python -m formflow
```

**Run from the `code/` directory** (or ensure `src` is in `PYTHONPATH`).

---

## Modes

### Mode 1: Rapid 3D Air Sketching
- Draw directly in 3D air space.
- Inspect, rotate, pan, and zoom in a synchronized non-blocking Open3D window.
- Multiple depth strategies:
  - **Plane Depth**: Fixed-plane drawing with step control (`[` and `]`).
  - **Hand-Scale Depth**: Distance calculated from hand size.
  - **MediaPipe Z**: Relative index fingertip depth.
- Export as 3D polyline OBJ files.

### Mode 2: Multi-View 2D to 3D Visual Hull Reconstruction
- Three orthographic canvases: **Front** (X, Y), **Top** (X, Z), and **Side** (Z, Y).
- Shared-dimension alignment guides projected in real-time.
- Morphological gap closing and outline closure checks.
- Cross-view dimension consistency warnings.
- Orthographic visual hull voxel back-projection and marching cubes mesh generation.
- Re-edit loop: jump between views, edit strokes, and re-reconstruct seamlessly.
- Export to **OBJ** and **binary STL** for 3D printing and CAD.

---

## Controls & Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `1` | Menu | Launch Mode 1 (Rapid 3D) |
| `2` | Menu | Launch Mode 2 (Multi-view 2D to 3D) |
| `F` / `T` / `S` | Mode 2 | Switch to Front / Top / Side view |
| `R` | Mode 2 | Trigger Visual Hull 3D Reconstruction |
| `E` | Both | Export 3D models (OBJ / STL) |
| `P` | Mode 2 | Save project file (`exports/*.json`) |
| `[` / `]` | Mode 1 | Adjust depth plane closer / farther |
| `M` | Mode 1 | Cycle depth strategy (Plane / Hand Scale / MediaPipe Z) |
| `J` / `L` | Mode 1 | Orbit camera view left / right |
| `F` / `T` / `S` / `I` | Mode 1 | Reset camera view (Front, Top, Side, Iso) |
| `Z` / `Y` | Both | Undo / Redo |
| `C` | Both | Clear active canvas |
| `G` | Mode 2 | Toggle canvas grid |
| `Space` | Both | Toggle keyboard pencil (manual override) |
| `H` | Both | Toggle hand landmark skeleton overlay |
| `Esc` | Both | Return to menu / Quit |

**Hand Gestures:**
- **Pinch** (index fingertip + thumb tip close) -> Pencil DRAWING
- **Open palm / Hover** -> Cursor tracking
- **Fist (hold ~0.6s)** -> Undo stroke

**Mouse Fallback:**
- Click & drag directly on the active canvas in Mode 2 to draw.
- Click thumbnails on the right panel to switch views.

---

## Project Structure

```
code/
  src/formflow/
    app.py                  # Main application shell & state machine
    config.py               # Tunable settings & JSON configuration
    capture/webcam.py       # Threaded webcam capture
    hands/
      tracker.py            # MediaPipe hands tracking
      filters.py            # One-Euro filter for jitter reduction
      pinch.py              # Normalized pinch & gesture detection
    pencil/state_machine.py # Virtual pencil states
    strokes/store.py        # Stroke store (undo/redo, smoothing, 2D/3D)
    mode_rapid3d/
      mapping.py            # 2D to 3D workspace & depth mapping
      render.py             # Open3D LineSet & cursor sphere rendering
      session.py            # Rapid 3D interactive session
    mode_multiview/
      canvas.py             # ViewCanvas orthographic drawing surfaces
      guides.py             # Grid, center axes, & shared-dimension guides
      session.py            # 3-view composite canvas & UI session
    cv_process/
      raster.py             # Deterministic stroke rasterization
      silhouette.py         # Morphological gap-closing & contour fill
    align/
      consistency.py        # Shared extent checking & mismatch warnings
      normalize.py          # Auto-scaling to reference & centering
    reconstruct/
      hull.py               # Visual hull voxel back-projection
      mesh.py               # Marching cubes & watertight mesh extraction
    viewer/o3d_viewer.py    # Non-blocking Open3D visualizer
    export/
      obj.py                # Wavefront OBJ polyline & mesh exporters
      stl.py                # Binary STL exporter
      project_io.py         # JSON project save/load
    ui/overlay.py           # OpenCV HUD overlay
  tests/
    test_filters.py
    test_pencil.py
    test_strokes.py
    test_mode_rapid3d.py
    test_multiview.py
    test_cv_process.py
    test_reconstruction.py
  samples/
    l_bracket_project.json  # Pre-built 3-view test project
    l_bracket.obj           # Verified 3D OBJ export
    l_bracket.stl           # Verified watertight STL export
```

---

## Test Suite

Run the full automated test suite:

```powershell
python -m pytest -v
```

All **32 unit tests** pass covering geometry, filters, state machine, CV pipeline, alignment, visual hull reconstruction, watertight mesh extraction, and OBJ/STL export.
