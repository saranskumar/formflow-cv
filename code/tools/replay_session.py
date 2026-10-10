"""Replay a recorded landmark session through the pipeline (no webcam needed)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import cv2
import numpy as np
from formflow.config import Config
from formflow.hands.filters import OneEuroFilter2D
from formflow.hands.pinch import PinchDetector
from formflow.hands.tracker import HandLandmarks
from formflow.pencil.state_machine import PencilState, PencilStateMachine
from formflow.strokes.store import StrokeStore
from formflow.ui.overlay import Overlay

SESSIONS_DIR = Path(__file__).parent / "sessions"


def replay(session_file: Path, speed: float = 1.0) -> None:
    cfg = Config.load()

    with open(session_file) as f:
        data = json.load(f)

    frames_data = data["frames"]
    print(f"Replaying {len(frames_data)} frames from {session_file.name} at {speed:.1f}x speed")

    store = StrokeStore(
        smoothing_window=cfg.smoothing_window,
        min_spacing_px=cfg.min_point_spacing_px,
        outlier_jump_px=cfg.outlier_jump_px,
    )
    filt = OneEuroFilter2D(cfg.one_euro_min_cutoff, cfg.one_euro_beta)
    pinch = PinchDetector(cfg)
    pencil = PencilStateMachine()
    pencil.on_stroke_start(lambda pos: store.start_stroke(pos))
    pencil.on_point(lambda pos: store.add_point(pos))
    pencil.on_stroke_end(lambda: store.end_stroke())
    overlay = Overlay(cfg)

    WIN = "FormFlow Replay"
    cv2.namedWindow(WIN, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(WIN, 1280, 720)

    frame_h, frame_w = 720, 1280
    prev_t = 0.0

    for entry in frames_data:
        t = entry["t"]
        sleep = (t - prev_t) / speed
        if sleep > 0:
            time.sleep(sleep)
        prev_t = t

        # Reconstruct HandLandmarks
        lms = None
        if entry["landmarks"]:
            ld = entry["landmarks"]
            norm = np.array(ld["norm"], dtype=np.float32)
            pixel = (norm[:, :2] * np.array([frame_w, frame_h], dtype=np.float32)).astype(np.float32)
            lms = HandLandmarks(norm=norm, pixel=pixel,
                                handedness=ld["handedness"], hand_size=ld["hand_size"])

        # Filter + pinch
        cursor = None
        if lms is not None:
            fx, fy = filt(lms.index_tip_px[0], lms.index_tip_px[1], t)
            cursor = (fx, fy)
        else:
            filt.reset()

        is_pinching = pinch.update(lms)
        state = pencil.update(lms is not None, is_pinching, cursor)

        # Draw
        frame = np.zeros((frame_h, frame_w, 3), dtype=np.uint8)
        cv2.putText(frame, f"REPLAY: {session_file.name}  t={t:.2f}s",
                    (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (150, 150, 150), 1)
        overlay.render(frame, state, cursor, store.strokes, store.active_stroke, [])
        cv2.imshow(WIN, frame)
        if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
            break

    cv2.destroyAllWindows()
    print(f"Replay complete. Strokes captured: {len(store.strokes)}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        files = sorted(SESSIONS_DIR.glob("*.json"))
        if not files:
            print("No sessions found. Run record_session.py first.")
            sys.exit(1)
        session_file = files[-1]
    else:
        session_file = Path(sys.argv[1])

    speed = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
    replay(session_file, speed=speed)
