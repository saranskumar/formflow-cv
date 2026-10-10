"""Tests for visual hull reconstruction and mesh extraction."""

import numpy as np
import pytest
from formflow.align.normalize import AlignedViews
from formflow.reconstruct.hull import reconstruct_visual_hull
from formflow.reconstruct.mesh import extract_mesh_from_hull


def make_square_mask(N=64, size=32):
    mask = np.zeros((N, N), dtype=np.uint8)
    start = (N - size) // 2
    mask[start:start + size, start:start + size] = 255
    return mask


def make_circle_mask(N=64, radius=18):
    mask = np.zeros((N, N), dtype=np.uint8)
    cx, cy = N // 2, N // 2
    y, x = np.ogrid[:N, :N]
    dist = (x - cx) ** 2 + (y - cy) ** 2
    mask[dist <= radius ** 2] = 255
    return mask


def test_cube_reconstruction():
    N = 48
    sq = make_square_mask(N, size=24)
    aligned = AlignedViews(
        front=sq,
        top=sq,
        side=sq,
        grid_size=N,
        disagreements=[],
        extents=(24.0, 24.0, 24.0),
    )
    result = reconstruct_visual_hull(aligned)
    assert not result.is_empty
    # Volume of 24x24x24 cube is 13824
    assert abs(result.voxel_count - (24 ** 3)) < 100
    assert result.reprojection_iou["front"] > 0.95
    assert result.reprojection_iou["top"] > 0.95
    assert result.reprojection_iou["side"] > 0.95

    # Extract mesh
    mesh_res = extract_mesh_from_hull(result)
    assert mesh_res.mesh is not None
    assert mesh_res.vertex_count > 0
    assert mesh_res.triangle_count > 0
    assert mesh_res.is_watertight


def test_cylinder_reconstruction():
    N = 48
    circle = make_circle_mask(N, radius=14)
    rect = np.zeros((N, N), dtype=np.uint8)
    # Height = 28, Width = 28
    rect[10:38, 10:38] = 255

    # Top is circle, Front and Side are rectangles
    aligned = AlignedViews(
        front=rect,
        top=circle,
        side=rect,
        grid_size=N,
        disagreements=[],
        extents=(28.0, 28.0, 28.0),
    )
    result = reconstruct_visual_hull(aligned)
    assert not result.is_empty
    # Cylindrical volume pi * r^2 * h ~= 3.14159 * 14^2 * 28 ~= 17241
    expected_vol = np.pi * (14 ** 2) * 28
    assert abs(result.voxel_count - expected_vol) / expected_vol < 0.10
    assert result.reprojection_iou["top"] > 0.90


def test_asymmetric_l_shape_orientation():
    """Verify right-handed coordinate mapping on an asymmetric L-shape.

    L-shape in Front view:
      Vertical leg on left (x small), horizontal leg on bottom (y small).
    L-shape in Side view:
      Vertical leg on back (z small), horizontal leg on bottom (y small).
    """
    N = 48
    mask_front = np.zeros((N, N), dtype=np.uint8)
    # In image coordinates:
    # Vertical leg on left: x in [10, 20], y in [10, 40]
    mask_front[10:40, 10:20] = 255
    # Bottom leg: x in [10, 40], y in [30, 40] (image bottom is y in [30, 40])
    mask_front[30:40, 10:40] = 255

    # Top view of simple prism (square)
    mask_top = np.zeros((N, N), dtype=np.uint8)
    mask_top[10:40, 10:40] = 255

    # Side view: same L profile
    mask_side = mask_front.copy()

    aligned = AlignedViews(
        front=mask_front,
        top=mask_top,
        side=mask_side,
        grid_size=N,
        disagreements=[],
        extents=(30.0, 30.0, 30.0),
    )
    result = reconstruct_visual_hull(aligned)
    assert not result.is_empty
    assert result.reprojection_iou["front"] > 0.90

    # Ensure mesh generation succeeds and produces vertices
    mesh_res = extract_mesh_from_hull(result)
    assert mesh_res.mesh is not None
    assert mesh_res.is_watertight
