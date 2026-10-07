# FormFlow - Computer Vision Pipeline

**Related:** [Architecture](./architecture.md) | [PRD](./prd.md) | [Idea Brief](./idea-brief.md)

---

## 1. Purpose

This document logs the image processing and geometry steps FormFlow uses to go from hand motion to clean silhouettes and (in Mode 2) to a 3D prototype.

Scope of this project:

- OpenCV image processing
- MediaPipe Hands as input
- Classical multi-view geometry / visual hull
- **No custom ML training**

---

## 2. Hand tracking pipeline

```text
Webcam frame
  -> MediaPipe Hands
  -> Landmarks (21 points per hand)
  -> Index fingertip position
  -> Thumb-index distance (pinch)
  -> Pencil ON / OFF state
```

### Landmarks of interest

| Landmark use | Role |
| ------------ | ---- |
| Index fingertip | Pencil tip position |
| Thumb tip | Pinch detection with index |
| Other landmarks | Stability / optional secondary gestures |

### Notes

- Tracking quality depends on lighting, camera, background, and occlusion
- When the hand is lost mid-stroke, end the current stroke cleanly rather than inventing points

---

## 3. Stroke processing

Raw fingertip motion contains jitter. Before drawing or reconstruction:

```text
Raw points
  -> Moving-average smoothing
  -> Low-pass filtering (optional)
  -> Point interpolation (optional)
  -> Noise / outlier removal
  -> Stroke segmentation (on pencil OFF or long gap)
```

### Objectives

- Stable visual strokes
- Contours that are easier to threshold and extract
- Independent stroke objects for undo / delete

---

## 4. Mode 1 - 3D trajectory mapping

```text
Smoothed 2D fingertip (image space)
  -> Map x, y into workspace plane
  -> Assign approximate depth (relative cue or fixed-plane + user depth control)
  -> Append to active 3D stroke
  -> Render as polyline / point cloud in Open3D
```

Depth remains approximate. Mode 1 is a **spatial sketching** tool, not a metrology tool.

---

## 5. Mode 2 - Per-view drawing canvas

Each of Front, Top, and Side is a 2D orthographic canvas with:

- Grid
- Reference axes
- Center lines
- Optional dimension guides

Strokes are rasterized onto a binary or grayscale drawing buffer for that view.

---

## 6. Contour extraction pipeline

Once a view drawing is complete (or when reconstruction is requested):

```text
Hand-drawn view (raster)
  -> Grayscale
  -> Thresholding
  -> Small-noise removal
  -> Morphological open / close (as needed)
  -> Contour detection
  -> Select primary object boundary / silhouette
  -> Clean silhouette mask
```

### Output of this stage

```text
Hand-drawn view  ->  Clean silhouette / contour
```

If multiple contours exist, prefer the largest plausible object contour; allow manual selection later if needed.

---

## 7. Multi-view alignment

The three silhouettes must share a consistent coordinate frame.

### Shared dimensions

| Views | Shared quantity |
| ----- | --------------- |
| Front + Top | Width |
| Front + Side | Height |
| Top + Side | Depth |

### Alignment actions

- Normalize scale using reference axes or user-defined calibration marks
- Translate silhouettes so origins / center lines coincide
- Allow manual nudge when automatic alignment is insufficient

### Inconsistency detection

Compare shared extents across views. If disagreement exceeds a threshold, warn the user instead of forcing a silent reconstruction.

Example:

```text
Front width = 100 px
Top width   = 130 px
-> Warning: views may be misaligned
```

---

## 8. Visual hull reconstruction

```text
Front silhouette  -> back-project along depth axis
Top silhouette    -> back-project along height axis
Side silhouette   -> back-project along width axis
       |
       v
Intersect occupancy volumes
       |
       v
Voxel solid
       |
       v
Surface extraction (mesh)
       |
       v
Interactive 3D model
```

### Why this method

- Fits course scope: classical CV + geometry
- Deterministic and explainable
- Works from three orthographic silhouettes without training data

### Inherent limits

- Cannot recover all concavities
- Wrong or incomplete views produce wrong solids
- Result is an **approximation** suitable for ideation

---

## 9. Re-edit loop

```text
View model
  -> Edit Front / Top / Side
  -> Re-run CV processing
  -> Re-align
  -> Reconstruct
  -> Updated model
```

This loop is a first-class feature: reconstruction is iterative, not one-shot.

---

## 10. Evaluation hooks (pipeline metrics)

Useful measurements during development:

| Metric | What it indicates |
| ------ | ----------------- |
| Tracking latency / FPS | Interaction responsiveness |
| Stroke jitter before vs after smoothing | Stroke quality |
| Contour cleanliness (noise area, holes) | CV stage health |
| Shared-dimension error across views | Alignment quality |
| Silhouette consistency after projection | Reconstruction plausibility |
| Reconstruction time | Practical interactivity |
| Mesh / voxel integrity | Output usability |

---

## 11. Pipeline summary (Mode 2)

```text
Webcam
  -> Hand tracking
  -> Virtual pencil strokes on Front / Top / Side
  -> Stroke smoothing
  -> Raster drawing
  -> Threshold + morphology
  -> Contour / silhouette
  -> Alignment + consistency check
  -> Visual hull (voxel intersection)
  -> Mesh
  -> Viewer + OBJ / STL
```
