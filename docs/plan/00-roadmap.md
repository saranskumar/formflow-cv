# FormFlow - Execution Roadmap

**Related:** [Features](./features.md) | [Master checklist](./checklist.md) | [Tech spec](./tech-spec.md) | [Decisions & risks](./decisions-and-risks.md) | [PRD](../prd.md)

---

## 1. Strategy

Your constraints, as given:

| Constraint | Consequence for the plan |
| ---------- | ------------------------ |
| "Finish ASAP, then no time limit to polish" | Two tracks: **Ship track** (Phases 0-6, MVP, fastest path to a working demo) and **Polish track** (Phases 7-9, no deadline) |
| Both modes in parallel | One shared foundation (Phases 0-1), then **Track A (Mode 1)** and **Track B (Mode 2)** run side by side, merge at Phase 5 |
| OpenCV window + Open3D window | No GUI framework. UI is drawn onto the OpenCV frame; 3D is a separate non-blocking Open3D window |
| Outline drawing, auto-filled | CV stage needs closed-contour detection, gap closing, flood fill, and a clear "outline not closed" warning |

**Solo-dev rule:** one thing at a time inside each track. "Parallel" means the two tracks share no code beyond the foundation, so you can switch between them when blocked, not that you work on both in the same hour.

---

## 2. Phase map

```text
SHIP TRACK
Phase 0  Setup & skeleton ----------------+
Phase 1  Hand interaction (shared) -------+
                                          |
                    +---------------------+--------------------+
                    |                                          |
        TRACK A (Mode 1)                              TRACK B (Mode 2)
        Phase 2  3D sketching                         Phase 3  Multi-view canvases
                                                      Phase 4  CV processing + alignment
                                                      Phase 5  Reconstruction
                    |                                          |
                    +---------------------+--------------------+
                                          |
Phase 6  Integration, export, MVP hardening  <-- MVP DONE

POLISH TRACK (no deadline)
Phase 7  Quality & robustness
Phase 8  Evaluation & user testing
Phase 9  Extensions (AR, OpenSCAD, point cloud, ...)
```

Note: the PRD numbers Phase 2 as 3D sketching and Phase 5 as reconstruction. This plan keeps those, adds **Phase 0** (setup) and splits the PRD's Phase 6 into integration (6) and polish (7-8).

---

## 3. Phase summary

| # | Phase | Track | Goal | Exit criteria (summary) | Detail |
| - | ----- | ----- | ---- | ----------------------- | ------ |
| 0 | Setup & skeleton | Shared | Repo, env, module stubs, app shell, config | `python -m formflow` opens a window with mode menu | [phase-0](./phases/phase-0-setup.md) |
| 1 | Hand interaction | Shared | Webcam to stable fingertip to pinch to strokes | Smooth strokes drawn on a 2D overlay at >= 20 FPS | [phase-1](./phases/phase-1-hand-interaction.md) |
| 2 | 3D sketching | A | Mode 1 end to end | Draw in air, see 3D strokes in Open3D, rotate, undo, save | [phase-2](./phases/phase-2-3d-sketching.md) |
| 3 | Multi-view canvases | B | Three drawing views with guides and tools | Draw 3 views with grid, undo, view switching | [phase-3](./phases/phase-3-multiview-canvases.md) |
| 4 | CV processing + alignment | B | Raster to clean silhouette, cross-view checks | Closed outline to filled mask; mismatch warning works | [phase-4](./phases/phase-4-cv-processing.md) |
| 5 | Reconstruction | B | Silhouettes to voxel hull to mesh | Known test shapes (cube, cylinder, L-bracket) reconstruct correctly | [phase-5](./phases/phase-5-reconstruction.md) |
| 6 | Integration & export | Both | Single app, viewer, re-edit loop, OBJ/STL | MVP demo run start to finish without touching keyboard-only hacks | [phase-6](./phases/phase-6-integration-export.md) |
| 7 | Quality & robustness | Polish | Tracking loss, UX, performance, errors | Survives bad lighting / hand loss / bad sketches gracefully | [phase-7](./phases/phase-7-polish.md) |
| 8 | Evaluation & testing | Polish | Metrics and user study | Metrics table + 3-5 user sessions recorded | [phase-8](./phases/phase-8-evaluation.md) |
| 9 | Extensions | Polish | Optional features | Per extension, see doc | [phase-9](./phases/phase-9-extensions.md) |

---

## 4. Parallelisation plan

| Step | Track A (Mode 1) | Track B (Mode 2) | Shared |
| ---- | ---------------- | ---------------- | ------ |
| 1 | | | Phase 0, Phase 1 |
| 2 | Phase 2 sketch mapping + Open3D | Phase 3 canvases + tools | |
| 3 | Phase 2 undo, save, stroke ops | Phase 4 CV pipeline (can be tested with **synthetic images, no webcam**) | |
| 4 | Phase 2 depth tuning | Phase 5 reconstruction (can be tested with **hard-coded silhouettes**) | |
| 5 | | | Phase 6 merge |

**Why this works:** Phases 4 and 5 are pure functions on images and arrays. Build them test-first against generated shapes, and they never depend on the webcam being reliable.

**Context-switch rule:** when webcam or lighting is the blocker, switch to Phases 4-5 work (offline). When geometry is the blocker, switch to Mode 1.

---

## 5. MVP definition (end of Phase 6)

Copied from the PRD, made testable:

- [ ] Hand tracking with fingertip pencil and pinch toggle
- [ ] Stroke smoothing
- [ ] Mode 2: Front / Top / Side canvases, outline drawing, auto-fill
- [ ] Contour extraction + cross-view alignment + mismatch warning
- [ ] Visual hull reconstruction to mesh
- [ ] Open3D viewer (rotate / zoom / pan)
- [ ] Edit a view and re-reconstruct
- [ ] OBJ and STL export that open correctly in MeshLab / Blender
- [ ] Mode 1: 3D air sketch with rotate, undo, clear, export as polyline OBJ

Mode 1 is in the MVP because you chose parallel development, but it is the first thing to cut if time gets tight (see [decisions-and-risks](./decisions-and-risks.md)).

---

## 6. Cut lines

If effort runs out, cut in this order (last = cut first):

1. Phase 9 extensions
2. Phase 8 formal user study (keep the metrics table)
3. Mode 1 depth refinement and tube/ribbon rendering
4. Gesture-only UI (fall back to keyboard + mouse buttons for menus)
5. Manual alignment nudging (keep auto-alignment + warning)

Never cut: pinch drawing, closed-outline fill, visual hull, OBJ/STL export, mismatch warning.

---

## 7. Definition of done (every phase)

- [ ] All checklist items for the phase ticked in [checklist.md](./checklist.md)
- [ ] Unit tests for pure functions pass
- [ ] Manual test script for the phase run once on the real webcam (where applicable)
- [ ] No unhandled exceptions when hand disappears mid-stroke
- [ ] Short note added to a `CHANGELOG.md` (what works, known gaps)
- [ ] Code committed (initialise git in Phase 0; the folder is not a repo yet)
