"""Mode 1 - Rapid 3D Prototyping session implementation."""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Optional, Tuple
import cv2
import numpy as np

from formflow.config import Config
from formflow.export.obj import export_strokes_to_obj
from formflow.mode_rapid3d.mapping import (
    DepthSource,
    HandScaleDepth,
    LandmarkZDepth,
    PlaneDepth,
    WorkspaceMapper,
)
from formflow.mode_rapid3d.render import create_cursor_sphere, strokes_to_lineset
from formflow.strokes.store import StrokeStore
from formflow.viewer.o3d_viewer import O3DViewer

log = logging.getLogger(__name__)


class Rapid3DSession:
    """Mode 1 session managing 3D air sketching, Open3D visualizer, depth and export."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.store = StrokeStore(
            smoothing_window=cfg.smoothing_window,
            min_spacing_px=cfg.min_point_spacing_px,
            outlier_jump_px=cfg.outlier_jump_px,
        )

        # Depth sources
        self.plane_depth = PlaneDepth(0.0, step=0.05)
        self.hand_depth = HandScaleDepth()
        self.landmark_depth = LandmarkZDepth()
        self.depth_modes = ["plane", "hand_scale", "landmark_z"]
        self.depth_mode_idx = 0

        self.mapper = WorkspaceMapper(
            frame_width=cfg.camera_width,
            frame_height=cfg.camera_height,
            depth_source=self.plane_depth,
            margin=0.08,
        )

        # 3D Viewer
        self.viewer = O3DViewer(window_name="FormFlow - Rapid 3D View")
        self.viewer_started = False
        self._last_stroke_count = -1
        self._last_active_len = -1
        self._current_pos_3d: Optional[Tuple[float, float, float]] = None
        self._export_status_msg: Optional[str] = None
        self._export_status_time: float = 0.0

    def start_viewer(self) -> bool:
        if not self.viewer_started:
            self.viewer_started = self.viewer.start()
        return self.viewer_started

    def stop_viewer(self) -> None:
        if self.viewer_started:
            self.viewer.stop()
            self.viewer_started = False

    def get_current_depth_source(self) -> DepthSource:
        name = self.depth_modes[self.depth_mode_idx]
        if name == "hand_scale":
            return self.hand_depth
        elif name == "landmark_z":
            return self.landmark_depth
        return self.plane_depth

    def cycle_depth_mode(self) -> str:
        self.depth_mode_idx = (self.depth_mode_idx + 1) % len(self.depth_modes)
        current = self.get_current_depth_source()
        self.mapper.depth_source = current
        mode_name = self.depth_modes[self.depth_mode_idx]
        log.info("Switched depth mode to: %s", mode_name)
        return mode_name

    def adjust_plane_depth(self, delta: float) -> float:
        d = self.plane_depth.adjust(delta)
        log.debug("Adjusted plane depth to %.2f", d)
        return d

    def map_cursor_to_3d(
        self,
        cursor_px: Optional[Tuple[float, float]],
        landmarks=None,
    ) -> Optional[Tuple[float, float, float]]:
        if cursor_px is None:
            self._current_pos_3d = None
            return None
        pt3d = self.mapper.map_point(cursor_px[0], cursor_px[1], landmarks=landmarks)
        self._current_pos_3d = pt3d
        return pt3d

    def update_3d_view(self) -> None:
        """Update Open3D geometry and process window events."""
        if not self.viewer_started:
            return

        # Check if strokes or active stroke changed
        curr_count = len(self.store.strokes)
        active_len = len(self.store.active_stroke.points) if self.store.active_stroke else 0

        if curr_count != self._last_stroke_count or active_len != self._last_active_len:
            lineset = strokes_to_lineset(self.store.strokes, self.store.active_stroke)
            if lineset is not None:
                self.viewer.add_geometry("strokes", lineset)
            self._last_stroke_count = curr_count
            self._last_active_len = active_len

        # Update cursor sphere
        if self._current_pos_3d is not None:
            sphere = create_cursor_sphere(self._current_pos_3d, radius=0.035)
            if sphere is not None:
                self.viewer.add_geometry("cursor", sphere)
        else:
            self.viewer.remove_geometry("cursor")

        # Step Open3D events
        if not self.viewer.step():
            self.viewer_started = False

    def handle_key(self, key: int) -> bool:
        """Handle Mode 1 specific key inputs. Returns True if handled."""
        if key < 0 or key == 255:
            return False

        k = chr(key & 0xFF).lower()
        if k in ("[", "-"):
            self.adjust_plane_depth(-0.05)
            return True
        elif k in ("]", "=", "+"):
            self.adjust_plane_depth(0.05)
            return True
        elif k == "m":
            self.cycle_depth_mode()
            return True
        elif k == "e":
            self.export_obj()
            return True
        elif k == "f":
            self.viewer.reset_view("front")
            return True
        elif k == "t":
            self.viewer.reset_view("top")
            return True
        elif k == "s":
            self.viewer.reset_view("side")
            return True
        elif k == "i":
            self.viewer.reset_view("iso")
            return True
        elif k == "j":  # Orbit left
            self.viewer.orbit(-20.0, 0.0)
            return True
        elif k == "l":  # Orbit right
            self.viewer.orbit(20.0, 0.0)
            return True
        elif k == "k":  # Orbit down
            self.viewer.orbit(0.0, 20.0)
            return True
        elif k == "i" and (key & 0xFF) != ord("i"):
            self.viewer.orbit(0.0, -20.0)
            return True

        return False

    def export_obj(self) -> Optional[Path]:
        """Export current strokes to timestamped OBJ polyline file."""
        all_strokes = self.store.all_strokes()
        if not all_strokes:
            self._export_status_msg = "Nothing to export (canvas empty)"
            self._export_status_time = time.monotonic()
            return None

        export_dir = Path("exports")
        export_dir.mkdir(parents=True, exist_ok=True)
        filename = f"sketch_{int(time.time())}.obj"
        out_path = export_dir / filename

        success = export_strokes_to_obj(all_strokes, out_path)
        if success:
            self._export_status_msg = f"Exported: {filename}"
        else:
            self._export_status_msg = "Export failed"
        self._export_status_time = time.monotonic()
        return out_path if success else None

    def draw_hud(self, frame: np.ndarray) -> None:
        """Render Rapid 3D HUD onto the 2D OpenCV frame."""
        h, w = frame.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX

        # Top banner
        mode_name = self.depth_modes[self.depth_mode_idx]
        current_depth = self.get_current_depth_source().get_depth()

        # Workspace draw boundary box
        m = self.mapper.margin
        x1, y1 = int(w * m), int(h * m)
        x2, y2 = int(w * (1.0 - m)), int(h * (1.0 - m))
        cv2.rectangle(frame, (x1, y1), (x2, y2), (60, 60, 60), 1, cv2.LINE_AA)

        # Mode & Depth status badge
        badge_text = f"Mode 1: Rapid 3D | Depth Mode: {mode_name.upper()} | Depth Z: {current_depth:+.2f}"
        cv2.putText(frame, badge_text, (20, 35), font, 0.55, (0, 220, 255), 1, cv2.LINE_AA)

        # 3D coordinates readout
        if self._current_pos_3d is not None:
            cx, cy, cz = self._current_pos_3d
            coord_text = f"3D Fingertip: X:{cx:+.2f} Y:{cy:+.2f} Z:{cz:+.2f}"
            cv2.putText(frame, coord_text, (20, 60), font, 0.50, (180, 255, 100), 1, cv2.LINE_AA)

        # Controls banner at bottom
        controls = "[ / ]: Depth plane  |  M: Depth Mode  |  F/T/S/I: Views  |  J/L: Orbit  |  E: Export OBJ  |  Esc: Menu"
        cv2.putText(frame, controls, (20, h - 15), font, 0.42, (180, 180, 180), 1, cv2.LINE_AA)

        # Export notification flash
        if self._export_status_msg and (time.monotonic() - self._export_status_time < 3.5):
            cv2.putText(frame, self._export_status_msg, (w // 2 - 120, 65), font, 0.65, (0, 255, 120), 2, cv2.LINE_AA)
