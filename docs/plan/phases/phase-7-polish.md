# Phase 7 - Quality & Robustness (Polish track, no deadline)

**Depends on:** MVP | **Back to:** [Roadmap](../00-roadmap.md)

Work in whatever order hurts the most when you demo.

## 7.1 Tracking robustness
- [ ] Adaptive pinch threshold per user (short calibration)
- [ ] Better lost-hand handling (grace period of a few frames before ending stroke)
- [ ] Lighting warning if landmark confidence is low
- [ ] Left-handed mode and handedness auto-detect
- [ ] Optional second hand for UI actions (pinch with the left hand = undo)
- [ ] Palm-reject: ignore pinch when hand is far from drawing area
- [ ] Re-tune One-Euro parameters with recorded sessions

## 7.2 Drawing quality
- [ ] Velocity-aware smoothing (fast = less smoothing, slow = more)
- [ ] Stroke beautification: optional straighten / circle / corner snap (non-forced)
- [ ] Symmetry assist (mirror about centre line)
- [ ] Eraser gesture
- [ ] Smart close: extend end to start if within N px
- [ ] Stroke thickness reflects speed (visual only)

## 7.3 CV and reconstruction quality
- [ ] Multiple-contour selection UI (click a contour to include / exclude)
- [ ] Hole support toggle per view
- [ ] Adaptive morphology kernel by sketch size
- [ ] Sub-voxel surface smoothing
- [ ] Mesh decimation option for smaller files
- [ ] Higher resolution final pass (e.g. 192^3) with preview at 64^3
- [ ] Optional carving using a user-drawn cross-section (adds concavity info)

## 7.4 Mode 1 quality
- [ ] Tube / ribbon rendering of strokes
- [ ] Auto-depth blending (plane + hand scale)
- [ ] Stroke selection, move, delete
- [ ] Symmetry copy in 3D
- [ ] Gesture rotate of the view

## 7.5 UX
- [ ] First-run tutorial (3 steps: hover, pinch, undo)
- [ ] Contextual hints instead of a manual
- [ ] Consistent theme, readable fonts, large targets (for dwell)
- [ ] Sounds or subtle feedback on pinch on/off (optional)
- [ ] Settings screen: thresholds, camera, handedness, units
- [ ] Window layout memory

## 7.6 Performance and stability
- [ ] Profile and remove per-frame allocations
- [ ] Incremental Open3D updates only
- [ ] 30 FPS target
- [ ] 30-minute soak test, no memory growth
- [ ] Packaging: PyInstaller build (optional) or a one-command run script
- [ ] Logging and crash reports

## Exit criteria
- [ ] 10 consecutive demo runs without a crash
- [ ] A first-time user finishes a Mode 2 reconstruction with only on-screen hints
