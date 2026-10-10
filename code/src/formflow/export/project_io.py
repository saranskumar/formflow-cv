"""JSON project persistence for FormFlow sketches and multi-view sessions."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from formflow.strokes.store import Stroke

log = logging.getLogger(__name__)

PROJECT_SCHEMA_VERSION = "1.0"


def stroke_to_dict(stroke: Stroke) -> Dict[str, Any]:
    return {
        "id": stroke.id,
        "points": [list(pt) for pt in stroke.points],
        "z": stroke.z,
        "color": list(stroke.color),
        "created_at": stroke.created_at,
    }


def dict_to_stroke(d: Dict[str, Any]) -> Stroke:
    return Stroke(
        id=d.get("id", 0),
        points=[tuple(pt) for pt in d.get("points", [])],
        z=d.get("z"),
        color=tuple(d.get("color", [0, 200, 255])),
        created_at=d.get("created_at", time.time()),
    )


def save_project(
    filepath: Path | str,
    mode: str,
    view_strokes: Dict[str, List[Stroke]],
    canvas_size: int = 512,
) -> bool:
    """Save multi-view or 3D sketch project to JSON."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    data = {
        "version": PROJECT_SCHEMA_VERSION,
        "mode": mode,
        "saved_at": time.time(),
        "canvas_size": canvas_size,
        "views": {
            view_name: [stroke_to_dict(s) for s in strokes]
            for view_name, strokes in view_strokes.items()
        },
    }

    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        log.info("Saved project file: %s", path)
        return True
    except Exception as e:
        log.error("Failed to save project file: %s", e)
        return False


def load_project(filepath: Path | str) -> Optional[Dict[str, Any]]:
    """Load project from JSON file."""
    path = Path(filepath)
    if not path.exists():
        log.warning("Project file does not exist: %s", path)
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        ver = data.get("version", "1.0")
        mode = data.get("mode", "multiview")
        canvas_size = data.get("canvas_size", 512)

        views: Dict[str, List[Stroke]] = {}
        for view_name, stroke_dicts in data.get("views", {}).items():
            views[view_name] = [dict_to_stroke(sd) for sd in stroke_dicts]

        log.info("Loaded project from %s (version=%s, mode=%s)", path, ver, mode)
        return {
            "version": ver,
            "mode": mode,
            "canvas_size": canvas_size,
            "views": views,
        }
    except Exception as e:
        log.error("Failed to load project: %s", e)
        return None
