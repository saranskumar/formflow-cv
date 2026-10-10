"""Tests for StrokeStore: smoothing, undo/redo, outlier rejection."""

import pytest
from formflow.strokes.store import Stroke, StrokeStore, smooth_stroke


# ─── smooth_stroke ────────────────────────────────────────────────────────────

def _jitter_stroke(n=30, jitter=5.0):
    import random
    pts = []
    x, y = 100.0, 100.0
    for _ in range(n):
        pts.append((x + random.uniform(-jitter, jitter),
                    y + random.uniform(-jitter, jitter)))
        x += 5
    s = Stroke(id=0, points=pts)
    return s


def test_smooth_reduces_jitter():
    """Smoothed stroke should have less variance than raw."""
    import numpy as np
    raw = _jitter_stroke(40, jitter=10.0)
    smoothed = smooth_stroke(raw, window=5)
    raw_pts = np.array(raw.points)
    smo_pts = np.array(smoothed.points)
    assert smo_pts.std() < raw_pts.std()


def test_smooth_preserves_length():
    raw = _jitter_stroke(20)
    smoothed = smooth_stroke(raw, window=5)
    assert len(smoothed.points) == len(raw.points)


def test_smooth_short_stroke_unchanged():
    s = Stroke(id=0, points=[(0, 0), (1, 1)])
    out = smooth_stroke(s, window=5)
    assert out.points == s.points


# ─── StrokeStore undo / redo ──────────────────────────────────────────────────

def _add_full_stroke(store: StrokeStore, pts):
    store.start_stroke(pts[0])
    for p in pts[1:]:
        store.add_point(p)
    store.end_stroke()


def test_undo_redo_roundtrip():
    store = StrokeStore(min_spacing_px=0, outlier_jump_px=9999)
    pts = [(i * 10, i * 10) for i in range(10)]
    _add_full_stroke(store, pts)
    assert len(store.strokes) == 1

    store.undo()
    assert len(store.strokes) == 0

    store.redo()
    assert len(store.strokes) == 1


def test_redo_cleared_after_new_stroke():
    store = StrokeStore(min_spacing_px=0, outlier_jump_px=9999)
    pts = [(i * 10, i * 10) for i in range(10)]
    _add_full_stroke(store, pts)
    store.undo()
    _add_full_stroke(store, pts)   # new stroke clears redo
    # redo stack should be empty; a second redo does nothing
    count_before = len(store.strokes)
    store.redo()
    assert len(store.strokes) == count_before


def test_clear_clears_all_strokes():
    store = StrokeStore(min_spacing_px=0, outlier_jump_px=9999)
    for _ in range(3):
        _add_full_stroke(store, [(i * 5, i * 5) for i in range(5)])
    store.clear()
    assert store.strokes == []


# ─── outlier rejection ────────────────────────────────────────────────────────

def test_outlier_points_rejected():
    store = StrokeStore(min_spacing_px=0, outlier_jump_px=50.0)
    store.start_stroke((100, 100))
    store.add_point((105, 100))   # ok
    store.add_point((500, 100))   # outlier — jump > 50
    store.add_point((110, 100))   # but now jump from 105 is ok
    store.end_stroke()
    # The outlier (500,100) should have been rejected
    pts = store.strokes[-1].points
    xs = [p[0] for p in pts]
    assert 500 not in xs


# ─── min spacing ─────────────────────────────────────────────────────────────

def test_min_spacing_filter():
    store = StrokeStore(min_spacing_px=10.0, outlier_jump_px=9999)
    store.start_stroke((0, 0))
    store.add_point((5, 0))    # too close — rejected
    store.add_point((15, 0))   # ok
    store.add_point((16, 0))   # too close — rejected
    store.end_stroke()
    pts = store.strokes[-1].points
    # Only (0,0) and (15,0) should be in the committed stroke
    assert len(pts) >= 2
    # No point between 5 and 15
    xs = [p[0] for p in pts]
    assert 5 not in xs
