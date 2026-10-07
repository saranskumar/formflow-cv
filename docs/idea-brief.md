# FormFlow - Idea Brief

**Status:** Project proposal  
**Audience:** Course instructors / idea presentation  
**Owner:** Solo developer

---

## 1. Problem

Turning an idea into a 3D model usually requires knowledge of CAD software and conventional input devices. That overhead slows rapid experimentation for beginners and non-experts who simply want to answer: *"What would my idea look like in 3D?"*

### Technical problem statement

> Develop a computer-vision-based system that captures freehand sketches through hand gestures and combines multiple 2D views (Front, Top, and Side) to reconstruct an approximate 3D representation without conventional CAD modelling.

---

## 2. Solution

**FormFlow** uses the webcam and the hand as a virtual pencil. The core engine is computer vision, image processing, and geometry. No custom AI/ML model is trained as part of this project. MediaPipe Hands is used only as an off-the-shelf input mechanism.

### Mode 1 - Rapid 3D Prototyping

Draw directly in 3D space. The index fingertip trajectory becomes a spatial sketch that can be rotated, inspected, and exported.

### Mode 2 - Multi-View 2D to 3D (primary)

Draw the same object from three orthographic views (Front, Top, Side). The system extracts contours, aligns shared dimensions, and reconstructs an approximate 3D model using visual-hull / voxel methods.

FormFlow is intended for **quick ideation and visualization**, not manufacturing-grade CAD.

---

## 3. Tech Stack

| Component | Technology |
| --------- | ---------- |
| Language | Python |
| Computer Vision | OpenCV |
| Hand Tracking | MediaPipe Hands |
| 3D Visualization | Open3D |
| Numerics / Geometry | NumPy + custom geometry algorithms |
| Export | OBJ / STL |

**Platform:** Desktop application  
**Primary input:** Standard webcam + hand gestures  
**AI/ML training:** None

---

## 4. Workflow

End-to-end path from gesture to 3D model:

1. **Capture** - Webcam detects the hand. Index fingertip acts as the pencil tip. Pinch toggles drawing on/off.
2. **Draw** - Mode 1: sketch freely in 3D. Mode 2: draw Front, Top, and Side views of the same object.
3. **Process** - Smooth strokes, threshold, morphology, extract contours, align shared dimensions across views.
4. **Reconstruct** - Back-project silhouettes, intersect volumes (visual hull), generate a mesh, view and optionally re-edit.
5. **Export** - Save the approximate prototype as OBJ or STL.

---

## 5. System Architecture

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

Both modes share webcam input and hand tracking. Multi-view geometry and visual-hull reconstruction apply only to Mode 2.

---

## 6. Expected Output

### Interaction

- Near real-time hand tracking via webcam
- Gesture-controlled virtual pencil
- Smoothed stroke capture

### 3D result

- Mode 1: interactive spatial sketch (relative / approximate depth)
- Mode 2: approximate mesh from three orthographic silhouettes
- Interactive viewer: rotate, zoom, pan
- Ability to edit a view and reconstruct again

### Files

- OBJ export
- STL export

### Quality expectation

Output is an **approximate prototype for ideation**. Three imperfect sketches cannot capture every concave or hidden feature. The system may warn when shared dimensions across views are inconsistent.

---

## Related documents

- [Full PRD](./prd.md)
- [Architecture detail](./architecture.md)
- [CV pipeline](./pipeline.md)
