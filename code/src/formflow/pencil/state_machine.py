"""Virtual pencil state machine.

States:
    NO_HAND  — tracker returns None
    HOVER    — hand present, not pinching
    DRAWING  — hand present, pinching
"""

from __future__ import annotations

import logging
from enum import Enum, auto
from typing import Callable, Optional

log = logging.getLogger(__name__)


class PencilState(Enum):
    NO_HAND = auto()
    HOVER = auto()
    DRAWING = auto()


class PencilStateMachine:
    """Emit events: stroke_start, point, stroke_end.

    Callers register handlers for each event type.
    """

    def __init__(self) -> None:
        self._state = PencilState.NO_HAND
        self._on_start: list[Callable] = []
        self._on_point: list[Callable] = []
        self._on_end: list[Callable] = []

    # ------------------------------------------------------------------
    def on_stroke_start(self, fn: Callable) -> None:
        self._on_start.append(fn)

    def on_point(self, fn: Callable) -> None:
        self._on_point.append(fn)

    def on_stroke_end(self, fn: Callable) -> None:
        self._on_end.append(fn)

    # ------------------------------------------------------------------
    def update(
        self,
        has_hand: bool,
        is_pinching: bool,
        pos: Optional[tuple[float, float]],
    ) -> PencilState:
        prev = self._state

        if not has_hand:
            if prev == PencilState.DRAWING:
                self._emit_end()
            self._state = PencilState.NO_HAND
        elif not is_pinching:
            if prev == PencilState.DRAWING:
                self._emit_end()
            self._state = PencilState.HOVER
        else:  # has_hand and pinching
            if prev != PencilState.DRAWING:
                self._state = PencilState.DRAWING
                self._emit_start(pos)
            else:
                if pos is not None:
                    self._emit_point(pos)

        return self._state

    @property
    def state(self) -> PencilState:
        return self._state

    # ------------------------------------------------------------------
    def _emit_start(self, pos):
        for fn in self._on_start:
            fn(pos)

    def _emit_point(self, pos):
        for fn in self._on_point:
            fn(pos)

    def _emit_end(self):
        for fn in self._on_end:
            fn()
