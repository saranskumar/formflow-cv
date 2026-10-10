"""Stroke data model and store (undo/redo, smoothing, outlier rejection)."""

from __future__ import annotations

import time
import logging
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)


@dataclass
class Stroke:
    id: int
    points: list[tuple[float, float]] = field(default_factory=list)
    z: Optional[list[float]] = None   # Mode 1 only
    color: tuple[int, int, int] = (0, 200, 255)
    created_at: float = field(default_factory=time.time)

    def is_empty(self) -> bool:
        return len(self.points) < 2


def _moving_average(points: list[tuple[float, float]], window: int) -> list[tuple[float, float]]:
    if len(points) < window:
        return points
    pts = np.array(points, dtype=np.float32)
    out = []
    half = window // 2
    for i in range(len(pts)):
        lo = max(0, i - half)
        hi = min(len(pts), i + half + 1)
        out.append(tuple(pts[lo:hi].mean(axis=0)))
    return out


def _moving_average_1d(vals: list[float], window: int) -> list[float]:
    if len(vals) < window:
        return vals
    arr = np.array(vals, dtype=np.float32)
    out = []
    half = window // 2
    for i in range(len(arr)):
        lo = max(0, i - half)
        hi = min(len(arr), i + half + 1)
        out.append(float(arr[lo:hi].mean()))
    return out


def smooth_stroke(stroke: Stroke, window: int = 5) -> Stroke:
    """Return a new Stroke with smoothed points (in-place modification discouraged)."""
    if len(stroke.points) < 3:
        return stroke
    smoothed_pts = _moving_average(stroke.points, window)
    smoothed_z = None
    if stroke.z is not None and len(stroke.z) == len(stroke.points):
        smoothed_z = _moving_average_1d(stroke.z, window)
    return Stroke(
        id=stroke.id,
        points=smoothed_pts,
        z=smoothed_z,
        color=stroke.color,
        created_at=stroke.created_at,
    )


class StrokeStore:
    """Manage strokes for one canvas/workspace with undo/redo."""

    def __init__(self, cfg=None, smoothing_window: int = 5, min_spacing_px: float = 2.0,
                 outlier_jump_px: float = 80.0) -> None:
        self._window = smoothing_window
        self._min_spacing = min_spacing_px
        self._outlier_jump = outlier_jump_px

        self._strokes: list[Stroke] = []
        self._undo_stack: list[list[Stroke]] = []
        self._redo_stack: list[list[Stroke]] = []
        self._next_id = 0

        # Current in-progress stroke
        self._active: Optional[Stroke] = None
        self._last_point: Optional[tuple[float, ...]] = None

    # ------------------------------------------------------------------  stroke recording
    def start_stroke(self, pos: Optional[tuple[float, ...]] = None) -> None:
        self._save_undo()
        self._redo_stack.clear()
        self._active = Stroke(id=self._next_id)
        self._next_id += 1
        self._last_point = None
        if pos is not None:
            self._add_point(pos)

    def add_point(self, pos: tuple[float, ...]) -> None:
        if self._active is None:
            return
        self._add_point(pos)

    def end_stroke(self) -> None:
        if self._active is None:
            return
        if not self._active.is_empty():
            smoothed = smooth_stroke(self._active, self._window)
            self._strokes.append(smoothed)
            log.debug("Stroke %d ended with %d points.", smoothed.id, len(smoothed.points))
        else:
            log.debug("Stroke discarded (too short).")
        self._active = None
        self._last_point = None

    def _add_point(self, pos: tuple[float, ...]) -> None:
        if self._last_point is not None:
            dx = pos[0] - self._last_point[0]
            dy = pos[1] - self._last_point[1]
            dz = (pos[2] - self._last_point[2]) if len(pos) >= 3 and len(self._last_point) >= 3 else 0.0
            dist = (dx * dx + dy * dy + dz * dz) ** 0.5
            if dist < self._min_spacing:
                return
            if dist > self._outlier_jump:
                log.debug("Outlier rejected: jump=%.1f", dist)
                return
        if len(pos) >= 3:
            self._active.points.append((pos[0], pos[1]))
            if self._active.z is None:
                self._active.z = []
            self._active.z.append(pos[2])
        else:
            self._active.points.append((pos[0], pos[1]))
        self._last_point = pos

    # ------------------------------------------------------------------  queries
    @property
    def strokes(self) -> list[Stroke]:
        return self._strokes

    @property
    def active_stroke(self) -> Optional[Stroke]:
        return self._active

    def all_strokes(self) -> list[Stroke]:
        """All committed strokes plus the active one (if any)."""
        result = list(self._strokes)
        if self._active and not self._active.is_empty():
            result.append(self._active)
        return result

    # ------------------------------------------------------------------  editing
    def undo(self) -> None:
        if not self._undo_stack:
            return
        self._redo_stack.append(list(self._strokes))
        self._strokes = self._undo_stack.pop()
        log.debug("Undo: %d strokes remaining.", len(self._strokes))

    def redo(self) -> None:
        if not self._redo_stack:
            return
        self._undo_stack.append(list(self._strokes))
        self._strokes = self._redo_stack.pop()
        log.debug("Redo: %d strokes.", len(self._strokes))

    def delete_last(self) -> None:
        if not self._strokes:
            return
        self._save_undo()
        self._redo_stack.clear()
        self._strokes.pop()

    def clear(self) -> None:
        if not self._strokes:
            return
        self._save_undo()
        self._redo_stack.clear()
        self._strokes.clear()

    def _save_undo(self) -> None:
        self._undo_stack.append(list(self._strokes))
        if len(self._undo_stack) > 50:
            self._undo_stack.pop(0)
