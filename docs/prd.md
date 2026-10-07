# FormFlow - Product Requirements Document (PRD)

**Project type:** Computer Vision / Rapid 3D Prototyping  
**Course:** Introduction to Computer Vision  
**Platform:** Desktop application  
**Primary input:** Webcam + hand gestures  
**Core technologies:** OpenCV, MediaPipe Hands, Open3D, Python  
**AI/ML training:** None  
**Development model:** Solo

---

## 1. Product overview

FormFlow is a webcam-based computer vision application that allows rapid visualization of ideas in 3D using the hands as a virtual pencil.

Two independent modes:

| Mode | Name | Purpose |
| ---- | ---- | ------- |
| 1 | Rapid 3D Prototyping | Draw directly in 3D space; fingertip trajectory becomes a spatial sketch |
| 2 | Multi-View 2D to 3D | Draw Front, Top, and Side views; reconstruct an approximate 3D model |

**Goal:** quick ideation, experimentation, and visualization - not replacement of professional CAD.

---

## 2. Problem statement

Turning an idea into a 3D model usually requires CAD knowledge and conventional input devices.

Existing tools introduce overhead for someone who simply wants to ask:

> What would my idea look like in 3D?

### Technical statement (use for project proposal)

> Develop a computer-vision-based system that captures freehand sketches through hand gestures and combines multiple 2D views (Front, Top, and Side) to reconstruct an approximate 3D representation without conventional CAD modelling.

---

## 3. Goals

### Primary

- Enable webcam-based hand interaction
- Use the fingertip as a virtual pencil
- Allow freehand sketches
- Provide direct 3D spatial sketching
- Support Front, Top, and Side views
- Extract geometric information from those views
- Reconstruct an approximate 3D object
- Provide an interactive 3D viewer
- Allow views to be modified and reconstructed again
- Keep the core implementation based on CV and geometry

### Secondary

- Export reconstructed geometry
- Optional AR visualization (extension)
- Optional CAD-compatible output (extension)
- Usefulness for rapid prototyping rather than precision engineering

---

## 4. Non-goals

FormFlow will **not** attempt to:

- Replace professional CAD software
- Produce manufacturing-grade precision
- Perform photorealistic 3D reconstruction
- Train a custom AI/ML model
- Automatically understand arbitrary semantic object categories
- Generate designs using generative AI
- Guarantee mathematically exact reconstruction from three imperfect sketches

---

## 5. Target users

### Primary

- Engineering students
- Design students
- Robotics enthusiasts
- Makers
- Product ideators
- Beginners experimenting with 3D design

### Secondary

- Students learning computer vision
- Researchers experimenting with gesture-based interfaces
- Anyone wanting to quickly visualize a physical concept

---

## 6. Core user experience

### Start screen

User chooses:

1. **Rapid 3D Prototype** - Draw directly in 3D
2. **2D to 3D** - Draw 3 views, then model

---

## 7. Mode 1 - Rapid 3D Prototyping

### Purpose

Create a rough 3D concept without formal 2D drawings.

### User flow

```text
Start
  -> Select Rapid 3D Prototype
  -> Webcam starts
  -> Hand detected
  -> Activate virtual pencil
  -> Move hand
  -> 3D trajectory generated
  -> 3D sketch displayed
  -> Rotate / inspect / erase
  -> Export
```

### Virtual pencil

- Index fingertip = pencil tip
- Example gesture: pinch = pencil ON, release = pencil OFF
- Gesture mapping can be configurable

### Drawing pipeline

```text
Hand movement
  -> Fingertip coordinates
  -> Trajectory points
  -> Smoothing
  -> 3D stroke
```

Each stroke is stored independently so it can be deleted or modified.

### 3D interaction

- Rotate, zoom, pan
- Clear strokes / delete a stroke
- Start a new stroke
- Reset the workspace

### Limitation

Monocular hand tracking does not provide accurate metric depth. Mode 1 produces **relative / approximate** spatial sketches.

---

## 8. Mode 2 - Multi-View 2D to 3D

### Concept

User creates three drawings of the same object:

- Front
- Top
- Side

Presented as aligned orthographic drawing planes with shared dimensions:

| Views | Shared dimension |
| ----- | ---------------- |
| Front + Top | Width |
| Front + Side | Height |
| Top + Side | Depth |

### Drawing assistance

- Grid
- Reference axes
- Center lines
- Dimension / reference guides
- Undo / redo / clear
- Stroke deletion

Assistance should support alignment **without forcing predefined shapes**.

### Iterative reconstruction

```text
3D Model
  -> Notice incorrect shape
  -> Edit a view
  -> Reprocess
  -> Reconstruct
  -> Updated 3D Model
```

The user remains part of the reconstruction loop.

### Inconsistent views

If shared dimensions disagree significantly (example: Front width = 100 px, Top width = 130 px), show a warning such as:

> Views may be misaligned. Check the shared dimensions.

Prefer correction over silently producing a misleading model.

---

## 9. Computer vision and reconstruction (summary)

See also [pipeline.md](./pipeline.md) and [architecture.md](./architecture.md).

### Per-view processing

```text
Raw hand trajectory
  -> Stroke smoothing
  -> Noise removal
  -> 2D projection
  -> Thresholding
  -> Morphological processing
  -> Contour extraction
  -> Geometric feature extraction
```

### Reconstruction technique

Primary approach: **visual hull / voxel reconstruction**

```text
Front / Top / Side silhouettes
  -> Back-project into 3D
  -> Intersect volumes
  -> Voxel representation
  -> Surface / mesh generation
  -> 3D model
```

---

## 10. Functional requirements

| ID | Requirement |
| -- | ----------- |
| FR1 | Detect the user's hand through the webcam |
| FR2 | Track the index fingertip position |
| FR3 | Activate / deactivate drawing through a gesture |
| FR4 | Record fingertip movement as a stroke |
| FR5 | Smooth and clean captured strokes |
| FR6 | Convert trajectories into a 3D representation in Rapid Prototype mode |
| FR7 | Provide Front, Top, and Side drawing views |
| FR8 | Provide a common coordinate system for the three views |
| FR9 | Extract relevant contours from completed drawings |
| FR10 | Reconstruct an approximate 3D representation from the three views |
| FR11 | Display the reconstructed object interactively |
| FR12 | Allow a view to be modified and the 3D model regenerated |
| FR13 | Export reconstructed geometry |

---

## 11. Non-functional requirements

### Performance

Near real-time hand interaction and responsive 3D visualization.

### Usability

A first-time user should understand basic interaction without extensive instructions.

### Robustness

Tolerate moderate hand jitter, drawing noise, small alignment errors, and incomplete strokes.

### Accessibility

Work with a standard webcam; no specialized VR hardware required.

---

## 12. Limitations

| Area | Limitation |
| ---- | ---------- |
| Hand tracking | Depends on lighting, camera quality, visibility, background, occlusion |
| Depth | Monocular tracking is not metric; Mode 1 is approximate |
| Multi-view reconstruction | Three views miss some hidden / concave features |
| Drawing quality | Ambiguous or inconsistent sketches yield poor reconstruction |

---

## 13. Export

### Required

- OBJ
- STL

### Optional (extensions)

- Point cloud
- OpenSCAD-compatible geometry where parametric representation is reasonable

---

## 14. Optional AR mode (extension)

Not part of MVP. Future path:

```text
Draw -> Reconstruct -> 3D Model -> AR Placement -> Inspect -> Modify -> Reconstruct
```

---

## 15. Evaluation

### Technical

- Hand-tracking responsiveness
- Stroke stability
- Reconstruction time
- View alignment error
- Reconstruction accuracy / silhouette overlap
- Mesh / voxel quality

### User testing

- Time to create a prototype
- Number of corrections required
- Ease of learning gesture interaction
- Success rate of reconstruction
- Satisfaction with the resulting 3D representation

---

## 16. Development phases

| Phase | Focus |
| ----- | ----- |
| 1 | Hand interaction: webcam, tracking, fingertip, pencil gesture, strokes |
| 2 | 3D sketching: coordinate mapping, depth handling, smoothing, Open3D |
| 3 | Multi-view interface: Front / Top / Side, tools, grid / references |
| 4 | CV processing: thresholding, morphology, contours, features |
| 5 | Reconstruction: alignment, back-projection, visual hull, mesh |
| 6 | Integration: viewer, editing, re-reconstruction, export |
| 7 | Optional extensions: AR, advanced geometry, OpenSCAD |

---

## 17. MVP

Minimum viable version:

**Virtual pencil**

- Hand tracking
- Gesture-controlled drawing
- Stroke smoothing

**2D to 3D**

- Front / Top / Side views
- Contour extraction
- View alignment
- Basic visual-hull / voxel reconstruction
- 3D visualization

**Output**

- OBJ / STL export

Everything else is an extension.

---

## 18. Final product definition

> FormFlow is a computer-vision-based rapid prototyping system that uses hand gestures as a virtual pencil. It allows free sketching in 3D space or drawing Front, Top, and Side views of an object. Using image processing, hand tracking, multi-view geometry, and 3D reconstruction techniques, FormFlow converts these sketches into an approximate, interactive 3D prototype.

**Core principle:** Draw it. Reconstruct it. Experience it.
