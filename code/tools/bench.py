"""Benchmark: measure per-stage FPS and latency."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import cv2
import numpy as np
from formflow.capture.webcam import WebcamCapture
from formflow.config import Config
from formflow.hands.filters import OneEuroFilter2D
from formflow.hands.tracker import HandTracker


def bench(n_frames: int = 300) -> None:
    cfg = Config.load()
    cam = WebcamCapture(cfg)
    tracker = HandTracker(cfg)
    filt = OneEuroFilter2D(cfg.one_euro_min_cutoff, cfg.one_euro_beta)

    if not cam.start():
        print("Camera not found.")
        return

    print(f"Benchmarking {n_frames} frames ...")

    t_capture, t_track, t_filter = [], [], []
    collected = 0

    try:
        while collected < n_frames:
            t0 = time.perf_counter()
            frame = cam.read()
            if frame is None:
                time.sleep(0.005)
                continue
            t1 = time.perf_counter()

            lms = tracker.process(frame)
            t2 = time.perf_counter()

            if lms is not None:
                filt(lms.index_tip_px[0], lms.index_tip_px[1], time.monotonic())
            t3 = time.perf_counter()

            t_capture.append((t1 - t0) * 1000)
            t_track.append((t2 - t1) * 1000)
            t_filter.append((t3 - t2) * 1000)
            collected += 1

    finally:
        cam.stop()
        tracker.release()

    def stats(vals):
        return f"avg={sum(vals)/len(vals):.1f}ms  min={min(vals):.1f}  max={max(vals):.1f}"

    total_avg = sum(a + b + c for a, b, c in zip(t_capture, t_track, t_filter)) / n_frames
    fps = 1000.0 / total_avg if total_avg > 0 else 0

    print(f"\n--- Benchmark results ({n_frames} frames) ---")
    print(f"Capture:     {stats(t_capture)}")
    print(f"Hand track:  {stats(t_track)}")
    print(f"Filter:      {stats(t_filter)}")
    print(f"Total avg:   {total_avg:.1f}ms  => {fps:.1f} FPS")


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    bench(n)
