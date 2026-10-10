"""Visual hull voxel reconstruction from 3-view orthographic silhouettes."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Tuple, Optional
import numpy as np
from scipy import ndimage

from formflow.align.normalize import AlignedViews

log = logging.getLogger(__name__)


@dataclass
class HullResult:
    """Reconstructed voxel grid and quality metrics."""
    voxels: np.ndarray                  # 3D bool array of shape (X, Y, Z)
    voxel_count: int
    fill_ratio: float
    reprojection_iou: Dict[str, float]  # IoU per view ("front", "top", "side")
    is_empty: bool
    status_message: str


def compute_iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    """Compute Intersection-over-Union between two boolean masks."""
    intersection = np.logical_and(mask_a, mask_b).sum()
    union = np.logical_or(mask_a, mask_b).sum()
    if union == 0:
        return 1.0 if intersection == 0 else 0.0
    return float(intersection / union)


def reconstruct_visual_hull(
    aligned: AlignedViews,
    keep_largest_component: bool = True,
    fill_holes: bool = True,
) -> HullResult:
    """Reconstruct 3D voxel volume from Front, Top, and Side aligned silhouettes.

    Grid coordinate mapping:
      +X: Width (right)
      +Y: Height (up)
      +Z: Depth (front / toward viewer)
    """
    N = aligned.grid_size
    # Convert uint8 masks to 2D bool arrays
    mf = aligned.front > 127
    mt = aligned.top > 127
    ms = aligned.side > 127

    # Map from image coordinates (row, col) to (X, Y, Z):
    # Front: col is X, row is flipped Y (top of image is +Y)
    F = np.flipud(mf).T   # shape (X, Y)

    # Top: col is X, row is Z (looking from top, bottom of canvas is +Z front)
    T = mt.T              # shape (X, Z)

    # Side: col is Z, row is flipped Y
    S = np.flipud(ms).T   # shape (Z, Y)

    # Core Visual Hull computation by 3-way broadcasting
    # F[:, :, None]   -> (X, Y, 1)
    # T[:, None, :]   -> (X, 1, Z)
    # S.T[None, :, :] -> (1, Y, Z) (since S is (Z, Y), S.T is (Y, Z))
    V = F[:, :, None] & T[:, None, :] & S.T[None, :, :]  # shape (X, Y, Z)

    voxel_count = int(np.count_nonzero(V))
    total_voxels = N * N * N
    fill_ratio = float(voxel_count / total_voxels)

    if voxel_count == 0:
        log.warning("Visual hull reconstruction resulted in 0 voxels (incompatible silhouettes).")
        return HullResult(
            voxels=V,
            voxel_count=0,
            fill_ratio=0.0,
            reprojection_iou={"front": 0.0, "top": 0.0, "side": 0.0},
            is_empty=True,
            status_message="Empty visual hull: silhouettes do not intersect consistently.",
        )

    # Cleanup: Keep largest connected component
    if keep_largest_component:
        labeled, num_features = ndimage.label(V)
        if num_features > 1:
            sizes = ndimage.sum(V, labeled, range(1, num_features + 1))
            largest_label = int(np.argmax(sizes) + 1)
            V = (labeled == largest_label)
            voxel_count = int(np.count_nonzero(V))
            fill_ratio = float(voxel_count / total_voxels)

    # Fill internal cavities if requested
    if fill_holes:
        V = ndimage.binary_fill_holes(V)
        voxel_count = int(np.count_nonzero(V))
        fill_ratio = float(voxel_count / total_voxels)

    # Compute Re-projection IoU for quality verification
    # Project V back onto each plane:
    # Front: any over Z axis (axis 2) -> (X, Y)
    proj_F = V.any(axis=2)
    iou_f = compute_iou(proj_F, F)

    # Top: any over Y axis (axis 1) -> (X, Z)
    proj_T = V.any(axis=1)
    iou_t = compute_iou(proj_T, T)

    # Side: any over X axis (axis 0) -> (Y, Z), so transpose to (Z, Y)
    proj_S = V.any(axis=0).T
    iou_s = compute_iou(proj_S, S)

    mean_iou = (iou_f + iou_t + iou_s) / 3.0
    status = f"Reconstructed {voxel_count} voxels. Mean re-projection IoU: {mean_iou:.2f}"

    return HullResult(
        voxels=V,
        voxel_count=voxel_count,
        fill_ratio=fill_ratio,
        reprojection_iou={"front": iou_f, "top": iou_t, "side": iou_s},
        is_empty=False,
        status_message=status,
    )
