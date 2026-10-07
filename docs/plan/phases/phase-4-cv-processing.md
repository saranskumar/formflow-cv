# Phase 4 - CV Processing & Alignment (Track B)

**Track:** B | **Depends on:** Phase 0 (synthetic fixtures); Phase 3 for live data | **Unlocks:** Phase 5
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

Turn each hand-drawn raster into a clean binary silhouette, then make the three silhouettes share one coordinate frame, warning when they disagree.

**Build test-first on generated images.** No webcam needed.

## Pipeline

```text
Stroke raster
  -> grayscale
  -> threshold
  -> small-noise removal
  -> morphological close (bridge small gaps) / open (remove specks)
  -> closure check
  -> external contour (and optional holes)
  -> fill (drawContours / flood fill from outside)
  -> clean silhouette mask
  -> bounding box + features
```

## Tasks

### 4.1 Rasterisation (cv_process/raster.py)
- [ ] Strokes to binary image at canvas resolution
- [ ] Anti-aliased to threshold path, consistent with live display
- [ ] Deterministic output for same strokes

### 4.2 Silhouette extraction (cv_process/silhouette.py)
- [ ] Threshold (fixed; Otsu not needed on synthetic black/white but keep option)
- [ ] Noise removal by connected-component area filter
- [ ] Morphological close with adaptive kernel (default 5-9 px ellipse)
- [ ] Morphological open (light)
- [ ] `findContours` (RETR_EXTERNAL for outer, RETR_CCOMP for holes)
- [ ] **Closure test:** fill from outside via flood fill; if nothing is enclosed, outline is open
- [ ] Gap-close escalation: try larger kernels up to a limit, else report "not closed" with the gap location
- [ ] Largest plausible contour wins; area threshold rejects specks
- [ ] Filled mask output (outline to solid)
- [ ] Optional holes: nested contours subtract from the mask (setting on/off)
- [ ] Approximation / smoothing of contour (`approxPolyDP`, optional)
- [ ] Debug image outputs (each stage) for a "show CV steps" key

### 4.3 Geometric features
- [ ] Bounding box, area, centroid, extents
- [ ] Convexity / solidity (for the report)
- [ ] Expose a `SilhouetteInfo` dataclass

### 4.4 Alignment (align/)
- [ ] Normalise each mask to canvas-relative extents
- [ ] Extract shared dimensions:
  - Front width vs Top width (X)
  - Front height vs Side height (Y)
  - Top depth vs Side depth (Z)
- [ ] Compute disagreement ratios
- [ ] Threshold warning (default 10 %); message names the pair and the sizes
- [ ] Auto-fix option: scale one view's extent to match the median/reference view (Front as reference)
- [ ] Auto-centre: translate silhouettes so bounding-box centres line up on shared axes
- [ ] Manual nudge / scale (arrow keys or on-screen buttons) with live preview of shared dimension lines
- [ ] Outputs an `AlignedViews` struct (3 masks on a common grid + warnings list)

### 4.5 UI wiring (needs Phase 3 for live use)
- [ ] "Show silhouette" overlay toggle on each canvas
- [ ] Red highlight on open outline gap
- [ ] Warning banner with specific text
- [ ] Per-view status icons: OK / not closed / mismatch

### 4.6 Tests
- [ ] Closed circle, closed square, closed L: correct mask area (+- 2 %)
- [ ] Circle with 8 px gap closes; 40 px gap reports open
- [ ] Noisy outline (random specks) gets cleaned
- [ ] Two blobs: largest chosen
- [ ] Hollow ring: hole preserved when holes enabled
- [ ] Mismatch 100 vs 130 triggers warning; 100 vs 105 does not
- [ ] Translation offset corrected by auto-centre

## Exit criteria

- [ ] All tests green
- [ ] Hand-drawn circle, square and L from a recorded session produce correct masks
- [ ] Open-outline and mismatch warnings appear with useful messages
- [ ] Debug view shows every stage

## Risks touched
R1, R7, R8
