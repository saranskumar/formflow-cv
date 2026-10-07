# Phase 6 - Integration, Viewer, Re-edit Loop, Export (MVP)

**Track:** Both | **Depends on:** Phases 2, 5 | **Unlocks:** Polish track
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

One cohesive app: choose a mode, draw, reconstruct, inspect, edit, export. Finishing this phase is **MVP done**.

## Tasks

### 6.1 App flow (app.py)
- [ ] State machine: `MENU` to `MODE1` or `MODE2` (`DRAW_FRONT` / `DRAW_TOP` / `DRAW_SIDE` / `REVIEW` / `VIEW_3D`) and back
- [ ] Mode switch preserves or prompts to save work
- [ ] Single shared webcam / tracker instance across modes
- [ ] Consistent key/gesture map across modes ([tech-spec section 4](../tech-spec.md))

### 6.2 Viewer for Mode 2 (viewer/o3d_viewer.py)
- [ ] Display reconstructed mesh with lighting
- [ ] Axes + ground grid
- [ ] Rotate / zoom / pan
- [ ] Preset views (front, top, side, iso)
- [ ] Toggle wireframe / voxel / mesh
- [ ] Optional: show the three source silhouettes as planes beside the model (comparison)
- [ ] Info panel: voxel size, triangle count, watertight, reconstruction time

### 6.3 Re-edit loop (FR12)
- [ ] From viewer, press a key to return to a view canvas with existing strokes intact
- [ ] Edit (undo, delete, redraw), then `R` to reconstruct
- [ ] Viewer updates in place, camera not reset
- [ ] Keep previous mesh until new one succeeds
- [ ] Optional: version history (last 3 meshes), compare

### 6.4 Export (export/)
- [ ] OBJ writer for meshes
- [ ] STL writer (binary), normals computed
- [ ] OBJ polyline writer for Mode 1
- [ ] Output folder `exports/` with timestamped filenames
- [ ] Export result message with file path and watertight status
- [ ] Verify in MeshLab or Blender: scale, orientation, no inverted normals
- [ ] Verify STL loads in a slicer (optional)
- [ ] Document the unit assumption

### 6.5 Project I/O (export/project_io.py)
- [ ] Single project file containing mode, strokes, settings
- [ ] Autosave on exit, "recover last session" on start
- [ ] Versioned schema with migration stub

### 6.6 Error handling
- [ ] Camera missing or lost: banner, mouse fallback
- [ ] Open outline: guided message, point to the view that failed
- [ ] Mismatch: warning with "auto-fix" and "continue anyway"
- [ ] Empty hull: explain which pair of views disagrees
- [ ] Never crash to a traceback in front of the user (global handler, log file)

### 6.7 MVP acceptance run
- [ ] Script: Menu, Mode 2, draw L-bracket (3 views), reconstruct, rotate, edit Side, re-reconstruct, export STL, open in MeshLab
- [ ] Script: Menu, Mode 1, draw a 3D spiral, rotate, undo, export OBJ
- [ ] Both scripts executed by someone other than you (even for 5 minutes)
- [ ] Record screen capture as backup demo (R10)

## Exit criteria (MVP)

- [ ] Everything in the [MVP list](../00-roadmap.md) is ticked
- [ ] Both acceptance scripts pass
- [ ] CHANGELOG updated, tagged `v0.1-mvp` in git

## Risks touched
R5, R6, R10
