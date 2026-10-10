"""Record a live landmark session to a JSON file for offline replay."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Allow running directly without installing the package
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import cv2
from formflow.capture.webcam import WebcamCapture
from formflow.config import Config
from formflow.hands.tracker import HandTracker

OUTPUT_DIR = Path(__file__).parent / "sessions"
OUTPUT_DIR.mkdir(exist_ok=True)


def record(duration: float = 60.0, tag: str = "session") -> None:
    cfg = Config.load()
    cam = WebcamCapture(cfg)
    tracker = HandTracker(cfg)

    if not cam.start():
        print("Camera not found.")
        return

    session_file = OUTPUT_DIR / f"{tag}_{int(time.time())}.json"
    frames: list[dict] = []
    start = time.monotonic()

    print(f"Recording for {duration:.0f}s. Press Q to stop early.")
    print(f"Output: {session_file}")

    WIN = "FormFlow Recorder"
    cv2.namedWindow(WIN)

    try:
        while time.monotonic() - start < duration:
            frame = cam.read()
            if frame is None:
                continue

            t = time.monotonic() - start
            lms = tracker.process(frame)

            record_entry: dict = {"t": round(t, 4), "landmarks": None}
            if lms is not None:
                record_entry["landmarks"] = {
                    "norm": lms.norm.tolist(),
                    "handedness": lms.handedness,
                    "hand_size": lms.hand_size,
                }

            frames.append(record_entry)

            # Draw feedback
            if lms is not None:
                tracker.draw_landmarks(frame, lms)

            elapsed = time.monotonic() - start
            cv2.putText(frame, f"REC {elapsed:.1f}s / {duration:.0f}s  Q=stop",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 1)
            cv2.imshow(WIN, frame)
            if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                break
    finally:
        cam.stop()
        tracker.release()
        cv2.destroyAllWindows()

    with open(session_file, "w") as f:
        json.dump({"frames": frames, "duration": duration, "tag": tag}, f)

    print(f"Saved {len(frames)} frames to {session_file}")


if __name__ == "__main__":
    tag = sys.argv[1] if len(sys.argv) > 1 else "session"
    duration = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0
    record(duration=duration, tag=tag)
