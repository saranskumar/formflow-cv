# FormFlow - Master Checklist

Tick items here as you go. Detailed task lists live in each phase doc. This is the one-page view.

**Links:** [Roadmap](./00-roadmap.md) | [Features](./features.md) | [Decisions & risks](./decisions-and-risks.md)

---

## Phase 0 - Setup  ([detail](./phases/phase-0-setup.md))
- [ ] Python 3.11 venv + pinned requirements
- [ ] Repo + folder layout + git
- [ ] Spike: OpenCV + MediaPipe + Open3D run together 5 min
- [ ] App shell with mode menu
- [ ] Config + logging
- [ ] pytest + synthetic shape generator

## Phase 1 - Hand interaction  ([detail](./phases/phase-1-hand-interaction.md))
- [ ] Threaded webcam capture
- [ ] MediaPipe wrapper
- [ ] One-Euro filter
- [ ] Pinch with hysteresis + debounce
- [ ] Pencil state machine (NO_HAND / HOVER / DRAWING)
- [ ] Stroke store, smoothing, undo/redo
- [ ] Overlay UI, dwell buttons
- [ ] Record / replay tools + 3 reference sessions
- [ ] >= 20 FPS, no ghost strokes

## Phase 2 - 3D sketching, Mode 1  ([detail](./phases/phase-2-3d-sketching.md))
- [ ] Workspace + axes + mapping
- [ ] Plane-mode depth
- [ ] Non-blocking Open3D with incremental LineSet
- [ ] Rotate / zoom / pan + preset views
- [ ] Undo / delete / clear
- [ ] Save / load
- [ ] OBJ polyline export
- [ ] (P) hand-scale / z depth

## Phase 3 - Multi-view canvases  ([detail](./phases/phase-3-multiview-canvases.md))
- [ ] Front / Top / Side canvas model
- [ ] Hand-to-canvas mapping + mouse fallback
- [ ] Grid, axes, centre lines
- [ ] Cross-view shared-dimension guides
- [ ] Snap-to-close
- [ ] Per-view undo / redo / clear
- [ ] View switching
- [ ] Save / load + sample sketches
- [ ] Guided prompts

## Phase 4 - CV processing and alignment  ([detail](./phases/phase-4-cv-processing.md))
- [ ] Rasterisation
- [ ] Threshold, noise removal, morphology
- [ ] Closed-outline detection + gap bridging
- [ ] Contour extraction + fill
- [ ] Features (bbox, area, centroid)
- [ ] Debug stage viewer
- [ ] Shared extents + auto-scale + auto-centre
- [ ] Mismatch warning (100 vs 130 case)
- [ ] UI status per view
- [ ] Synthetic tests green

## Phase 5 - Reconstruction  ([detail](./phases/phase-5-reconstruction.md))
- [ ] Resample to voxel grid
- [ ] Visual hull via broadcasting
- [ ] Asymmetric L orientation test passes
- [ ] Voxel cleanup
- [ ] Marching cubes mesh + normals
- [ ] Watertight check
- [ ] Re-projection IoU
- [ ] Fixtures: cube, cylinder, cone, L, sphere
- [ ] 128^3 in about 2 s, worker thread

## Phase 6 - Integration and export (MVP)  ([detail](./phases/phase-6-integration-export.md))
- [ ] App state machine across modes
- [ ] Open3D viewer for reconstruction
- [ ] Re-edit loop
- [ ] OBJ + STL export, verified in MeshLab/Blender
- [ ] Project save, autosave, recover
- [ ] Friendly error handling
- [ ] Mode 2 acceptance script
- [ ] Mode 1 acceptance script
- [ ] Backup demo recording
- [ ] Tag `v0.1-mvp`

---

### MVP gate (PRD section 17)
- [ ] Hand tracking, gesture drawing, stroke smoothing
- [ ] Front/Top/Side views, contour extraction, view alignment
- [ ] Basic visual hull reconstruction + 3D visualisation
- [ ] OBJ / STL export

---

## Phase 7 - Quality and robustness  ([detail](./phases/phase-7-polish.md))
- [ ] Tracking: calibration, grace period, lighting warning, left-hand
- [ ] Drawing: velocity smoothing, symmetry, eraser, smart close
- [ ] CV: contour select, holes, adaptive kernel
- [ ] Mesh: smoothing, decimation, high-res final
- [ ] Mode 1: tubes, auto-depth, selection
- [ ] UX: tutorial, settings, theme
- [ ] Performance: 30 FPS, soak test, packaging

## Phase 8 - Evaluation  ([detail](./phases/phase-8-evaluation.md))
- [ ] Instrumentation + CSV logs
- [ ] Ground-truth benchmark (6 shapes)
- [ ] Noise robustness curves
- [ ] User study (3-5 people) + questionnaire
- [ ] Report figures + demo video

## Phase 9 - Extensions  ([detail](./phases/phase-9-extensions.md))
- [ ] X5 cross-section carving
- [ ] X6 AR placement
- [ ] X2 tube STL
- [ ] X9 real-world dimensions
- [ ] Others as desired

---

## Per-feature quick checklist (copy for any new feature)
- [ ] Spec line in [features.md](./features.md)
- [ ] Config knob (if tunable)
- [ ] Keyboard fallback
- [ ] Unit test or replay test
- [ ] Hand-loss / empty-input behaviour defined
- [ ] On-screen feedback (success and failure)
- [ ] CHANGELOG entry

## Demo-day checklist
- [ ] Plain background, front lighting, camera at eye level
- [ ] Tested camera index and resolution
- [ ] Sample sketches loaded as backup
- [ ] Recorded replay session as backup
- [ ] Both windows arranged side by side
- [ ] MeshLab/Blender open with an exported STL ready
- [ ] Known limits slide ready (depth is relative; hull over-fills)
