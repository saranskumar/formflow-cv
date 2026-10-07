# FormFlow - Feature Catalog

**Related:** [Roadmap](./00-roadmap.md) | [Checklist](./checklist.md) | [PRD functional requirements](../prd.md)

Priority: **M** = MVP, **P** = polish, **X** = extension.

---

## A. Input and hand interaction (Phase 1)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| A1 | Webcam capture, threaded, mirror option | FR1 | M | 1 |
| A2 | Hand detection and 21-landmark tracking | FR1 | M | 1 |
| A3 | Index fingertip as pencil tip | FR2 | M | 1 |
| A4 | One-Euro jitter filtering | FR5 | M | 1 |
| A5 | Pinch draw ON/OFF with hysteresis and debounce | FR3 | M | 1 |
| A6 | Hover cursor and live status | FR3 | M | 1 |
| A7 | Hand-size normalisation | FR3 | M | 1 |
| A8 | Hand-loss handling (clean stroke end) | FR4 | M | 1 |
| A9 | Fist gesture = undo | | P | 1 |
| A10 | Open palm = pause | | P | 1 |
| A11 | Dwell-click buttons | | M | 1 |
| A12 | Keyboard fallback for all actions | | M | 0-6 |
| A13 | Record / replay of landmark sessions | | M | 1 |
| A14 | Configurable gesture map and thresholds | PRD s7 | M | 0-1 |
| A15 | Left-handed support | | P | 7 |
| A16 | Per-user pinch calibration | | P | 7 |
| A17 | Gesture view switching / rotation | | P | 7 |

## B. Strokes and editing (Phases 1, 3)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| B1 | Independent stroke objects | FR4 | M | 1 |
| B2 | Moving-average smoothing | FR5 | M | 1 |
| B3 | Outlier / noise removal | FR5 | M | 1 |
| B4 | Interpolation / resampling | FR5 | M | 1 |
| B5 | Undo / redo | PRD s8 | M | 1 |
| B6 | Delete stroke / clear view | PRD s8 | M | 1 |
| B7 | Eraser | | P | 3/7 |
| B8 | Symmetry assist | | P | 7 |
| B9 | Snap-to-close outline | | M | 3 |
| B10 | Straightening / shape snapping (non-forced) | | P | 7 |
| B11 | Mouse drawing fallback | | M | 3 |

## C. Mode 1 - Rapid 3D prototyping (Phase 2)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| C1 | 3D workspace with axes and grid | FR6 | M | 2 |
| C2 | Plane-mode depth with key / gesture control | FR6 | M | 2 |
| C3 | Hand-scale and landmark-z depth | FR6 | P | 2/7 |
| C4 | Live 3D stroke rendering (Open3D LineSet) | FR6 | M | 2 |
| C5 | Rotate / zoom / pan | PRD s7 | M | 2 |
| C6 | Preset camera views | | M | 2 |
| C7 | Undo / delete stroke / reset | PRD s7 | M | 2 |
| C8 | Select stroke by proximity | | P | 7 |
| C9 | Tube / ribbon stroke rendering | | P | 7 |
| C10 | Save / load sketch | | M | 2 |
| C11 | Export polylines as OBJ | FR13 | M | 2 |
| C12 | Export tube mesh as STL | FR13 | X | 9 |

## D. Mode 2 - Multi-view drawing (Phase 3)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| D1 | Front / Top / Side canvases | FR7 | M | 3 |
| D2 | Common coordinate system | FR8 | M | 3 |
| D3 | Grid, axes, centre lines | PRD s8 | M | 3 |
| D4 | Shared-dimension guide lines across views | PRD s8 | M | 3 |
| D5 | View switching (keys, dwell) | FR7 | M | 3 |
| D6 | Per-view undo / redo / clear | PRD s8 | M | 3 |
| D7 | Guided workflow prompts | NFR usability | M | 3 |
| D8 | Save / load three-view projects, sample sketches | | M | 3 |
| D9 | Brush thickness | | M | 3 |
| D10 | Grid snapping (toggle) | PRD s8 | P | 3 |

## E. CV processing (Phase 4)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| E1 | Stroke rasterisation | FR9 | M | 4 |
| E2 | Threshold + noise removal | FR9 | M | 4 |
| E3 | Morphological open/close | FR9 | M | 4 |
| E4 | Closed-outline detection + gap bridging | FR9 | M | 4 |
| E5 | Contour extraction and fill | FR9 | M | 4 |
| E6 | Largest-contour selection | FR9 | M | 4 |
| E7 | Hole (cut-out) support | | P | 4/7 |
| E8 | Geometric features (bbox, area, centroid) | FR9 | M | 4 |
| E9 | CV debug stage viewer | | M | 4 |
| E10 | Manual contour selection | | P | 7 |

## F. Alignment (Phase 4)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| F1 | Shared extents (width, height, depth) | FR8 | M | 4 |
| F2 | Auto-scale to reference view | FR8 | M | 4 |
| F3 | Auto-centre | FR8 | M | 4 |
| F4 | Mismatch warning with threshold | PRD s8 | M | 4 |
| F5 | Manual nudge / scale | PRD pipeline s7 | P | 4/7 |
| F6 | Per-view status indicators | | M | 4 |

## G. Reconstruction (Phase 5)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| G1 | Resample to voxel grid | FR10 | M | 5 |
| G2 | Orthographic visual hull | FR10 | M | 5 |
| G3 | Largest-component voxel cleanup | FR10 | M | 5 |
| G4 | Marching-cubes mesh | FR10 | M | 5 |
| G5 | Optional smoothing, normals | FR10 | P | 5 |
| G6 | Watertight / manifold check | | M | 5 |
| G7 | Re-projection IoU metric | PRD s15 | M | 5 |
| G8 | Preview vs final resolution | | P | 5/7 |
| G9 | Mesh decimation | | P | 7 |
| G10 | Cross-section carving | | X | 9 |

## H. Viewer and export (Phase 6)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| H1 | Interactive Open3D viewer | FR11 | M | 6 |
| H2 | Axes and grid in viewer | FR11 | M | 6 |
| H3 | Mesh / wireframe / voxel toggle | FR11 | P | 6 |
| H4 | Side-by-side source silhouettes | PRD arch s7 | P | 6 |
| H5 | Re-edit loop (edit view, re-reconstruct) | FR12 | M | 6 |
| H6 | OBJ export | FR13 | M | 6 |
| H7 | STL export | FR13 | M | 6 |
| H8 | Project save / autosave / recover | | M | 6 |
| H9 | Info panel (triangles, time, watertight) | | P | 6 |

## I. App shell and UX (Phases 0, 6, 7)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| I1 | Start screen with mode selection | PRD s6 | M | 0 |
| I2 | App state machine | | M | 6 |
| I3 | Error handling and friendly messages | NFR robustness | M | 6 |
| I4 | First-run tutorial and hints | NFR usability | P | 7 |
| I5 | Settings screen | | P | 7 |
| I6 | Logging, config, crash recovery | | M | 0/6 |
| I7 | Packaging / one-click launcher | | P | 7 |

## J. Evaluation (Phase 8)

| ID | Feature | PRD | Pri | Phase |
| -- | ------- | --- | --- | ----- |
| J1 | Timing / counter instrumentation | PRD s15 | P | 8 |
| J2 | Ground-truth shape benchmark | PRD s15 | P | 8 |
| J3 | Noise-robustness experiments | PRD s15 | P | 8 |
| J4 | User study and questionnaire | PRD s15 | P | 8 |
| J5 | Report figures + demo video | | P | 8 |

## K. Extensions (Phase 9)

See [phase-9-extensions](./phases/phase-9-extensions.md): X1-X12.

---

## Traceability: PRD FR to features

| FR | Features |
| -- | -------- |
| FR1 | A1, A2 |
| FR2 | A3 |
| FR3 | A5, A6, A7 |
| FR4 | A8, B1 |
| FR5 | A4, B2, B3, B4 |
| FR6 | C1-C4 |
| FR7 | D1, D5 |
| FR8 | D2, F1-F3 |
| FR9 | E1-E8 |
| FR10 | G1-G5 |
| FR11 | H1, H2 |
| FR12 | H5 |
| FR13 | C11, H6, H7 |
