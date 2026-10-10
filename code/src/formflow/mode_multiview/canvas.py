"""ViewCanvas representation for Front, Top and Side orthographic drawing surfaces."""

from __future__ import annotations

import logging
from typing import Optional, Tuple, List
import cv2
import numpy as np

from formflow.mode_multiview.guides import (
    draw_grid_and_axes,
    draw_shared_dimension_guides,
    snap_to_close_stroke,
)
from formflow.strokes.store import StrokeStore

log = logging.getLogger(__name__)


class ViewCanvas:
    """An orthographic 2D drawing canvas representing one view (Front, Top or Side)."""

    def __init__(
        self,
        name: str,
        axis_labels: Tuple[str, str],
        size: int = 512,
        brush_thickness: int = 3,
        smoothing_window: int = 5,
        min_spacing_px: float = 2.0,
        outlier_jump_px: float = 80.0,
        snap_distance_px: float = 25.0,
    ) -> None:
        self.name = name.lower()
        self.axis_labels = axis_labels
        self.size = size
        self.brush_thickness = brush_thickness
        self.snap_distance_px = snap_distance_px

        self.store = StrokeStore(
            smoothing_window=smoothing_window,
            min_spacing_px=min_spacing_px,
            outlier_jump_px=outlier_jump_px,
        )

    def start_stroke(self, pos: Tuple[float, float]) -> None:
        clamped_pos = (
            float(np.clip(pos[0], 0, self.size - 1)),
            float(np.clip(pos[1], 0, self.size - 1)),
        )
        self.store.start_stroke(clamped_pos)

    def add_point(self, pos: Tuple[float, float]) -> None:
        clamped_pos = (
            float(np.clip(pos[0], 0, self.size - 1)),
            float(np.clip(pos[1], 0, self.size - 1)),
        )
        self.store.add_point(clamped_pos)

    def end_stroke(self) -> None:
        if self.store.active_stroke and not self.store.active_stroke.is_empty():
            # Check snap to close
            snapped = snap_to_close_stroke(
                self.store.active_stroke.points,
                snap_distance_px=self.snap_distance_px,
            )
            self.store.active_stroke.points = snapped
        self.store.end_stroke()

    def is_empty(self) -> bool:
        return len(self.store.strokes) == 0 and (
            self.store.active_stroke is None or self.store.active_stroke.is_empty()
        )

    def get_extents(self) -> Optional[Tuple[float, float, float, float]]:
        """Return (min_x, max_x, min_y, max_y) bounding box of all strokes, or None if empty."""
        all_strokes = self.store.all_strokes()
        if not all_strokes:
            return None

        all_points: list[Tuple[float, float]] = []
        for s in all_strokes:
            all_points.extend(s.points)

        if not all_points:
            return None

        pts = np.array(all_points, dtype=np.float32)
        min_x, min_y = pts.min(axis=0)
        max_x, max_y = pts.max(axis=0)
        return (float(min_x), float(max_x), float(min_y), float(max_y))

    def rasterize(self, thickness: Optional[int] = None) -> np.ndarray:
        """Rasterize all committed strokes to a single-channel binary image (uint8: 0 or 255)."""
        mask = np.zeros((self.size, self.size), dtype=np.uint8)
        th = thickness or self.brush_thickness

        for stroke in self.store.strokes:
            if stroke.is_empty():
                continue
            pts = np.array(stroke.points, dtype=np.int32).reshape((-1, 1, 2))
            cv2.polylines(mask, [pts], isClosed=False, color=255, thickness=th, lineType=cv2.LINE_AA)

        return mask

    def render_display(
        self,
        show_grid: bool = True,
        h_guide_range: Optional[Tuple[float, float]] = None,
        v_guide_range: Optional[Tuple[float, float]] = None,
        fill_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Render beautiful visual canvas with grid, guides, filled mask (optional), and strokes."""
        # Dark canvas background
        canvas = np.full((self.size, self.size, 3), (22, 22, 28), dtype=np.uint8)

        # Grid and axes
        draw_grid_and_axes(canvas, grid_step=64, show_grid=show_grid, axis_labels=self.axis_labels)

        # Companion guides
        draw_shared_dimension_guides(canvas, h_range=h_guide_range, v_range=v_guide_range)

        # Optional fill overlay (semi-transparent teal/blue)
        if fill_mask is not None:
            overlay = canvas.copy()
            overlay[fill_mask > 0] = [120, 80, 20]  # Soft azure fill
            cv2.addWeighted(overlay, 0.45, canvas, 0.55, 0, canvas)

        # Draw committed strokes
        for stroke in self.store.strokes:
            if stroke.is_empty():
                continue
            pts = np.array(stroke.points, dtype=np.int32).reshape((-1, 1, 2))
            cv2.polylines(canvas, [pts], isClosed=False, color=(0, 220, 255), thickness=self.brush_thickness, lineType=cv2.LINE_AA)

        # Draw active stroke in progress (bright white/yellow)
        if self.store.active_stroke and not self.store.active_stroke.is_empty():
            pts = np.array(self.store.active_stroke.points, dtype=np.int32).reshape((-1, 1, 2))
            cv2.polylines(canvas, [pts], isClosed=False, color=(100, 255, 255), thickness=self.brush_thickness, lineType=cv2.LINE_AA)

        return canvas
