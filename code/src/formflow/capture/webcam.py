"""Threaded webcam capture with a 1-frame drop-old queue."""

from __future__ import annotations

import logging
import queue
import threading
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
        backend = _BACKEND_MAP.get(self._cfg.camera_backend, cv2.CAP_ANY)
        self._cap = cv2.VideoCapture(self._cfg.camera_index, backend)
        if not self._cap.isOpened():
            # Try CAP_ANY as fallback
            self._cap = cv2.VideoCapture(self._cfg.camera_index)
        if not self._cap.isOpened():
            log.error("Camera not found (index=%d)", self._cfg.camera_index)
            return False

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
                continue
            if self._cfg.mirror:
                frame = cv2.flip(frame, 1)
            # Drop old frame, keep newest
            try:
                self._queue.get_nowait()
            except queue.Empty:
                pass
            self._queue.put(frame)
