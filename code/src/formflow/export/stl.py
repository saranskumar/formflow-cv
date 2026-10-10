"""Stereolithography (STL) export for 3D triangle meshes."""

from __future__ import annotations

import logging
from pathlib import Path

try:
    import open3d as o3d
    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False

log = logging.getLogger(__name__)


def export_mesh_to_stl(
    mesh: o3d.geometry.TriangleMesh,
    filepath: Path | str,
    binary: bool = True,
) -> bool:
    """Export TriangleMesh to STL file.

    Ensures normals are computed and reports watertight status.
    """
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    if not HAS_OPEN3D:
        log.error("Open3D required for STL export.")
        return False

    try:
        if not mesh.has_vertex_normals():
            mesh.compute_vertex_normals()
        if not mesh.has_triangle_normals():
            mesh.compute_triangle_normals()

        is_watertight = mesh.is_watertight()
        log.info("Mesh watertight status: %s (triangles: %d)", is_watertight, len(mesh.triangles))

        success = o3d.io.write_triangle_mesh(
            str(path),
            mesh,
            write_ascii=not binary,
            compressed=False,
            write_vertex_normals=True,
        )
        if success:
            log.info("Exported STL to %s (binary=%s, watertight=%s)", path, binary, is_watertight)
        else:
            log.error("Failed to write STL to %s", path)
        return success
    except Exception as e:
        log.error("Error exporting STL: %s", e)
        return False
