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

def _draw_menu(frame: np.ndarray, selected: int = -1) -> list:
    """Draw the menu; return [(key_code, (x, y, w, h))] for clickable items."""
    rects = []
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
        rects.append((ord(key.lower()), (w // 2 - 240, y - 30, 480, 40)))
        color = (0, 220, 255) if i == selected else (230, 230, 230)
        cv2.rectangle(frame, (w // 2 - 240, y - 30), (w // 2 + 240, y + 10), (35, 35, 45), -1)
        cv2.rectangle(frame, (w // 2 - 240, y - 30), (w // 2 + 240, y + 10), (60, 60, 75), 1)
        cv2.putText(frame, f"[{key}]  {label}", (w // 2 - 220, y - 5),
                    FONT, 0.55, color, 1, cv2.LINE_AA)

    cv2.putText(frame, "Press 1 or 2 to choose a mode. Esc/Q to quit.",
                (w // 2 - 165, h - 35),
                FONT, 0.45, (120, 120, 130), 1, cv2.LINE_AA)
    return rects


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

        # On-screen camera switch button (x, y, w, h) in displayed-image coords
        self._cam_btn: Tuple[int, int, int, int] = (0, 0, 0, 0)
        self._btns: list = []           # [(key_code, (x, y, w, h))] clickable this frame
        self._pending_key = -1          # key injected by a button click
        self._key_queue: list = []      # keys waiting for the next camera frame
        self._hover_xy = (-1, -1)
        self._o3d_rect = (0, 0, 0, 0)   # embedded 3D panel (x, y, w, h)
        self._o3d_viewer = None         # viewer whose panel is shown / dragged
        self._drag_last = None
        self._o3d_pic = None            # last captured 3D render
        self._o3d_pic_t = 0.0
        self._cam_msg_until = 0.0
        self._cam_msg = ""

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
                # Poll keys every iteration; reading them only when a frame arrived dropped keypresses
                key = cv2.waitKey(1) & 0xFF
                if key == 255 and self._pending_key >= 0:
                    key = self._pending_key
                self._pending_key = -1
                if key != 255:
                    self._key_queue.append(key)

                frame = self._cam.read()
                if frame is None:
                    continue

                key = self._key_queue.pop(0) if self._key_queue else 255
                if key == 27:
                    # Esc: leave the current mode, or quit from the menu. Consume it so the
                    # menu handler doesn't see the same Esc and exit the app.
                    self._handle_global_keys(key)
                    key = 255
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
        self._hover_xy = (x, y)
        ox, oy, ow, oh = self._o3d_rect
        in_panel = self._o3d_viewer is not None and ox <= x <= ox + ow and oy <= y <= oy + oh
        if event == cv2.EVENT_LBUTTONDOWN and in_panel:
            self._drag_last = (x, y)
            return
        if event == cv2.EVENT_MOUSEMOVE and self._drag_last is not None and (flags & cv2.EVENT_FLAG_LBUTTON):
            self._o3d_viewer.orbit(float(x - self._drag_last[0]), float(y - self._drag_last[1]))
            self._drag_last = (x, y)
            return
        if event == cv2.EVENT_LBUTTONUP:
            self._drag_last = None
        if event == cv2.EVENT_LBUTTONDOWN:
            bx, by, bw, bh = self._cam_btn
            if bx <= x <= bx + bw and by <= y <= by + bh:
                self._switch_camera()
                return
            for code, (rx, ry, rw, rh) in self._btns:
                if rx <= x <= rx + rw and ry <= y <= ry + rh:
                    self._pending_key = code
                    return
        if self._state == AppState.MULTIVIEW and self._multiview:
            self._multiview.handle_mouse(event, x, y, flags, param)

    # ── camera switching ──────────────────────────────────────────────────────

    def _switch_camera(self) -> None:
        ok = self._cam.switch_next()
        self._filter.reset()
        idx = self._cfg.camera_index
        self._cam_msg = f"Camera {idx}" if ok else f"No other camera (using {idx})"
        self._cam_msg_until = time.monotonic() + 2.0
        log.info("Camera switch -> index %d (%s)", idx, "ok" if ok else "no alternative")

    def _draw_button_bar(self, img: np.ndarray, specs: list, y: int) -> None:
        """Draw a row of clickable buttons: specs = [(label, key_code)]."""
        h, w = img.shape[:2]
        gap, bh = 6, 28
        widths = [max(46, 14 + 9 * len(lbl)) for lbl, _ in specs]
        x = max(8, (w - (sum(widths) + gap * (len(specs) - 1))) // 2)
        hx, hy = self._hover_xy
        for (lbl, code), bw in zip(specs, widths):
            hot = x <= hx <= x + bw and y <= hy <= y + bh
            cv2.rectangle(img, (x, y), (x + bw, y + bh), (70, 70, 90) if hot else (40, 40, 50), -1)
            cv2.rectangle(img, (x, y), (x + bw, y + bh), (0, 220, 255) if hot else (90, 90, 105), 1)
            cv2.putText(img, lbl, (x + 7, y + 19), FONT, 0.45, (235, 235, 235), 1, cv2.LINE_AA)
            self._btns.append((code, (x, y, bw, bh)))
            x += bw + gap

    def _draw_3d_panel(self, img: np.ndarray, viewer, rect, label: str, placeholder: str) -> None:
        """Embed the Open3D render into the main window at rect=(x, y, w, h)."""
        x, y, w, h = rect
        self._o3d_rect, self._o3d_viewer = rect, viewer
        pic = None
        if viewer is not None:
            # Capturing the GL framebuffer is costly: refresh at ~15 fps, reuse the last image between
            now = time.monotonic()
            if self._o3d_pic is None or now - self._o3d_pic_t >= 1 / 15 or self._drag_last is not None:
                self._o3d_pic, self._o3d_pic_t = viewer.render_image(), now
            pic = self._o3d_pic
        if pic is not None:
            img[y:y + h, x:x + w] = cv2.resize(pic, (w, h), interpolation=cv2.INTER_AREA)
        else:
            cv2.rectangle(img, (x, y), (x + w, y + h), (22, 22, 28), -1)
            cv2.putText(img, placeholder, (x + 10, y + h // 2), FONT, 0.45, (140, 140, 150), 1, cv2.LINE_AA)
        cv2.rectangle(img, (x, y), (x + w, y + h), (0, 220, 255), 1)
        cv2.putText(img, f"{label} (drag to rotate)", (x + 6, y + 16), FONT, 0.42, (0, 220, 255), 1, cv2.LINE_AA)

    def _draw_cam_button(self, img: np.ndarray) -> None:
        h, w = img.shape[:2]
        bw, bh = 170, 30
        x, y = w - bw - 12, 10
        self._cam_btn = (x, y, bw, bh)
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (40, 40, 50), -1)
        cv2.rectangle(img, (x, y), (x + bw, y + bh), (0, 220, 255), 1)
        cv2.putText(img, f"Camera {self._cfg.camera_index}  [N] switch", (x + 8, y + 20),
                    FONT, 0.45, (230, 230, 230), 1, cv2.LINE_AA)
        if time.monotonic() < self._cam_msg_until:
            cv2.putText(img, self._cam_msg, (x, y + bh + 20), FONT, 0.5, (0, 220, 255), 1, cv2.LINE_AA)

    # ── frame handlers ────────────────────────────────────────────────────────

    def _run_menu_frame(self, frame: np.ndarray, key: int) -> None:
        self._btns = _draw_menu(frame)
        self._draw_cam_button(frame)
        cv2.imshow(WIN_NAME, frame)

        if key == ord("1"):
            self._enter_rapid3d()
        elif key == ord("2"):
            self._enter_multiview()
        elif key in (ord("n"), ord("N")):
            self._switch_camera()
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
            pinching = True

        gesture = self._gesture.update(lms)
        if gesture == GestureState.FIST and not pinching:
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
        if lms is not None and self._overlay.show_skeleton:
            self._tracker.draw_landmarks(frame, lms)

        fh, fw = frame.shape[:2]
        v = self._rapid3d.viewer if self._rapid3d.viewer_started else None
        self._draw_3d_panel(frame, v, (fw - 372, 80, 360, 270), "3D View", "Starting 3D view...")
        self._btns = []
        self._draw_button_bar(frame, [
            ("Depth-", ord("[")), ("Depth+", ord("]")), ("Depth mode", ord("m")),
            ("Front", ord("f")), ("Top", ord("t")), ("Side", ord("s")), ("Iso", ord("i")),
            ("Orbit<", ord("j")), ("Orbit>", ord("l")),
            ("Undo", ord("z")), ("Redo", ord("y")), ("Clear", ord("c")),
            ("Export", ord("e")), ("Menu", 27),
        ], frame.shape[0] - 70)
        self._draw_cam_button(frame)
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
            pinching = True

        gesture = self._gesture.update(lms)
        if gesture == GestureState.FIST and not pinching:
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
        if lms is not None and self._overlay.show_skeleton:
            self._tracker.draw_landmarks(frame, lms)

        # Assemble composite UI
        composite = self._multiview.render_composite(frame, canvas_pos)
        mv = self._multiview
        self._draw_3d_panel(composite, mv.viewer if mv.viewer_started else None,
                            (958, 98, 310, 220), "3D Model", "Press R to reconstruct")
        self._btns = []
        self._draw_button_bar(composite, [
            ("Front", ord("f")), ("Top", ord("t")), ("Side", ord("s")),
            ("Reconstruct", ord("r")), ("Export", ord("e")), ("Save", ord("p")),
            ("Undo", ord("z")), ("Redo", ord("y")), ("Clear", ord("c")),
            ("Grid", ord("g")), ("Menu", 27),
        ], composite.shape[0] - 72)
        self._draw_cam_button(composite)
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
        self._o3d_viewer = None
        self._drag_last = None
        self._o3d_pic = None
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
        elif k == "n":
            self._switch_camera()
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
                self._multiview.update_silhouettes()


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
