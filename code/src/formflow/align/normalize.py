"""Normalization, auto-centering and scaling of 3-view silhouettes onto a common grid."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List, Tuple, Optional
import cv2
import numpy as np

from formflow.align.consistency import ViewDisagreement, check_view_consistency
from formflow.cv_process.silhouette import SilhouetteInfo

log = logging.getLogger(__name__)


@dataclass
class AlignedViews:
    """Normalized, auto-centered and scaled binary masks ready for visual hull reconstruction."""
    front: np.ndarray             # Shape (N, N) bool or uint8
    top: np.ndarray               # Shape (N, N) bool or uint8
    side: np.ndarray              # Shape (N, N) bool or uint8
    grid_size: int
    disagreements: List[ViewDisagreement]
    extents: Tuple[float, float, float]  # (extent_x, extent_y, extent_z)


def _crop_and_center_mask(
    mask: np.ndarray,
    bbox: Tuple[int, int, int, int],
    target_size: int,
    target_w: int,
    target_h: int,
) -> np.ndarray:
    """Crop mask to its bbox, resize to (target_w, target_h), and place at center of (target_size, target_size)."""
    x, y, w, h = bbox
    out = np.zeros((target_size, target_size), dtype=np.uint8)
    if w <= 0 or h <= 0:
        return out

    cropped = mask[y:y + h, x:x + w]
    if target_w <= 0 or target_h <= 0:
        return out

    resized = cv2.resize(cropped, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

    # Center placement
    start_x = (target_size - target_w) // 2
    start_y = (target_size - target_h) // 2
    out[start_y:start_y + target_h, start_x:start_x + target_w] = (resized > 127).astype(np.uint8) * 255
    return out


def normalize_and_align_views(
    front_info: SilhouetteInfo,
    top_info: SilhouetteInfo,
    side_info: SilhouetteInfo,
    grid_size: int = 96,
    margin_ratio: float = 0.12,
    auto_scale_reference: bool = True,
    threshold_pct: float = 0.10,
) -> AlignedViews:
    """Normalize, scale and align 3 view silhouettes onto an (N, N) grid.

    Coordinates on grid:
      - Front: width along X, height along Y
      - Top:   width along X, height along Z
      - Side:  width along Z, height along Y
    """
    disagreements = check_view_consistency(
        front_info, top_info, side_info, threshold_pct=threshold_pct
    )

    usable_dim = int(grid_size * (1.0 - 2.0 * margin_ratio))
    usable_dim = max(10, usable_dim)

    # Raw extents
    raw_w_front = max(1.0, front_info.extent_w)
    raw_h_front = max(1.0, front_info.extent_h)
    raw_w_top = max(1.0, top_info.extent_w)
    raw_d_top = max(1.0, top_info.extent_h)   # Top's height is Depth Z
    raw_d_side = max(1.0, side_info.extent_w) # Side's width is Depth Z
    raw_h_side = max(1.0, side_info.extent_h)

    # Determine unified bounding box dimensions (X, Y, Z)
    if auto_scale_reference and front_info.is_closed:
        dim_x = raw_w_front
        dim_y = raw_h_front
        dim_z = (raw_d_top + raw_d_side) / 2.0
    else:
        dim_x = (raw_w_front + raw_w_top) / 2.0
        dim_y = (raw_h_front + raw_h_side) / 2.0
        dim_z = (raw_d_top + raw_d_side) / 2.0

    max_dim = max(dim_x, dim_y, dim_z, 1.0)
    scale = usable_dim / max_dim

    target_x = max(4, int(round(dim_x * scale)))
    target_y = max(4, int(round(dim_y * scale)))
    target_z = max(4, int(round(dim_z * scale)))

    # Process Front mask (X x Y)
    norm_front = _crop_and_center_mask(
        front_info.mask, front_info.bbox, grid_size, target_x, target_y
    )

    # Process Top mask (X x Z)
    norm_top = _crop_and_center_mask(
        top_info.mask, top_info.bbox, grid_size, target_x, target_z
    )

    # Process Side mask (Z x Y)
    norm_side = _crop_and_center_mask(
        side_info.mask, side_info.bbox, grid_size, target_z, target_y
    )

    return AlignedViews(
        front=norm_front,
        top=norm_top,
        side=norm_side,
        grid_size=grid_size,
        disagreements=disagreements,
        extents=(dim_x, dim_y, dim_z),
    )
