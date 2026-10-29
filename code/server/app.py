"""FormFlow web bridge: serves the Three.js app and keeps files on disk.

The browser does the heavy lifting (MediaPipe hand tracking on the GPU, Three.js rendering). This server:
  * serves the static web app and its vendored libraries (works fully offline)
  * WebSocket /ws   : saves exported scenes to code/exports/ and keeps the calibration
  * GET /api/models : lists .obj/.stl files in code/imports/ so gesture users can import without a file chooser
  * GET /api/samples: the demo photo sets in code/samples/ (served under /samples/), for the Demo gallery
"""
from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import re
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("application/octet-stream", ".task")

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 80 * 1024 * 1024
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,80}$")
MODEL_EXT = {".obj", ".stl"}


def create_app(
    web_dir: Optional[Path] = None,
    exports_dir: Optional[Path] = None,
    imports_dir: Optional[Path] = None,
    cal_path: Optional[Path] = None,
    samples_dir: Optional[Path] = None,
) -> FastAPI:
    web_dir = Path(web_dir or ROOT / "web")
    exports_dir = Path(exports_dir or ROOT / "exports")
    imports_dir = Path(imports_dir or ROOT / "imports")
    samples_dir = Path(samples_dir or ROOT / "samples")
    cal_path = Path(cal_path or ROOT / "calibration_web.json")
    app = FastAPI(title="FormFlow bridge", docs_url=None, redoc_url=None)

    @app.middleware("http")
    async def no_cache(request: Request, call_next):          # edits show up on refresh during development
        resp = await call_next(request)
        if request.url.path.endswith((".js", ".mjs", ".css", ".html")) or request.url.path == "/":
            resp.headers["Cache-Control"] = "no-cache"
        return resp

    # ------------------------------------------------------------------ helpers
    def load_cal() -> Optional[dict]:
        try:
            data = json.loads(cal_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def save_cal(data) -> bool:
        if not isinstance(data, dict) or len(json.dumps(data)) > 10_000:
            return False
        cal_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return True

    def models() -> List[str]:
        if not imports_dir.is_dir():
            return []
        return sorted(p.name for p in imports_dir.iterdir() if p.is_file() and p.suffix.lower() in MODEL_EXT)

    # --------------------------------------------------------------------- REST
    @app.get("/api/health")
    def health():
        return {"ok": True, "app": "formflow"}

    @app.get("/api/models")
    def list_models():
        return models()

    @app.get("/api/models/{name}")
    def get_model(name: str):
        # only plain file names that really are in the imports folder: no path traversal
        if name not in models():
            raise HTTPException(404, "No such model")
        return Response((imports_dir / name).read_bytes(), media_type="application/octet-stream")

    @app.get("/api/samples")
    def list_samples():
        # only sets whose pictures really exist, so a broken index never shows a card that cannot load
        try:
            index = json.loads((samples_dir / "index.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        ok = []
        for s in index if isinstance(index, list) else []:
            if isinstance(s, dict) and NAME_RE.match(str(s.get("id", ""))) and s.get("views") and all(
                    (samples_dir / s["id"] / f"{v}.png").is_file() for v in s["views"] if v in ("front", "side", "top")):
                ok.append(s)
        return ok

    @app.get("/api/calibration")
    def get_cal():
        return JSONResponse(load_cal() or {})

    @app.put("/api/calibration")
    async def put_cal(request: Request):
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "Invalid JSON")
        if not save_cal(data):
            raise HTTPException(400, "Calibration must be a small JSON object")
        return {"ok": True}

    # ---------------------------------------------------------------- WebSocket
    @app.websocket("/ws")
    async def ws(sock: WebSocket):
        await sock.accept()
        try:
            while True:
                try:
                    msg = json.loads(await sock.receive_text())
                except ValueError:
                    await sock.send_json({"type": "error", "message": "Invalid JSON"})
                    continue
                if not isinstance(msg, dict):
                    await sock.send_json({"type": "error", "message": "Message must be an object"})
                    continue
                kind = msg.get("type")
                if kind == "hello":
                    await sock.send_json({"type": "calibration", "data": load_cal()})
                    await sock.send_json({"type": "models", "names": models()})
                elif kind == "ping":
                    await sock.send_json({"type": "pong", "t": msg.get("t")})
                elif kind == "calibration":
                    ok = save_cal(msg.get("data"))
                    await sock.send_json({"type": "calibration_saved" if ok else "error",
                                          **({} if ok else {"message": "Bad calibration"})})
                elif kind == "export":
                    await sock.send_json(save_export(msg, exports_dir))
                else:
                    await sock.send_json({"type": "error", "message": f"Unknown message type: {kind!r}"})
        except WebSocketDisconnect:
            pass

    if samples_dir.is_dir():
        app.mount("/samples", StaticFiles(directory=str(samples_dir)), name="samples")
    app.mount("/", StaticFiles(directory=str(web_dir), html=True), name="web")
    return app


def save_export(msg: dict, exports_dir: Path) -> dict:
    """Write an exported scene (OBJ text and optional base64 STL) into the exports folder."""
    name = msg.get("name", "")
    if not isinstance(name, str) or not NAME_RE.match(name):
        return {"type": "error", "message": "Invalid export name"}
    obj, stl = msg.get("obj"), msg.get("stl")
    if not isinstance(obj, str) and not isinstance(stl, str):
        return {"type": "error", "message": "Nothing to save"}
    exports_dir.mkdir(parents=True, exist_ok=True)
    files = []
    try:
        if isinstance(obj, str):
            if len(obj) > MAX_BYTES:
                return {"type": "error", "message": "OBJ too large"}
            (exports_dir / f"{name}.obj").write_bytes(obj.encode("utf-8"))   # exact bytes: no CRLF translation on Windows
            files.append(f"{name}.obj")
        if isinstance(stl, str):
            data = base64.b64decode(stl, validate=True)
            if len(data) > MAX_BYTES:
                return {"type": "error", "message": "STL too large"}
            (exports_dir / f"{name}.stl").write_bytes(data)
            files.append(f"{name}.stl")
    except (binascii.Error, ValueError):
        return {"type": "error", "message": "STL data is not valid base64"}
    return {"type": "saved", "files": files}


app = create_app()
