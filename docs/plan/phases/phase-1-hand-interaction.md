# Phase 1 - Hand Interaction (Shared)

**Track:** Shared | **Depends on:** Phase 0 | **Unlocks:** Phases 2 and 3 (parallel)
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

A reliable virtual pencil: webcam to stable fingertip to pinch state to independent smoothed strokes, with record/replay so later work doesn't need your hand in front of the camera.

## Tasks

### 1.1 Capture ([capture/webcam.py](../tech-spec.md))
- [ ] Threaded capture with drop-old-frame queue
- [ ] Resolution and device index from config
- [ ] Mirror (selfie) option
- [ ] Graceful "camera not found" message

### 1.2 Hand tracking (hands/tracker.py)
- [ ] MediaPipe wrapper returning 21 landmarks (normalised + pixel)
- [ ] Single hand, handedness config
- [ ] Return `None` cleanly when no hand
- [ ] Draw skeleton overlay (toggle)
- [ ] Hand size measure (wrist to middle MCP) for normalisation

### 1.3 Filtering (hands/filters.py)
- [ ] One-Euro filter on index fingertip x, y
- [ ] Optional filter on z / hand size
- [ ] Tunable parameters in config

### 1.4 Pinch and gestures (hands/pinch.py)
- [ ] Normalised thumb-index distance
- [ ] Hysteresis thresholds (`pinch_on` < `pinch_off`)
- [ ] Debounce (2-3 frames)
- [ ] Open palm detector (dwell)
- [ ] Fist detector (dwell)
- [ ] Visual feedback: cursor changes when pinched

### 1.5 Pencil state machine (pencil/state_machine.py)
- [ ] States: `NO_HAND`, `HOVER`, `DRAWING`
- [ ] Transitions emit events: `stroke_start`, `point`, `stroke_end`
- [ ] Hand lost mid-stroke: end stroke cleanly, no invented points
- [ ] Hand returns: start in `HOVER`, never auto-draw

### 1.6 Strokes (strokes/)
- [ ] `Stroke` and `StrokeStore` (add, delete, clear)
- [ ] Undo / redo stacks
- [ ] Min point spacing filter
- [ ] Moving-average smoothing (window 5)
- [ ] Outlier rejection (jump > N px between frames)
- [ ] Optional resample / spline smoothing
- [ ] Unit tests: jitter reduced, undo/redo round trip

### 1.7 Overlay UI (ui/overlay.py)
- [ ] Draw strokes over camera frame
- [ ] Cursor, status text (NO HAND / HOVER / DRAWING), FPS
- [ ] Dwell-click button component
- [ ] Hint text for first-time user

### 1.8 Record / replay tools
- [ ] `tools/record_session.py`: save landmark stream (timestamped JSON/NPZ)
- [ ] `tools/replay_session.py`: feed saved stream into the pipeline
- [ ] Record 3 reference sessions: slow circle, square, scribble with hand loss

### 1.9 Benchmarks
- [ ] Measure FPS and per-stage latency (capture, track, filter, draw)
- [ ] Compare jitter before / after filtering, save numbers for Phase 8

## Exit criteria

- [ ] Draw a recognisable circle and square in the air with smooth strokes
- [ ] >= 20 FPS end to end on your machine
- [ ] Pinch does not flicker (no spurious strokes in a 60 s idle hover test)
- [ ] Hand-loss test passes with no crash and no ghost points
- [ ] Replay reproduces a recorded drawing deterministically

## Risks touched
R1, R3, R10, R11, R13
