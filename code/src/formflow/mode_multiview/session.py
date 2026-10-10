"""Mode 2 - Multi-view 2D to 3D orthographic sketching and reconstruction session."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np

from formflow.align.consistency import ViewDisagreement
from formflow.align.normalize import AlignedViews, normalize_and_align_views
from formflow.config import Config
from formflow.cv_process.silhouette import SilhouetteInfo, process_silhouette
from formflow.export.obj import export_mesh_to_obj
from formflow.export.project_io import load_project, save_project
from formflow.export.stl import export_mesh_to_stl
from formflow.mode_multiview.canvas import ViewCanvas
from formflow.reconstruct.hull import HullResult, reconstruct_visual_hull
from formflow.reconstruct.mesh import MeshResult, extract_mesh_from_hull
from formflow.viewer.o3d_viewer import O3DViewer

log = logging.getLogger(__name__)


class MultiviewSession:
    """Manages 3-view orthographic drawing, CV silhouette extraction, alignment,

    visual hull reconstruction, and mesh inspection.
    """

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.canvas_size = cfg.canvas_size

        # Three view canvases
        self.canvases: Dict[str, ViewCanvas] = {
            "front": ViewCanvas(
                name="front",
                axis_labels=("X", "Y"),
                size=self.canvas_size,
                brush_thickness=cfg.brush_thickness_px,
                smoothing_window=cfg.smoothing_window,
            ),
            "top": ViewCanvas(
                name="top",
                axis_labels=("X", "Z"),
                size=self.canvas_size,
                brush_thickness=cfg.brush_thickness_px,
                smoothing_window=cfg.smoothing_window,
            ),
            "side": ViewCanvas(
                name="side",
                axis_labels=("Z", "Y"),
                size=self.canvas_size,
                brush_thickness=cfg.brush_thickness_px,
                smoothing_window=cfg.smoothing_window,
            ),
        }

        self.active_view = "front"

        # Silhouette extraction results
        self.silhouettes: Dict[str, Optional[SilhouetteInfo]] = {
            "front": None,
            "top": None,
            "side": None,
        }

        # Alignment and reconstruction results
        self.aligned: Optional[AlignedViews] = None
        self.hull_result: Optional[HullResult] = None
        self.mesh_result: Optional[MeshResult] = None
        self.disagreements: List[ViewDisagreement] = []

        # 3D Viewer
        self.viewer = O3DViewer(window_name="FormFlow - Reconstructed 3D Mesh", width=480, height=360, visible=False)
        self.viewer_started = False
        self._mesh_dirty = False

        # Status and notifications
        self.status_message = "Step 1: Draw FRONT view outline"
        self.notification: Optional[str] = None
        self.notification_time = 0.0
        self.is_reconstructing = False
        self._reconstruct_lock = threading.Lock()

        # Canvas screen bounds on composite window (for mouse & cursor mapping)
        self.canvas_rect = (40, 100, 512, 512)  # x, y, w, h
        self.preview_rects: Dict[str, Tuple[int, int, int, int]] = {}

        # Grid toggle
        self.show_grid = True

        # Mouse drawing state
        self._mouse_drawing = False

    @property
    def current_canvas(self) -> ViewCanvas:
        return self.canvases[self.active_view]

    def set_active_view(self, view_name: str) -> None:
        if view_name.lower() in self.canvases:
            self.active_view = view_name.lower()
            self.set_notification(f"Switched to {self.active_view.upper()} view")

    def toggle_grid(self) -> None:
        self.show_grid = not self.show_grid

    def set_notification(self, msg: str, duration: float = 3.5) -> None:
        self.notification = msg
        self.notification_time = time.monotonic() + duration

    def map_camera_to_canvas(
        self,
        cursor_px: Optional[Tuple[float, float]],
        frame_w: int,
        frame_h: int,
        margin: float = 0.15,
    ) -> Optional[Tuple[float, float]]:
        """Map camera coordinate to the active canvas [0, canvas_size-1]."""
        if cursor_px is None:
            return None
        u, v = cursor_px
        x_min = frame_w * margin
        x_max = frame_w * (1.0 - margin)
        y_min = frame_h * margin
        y_max = frame_h * (1.0 - margin)

        norm_x = (u - x_min) / max(1e-5, (x_max - x_min))
        norm_y = (v - y_min) / max(1e-5, (y_max - y_min))

        if not (0.0 <= norm_x <= 1.0 and 0.0 <= norm_y <= 1.0):
            # Outside drawing bounds
            return None

        cx = norm_x * (self.canvas_size - 1)
        cy = norm_y * (self.canvas_size - 1)
        return (float(cx), float(cy))

    def handle_mouse(self, event: int, x: int, y: int, flags: int, param: any) -> None:
        """Allow drawing directly on the composite window using mouse."""
        cx, cy, cw, ch = self.canvas_rect
        in_canvas = (cx <= x < cx + cw) and (cy <= y < cy + ch)

        # Check thumbnail clicks to switch views
        if event == cv2.EVENT_LBUTTONDOWN:
            for v_name, (tx, ty, tw, th) in self.preview_rects.items():
                if tx <= x < tx + tw and ty <= y < ty + th:
                    self.set_active_view(v_name)
                    return

        if in_canvas:
            local_x = float(x - cx)
            local_y = float(y - cy)
            if event == cv2.EVENT_LBUTTONDOWN:
                self._mouse_drawing = True
                self.current_canvas.start_stroke((local_x, local_y))
            elif event == cv2.EVENT_MOUSEMOVE and self._mouse_drawing:
                self.current_canvas.add_point((local_x, local_y))
            elif event == cv2.EVENT_LBUTTONUP and self._mouse_drawing:
                self._mouse_drawing = False
                self.current_canvas.end_stroke()
                self._update_silhouettes()
        else:
            if self._mouse_drawing and event in (cv2.EVENT_LBUTTONUP, cv2.EVENT_MOUSEMOVE):
                self._mouse_drawing = False
                self.current_canvas.end_stroke()
                self._update_silhouettes()

    def handle_key(self, key: int) -> bool:
        """Handle keyboard shortcuts."""
        if key < 0 or key == 255:
            return False

        k = chr(key & 0xFF).lower()
        if k == "f":
            self.set_active_view("front")
            return True
        elif k == "t":
            self.set_active_view("top")
            return True
        elif k == "s":
            self.set_active_view("side")
            return True
        elif k == "g":
            self.toggle_grid()
            return True
        elif k == "r":
            self.trigger_reconstruction()
            return True
        elif k == "e":
            self.export_models()
            return True
        elif k == "p":
            self.save_project_file()
            return True
        elif k == "z":
            self.current_canvas.store.undo()
            self._update_silhouettes()
            return True
        elif k == "y":
            self.current_canvas.store.redo()
            self._update_silhouettes()
            return True
        elif k == "c":
            self.current_canvas.store.clear()
            self._update_silhouettes()
            return True

        return False

    def update_silhouettes(self) -> None:
        self._update_silhouettes()

    def _update_silhouettes(self) -> None:
        """Re-extract silhouette for all non-empty canvases."""
        for name, canvas in self.canvases.items():
            if not canvas.is_empty():
                raster = canvas.rasterize()
                self.silhouettes[name] = process_silhouette(
                    raster,
                    base_kernel_size=self.cfg.gap_close_kernel_px,
                )
            else:
                self.silhouettes[name] = None

    def trigger_reconstruction(self) -> None:
        """Run silhouette processing, alignment, and visual hull reconstruction."""
        if self.is_reconstructing:
            return

        self._update_silhouettes()

        # Check if all views have closed silhouettes
        missing = [name.upper() for name, s in self.silhouettes.items() if s is None or not s.is_closed]
        if missing:
            msg = f"Cannot reconstruct: {', '.join(missing)} view outline not closed!"
            self.set_notification(msg, duration=4.0)
            log.warning(msg)
            return

        def _worker():
            with self._reconstruct_lock:
                self.is_reconstructing = True
                self.set_notification("Reconstructing 3D visual hull...", duration=10.0)
                try:
                    f_info = self.silhouettes["front"]
                    t_info = self.silhouettes["top"]
                    s_info = self.silhouettes["side"]

                    # 1. Align and normalize
                    self.aligned = normalize_and_align_views(
                        f_info, t_info, s_info,
                        grid_size=self.cfg.voxel_grid_size,
                        threshold_pct=self.cfg.mismatch_threshold_pct,
                    )
                    self.disagreements = self.aligned.disagreements

                    # 2. Visual hull reconstruction
                    self.hull_result = reconstruct_visual_hull(self.aligned)

                    # 3. Marching cubes mesh extraction
                    if not self.hull_result.is_empty:
                        self.mesh_result = extract_mesh_from_hull(self.hull_result)
                        self._mesh_dirty = True  # applied on the main thread
                        status = f"Reconstructed {self.mesh_result.triangle_count} faces! Watertight: {'Yes' if self.mesh_result.is_watertight else 'No'}"
                        self.set_notification(status, duration=5.0)
                    else:
                        self.set_notification("Reconstruction failed: empty visual hull.", duration=4.0)

                except Exception as e:
                    log.error("Reconstruction error: %s", e, exc_info=True)
                    self.set_notification(f"Reconstruction error: {e}", duration=4.0)
                finally:
                    self.is_reconstructing = False

        thread = threading.Thread(target=_worker, daemon=True)
        thread.start()

    def _update_viewer_mesh(self) -> None:
        """Load or update the mesh in Open3D visualizer."""
        if self.mesh_result is None or self.mesh_result.mesh is None:
            return

        if not self.viewer_started:
            self.viewer_started = self.viewer.start()

        if self.viewer_started:
            self.viewer.clear_dynamic_geometries()
            self.viewer.add_geometry("mesh", self.mesh_result.mesh)

    def update_3d_view(self) -> None:
        """Apply any pending mesh and step Open3D."""
        if self._mesh_dirty:
            self._mesh_dirty = False
            self._update_viewer_mesh()
        if self.viewer_started:
            if not self.viewer.step():
                self.viewer_started = False

    def export_models(self) -> None:
        """Export reconstructed mesh to OBJ and STL."""
        if self.mesh_result is None or self.mesh_result.mesh is None:
            self.set_notification("No reconstructed mesh to export! Press [R] first.", duration=3.5)
            return

        export_dir = Path("exports")
        export_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time())
        obj_path = export_dir / f"model_{ts}.obj"
        stl_path = export_dir / f"model_{ts}.stl"

        ok_obj = export_mesh_to_obj(self.mesh_result.mesh, obj_path)
        ok_stl = export_mesh_to_stl(self.mesh_result.mesh, stl_path)

        if ok_obj and ok_stl:
            self.set_notification(f"Exported OBJ and STL to exports/model_{ts}.*", duration=4.0)
        else:
            self.set_notification("Export failed.", duration=3.0)

    def save_project_file(self) -> None:
        """Save project state to JSON."""
        strokes_dict = {
            name: canvas.store.strokes
            for name, canvas in self.canvases.items()
        }
        out_path = Path("exports") / f"project_{int(time.time())}.json"
        if save_project(out_path, mode="multiview", view_strokes=strokes_dict, canvas_size=self.canvas_size):
            self.set_notification(f"Project saved to {out_path.name}", duration=3.5)

    def render_composite(self, camera_frame: np.ndarray, cursor_canvas_pos: Optional[Tuple[float, float]]) -> np.ndarray:
        """Assemble the complete FormFlow Multi-view UI on a 1280x720 canvas."""
        target_w, target_h = 1280, 720
        if getattr(self, "_ui_bg", None) is None:
            self._ui_bg = np.full((target_h, target_w, 3), (16, 16, 20), dtype=np.uint8)
        ui = self._ui_bg.copy()
        font = cv2.FONT_HERSHEY_SIMPLEX

        # 1. Header Banner
        cv2.putText(ui, "FormFlow: 2D to 3D Multi-View Studio", (40, 45), font, 0.85, (0, 220, 255), 2, cv2.LINE_AA)
        cv2.putText(
            ui,
            "Draw all 3 views -> Press [R] to reconstruct -> [E] to export OBJ/STL",
            (40, 75),
            font,
            0.45,
            (160, 160, 170),
            1,
            cv2.LINE_AA,
        )

        # 2. Companion Guides calculation
        # If Front has strokes, project its width (X) to Top and height (Y) to Side
        f_ext = self.canvases["front"].get_extents()
        t_ext = self.canvases["top"].get_extents()
        s_ext = self.canvases["side"].get_extents()

        h_guide = None
        v_guide = None
        if self.active_view == "top" and f_ext:
            h_guide = (f_ext[0], f_ext[1])  # X bounds from Front
        elif self.active_view == "side":
            if f_ext:
                v_guide = (f_ext[2], f_ext[3])  # Y bounds from Front
            if t_ext:
                h_guide = (t_ext[2], t_ext[3])  # Z bounds from Top

        # 3. Render Active Canvas (Large, 512x512)
        active_c = self.current_canvas
        fill_mask = self.silhouettes[self.active_view].mask if self.silhouettes.get(self.active_view) else None
        canvas_img = active_c.render_display(
            show_grid=self.show_grid,
            h_guide_range=h_guide,
            v_guide_range=v_guide,
            fill_mask=fill_mask,
        )

        # Draw live cursor on active canvas if present
        if cursor_canvas_pos is not None:
            cx, cy = int(cursor_canvas_pos[0]), int(cursor_canvas_pos[1])
            if 0 <= cx < self.canvas_size and 0 <= cy < self.canvas_size:
                cv2.circle(canvas_img, (cx, cy), 6, (0, 255, 255), -1, cv2.LINE_AA)
                cv2.circle(canvas_img, (cx, cy), 12, (0, 200, 255), 1, cv2.LINE_AA)

        # Place Active Canvas on composite UI
        cx, cy, cw, ch = self.canvas_rect
        ui[cy:cy + ch, cx:cx + cw] = canvas_img
        # Border around active canvas
        cv2.rectangle(ui, (cx - 2, cy - 2), (cx + cw + 2, cy + ch + 2), (0, 220, 255), 2, cv2.LINE_AA)
        cv2.putText(
            ui,
            f"Active: {self.active_view.upper()} VIEW",
            (cx, cy - 10),
            font,
            0.55,
            (0, 220, 255),
            1,
            cv2.LINE_AA,
        )

        # 4. Right Panel: Webcam preview (360x202)
        cam_x, cam_y = 600, 100
        cam_w, cam_h = 340, 190
        cam_resized = cv2.resize(camera_frame, (cam_w, cam_h))
        ui[cam_y:cam_y + cam_h, cam_x:cam_x + cam_w] = cam_resized
        cv2.rectangle(ui, (cam_x - 1, cam_y - 1), (cam_x + cam_w + 1, cam_y + cam_h + 1), (70, 70, 80), 1)
        cv2.putText(ui, "Webcam / Hand Pencil", (cam_x, cam_y - 8), font, 0.45, (180, 180, 180), 1, cv2.LINE_AA)

        # 5. Right Panel: Thumbnails for 3 views (Front, Top, Side)
        thumb_size = 140
        thumb_y = 330
        self.preview_rects.clear()

        for idx, v_name in enumerate(["front", "top", "side"]):
            tx = cam_x + idx * (thumb_size + 15)
            ty = thumb_y
            self.preview_rects[v_name] = (tx, ty, thumb_size, thumb_size)

            t_img = self.canvases[v_name].render_display(show_grid=False)
            t_resized = cv2.resize(t_img, (thumb_size, thumb_size))
            ui[ty:ty + thumb_size, tx:tx + thumb_size] = t_resized

            # Border: highlighted if active
            is_active = (v_name == self.active_view)
            b_color = (0, 220, 255) if is_active else (50, 50, 60)
            cv2.rectangle(ui, (tx - 1, ty - 1), (tx + thumb_size + 1, ty + thumb_size + 1), b_color, 2 if is_active else 1)

            # Status indicator
            s_info = self.silhouettes.get(v_name)
            status_text = "[Empty]"
            status_color = (130, 130, 130)
            if s_info is not None:
                if s_info.is_closed:
                    status_text = "[OK: Closed]"
                    status_color = (0, 240, 120)
                else:
                    status_text = "[Open Gap!]"
                    status_color = (60, 60, 255)

            cv2.putText(ui, f"{v_name.upper()} ({v_name[0].upper()})", (tx + 5, ty + thumb_size + 18), font, 0.45, (220, 220, 220), 1, cv2.LINE_AA)
            cv2.putText(ui, status_text, (tx + 5, ty + thumb_size + 34), font, 0.40, status_color, 1, cv2.LINE_AA)

        # 6. Reconstruction stats / warnings area
        stats_y = 530
        cv2.putText(ui, "3D Reconstruction Status:", (cam_x, stats_y), font, 0.52, (200, 200, 200), 1, cv2.LINE_AA)

        if self.mesh_result is not None:
            m_stat = (
                f"Mesh: {self.mesh_result.vertex_count} verts, {self.mesh_result.triangle_count} tris | "
                f"Watertight: {'Yes' if self.mesh_result.is_watertight else 'No'}"
            )
            cv2.putText(ui, m_stat, (cam_x, stats_y + 25), font, 0.45, (0, 240, 140), 1, cv2.LINE_AA)
            if self.hull_result is not None:
                iou_msg = (
                    f"IoU -> Front: {self.hull_result.reprojection_iou['front']:.2f} | "
                    f"Top: {self.hull_result.reprojection_iou['top']:.2f} | "
                    f"Side: {self.hull_result.reprojection_iou['side']:.2f}"
                )
                cv2.putText(ui, iou_msg, (cam_x, stats_y + 48), font, 0.42, (180, 220, 255), 1, cv2.LINE_AA)
        else:
            cv2.putText(ui, "No 3D model generated yet. Draw 3 views and press [R].", (cam_x, stats_y + 25), font, 0.45, (140, 140, 140), 1, cv2.LINE_AA)

        # Warnings banner if any
        if self.disagreements:
            warn_msg = "Warning: " + self.disagreements[0].warning_message
            cv2.putText(ui, warn_msg, (cam_x, stats_y + 72), font, 0.42, (0, 180, 255), 1, cv2.LINE_AA)

        # 7. Bottom Navigation bar
        controls = "[F][T][S]: Switch View  |  [R]: Reconstruct 3D  |  [E]: Export OBJ/STL  |  [Z]: Undo  |  [C]: Clear  |  [G]: Grid  |  Esc: Menu"
        cv2.putText(ui, controls, (40, target_h - 20), font, 0.45, (170, 170, 170), 1, cv2.LINE_AA)

        # 8. Flash notification banner
        if self.notification and time.monotonic() < self.notification_time:
            # Banner across top-center
            cv2.rectangle(ui, (target_w // 2 - 280, 15), (target_w // 2 + 280, 52), (30, 30, 40), -1)
            cv2.rectangle(ui, (target_w // 2 - 280, 15), (target_w // 2 + 280, 52), (0, 220, 255), 1)
            cv2.putText(ui, self.notification, (target_w // 2 - 260, 40), font, 0.52, (0, 255, 200), 1, cv2.LINE_AA)

        return ui
