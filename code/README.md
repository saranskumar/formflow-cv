# FormFlow – Air Sketching in 3D with Your Hands

FormFlow lets you sketch 3D scenes in mid-air using a webcam. Your hands are tracked in the browser
(MediaPipe Hand Landmarker), gestures are decoded into drawing actions, and the result is rendered live with
Three.js. A small Python (FastAPI) server hosts the app and saves exports/calibration to disk.
Everything is vendored, so it **works fully offline**.

## Overview

```
Webcam ─► MediaPipe hand landmarks ─► tracker (stabilise, pick user's hands)
       ─► gesture decoder (pinch / grab / fist / peace) ─► controller (state machine)
       ─► sketch engine (pure logic: camera, tools, picking) ─► Three.js scene + HUD
                                                              └► WebSocket ─► Python server ─► exports/*.obj|stl
```

### Features
- **Draw** freehand curves, or place line / rectangle / circle / cube / sphere / cylinder / cone / pyramid.
- **Move / scale** objects, **orbit / pan / zoom** the camera with the second hand.
- **Join lines**: stroke ends that almost meet are offered to be closed or stitched.
- **Visual hull**: draw closed outlines in Front / Side / Top views, then "Make 3D" to build a solid.
- **Smooth hull**: each outline becomes an exact signed distance field and the 3D shape is built from those fields
  (not 0/1 voxels), so slanted and curved outlines come out smooth at any size. Detail goes up to *Ultra* (128³, about
  0.5 s); the live preview is built in a Web Worker so drawing never stalls; an optional *Smooth* switch applies Taubin
  smoothing; the panel reports whether the finished mesh is watertight.
- **Photos → 3D**: pick (or drag in) up to three photos of an object; each is matched to Front / Side / Top by its
  file name (`mug_side.jpg`) or in that order, its outline is found automatically (works on unevenly lit, noisy
  backgrounds), and the 3D model is built straight away. One photo of a round object (bottle, vase, cup) can be spun
  into a solid with **One view: Round**.
- **Models** (top bar → **Models**, or key `M`): lists every MediaPipe hand and body model that runs in the browser: the
  Hand Landmarker (graphics card, processor, or a smaller camera picture), the Gesture Recognizer, the Holistic
  Landmarker and the Pose Landmarker (lite, full, heavy). **Test** runs one on about 3 seconds of live camera pictures and
  shows the time per picture, the frame rate it allows and whether it found a hand; a live picture beside the table shows
  the points the model finds. **Use** switches the model that tracks your hands (remembered). Models marked "downloaded
  when tested" come from Google's model storage the first time and are cached by the browser; nothing else leaves your
  computer. If a chosen model cannot start, the app falls back to the standard one.
- **Point and hold**: with the index finger out (others curled) at a button, a ring fills for 0.8 s and the button is
  pressed. A pinch still presses at once.
- **Smooth navigation**: zoom, pan and the Front / Side / Top / Reset view moves glide instead of jumping.
- **Demo gallery** (top bar → **Demo**, or key `O`): ready-made photo sets in `samples/` (rocket, house, vase, castle, robot,
  airplane, toy car, chess pawn, a pencil-drawn head). One click loads the pictures, outlines them and builds the 3D model. Rocket, house and vase are
  rendered by `python samples/make_samples.py` (numpy, Pillow); airplane, castle, robot, car and pawn are drawn as SVG by
  `python samples/make_svgs.py` (sources in `samples/svg/`) and turned into pictures by `python samples/svg_to_png.py`
  (uses Chrome or Edge, nothing to install). Add your own set as a folder with
  `front.png`, `side.png`, `top.png` and an entry in `samples/index.json`.
- **One view full screen**: in 3-Plane Hull press ⤢ on a view (or `F` / `L` / `T`) to open Front, Side, Top or the 3D
  preview over the whole workspace: bigger to draw in, with a strip to jump to another view and **Back to 3 views**
  (`Esc`). Draw, trace, then open the next view.
- **Drawings work too**: a pencil or line drawing of a figure, even one that runs off the bottom of the picture, is
  outlined as a solid figure. Mirror a side view if its nose points the other way from the front view (button ⇋).
- **Extrude and Cut**: draw a closed outline (rectangle, circle or a loop), choose **Extrude**, pinch inside it and drag
  up to pull it out into a solid (down pushes it the other way). Choose **Cut**, draw the outline over a solid, pinch
  inside it and drag up to cut a pocket or a hole into the solid. Both are one Undo step and keep the model
  watertight, so it can be exported or printed.
- **Light correction**: when the hand is dark (a window or lamp behind you, a dim room) the picture the detector sees
  is brightened automatically, and a hand that flickers in and out on blurry frames is still picked up.
- **Camera help and lighting hints**: the app asks the camera for at least 24 fps (less motion blur) and, where the
  camera allows it, raises its own exposure by up to +2 EV when light is behind you or the room is dark. If the picture
  stays too dark, too bright, blurry or slow, a short hint says what to change ("Light behind you", "Too dark", ...).
  Press `D` for the live read-out and **Save log** to write a session log (JSON, stays on your computer) that shows how
  often the hand was tracked and under which conditions.
- **Import** `.obj` / `.stl` (drag onto the page, or put files in `code/imports/`) and **export** OBJ / STL.
- Keyboard shortcuts and mouse fallback (no camera needed to test).
- **Calibration**: onboarding practice mode, reach-area calibration for distant/projector setups, settings
  for dominant hand, distance and sensitivity (saved to `calibration_web.json`).

### Controls (summary)
| Action | Gesture | Key |
|---|---|---|
| Draw curve | Pinch thumb+index, move | 1 |
| Place shape | Pinch at centre, drag out, release | 2–9 |
| Move object | Pinch thumb+middle | 0 |
| Scale | Scale tool, drag up/down | X |
| Extrude · Cut | Pinch inside a closed outline, drag up | Q · K |
| Orbit / Pan | Fist / peace sign with 2nd hand | – |
| Zoom | Pinch with both hands, apart/together | + − |
| Join lines · Make 3D | – | J · U |
| Front/Side/Top view | – | F · L · T |
| Undo · Clear · Import · Export | – | Z · C · I · E |

Mouse fallback: left = pinch, Shift+left = grab, right = fist, middle = peace.
The full table is in the in-app guide (source: `web/js/core/controls.js`).

## Project layout

```
code/
├── run.bat               One-click launcher (creates venv, installs deps, starts server, opens browser)
├── requirements.txt      fastapi, uvicorn, websockets, httpx, pytest
├── pytest.ini            Python test config
├── calibration_web.json  Saved user settings/calibration (auto-written)
├── exports/              Saved OBJ/STL exports (git-ignored)
├── imports/              Optional: drop .obj/.stl here to import without a file chooser
├── server/
│   ├── app.py            FastAPI app: static hosting, /ws WebSocket, /api/* REST
│   └── __main__.py       `python -m server` entry point
├── tests/test_server.py  Server tests (pytest)
└── web/
    ├── index.html        Single page (video, WebGL canvas, overlay, HUD)
    ├── css/app.css
    ├── js/
    │   ├── main.js       Wires camera, tracking, controller, scene, HUD, backend link
    │   ├── bridge.js     WebSocket client to the Python backend (app works without it)
    │   ├── core/         Pure logic, unit-tested in Node: gestures, tracker, controller,
    │   │                 sketch engine, shapes, hull, stitch, mesh I/O, exporters, settings…
    │   ├── render/scene.js   Three.js renderer of the sketch state
    │   └── ui/           HUD, guide, settings, overlay, prompts, diagnostics, hull panel
    ├── vendor/           Three.js, MediaPipe bundle + WASM + hand_landmarker.task (offline)
    └── test/             Node test suite (`node --test`)
```

### Server API
| Endpoint | Purpose |
|---|---|
| `GET /` | Serves the web app |
| `GET /api/health` | Health check |
| `GET /api/models`, `GET /api/models/{name}` | List / fetch `.obj`/`.stl` in `imports/` |
| `GET` / `PUT /api/calibration` | Read / write calibration JSON |
| `WS /ws` | Messages: `hello`, `ping`, `calibration`, `export` (saves OBJ + base64 STL to `exports/`) |

## Requirements
- Windows, macOS or Linux; **Python 3.12** (3.10+ should work)
- **Chrome or Edge** (WebGL, WebAssembly, camera)
- A webcam (optional for testing – the mouse works too)
- Node.js (optional, only to run the JavaScript tests)

## Running

### Windows (easiest)
Double-click `run.bat`, or from `code/`:

```bat
run.bat
```

First run creates `.venv`, installs `requirements.txt`, starts the server and opens
<http://127.0.0.1:8000>. Allow camera access.

Options:
```bat
run.bat --port 9000 --no-browser
```

### Manual (any OS)
```bash
cd code
python -m venv .venv
# Windows: .venv\Scripts\activate      macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m server            # add --port 9000 / --host 0.0.0.0 / --no-browser if needed
```
Then open <http://127.0.0.1:8000> in Chrome or Edge.

> Camera access requires `localhost`/`127.0.0.1` or HTTPS – don't open `index.html` via `file://`.

### First use
1. Allow the camera. The onboarding **practice mode** asks you to perform a pinch and a fist (holding ~0.5 s)
   and measures your finger spacing to personalise thresholds.
2. Open **Settings** to choose your drawing hand and distance (near / medium / far / auto); use reach
   calibration if you work from far away or with a projector.
3. Press the guide button in the app for the full controls reference.

## Tests

```bat
run.bat test
```
or manually from `code/`:
```bash
python -m pytest -q                       # server tests
cd web && node --test "test/*.test.mjs"   # JavaScript logic tests (gestures, tracker, hull, sketch, photos, models…)
```

## Troubleshooting
- **No camera / black view**: use Chrome or Edge, allow the permission, and open via `http://127.0.0.1:<port>`.
- **Hands not detected**: keep Settings → Light correction on *Auto*; for a laptop webcam use Distance *Near*; set
  Sensitivity to *high* for small hands; run reach calibration. Press `D` to see what the detector is doing
  (frame rate, light correction level, detected conditions, camera settings, dropouts). A hint such as "Light behind
  you" or "Too dark" means the picture itself is the problem: face the light, switch on a lamp in front of you.
- **Feels laggy**: press `D` and read *Frame time*. It says whether the page itself (hand detection, 3D drawing) or
  the graphics card is the limit and which part is heaviest. When frames run long the app lowers its drawing
  resolution and then runs detection on every other camera frame by itself. Closing other tabs and using the laptop's
  graphics card (not the power-saving one) also helps.
- **Port in use**: `run.bat --port 9000`.
- **Server offline**: the app still runs; exports can then be downloaded instead of saved to `exports/`.
