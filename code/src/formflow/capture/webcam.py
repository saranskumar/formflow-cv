"""Threaded webcam capture with a 1-frame drop-old queue."""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

_BACKEND_MAP = {
    "DSHOW": cv2.CAP_DSHOW,
    "MSMF": cv2.CAP_MSMF,
    "AUTO": cv2.CAP_ANY,
}


class WebcamCapture:
    """Non-blocking webcam reader.

    Usage::

        cam = WebcamCapture(cfg)
        cam.start()
        frame = cam.read()   # None if not yet available
        cam.stop()
    """

    def __init__(self, cfg) -> None:
        self._cfg = cfg
        self._cap: Optional[cv2.VideoCapture] = None
        self._queue: queue.Queue[Optional[np.ndarray]] = queue.Queue(maxsize=1)
        self._thread: Optional[threading.Thread] = None
        self._running = threading.Event()

    # ------------------------------------------------------------------
    def start(self) -> bool:
        self._queue = queue.Queue(maxsize=1)
        backend = _BACKEND_MAP.get(self._cfg.camera_backend, cv2.CAP_ANY)
        self._cap = cv2.VideoCapture(self._cfg.camera_index, backend)
        if not self._cap.isOpened():
            # Try CAP_ANY as fallback
            self._cap = cv2.VideoCapture(self._cfg.camera_index)
        if not self._cap.isOpened():
            log.error("Camera not found (index=%d)", self._cfg.camera_index)
            return False

        # MJPG + 1-frame buffer: uncompressed 720p over DirectShow is often limited to ~10 fps
        self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, self._cfg.camera_width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self._cfg.camera_height)

        self._running.set()
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        log.info(
            "Webcam started: index=%d  %dx%d  backend=%s",
            self._cfg.camera_index,
            int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            self._cfg.camera_backend,
        )
        return True

    def stop(self) -> None:
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=2.0)
        if self._cap:
            self._cap.release()
        log.info("Webcam stopped.")

    def switch_next(self, max_index: int = 5) -> bool:
        """Switch to the next camera that opens. Restores the old one on failure."""
        old = self._cfg.camera_index
        self.stop()
        for step in range(1, max_index + 1):
            self._cfg.camera_index = (old + step) % max_index
            if self._cfg.camera_index == old:
                break
            if self.start():
                return True
        self._cfg.camera_index = old
        self.start()
        return False

    def read(self) -> Optional[np.ndarray]:
        """Return the latest frame or None."""
        try:
            return self._queue.get_nowait()
        except queue.Empty:
            return None

    # ------------------------------------------------------------------
    def _capture_loop(self) -> None:
        while self._running.is_set():
            ok, frame = self._cap.read()
            if not ok:
                log.warning("Capture read failed.")
                time.sleep(0.05)  # don't spin the CPU
                continue
            if self._cfg.mirror:
                frame = cv2.flip(frame, 1)
            # Drop old frame, keep newest
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            self._queue.put(frame)
