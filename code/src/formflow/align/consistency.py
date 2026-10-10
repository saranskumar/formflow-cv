"""Consistency validation and mismatch warnings across Front, Top and Side views."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from formflow.cv_process.silhouette import SilhouetteInfo


@dataclass
class ViewDisagreement:
    axis: str                  # "X" (Width), "Y" (Height), or "Z" (Depth)
    views: Tuple[str, str]     # e.g. ("Front", "Top")
    extent1: float
    extent2: float
    difference_pct: float
    warning_message: str


def check_view_consistency(
    front_info: SilhouetteInfo,
    top_info: SilhouetteInfo,
    side_info: SilhouetteInfo,
    threshold_pct: float = 0.10,
) -> List[ViewDisagreement]:
    """Check shared dimension consistency across 3 views.

    Shared extents:
      - X (Width): Front extent_w vs Top extent_w
      - Y (Height): Front extent_h vs Side extent_h
      - Z (Depth): Top extent_h vs Side extent_w (or depending on canvas orientation)
    """
    disagreements: List[ViewDisagreement] = []

    if not (front_info.is_closed and top_info.is_closed and side_info.is_closed):
        return disagreements

    # 1. Width (X): Front width vs Top width
    w_front = front_info.extent_w
    w_top = top_info.extent_w
    if max(w_front, w_top) > 10:
        diff_x = abs(w_front - w_top) / max(w_front, w_top)
        if diff_x > threshold_pct:
            msg = f"Width mismatch (X): Front ({w_front:.0f}px) vs Top ({w_top:.0f}px) differs by {diff_x*100:.1f}%"
            disagreements.append(ViewDisagreement("X", ("Front", "Top"), w_front, w_top, diff_x, msg))

    # 2. Height (Y): Front height vs Side height
    h_front = front_info.extent_h
    h_side = side_info.extent_h
    if max(h_front, h_side) > 10:
        diff_y = abs(h_front - h_side) / max(h_front, h_side)
        if diff_y > threshold_pct:
            msg = f"Height mismatch (Y): Front ({h_front:.0f}px) vs Side ({h_side:.0f}px) differs by {diff_y*100:.1f}%"
            disagreements.append(ViewDisagreement("Y", ("Front", "Side"), h_front, h_side, diff_y, msg))

    # 3. Depth (Z): Top height (depth) vs Side width (depth)
    d_top = top_info.extent_h
    d_side = side_info.extent_w
    if max(d_top, d_side) > 10:
        diff_z = abs(d_top - d_side) / max(d_top, d_side)
        if diff_z > threshold_pct:
            msg = f"Depth mismatch (Z): Top ({d_top:.0f}px) vs Side ({d_side:.0f}px) differs by {diff_z*100:.1f}%"
            disagreements.append(ViewDisagreement("Z", ("Top", "Side"), d_top, d_side, diff_z, msg))

    return disagreements
