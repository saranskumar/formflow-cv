# Phase 3 - Multi-View Canvases (Track B, Mode 2)

**Track:** B | **Depends on:** Phase 1 | **Unlocks:** Phase 4
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

Three orthographic drawing canvases (Front, Top, Side) with guides and editing tools, drawable with the hand pencil or the mouse.

## Layout

```text
+---------------------------+----------------+
| Active canvas (large)     | Webcam preview |
|                           +----------------+
|                           | Front | Top    |
|                           | Side  | status |
+---------------------------+----------------+
```

The active canvas is large; the other two are thumbnails. Hand coordinates map onto the active canvas through a calibrated "drawing rectangle" in the camera frame.

## Tasks

### 3.1 Canvas model (mode_multiview/canvas.py)
- [ ] `ViewCanvas` with name, size 512x512, `StrokeStore`, cached raster
- [ ] World-axis mapping per view (see [tech-spec section 3](../tech-spec.md))
- [ ] Three canvases share origin and scale
- [ ] Render strokes to raster (thickness configurable)

### 3.2 Hand-to-canvas mapping
- [ ] Define drawing region in camera frame (e.g. central 60 %)
- [ ] Map fingertip to canvas coordinates; clamp to canvas
- [ ] Calibration helper: "touch corners" or simple fixed region with on-screen frame
- [ ] Mouse drawing fallback into the same stroke pipeline (official feature, Q6)

### 3.3 Guides (mode_multiview/guides.py)
- [ ] Grid (toggle)
- [ ] Reference axes and centre lines
- [ ] Shared-dimension guides: when a stroke extreme is drawn in one view, show faint horizontal/vertical lines in the other views (e.g. Front's width shows in Top)
- [ ] Axis labels (X/Y/Z) per view and a tiny orientation icon
- [ ] Snap to grid (toggle, off by default; "assist without forcing shapes")
- [ ] Snap-to-close: pencil release near the start point closes the outline

### 3.4 Tools
- [ ] Undo / redo (per view)
- [ ] Clear view
- [ ] Delete stroke
- [ ] Eraser (stretch)
- [ ] Brush thickness
- [ ] Line straightening helper (stretch, optional)
- [ ] Mirror/symmetry helper across the centre line (stretch, big win for usability)

### 3.5 View switching
- [ ] Keys `F` `T` `S`
- [ ] Click thumbnail with pinch or dwell
- [ ] Per-view completion flag ("done" marker)

### 3.6 Persistence
- [ ] Save / load three-view project JSON
- [ ] Load sample drawings (so demos don't depend on drawing live)

### 3.7 UX
- [ ] Prompt per step: "Draw FRONT view" then "TOP" then "SIDE"
- [ ] Reconstruct button enabled only when all three views have a stroke
- [ ] Hint overlay for the active view orientation

## Exit criteria

- [ ] Draw all three views using hand pencil or mouse
- [ ] Guides visible and togglable
- [ ] Undo / redo / clear work per view
- [ ] Save, reload, drawings identical
- [ ] Hand-loss never corrupts a canvas

## Risks touched
R1, R4, R7
