// Model test: how fast does a model run on THIS computer, and does it find a hand? Pure helpers; main.js runs the models.
//
// Every model here is an official MediaPipe model that runs in the browser. Two are shipped with the app (web/vendor). The
// others are used from web/vendor/models when `python tools/download_models.py` has fetched them (then everything works
// offline), and otherwise downloaded from Google's model storage when tested (internet once; the browser caches them).

const GS = 'https://storage.googleapis.com/mediapipe-models';

/**
 * api: which MediaPipe task runs it. kind: what "found something" means (a hand, or a person). file = in web/vendor/, url =
 * downloaded when tested. picture: the camera picture is shrunk to this width first. delegate: GPU (graphics card) or CPU.
 */
export const MODELS = [
  { id: 'hand-gpu', api: 'hand', kind: 'hand', title: 'Hand Landmarker', delegate: 'GPU', file: 'hand_landmarker.task', size: '7.8 MB', what: 'palm detector + 21 finger points (the one the app uses)' },
  { id: 'hand-cpu', api: 'hand', kind: 'hand', title: 'Hand Landmarker', delegate: 'CPU', file: 'hand_landmarker.task', size: '7.8 MB', what: 'the same model on the processor instead of the graphics card' },
  { id: 'hand-640', api: 'hand', kind: 'hand', title: 'Hand Landmarker, smaller picture', delegate: 'GPU', file: 'hand_landmarker.task', size: '7.8 MB', picture: 640, what: 'the same model, given a 640-pixel copy of each camera picture (less to upload)' },
  { id: 'gesture-gpu', api: 'gesture', kind: 'hand', title: 'Gesture Recognizer', delegate: 'GPU', url: `${GS}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`, local: 'models/gesture_recognizer.task', size: '8.4 MB', what: 'hand points plus a name for the gesture (open palm, pointing, victory...)' },
  { id: 'holistic-gpu', api: 'holistic', kind: 'hand', title: 'Holistic Landmarker', delegate: 'GPU', url: `${GS}/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task`, local: 'models/holistic_landmarker.task', size: '13.7 MB', what: 'both hands, body and face in one model (heavier)' },
];

/** Models that could be tried but are not available in the browser tasks used here: shown so it is clear what exists. */
export const NOT_INSTALLED = [
  { title: 'RTMPose / RTMW hand', how: 'ONNX Runtime Web (WebGPU). Needs a separate hand detector; no published results for blur or backlight in a browser.' },
  { title: 'YOLO hand keypoints', how: 'Draws a box and points but gives no 3D hand shape. Ultralytics YOLO is AGPL-licensed.' },
  { title: 'HaMeR (research)', how: 'Far more accurate hand shape, but needs a GPU server: a few frames a second at best.' },
];

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** ms = time of each run, hits = how many runs found something. */
export function summarize(ms, hits = 0) {
  if (!ms.length) return { runs: 0, mean: 0, p50: 0, p95: 0, max: 0, fps: 0, hitRate: 0 };
  const sorted = [...ms].sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  return { runs: ms.length, mean, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted[sorted.length - 1], fps: 1000 / mean, hitRate: hits / ms.length };
}

/** One line for a result: "8.2 ms per picture (95% under 12.4) · up to 122 fps · hand found in 94%". */
export function describe(r, kind = 'hand') {
  if (!r || !r.runs) return 'no pictures were tested';
  const seen = kind === 'hand' ? 'hand' : 'person';
  const extra = (r.ranOn === 'CPU' ? ' · ran on the processor' : '') + (r.label ? ` · saw: ${r.label}` : '');
  return `${r.mean.toFixed(1)} ms per picture (95% under ${r.p95.toFixed(1)}) · up to ${Math.round(r.fps)} fps · ${seen} found in ${Math.round(r.hitRate * 100)}%${extra}`;
}

/**
 * What a model's result holds, in one shape for drawing: { hands: [[{x, y}...21]...], pose: [{x, y}...33], label }.
 * Coordinates are 0..1 across the picture. Each task names its parts differently, hence one function.
 */
export function extract(api, r) {
  const out = { hands: [], pose: [], label: '' };
  if (!r) return out;
  if (api === 'holistic') {
    const one = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? v[0] : v) : null);
    for (const h of [one(r.leftHandLandmarks), one(r.rightHandLandmarks)]) if (h && h.length) out.hands.push(h);
    const p = one(r.poseLandmarks);
    if (p && p.length) out.pose = p;
    return out;
  }
  if (api === 'pose') { if (r.landmarks && r.landmarks[0]) out.pose = r.landmarks[0]; return out; }
  out.hands = r.landmarks || [];
  if (api === 'gesture' && r.gestures && r.gestures.length) out.label = r.gestures.map((g) => g[0] && g[0].categoryName).filter((n) => n && n !== 'None').join(', ');
  return out;
}

/**
 * A Holistic result in the shape the app's hand tracking reads (the shape of a Hand Landmarker result), so it can be used as
 * the live hand model: points and left/right for each hand it sees. It gives no 3D hand points, which the app copes with.
 * The tracker expects the label from the camera's side of the picture, which is the opposite of the person's own left/right.
 */
export function holisticAsHands(r) {
  const landmarks = [], handedness = [];
  if (!r) return { landmarks, handedness, worldLandmarks: [] };
  const one = (v) => (Array.isArray(v) ? (Array.isArray(v[0]) ? v[0] : v) : null);
  for (const [list, label] of [[r.leftHandLandmarks, 'Right'], [r.rightHandLandmarks, 'Left']]) {
    const h = one(list);
    if (h && h.length) { landmarks.push(h); handedness.push([{ categoryName: label, score: 1 }]); }
  }
  return { landmarks, handedness, worldLandmarks: [] };
}

/**
 * What to tell the user about a set of results { id: summary }. Compares the same model on the two delegates (and with a
 * smaller camera picture) and says which is faster, but only when the gap is large enough to matter (>15%).
 */
export function advice(results) {
  const out = [];
  for (const kind of ['hand', 'pose']) {
    const g = results[`${kind}-gpu`], c = results[`${kind}-cpu`];
    if (!g || !c || !g.runs || !c.runs) continue;
    const name = kind === 'hand' ? 'hand model' : 'pose model';
    if (g.mean < c.mean * 0.85) out.push({ kind, best: 'GPU', text: `The ${name} is ${(c.mean / g.mean).toFixed(1)}× faster on the graphics card.` });
    else if (c.mean < g.mean * 0.85) out.push({ kind, best: 'CPU', text: `The ${name} is ${(g.mean / c.mean).toFixed(1)}× faster on the processor here. Use the CPU setting.` });
    else out.push({ kind, best: null, text: `The ${name} runs about equally fast on both.` });
  }
  const full = results['hand-gpu'], small = results['hand-640'];
  if (full && small && full.runs && small.runs) {
    if (small.mean < full.mean * 0.85 && small.hitRate >= full.hitRate * 0.9) out.push({ kind: 'hand', best: '640', text: `A smaller camera picture makes the hand model ${(full.mean / small.mean).toFixed(1)}× faster and it still finds the hand. Use it.` });
    else out.push({ kind: 'hand', best: null, text: 'A smaller camera picture does not speed the hand model up here.' });
  }
  const h = results['hand-gpu'] || results['hand-cpu'];
  if (h && h.runs && h.hitRate < 0.2) out.push({ kind: 'hand', best: null, text: 'No hand was found. Hold your open hand in front of the camera during the test.' });
  return out;
}
