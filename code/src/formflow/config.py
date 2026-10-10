"""FormFlow configuration dataclass with JSON persistence."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

_DEFAULT_PATH = Path(__file__).parent.parent.parent / "config.json"


@dataclass
class Config:
    # --- Camera ---
    camera_index: int = 0
    camera_width: int = 1280
    camera_height: int = 720
    camera_backend: str = "DSHOW"   # DSHOW | MSMF | AUTO
    mirror: bool = True

    # --- Hand tracking ---
    max_num_hands: int = 1
    detection_confidence: float = 0.6
    tracking_confidence: float = 0.6
    handedness: str = "Right"       # Right | Left | Any

    # --- One-Euro filter (fingertip) ---
    one_euro_min_cutoff: float = 1.0
    one_euro_beta: float = 0.007
    one_euro_d_cutoff: float = 1.0

    # --- Pinch ---
    pinch_on_threshold: float = 0.25   # normalised by hand size
    pinch_off_threshold: float = 0.40
    pinch_debounce_frames: int = 3

    # --- Gestures (dwell, fist, palm) ---
    dwell_seconds: float = 0.8
    gesture_dwell_seconds: float = 0.6

    # --- Strokes ---
    min_point_spacing_px: float = 2.0
    smoothing_window: int = 5
    outlier_jump_px: float = 80.0

    # --- Mode 2 canvas ---
    canvas_size: int = 512
    brush_thickness_px: int = 3

    # --- CV processing ---
    gap_close_kernel_px: int = 7

    # --- Reconstruction ---
    voxel_grid_size: int = 96
    mismatch_threshold_pct: float = 0.10

    # --- UI ---
    font_scale: float = 0.6
    font_thickness: int = 1

    @classmethod
    def load(cls, path: Path | str = _DEFAULT_PATH) -> "Config":
        path = Path(path)
        if path.exists():
            try:
                with open(path) as f:
                    data = json.load(f)
                cfg = cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
                log.info("Config loaded from %s", path)
                return cfg
            except Exception as e:
                log.warning("Could not load config (%s). Using defaults.", e)
        return cls()

    def save(self, path: Path | str = _DEFAULT_PATH) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)
        log.info("Config saved to %s", path)
