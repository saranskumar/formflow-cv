"""Tests for CV processing, silhouette extraction, gap closing and cross-view alignment."""

import cv2
import numpy as np
import pytest

from formflow.align.consistency import check_view_consistency
from formflow.align.normalize import normalize_and_align_views
from formflow.cv_process.silhouette import clean_specks, process_silhouette


def test_clean_specks():
    img = np.zeros((100, 100), dtype=np.uint8)
    # A single 2x2 speck (area 4)
    img[10:12, 10:12] = 255
    # A large 10x10 blob (area 100)
    img[40:50, 40:50] = 255

    cleaned = clean_specks(img, min_area=20)
    assert cv2.countNonZero(cleaned[10:12, 10:12]) == 0
    assert cv2.countNonZero(cleaned[40:50, 40:50]) == 100


def test_closed_circle_silhouette():
    img = np.zeros((200, 200), dtype=np.uint8)
    cv2.circle(img, (100, 100), 50, 255, 3)

    info = process_silhouette(img, base_kernel_size=7)
    assert info.is_closed
    assert info.area > 7000  # pi * 50^2 ~= 7854
    assert info.bbox[2] > 90 and info.bbox[3] > 90
    assert abs(info.centroid[0] - 100) < 3
    assert abs(info.centroid[1] - 100) < 3


def test_gap_closing():
    img = np.zeros((200, 200), dtype=np.uint8)
    # Circle with a small ~6px gap (angles 4 to 356 on radius 50)
    cv2.ellipse(img, (100, 100), (50, 50), 0, 4, 356, 255, 3)

    info = process_silhouette(img, base_kernel_size=7, max_gap_kernel=21)
    assert info.is_closed
    assert info.area > 6000


def test_large_unclosed_gap_reports_not_closed():
    img = np.zeros((200, 200), dtype=np.uint8)
    # Circle with a huge 120-degree gap (cannot close)
    cv2.ellipse(img, (100, 100), (50, 50), 0, 0, 240, 255, 3)

    info = process_silhouette(img, base_kernel_size=7, max_gap_kernel=15)
    assert not info.is_closed


def test_mismatch_warning_and_alignment():
    # Synthetic front: 100x100 box
    img_front = np.zeros((200, 200), dtype=np.uint8)
    cv2.rectangle(img_front, (50, 50), (150, 150), 255, 3)
    info_front = process_silhouette(img_front)

    # Top: 140x100 box (40% mismatch in X width!)
    img_top = np.zeros((200, 200), dtype=np.uint8)
    cv2.rectangle(img_top, (30, 50), (170, 150), 255, 3)
    info_top = process_silhouette(img_top)

    # Side: 100x100 box
    img_side = np.zeros((200, 200), dtype=np.uint8)
    cv2.rectangle(img_side, (50, 50), (150, 150), 255, 3)
    info_side = process_silhouette(img_side)

    disagreements = check_view_consistency(info_front, info_top, info_side, threshold_pct=0.10)
    assert len(disagreements) >= 1
    assert any(d.axis == "X" for d in disagreements)

    # Normalization should scale and center on common grid
    aligned = normalize_and_align_views(info_front, info_top, info_side, grid_size=64)
    assert aligned.front.shape == (64, 64)
    assert aligned.top.shape == (64, 64)
    assert aligned.side.shape == (64, 64)
    assert cv2.countNonZero(aligned.front) > 0
