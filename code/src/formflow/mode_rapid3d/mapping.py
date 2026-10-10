"""Coordinate mapping and depth estimation for Mode 1 (Rapid 3D).

Maps 2D camera coordinates (u, v) and depth cues into a 3D workspace box [-1, 1]^3.
Right-handed coordinate system:
  +X: right
  +Y: up (flipped from image v)
  +Z: depth (toward camera / viewer)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional, Tuple
import numpy as np


class DepthSource(ABC):
    """Abstract interface for depth estimation strategies."""

    @abstractmethod
    def get_depth(self, landmarks=None) -> float:
        """Return depth in [-1.0, 1.0]."""
        raise NotImplementedError


class PlaneDepth(DepthSource):
    """Draw on a fixed-depth plane. Depth adjusted via keys or slider."""

    def __init__(self, initial_depth: float = 0.0, step: float = 0.05) -> None:
        self.depth = float(np.clip(initial_depth, -1.0, 1.0))
        self.step = step

    def adjust(self, delta: float) -> float:
        self.depth = float(np.clip(self.depth + delta, -1.0, 1.0))
        return self.depth

    def set_depth(self, value: float) -> None:
        self.depth = float(np.clip(value, -1.0, 1.0))

    def get_depth(self, landmarks=None) -> float:
        return self.depth


class HandScaleDepth(DepthSource):
    """Estimate depth from hand size (distance between wrist and middle MCP).

    Hand closer to camera -> larger pixel size -> closer to viewer (+Z).
    """

    def __init__(self, min_size_px: float = 60.0, max_size_px: float = 240.0) -> None:
        self.min_size = min_size_px
        self.max_size = max_size_px
        self._current_depth = 0.0

    def get_depth(self, landmarks=None) -> float:
        if landmarks is None or not hasattr(landmarks, "hand_size_px"):
            return self._current_depth
        size = getattr(landmarks, "hand_size_px", 0.0)
        if size <= 0:
            return self._current_depth
        # Normalized ratio [0, 1]
        norm = (size - self.min_size) / max(1e-5, (self.max_size - self.min_size))
        norm = np.clip(norm, 0.0, 1.0)
        # Map [0, 1] to [-1.0, 1.0]
        self._current_depth = float(norm * 2.0 - 1.0)
        return self._current_depth


class LandmarkZDepth(DepthSource):
    """Use relative MediaPipe z coordinate for depth."""

    def __init__(self, scale: float = 4.0) -> None:
        self.scale = scale
        self._current_depth = 0.0

    def get_depth(self, landmarks=None) -> float:
        if landmarks is None or not hasattr(landmarks, "landmarks_norm"):
            return self._current_depth
        lms = getattr(landmarks, "landmarks_norm", None)
        if lms is None or len(lms) < 9:
            return self._current_depth
        # Index fingertip is index 8; z is relative to wrist/palm
        raw_z = lms[8][2]
        # MediaPipe: smaller z = closer to camera
        depth = float(np.clip(-raw_z * self.scale, -1.0, 1.0))
        self._current_depth = depth
        return self._current_depth


class WorkspaceMapper:
    """Maps image coordinates (u, v) and depth into 3D workspace [-1, 1]^3."""

    def __init__(
        self,
        frame_width: int = 1280,
        frame_height: int = 720,
        depth_source: Optional[DepthSource] = None,
        margin: float = 0.1,
    ) -> None:
        self.frame_width = frame_width
        self.frame_height = frame_height
        self.depth_source = depth_source or PlaneDepth(0.0)
        self.margin = margin  # Active sub-window margin fraction

    def map_point(
        self,
        u: float,
        v: float,
        landmarks=None,
        override_depth: Optional[float] = None,
    ) -> Tuple[float, float, float]:
        """Convert pixel (u, v) to 3D (x, y, z) in [-1, 1]^3."""
        # Active draw region considering margin
        x_min = self.frame_width * self.margin
        x_max = self.frame_width * (1.0 - self.margin)
        y_min = self.frame_height * self.margin
        y_max = self.frame_height * (1.0 - self.margin)

        # Normalize x to [-1, 1]
        norm_x = (u - x_min) / max(1e-5, (x_max - x_min))
        x = float(np.clip(norm_x * 2.0 - 1.0, -1.0, 1.0))

        # Normalize y to [-1, 1], flipping image v so +Y is up
        norm_y = (v - y_min) / max(1e-5, (y_max - y_min))
        y = float(np.clip(1.0 - norm_y * 2.0, -1.0, 1.0))

        if override_depth is not None:
            z = float(np.clip(override_depth, -1.0, 1.0))
        else:
            z = self.depth_source.get_depth(landmarks)

        return (x, y, z)
