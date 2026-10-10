"""FormFlow application shell.

State machine:
    MENU  -> mode selected -> RAPID3D | MULTIVIEW -> Esc -> MENU -> Esc -> EXIT
"""

from __future__ import annotations

import logging
import time
from enum import Enum, auto
from pathlib import Path
from typing import Optional, Tuple

import cv2
import numpy as np

from formflow.capture.webcam import WebcamCapture
from formflow.config import Config
from formflow.hands.filters import OneEuroFilter2D
from formflow.hands.pinch import GestureDetector, GestureState, PinchDetector
from formflow.hands.tracker import HandTracker
from formflow.mode_multiview.session import MultiviewSession
from formflow.mode_rapid3d.session import Rapid3DSession
from formflow.pencil.state_machine import PencilState, PencilStateMachine
from formflow.strokes.store import StrokeStore
from formflow.ui.overlay import DwellButton, Overlay

log = logging.getLogger(__name__)

FONT = cv2.FONT_HERSHEY_SIMPLEX

WIN_NAME = "FormFlow"


# ─── App states ───────────────────────────────────────────────────────────────

class AppState(Enum):
    MENU = auto()
    RAPID3D = auto()
    MULTIVIEW = auto()
    EXIT = auto()


# ─── Menu renderer ────────────────────────────────────────────────────────────

def _draw_menu(frame: np.ndarray, selected: int = -1) -> None:
    h, w = frame.shape[:2]
    # Dim background
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, h), (12, 12, 22), -1)
    cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

    title = "FormFlow"
    cv2.putText(frame, title, (w // 2 - 130, h // 2 - 110),
                FONT, 1.8, (0, 220, 255), 3, cv2.LINE_AA)
    cv2.putText(frame, "Hand-Drawn 3D Reconstruction Studio",
                (w // 2 - 200, h // 2 - 65),
                FONT, 0.58, (180, 180, 190), 1, cv2.LINE_AA)

    items = [
        ("1", "Rapid 3D Sketching     [Air draw 3D polylines + Open3D]"),
        ("2", "Multi-View 2D to 3D     [Front/Top/Side -> Visual Hull Mesh]"),
        ("Q", "Quit Application"),
    ]
    for i, (key, label) in enumerate(items):
        y = h // 2 + 10 + i * 50
        color = (0, 220, 255) if i == selected else (230, 230, 230)
        cv2.rectangle(frame, (w // 2 - 240, y - 30), (w // 2 + 240, y + 10), (35, 35, 45), -1)
        cv2.rectangle(frame, (w // 2 - 240, y - 30), (w // 2 + 240, y + 10), (60, 60, 75), 1)
        cv2.putText(frame, f"[{key}]  {label}", (w // 2 - 220, y - 5),
                    FONT, 0.55, color, 1, cv2.LINE_AA)

    cv2.putText(frame, "Press 1 or 2 to choose a mode. Esc/Q to quit.",
                (w // 2 - 165, h - 35),
                FONT, 0.45, (120, 120, 130), 1, cv2.LINE_AA)


# ─── Main app loop ────────────────────────────────────────────────────────────

class App:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._state = AppState.MENU

        # Subsystems
        self._cam = WebcamCapture(cfg)
        self._tracker = HandTracker(cfg)
        self._filter = OneEuroFilter2D(cfg.one_euro_min_cutoff, cfg.one_euro_beta, cfg.one_euro_d_cutoff)
        self._pinch = PinchDetector(cfg)
        self._gesture = GestureDetector(cfg)
        self._pencil = PencilStateMachine()
        self._overlay = Overlay(cfg)

        # Per-mode sessions
        self._rapid3d: Optional[Rapid3DSession] = None
        self._multiview: Optional[MultiviewSession] = None

        # Active stroke store
        self._store: Optional[StrokeStore] = None

        # Wire pencil events
        self._pencil.on_stroke_start(self._on_stroke_start)
        self._pencil.on_point(self._on_point)
        self._pencil.on_stroke_end(self._on_stroke_end)

        # Cached cursors
        self._cursor_px: Optional[Tuple[float, float]] = None
        self._pencil_pos: Optional[Tuple[float, ...]] = None

        # Keyboard pencil toggle
        self._kbd_pencil_override = False

    # ── lifecycle ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        if not self._cam.start():
            log.error("Cannot open camera. Exiting.")
            return

        cv2.namedWindow(WIN_NAME, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(WIN_NAME, 1280, 720)
        cv2.setMouseCallback(WIN_NAME, self._mouse_dispatch)

        log.info("App started.")
        try:
            while self._state != AppState.EXIT:
                frame = self._cam.read()
                if frame is None:
                    cv2.waitKey(10)
                    continue

                key = cv2.waitKey(1) & 0xFF
                self._handle_global_keys(key)

                if self._state == AppState.MENU:
                    self._run_menu_frame(frame, key)
                elif self._state == AppState.RAPID3D:
                    self._run_rapid3d_frame(frame, key)
                elif self._state == AppState.MULTIVIEW:
                    self._run_multiview_frame(frame, key)

        finally:
            self._cam.stop()
            self._tracker.release()
            if self._rapid3d:
                self._rapid3d.stop_viewer()
            if self._multiview:
                self._multiview.viewer.stop()
            cv2.destroyAllWindows()
            self._cfg.save()
            log.info("App exited cleanly.")

    # ── mouse dispatcher ──────────────────────────────────────────────────────

    def _mouse_dispatch(self, event: int, x: int, y: int, flags: int, param: any) -> None:
        if self._state == AppState.MULTIVIEW and self._multiview:
            self._multiview.handle_mouse(event, x, y, flags, param)

    # ── frame handlers ────────────────────────────────────────────────────────

    def _run_menu_frame(self, frame: np.ndarray, key: int) -> None:
        _draw_menu(frame)
        cv2.imshow(WIN_NAME, frame)

        if key == ord("1"):
            self._enter_rapid3d()
        elif key == ord("2"):
            self._enter_multiview()
        elif key in (ord("q"), ord("Q"), 27):
            self._state = AppState.EXIT

    def _run_rapid3d_frame(self, frame: np.ndarray, key: int) -> None:
        assert self._rapid3d is not None

        # Start 3D visualizer if not already started
        self._rapid3d.start_viewer()

        # Track hand
        lms = self._tracker.process(frame)
        t = time.monotonic()

        # Filter fingertip
        if lms is not None:
            fx, fy = self._filter(lms.index_tip_px[0], lms.index_tip_px[1], t)
            self._cursor_px = (fx, fy)
            pt3d = self._rapid3d.map_cursor_to_3d((fx, fy), landmarks=lms)
            self._pencil_pos = pt3d
        else:
            self._cursor_px = None
            self._pencil_pos = None
            self._filter.reset()
            self._rapid3d.map_cursor_to_3d(None)

        # Pinch detection
        pinching = self._pinch.update(lms)
        if self._kbd_pencil_override:
            pinching = not pinching

        gesture = self._gesture.update(lms)
        if gesture == GestureState.FIST:
            self._rapid3d.store.undo()

        # Pencil state machine
        pencil_state = self._pencil.update(
            has_hand=lms is not None,
            is_pinching=pinching,
            pos=self._pencil_pos,
        )

        # Keys
        self._rapid3d.handle_key(key)
        self._handle_mode_keys(key)

        # Update Open3D viewer
        self._rapid3d.update_3d_view()

        # Render 2D overlays on frame
        self._overlay.render(
            frame,
            state=pencil_state,
            cursor=self._cursor_px,
            strokes=self._rapid3d.store.strokes,
            active_stroke=self._rapid3d.store.active_stroke,
            buttons=[],
            extra_text=None,
        )

        # Mode HUD
        self._rapid3d.draw_hud(frame)

        # Skeleton overlay
        if lms is not None and self._overlay._show_skeleton:
            self._tracker.draw_landmarks(frame, lms)

        cv2.imshow(WIN_NAME, frame)

    def _run_multiview_frame(self, frame: np.ndarray, key: int) -> None:
        assert self._multiview is not None

        # Track hand
        lms = self._tracker.process(frame)
        t = time.monotonic()

        # Filter fingertip
        canvas_pos = None
        if lms is not None:
            fx, fy = self._filter(lms.index_tip_px[0], lms.index_tip_px[1], t)
            self._cursor_px = (fx, fy)
            canvas_pos = self._multiview.map_camera_to_canvas((fx, fy), frame.shape[1], frame.shape[0])
            self._pencil_pos = canvas_pos
        else:
            self._cursor_px = None
            self._pencil_pos = None
            self._filter.reset()

        # Pinch detection
        pinching = self._pinch.update(lms)
        if self._kbd_pencil_override:
            pinching = not pinching

        gesture = self._gesture.update(lms)
        if gesture == GestureState.FIST:
            self._multiview.current_canvas.store.undo()

        # Pencil state machine updates active canvas
        self._store = self._multiview.current_canvas.store
        self._pencil.update(
            has_hand=(lms is not None and canvas_pos is not None),
            is_pinching=pinching,
            pos=canvas_pos,
        )

        # Handle Mode 2 keys
        self._multiview.handle_key(key)
        self._handle_mode_keys(key)

        # Update 3D viewer if mesh window is open
        self._multiview.update_3d_view()

        # Draw skeleton on raw webcam frame for mini preview
        if lms is not None and self._overlay._show_skeleton:
            self._tracker.draw_landmarks(frame, lms)

        # Assemble composite UI
        composite = self._multiview.render_composite(frame, canvas_pos)
        cv2.imshow(WIN_NAME, composite)

    # ── state transitions ─────────────────────────────────────────────────────

    def _enter_rapid3d(self) -> None:
        log.info("Entering Mode 1: Rapid 3D")
        self._rapid3d = Rapid3DSession(self._cfg)
        self._store = self._rapid3d.store
        self._filter.reset()
        self._state = AppState.RAPID3D

    def _enter_multiview(self) -> None:
        log.info("Entering Mode 2: Multi-view")
        self._multiview = MultiviewSession(self._cfg)
        self._store = self._multiview.current_canvas.store
        self._filter.reset()
        self._state = AppState.MULTIVIEW

    def _return_to_menu(self) -> None:
        log.info("Returning to menu.")
        self._pencil.update(False, False, None)
        if self._rapid3d:
            self._rapid3d.stop_viewer()
            self._rapid3d = None
        if self._multiview:
            self._multiview.viewer.stop()
            self._multiview = None
        self._store = None
        self._state = AppState.MENU

    # ── key handlers ─────────────────────────────────────────────────────────

    def _handle_global_keys(self, key: int) -> None:
        if key == 255 or key < 0:
            return
        if key == 27:  # Esc
            if self._state in (AppState.RAPID3D, AppState.MULTIVIEW):
                self._return_to_menu()
            elif self._state == AppState.MENU:
                self._state = AppState.EXIT

    def _handle_mode_keys(self, key: int) -> None:
        if key < 0 or key == 255:
            return

        k = chr(key & 0xFF).lower()
        if k == " ":
            self._kbd_pencil_override = not self._kbd_pencil_override
            log.debug("Keyboard pencil override: %s", self._kbd_pencil_override)
        elif k == "h":
            self._overlay.toggle_skeleton()

    # ── pencil event handlers ────────────────────────────────────────────────

    def _on_stroke_start(self, pos) -> None:
        if self._store and pos is not None:
            self._store.start_stroke(pos)

    def _on_point(self, pos) -> None:
        if self._store and pos is not None:
            self._store.add_point(pos)

    def _on_stroke_end(self) -> None:
        if self._store:
            self._store.end_stroke()
            if self._state == AppState.MULTIVIEW and self._multiview:
                self._multiview._update_silhouettes()


# ─── Entry point ──────────────────────────────────────────────────────────────

def main() -> None:
    _setup_logging()
    cfg = Config.load()
    app = App(cfg)
    app.run()


def _setup_logging() -> None:
    log_dir = Path(__file__).parent.parent.parent / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "formflow.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)-7s] %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(log_file, encoding="utf-8"),
        ],
    )
    logging.getLogger("mediapipe").setLevel(logging.WARNING)
    logging.getLogger("absl").setLevel(logging.WARNING)
