"""Tests for Multi-view canvases and project IO."""

import tempfile
from pathlib import Path
import numpy as np

from formflow.config import Config
from formflow.export.project_io import load_project, save_project
from formflow.mode_multiview.canvas import ViewCanvas
from formflow.mode_multiview.guides import snap_to_close_stroke
from formflow.strokes.store import Stroke


def test_snap_to_close():
    # End point is close to start point (distance ~5 px)
    pts = [(10.0, 10.0), (10.0, 50.0), (50.0, 50.0), (50.0, 10.0), (13.0, 12.0)]
    snapped = snap_to_close_stroke(pts, snap_distance_px=10.0)
    assert snapped[-1] == (10.0, 10.0)  # Snapped to start point

    # End point far from start point (distance ~30 px)
    far_pts = [(10.0, 10.0), (10.0, 50.0), (50.0, 50.0), (50.0, 10.0), (40.0, 10.0)]
    not_snapped = snap_to_close_stroke(far_pts, snap_distance_px=10.0)
    assert not_snapped[-1] == (40.0, 10.0)


def test_view_canvas_stroke_and_raster():
    canvas = ViewCanvas("front", axis_labels=("X", "Y"), size=256, outlier_jump_px=200.0)
    assert canvas.is_empty()

    # Draw a box with sampled points along edges
    canvas.start_stroke((50.0, 50.0))
    for x in range(60, 151, 10):
        canvas.add_point((float(x), 50.0))
    for y in range(60, 151, 10):
        canvas.add_point((150.0, float(y)))
    for x in range(140, 49, -10):
        canvas.add_point((float(x), 150.0))
    for y in range(140, 49, -10):
        canvas.add_point((50.0, float(y)))
    canvas.end_stroke()

    assert not canvas.is_empty()
    assert len(canvas.store.strokes) == 1

    # Check extents
    ext = canvas.get_extents()
    assert ext is not None
    min_x, max_x, min_y, max_y = ext
    assert abs(min_x - 50.0) < 5.0
    assert abs(max_x - 150.0) < 5.0

    # Rasterize
    raster = canvas.rasterize()
    assert raster.shape == (256, 256)
    assert np.count_nonzero(raster) > 0


def test_project_save_and_load_roundtrip():
    s1 = Stroke(id=1, points=[(10.0, 20.0), (30.0, 40.0)], z=None)
    s2 = Stroke(id=2, points=[(5.0, 15.0), (25.0, 35.0)], z=None)

    view_data = {
        "front": [s1],
        "top": [s2],
        "side": [],
    }

    with tempfile.TemporaryDirectory() as tmpdir:
        p_path = Path(tmpdir) / "test_proj.json"
        saved = save_project(p_path, mode="multiview", view_strokes=view_data, canvas_size=512)
        assert saved
        assert p_path.exists()

        loaded = load_project(p_path)
        assert loaded is not None
        assert loaded["mode"] == "multiview"
        assert len(loaded["views"]["front"]) == 1
        assert len(loaded["views"]["top"]) == 1
        assert len(loaded["views"]["side"]) == 0
        loaded_pts = loaded["views"]["front"][0].points
        assert loaded_pts == [(10.0, 20.0), (30.0, 40.0)]
