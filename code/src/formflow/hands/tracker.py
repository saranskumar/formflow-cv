"""MediaPipe Hands wrapper — returns typed landmark data."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import mediapipe as mp
import numpy as np

log = logging.getLogger(__name__)

# MediaPipe landmark indices
IDX_WRIST = 0
IDX_INDEX_TIP = 8
IDX_THUMB_TIP = 4
IDX_MIDDLE_MCP = 9  # used for hand-size normalisation


@dataclass
class HandLandmarks:
    """Typed container for a single detected hand."""

    # Normalised [0, 1] coords
    norm: np.ndarray           # shape (21, 3) — x, y, z (z relative to wrist)
    # Pixel coords (int) based on frame dimensions
    pixel: np.ndarray          # shape (21, 2) — x, y

    handedness: str            # "Left" or "Right"
    hand_size: float           # wrist-to-middle-MCP distance in pixels (normalisation ref)

    @property
    def index_tip_px(self) -> tuple[float, float]:
        return float(self.pixel[IDX_INDEX_TIP, 0]), float(self.pixel[IDX_INDEX_TIP, 1])

    @property
    def thumb_tip_px(self) -> tuple[float, float]:
        return float(self.pixel[IDX_THUMB_TIP, 0]), float(self.pixel[IDX_THUMB_TIP, 1])

    @property
    def thumb_tip_norm(self) -> tuple[float, float]:
        return float(self.norm[IDX_THUMB_TIP, 0]), float(self.norm[IDX_THUMB_TIP, 1])

    @property
    def index_tip_norm(self) -> tuple[float, float]:
        return float(self.norm[IDX_INDEX_TIP, 0]), float(self.norm[IDX_INDEX_TIP, 1])


class HandTracker:
    """Thin wrapper around MediaPipe Hands.

    Accepts a BGR frame, returns Optional[HandLandmarks].
    Does NOT draw on the frame (that is overlay.py's job).
    """

    def __init__(self, cfg) -> None:
        self._cfg = cfg
        mp_hands = mp.solutions.hands
        self._hands = mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=cfg.max_num_hands,
            min_detection_confidence=cfg.detection_confidence,
            min_tracking_confidence=cfg.tracking_confidence,
        )
        self._mp_drawing = mp.solutions.drawing_utils
        self._mp_hands = mp_hands
        log.info("HandTracker initialised (max_hands=%d)", cfg.max_num_hands)

    def process(self, frame: np.ndarray) -> Optional[HandLandmarks]:
        """Return landmarks for the first detected hand, or None."""
        h, w = frame.shape[:2]
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self._hands.process(rgb)

        if not results.multi_hand_landmarks:
            return None

        hand_lms = results.multi_hand_landmarks[0]
        handedness_label = (
            results.multi_handedness[0].classification[0].label
            if results.multi_handedness
            else "Right"
        )

        norm = np.array([[lm.x, lm.y, lm.z] for lm in hand_lms.landmark], dtype=np.float32)
        pixel = (norm[:, :2] * np.array([w, h], dtype=np.float32)).astype(np.float32)

        # Hand size: wrist to middle MCP in pixels
        wrist = pixel[IDX_WRIST]
        mcp = pixel[IDX_MIDDLE_MCP]
        hand_size = float(np.linalg.norm(mcp - wrist))
        hand_size = max(hand_size, 1.0)

        return HandLandmarks(norm=norm, pixel=pixel, handedness=handedness_label, hand_size=hand_size)

    def draw_landmarks(self, frame: np.ndarray, lms: HandLandmarks) -> None:
        """Draw the MediaPipe skeleton directly onto frame (in-place)."""
        # Reconstruct MediaPipe object for drawing
        mp_lms = self._mp_hands.HandLandmarks()
        for i in range(21):
            lm = mp_lms.landmark.add()
            lm.x, lm.y, lm.z = lms.norm[i]
        self._mp_drawing.draw_landmarks(frame, mp_lms, self._mp_hands.HAND_CONNECTIONS)

    def release(self) -> None:
        self._hands.close()
