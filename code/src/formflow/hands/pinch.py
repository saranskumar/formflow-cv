"""Pinch and gesture detection."""

from __future__ import annotations

import time
from enum import Enum, auto
from typing import Optional

import numpy as np

from formflow.hands.tracker import HandLandmarks


class GestureState(Enum):
    NONE = auto()
    PINCH = auto()
    FIST = auto()
    OPEN_PALM = auto()


class PinchDetector:
    """Hysteretic pinch detection normalised by hand size.

    States: not-pinching / pinching, with debounce.
    """

    def __init__(self, cfg) -> None:
        self._on = cfg.pinch_on_threshold
        self._off = cfg.pinch_off_threshold
        self._debounce = cfg.pinch_debounce_frames
        self._is_pinching = False
        self._consecutive = 0

    def update(self, lms: Optional[HandLandmarks]) -> bool:
        if lms is None:
            self._is_pinching = False
            self._consecutive = 0
            return False

        # Normalised distance
        t = np.array(lms.thumb_tip_px)
        i = np.array(lms.index_tip_px)
        dist = float(np.linalg.norm(t - i)) / lms.hand_size

        if not self._is_pinching:
            if dist < self._on:
                self._consecutive += 1
                if self._consecutive >= self._debounce:
                    self._is_pinching = True
                    self._consecutive = 0
            else:
                self._consecutive = 0
        else:
            if dist > self._off:
                self._consecutive += 1
                if self._consecutive >= self._debounce:
                    self._is_pinching = False
                    self._consecutive = 0
            else:
                self._consecutive = 0

        return self._is_pinching

    @property
    def is_pinching(self) -> bool:
        return self._is_pinching


class GestureDetector:
    """Detect fist and open-palm with a dwell timer."""

    def __init__(self, cfg) -> None:
        self._dwell = cfg.gesture_dwell_seconds
        self._fist_start: Optional[float] = None
        self._palm_start: Optional[float] = None

    def update(self, lms: Optional[HandLandmarks]) -> GestureState:
        if lms is None:
            self._fist_start = None
            self._palm_start = None
            return GestureState.NONE

        # Measure finger curl: compare fingertip y to MCP y (image coords, y down)
        # For simplicity: index/middle/ring/pinky tips vs their MCP
        finger_tips = [8, 12, 16, 20]
        finger_mcps = [5, 9, 13, 17]
        norm = lms.norm

        # Curl = tip.y > mcp.y means finger is curled (y down in image)
        curls = [norm[tip, 1] > norm[mcp, 1] for tip, mcp in zip(finger_tips, finger_mcps)]
        n_curled = sum(curls)

        now = time.monotonic()

        if n_curled >= 4:  # fist
            if self._fist_start is None:
                self._fist_start = now
            self._palm_start = None
            if now - self._fist_start >= self._dwell:
                return GestureState.FIST
        elif n_curled == 0:  # open palm
            if self._palm_start is None:
                self._palm_start = now
            self._fist_start = None
            if now - self._palm_start >= self._dwell:
                return GestureState.OPEN_PALM
        else:
            self._fist_start = None
            self._palm_start = None

        return GestureState.NONE
