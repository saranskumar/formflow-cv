"""Unit tests for Mode 1 (Rapid 3D) mapping and export."""

import tempfile
from pathlib import Path
from formflow.mode_rapid3d.mapping import PlaneDepth, HandScaleDepth, WorkspaceMapper
from formflow.export.obj import export_strokes_to_obj
from formflow.strokes.store import Stroke


def test_plane_depth_adjustment():
    depth = PlaneDepth(0.0, step=0.1)
    assert depth.get_depth() == 0.0
    depth.adjust(0.2)
    assert abs(depth.get_depth() - 0.2) < 1e-5
    depth.adjust(-0.5)
    assert abs(depth.get_depth() - (-0.3)) < 1e-5
    depth.adjust(-2.0)
    assert depth.get_depth() == -1.0  # Clamped
    depth.adjust(5.0)
    assert depth.get_depth() == 1.0   # Clamped


def test_workspace_mapper_coordinates():
    mapper = WorkspaceMapper(frame_width=1000, frame_height=1000, margin=0.0)
    # Center pixel
    cx, cy, cz = mapper.map_point(500, 500, override_depth=0.5)
    assert abs(cx) < 1e-4
    assert abs(cy) < 1e-4
    assert abs(cz - 0.5) < 1e-4

    # Top-left (u=0, v=0) -> x=-1, y=+1 (v flipped so +Y is up)
    lx, ly, _ = mapper.map_point(0, 0)
    assert abs(lx - (-1.0)) < 1e-4
    assert abs(ly - 1.0) < 1e-4

    # Bottom-right (u=1000, v=1000) -> x=+1, y=-1
    rx, ry, _ = mapper.map_point(1000, 1000)
    assert abs(rx - 1.0) < 1e-4
    assert abs(ry - (-1.0)) < 1e-4


def test_export_strokes_to_obj():
    s1 = Stroke(id=1, points=[(0.0, 0.0), (1.0, 1.0)], z=[0.2, 0.5])
    s2 = Stroke(id=2, points=[(-0.5, 0.2), (0.5, -0.2)], z=[-0.1, -0.3])
    with tempfile.TemporaryDirectory() as tmpdir:
        out_file = Path(tmpdir) / "test_sketch.obj"
        success = export_strokes_to_obj([s1, s2], out_file)
        assert success
        assert out_file.exists()
        content = out_file.read_text(encoding="utf-8")
        assert "v 0.000000 0.000000 0.200000" in content
        assert "l 1 2" in content
        assert "l 3 4" in content
