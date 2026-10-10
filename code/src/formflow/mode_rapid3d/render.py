"""Open3D rendering utilities for 3D sketching (Mode 1)."""

from __future__ import annotations

import logging
from typing import Optional, List, Tuple
import numpy as np

try:
    import open3d as o3d
    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False

from formflow.strokes.store import Stroke

log = logging.getLogger(__name__)

# Palette of distinct colors for 3D strokes (normalized RGB)
STROKE_COLORS = [
    [0.0, 0.85, 1.0],   # Bright Cyan
    [1.0, 0.75, 0.0],   # Gold
    [0.2, 1.0, 0.4],    # Electric Green
    [1.0, 0.3, 0.6],    # Magenta
    [0.7, 0.4, 1.0],    # Lavender
    [1.0, 0.5, 0.1],    # Orange
]


def strokes_to_lineset(
    strokes: List[Stroke],
    active_stroke: Optional[Stroke] = None,
) -> Optional[o3d.geometry.LineSet]:
    """Convert a list of strokes (and optional active stroke) to an Open3D LineSet."""
    if not HAS_OPEN3D:
        return None

    all_strokes = list(strokes)
    if active_stroke and not active_stroke.is_empty():
        all_strokes.append(active_stroke)

    if not all_strokes:
        # Return empty lineset
        return o3d.geometry.LineSet()

    points_list: list[list[float]] = []
    lines_list: list[list[int]] = []
    colors_list: list[list[float]] = []

    current_idx = 0
    for s_idx, stroke in enumerate(all_strokes):
        if stroke.is_empty():
            continue

        n_pts = len(stroke.points)
        z_vals = stroke.z if stroke.z and len(stroke.z) == n_pts else [0.0] * n_pts
        is_active = (stroke is active_stroke)
        base_color = [1.0, 1.0, 1.0] if is_active else STROKE_COLORS[s_idx % len(STROKE_COLORS)]

        start_pt_idx = current_idx
        for i in range(n_pts):
            px, py = stroke.points[i]
            pz = z_vals[i]
            points_list.append([float(px), float(py), float(pz)])
            current_idx += 1

        for i in range(n_pts - 1):
            lines_list.append([start_pt_idx + i, start_pt_idx + i + 1])
            colors_list.append(base_color)

    if not lines_list:
        return o3d.geometry.LineSet()

    lineset = o3d.geometry.LineSet()
    lineset.points = o3d.utility.Vector3dVector(np.array(points_list, dtype=np.float64))
    lineset.lines = o3d.utility.Vector2iVector(np.array(lines_list, dtype=np.int32))
    lineset.colors = o3d.utility.Vector3dVector(np.array(colors_list, dtype=np.float64))
    return lineset


def create_cursor_sphere(
    pos: Tuple[float, float, float],
    radius: float = 0.03,
    color: Tuple[float, float, float] = (0.0, 0.9, 1.0),
) -> Optional[o3d.geometry.TriangleMesh]:
    """Create a 3D sphere marker at cursor (x, y, z)."""
    if not HAS_OPEN3D:
        return None
    sphere = o3d.geometry.TriangleMesh.create_sphere(radius=radius, resolution=12)
    sphere.translate(np.array(pos, dtype=np.float64))
    sphere.paint_uniform_color(np.array(color, dtype=np.float64))
    sphere.compute_vertex_normals()
    return sphere
