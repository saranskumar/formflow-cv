"""Silhouette extraction, gap closing, contour fill and geometry analysis."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Tuple, List
import cv2
import numpy as np

log = logging.getLogger(__name__)


@dataclass
class SilhouetteInfo:
    """Extracted silhouette metrics and mask."""
    is_closed: bool
    mask: np.ndarray                      # Binary 2D uint8 mask (0 or 255)
    bbox: Tuple[int, int, int, int]       # (x, y, w, h)
    area: float
    centroid: Tuple[float, float]         # (cx, cy)
    extent_w: float                       # Width of bounding box
    extent_h: float                       # Height of bounding box
    solidity: float                       # Area / Convex hull area
    gap_point: Optional[Tuple[int, int]] = None  # Estimated open gap location if not closed


def clean_specks(binary_img: np.ndarray, min_area: int = 15) -> np.ndarray:
    """Remove small specks using connected components."""
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(binary_img, connectivity=8)
    out = np.zeros_like(binary_img)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            out[labels == i] = 255
    return out


def find_open_endpoints(binary_img: np.ndarray) -> List[Tuple[int, int]]:
    """Estimate endpoints of open lines via hit-or-miss or neighbor counting."""
    if hasattr(cv2, "ximgproc"):
        skeleton = cv2.ximgproc.thinning(binary_img)
    else:
        # opencv-python lacks ximgproc; fall back to scikit-image
        from skimage.morphology import skeletonize
        skeleton = skeletonize(binary_img > 0).astype(np.uint8) * 255
    # Simple endpoint detection: 8-neighbor count == 1
    kernel = np.array([[1, 1, 1], [1, 10, 1], [1, 1, 1]], dtype=np.uint8)
    filtered = cv2.filter2D((skeleton > 0).astype(np.uint8), -1, kernel)
    # Point is on line (>=10) and has exactly 1 neighbor (total == 11)
    endpoints = np.argwhere(filtered == 11)
    return [(int(pt[1]), int(pt[0])) for pt in endpoints]


def process_silhouette(
    stroke_raster: np.ndarray,
    base_kernel_size: int = 7,
    max_gap_kernel: int = 21,
    min_area_px: int = 200,
    allow_holes: bool = False,
) -> SilhouetteInfo:
    """Convert stroke raster into a clean solid silhouette mask.

    Performs adaptive gap-closing, contour hierarchy extraction,
    and returns comprehensive geometric metrics.
    """
    h, w = stroke_raster.shape[:2]
    empty_mask = np.zeros((h, w), dtype=np.uint8)

    # Check for empty input
    if cv2.countNonZero(stroke_raster) == 0:
        return SilhouetteInfo(
            is_closed=False,
            mask=empty_mask,
            bbox=(0, 0, 0, 0),
            area=0.0,
            centroid=(w / 2.0, h / 2.0),
            extent_w=0.0,
            extent_h=0.0,
            solidity=0.0,
        )

    # 1. Clean small specks
    cleaned = clean_specks(stroke_raster, min_area=12)

    # 2. Adaptive gap closing escalation
    best_mask = empty_mask
    best_contour = None
    is_closed = False
    gap_pt: Optional[Tuple[int, int]] = None

    kernels_to_try = [base_kernel_size]
    if base_kernel_size < 13:
        kernels_to_try.append(13)
    if max_gap_kernel > 13:
        kernels_to_try.append(max_gap_kernel)

    for ksize in kernels_to_try:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
        closed_img = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)

        # Flood fill test from canvas outer boundary
        # Pad with 1 pixel border of zeros so flood fill reaches everywhere outside
        padded = np.pad(closed_img, pad_width=2, mode="constant", constant_values=0)
        flood_mask = np.zeros((h + 6, w + 6), dtype=np.uint8)
        cv2.floodFill(padded, flood_mask, (0, 0), 128)
        unpadded = padded[2:-2, 2:-2]

        # Pixels that remained 0 (not flooded with 128 and not stroke) are inside the closed boundary!
        interior_mask = (unpadded == 0).astype(np.uint8) * 255
        interior_area = int(cv2.countNonZero(interior_mask))

        if interior_area >= min_area_px:
            # Filled silhouette = interior + original outline
            filled = np.zeros((h, w), dtype=np.uint8)
            filled[unpadded != 128] = 255

            # Find contours on filled image
            contours, hierarchy = cv2.findContours(
                filled,
                cv2.RETR_CCOMP if allow_holes else cv2.RETR_EXTERNAL,
                cv2.CHAIN_APPROX_SIMPLE,
            )

            if contours:
                largest = max(contours, key=cv2.contourArea)
                if cv2.contourArea(largest) >= min_area_px:
                    best_contour = largest
                    # Draw clean solid mask
                    solid = np.zeros((h, w), dtype=np.uint8)
                    cv2.drawContours(solid, [largest], -1, 255, -1)

                    if allow_holes and hierarchy is not None and len(hierarchy[0]) > 1:
                        # Subtract inner holes
                        for i, h_info in enumerate(hierarchy[0]):
                            if h_info[3] >= 0:  # has parent
                                cv2.drawContours(solid, [contours[i]], -1, 0, -1)

                    best_mask = solid
                    is_closed = True
                    break

    # If outline was not successfully closed, estimate endpoints / gap location
    if not is_closed:
        # Estimate endpoints
        endpoints = find_open_endpoints(cleaned)
        if endpoints:
            gap_pt = endpoints[0]

        # We can still provide convex hull or stroked region as fallback mask
        nonzeros = cv2.findNonZero(cleaned)
        if nonzeros is not None:
            x, y, bw, bh = cv2.boundingRect(nonzeros)
            return SilhouetteInfo(
                is_closed=False,
                mask=empty_mask,
                bbox=(x, y, bw, bh),
                area=0.0,
                centroid=(x + bw / 2.0, y + bh / 2.0),
                extent_w=float(bw),
                extent_h=float(bh),
                solidity=0.0,
                gap_point=gap_pt,
            )
        return SilhouetteInfo(
            is_closed=False,
            mask=empty_mask,
            bbox=(0, 0, 0, 0),
            area=0.0,
            centroid=(w / 2.0, h / 2.0),
            extent_w=0.0,
            extent_h=0.0,
            solidity=0.0,
        )

    # 3. Geometric metrics for the closed mask
    x, y, bw, bh = cv2.boundingRect(best_contour)
    area = float(cv2.contourArea(best_contour))
    m = cv2.moments(best_contour)
    if m["m00"] > 0:
        cx = float(m["m10"] / m["m00"])
        cy = float(m["m01"] / m["m00"])
    else:
        cx, cy = float(x + bw / 2.0), float(y + bh / 2.0)

    hull = cv2.convexHull(best_contour)
    hull_area = float(cv2.contourArea(hull))
    solidity = (area / hull_area) if hull_area > 0 else 1.0

    return SilhouetteInfo(
        is_closed=True,
        mask=best_mask,
        bbox=(x, y, bw, bh),
        area=area,
        centroid=(cx, cy),
        extent_w=float(bw),
        extent_h=float(bh),
        solidity=float(solidity),
        gap_point=None,
    )
