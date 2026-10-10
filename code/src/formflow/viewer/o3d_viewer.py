"""Non-blocking Open3D visualizer wrapper for 3D sketching and mesh inspection."""

from __future__ import annotations

import logging
from typing import Optional, List
import numpy as np

try:
    import open3d as o3d
    HAS_OPEN3D = True
except ImportError:
    HAS_OPEN3D = False

log = logging.getLogger(__name__)


def create_ground_grid(size: float = 1.0, step: float = 0.2, y_level: float = -1.0) -> o3d.geometry.LineSet:
    """Create a subtle ground grid LineSet at y = y_level."""
    ticks = np.arange(-size, size + 1e-4, step)
    points = []
    lines = []
    
    # Lines parallel to Z (varying X)
    idx = 0
    for x in ticks:
        points.append([x, y_level, -size])
        points.append([x, y_level, size])
        lines.append([idx, idx + 1])
        idx += 2
        
    # Lines parallel to X (varying Z)
    for z in ticks:
        points.append([-size, y_level, z])
        points.append([size, y_level, z])
        lines.append([idx, idx + 1])
        idx += 2

    grid = o3d.geometry.LineSet()
    grid.points = o3d.utility.Vector3dVector(np.array(points, dtype=np.float64))
    grid.lines = o3d.utility.Vector2iVector(np.array(lines, dtype=np.int32))
    colors = np.full((len(lines), 3), [0.35, 0.35, 0.38], dtype=np.float64)
    grid.colors = o3d.utility.Vector3dVector(colors)
    return grid


def create_bounding_box(min_pt=(-1.0, -1.0, -1.0), max_pt=(1.0, 1.0, 1.0)) -> o3d.geometry.LineSet:
    """Create workspace bounding box outline."""
    box = o3d.geometry.AxisAlignedBoundingBox(min_bound=min_pt, max_bound=max_pt)
    box_lines = o3d.geometry.LineSet.create_from_axis_aligned_bounding_box(box)
    colors = np.full((len(box_lines.lines), 3), [0.25, 0.25, 0.28], dtype=np.float64)
    box_lines.colors = o3d.utility.Vector3dVector(colors)
    return box_lines


class O3DViewer:
    """Non-blocking Open3D visualizer that integrates into the OpenCV main loop."""

    def __init__(
        self,
        window_name: str = "FormFlow 3D View",
        width: int = 800,
        height: int = 700,
        visible: bool = True,
        show_grid: bool = True,
        show_axes: bool = True,
    ) -> None:
        self.window_name = window_name
        self.width = width
        self.height = height
        self.visible = visible
        self.show_grid = show_grid
        self.show_axes = show_axes

        self.vis: Optional[o3d.visualization.Visualizer] = None
        self._is_active = False
        self._geometries: dict[str, o3d.geometry.Geometry] = {}

    def start(self) -> bool:
        """Create and show the Open3D window."""
        if not HAS_OPEN3D:
            log.warning("Open3D not available.")
            return False
        if self._is_active:
            return True

        try:
            self.vis = o3d.visualization.Visualizer()
            self.vis.create_window(
                window_name=self.window_name,
                width=self.width,
                height=self.height,
                visible=self.visible,
            )
            self._is_active = True  # add_geometry/reset_view are no-ops until set
            render_opts = self.vis.get_render_option()
            render_opts.background_color = np.array([0.08, 0.08, 0.10], dtype=np.float64)
            render_opts.point_size = 5.0
            render_opts.line_width = 3.0
            render_opts.show_coordinate_frame = False

            # Workspace box goes first: it seeds the view bounding box ([-1, 1]^3)
            self.add_geometry("box", create_bounding_box())
            if self.show_grid:
                self.add_geometry("grid", create_ground_grid(size=1.0, step=0.25, y_level=-1.0))
            if self.show_axes:
                axes = o3d.geometry.TriangleMesh.create_coordinate_frame(size=0.4, origin=[-1.0, -1.0, -1.0])
                self.add_geometry("axes", axes)

            self.reset_view("iso")
            log.info("Open3D visualizer window opened.")
            return True
        except Exception as e:
            log.error("Failed to start Open3D visualizer: %s", e)
            self._is_active = False
            return False

    def add_geometry(self, name: str, geom: o3d.geometry.Geometry) -> None:
        if not self.vis or not self._is_active:
            return
        if name in self._geometries:
            self.remove_geometry(name)
        first = not self._geometries
        self._geometries[name] = geom
        # The first geometry seeds the view bounding box (else clipping planes are empty)
        self.vis.add_geometry(geom, reset_bounding_box=first)

    def update_geometry(self, name: str, geom: Optional[o3d.geometry.Geometry] = None) -> None:
        if not self.vis or not self._is_active:
            return
        g = geom or self._geometries.get(name)
        if g is not None:
            self.vis.update_geometry(g)

    def remove_geometry(self, name: str) -> None:
        if not self.vis or not self._is_active:
            return
        if name in self._geometries:
            geom = self._geometries.pop(name)
            self.vis.remove_geometry(geom, reset_bounding_box=False)

    def clear_dynamic_geometries(self, keep_prefixes=("grid", "box", "axes")) -> None:
        """Clear sketch or reconstructed geometries while keeping grid/axes."""
        keys = list(self._geometries.keys())
        for k in keys:
            if not any(k.startswith(p) for p in keep_prefixes):
                self.remove_geometry(k)

    def step(self) -> bool:
        """Process one tick of window events and re-render. Returns False if window was closed."""
        if not self.vis or not self._is_active:
            return False
        try:
            active = self.vis.poll_events()
            if not active:
                self._is_active = False
                return False
            self.vis.update_renderer()
            return True
        except Exception as e:
            log.debug("Open3D event step error: %s", e)
            self._is_active = False
            return False

    def render_image(self) -> Optional[np.ndarray]:
        """Return the current render as a BGR uint8 image (for embedding in the main window)."""
        if not self.vis or not self._is_active:
            return None
        try:
            buf = np.asarray(self.vis.capture_screen_float_buffer(False))
            return (buf[:, :, ::-1] * 255).astype(np.uint8)
        except Exception as e:
            log.debug("Open3D capture error: %s", e)
            return None

    def reset_view(self, preset: str = "iso") -> None:
        """Preset camera angles: front, top, side, iso."""
        if not self.vis or not self._is_active:
            return
        ctr = self.vis.get_view_control()
        if preset == "front":
            ctr.set_lookat(np.array([0.0, 0.0, 0.0]))
            ctr.set_front(np.array([0.0, 0.0, 1.0]))
            ctr.set_up(np.array([0.0, 1.0, 0.0]))
            ctr.set_zoom(0.9)
        elif preset == "top":
            ctr.set_lookat(np.array([0.0, 0.0, 0.0]))
            ctr.set_front(np.array([0.0, 1.0, 0.0]))
            ctr.set_up(np.array([0.0, 0.0, -1.0]))
            ctr.set_zoom(0.9)
        elif preset == "side":
            ctr.set_lookat(np.array([0.0, 0.0, 0.0]))
            ctr.set_front(np.array([1.0, 0.0, 0.0]))
            ctr.set_up(np.array([0.0, 1.0, 0.0]))
            ctr.set_zoom(0.9)
        elif preset == "iso":
            ctr.set_lookat(np.array([0.0, 0.0, 0.0]))
            ctr.set_front(np.array([0.8, 0.6, 1.0]))
            ctr.set_up(np.array([0.0, 1.0, 0.0]))
            ctr.set_zoom(0.9)

    def orbit(self, delta_x: float, delta_y: float) -> None:
        """Rotate camera view."""
        if not self.vis or not self._is_active:
            return
        ctr = self.vis.get_view_control()
        ctr.rotate(delta_x, delta_y)

    def stop(self) -> None:
        """Destroy window and clean up resources."""
        if self.vis and self._is_active:
            try:
                self.vis.destroy_window()
            except Exception:
                pass
        self.vis = None
        self._is_active = False
        self._geometries.clear()

    @property
    def is_active(self) -> bool:
        return self._is_active
