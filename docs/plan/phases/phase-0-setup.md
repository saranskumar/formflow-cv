# Phase 0 - Setup & Skeleton

**Track:** Shared | **Depends on:** nothing | **Unlocks:** Phase 1
**Back to:** [Roadmap](../00-roadmap.md)

## Goal

A working Python environment where webcam, MediaPipe, OpenCV and Open3D all coexist, plus an empty but runnable app shell.

## Tasks

### 0.1 Environment
- [ ] Install Python 3.11, create `venv`
- [ ] Create `requirements.txt` with pinned versions
- [ ] Install: opencv-python, mediapipe, open3d, numpy, scikit-image, scipy, pytest
- [ ] Record `pip freeze` into `requirements.lock.txt`

### 0.2 Repo
- [ ] `git init`, `.gitignore` (venv, `__pycache__`, samples/exports)
- [ ] Create folder layout from [tech-spec section 2](../tech-spec.md)
- [ ] Stub packages with `__init__.py`
- [ ] `CHANGELOG.md`, `README.md` (run instructions)

### 0.3 Feasibility spike (one throwaway script)
- [ ] Open webcam with OpenCV, display at >= 20 FPS
- [ ] Run MediaPipe Hands on frames, draw landmarks
- [ ] Open a non-blocking Open3D window with a rotating cube in the same loop as the OpenCV window
- [ ] Confirm no freezes after 5 min
- [ ] Note which camera backend (DSHOW / MSMF) works best

### 0.4 App shell
- [ ] `python -m formflow` starts
- [ ] Mode menu drawn on OpenCV window: Rapid 3D / 2D to 3D / Quit
- [ ] Keyboard `1` / `2` / `Esc` navigation
- [ ] `config.py` dataclass + JSON load/save
- [ ] Logging setup (console + file)
- [ ] Clean shutdown (release camera, close both windows)

### 0.5 Test scaffolding
- [ ] `pytest` runs (one dummy test)
- [ ] `tests/fixtures/` generator script for synthetic shapes (used by Phases 4-5)

## Exit criteria

- [ ] Spike proves OpenCV + MediaPipe + Open3D run together
- [ ] App shell launches and exits cleanly
- [ ] `pytest` passes

## Risks touched
R5 (event loops), R9 (version conflicts), R11 (latency)
