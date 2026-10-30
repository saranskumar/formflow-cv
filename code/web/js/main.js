// FormFlow web app: wires camera + hand tracking + gesture controller + Three.js scene + HUD + bridge.
import { HandLandmarker, PoseLandmarker, GestureRecognizer, HolisticLandmarker, FilesetResolver } from '../vendor/vision_bundle.mjs';
import { Forearm } from './core/forearm.js';
import { Sketch } from './core/sketch.js';
import { Controller } from './core/controller.js';
import { HandTracker } from './core/tracker.js';
import { Mapper } from './core/mapping.js';
import { ImportedMesh } from './core/imported.js';
import { MeshError } from './core/meshio.js';
import { sceneToOBJ, sceneToSTL } from './core/exporters.js';
import { SceneView } from './render/scene.js';
import { Hud, TOOL_INFO } from './ui/hud.js';
import { Diagnostics } from './ui/diagnostics.js';
import { Overlay } from './ui/overlay.js';
import { Guide } from './ui/guide.js';
import { SettingsPanel } from './ui/settings.js';
import { normalizeSettings, rangeParams, otherHand } from './core/settings.js';
import { RoiPlanner, cropRect, fromCrop, FULL } from './core/roi.js';
import { AutoExposure, regionStats, filterCss, handBox, SEARCH_BOX } from './core/enhance.js';
import { ConditionMonitor, SharpnessTracker, laplacianVariance, HINTS } from './core/conditions.js';
import { openCamera, CameraAssist } from './core/camera.js';
import { SessionLog } from './core/sessionlog.js';
import { FrameProfiler, QualityGovernor, settings as qualitySettings } from './core/perf.js';
import { ReachCalibrator } from './core/reach.js';
import { dist } from './core/gestures.js';
import { suggestFor, stitchAll, closedCopy, joinedCopy, endPoint } from './core/stitch.js';
import { buildHull, describeOutlines, sharedDimensions, classifyPlane } from './core/hull.js';
import { PlaneLayout, guideLines } from './core/planes.js';
import { ModeSwitch, PlaneBar, DRAW_VIEWS } from './ui/planebar.js';
import { RefImages, outlineFromTrace, moveImage, scaleImage, assignViews } from './ui/refimages.js';
import { traceSilhouette } from './core/trace.js';
import { Poly } from './core/shapes.js';
import { PLANE_VIEWS } from './core/planes.js';
import { JoinPrompt } from './ui/prompt.js';
import { HullPanel } from './ui/hullpanel.js';
import { HullWorker } from './ui/hullworker.js';
import { DemoPanel } from './ui/demo.js';
import { ScrollFab } from './ui/scroll.js';
import { Follower, LandmarkFollower } from './core/smooth.js';
import { ModelLab } from './ui/modellab.js';
import { MODELS, summarize, extract, holisticAsHands } from './core/benchmark.js';
import { Bridge, toBase64 } from './bridge.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const video = $('cam');
const getRect = () => ({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
const TOOL_ORDER = Object.keys(TOOL_INFO);
const PLANE_TOOLS = ['free', 'line', 'rect', 'circle', 'move']; // tools that make sense on a flat view

// --------------------------------------------------------------------------------- state
const sketch = new Sketch();
sketch.smooth = true; // zoom, pan and view changes glide
const view = new SceneView($('gl'), sketch);
const overlay = new Overlay($('overlay'));
const mapper = new Mapper({ width: window.innerWidth, height: window.innerHeight });
const forearm = new Forearm();
let poseModel = null, poseTick = 0;
const handTracker = new HandTracker(); // stable identity, ghost removal, dropout bridging (see core/tracker.js)
const tracks = handTracker.pool;
const infer = { n: 0, since: performance.now(), fps: 0, mode: '' };
const readStored = () => { try { return JSON.parse(localStorage.getItem('formflow.settings') || 'null'); } catch { return null; } };
let settings = normalizeSettings(readStored());
const planner = new RoiPlanner();
const cropCanvas = document.createElement('canvas');
const cropCtx = cropCanvas.getContext('2d');
// Light correction: a tiny copy of the frame is metered, and the detector is fed a brightened copy (core/enhance.js)
const exposure = new AutoExposure();
const meterCanvas = Object.assign(document.createElement('canvas'), { width: 96, height: 54 });
const meterCtx = meterCanvas.getContext('2d', { willReadFrequently: true });
const enhCanvas = document.createElement('canvas');
const enhCtx = enhCanvas.getContext('2d');
let meterTick = 0, lastCorr = { gain: 1, contrast: 1, variant: 'measured' };
// Why detection struggles (dark, light behind, blur, slow camera), a hint for the user, camera exposure help and a log
const conditions = new ConditionMonitor();
const sharpness = new SharpnessTracker();
const sharpCanvas = Object.assign(document.createElement('canvas'), { width: 256, height: 144 });
const sharpCtx = sharpCanvas.getContext('2d', { willReadFrequently: true });
const sessionLog = new SessionLog();
const announced = {}; // condition -> time its hint was last shown
// Where a frame's time goes, and the quality level that keeps it smooth (core/perf.js)
const profiler = new FrameProfiler();
const governor = new QualityGovernor();
let quality = qualitySettings(0, window.devicePixelRatio || 1), detectTick = 0;
let cameraAssist = null, lastSharp = null, sharpTick = 0;
let trackerMode = null; // 'VIDEO' (whole frame, temporal tracking) | 'IMAGE' (cropped frames) | null while switching
let lastRoi = FULL;
let tracker = null;
let cameraOn = false;
let lastVT = -1;
let testClock = null; // set by the test hook: virtual time instead of the wall clock

const seen = { main: -9, second: -9 };
const last = { main: null, second: null }; // last {frame, reading, lm}

const currentRange = () => rangeParams(settings.range, settings.sensitivity);

function saveSettings() {
  try { localStorage.setItem('formflow.settings', JSON.stringify(settings)); } catch { /* private mode */ }
  bridge.send('calibration', { data: settings });
}

/** Push the current settings into every part of the pipeline. Safe to call at any time. */
function applySettings() {
  const p = currentRange();
  handTracker.setOptions({
    minPalm: p.minPalm, dominant: settings.dominant, forearm: settings.forearm && poseModel ? forearm : null,
    trackOpts: { pinchOn: settings.pinchOn, pinchOff: settings.pinchOff, smoothing: settings.smoothing, smoothRatio: 0.6 },
  });
  mapper.set({ region: settings.region || p.region });
  exposure.enabled = settings.light;
  planner.reset();
  configureTracker();
  settingsPanel.render();
  guide.refresh();
  hud.setHandLabels(settings.dominant, otherHand(settings.dominant));
}

/** Change one setting. Changing the drawing hand swaps the roles, so tracking state is reset to avoid mixing them up. */
function setSetting(key, value) {
  const next = normalizeSettings({ ...settings, [key]: value });
  if (next.dominant !== settings.dominant) {
    handTracker.reset(); last.main = last.second = null; controller.reset();
    hud.toast(`${next.dominant} hand draws · ${otherHand(next.dominant)} hand navigates`, 'ok', 4500);
  } else if (key === 'range') hud.toast(`Distance: ${next.range}`, 'ok');
  settings = next;
  saveSettings();
  applySettings();
}

// -------------------------------------------------------------------------------- commands
const hud = new Hud($('hud'), (a) => perform(a), (t) => perform('tool', t));
hud.setTool(sketch.tool);
const bridge = new Bridge((on) => hud.setLink(on), (m) => onBridge(m));
sketch.onNote = (text, kind) => hud.toast(text, kind, 7000);
const controller = new Controller({ sketch, getRect, ui: hud, onCommit: (item) => onStrokeCommitted(item) });
// ------------------------------------------------------------------------ joining lines
let pendingJoin = null;
const joinPrompt = new JoinPrompt($('hud'), (ans) => answerJoin(ans), { onExpire: () => dismissJoin() }); // an unanswered prompt must not stay armed for a later "yes"
const dismissJoin = () => { pendingJoin = null; sketch.joinHint = null; joinPrompt.hide(); };

/** A freehand stroke was just drawn: if it nearly closes, or ends near another line, ask what to do. */
function onStrokeCommitted(item) {
  if (mode === 'planes' && item.pts) {
    lastDrawnView = { z: 'front', x: 'side', y: 'top' }[classifyPlane(item.pts)] || lastDrawnView;
  }
  if (!settings.askJoin || item.kind !== 'free') return dismissJoin();
  const sg = suggestFor(sketch.items, item);
  if (!sg) return dismissJoin();
  showJoinPrompt(sg);
}

function showJoinPrompt(sg) {
  pendingJoin = sg;
  if (sg.type === 'close') {
    sketch.joinHint = [sg.item.pts[0], sg.item.pts[sg.item.pts.length - 1]];
    joinPrompt.show({ title: 'Close this loop?', detail: 'The ends nearly meet. Closing makes it a complete outline.', yes: 'Close loop', no: 'Keep open', all: false });
  } else {
    sketch.joinHint = [endPoint(sg.a, sg.ea), endPoint(sg.b, sg.eb)];
    joinPrompt.show({ title: 'Join these two lines?', detail: 'Their ends are close together. Stitching makes them one line.', yes: 'Join lines', no: 'Keep separate', all: true });
  }
}

function answerJoin(ans) {
  const sg = pendingJoin;
  if (ans === 'all') { dismissJoin(); return joinAll(); }
  if (ans === 'no' || !sg) return dismissJoin();
  const alive = sg.type === 'close' ? sketch.items.includes(sg.item) : sketch.items.includes(sg.a) && sketch.items.includes(sg.b);
  if (!alive) return dismissJoin();
  if (sg.type === 'close') {
    sketch.replaceItems([sg.item], [closedCopy(sg.item)]);
    hud.toast('Loop closed', 'ok');
    return dismissJoin();
  }
  const merged = joinedCopy(sg.a, sg.ea, sg.b, sg.eb);
  sketch.replaceItems([sg.a, sg.b], [merged]);
  hud.toast('Lines joined', 'ok');
  const next = suggestFor(sketch.items, merged); // the joined line may now close into a loop, or reach another line
  if (next) showJoinPrompt(next); else dismissJoin();
}

/** Join everything that is close enough and close every near-loop, as one undoable step. */
function joinAll() {
  const r = stitchAll(sketch.items, 0.18);
  if (!r.added.length) return hud.toast('Nothing to join: no line ends are close enough together (or they are already joined).', 'warn', 5000);
  sketch.replaceItems(r.removed, r.added);
  hud.toast(`Stitched: ${r.joined} join${r.joined === 1 ? '' : 's'}, ${r.closed} loop${r.closed === 1 ? '' : 's'} closed`, 'ok', 5000);
}

// -------------------------------------------------------------------------- visual hull
const hullOpts = { n: 64, align: true };
const hullPanel = new HullPanel($('hud'), {
  view: (v) => setView(v),
  join: () => joinAll(),
  make: () => makeHull(),
  opt: (k, v) => { if (k === 'n') hullOpts.n = +v; else if (k === 'align') hullOpts.align = v === 'true'; },
});

function setView(name) {
  if (mode === 'planes') return hud.toast('The three views are already on screen: draw in the Front, Side or Top cell.', 'info');
  dismissJoin();
  sketch.setView(name);
  sketch.setTool('free');
  hud.setTool('free');
  hullPanel.clearResult();
  hud.toast(`${name[0].toUpperCase() + name.slice(1)} view: draw a closed outline with Freehand (the camera is straight on, so it lands flat).`, 'ok', 6000);
}

function makeHull() {
  const planes = mode === 'planes';
  const r = buildHull(sketch.items, planes ? { n: Math.max(planeOpts.n, 96), align: planeOpts.align, revolve: planeOpts.round, smooth: planeOpts.smooth } : { n: hullOpts.n, align: hullOpts.align });
  hullPanel.showResult(r);
  if (!r.ok) return hud.toast(r.reason, 'warn', 9000);
  const item = ImportedMesh.fromMesh('hull', r.mesh);
  sketch.addItem(item);
  sketch.setTool('move');
  hud.setTool('move');
  sketch.resetView(); // step back to the 3D view so the new shape can be seen
  if (planes) setMode('sketch'); // the finished shape is a normal object: move, scale, export
  const worst = Math.round(Math.min(...Object.values(r.stats.iou)) * 100);
  hud.toast(`3D shape built from ${r.stats.views.join(' + ')}${r.stats.round ? ' (round)' : ''} (${r.stats.triangles.toLocaleString()} triangles, ${worst}% match). Grab it to move it, or Undo to edit the outlines.`, 'ok', 9000);
  return r;
}

// ------------------------------------------------------------------- 3-plane workspace
// Each of the Front, Side and Top cells can get its outline two ways: drawn by hand, or found automatically in a photo.
// A photo can also stay as a faint guide that you trace yourself ("Trace by hand").
const layout = new PlaneLayout();
const planeOpts = { live: true, n: 64, align: true, round: false, smooth: 0 };
const hullWorker = new HullWorker(); // the live preview is built off the main thread
let liveBusy = false, liveDirty = false;
const cells = Object.fromEntries(DRAW_VIEWS.map((v) => [v, { source: 'auto', object: 'auto', adjusting: false }]));
const traced = {}; // view -> { pts (picture coords), item } for outlines found in a photo
let mode = 'sketch';
let lastDrawnView = null; // the view of the newest outline, for "Clear view"
let planeSig = '', planeAt = 0, committedSig = null, planeBarH = 0;

const modeSwitch = new ModeSwitch(hud.modeSlot, (m) => setMode(m));
const planeBar = new PlaneBar($('hud'), {
  join: () => joinAll(),
  make: () => makeHull(),
  clear: () => clearLastView(),
  photos: () => pickPhotos(),
  cell: (v, op) => cellOp(v, op),
  focus: (v) => focusView(v),
  opt: (k, v) => {
    if (k === 'live') planeOpts.live = v === 'true'; else if (k === 'n') planeOpts.n = +v; else if (k === 'align') planeOpts.align = v === 'true';
    else if (k === 'round') { planeOpts.round = v === 'true'; planeBar.round = planeOpts.round; }
    else if (k === 'smooth') planeOpts.smooth = +v;
    planeSig = ''; // rebuild the preview with the new options
  },
});
const refImages = new RefImages(layout);
const title = (v) => v[0].toUpperCase() + v.slice(1);
const alive = (it) => !!it && sketch.items.includes(it);

function syncCells() {
  planeBar.setCells(Object.fromEntries(DRAW_VIEWS.map((v) => [v, { image: refImages.has(v), ...cells[v] }])));
}

// Dragging in a cell whose photo is being adjusted moves the photo (and its outline) instead of drawing.
sketch.photoDrag = {
  active: (v) => cells[v] && cells[v].adjusting && refImages.has(v),
  move: (v, du, dv) => { refImages.setState(v, moveImage(refImages.state[v], du, dv)); placeTrace(v); },
};

/** Find the object's outline in a view's photo and place it as a closed outline on that plane. */
function detectView(v, quiet = false) {
  const px = refImages.pixels(v);
  if (!px) return false;
  const r = traceSilhouette(px, { mode: cells[v].object });
  if (!r.ok) {
    if (!quiet) hud.toast(`${title(v)} photo: ${r.reason}`, 'warn', 7000);
    return false;
  }
  traced[v] = { pts: r.pts, item: alive(traced[v] && traced[v].item) ? traced[v].item : null };
  placeTrace(v);
  return true;
}

/** (Re)build a found outline from its cached photo coordinates, following the photo's current size and position. */
function placeTrace(v) {
  const t = traced[v], im = refImages.state[v];
  if (!t || !im) return;
  const pts = outlineFromTrace(t.pts, im, PLANE_VIEWS[v]);
  if (alive(t.item)) t.item.pts = pts; // moving the photo moves its outline: not a new undo step
  else { t.item = new Poly('free', pts, true); sketch.addItem(t.item); lastDrawnView = v; }
  planeSig = '';
}

function dropTrace(v) {
  const t = traced[v];
  if (t && alive(t.item)) sketch.replaceItems([t.item], []);
  delete traced[v];
}

/** Choose a photo for a view (system file picker). */
function pickImage(v) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => { if (input.files[0]) loadImage(v, input.files[0]); };
  input.click();
}

/** Put a photo behind a view and (in Auto) find its outline. Returns true when an outline was found. */
async function loadImage(v, file, quiet = false) {
  if (mode !== 'planes') setMode('planes');
  try {
    await refImages.load(v, file);
  } catch (e) { hud.toast(`${file.name || 'Photo'}: ${e.message} Use a JPG, PNG or WebP picture.`, 'error', 6000); return false; }
  dropTrace(v);
  Object.assign(cells[v], { adjusting: false });
  let found = false;
  if (cells[v].source === 'auto') {
    found = detectView(v, quiet);
    if (found && !quiet) hud.toast(`${title(v)}: outline found. If it is off, switch Object to Dark or Light, or use Trace.`, 'ok', 7000);
  } else if (!quiet) {
    hud.toast(`${title(v)}: photo placed. Trace its outline with Freehand; ✥ lines it up.`, 'ok', 7000);
  }
  syncCells();
  return found;
}

// Photos -> 3D in one step: up to three photos (front, side, top; matched by file name, else in that order), their
// outlines found automatically, then the 3D shape built straight away. One photo of a round object can be spun.
function pickPhotos() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => { if (input.files.length) photosTo3D([...input.files]); };
  input.click();
}

async function photosTo3D(files, { build = true } = {}) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return hud.toast('Those are not photos. Use JPG, PNG or WebP pictures.', 'warn');
  if (mode !== 'planes') setMode('planes');
  // a fresh set of photos replaces the old ones, so stale outlines from earlier photos cannot mix in
  for (const v of DRAW_VIEWS) if (refImages.has(v)) { refImages.remove(v); dropTrace(v); }
  const plan = assignViews(images.map((f) => f.name));
  const failed = [];
  for (const [v, i] of plan) {
    cells[v].source = 'auto';
    if (!(await loadImage(v, images[i], true))) failed.push(title(v));
  }
  const found = plan.map(([v]) => v).filter((v) => traced[v]);
  syncCells();
  planeSig = '';
  if (!found.length) return hud.toast(`No outline found in ${failed.join(', ')}. Use photos of one object on a plain background, or switch Object to Dark / Light on a view.`, 'warn', 9000);
  if (!build) return hud.toast(`Pictures loaded${failed.length ? ` (no outline found in ${failed.join(', ')})` : ''}. Check the outlines, then press Make 3D to build the model.`, 'ok', 9000);
  const r = makeHull();
  if (r && r.ok && failed.length) hud.toast(`Built from ${found.map(title).join(' + ')}. No outline found in ${failed.join(', ')}: fix that view (Object: Dark / Light) and press Make 3D again.`, 'warn', 9000);
  else if (r && r.ok && found.length === 1 && !planeOpts.round) hud.toast(`Built from one photo, so the shape is extruded. For a bottle, vase or cup choose One view: Round in 3-Plane Hull and press Make 3D.`, 'ok', 9000);
}

// Models panel: time each available model on live camera pictures (the app's own detection pauses meanwhile)
/** Where to load a model from: the app's own files, the downloaded copy in vendor/models when it exists, else Google's storage. */
const localModels = new Map();
async function modelPath(m) {
  if (m.file) return `./vendor/${m.file}`;
  if (m.local) {
    if (!localModels.has(m.local)) localModels.set(m.local, fetch(`./vendor/${m.local}`, { method: 'HEAD' }).then((r) => r.ok && +r.headers.get('content-length') > 1e6).catch(() => false));
    if (await localModels.get(m.local)) return `./vendor/${m.local}`;
  }
  return m.url;
}
const FACTORY = { hand: HandLandmarker, gesture: GestureRecognizer, holistic: HolisticLandmarker, pose: PoseLandmarker };
// waits for the next camera picture, but never longer than a moment: a stalled camera must not hang the test
const nextCameraPicture = () => new Promise((res) => { const stop = setTimeout(res, 250); const done = () => { clearTimeout(stop); res(); }; if (hasFrameCallback) video.requestVideoFrameCallback(done); else setTimeout(done, 34); });
const testCanvas = document.createElement('canvas');

async function runModelTest(id, onProgress, onSnap) {
  const m = MODELS.find((x) => x.id === id);
  if (!cameraOn || !visionFileset || video.readyState < 2) throw new Error('needs the camera: start it first (this test uses live camera pictures)');
  benchmarking = true;
  let lm = null;
  try {
    const path = await modelPath(m);
    const make = (delegate) => FACTORY[m.api].createFromOptions(visionFileset, {
      baseOptions: { modelAssetPath: path, delegate },
      runningMode: 'VIDEO', ...(m.api === 'pose' ? { numPoses: 1 } : m.api === 'holistic' ? {} : { numHands: 2 }),
    });
    const t0 = performance.now();
    let ranOn = m.delegate;
    try { lm = await make(m.delegate); }
    catch (e) { if (m.delegate !== 'GPU') throw e; ranOn = 'CPU'; lm = await make('CPU'); } // no graphics-card support: say so, and still test it
    const loadMs = performance.now() - t0;
    const ms = [], N = 90, started = performance.now();
    let hits = 0, label = '';
    while (ms.length < N && performance.now() - started < 9000) {
      await nextCameraPicture();
      const a = performance.now();
      let source = video;
      if (m.picture && video.videoWidth > m.picture) { // the smaller copy is part of what is timed
        testCanvas.width = m.picture; testCanvas.height = Math.round((video.videoHeight * m.picture) / video.videoWidth);
        testCanvas.getContext('2d').drawImage(video, 0, 0, testCanvas.width, testCanvas.height);
        source = testCanvas;
      }
      const r = (lm.recognizeForVideo || lm.detectForVideo).call(lm, source, a);
      ms.push(performance.now() - a);
      const snap = extract(m.api, r);
      if (m.kind === 'pose' ? snap.pose.length : snap.hands.length) hits++;
      if (snap.label) label = snap.label;
      onSnap(snap);
      onProgress(ms.length / N);
    }
    return { ...summarize(ms, hits), loadMs, ranOn, label };
  } finally {
    try { lm && lm.close(); } catch { /* already closed */ }
    benchmarking = false;
  }
}

/** Switch the model that tracks the hands (from the Models panel), remember it, and restart tracking with it. */
async function useModelSetting(id) {
  const m = MODELS.find((x) => x.id === id);
  if (!m || !HAND_IDS.includes(id)) return;
  activeModel = id;
  try { localStorage.setItem('formflow.handModel', id); } catch { /* private window */ }
  hud.toast(`Switching hand tracking to ${m.title}${m.delegate === 'CPU' ? ' (processor)' : ''}${m.picture ? `, ${m.picture} px picture` : ''}…`, 'info', 5000);
  benchmarking = true;
  try {
    try { tracker && tracker.close(); } catch { /* ignore */ }
    tracker = null;
    await startTracker();
    await configureTracker();
    hud.toast(`Hand tracking now uses ${m.title}.`, 'ok');
  } catch (e) { hud.toast(`Could not switch: ${e.message}`, 'error', 6000); }
  finally { benchmarking = false; }
}

/** The app's own tracking, for the panel's live picture (landmarks here are already mirrored). */
function liveSnapshot() {
  const hands = ['main', 'second'].map((r) => last[r] && now() - seen[r] < 0.5 && last[r].lm).filter(Boolean);
  return { mirrored: true, hands, pose: [], label: '' };
}

const modelLab = new ModelLab($('hud'), {
  run: runModelTest, use: useModelSetting,
  current: () => ({ active: activeModel }),
  live: () => ({ video, snap: liveSnapshot() }),
  locals: async () => Object.fromEntries(await Promise.all(MODELS.filter((m) => m.local).map(async (m) => [m.id, (await modelPath(m)) !== m.url]))),
});

// Demo gallery: a ready-made photo set (code/samples) loaded into the views with its outlines; Make 3D builds the model
const demoPanel = new DemoPanel($('hud'), (set) => loadDemo(set));
const scrollFab = new ScrollFab($('hud')); // page up / down arrows for any panel too long for the screen
async function loadDemo(set) {
  demoPanel.close();
  hud.toast(`Loading the ${set.title} pictures…`, 'info');
  try {
    const files = await Promise.all(set.views.map(async (v) => {
      const r = await fetch(`/samples/${set.id}/${v}.png`);
      if (!r.ok) throw new Error(`${v}.png was not found`);
      return new File([await r.blob()], `${v}.png`, { type: 'image/png' });
    }));
    if (sketch.items.length) sketch.clear(); // one undo step brings the previous scene back
    planeOpts.round = !!set.round; planeBar.round = planeOpts.round; // a round object is spun from its one picture
    await photosTo3D(files, { build: false }); // only the pictures and their outlines: the model is built when the user presses Make 3D
  } catch (e) { hud.toast(`Could not load the ${set.title} demo: ${e.message}`, 'error', 7000); }
}

const OBJECT_CYCLE = { auto: 'dark', dark: 'light', light: 'auto' };

function cellOp(v, op) {
  if (op === 'focus') return focusView(layout.focus === v ? null : v); // the open button is also the way back
  const c = cells[v];
  if (op === 'photo') return pickImage(v);
  if (!refImages.has(v)) return;
  if (op === 'auto') { c.source = 'auto'; if (detectView(v)) hud.toast(`${title(v)}: outline found in the photo.`, 'ok'); }
  else if (op === 'hand') { c.source = 'hand'; dropTrace(v); sketch.setTool('free', now()); hud.setTool('free'); hud.toast(`${title(v)}: trace the photo with Freehand.`, 'ok'); }
  else if (op === 'object') { c.object = OBJECT_CYCLE[c.object]; if (detectView(v)) hud.toast(`${title(v)}: outline found (object: ${c.object}).`, 'ok'); }
  else if (op === 'adjust') {
    c.adjusting = !c.adjusting;
    if (c.adjusting) hud.toast(`${title(v)}: drag in the view to move the photo, mouse wheel resizes it. Press ✥ again when done.`, 'ok', 6000);
  } else if (op === 'remove') {
    refImages.remove(v);
    dropTrace(v);
    c.adjusting = false;
    hud.toast(`${title(v)} photo removed.`, 'ok');
  } else {
    refImages.adjust(v, op); // smaller / bigger / fade / flip
    placeTrace(v);
  }
  syncCells();
}

function layoutPlanes() {
  const W = window.innerWidth, H = window.innerHeight;
  const x = 24;
  const top = hud.topH + 10;
  const reserve = (planeBar.open ? planeBar.el.offsetHeight + 10 : 0) + hud.botH + 10; // the plane bar, and the bottom bar under it
  layout.set({ x, y: top, w: W - 2 * x, h: Math.max(H - top - reserve, 200) });
  planeBar.place(layout);
  refImages.refresh();
}

const VIEW_NAME = { front: 'Front', side: 'Side', top: 'Top', preview: '3D preview' };
/** Open one view full screen (name), or go back to the three views and the preview (null). */
function focusView(name) {
  if (mode !== 'planes') setMode('planes');
  const next = name || null;
  if (next === layout.focus) return;
  sketch.cancel();
  layout.focus = next;
  planeBar.setFocus(next);
  layoutPlanes();
  syncCells();
  planeSig = '';
  hud.toast(next ? `${VIEW_NAME[next]} full screen. Draw here; press Esc or Back to go to the three views.` : 'Back to the three views.', 'ok', 4000);
}

hud.onLayout = () => { if (mode === 'planes') layoutPlanes(); }; // the bars changed height (window resized, tools wrapped)

function setMode(m) {
  if (m === mode) return;
  dismissJoin();
  sketch.cancel();
  mode = m;
  document.body.classList.toggle('planes', m === 'planes');
  modeSwitch.set(m);
  planeBar.show(m === 'planes');
  if (m !== 'planes') { layout.focus = null; planeBar.setFocus(null); }
  refImages.show(m === 'planes');
  planeSig = ''; committedSig = null;
  if (m === 'planes') {
    hullPanel.close();
    layoutPlanes();
    syncCells();
    sketch.layout = layout;
    sketch.cursor = null;
    if (!PLANE_TOOLS.includes(sketch.tool)) { sketch.setTool('free', now()); hud.setTool('free'); }
    hud.toast('3-Plane Hull: draw a closed outline in two of Front, Side and Top, or press Add photo on a view. The 3D preview builds itself.', 'ok', 8000);
  } else {
    for (const v of DRAW_VIEWS) cells[v].adjusting = false;
    sketch.layout = null;
    sketch.cursor = null;
    view.setHull(null);
    view.guides = [];
    hud.toast('3D Sketch: draw in the air.', 'ok');
  }
}

function clearLastView() {
  const views = { z: 'front', x: 'side', y: 'top' };
  const gone = sketch.items.filter((it) => it.pts && it.kind !== 'mesh' && !it.volumetric && views[classifyPlane(it.pts)] === lastDrawnView);
  if (!gone.length) return hud.toast('Nothing to clear yet: draw an outline first.', 'warn');
  sketch.replaceItems(gone, []);
  hud.toast(`Cleared the ${lastDrawnView} view (Undo brings it back).`, 'ok');
}

const outlineSig = () => sketch.items.filter((it) => it.kind !== 'mesh' && !it.volumetric).map((it) => SceneView.stamp(it)).join('/');
const photoFlags = () => Object.fromEntries(DRAW_VIEWS.map((v) => [v, refImages.has(v)]));

/** Refresh the guide lines, the status bar and the live hull (throttled: building a hull is the expensive part). */
function stepPlanes(t) {
  if (mode !== 'planes' || t - planeAt < 0.3) return;
  planeAt = t;
  const bh = planeBar.el.offsetHeight;
  if (bh !== planeBarH) { planeBarH = bh; layoutPlanes(); }
  const sig = outlineSig();
  if (sig === planeSig) return;
  planeSig = sig;
  const shared = sharedDimensions(sketch.items);
  view.guides = guideLines(shared);
  planeBar.update(describeOutlines(sketch.items), shared, sketch.cellView, photoFlags());
  if (!planeOpts.live || sig === committedSig) return view.setHull(null);
  liveHull();
}

/** Build the preview in the worker. While one is being built, newer drawings wait for it and then trigger one more build. */
function liveHull() {
  const opts = { n: planeOpts.n, align: planeOpts.align, revolve: planeOpts.round, smooth: planeOpts.smooth };
  if (!hullWorker.ok) { const r = buildHull(sketch.items, opts); return view.setHull(r.ok ? r.mesh : null); }
  if (liveBusy) { liveDirty = true; return; }
  liveBusy = true;
  hullWorker.build(sketch.items, opts).then((r) => {
    if (r === undefined) { const q = buildHull(sketch.items, opts); if (mode === 'planes') view.setHull(q.ok ? q.mesh : null); } // worker unavailable
    else if (r && mode === 'planes' && planeOpts.live) view.setHull(r.ok ? r.mesh : null);
  }).finally(() => {
    liveBusy = false;
    if (liveDirty) { liveDirty = false; planeSig = ''; } // drawing changed meanwhile: rebuild on the next step
  });
}


function onBridge(m) {
  if (m.type === 'saved') hud.toast(`Saved to disk: ${m.files.join(', ')}`, 'ok', 6000);
  else if (m.type === 'calibration' && m.data && !readStored()) { settings = normalizeSettings(m.data); applySettings(); }
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportScene(kind) {
  if (!sketch.items.length) return hud.toast('Draw something first', 'warn');
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const base = `formflow_${stamp}`;
  const obj = sceneToOBJ(sketch.items);
  const stl = sceneToSTL(sketch.items);
  if (kind === 'stl' && !stl) return hud.toast('STL needs at least one solid (cube, sphere, …)', 'warn');
  if (kind === 'obj') download(`${base}.obj`, obj, 'text/plain');
  else download(`${base}.stl`, stl, 'model/stl');
  const sent = bridge.send('export', { name: base, obj, stl: stl ? toBase64(stl) : null });
  hud.toast(`Exported ${kind.toUpperCase()}${sent ? ' (also saved by the server)' : ''}`, 'ok');
}

export function importBuffer(filename, buffer) {
  try {
    const item = ImportedMesh.fromBuffer(filename, buffer);
    item.center = sketch.target.slice();
    sketch.addItem(item);
    sketch.setTool('move');
    hud.setTool('move');
    hud.toast(`Imported ${item.name}: ${item.faces.length / 3} triangles, fitted to the grid. Grab it to move it.`, 'ok', 6000);
    return item;
  } catch (e) {
    if (e instanceof MeshError) { hud.toast(`Import failed: ${e.message}`, 'error', 6000); return null; }
    throw e;
  }
}

async function importFile(file) {
  if (file) importBuffer(file.name, await file.arrayBuffer());
}

// Import: a file chooser needs a real click, so gesture users get a panel with the server's models too.
const importPanel = document.createElement('div');
importPanel.className = 'hudzone import-panel';
importPanel.style.cssText = 'position:absolute;left:50%;top:calc(var(--topH, 64px) + 10px);transform:translateX(-50%);width:340px;display:none;padding:12px';
importPanel.innerHTML = '<b>Import a model</b><div class="list" style="margin:8px 0;display:grid;gap:4px"></div>'
  + '<button class="btn" data-browse>Browse files…</button><small style="color:var(--dim);display:block;margin-top:6px">…or drag a .obj / .stl file onto the window.</small>'
  + '<button class="btn" data-close style="margin-top:6px">Close</button>';
$('hud').append(importPanel);
importPanel.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.close !== undefined) importPanel.style.display = 'none';
  else if (b.dataset.browse !== undefined) $('file').click();
  else if (b.dataset.model) {
    const r = await fetch(`/api/models/${encodeURIComponent(b.dataset.model)}`);
    if (r.ok) { importBuffer(b.dataset.model, await r.arrayBuffer()); importPanel.style.display = 'none'; }
  }
});
$('file').addEventListener('change', async (e) => { await importFile(e.target.files[0]); e.target.value = ''; importPanel.style.display = 'none'; });

async function openImport() {
  importPanel.style.display = 'block';
  const list = importPanel.querySelector('.list');
  list.innerHTML = '';
  try {
    const names = await (await fetch('/api/models')).json();
    names.forEach((n) => { const b = document.createElement('button'); b.className = 'btn'; b.dataset.model = n; b.innerHTML = `<span class="g">▣</span><span class="t">${n}</span>`; list.append(b); });
    if (!names.length) list.innerHTML = '<small style="color:var(--dim)">No models in the server’s imports folder yet.</small>';
  } catch { list.innerHTML = '<small style="color:var(--dim)">Server models unavailable (backend offline).</small>'; }
}

function perform(cmd, arg) {
  switch (cmd) {
    case 'tool': if (mode === 'planes' && !PLANE_TOOLS.includes(arg)) { hud.toast(`${TOOL_INFO[arg][1]} is a 3D tool. In 3-Plane Hull, draw outlines with Freehand, Line, Rectangle or Circle.`, 'warn', 6000); break; }
      sketch.setTool(arg, now()); hud.setTool(arg); hud.toast(`${TOOL_INFO[arg][1]}: ${TOOL_INFO[arg][2]}`); break;
    case 'undo': sketch.undo(); hud.toast('Undo'); break;
    case 'delete': if (sketch.deleteSelected()) hud.toast('Deleted. Undo brings it back.', 'ok'); else hud.toast('Nothing selected. Click an object first: pinch quickly, or click it with the mouse.', 'info', 5000); break;
    case 'clear': if (!sketch.items.length) { hud.toast('The scene is already empty.'); break; } sketch.clear(); hud.toast('Scene cleared. Undo brings it back.', 'warn'); break;
    case 'import': openImport(); break;
    case 'photos': pickPhotos(); break;
    case 'exportOBJ': exportScene('obj'); break;
    case 'exportSTL': exportScene('stl'); break;
    case 'depthUp': sketch.stepDepth(1); hud.toast(`Drawing depth ${sketch.depth.toFixed(1)} (closer)`); break;
    case 'depthDown': sketch.stepDepth(-1); hud.toast(`Drawing depth ${sketch.depth.toFixed(1)} (farther)`); break;
    case 'snap': sketch.snap = !sketch.snap; hud.setActive('snap', sketch.snap); hud.toast(`Snap ${sketch.snap ? 'on' : 'off'}`); break;
    case 'resetView': sketch.resetView(); break;
    case 'zoomIn': sketch.zoom(0.8); break;
    case 'zoomOut': sketch.zoom(1.25); break;
    case 'camera': document.body.classList.toggle('camhidden'); hud.setActive('camera', !document.body.classList.contains('camhidden')); break;
    case 'diagnostics': diagnostics.toggle(); break;
    case 'demo': settingsPanel.close(); hullPanel.close(); modelLab.close(); demoPanel.toggle(); break;
    case 'models': settingsPanel.close(); hullPanel.close(); demoPanel.close(); modelLab.toggle(); break;
    case 'swap': setSetting('dominant', otherHand(settings.dominant)); break;
    case 'join': joinAll(); break;
    case 'hull': if (mode === 'planes') makeHull(); else hullPanel.toggle(); break;
    case 'mode': setMode(mode === 'planes' ? 'sketch' : 'planes'); break;
    case 'modePlanes': setMode('planes'); break;
    case 'modeSketch': setMode('sketch'); break;
    case 'viewFront': if (mode === 'planes') focusView(layout.focus === 'front' ? null : 'front'); else setView('front'); break;
    case 'viewSide': if (mode === 'planes') focusView(layout.focus === 'side' ? null : 'side'); else setView('side'); break;
    case 'viewTop': if (mode === 'planes') focusView(layout.focus === 'top' ? null : 'top'); else setView('top'); break;
    case 'settings': settingsPanel.toggle(); break;
    case 'help': guide.show(); break;
    default: break;
  }
}

window.addEventListener('keydown', (e) => {
  if (reachCal && e.key === 'Escape') return cancelReach();
  if (e.key === 'Escape' && (settingsPanel.open || hullPanel.open || demoPanel.open || modelLab.open)) { settingsPanel.close(); hullPanel.close(); demoPanel.close(); modelLab.close(); return; }
  if (e.key === 'Escape' && mode === 'planes' && layout.focus) { focusView(null); return; }
  if (pendingJoin && !e.ctrlKey && !e.metaKey) {
    if (e.key === 'y' || e.key === 'Enter') return answerJoin('yes');
    if (e.key === 'n' || e.key === 'Escape') return answerJoin('no');
  }
  if (guide.visible || e.ctrlKey || e.metaKey || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  const tools = { 1: 'free', 2: 'line', 3: 'rect', 4: 'circle', 5: 'cube', 6: 'sphere', 7: 'cylinder', 8: 'cone', 9: 'pyramid', 0: 'move', x: 'scale', q: 'extrude', k: 'cut' };
  if (k in tools) perform('tool', tools[k]);
  else {
    if (e.key === 'Delete' || e.key === 'Backspace') return perform('delete');
  const map = { z: 'undo', c: 'clear', e: 'exportOBJ', i: 'import', v: 'resetView', '[': 'depthDown', ']': 'depthUp', g: 'help', h: 'swap', ',': 'settings', j: 'join', u: 'hull', p: 'mode', o: 'demo', m: 'models', d: 'diagnostics', f: 'viewFront', l: 'viewSide', t: 'viewTop', s: 'snap', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut' };
    if (map[k]) perform(map[k]);
  }
});

// drag & drop import
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropzone').classList.add('on'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropzone').classList.remove('on'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('on');
  const files = [...e.dataTransfer.files];
  const images = files.filter((f) => f.type.startsWith('image/'));
  const cell = mode === 'planes' ? layout.cellAt(e.clientX, e.clientY) : null;
  if (images.length === 1 && cell && cell !== 'preview') await loadImage(cell, images[0]); // one photo onto a view: that view
  else if (images.length) await photosTo3D(images); // several photos, or dropped anywhere else: build the 3D shape
  for (const f of files) if (!f.type.startsWith('image/')) await importFile(f);
});

// -------------------------------------------------------------------------------- mouse
const mouse = { x: 0, y: 0, down: false, buttons: 0, shift: false, inside: false };
const gl = $('gl');
// Button presses are queued, not just sampled: a quick click can press and release between two frames,
// and the controller must still see both.
const mouseQueue = [];
const queueMouse = () => { if (mouseQueue.length < 200) mouseQueue.push(mouseFrame()); };
gl.addEventListener('pointerdown', (e) => {
  if (settingsPanel.open) { settingsPanel.close(); return; } // a click outside the settings closes them
  gl.setPointerCapture(e.pointerId);
  Object.assign(mouse, { buttons: e.buttons, shift: e.shiftKey, x: e.clientX, y: e.clientY, inside: true });
  queueMouse();
});
gl.addEventListener('pointermove', (e) => {
  Object.assign(mouse, { buttons: e.buttons, shift: e.shiftKey, x: e.clientX, y: e.clientY, inside: true });
  if (e.buttons) queueMouse();
});
gl.addEventListener('pointerup', (e) => {
  Object.assign(mouse, { buttons: e.buttons, x: e.clientX, y: e.clientY });
  queueMouse();
});
gl.addEventListener('pointerleave', () => { if (!mouse.buttons) mouse.inside = false; });
gl.addEventListener('contextmenu', (e) => e.preventDefault());
gl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const c = mode === 'planes' ? layout.cellAt(e.clientX, e.clientY) : null;
  if (c && cells[c] && cells[c].adjusting && refImages.has(c)) { // resize the photo being adjusted
    refImages.setState(c, scaleImage(refImages.state[c], e.deltaY > 0 ? 1 / 1.06 : 1.06));
    placeTrace(c);
  } else sketch.zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1);
}, { passive: false });
const mouseFrame = () => (mouse.inside ? {
  x: mouse.x, y: mouse.y, cx: mouse.x, cy: mouse.y, source: 'mouse',
  pinch: !!(mouse.buttons & 1) && !mouse.shift, grab: !!(mouse.buttons & 1) && mouse.shift,
  fist: !!(mouse.buttons & 2), peace: !!(mouse.buttons & 4),
} : null);

// -------------------------------------------------------------------------------- tracking
async function startCamera() {
  // 720p is plenty for the detector (it downscales to ~200 px) and keeps the frame rate up: a higher frame rate means
  // shorter exposures and less motion blur on a moving hand.
  const { stream } = await openCamera(); // asks for at least 24 fps first (less motion blur), then settles for less
  const track = stream.getVideoTracks()[0];
  cameraAssist = new CameraAssist(track);
  try { await cameraAssist.start(); } catch (e) { console.warn('camera controls', e); } // continuous exposure/focus/white balance, no OS effects
  video.srcObject = stream;
  await video.play();
  cameraOn = true;
  sessionLog.setMeta({ userAgent: navigator.userAgent, camera: cameraAssist.status() });
}

/** Turn a freshly measured frame into conditions: show a hint for a new one, nudge the camera's exposure, keep the log. */
function senseConditions(stats, box, t) {
  const subject = box ? stats.median : stats.p30;
  if (box) { // sharpness of the hand, on a bigger copy than the brightness meter uses
    if (++sharpTick % 2 === 0) {
      sharpCtx.drawImage(video, 0, 0, sharpCanvas.width, sharpCanvas.height);
      lastSharp = sharpness.ratio(laplacianVariance({ data: sharpCtx.getImageData(0, 0, sharpCanvas.width, sharpCanvas.height).data, w: sharpCanvas.width, h: sharpCanvas.height }, box));
    }
  } else lastSharp = null;
  const palm = last.main && currentRange().roi && currentRange().roi.w === 1 ? last.main.reading.palm : undefined; // small hands are expected at Far
  const sample = { mean: stats.global, clip: stats.clip, subject, fps: infer.fps || undefined, sharp: lastSharp ?? undefined, palm };
  const change = conditions.feed(sample, t);
  sessionLog.note({ mean: +stats.global.toFixed(3), clip: +stats.clip.toFixed(3), subject: +subject.toFixed(3), gain: +lastCorr.gain.toFixed(2), sharp: lastSharp === null ? null : +lastSharp.toFixed(2), conditions: [...conditions.active], comp: cameraAssist ? cameraAssist.comp : 0 });
  for (const c of change.off) sessionLog.event(t, c, false);
  for (const c of change.on) {
    sessionLog.event(t, c, true);
    if (!(t - (announced[c] ?? -Infinity) < 60)) { announced[c] = t; hud.toast(`${HINTS[c][0]}. ${HINTS[c][1]}`, 'warn', 8000); }
  }
  if (cameraAssist) cameraAssist.adapt(conditions.primary, t).catch((e) => console.warn('camera exposure', e));
}

function saveSessionLog() {
  if (cameraAssist) sessionLog.setMeta({ camera: cameraAssist.status() });
  const url = URL.createObjectURL(new Blob([JSON.stringify(sessionLog, null, 1)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `formflow-session-${new Date().toISOString().replace(/[:.]/g, '-')}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  hud.toast('Session log saved (a few KB; nothing was uploaded)', 'ok', 5000);
}

let visionFileset = null, benchmarking = false;

// Which model tracks the hands: chosen in the Models panel, remembered between visits. Only models that give hand points can be used.
const HAND_IDS = MODELS.map((m) => m.id); // every model in the list can be used
const readHandModel = () => { try { const id = localStorage.getItem('formflow.handModel'); return HAND_IDS.includes(id) ? id : null; } catch { return null; } };
let activeModel = readHandModel() || 'hand-gpu';
let detectWidth = 0; // 0 = the camera's own size; a smaller number = a shrunken copy goes to the detector

/** The Gesture Recognizer names its calls recognize(); the app calls every hand model detect(). */
const adapt = (lm, model) => {
  if (lm.recognizeForVideo) { lm.detectForVideo = (...a) => lm.recognizeForVideo(...a); lm.detect = (...a) => lm.recognize(...a); }
  if (model.api === 'holistic') { // its result is turned into the shape of a hand result
    const video = lm.detectForVideo.bind(lm), still = lm.detect.bind(lm);
    lm.detectForVideo = (img, ts) => holisticAsHands(video(img, ts));
    lm.detect = (img) => holisticAsHands(still(img));
  }
  return lm;
};

async function startTracker() {
  const fileset = visionFileset = await FilesetResolver.forVisionTasks('./vendor/wasm');
  const build = async (m0) => {
    const model = { ...m0, path: await modelPath(m0) };
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: model.path, delegate },
      runningMode: 'VIDEO', numHands: 4, minHandDetectionConfidence: 0.45, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
    });
    const order = model.delegate === 'CPU' ? ['CPU'] : ['GPU', 'CPU']; // no graphics-card support: fall back to the processor
    for (const d of order) {
      try { const lm = adapt(await FACTORY[model.api].createFromOptions(fileset, opts(d)), model); sessionLog.setMeta({ delegate: d, handModel: model.id }); detectWidth = model.picture || 0; return lm; }
      catch (e) { if (d === order[order.length - 1]) throw e; }
    }
  };
  const chosen = MODELS.find((m) => m.id === activeModel) || MODELS[0];
  try { tracker = await build(chosen); }
  catch (e) { // a model that cannot start (offline, blocked) must never leave the app without hand tracking
    if (chosen.id === 'hand-gpu') throw e;
    hud.toast(`${chosen.title} could not start (${e.message || 'no connection?'}). Using the standard hand model.`, 'warn', 7000);
    activeModel = 'hand-gpu';
    try { localStorage.removeItem('formflow.handModel'); } catch { /* private window */ }
    tracker = await build(MODELS[0]);
  }
  trackerMode = 'VIDEO';
  loadPose(fileset); // the forearm model loads in the background; hands work without it
}

async function loadPose(fileset) {
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: './vendor/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  try {
    try { poseModel = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { poseModel = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
    applySettings();
  } catch (e) { console.warn('forearm model unavailable', e); poseModel = null; }
}

// Whole frame + temporal tracking is fastest and right for a close camera. Far ranges feed the detector CROPPED frames
// instead (the hands are several times larger to it), which needs MediaPipe's per-image mode.
async function configureTracker() {
  if (!tracker) return;
  const p = currentRange();
  const mode = p.roi && p.roi.w === 1 ? 'VIDEO' : 'IMAGE';
  const prev = trackerMode;
  trackerMode = null; // pause detection while options change
  try {
    await tracker.setOptions({
      runningMode: mode,
      minHandDetectionConfidence: p.detection.detect, minHandPresenceConfidence: p.detection.presence, minTrackingConfidence: p.detection.track,
    });
    trackerMode = mode;
  } catch (e) { console.warn('tracker options', e); trackerMode = prev; }
}

const unmirroredHands = (aspect) => {
  const hands = ['main', 'second'].filter((r) => last[r] && now() - seen[r] < 0.5).map((r) => {
    const lm = last[r].lm; // mirrored; the crop works on the raw camera image
    return { cx: 1 - (lm[0].x + lm[9].x) / 2, cy: (lm[0].y + lm[9].y) / 2, palm: dist(lm[0], lm[9], aspect) };
  });
  if (!poseModel || !settings.forearm) return hands;
  // a wrist with no hand on it yet (lost or too small): aim the crop there
  const arms = forearm.hints(now()).filter((a) => !hands.some((h) => Math.hypot(h.cx - a.cx, h.cy - a.cy) < 0.1));
  return hands.concat(arms);
};

/** Measure how bright the hand area is (the tracked hands, or where hands usually are) on a tiny copy of the frame. */
function meterFrame(t) {
  meterCtx.drawImage(video, 0, 0, meterCanvas.width, meterCanvas.height);
  const hands = ['main', 'second'].filter((r) => last[r]).map((r) => ({
    lm: last[r].lm.map((q) => ({ x: 1 - q.x, y: q.y })), palm: last[r].reading.palm, // landmarks are mirrored; the video is not
  }));
  const box = handBox(hands);
  const stats = regionStats({ data: meterCtx.getImageData(0, 0, meterCanvas.width, meterCanvas.height).data, w: meterCanvas.width, h: meterCanvas.height }, box || SEARCH_BOX);
  exposure.measure(stats, !!box);
  if (stats) senseConditions(stats, box, t);
}

function detectFrame(t, tms) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !tracker || !trackerMode) return;
  const tStart = performance.now();
  const p = currentRange();
  let roi = p.roi;
  if (roi === null) { planner.aspect = vw / vh; roi = planner.plan(unmirroredHands(vw / vh), t); }
  const handSeen = handTracker.active.length > 0;
  if (exposure.enabled && ++meterTick % 6 === 0) meterFrame(t);
  const corr = exposure.next(handSeen, t);
  const css = filterCss(corr);
  lastCorr = corr;
  let result, source = video, tLight = tStart;
  if (trackerMode === 'VIDEO') {
    roi = FULL;
    if (css !== 'none' || detectWidth) { // the detector sees a brightened and/or smaller copy; the screen keeps showing the real camera picture
      const k = Math.min(1, (detectWidth || 1280) / vw), dw = Math.round(vw * k), dh = Math.round(vh * k);
      if (enhCanvas.width !== dw || enhCanvas.height !== dh) { enhCanvas.width = dw; enhCanvas.height = dh; }
      enhCtx.filter = css;
      enhCtx.drawImage(video, 0, 0, dw, dh);
      source = enhCanvas;
    }
    tLight = performance.now();
    result = tracker.detectForVideo(source, tms);
  } else {
    const r = cropRect(roi, vw, vh);
    if (cropCanvas.width !== r.dw || cropCanvas.height !== r.dh) { cropCanvas.width = r.dw; cropCanvas.height = r.dh; }
    cropCtx.filter = css;
    cropCtx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, r.dw, r.dh);
    tLight = performance.now();
    result = tracker.detect(cropCanvas);
  }
  const tDetected = performance.now();
  profiler.stage('light', tLight - tStart);
  profiler.stage('detect', tDetected - tLight);
  // a search variant (stronger or no correction) found the hand: keep using that level
  if (!handSeen && corr.variant !== 'measured' && result.landmarks && result.landmarks.length) exposure.adopt(corr);
  lastRoi = roi;
  // the arm moves slowly, so it is checked every few frames; less often while the hands are tracked well (it only helps lost or small hands)
  if (poseModel && settings.forearm && ++poseTick % (quality.poseEvery * (handSeen ? 2 : 1)) === 0) {
    const tp = performance.now();
    try { forearm.update(poseModel.detectForVideo(source, tms), t); } catch (e) { console.warn('forearm', e); }
    profiler.stage('pose', performance.now() - tp);
  }
  processResult(result, t, roi);
  sessionLog.frame(t, handTracker.active.length > 0);
}

function processResult(result, t, roi = FULL) {
  const aspect = video.videoWidth / video.videoHeight || 16 / 9;
  mapper.set({ camAspect: aspect });
  const dets = (result.landmarks || []).map((pts, i) => {
    const cat = result.handedness?.[i]?.[0];
    return {
      // the camera image is not mirrored here, so MediaPipe's Left/Right are swapped relative to the user's hands
      side: cat?.categoryName === 'Left' ? 'Right' : 'Left',
      score: cat?.score ?? 1,
      lm: pts.map((p) => { const q = fromCrop(p, roi); return { x: 1 - q.x, y: q.y, z: q.z }; }),
      world: result.worldLandmarks?.[i] || null, // 3D metres: unaffected by turning the hand
    };
  });
  const out = handTracker.update(dets, t, aspect);
  for (const role of ['main', 'second']) {
    const o = out[role];
    if (!o) { last[role] = null; continue; }
    const r = o.reading;
    const p = mapper.map(r.cur, r.palm), c = mapper.map(r.center, r.palm);
    last[role] = {
      reading: r, lm: o.lm, held: o.held, label: o.label,
      frame: { x: p.x, y: p.y, cx: c.x, cy: c.y, pinch: r.pinch, grab: r.grab, fist: r.fist, peace: r.peace, point: r.point, source: 'hand' },
    };
    seen[role] = t;
  }
  infer.n++;
  infer.mode = trackerMode || '';
}

// What is shown and drawn with is smoothed at screen rate (core/smooth.js): the detector's updates are few and a little noisy
const STEADY = { off: 0, normal: 1, high: 1.7 };
const PX = { near: 2.5, far: 45 }; // the cursor is in screen pixels
const smoothers = Object.fromEntries(['main', 'second'].map((r) => [r, { lm: new LandmarkFollower(), pos: new Follower(PX), ctr: new Follower(PX) }]));
const shown = { main: null, second: null };

function smoothHands(t) {
  const k = STEADY[settings.steady] ?? 1;
  for (const role of ['main', 'second']) {
    const l = last[role], sm = smoothers[role];
    if (!l || t - seen[role] > 0.25) { sm.lm.reset(); sm.pos.reset(); sm.ctr.reset(); shown[role] = null; continue; }
    const [x, y] = sm.pos.follow([l.frame.x, l.frame.y], t, k), [cx, cy] = sm.ctr.follow([l.frame.cx, l.frame.cy], t, k);
    shown[role] = { lm: sm.lm.follow(l.lm, t, k), frame: { ...l.frame, x, y, cx, cy }, reading: l.reading };
  }
}

function handFrames(t) { // a brief dropout must not end a stroke
  const f = {};
  for (const role of ['main', 'second']) f[role] = shown[role] ? shown[role].frame : null;
  return f;
}

// --------------------------------------------------------------------------- reach calibration
let reachCal = null;
const reachUi = document.createElement('div');
reachUi.id = 'reach';
reachUi.innerHTML = '<div class="corner tl"></div><div class="corner br"></div><div class="card"><b></b><small>Keep your hand still for a second. Press Esc to cancel.</small><div class="bar2"><i></i></div></div>';
document.body.append(reachUi);

function startReach() {
  if (!cameraOn) return hud.toast('Reach calibration needs the camera', 'warn');
  settingsPanel.close();
  reachCal = new ReachCalibrator();
  reachUi.classList.add('on');
}
function cancelReach() { reachCal = null; reachUi.classList.remove('on', 's0', 's1'); }
function stepReach(t) {
  const h = ['main', 'second'].map((r) => last[r] && t - seen[r] < 0.25 ? last[r] : null).find(Boolean);
  reachCal.feed(h ? h.reading.center : null, t);
  reachUi.classList.toggle('s0', reachCal.step === 0);
  reachUi.classList.toggle('s1', reachCal.step === 1);
  reachUi.querySelector('b').textContent = reachCal.message;
  reachUi.querySelector('.bar2 i').style.width = `${Math.round(reachCal.progress * 100)}%`;
  if (reachCal.done) {
    settings = normalizeSettings({ ...settings, region: reachCal.region });
    cancelReach();
    saveSettings();
    applySettings();
    hud.toast('Reach area saved: your hands now cover the whole screen from that area', 'ok', 6000);
  }
}

// ------------------------------------------------------------------------------------ loop
const now = () => (testClock !== null ? testClock : performance.now() / 1000);
let fps = 60, lastTick = performance.now(), chipTimer = 0;

// A webcam delivers 30 pictures a second but the screen redraws 60 times; video.currentTime advances on every redraw, so
// "the time changed" fires twice per picture and the detector would look at each picture twice (a session log showed ~60
// detections a second from a 30 fps camera). requestVideoFrameCallback says when a NEW picture has really arrived.
let cameraFrame = false;
const hasFrameCallback = typeof video.requestVideoFrameCallback === 'function';
if (hasFrameCallback) { const onFrame = () => { cameraFrame = true; video.requestVideoFrameCallback(onFrame); }; video.requestVideoFrameCallback(onFrame); }
function newCameraFrame() {
  if (hasFrameCallback) { const fresh = cameraFrame; cameraFrame = false; return fresh; }
  const fresh = video.currentTime !== lastVT; lastVT = video.currentTime; return fresh; // older browsers: the best available signal
}

function tick(tms) {
  const tWork = performance.now();
  const dt = tms - lastTick; lastTick = tms;
  if (dt > 0) fps += (1000 / dt - fps) * 0.08;
  if (dt > 0 && dt < 500) profiler.frame(dt, tms / 1000); // a longer gap is a hidden tab, not lag
  const t = now();
  if (tracker && cameraOn && trackerMode && !benchmarking && video.readyState >= 2 && newCameraFrame() && testClock === null) {
    // when frames run long the detector runs on every other camera frame: 15 detections a second still track a hand well
    if (++detectTick % quality.detectEvery === 0) { try { detectFrame(t, tms); } catch (e) { console.warn('tracking', e); } }
  }
  if (reachCal) stepReach(t);
  if (joinPrompt.open && sketch.busy) dismissJoin(); // starting something new answers 'no'
  if (!joinPrompt.open && sketch.joinHint) sketch.joinHint = null;
  smoothHands(t);
  const hands = testClock === null ? handFrames(t) : { main: null, second: null };
  const handActive = !!(hands.main || hands.second);

  overlay.clear();
  if (guide.visible) {
    if (guide.practiceActive) guide.feed((last.main || last.second) && t - Math.max(seen.main, seen.second) < 0.25 ? (last.main || last.second).reading : null, t);
  } else if (testClock === null && !reachCal) {
    if (handActive) {
      mouseQueue.length = 0;
      controller.update({ main: hands.main, second: hands.second }, t);
    } else {
      const queued = mouseQueue.splice(0);
      if (queued.length) queued.forEach((f, i) => controller.update({ main: f, second: hands.second }, t + i * 0.001));
      else controller.update({ main: mouseFrame(), second: hands.second }, t);
    }
  }
  drawHands(t);
  stepPlanes(t);
  sketch.glide(t);
  const tDraw = performance.now();
  view.render(getRect());
  profiler.stage('draw', performance.now() - tDraw);

  if (tms - chipTimer > 250) {
    chipTimer = tms;
    hud.setFps(fps);
    refreshAvailability();
    scrollFab.update();
    sessionLog.note({ frameMs: +profiler.avg.frame.toFixed(1), workMs: +profiler.avg.work.toFixed(1), detectMs: +profiler.avg.detect.toFixed(1), quality: governor.level });
    const lvl = governor.update(profiler.avg.frame, tms / 1000);
    if (lvl !== null) applyQuality(lvl);
    const nowMs = performance.now();
    if (nowMs - infer.since >= 1000) { infer.fps = (infer.n * 1000) / (nowMs - infer.since); infer.n = 0; infer.since = nowMs; }
    diagnostics.update({
      inferFps: infer.fps, mode: infer.mode || 'idle',
      light: !exposure.enabled ? 'off' : `${lastCorr.gain < 1.04 && lastCorr.gain > 0.96 ? 'not needed' : `brightness ×${lastCorr.gain.toFixed(2)}`}${exposure.searching ? ` · searching (${lastCorr.variant})` : ''}`, crop: lastRoi && lastRoi.w < 0.999 ? `${Math.round(lastRoi.w * 100)}%` : '',
      perf: { ...profiler.avg, worst: profiler.worst, fps: profiler.fps, bound: profiler.bound, heaviest: profiler.heaviest, level: governor.level, over: profiler.over, quality },
      conditions: !exposure.enabled ? 'off' : conditions.active.size ? [...conditions.active].map((c) => HINTS[c][0]).join(', ') : 'none',
      camera: cameraAssist ? cameraAssist.status() : null, rate: sessionLog.rate(3),
      forearm: poseModel ? (settings.forearm ? `on · ${forearm.fresh(now()).length} arm(s) seen` : 'off') : 'model not loaded', stats: handTracker.stats, hands: { main: last.main, second: last.second }, dominant: settings.dominant,
    });
    const av = sketch.alignedView();
    if (hullPanel.open) hullPanel.update(describeOutlines(sketch.items), av);
    if (mode === 'planes') planeBar.update(describeOutlines(sketch.items), sharedDimensions(sketch.items), sketch.cellView, photoFlags());
    badge.hidden = !av || mode === 'planes';
    if (av) badge.textContent = `${av.toUpperCase()} VIEW`;
    const dn = settings.dominant, nv = otherHand(dn);
    hud.setHand('main', !!hands.main, hands.main ? `Draw (${dn}): ${hands.main.pinch ? 'pinch' : hands.main.grab ? 'grab' : hands.main.point ? 'point' : 'ready'}` : `Draw hand (${dn})`);
    hud.setHand('second', !!hands.second, hands.second ? `Nav (${nv}): ${hands.second.fist ? 'orbit' : hands.second.peace ? 'pan' : 'ready'}` : `Nav hand (${nv})`);
  }
  profiler.stage('work', performance.now() - tWork);
  requestAnimationFrame(tick);
}

/** Buttons that would do nothing are greyed out, so what can be pressed is clear at a glance. */
function refreshAvailability() {
  const items = sketch.items, solids = items.some((it) => it.volumetric);
  hud.setEnabled('undo', sketch.ops.length > 0);
  hud.setEnabled('delete', !!sketch.selected);
  hud.setEnabled('clear', items.length > 0);
  hud.setEnabled('exportOBJ', items.length > 0);
  hud.setEnabled('exportSTL', solids);
}

/** Apply a quality level: drawing resolution now, detection and arm-check rates through `quality`. */
function applyQuality(level) {
  const was = quality;
  quality = qualitySettings(level, window.devicePixelRatio || 1);
  view.setPixelRatio(quality.pixelRatio);
  if (level > 0 && quality.pixelRatio < was.pixelRatio || quality.detectEvery > was.detectEvery) hud.toast(`Running slow (${profiler.fps.toFixed(0)} fps): lowered the drawing detail to keep it smooth. Press D to see why.`, 'info', 6000);
}

function drawHands(t) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  let hover = null;
  for (const role of ['main', 'second']) {
    const l = shown[role];
    if (!l) continue;
    overlay.skeleton(l.lm, role, vw, vh, l.reading);
    const f = l.frame, nav = f.fist || f.peace;
    const [x, y] = nav ? [f.cx, f.cy] : [f.x, f.y];
    if (!guide.visible) overlay.cursor(x, y, role, f.pinch || f.grab, role === 'main' ? '' : 'NAV');
    if (role === 'main' && !guide.visible) hover = hud.hit(f.x, f.y);
    if (role === 'main' && controller.dwell.progress > 0 && !guide.visible) overlay.progress(x, y, controller.dwell.progress);
    if (role === 'main' && controller.hold.progress > 0 && !guide.visible) overlay.progress(x, y, controller.hold.progress, '#1473E6');
  }
  hud.hover(hover);
  if (lastRoi && lastRoi.w < 0.999 && !guide.visible) { // where the detector is looking (far / auto ranges)
    const [x0, y0] = Overlay.videoToScreen(1 - (lastRoi.x + lastRoi.w), lastRoi.y, vw, vh);
    const [x1, y1] = Overlay.videoToScreen(1 - lastRoi.x, lastRoi.y + lastRoi.h, vw, vh);
    overlay.ctx.save(); overlay.ctx.setLineDash([6, 8]); overlay.ctx.strokeStyle = 'rgba(0,0,0,.35)'; overlay.ctx.lineWidth = 1.5;
    overlay.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); overlay.ctx.restore();
  }
}

// ----------------------------------------------------------------------------------- startup
const badge = document.createElement('div');
badge.id = 'viewbadge';
badge.hidden = true;
$('hud').append(badge);

const diagnostics = new Diagnostics($('hud'), { onSave: () => saveSessionLog() });
if (params.has('debug')) diagnostics.toggle();

const settingsPanel = new SettingsPanel($('hud'), {
  get: () => settings,
  set: setSetting,
  reach: () => startReach(),
  resetReach: () => { settings = normalizeSettings({ ...settings, region: null }); saveSettings(); applySettings(); hud.toast('Reach area reset to the preset', 'ok'); },
});

const guide = new Guide($('guide'), ({ calibration, mouseOnly }) => {
  if (calibration) { settings = normalizeSettings({ ...settings, ...calibration }); saveSettings(); applySettings(); }
  if (mouseOnly && !tracker) document.body.classList.add('nocam');
  hud.toast(mouseOnly && !cameraOn ? 'Mouse mode: left-drag draws, right-drag orbits, middle-drag pans, wheel zooms.' : 'Ready. Pick a tool, then pinch and drag in the scene.', 'ok', 6000);
}, { getSettings: () => settings, onSetting: (k, v) => setSetting(k, v) });
applySettings();

window.addEventListener('resize', () => {
  view.resize(); overlay.resize(); if (mode === 'planes') layoutPlanes(); mapper.set({ width: window.innerWidth, height: window.innerHeight });
});

(async function boot() {
  guide.show();
  if (params.has('nocam')) {
    document.body.classList.add('nocam');
    guide.setTracker('error', 'Camera disabled (mouse mode)');
  } else {
    try {
      guide.setTracker('loading', 'Starting camera…');
      await startCamera();
      guide.setTracker('loading', 'Loading hand tracking model…');
      await startTracker();
      await configureTracker();
      guide.setTracker('ready', '');
    } catch (e) {
      document.body.classList.add('nocam');
      guide.setTracker('error', `Camera or tracking unavailable (${e.name || 'error'}). You can continue with the mouse.`);
    }
  }
})();
requestAnimationFrame(tick);

// Hook for automated checks: drive the controller with scripted frames on a virtual clock.
window.formflow = {
  conditions, sessionLog, senseConditions, profiler, governor, applyQuality, get cameraAssist() { return cameraAssist; },
  demoPanel, loadDemo, focusView, modelLab, runModelTest, scrollFab,
  sketch, controller, perform, importBuffer, guide, hud, view, tracks, handTracker, diagnostics, bridge, processResult, last, settingsPanel, planner, mapper, hullPanel, joinPrompt,
  get pendingJoin() { return pendingJoin; }, answerJoin, joinAll, makeHull, photosTo3D, setView, hullOpts, setMode, layout, planeBar, refImages, loadImage, cellOp, cells, planeOpts, traced, stepPlanes, get mode() { return mode; },
  get settings() { return settings; }, setSetting, startReach, currentRange,
  stepFrames(frames, dt = 1 / 30) {
    testClock = testClock === null ? 1000 : testClock;
    for (const f of frames) { testClock += dt; controller.update('main' in f || 'second' in f ? f : { main: f, second: null }, testClock); }
    view.render(getRect());
    return testClock;
  },
  endTest() { testClock = null; },
  /** For automated checks without a webcam: use any MediaStream (for example a canvas) as the camera. */
  async attachStream(stream) { video.srcObject = stream; await video.play(); cameraOn = true; if (!tracker) { await startTracker(); await configureTracker(); } },
};

if (params.has('demo')) import('./demo.js').then(({ runDemo }) => runDemo(params.get('demo'), window.formflow, params)); // presentation / screenshot scenes
