# Phase 2 - 3D Sketching (Track A, Mode 1)

**Track:** A | **Depends on:** Phase 1 | **Unlocks:** Phase 6
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

Draw in the air and see the strokes as a 3D sketch in an Open3D window that you can rotate, inspect, edit and save.

## Design

```text
Smoothed fingertip (x, y) + depth cue d
  -> workspace mapping (x, y, d) in [-1, 1]^3
  -> active 3D stroke buffer
  -> smoothing / resample
  -> Open3D LineSet (live) + optional tube mesh (stretch)
```

Depth strategy (see risk R2), in order of implementation:

1. **Plane mode (baseline):** draw on a plane at depth `d`; change `d` with keys `W`/`S` or a gesture. Reliable.
2. **Hand-scale depth:** `d` from filtered hand size (closer to camera means larger).
3. **MediaPipe z:** `d` from landmark z, filtered.

## Tasks

### 2.1 Workspace
- [ ] Define 3D workspace box, axes gizmo, ground grid
- [ ] Mapping: image pixel to workspace x, y (with aspect handling, mirror aware)
- [ ] Depth source abstraction (`PlaneDepth`, `HandScaleDepth`, `LandmarkZDepth`)
- [ ] Depth calibration step ("hold hand near, then far")
- [ ] Depth clamping and smoothing

### 2.2 Open3D integration (viewer/o3d_viewer.py, mode_rapid3d/render.py)
- [ ] Non-blocking visualizer with update loop
- [ ] Incremental LineSet update per new point (avoid rebuilding everything every frame)
- [ ] One colour per stroke, active stroke highlighted
- [ ] Cursor marker (small sphere) at the live fingertip 3D position
- [ ] Viewer camera: rotate / zoom / pan (mouse), reset view key
- [ ] Preset views: front, top, side, isometric (keys)

### 2.3 Stroke operations
- [ ] New stroke on pinch, end on release
- [ ] Undo / redo
- [ ] Delete last stroke, clear all, reset workspace
- [ ] Select and delete a stroke (stretch: pick by proximity to cursor)
- [ ] Smoothing and resampling of 3D polylines

### 2.4 Rotate while drawing
- [ ] Keyboard orbit left/right/up/down
- [ ] Gesture rotate (stretch): open-palm drag rotates the view
- [ ] Never draw while orbiting (mode separation)

### 2.5 Persistence and export
- [ ] Save / load project JSON
- [ ] Export strokes as OBJ polylines (`l` elements)
- [ ] Optional: export tube mesh as STL (stretch)

### 2.6 UX
- [ ] On-screen mode label "Rapid 3D" + depth readout
- [ ] Split view: webcam + 2D guide on the left, Open3D on the right (windows arranged side by side)
- [ ] Hint overlay: "Pinch to draw, fist to undo"

## Exit criteria

- [ ] Draw a 3D spiral and a simple cube-like wireframe, rotate and inspect from all sides
- [ ] Undo / redo / clear all work
- [ ] Save, reload, and export OBJ that opens in Blender or MeshLab
- [ ] Depth mode switch works without restarting
- [ ] Documented: depth is approximate (shown in the UI once)

## Risks touched
R2, R5, R6

## Cut candidates
Hand-scale and landmark-z depth, gesture rotate, tube mesh export
