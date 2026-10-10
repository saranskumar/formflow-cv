"""Drawing guides, axes, grid and alignment reference overlays for multi-view canvases."""

from __future__ import annotations

from typing import Optional, Tuple
import cv2
import numpy as np

GRID_COLOR = (45, 45, 50)
AXIS_COLOR = (70, 70, 80)
CENTER_COLOR = (0, 160, 220)
SHARED_GUIDE_COLOR = (180, 120, 40)  # Subtle amber/cyan reference line
TEXT_COLOR = (160, 160, 170)


def draw_grid_and_axes(
    canvas: np.ndarray,
    grid_step: int = 64,
    show_grid: bool = True,
    axis_labels: Tuple[str, str] = ("X", "Y"),
) -> None:
    """Draw subtle background grid, center axes and dimension labels on a canvas."""
    h, w = canvas.shape[:2]
    cx, cy = w // 2, h // 2

    if show_grid:
        # Subtle grid lines
        for x in range(0, w, grid_step):
            cv2.line(canvas, (x, 0), (x, h), GRID_COLOR, 1)
        for y in range(0, h, grid_step):
            cv2.line(canvas, (0, y), (w, y), GRID_COLOR, 1)

    # Center reference crosshair
    cv2.line(canvas, (0, cy), (w, cy), AXIS_COLOR, 1)
    cv2.line(canvas, (cx, 0), (cx, h), AXIS_COLOR, 1)
    cv2.circle(canvas, (cx, cy), 3, CENTER_COLOR, -1)

    # Axis indicators
    font = cv2.FONT_HERSHEY_SIMPLEX
    h_axis, v_axis = axis_labels
    cv2.putText(canvas, f"+{h_axis} ->", (w - 70, cy - 8), font, 0.42, TEXT_COLOR, 1, cv2.LINE_AA)
    cv2.putText(canvas, f"+{v_axis} ^", (cx + 8, 25), font, 0.42, TEXT_COLOR, 1, cv2.LINE_AA)


def draw_shared_dimension_guides(
    canvas: np.ndarray,
    h_range: Optional[Tuple[float, float]] = None,
    v_range: Optional[Tuple[float, float]] = None,
) -> None:
    """Draw faint guide lines projecting extents from companion views.

    h_range: (min_x, max_x) to draw vertical guide lines
    v_range: (min_y, max_y) to draw horizontal guide lines
    """
    h, w = canvas.shape[:2]

    if h_range is not None:
        x1, x2 = int(h_range[0]), int(h_range[1])
        if 0 <= x1 < w:
            cv2.line(canvas, (x1, 0), (x1, h), SHARED_GUIDE_COLOR, 1, cv2.LINE_AA)
        if 0 <= x2 < w:
            cv2.line(canvas, (x2, 0), (x2, h), SHARED_GUIDE_COLOR, 1, cv2.LINE_AA)

    if v_range is not None:
        y1, y2 = int(v_range[0]), int(v_range[1])
        if 0 <= y1 < h:
            cv2.line(canvas, (0, y1), (w, y1), SHARED_GUIDE_COLOR, 1, cv2.LINE_AA)
        if 0 <= y2 < h:
            cv2.line(canvas, (0, y2), (w, y2), SHARED_GUIDE_COLOR, 1, cv2.LINE_AA)


def snap_to_close_stroke(
    points: list[Tuple[float, float]],
    snap_distance_px: float = 25.0,
) -> list[Tuple[float, float]]:
    """If the end of a stroke is near its start point, snap the end point to start to close it."""
    if len(points) < 4:
        return points
    start = points[0]
    end = points[-1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dist = (dx * dx + dy * dy) ** 0.5
    if dist <= snap_distance_px:
        # Snap closing point
        return points[:-1] + [start]
    return points
