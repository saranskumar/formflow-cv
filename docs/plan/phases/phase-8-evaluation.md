# Phase 8 - Evaluation & User Testing

**Depends on:** MVP (better after Phase 7) | **Back to:** [Roadmap](../00-roadmap.md)

Implements [PRD section 15](../prd.md) and [pipeline section 10](../pipeline.md).

## 8.1 Instrumentation
- [ ] Per-stage timing logger (capture, tracking, filter, draw, CV, reconstruct)
- [ ] Counters: undo count, strokes per view, reconstructions per session
- [ ] Session timer (start to first export)
- [ ] CSV output per session

## 8.2 Technical metrics

| Metric | How to measure | Target |
| ------ | -------------- | ------ |
| Tracking FPS / latency | `tools/bench.py` | >= 20 FPS, < 100 ms |
| Stroke jitter | RMS deviation from smoothed path, before vs after | >= 50 % reduction |
| Contour cleanliness | Noise area, holes count | near 0 on clean input |
| View alignment error | Shared-extent difference | median < 10 % |
| Silhouette overlap | IoU of hull re-projections vs inputs | > 0.95 |
| Reconstruction accuracy | IoU against ground-truth voxel volume for known shapes | report per shape |
| Reconstruction time | Seconds at 64/128/192 | < 2 s at 128 |
| Mesh integrity | Watertight, manifold, triangle count | pass |

- [ ] Ground-truth shapes: cube, cylinder, cone, L-bracket, sphere, T-shape
- [ ] Generate their ideal three views programmatically, reconstruct, measure
- [ ] Repeat with **noise injected** (jitter, offset, scale error) to build a robustness curve
- [ ] Plot results (accuracy vs noise level)

## 8.3 User study (small)
- [ ] 3-5 participants, ~15 min each
- [ ] Tasks: (1) draw a circle with the pencil, (2) make a simple object in Mode 2, (3) make a free sketch in Mode 1
- [ ] Record: time to first prototype, corrections, failures, observations
- [ ] Short questionnaire: ease of gesture learning (1-5), satisfaction with 3D output (1-5), would use again
- [ ] Consent and anonymity note
- [ ] Summary table plus 3 insights and what you changed because of them

## 8.4 Comparison baselines (optional but persuasive)
- [ ] Mouse drawing vs hand drawing: time and accuracy
- [ ] Time to model the same object in a CAD tool (rough)

## 8.5 Deliverables
- [ ] Results section for the report
- [ ] Figures: pipeline stage images, before/after smoothing, reconstructions
- [ ] Demo video (2-3 min)
- [ ] Limitations section aligned with PRD section 12
