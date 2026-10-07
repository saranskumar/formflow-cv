# Phase 9 - Optional Extensions

**Depends on:** MVP | **Back to:** [Roadmap](../00-roadmap.md)

Not required. Pick by interest. Each is independent.

| ID | Extension | Value | Effort | Notes |
| -- | --------- | ----- | ------ | ----- |
| X1 | Point cloud export (PLY/XYZ) | Low | Low | Voxel centres or mesh samples |
| X2 | Mode 1 stroke tube mesh to STL | Medium | Low | Makes Mode 1 printable |
| X3 | OpenSCAD export for simple shapes | Medium | Medium | Only for extrudable or primitive-like silhouettes |
| X4 | Add a 4th/5th view (back, section, isometric) | Medium | Medium | More carving = better hull. Needs non-orthogonal projection for isometric |
| X5 | Cross-section carving (draw a slice to cut concavities) | High | Medium | Directly addresses visual-hull limits |
| X6 | AR placement (ArUco marker + overlay) | High (wow) | High | `cv2.aruco` pose, render mesh over webcam |
| X7 | Voice commands | Low | Medium | Optional |
| X8 | Photo / scan input for views (trace a real object) | Medium | Medium | Reuse CV pipeline on photos |
| X9 | Parametric dimensions (type "width = 50 mm") | Medium | Medium | Sets real-world scale |
| X10 | Texture / colour by region | Low | Medium | Cosmetic |
| X11 | Multi-hand editing (two-hand scale/rotate) | Medium | Medium | |
| X12 | Web viewer export (glTF + three.js page) | Medium | Medium | Share without Open3D |

## Recommended order if you do any

1. **X5 cross-section carving** (best value, addresses the main limitation)
2. **X6 AR placement** (best demo impact)
3. X2 tube export, X9 dimensions

## Checklist template per extension
- [ ] Design note (1 paragraph)
- [ ] Implementation behind a feature flag
- [ ] Tests or demo script
- [ ] Documented in CHANGELOG and README
