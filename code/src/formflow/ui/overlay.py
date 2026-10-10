"""OpenCV overlay UI: draws strokes, cursor, status, FPS, dwell buttons."""

from __future__ import annotations

import time
from typing import Callable, Optional

import cv2
import numpy as np

from formflow.pencil.state_machine import PencilState

# ─── colour palette ────────────────────────────────────────────────────────────
C_STROKE   = (0, 220, 255)   # cyan-yellow
C_ACTIVE   = (0, 255, 180)
C_CURSOR_H = (200, 200, 200)
C_CURSOR_D = (0, 200, 255)
C_TEXT     = (240, 240, 240)
C_HINT     = (160, 160, 160)
C_WARN     = (0, 80, 255)
C_OK       = (0, 200, 80)
C_BTN_BG   = (40, 40, 40)
C_BTN_HL   = (60, 160, 240)

FONT = cv2.FONT_HERSHEY_SIMPLEX


def _put(frame, text, pos, color=C_TEXT, scale=0.55, thickness=1):
    cv2.putText(frame, text, pos, FONT, scale, color, thickness, cv2.LINE_AA)


# ─── DwellButton ──────────────────────────────────────────────────────────────

class DwellButton:
    """On-screen button activated by hovering for `dwell_sec` seconds."""

    def __init__(self, label: str, rect: tuple[int, int, int, int],
                 dwell_sec: float = 0.8, callback: Optional[Callable] = None) -> None:
        self.label = label
        self.rect = rect          # (x, y, w, h)
        self.dwell_sec = dwell_sec
        self.callback = callback
        self._hover_start: Optional[float] = None
        self._fired = False

    def update(self, cursor: Optional[tuple[float, float]]) -> bool:
        """Returns True when the button fires (once per hover)."""
        x, y, w, h = self.rect
        inside = (cursor is not None and
                  x <= cursor[0] <= x + w and y <= cursor[1] <= y + h)
        now = time.monotonic()
        if inside:
            if self._hover_start is None:
                self._hover_start = now
                self._fired = False
            elif not self._fired and now - self._hover_start >= self.dwell_sec:
                self._fired = True
                if self.callback:
                    self.callback()
                return True
        else:
            self._hover_start = None
            self._fired = False
        return False

    def draw(self, frame: np.ndarray, cursor: Optional[tuple[float, float]]) -> None:
        x, y, w, h = self.rect
        now = time.monotonic()
        progress = 0.0
        if self._hover_start is not None:
            progress = min(1.0, (now - self._hover_start) / self.dwell_sec)

        cv2.rectangle(frame, (x, y), (x + w, y + h), C_BTN_BG, -1)
        cv2.rectangle(frame, (x, y), (x + w, y + h), C_BTN_HL if progress > 0 else C_TEXT, 1)

        # Progress bar
        if progress > 0:
            bar_w = int(w * progress)
            cv2.rectangle(frame, (x, y + h - 4), (x + bar_w, y + h), C_BTN_HL, -1)

        _put(frame, self.label, (x + 6, y + h // 2 + 5), C_TEXT, scale=0.45)


# ─── Overlay ──────────────────────────────────────────────────────────────────

class Overlay:
    """Renders all 2-D UI elements onto a camera frame."""

    def __init__(self, cfg) -> None:
        self._cfg = cfg
        self._fps_times: list[float] = []
        self._show_skeleton = True

    def render(
        self,
        frame: np.ndarray,
        state: PencilState,
        cursor: Optional[tuple[float, float]],
        strokes,                         # list[Stroke]
        active_stroke,                   # Optional[Stroke]
        buttons: list[DwellButton],
        extra_text: Optional[str] = None,
    ) -> None:
        # FPS
        now = time.monotonic()
        self._fps_times.append(now)
        self._fps_times = [t for t in self._fps_times if now - t < 1.0]
        fps = len(self._fps_times)

        # ── draw committed strokes ──────────────────────────────────────
        for stroke in strokes:
            if len(stroke.points) >= 2:
                pts = np.array(stroke.points, dtype=np.int32)
                cv2.polylines(frame, [pts], False, C_STROKE, 2, cv2.LINE_AA)

        # ── draw active stroke ──────────────────────────────────────────
        if active_stroke and len(active_stroke.points) >= 2:
            pts = np.array(active_stroke.points, dtype=np.int32)
            cv2.polylines(frame, [pts], False, C_ACTIVE, 2, cv2.LINE_AA)

        # ── cursor ──────────────────────────────────────────────────────
        if cursor:
            cx, cy = int(cursor[0]), int(cursor[1])
            color = C_CURSOR_D if state == PencilState.DRAWING else C_CURSOR_H
            cv2.circle(frame, (cx, cy), 10, color, 2, cv2.LINE_AA)
            cv2.circle(frame, (cx, cy), 2, color, -1)

        # ── status bar (bottom-left) ────────────────────────────────────
        h, w = frame.shape[:2]
        state_labels = {
            PencilState.NO_HAND: ("NO HAND", C_WARN),
            PencilState.HOVER:   ("HOVER",   C_TEXT),
            PencilState.DRAWING: ("DRAWING", C_OK),
        }
        label, lcolor = state_labels[state]
        _put(frame, label, (12, h - 36), lcolor, scale=0.6, thickness=1)
        _put(frame, f"FPS: {fps}", (12, h - 14), C_HINT, scale=0.45)

        # ── buttons ─────────────────────────────────────────────────────
        for btn in buttons:
            btn.draw(frame, cursor)

        # ── extra text ──────────────────────────────────────────────────
        if extra_text:
            _put(frame, extra_text, (12, 30), C_TEXT, scale=0.55)

        # ── hint (top-right) ────────────────────────────────────────────
        _put(frame, "Z=undo  C=clear  Esc=menu", (w - 260, h - 14), C_HINT, scale=0.4)

    def toggle_skeleton(self) -> None:
        self._show_skeleton = not self._show_skeleton
