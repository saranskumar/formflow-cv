# FormFlow - Decisions & Risks

**Related:** [Roadmap](./00-roadmap.md) | [Tech spec](./tech-spec.md)

---

## 1. Decisions made

| # | Decision | Source | Reversible? |
| - | -------- | ------ | ----------- |
| D1 | Ship MVP ASAP, polish afterwards with no deadline | You | Yes |
| D2 | Mode 1 and Mode 2 developed in parallel after shared foundation | You | Yes, but see R6 |
| D3 | UI = OpenCV window + separate Open3D window | You | Costly after Phase 3 |
| D4 | Mode 2 drawing = outline, auto-filled | You | Yes (add brush mode later) |
| D5 | Python 3.11, Windows 11, single hand | Default | Yes |
| D6 | Mode 1 depth = hand-scale cue + keyboard depth override (see R2) | Default | Yes |
| D7 | Voxel hull via numpy broadcasting; marching cubes via scikit-image | Default | Yes |
| D8 | Keyboard fallback for every gesture | Default | No, keep it |
| D9 | Record/replay of landmark streams built in Phase 1 | Default | No, keep it |

D5-D9 were my defaults, not your decisions. Overturn any of them.

---

## 2. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
| -- | ---- | ---------- | ------ | ---------- |
| R1 | **Drawing in air is imprecise and tiring**; shaky outlines, hard to close a shape | High | High | One-Euro filter; smoothing; gap-closing in CV stage; snap-to-close (end point within N px of start auto-closes); "hover cursor" so you see where the pencil is before pinching; short sessions; fallback input (mouse drawing into same canvas) so the CV/geometry work never depends on gesture quality |
| R2 | **Monocular depth is unreliable** (MediaPipe z is relative, noisy) for Mode 1 | High | Medium | Treat as relative by design. Options ranked: (a) hand-scale cue from wrist-to-MCP pixel size, filtered; (b) MediaPipe landmark z; (c) keyboard/gesture depth slider with strokes on a plane. Ship (c) first as the reliable baseline, add (a)/(b) as "auto depth" toggle. Be honest about this in the demo |
| R3 | **Pinch triggers on its own or drops mid-stroke** (jitter near threshold) | High | High | Hysteresis (on < off thresholds), min-duration debounce (2-3 frames), normalise by hand size, lose-hand = end stroke cleanly |
| R4 | **Axis / mirror mistakes** in the three views produce flipped or wrong solids | High | High | Fix conventions in [tech-spec section 3](./tech-spec.md); asymmetric "L" test; on-screen axis gizmo in viewer and canvases |
| R5 | **Open3D + OpenCV event loops conflict** or Open3D window freezes on Windows | Medium | Medium | Single main thread, non-blocking Open3D, tested in Phase 0 spike. Fallback: render mesh with matplotlib / or spawn viewer as subprocess |
| R6 | **Parallel tracks dilute focus**, neither finishes | Medium | High | Shared foundation first; fixed order in the parallel plan; Mode 1 is first to cut |
| R7 | **Open outlines** (user does not close the shape) produce empty or full masks | High | High | Closure check, auto-close threshold, clear red "outline not closed" message with gap location highlighted |
| R8 | **Inconsistent views** (width in Front != width in Top) | High | Medium | Auto-normalise to bounding-box extents, warn above threshold, allow nudge/scale; PRD already prefers warning over silent failure |
| R9 | **Version conflicts** between mediapipe, open3d, numpy | Medium | Medium | Phase 0 environment spike; pin all versions; record `pip freeze` |
| R10 | **Lighting / background** hurts tracking during demo | Medium | High | Demo checklist (plain background, front light); record/replay a known-good session as backup; keyboard mode |
| R11 | **Webcam latency and low FPS** | Medium | Medium | Capture thread with drop-old policy; downscale for tracking; profile with `tools/bench.py` |
| R12 | Visual hull of 3 views is **over-filled** (cannot represent holes / concavities) | Certain | Low (known) | Document limitation (PRD does). Optional: allow interior holes in a silhouette via nested contours (RETR_CCOMP) |
| R13 | MediaPipe API change (legacy `solutions` vs newer Tasks `HandLandmarker`) | Medium | Medium | Wrap in `hands/tracker.py` so only one file changes; pick whichever API your pinned version supports |

---

## 3. Open questions (cheap to answer later)

| # | Question | Needed by |
| - | -------- | --------- |
| Q1 | Will you demo live (webcam) or from recorded replay? | Phase 6 |
| Q2 | Right- or left-handed pencil hand? (Config option; default right, mirror image) | Phase 1 |
| Q3 | Should the webcam image be mirrored (selfie view)? Recommended: yes | Phase 1 |
| Q4 | Course deliverables: report, slides, demo video, code? Docs may need a final report section | Phase 8 |
| Q5 | Is an unknown hardware limit (no GPU) a constraint? Plan assumes CPU only | Phase 0 |
| Q6 | Should Mode 2 also allow mouse drawing as an official feature, not just a dev fallback? Recommended: yes | Phase 3 |
