"""Stroke rasterization utilities for CV pipeline."""

from __future__ import annotations

from typing import List, Optional
import cv2
import numpy as np

from formflow.strokes.store import Stroke


def rasterize_strokes(
    strokes: List[Stroke],
    canvas_size: int = 512,
    thickness: int = 3,
) -> np.ndarray:
    """Rasterize strokes to a deterministic binary uint8 image (0 or 255)."""
    img = np.zeros((canvas_size, canvas_size), dtype=np.uint8)
    for stroke in strokes:
        if stroke.is_empty():
            continue
        pts = np.array(stroke.points, dtype=np.int32).reshape((-1, 1, 2))
        cv2.polylines(img, [pts], isClosed=False, color=255, thickness=thickness, lineType=cv2.LINE_AA)
    return img
