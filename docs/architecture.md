# FormFlow - System Architecture

**Related:** [Idea Brief](./idea-brief.md) | [PRD](./prd.md) | [Pipeline](./pipeline.md)

---

## 1. Overview

FormFlow is a desktop Python application with two product modes that share the same sensing layer (webcam + hand tracking) and diverge at the geometry layer.

| Layer | Responsibility |
| ----- | -------------- |
| Input | Webcam frames |
| Tracking | MediaPipe Hands landmarks and gestures |
| Interaction | Virtual pencil (index fingertip + pinch) |
| Sketching | Stroke capture, smoothing, storage |
| Mode 1 path | Map strokes to 3D trajectories; Open3D view |
| Mode 2 path | Orthographic canvases, CV cleanup, alignment, visual hull, mesh |
| Output | Interactive viewer + OBJ / STL export |

---

## 2. High-level architecture

```text
                        FORMFlow
                           |
              +------------+------------+
              |                         |
         RAPID 3D                  2D to 3D
        PROTOTYPING              RECONSTRUCTION
              |                         |
           Webcam                    Webcam
              |                         |
        Hand Tracking            Hand Tracking
              |                         |
        Virtual Pencil           Virtual Pencil
              |                         |
        3D Trajectory         Front / Top / Side
              |                         |
          Smoothing               Preprocessing
              |                         |
       3D Visualization        Contour Extraction
                                        |
                                  View Alignment
                                        |
                              Multi-View Geometry
                                        |
                               3D Reconstruction
                                        |
                              +---------+---------+
                              |                   |
                          3D Viewer             Export
                                              OBJ / STL
```

---

## 3. Shared components

### 3.1 Webcam capture

- Continuous frame acquisition from a standard camera
- Frames fed to hand tracking and (optionally) UI overlays
- No specialized depth camera required for MVP

### 3.2 Hand tracking

- Library: MediaPipe Hands
- Role: **input mechanism only** (not a model trained in this project)
- Primary landmarks: index fingertip, thumb (for pinch), supporting landmarks for gesture stability

### 3.3 Virtual pencil

| Aspect | Behavior |
| ------ | -------- |
| Tip | Index fingertip position |
| Draw ON | Pinch (or configurable gesture) |
| Draw OFF | Release |
| Output | Time-ordered 2D or 3D points forming strokes |

### 3.4 Stroke store

- Each stroke is an independent polyline
- Supports undo, delete stroke, clear workspace
- Raw points are smoothed before display or reconstruction

---

## 4. Mode 1 architecture - Rapid 3D

```text
Frame
  -> Hand landmarks
  -> Gesture state (pencil on/off)
  -> Fingertip (x, y) + approximate depth cue
  -> Coordinate mapping into 3D workspace
  -> Stroke buffer
  -> Smoothing / interpolation
  -> Open3D line / point visualization
  -> Export (optional)
```

### Design notes

- Depth from monocular tracking is **relative**, not metric
- Workspace provides axes and camera controls (rotate / zoom / pan)
- Focus is ideation speed, not geometric precision

---

## 5. Mode 2 architecture - Multi-view reconstruction

```text
Frame
  -> Hand landmarks
  -> Virtual pencil on active view canvas (Front | Top | Side)
  -> Stroke rasterization onto 2D view
  -> Preprocessing (threshold, morphology)
  -> Contour / silhouette extraction
  -> Cross-view alignment (width / height / depth)
  -> Consistency checks
  -> Back-projection of each silhouette
  -> Volume intersection (visual hull / voxels)
  -> Mesh extraction
  -> Open3D viewer
  -> OBJ / STL export
```

### View canvases

Three logical orthographic planes sharing a common origin and scale:

```text
        TOP
         |
         |
FRONT ---+--- SIDE
```

### Shared dimensions

| Pair | Constraint |
| ---- | ---------- |
| Front + Top | Width |
| Front + Side | Height |
| Top + Side | Depth |

Manual correction of scale / alignment is allowed when automatic agreement fails.

---

## 6. Reconstruction module

### Approach

**Visual hull** (silhouette intersection) implemented with voxels (or an equivalent discrete occupancy grid).

### Steps

1. Convert each cleaned silhouette into a binary occupancy mask
2. Back-project each mask into 3D along the corresponding orthographic axis
3. Intersect the three occupancy volumes
4. Optionally morphologically clean the voxel solid
5. Extract a surface mesh (for example marching cubes or Open3D mesh utilities)
6. Display and export

### Properties

| Property | Implication |
| -------- | ----------- |
| Explainable | No learned network; geometry is deterministic given silhouettes |
| Approximate | Concavities and hidden features may be wrong or filled |
| Iterative | User can edit a silhouette and re-run reconstruction |

---

## 7. Visualization and export

### Open3D viewer

- Render mesh or voxel solid
- Camera control: rotate, zoom, pan
- Coordinate axes / grid for orientation
- Optional side-by-side comparison with original views

### Export formats (MVP)

- **OBJ** - mesh interchange
- **STL** - common for prototyping / printing pipelines

Export quality matches reconstruction quality: approximate prototype, not manufacturing CAD.

---

## 8. Module boundaries (suggested implementation layout)

Logical packages (names illustrative):

| Module | Responsibility |
| ------ | -------------- |
| `capture` | Webcam I/O |
| `hands` | MediaPipe wrapper, landmarks, pinch detection |
| `pencil` | Gesture-to-stroke state machine |
| `strokes` | Storage, smoothing, undo |
| `mode_rapid3d` | 3D mapping and Mode 1 UI |
| `mode_multiview` | Three canvases, guides, view switching |
| `cv_process` | Threshold, morphology, contours |
| `align` | Scale / axis alignment, inconsistency warnings |
| `reconstruct` | Visual hull / voxels / mesh |
| `viewer` | Open3D interactive display |
| `export` | OBJ / STL writers |
| `app` | Mode selection and application shell |

---

## 9. Non-functional architecture constraints

- Prefer CPU-friendly real-time loops for tracking and drawing feedback
- Keep reconstruction interactive for typical sketch resolutions (may run slightly offline relative to the camera loop)
- Fail gracefully when hand is lost: pause drawing, keep existing strokes
- Prefer warnings over silent geometric failure when views disagree

---

## 10. Out of scope for core architecture

- Custom neural reconstruction networks
- Semantic object recognition
- Photorealistic rendering
- Required depth cameras or HMDs
- Full AR placement (optional later extension)
