import base64
import struct

import pytest
from fastapi.testclient import TestClient

from server.app import create_app


@pytest.fixture
def env(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<html>hi</html>")
    (web / "a.mjs").write_text("export const a = 1;")
    (web / "m.wasm").write_bytes(b"\0asm")
    (web / "h.task").write_bytes(b"model")
    imports = tmp_path / "imports"
    imports.mkdir()
    (imports / "part.obj").write_bytes(b"v 0 0 0\n")
    (imports / "notes.txt").write_text("x")
    app = create_app(web, tmp_path / "exports", imports, tmp_path / "cal.json")
    return TestClient(app), tmp_path


def test_serves_the_app_and_vendor_files_with_correct_mime_types(env):
    c, _ = env
    assert c.get("/").text == "<html>hi</html>"
    assert c.get("/").headers["cache-control"] == "no-cache"
    assert c.get("/a.mjs").headers["content-type"].startswith("text/javascript")
    assert c.get("/m.wasm").headers["content-type"] == "application/wasm"
    assert c.get("/h.task").status_code == 200
    assert c.get("/api/health").json() == {"ok": True, "app": "formflow"}


def test_the_real_web_app_is_complete(tmp_path):
    from server.app import ROOT
    c = TestClient(create_app())
    for path in ["/", "/js/main.js", "/js/core/sketch.js", "/css/app.css", "/vendor/three.module.js",
                 "/vendor/vision_bundle.mjs", "/vendor/hand_landmarker.task", "/vendor/wasm/vision_wasm_internal.wasm",
                 "/vendor/wasm/vision_wasm_internal.js"]:
        r = c.get(path)
        assert r.status_code == 200, path
    assert (ROOT / "web" / "index.html").exists()


def test_model_listing_only_shows_obj_and_stl(env):
    c, _ = env
    assert c.get("/api/models").json() == ["part.obj"]
    assert c.get("/api/models/part.obj").content == b"v 0 0 0\n"


@pytest.mark.parametrize("name", ["../secret.txt", "notes.txt", "missing.obj", "..%2Fcal.json", "part.obj%2F..", "%2e%2e%2fcal.json"])
def test_model_download_cannot_escape_or_read_other_files(env, name):
    c, _ = env
    assert c.get(f"/api/models/{name}").status_code == 404


def test_calibration_rest_roundtrip_and_validation(env):
    c, _ = env
    assert c.get("/api/calibration").json() == {}
    assert c.put("/api/calibration", json={"pinchOn": 0.3}).json() == {"ok": True}
    assert c.get("/api/calibration").json() == {"pinchOn": 0.3}
    assert c.put("/api/calibration", json=[1, 2]).status_code == 400
    assert c.put("/api/calibration", content=b"{not json").status_code == 400
    assert c.put("/api/calibration", json={"x": "y" * 20000}).status_code == 400


def test_websocket_hello_returns_calibration_and_models(env):
    c, _ = env
    with c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "hello"})
        assert ws.receive_json() == {"type": "calibration", "data": None}
        assert ws.receive_json() == {"type": "models", "names": ["part.obj"]}
        ws.send_json({"type": "calibration", "data": {"pinchOn": 0.25}})
        assert ws.receive_json() == {"type": "calibration_saved"}
        ws.send_json({"type": "hello"})
        assert ws.receive_json()["data"] == {"pinchOn": 0.25}
        ws.receive_json()
        ws.send_json({"type": "ping", "t": 5})
        assert ws.receive_json() == {"type": "pong", "t": 5}


def test_websocket_saves_obj_and_stl_exports(env):
    c, tmp = env
    stl = b"\0" * 80 + struct.pack("<I", 0)
    with c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "export", "name": "formflow_1", "obj": "v 0 0 0\n", "stl": base64.b64encode(stl).decode()})
        assert ws.receive_json() == {"type": "saved", "files": ["formflow_1.obj", "formflow_1.stl"]}
    assert (tmp / "exports" / "formflow_1.obj").read_text() == "v 0 0 0\n"
    assert (tmp / "exports" / "formflow_1.stl").read_bytes() == stl


def test_obj_only_export(env):
    c, tmp = env
    with c.websocket_connect("/ws") as ws:
        ws.send_json({"type": "export", "name": "lines", "obj": "v 1 1 1\n", "stl": None})
        assert ws.receive_json() == {"type": "saved", "files": ["lines.obj"]}
    assert not (tmp / "exports" / "lines.stl").exists()


@pytest.mark.parametrize("msg,fragment", [
    ({"type": "export", "name": "../evil", "obj": "x"}, "Invalid export name"),
    ({"type": "export", "name": "a/b", "obj": "x"}, "Invalid export name"),
    ({"type": "export", "name": "", "obj": "x"}, "Invalid export name"),
    ({"type": "export", "name": "ok"}, "Nothing to save"),
    ({"type": "export", "name": "ok", "stl": "!!!notbase64!!!"}, "base64"),
    ({"type": "calibration", "data": [1]}, "Bad calibration"),
    ({"type": "nope"}, "Unknown message type"),
])
def test_websocket_rejects_bad_messages_and_stays_alive(env, msg, fragment):
    c, tmp = env
    with c.websocket_connect("/ws") as ws:
        ws.send_json(msg)
        reply = ws.receive_json()
        assert reply["type"] == "error" and fragment in reply["message"]
        ws.send_json({"type": "ping", "t": 1})                    # the connection survived
        assert ws.receive_json()["type"] == "pong"
    assert not (tmp / "evil.obj").exists()
    assert not list(tmp.rglob("evil*"))


def test_websocket_invalid_json_and_non_object(env):
    c, _ = env
    with c.websocket_connect("/ws") as ws:
        ws.send_text("{broken")
        assert ws.receive_json()["message"] == "Invalid JSON"
        ws.send_text("[1,2]")
        assert "object" in ws.receive_json()["message"]
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"


def test_samples_are_listed_only_when_their_pictures_exist_and_are_served(tmp_path):
    import json
    web = tmp_path / "web"; web.mkdir(); (web / "index.html").write_text("x")
    samples = tmp_path / "samples"
    (samples / "mug").mkdir(parents=True)
    for v in ("front", "side"):
        (samples / "mug" / f"{v}.png").write_bytes(b"png")
    (samples / "index.json").write_text(json.dumps([
        {"id": "mug", "title": "Mug", "views": ["front", "side"]},
        {"id": "ghost", "title": "Missing", "views": ["front"]},          # no pictures on disk
        {"id": "../etc", "title": "Bad", "views": ["front"]},             # not a plain name
    ]))
    c = TestClient(create_app(web, tmp_path / "exports", tmp_path / "imports", tmp_path / "cal.json", samples))
    assert [s["id"] for s in c.get("/api/samples").json()] == ["mug"]
    assert c.get("/samples/mug/front.png").content == b"png"
    assert c.get("/samples/../index.html").status_code in (404, 200) and c.get("/samples/index.json").status_code == 200


def test_the_real_samples_are_all_listed():
    c = TestClient(create_app())
    ids = [s["id"] for s in c.get("/api/samples").json()]
    assert ids == ["rocket", "house", "vase", "head", "airplane", "castle", "robot", "car", "pawn"]
    for s in c.get("/api/samples").json():
        for v in s["views"]:
            assert c.get(f"/samples/{s['id']}/{v}.png").status_code == 200
