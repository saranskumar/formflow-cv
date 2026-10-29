# FormFlow Bible

Everything about the project in one place: what it is, why it exists, who it is for, how it works inside, how it got here, and the answers to the questions people will ask. This is a description of the project, not a rulebook.

Contents: [1 Identity](#1-identity) · [2 What](#2-what-it-is) · [3 Why](#3-why-it-exists) · [4 Who](#4-who) · [5 History](#5-when-the-history) · [6 Where](#6-where-things-live) · [7 How](#7-how-it-works) · [8 Controls](#8-controls-reference) · [9 Numbers](#9-numbers) · [10 Decisions](#10-decisions-and-the-reasons-behind-them) · [11 Prior art](#11-prior-art-what-we-studied) · [12 Limits](#12-limits-and-honest-unknowns) · [13 FAQ](#13-faq) · [14 Glossary](#14-glossary)

---

## 1. Identity

| | |
|---|---|
| **Name** | FormFlow |
| **Tagline** | Sketch in the air. Spin it around in 3D. |
| **One sentence** | A webcam turns your hands into a 3D sketching tool that runs in the browser: pick a shape, pinch and drag in the air, and build a 3D scene you can rotate, move, import into and export. |
| **Type** | Web application, college computer-vision course project |
| **Owner** | Saran (Git user `saranskumar`), solo developer |
| **Front end** | Plain JavaScript modules, Three.js (WebGL), MediaPipe Hand Landmarker (WASM, GPU delegate), Web Speech API |
| **Back end** | Python 3.12, FastAPI, WebSocket (serves the app, saves exports and settings) |
| **Hardware needed** | One webcam. No depth camera, special gloves or markers. Works with a laptop camera and with a camera far away feeding a projector. |
| **Model training** | None. MediaPipe's hand model is pretrained and used as an input sensor. |
| **Size** | About 4,300 lines of JavaScript, 200 of Python, 178 automated tests (157 JavaScript, 21 Python) |
| **Output** | 3D scenes exported as OBJ (meshes and lines) and STL (solids) |

---

## 2. What it is

### 2.1 The product in plain words
You open a page, allow the camera, and your hands become the input device. One hand draws: pinch your thumb and index finger and drag to draw a curve, or pick a shape (cube, sphere, cylinder, cone, pyramid, line, rectangle, circle), pinch at the centre and drag outward to size it. The other hand navigates: a fist orbits the camera, a peace sign pans, and pinching with both hands zooms. A thumb-and-middle-finger pinch grabs and moves an existing object. Your own `.obj` or `.stl` models can be dropped in and moved around the same way. Everything also works by voice, keyboard and mouse.

### 2.2 The pieces
| Piece | Purpose |
|---|---|
| **Onboarding guide** | Shown on launch, skippable. Welcome; choose which hand draws; animated gesture index; a table of every action with its hand, gesture, voice command, key and button; and a practice step that checks your tracking. |
| **Workspace** | A full-screen 3D view (Three.js) with your camera feed behind it, floating tool and action docks, status chips and a message bar. |
| **Settings panel** | Drawing hand (left or right), distance from the camera, detection sensitivity, and reach-area calibration. |
| **Bridge** | The Python server. Saves exported files to disk, keeps settings, lists models in an `imports` folder. The app still works without it. |

### 2.3 What you can create
| Kind | Tools | What it is |
|---|---|---|
| Curves | Freehand | A smoothed, evenly spaced 3D polyline |
| Flat shapes | Line, Rectangle, Circle | Polylines on the current drawing plane |
| Solids | Cube, Sphere, Cylinder, Cone, Pyramid | Closed, outward-facing triangle meshes with a translucent fill |
| Imported models | Import | Any OBJ or STL, fitted to the grid and shaded |
| Joined lines | Join lines (and the prompt after each freehand stroke) | Strokes stitched into one line, or closed into a loop |
| **Visual hull** | Visual hull panel | A 3D shape built from closed outlines drawn in the Front, Side and Top views |
| Editing | Move, Scale, Undo, Clear | Reposition and resize objects, remove the last one, wipe the scene |

### 2.4 What it is not
- Not CAD: shapes are sized by dragging, with no dimensions or constraints.
- No real-world scale: the workspace uses abstract units, not millimetres.
- No true depth from one camera: depth is chosen by the user (buttons or voice), not measured.
- No project files: scenes leave as OBJ/STL, and OBJ/STL models can come back in, but there is no save-and-reopen format.
- No trained model of our own.

---

## 3. Why it exists

### 3.1 The problem
Making even a rough 3D model normally needs CAD software and the skill to use it. Someone who only wants to know "what would my idea look like in 3D?" pays a heavy setup cost before getting any answer.

### 3.2 The idea
Use the one sensor almost every computer has, the webcam, and the one tool everybody already knows how to use, their hands. For a classroom or presentation, a camera across the room plus a projector turns a wall into a 3D sketchpad.

### 3.3 Why it makes a good course project
- It combines several computer-vision topics in one pipeline: hand landmark tracking, signal filtering, gesture recognition, camera and projection geometry, mesh generation, calibration and real-time rendering.
- It is demonstrable in seconds.
- It has measurable engineering content (latency work, filter behaviour, 178 tests) beyond wrapping a library.
- The accurate claim is that it integrates known techniques into a usable workflow. It does not claim to invent hand tracking or 3D sketching.

### 3.4 Why these choices
| Choice | Reason |
|---|---|
| **Run in the browser** | MediaPipe runs on the GPU in the browser and Three.js draws on the GPU, which removed the lag the CPU-drawn Python window had. Nothing to install for the audience beyond a page. Flash was never an option (end of life since 2020). |
| **Python only as a bridge** | The browser needs a server to load modules and a way to write files to disk. Python (FastAPI) is small, quick to write and tested. All real-time work stays in the browser. |
| **Pure JavaScript logic modules** | The gesture decoder, signal cleaning, sketch engine, shapes and file parsers have no browser dependencies, so they run and are tested in Node. |
| **Everything vendored** | Three.js, MediaPipe, its WASM runtime and the hand model are in `web/vendor`, so the app works offline (voice recognition is the exception). |
| **Camera-facing drawing plane** | A single webcam gives x and y, not depth. Drawing on a "sheet of glass" that always faces the viewer, then orbiting, builds any 3D shape from a few gestures without pretending to measure depth. |
| **Drag-to-size shapes** | Drawing a perfect cube freehand with a shaky hand is hopeless; one pinch-and-drag defines it. |
| **Two hands with fixed roles** | One hand draws while the other navigates, at the same time, with no mode switching. Which hand is which is a setting. |
| **Pinch-only selection** | Hover-to-select caused accidental presses and fatigue, so every selection is a deliberate pinch or click. |
| **Mouse and voice fallback** | A demo must survive a dead camera or bad lighting. |

---

## 4. Who
| Role | Person / group |
|---|---|
| **Builder and owner** | Saran, solo developer |
| **Primary audience** | Course instructors and classmates evaluating the project |
| **Intended users** | Beginners who want to visualise a 3D idea quickly; presenters using a camera and projector |
| **Not aimed at** | Engineers needing precise, dimensioned parts |
| **Tools used while building** | An AI coding assistant (Claude Code) helped write, test and profile the code under the owner's direction. The owner chose the direction and judged the results. |

---

## 5. When: the history
1. **Proposal.** Idea brief, PRD, architecture and phased plan (in `docs/`): air sketching plus a three-view reconstruction mode.
2. **First implementation, deleted.** A complete Python desktop version was built, then removed by the owner as unsatisfactory (git commit "flushed code"). Nothing from it was reused.
3. **Study of prior art** (section 11).
4. **Desktop rebuild, stage by stage:** geometry core, three-view builder, MediaPipe hand input, camera switching, then a pivot to gesture-driven 3D sketching as the main product, with shapes, a move tool, calibration, movement refinement and two-hand control, import and the release-drop fix.
5. **Performance.** The desktop window drew every frame on the CPU. Profiling showed rendering was the cost (36 ms to 11 ms after fixes), but the owner wanted a smoother, web-based product.
6. **Web version.** The product was rebuilt as a browser app with a Python bridge, carrying over the tested logic. New there: onboarding guide, voice commands, thumb+middle grab, peace-sign pan, two-hand pinch zoom, dock-style HUD.
7. **Web only.** Settings were added (choose the drawing hand, distance presets, high sensitivity, reach calibration), small and distant hands are supported (crop-and-follow detection), and the Python desktop window app was **removed**. Its code, including the three-view reconstruction that only the desktop app used, is kept as a zip backup (`_removed_desktop_app.zip` next to this file) and nothing in the project depends on it.

---

## 6. Where things live
```
cv/
  bible.md                    this document
  _removed_desktop_app.zip    backup of the removed Python desktop app (safe to delete)
  docs/                       original proposal documents
  code/
    run.bat                   one-click launcher (sets up Python, starts the server, opens the browser)
    requirements.txt          fastapi, uvicorn, websockets, httpx, pytest
    pytest.ini
    server/                   Python bridge: app.py (FastAPI), __main__.py (launcher)
    tests/test_server.py      21 server tests
    web/
      index.html, css/app.css
      vendor/                 Three.js, MediaPipe bundle, WASM runtime, hand_landmarker.task (all local)
      js/main.js              wiring: camera, tracking, settings, commands, loop
      js/bridge.js            WebSocket client
      js/core/                pure logic (unit-tested in Node)
      js/render/scene.js      Three.js scene
      js/ui/                  hud.js, overlay.js, guide.js, settings.js
      test/                   117 JavaScript tests
    exports/                  created on first export (also receives server-side copies)
    imports/                  optional: drop .obj/.stl files here to import them with a pinch or a voice command
    calibration_web.json      settings saved by the server (created on first change)
```

### Core modules (`web/js/core`)
| File | Responsibility |
|---|---|
| `gestures.js` | Pinch, grab, fist and peace-sign recognition from the 21 hand landmarks |
| `track.js` | Per-hand signal cleaning: smoothing, glitch rejection, pinch latch, release freeze, small-hand adaptation |
| `select.js` | Picks the user's own hands (at most two) and assigns drawing and navigation roles |
| `mapping.js` | Camera image to screen, equal axis speed, reach area |
| `settings.js` | Settings model, range presets, validation |
| `roi.js` | Zoom-and-follow crop planning for small, distant hands |
| `reach.js` | Reach-area calibration |
| `controls.js` | The single table of actions, hands, gestures, voice, keys and buttons |
| `controller.js` | The gesture state machine: what each gesture does |
| `sketch.js` | The 3D engine: camera, drawing plane, tools, picking, drag, release commit |
| `shapes.js` | Items, solids, meshes, stroke normalisation |
| `meshio.js`, `imported.js` | OBJ/STL parsing, fitting, decimation, imported models |
| `exporters.js` | OBJ and binary STL writers |
| `voice.js` | Voice command parsing and the Web Speech wrapper |
| `practice.js` | The practice step in the guide, and personal pinch thresholds |

### Where data goes
| Data | Location |
|---|---|
| Settings | Browser `localStorage` and `code/calibration_web.json` (via the bridge) |
| Exports | Downloaded by the browser and also saved to `code/exports/` by the bridge |
| Nothing else is stored | No database, no cloud. Camera frames stay in the browser and are never uploaded. |

---

## 7. How it works

### 7.1 The pipeline
```
Webcam (up to 1920x1080)
  -> [far ranges] crop around the hands -> MediaPipe Hand Landmarker (GPU), up to 4 candidate hands
  -> map landmarks back to the full frame, mirror, work out left or right
  -> keep at most two of the user's own hands, assign: drawing hand / navigation hand
  -> per-hand cleaning (HandTrack): smoothing, glitch rejection, pinch latch, release freeze
  -> gesture decoding: pinch, grab, fist, peace
  -> map to the screen (reach area, equal axis speed)
  -> Controller (state machine) -> Sketch engine -> Three.js scene (WebGL) + HUD + skeleton overlay
```
Everything runs in the browser's main loop; the server is not in the real-time path.

### 7.2 Gestures
| Gesture | How it is detected |
|---|---|
| **Pinch** (thumb + index) | Thumb-to-index distance divided by palm size, so it works at any distance; on and off thresholds differ (hysteresis) and it must persist 2 frames (3 for small hands) |
| **Grab** (thumb + middle) | The same, using the middle finger, and only when it is clearly closer than the index finger |
| **Fist** | All four fingertips closer to the wrist than their middle joints |
| **Peace sign** | Index and middle extended, ring and little finger curled, thumb free |
Gestures are mutually exclusive and debounced, so one noisy frame never toggles anything. Thresholds start at 0.30 (on) and 0.45 (off) and are tuned to the user during the practice step.

### 7.3 Choosing the user's hands
MediaPipe is asked for up to four hands. `selectUserHands` keeps at most two: the largest (closest to the camera, so the user's, not a bystander's), favouring the one near where the drawing hand was last seen; a second hand is kept only if it is the opposite hand and at least 55% of the first's size (70% and well separated if both are labelled alike). Hands below a minimum size are ignored, and that minimum depends on the distance setting. Then `assignRoles` makes the user's chosen drawing hand the main hand (cyan) and the other the navigation hand (magenta); a single visible hand is always the drawing hand. The camera image is not mirrored when processed, so MediaPipe's left and right labels are swapped to match the user's real hands.

### 7.4 Making movement feel right
| Step | What it fixes |
|---|---|
| One-Euro filter | Jitter when still without lag when fast |
| Glitch rejection | A one-frame tracking leap across the image is held back for up to 3 frames |
| Pinch-onset latch | The cursor drifting as the fingers close; at pinch start it rewinds 0.15 s and holds 0.08 s |
| **Release commit** | On release an object is rewound to where it was 0.15 s earlier (0.10 s for strokes) and input is ignored for 0.3 s, so it stays exactly where it was let go. If the whole gesture fits inside the rewind window (a quick flick), the final position is used so it is never rewound into nothing. |
| Reach mapping | The calibrated or preset area of the camera image maps onto the whole screen |
| Equal axis speed | The area is adjusted so the same hand movement moves the cursor equally far horizontally and vertically |
| Stroke normalisation | Freehand curves are smoothed and resampled to even spacing |
| Orbit cap and inertia | A glitch cannot spin the view; after a fist opens the view coasts to a stop |

### 7.5 Small and distant hands (projector setups)
A hand across the room fills only a few percent of the picture; the detector looks at a small downscaled image, so it would miss it. The fixes work together:
- **Higher resolution:** the camera is asked for 1920x1080.
- **Zoom and follow:** for the Medium, Far and Auto ranges the detector is fed a crop of the picture instead of the whole frame. Medium crops to 70%, Far to 50%, and **Auto** follows the hands: a square crop around them, sized from the hands' own size (nine palm-widths, never below 30% of the picture), eased so it does not jump, with a whole-frame scan every 20 frames to find a second hand or a newcomer. The hands are several times larger to the detector. Landmarks are mapped back to the full frame, so everything downstream is unaffected. A faint dashed rectangle shows where the detector is looking.
- **Looser detection:** Far, Auto and "High sensitivity" lower the detection, presence and tracking confidence from 0.6 to 0.35.
- **Smaller minimum hand size:** 0.035 of the picture height for Near, 0.018 Medium, 0.010 Far and Auto.
- **Adaptive steadiness:** small hands have noisier landmarks, so smoothing is stronger and a gesture must persist one frame longer when the palm is small.
- **Reach calibration:** the user shows the camera the top-left and bottom-right of their working area (for a projector, the projected surface) by holding the hand still for a second at each; that box is mapped to the whole screen, so even a tiny hand reaches every corner. Without it, a preset area for the chosen distance is used.
Near uses the whole frame with MediaPipe's temporal tracking (fastest); the cropped ranges use per-image detection.

### 7.6 The sketch engine
**World:** X right, Y up, Z toward the viewer; the workspace is the cube from -1 to +1. **Camera:** an orbit camera (yaw, pitch, distance, plus a pan target); the engine's pinhole model matches Three.js's perspective camera exactly, so what is picked is what is drawn. **Drawing on glass:** the cursor ray is intersected with a plane that always faces the camera at an adjustable depth (-1 to +1); orbit and the plane turns with you. **Tools:** drag from an anchor to a point sizes the shape; a drag shorter than 0.03 units is ignored; solids are axis-aligned and Y-up. **Picking:** solids by centre and apparent radius, lines by distance to the polyline. **Imported models** fit inside a 1.7-unit cube whatever their original units and are drawn from a simplified copy (at most 1,200 triangles) while export keeps the full mesh.

### 7.7 Rendering
Three.js draws on the GPU: the floor grid, bounding cube, axes, the drawing plane, translucent fills and edge wireframes for solids, thick instanced lines for curves, shaded meshes for imports, and a 3D cursor with a drop line for depth. Your camera feed is a mirrored video element behind the canvas; hand skeletons and cursors are drawn on a 2D overlay in cyan (drawing hand) and magenta (navigation hand), with a white dot for pinch and a coloured ring for fist and peace.

### 7.8 Export and import
- **OBJ:** solids and imports as triangle faces, everything else as polylines. **STL:** binary, solids and imports only (written only when there is at least one). Files download in the browser and are also saved by the bridge to `code/exports/`.
- **Import:** drag a file onto the page, use Import model → Browse, or pick from the `imports` folder list (the folder list works with a pinch or voice, because a native file chooser cannot be opened without a real click). Own parsers handle OBJ in every index style and ASCII/binary STL; bad files give a readable message and never crash the app.

### 7.9 Voice
The Web Speech API (Chrome or Edge; recognition is online) listens continuously once the microphone is enabled. Phrases are matched whole-word, more specific phrases win, and the latest command in an utterance wins. Misheard near-words for tools (such as "queue" for cube) are accepted; ordinary words such as "can" are deliberately not.

### 7.10 Joining lines
A hand never lands exactly on the start of a loop or the end of another line. After each freehand stroke the app checks for two things: a stroke whose own ends almost meet (and that is long enough to be a loop), and another line whose end is near the new stroke's end. The nearest candidate wins, and the app **asks** with a small prompt: "Close this loop?" or "Join these two lines?", with the gap highlighted by two magenta dots in the scene. Pinch (or click) **Join**, say "yes", or press `Y`; "Keep open / Keep separate", "no" or `N` dismiss it; starting a new stroke also dismisses it, and an unanswered prompt expires after 14 s and cannot be applied later. **Stitch all nearby** (and the **Join lines** button, `J`, "join lines") merges every chain of nearby ends and closes every near-loop at once. Joining replaces the two touching ends with their midpoint, so there is no gap and no duplicate point, closing makes the last point the first, and every join is one undoable step that restores the original strokes where they were. "Ask me / Never ask" is a setting. Rectangles and circles are already closed.

### 7.11 Visual hull: a 3D shape from outlines
The idea is the engineering drawing: describe an object by its outline from the front, the side and the top, and the program finds the 3D shape consistent with all of them. Each outline is a silhouette; extruding a silhouette along its viewing direction gives a solid that certainly contains the object, and the object must lie inside all of them, so the best guess is their **intersection**.
1. **Views.** The Visual hull panel (button, `U`, or "visual hull") has Front, Side and Top buttons (also `F`, `L`, `T`, or "front view"). Each snaps the camera to look straight down that axis and selects Freehand, so an outline drawn now lies on a true flat plane. A badge shows which view you are in.
2. **Outlines.** Draw a closed outline per view. The panel shows a tick and a count for each view. Outlines are classified by the flat plane they lie in (an outline that varies less than 0.02 along one axis); oblique ones are reported so you can redraw them in a view. Open outlines that nearly close are closed automatically, and others are reported with "press Join lines".
3. **Match views.** Two views often disagree about a shared dimension (the front and top both measure the width). With "Match views" on, each shared dimension is averaged across the views that measure it and each outline is stretched and shifted to agree, and a warning appears when views differ by more than 35%. Off, the outlines are used exactly as drawn.
4. **Make 3D.** Silhouettes are rasterised into masks, a voxel grid (Fast 48, Normal 64, Fine 96 per side) keeps only voxels inside every view's mask, tiny stray pieces are dropped (the largest is kept and the user is told), and a smooth watertight mesh is extracted with surface nets after a light blur. With two views all three dimensions are fixed; with one view the shape is extruded to a default thickness and the user is told so.
5. **Result.** The panel reports how well the hull matches each drawing (how much of each outline is still covered when the hull is projected back, as a percentage), plus any warnings. The new shape is an ordinary object: grab it, scale it, export it as OBJ or STL, or Undo to remove it and edit the outlines (which stay in the scene).
Known limits of the method: a visual hull cannot recover hollows or dents that no outline shows, and holes inside an outline are not supported (outlines are filled). Separate outlines in one view are combined (union).

### 7.11b The 3-Plane Hull mode
The switch at the top of the screen (key **P**, voice "three plane mode" / "sketch mode") swaps the air-sketch view for an engineering-drawing workspace: **Top** and **Front** share the X axis (their columns line up), **Front** and **Side** share Y (their rows line up), and a perspective **3D preview** sits in the fourth cell. Each drawing cell is orthographic at the same scale, so whatever is drawn there is a true silhouette and lands exactly flat on its plane (`core/planes.js`, `Sketch.layout`). A stroke stays in the cell it started in even if the hand strays. Thin guide lines carry each measured dimension into the other views, and turn orange when two views disagree about it by more than 15%. The hull is rebuilt live (about every 0.3 s, only when the outlines change) into the preview cell. **Make 3D** builds the final shape at higher detail, adds it as a normal object and returns to the 3D Sketch view so it can be moved, scaled or exported. The navigation hand and mouse orbit/zoom only affect the preview cell.

### 7.11c Hand detection stability
`core/tracker.js` (HandTracker) sits between MediaPipe and the gesture code: it keeps hand identity by position continuity (MediaPipe's Left/Right label flips are ignored), removes duplicate "ghost" detections, rejects one-frame false hands, bridges dropouts shorter than 0.25 s, and uses MediaPipe's 3D world landmarks so turning the wrist is not mistaken for a pinch. Press **D** (or open `?debug`) for a live panel showing detector fps and how often each fix fired.

### 7.12 The bridge (Python)
`GET /api/health`, `GET /api/models`, `GET /api/models/{name}` (plain names that really exist in `imports/`, so no path traversal), `GET/PUT /api/calibration`, and WebSocket `/ws` with message types `hello`, `ping`, `calibration` and `export`. Export names are validated, sizes are limited, STL data is checked as base64, malformed messages get an error reply and the connection stays open. OBJ files are written as exact bytes (no CRLF conversion on Windows). Static files are served with correct types for `.mjs`, `.wasm` and `.task`.

---

## 8. Controls reference
The guide shows this same table (`controls.js` is the single source), with "Left hand" or "Right hand" filled in from your choice.

| Action | Hand | Gesture | Say | Key | Button |
|---|---|---|---|---|---|
| Draw a curve | Drawing | Pinch thumb + index, move | "freehand" | 1 | Freehand |
| Place a shape | Drawing | Pinch at the centre, drag outward, release | "cube" · "sphere" · "cylinder" · "cone" · "pyramid" | 2 – 9 | Tools dock |
| Move an object | Drawing | Pinch thumb + middle, move | "move" | 0 | Move |
| Resize an object | Drawing | Scale tool: pinch it, drag up or down | "scale" | X | Scale |
| Press a button | Drawing | Pinch while pointing at it | | | any button |
| Orbit | Navigation | Fist, move | | | |
| Pan | Navigation | Peace sign, move | | | |
| Zoom | Both | Pinch with both hands, move apart or together | "zoom in" · "zoom out" | + − | |
| Join / stitch lines | | After a freehand stroke a prompt asks: pinch Join | "join lines" · "stitch" · "yes" | J | Join lines |
| Look at the Front, Side or Top | | | "front view" · "side view" · "top view" | F · L · T | Visual hull panel |
| Make a 3D shape from outlines | | Draw closed outlines in two or three views, then press Make 3D | "make 3D" · "visual hull" | U | Visual hull |
| Undo | | | "undo" | Z | Undo |
| Clear the scene | | | "clear scene" | C | Clear scene |
| Import | | Drag a file onto the page | "import" | I | Import model |
| Export | | | "export" · "export STL" | E | Export OBJ / STL |
| Depth | | | "closer" · "farther" | [ ] | Depth − / + |
| Reset view | | | "reset view" | V | Reset view |
| Swap hands | | | "swap hands" | H | Settings |

Answering the join prompt: `Y` / `Enter` = yes, `N` / `Esc` = no. Also: `M` voice on/off, `G` the guide, `S` snap to grid, `,` settings. Mouse: left-drag draws, shift+left-drag grabs, right-drag orbits, middle-drag pans, wheel zooms. Settings: **Drawing hand** (Left or Right), **Distance** (Near, Medium, Far, Auto-follow), **Hand detection** (Normal or High sensitivity), **Reach area** (Calibrate or Reset).

---

## 9. Numbers
| Item | Value |
|---|---|
| Automated tests | 178 (157 JavaScript in Node, 21 Python) |
| Pinch thresholds | 0.30 on, 0.45 off, then tuned per user |
| Release commit | rewind 0.15 s (drags) or 0.10 s (strokes), ignore input 0.3 s |
| Minimum hand size | 0.035 / 0.018 / 0.010 / 0.010 of picture height (Near / Medium / Far / Auto) |
| Crop sizes | 100% / 70% / 50% / follows the hands (not below 30%) |
| Detection confidence | 0.6 normal; 0.35 for High sensitivity, Far and Auto |
| Camera request | 1920x1080 at 30 fps |
| Workspace | cube of half-size 1; points clamped to 1.2 |
| Imported model display | at most 1,200 triangles (export keeps the full mesh) |
| Stroke spacing | 0.03 units |

---

## 10. Decisions and the reasons behind them
| Decision | Why |
|---|---|
| Rebuild from scratch after the first version was deleted | The owner judged it poor; starting clean allowed a testable design built around a single pointer-style input abstraction |
| Geometry before hands | The hard maths could be built and tested with synthetic data before any camera work |
| Move to the browser, keep Python only as a bridge | GPU hand tracking and GPU rendering remove CPU-bound lag; the audience needs only a page |
| Logic in pure JavaScript modules | Unit-testable in Node, no hidden browser state |
| Remove the Python window app | The project is web-only now; keeping a second, slower front end would split effort. A zip backup was kept in case it is ever wanted. |
| Own 3D viewport maths matching Three.js | Picking and drawing must agree exactly with what is rendered |
| One controls table feeding the guide | What the guide says can never drift from what the app does |
| Choose which hand draws | Left-handed users, and setups where one hand is out of view |
| Crop-and-follow detection | The only reliable way to detect small hands without a different model |
| Reach calibration | The same physical hand movement must cover the whole projected surface at any distance |
| Rewind on release, with a flick fallback | Opening the fingers moves the hand before the pinch is seen to end; found and fixed a bug where a very quick flick was rewound to nothing |
| Settings saved in the browser and by the bridge | Survive reloads; the bridge copy lets a presentation machine keep its calibration |
| Strict two-hand filter | A bystander's hands must never steal the cursor |

---

## 11. Prior art: what we studied
Projects read for ideas (their code was not copied):

| Project | Idea taken |
|---|---|
| **2D-to-3D-Converter** (Fatcatcreate) | Mask cleanup and mesh post-processing for a visual hull (not used in the web version) |
| **Air Canvas AI** (DhananjayGharat, MIT) | Hold-to-confirm for destructive actions; drawing layer over the video; HUD with mode and FPS |
| **GestureCAD** (kattapuneeth14-ui, MIT) | Edge-triggered pinch, thresholds scaled to hand size, gesture-coloured skeleton, hover-and-pinch toolbar, mouse fallback |
| **gesturecad** (Vagvedi, MIT) | Guarded resets, sketch-then-commit previews, two-hand interaction |

What FormFlow adds: several 3D primitives and imported models in one scene, with a live camera behind it; two-hand navigation with a choice of drawing hand; per-user and per-distance calibration including small, far-away hands; a guided tour and practice step; voice control; and measured, tested signal cleaning. No claim is made that any single technique is new.

---

## 12. Limits and honest unknowns

**Known limits**
- Depth is chosen, not measured.
- Scenes cannot be saved and reopened; only OBJ/STL export and import exist.
- Units are abstract; exported models have no real-world scale.
- Moving or scaling an object cannot be undone (undo removes the last object drawn).
- Lines and flat shapes do not appear in STL.
- The visual hull cannot recover hollows or dents that no outline shows, does not support holes inside an outline, and needs closed outlines drawn in the Front, Side or Top view.
- Imported models are shown simplified, with no textures or colours.
- Voice recognition needs Chrome or Edge, a microphone and an internet connection.
- Hand tracking depends on lighting, background and camera.
- The three-view reconstruction (draw front, top and side, get a 3D mesh) existed only in the removed desktop app and is not in the web version; it can be recovered from the backup zip.

**Not yet verified on real hardware**
- The live camera path: MediaPipe in the browser on a real hand, including the GPU delegate and its CPU fallback.
- The crop-and-follow pipeline on real far-away footage. Its geometry (crop, map back, follow, easing, planner) is unit-tested, and a small hand is shown to look 2.4 times or more larger to the detector, but only a real camera shows how much detection actually improves.
- Voice recognition.
- Reliability of the thumb+middle grab and the peace sign on real hands (tested with synthetic landmarks only), and of MediaPipe's left/right labels (the Swap hands setting is the remedy).
- Performance on a real GPU. In the test browser (software rendering) the page ran at 25 to 40 fps.

**Verified in a real browser:** an L-bracket drawn as three outlines in the three snapped views, each closed through the join prompt, builds a 3D shape that matches all three drawings; two lines joined by a real click on the prompt button and undone; the app boots with no errors; all guide pages render and react to the hand choice; the distance, hand and sensitivity settings change the pipeline; real mouse drags create shapes; a scripted hand session draws, grabs, moves, orbits and pans; models import; export reaches disk through the bridge with the right triangle counts.

---

## 13. FAQ

**What is FormFlow in one line?** A browser-based 3D sketching tool where you build scenes from shapes using your hands.

**Does it use AI?** It uses MediaPipe's pretrained hand model as a sensor. The project trains no model; everything after the landmarks (filtering, gestures, geometry, rendering) is written for this project.

**Do I need special hardware?** No. A webcam and a modern browser (Chrome or Edge recommended). A GPU helps but is not required.

**How do I run it?** Double-click `code/run.bat`. It sets up Python on first run, starts the server and opens `http://127.0.0.1:8000`. Allow the camera (and the microphone for voice).

**Is Python needed at all?** Only as the small local server that serves the page and saves files. There is no Python window and no Python video processing.

**How can one camera give 3D?** It does not measure 3D. It tracks where your hand is in the image; the app turns that into a 3D scene by letting you draw on a camera-facing plane whose depth you choose, then orbiting the view.

**Which hand draws?** Your choice: in the guide, in Settings (⚙), by pressing H, or by saying "swap hands". The drawing hand is cyan, the navigation hand magenta, and the guide's table always names the physical hand.

**We use a camera far away with a projector. What should I do?** Open Settings and set the distance to Far (camera across the room) or Auto-follow (it zooms in on your hands wherever they are). Turn on High sensitivity if hands are still missed, then use Calibrate reach: hold your hand at the top-left and then the bottom-right of the projected surface. After that, small movements reach every corner of the screen. A faint dashed box shows where the detector is looking.

**Why does it not react when I hover over a button?** By design. Hovering never activates anything; pinch (or click) to press.

**An object jumped when I let go. Why?** It should not any more: on release the object returns to where it was just before the fingers opened and input is ignored for 0.3 s.

**Can I import my own model?** Yes: drag an OBJ or STL onto the page, or use Import model. Models are fitted to the grid and can be moved and scaled like any other object.

**What can I export?** OBJ (solids, imports and lines) and STL (solids and imports). Both download in the browser and are also saved under `code/exports/`.

**Can I 3D-print it?** The STL is made of closed solids, so a slicer can open it, but sizes are abstract, so you must scale it. It is an ideation prototype, not a dimensioned part.

**What if there is no camera?** Continue with the mouse from the guide: left-drag draws, shift+left-drag grabs, right-drag orbits, middle-drag pans, the wheel zooms.

**Why was the Python window app removed?** The project is web-only now: the browser version is smoother (GPU tracking and rendering), and keeping two front ends would split effort. A backup zip exists.

**Is any data collected or sent anywhere?** No. Camera frames are processed in the browser and never leave it. Voice recognition in Chrome uses the browser's own speech service. The only files written are exports and settings.

**How is quality checked?** 157 JavaScript tests cover gesture recognition, hand selection, signal cleaning, mapping, the crop pipeline, reach calibration, line stitching, the visual hull, the controls table, the sketch engine, the gesture state machine, geometry (solids are closed manifolds with correct volumes), OBJ/STL parsing and export, and voice parsing. 21 Python tests cover the server, including path-traversal and malformed-message handling.

**How do I make a 3D shape from drawings?** Open **Visual hull** (the button, or press `U`). Pick **Front**, draw a closed outline with Freehand (if the ends nearly meet, the app offers to close it), pick **Side** or **Top** and draw that outline too, then press **Make 3D**. Two views are enough; a third makes it more exact.

**Why does it ask me to join lines?** Hands never land exactly on a start or an end. After a freehand stroke the app notices a near-loop or a nearby line end and asks. You can answer with a pinch, a click, "yes" or "no", ignore it, or turn it off in Settings. "Join lines" does it for everything at once.

**The hull is too fat, too thin or the wrong size. Why?** Each view fixes two dimensions, and views drawn at different sizes disagree. "Match views" averages shared dimensions; turn it off to use the outlines exactly. The panel's percentages show how well the hull explains each drawing.

---

## 14. Glossary
| Term | Meaning |
|---|---|
| **Drawing hand** (cyan) | The hand that draws, places, grabs and presses buttons |
| **Navigation hand** (magenta) | The other hand: fist orbits, peace sign pans |
| **Pinch** | Thumb and index finger together |
| **Grab** | Thumb and middle finger together |
| **Landmark** | One of 21 tracked points on a hand |
| **Palm size** | Wrist-to-knuckle distance in the picture; used to make gestures independent of distance |
| **Hysteresis / debounce** | Different on and off thresholds, and requiring a change to last a few frames, so gestures do not flicker |
| **One-Euro filter** | Smooths strongly when you move slowly and lightly when you move fast |
| **Latch / freeze** | Holding the cursor briefly at pinch start or release to ignore the drift caused by moving the fingers |
| **Release commit** | Rewinding to just before the release and ignoring input for 0.3 s so a dropped object stays put |
| **Crop-and-follow** | Feeding the detector a zoomed crop around your hands so small, distant hands become detectable |
| **Reach area** | The part of the camera picture mapped onto the whole screen |
| **Drawing plane / glass** | The camera-facing plane, at an adjustable depth, where the cursor ray lands |
| **Solid** | A closed 3D shape with a triangle mesh (cube, sphere, cylinder, cone, pyramid) or an imported model |
| **OBJ / STL** | Common 3D file formats; OBJ can hold meshes and lines, STL only triangle meshes |
| **Bridge** | The small Python server that serves the page and saves files |
| **Silhouette / outline** | The closed outline of an object seen from one side (front, side or top) |
| **Visual hull** | The 3D shape that is inside every view's silhouette: the intersection of the extruded outlines |
| **Voxel** | One cell of the 3D grid used to build the hull |
| **Surface nets** | The method that turns the voxel grid into a smooth triangle surface |
| **Stitch / join** | Merging two lines end to end, or closing a line into a loop |

> **3-Plane Hull, reference images.** In that mode, *Trace an image* (or dropping an image file on a cell) puts a photo or drawing behind the Front, Side or Top view. Size, Move, Fade, Flip and Remove buttons line it up, then you trace the outline with Freehand. Images are never part of the exported model. (`ui/refimages.js`)

> **3-Plane Hull, shapes from photos.** The plane bar's *Shapes* switch has two sources: **Draw outlines** (by hand) or **From photos**. In photo mode, uploading a picture to Front, Side or Top finds the object's silhouette automatically (`core/trace.js`: background taken from the picture border or its transparency, Otsu threshold, largest blob, holes filled, boundary walk, simplification) and places it as a closed outline on that plane. *Object is* Auto / Dark / Light handles scans and pencil drawings. Size / Move / Flip move the outline with the picture. Make 3D then builds the hull as usual. Limits: one object per picture, and the photo must be a straight-on view with a reasonably plain background.

> **Forearm tracking and wrist anchoring.** Two additions for steadier tracking. (1) The pointer rides on the wrist/palm point (steady) and only the pinch point's *offset* from it is low-passed, so fingertip jitter and the drag of closing a pinch no longer move the cursor (`core/track.js`). (2) A MediaPipe Pose model (`vendor/pose_landmarker_lite.task`, about 5.8 MB, run on every third frame) follows the wrist and elbow (`core/forearm.js`). The hand tracker uses it as a second opinion: a hand missed while its wrist is still seen is held 0.5 s instead of 0.25 s and follows the arm so it is re-found where it went; a new hand on a known wrist is accepted one frame sooner; and in Auto-follow the crop aims at a wrist when the hand is lost. Settings › Forearm tracking turns it off. Press D to see how often it helped. Not yet verified with a real camera.

> **3-Plane Hull UI (revised).** Each of the Front, Side and Top views now has its own toolbar: **Add photo** (or drop an image on the view), then **Auto** (the outline is found in the photo; *Object: Auto / Dark / Light* if it misses) or **Trace** (the photo stays as a faint guide and you draw over it). **✥** turns on adjusting: dragging in that view moves the photo and its outline, and the mouse wheel resizes it; **− +** resize, **◐** cycles opacity, **⇋** mirrors, **✕** removes. So one view can be drawn and another taken from a photo. The bottom bar is one compact row: progress per view, Preview / Detail / Match sizes, Join lines, Clear view, Make 3D. 3D-only tools (solids, Scale, Depth) are hidden in this mode. Clear scene is now undoable. Accessibility pass: visible keyboard focus, `aria-pressed` on toggles, a polite live region for messages, real buttons for the guide's page dots, dark `color-scheme`, and clicking outside Settings closes it.

> **Demo scenes.** Opening the app with `?nocam&demo=sketch|hands|planes|photo|photohull|hull` (and `&set=head|house|rocket|vase` for the photo scenes) builds a ready-made scene through the same hooks the tests use. It was used to take the screenshots for `Presentation/FormFlow_Final_Presentation.pptx` (code: `web/js/demo.js`).
