"""Wavefront OBJ export for polylines (Mode 1) and meshes (Mode 2)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Optional
import numpy as np

try:
    import open3d as o3d
    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False

from formflow.strokes.store import Stroke

log = logging.getLogger(__name__)


def export_strokes_to_obj(strokes: List[Stroke], filepath: Path | str) -> bool:
    """Export 3D strokes as Wavefront OBJ polyline elements ('l' elements).

    Format:
      v x y z
      ...
      l 1 2 3 ...
    """
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        lines: list[str] = [
            "# FormFlow 3D Polyline Export",
            f"# Total strokes: {len(strokes)}",
            "o FormFlow_Sketch",
        ]

        vertex_offset = 1  # OBJ is 1-indexed
        for s_idx, stroke in enumerate(strokes):
            if stroke.is_empty():
                continue
            n_pts = len(stroke.points)
            z_vals = stroke.z if stroke.z and len(stroke.z) == n_pts else [0.0] * n_pts

            lines.append(f"g stroke_{s_idx}")
            v_indices = []
            for i in range(n_pts):
                px, py = stroke.points[i]
                pz = z_vals[i]
                lines.append(f"v {px:.6f} {py:.6f} {pz:.6f}")
                v_indices.append(str(vertex_offset))
                vertex_offset += 1

            if len(v_indices) >= 2:
                lines.append("l " + " ".join(v_indices))

        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

        log.info("Exported %d strokes to OBJ polyline file: %s", len(strokes), path)
        return True
    except Exception as e:
        log.error("Failed to export strokes to OBJ: %s", e)
        return False


def export_mesh_to_obj(mesh: o3d.geometry.TriangleMesh, filepath: Path | str) -> bool:
    """Export Open3D TriangleMesh to Wavefront OBJ."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not HAS_OPEN3D:
        log.error("Open3D required for mesh export.")
        return False
    try:
        success = o3d.io.write_triangle_mesh(
            str(path),
            mesh,
            write_ascii=True,
            compressed=False,
            write_vertex_normals=True,
            write_triangle_uvs=False,
        )
        if success:
            log.info("Mesh successfully exported to %s", path)
        else:
            log.error("Open3D failed to write OBJ to %s", path)
        return success
    except Exception as e:
        log.error("Error writing OBJ mesh: %s", e)
        return False
