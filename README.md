# FormFlow – Air Sketching in 3D with Your Hands

A college computer-vision project: sketch 3D scenes in mid-air with a webcam. Hands are tracked in the browser
(MediaPipe), gestures are decoded into drawing actions, and the scene is rendered live with Three.js. A small
Python (FastAPI) server hosts the app and saves OBJ/STL exports. Works fully offline.

## Repository layout

| Path | Contents |
|---|---|
| [`code/`](code/README.md) | The application (web app + Python server + tests). **Start here.** |
| `Presentation/` | Project presentation slides (`ppt.html`, `final.html`, `FormFlow_Final_Presentation.pptx`) |
| `docs/`, `project/` | Supporting documents and project material |
| `prd.md`, `bible.md`, `task.md` | Product requirements, design notes and task list |

## Quick start (Windows)

```bat
cd code
run.bat
```

This creates a virtual environment, installs dependencies, starts the server and opens
<http://127.0.0.1:8000> in your browser. Use **Chrome or Edge** and allow camera access.

Other platforms, options, controls, API and troubleshooting: see **[code/README.md](code/README.md)**.

## Highlights
- **Draw in the air**: freehand curves and shapes (cube, sphere, cylinder, cone, pyramid) with pinch gestures; move and
  scale objects; orbit, pan and zoom smoothly with the second hand. Point at a button and hold to press it.
- **Extrude and Cut**: pull a closed outline into a solid, or cut a pocket or hole into one.
- **Photos to 3D**: front, side and top photos (or drawings) become a closed 3D model; one photo of a round object is
  spun into a solid. Open any view full screen to work on it.
- **Demo gallery**: nine ready-made picture sets (rocket, house, castle, robot, airplane, car, vase, pawn, a pencil head).
- **Models**: test the hand models on your own camera and switch the one the app uses.
- **Light and camera help**: brightens a dark or backlit hand, asks the camera for a faster shutter, says what to fix.
- Import and export OBJ / STL; keyboard shortcuts and a mouse fallback; a neutral light interface.

## Tests

```bat
cd code
run.bat test
```
