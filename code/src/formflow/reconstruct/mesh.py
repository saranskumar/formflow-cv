"""Mesh generation using Marching Cubes, Open3D cleanup and smoothing."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional, Tuple
import numpy as np
from skimage import measure

try:
    import open3d as o3d
    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False

from formflow.reconstruct.hull import HullResult

log = logging.getLogger(__name__)


@dataclass
class MeshResult:
    """Extracted 3D triangle mesh and geometry properties."""
    mesh: Optional[o3d.geometry.TriangleMesh]
    vertex_count: int
    triangle_count: int
    is_watertight: bool
    status: str


def extract_mesh_from_hull(
    hull_result: HullResult,
    target_scale: float = 1.6,
    smooth_iterations: int = 1,
) -> MeshResult:
    """Extract a clean, watertight 3D triangle mesh from a voxel HullResult.

    Pads the volume with a 1-voxel zero boundary so surfaces close properly,
    runs marching cubes, centers at (0,0,0) and normalizes scale.
    """
    if hull_result.is_empty or not HAS_OPEN3D:
        return MeshResult(
            mesh=None,
            vertex_count=0,
            triangle_count=0,
            is_watertight=False,
            status="No voxels available to construct mesh.",
        )

    # 1. Pad volume with 1-voxel zero boundary to guarantee closed surfaces
    voxels = hull_result.voxels.astype(np.float32)
    padded = np.pad(voxels, pad_width=1, mode="constant", constant_values=0.0)

    try:
        # marching_cubes returns (verts, faces, normals, values)
        verts, faces, normals, _ = measure.marching_cubes(padded, level=0.5)
    except Exception as e:
        log.error("Marching cubes failed: %s", e)
        return MeshResult(
            mesh=None,
            vertex_count=0,
            triangle_count=0,
            is_watertight=False,
            status=f"Marching cubes error: {e}",
        )

    # Offset vertices back by 1 to undo pad_width=1
    verts = verts - 1.0

    # Grid dimension
    N = float(voxels.shape[0])

    # Center vertices at (0, 0, 0)
    # Voxel indices are [0, N-1] for each axis
    verts = verts - (N / 2.0)

    # Normalize scale to fit in [-target_scale/2, target_scale/2]
    scale_factor = target_scale / max(N, 1.0)
    verts = verts * scale_factor

    # Invert normals/faces if needed to ensure outward-facing normals
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(verts.astype(np.float64))
    mesh.triangles = o3d.utility.Vector3iVector(faces.astype(np.int32))

    # Mesh cleanup
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()

    # Optional Laplacian smoothing
    if smooth_iterations > 0:
        mesh = mesh.filter_smooth_simple(number_of_iterations=smooth_iterations)

    mesh.compute_vertex_normals()
    mesh.compute_triangle_normals()

    # Paint pleasant default material color (soft metallic cyan/grey)
    mesh.paint_uniform_color([0.25, 0.75, 0.90])

    is_watertight = mesh.is_watertight()
    v_count = len(mesh.vertices)
    f_count = len(mesh.triangles)

    status = (
        f"Mesh generated: {v_count} vertices, {f_count} faces. "
        f"Watertight: {'Yes' if is_watertight else 'No'}"
    )

    log.info(status)
    return MeshResult(
        mesh=mesh,
        vertex_count=v_count,
        triangle_count=f_count,
        is_watertight=is_watertight,
        status=status,
    )
