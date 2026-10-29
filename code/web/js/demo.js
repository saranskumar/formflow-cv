// Demo scenes for screenshots and presentations: open the app with ?nocam&demo=<name>.
//   sketch  a 3D scene with solids and strokes     hands   two synthetic hands tracked live (skeletons, pinch, fist)
//   planes  Front / Side / Top outlines + live hull  photo   Front / Side / Top outlines found in pictures
//   hull    the finished hull as an ordinary 3D object
// Everything goes through the same public hooks the tests use, so what is shown is the real app.
import { Poly, Solid } from './core/shapes.js';

const loop = (pts) => [...pts, pts[0]];

// ----------------------------------------------------------------------------- synthetic hands
const OPEN = [[0, 0], [0.42, -0.22], [0.68, -0.5], [0.88, -0.78], [1.02, -1.08], [0.5, -0.98], [0.55, -1.45], [0.57, -1.75], [0.58, -2.02],
  [0.08, -1.0], [0.1, -1.5], [0.1, -1.82], [0.1, -2.1], [-0.33, -0.95], [-0.38, -1.4], [-0.4, -1.7], [-0.42, -1.95],
  [-0.68, -0.8], [-0.76, -1.2], [-0.8, -1.45], [-0.82, -1.68]];
const MCP = { 5: [0.5, -0.98], 9: [0.08, -1.0], 13: [-0.33, -0.95], 17: [-0.68, -0.8] };

function pose(name) {
  const p = OPEN.map((q) => q.slice());
  if (name === 'pinch') {
    p[2] = [0.62, -0.55]; p[3] = [0.6, -0.95]; p[4] = [0.58, -1.38];
    p[6] = [0.6, -1.4]; p[7] = [0.62, -1.55]; p[8] = [0.6, -1.42];
  } else if (name === 'fist') {
    for (const [m, [x, y]] of Object.entries(MCP)) {
      const i = +m;
      p[i + 1] = [x + 0.02, y - 0.2]; p[i + 2] = [x + 0.02, y - 0.12]; p[i + 3] = [x + 0.02, y + 0.12];
    }
    p[2] = [0.55, -0.5]; p[3] = [0.5, -0.7]; p[4] = [0.35, -0.85];
  }
  return p;
}

/** One MediaPipe-style result for hands given as { at: [x, y] in the mirrored picture, size, pose, label }. */
function result(hands, aspect = 16 / 9) {
  const out = { landmarks: [], handedness: [], worldLandmarks: [] };
  for (const h of hands) {
    const pts = pose(h.pose);
    out.landmarks.push(pts.map(([u, v]) => ({ x: 1 - (h.at[0] + (u * h.size) / aspect), y: h.at[1] + v * h.size, z: 0 })));
    out.worldLandmarks.push(pts.map(([u, v]) => ({ x: u * 0.09, y: v * 0.09, z: 0 })));
    out.handedness.push([{ categoryName: h.label, score: 0.95 }]);
  }
  return out;
}

function feedHands(ff, hands, ms = 33) {
  const tick = () => ff.processResult(result(hands), performance.now() / 1000);
  tick();
  return setInterval(tick, ms);
}

// ----------------------------------------------------------------------------- scenes
function sketchScene(ff) {
  const s = ff.sketch;
  s.addItem(new Solid('cube', [-0.55, -0.55, 0.15], 0.34));
  s.addItem(new Solid('sphere', [0.3, -0.6, 0.3], 0.3));
  s.addItem(new Solid('cylinder', [0.05, -0.5, -0.45], 0.28));
  s.addItem(new Solid('cone', [0.7, -0.5, -0.3], 0.26));
  const wave = [...Array(60)].map((_, i) => { const t = i / 59; return [-0.9 + 1.8 * t, 0.2 + 0.28 * Math.sin(t * 9), 0.1 * Math.cos(t * 6)]; });
  s.addItem(new Poly('free', wave));
  const ring = [...Array(41)].map((_, i) => { const a = (i / 40) * 2 * Math.PI; return [0.15 + 0.35 * Math.cos(a), 0.05 + 0.35 * Math.sin(a), 0.55]; });
  s.addItem(new Poly('circle', ring, true));
  s.setTool('free');
  ff.hud.setTool('free');
}

function planeViews(ff) {
  const L = [[-0.6, -0.6], [0.6, -0.6], [0.6, -0.2], [-0.2, -0.2], [-0.2, 0.6], [-0.6, 0.6]];
  const s = ff.sketch;
  s.addItem(new Poly('free', loop(L.map(([x, y]) => [x, y, 0])), true));                       // Front: an L
  s.addItem(new Poly('free', loop([[-0.4, -0.6], [0.4, -0.6], [0.4, 0.6], [-0.4, 0.6]].map(([z, y]) => [0, y, z])), true)); // Side: plain
  s.addItem(new Poly('free', loop([[-0.6, -0.4], [0.6, -0.4], [0.6, 0.4], [-0.6, 0.4]].map(([x, z]) => [x, 0, z])), true));  // Top: plain
}

/** The sample pictures served from /samples/<set>/<view>.png (see samples/index.json). */
async function samplePictures(set, views = ['front', 'side', 'top']) {
  const files = [];
  for (const v of views) {
    const r = await fetch(`/samples/${set}/${v}.png`);
    if (r.ok) files.push(new File([await r.blob()], `${v}.png`, { type: 'image/png' }));
  }
  return files;
}

export async function runDemo(name, ff, params = new URLSearchParams()) {
  const set = params.get('set') || 'head';
  ff.guide.hide();
  document.body.classList.add('demo');
  if (name === 'sketch') { sketchScene(ff); ff.hud.toast('Pick a shape, pinch and drag in the air. Orbit with the other hand.', 'ok', 600000); }
  else if (name === 'hands') {
    sketchScene(ff);
    ff.hud.toast('Two hands tracked: the drawing hand pinches, the other hand navigates.', 'ok', 600000);
    feedHands(ff, [{ at: [0.62, 0.55], size: 0.2, pose: 'pinch', label: 'Left' }, { at: [0.3, 0.6], size: 0.2, pose: 'fist', label: 'Right' }]);
  } else if (name === 'planes') {
    ff.setMode('planes');
    planeViews(ff);
    ff.stepPlanes(1e6); ff.stepPlanes(1e6 + 1);
  } else if (name === 'photo') { // pictures placed in the three views, outlines found, live hull
    ff.setMode('planes');
    for (const f of await samplePictures(set)) await ff.loadImage(f.name.replace('.png', ''), f);
    ff.stepPlanes(1e6); ff.stepPlanes(1e6 + 1);
  } else if (name === 'photohull') { // the same pictures taken all the way to a 3D object
    await ff.photosTo3D(await samplePictures(set));
    ff.sketch.yaw = 0.7; ff.sketch.pitch = 0.3;
  } else if (name === 'hull') {
    ff.setMode('planes');
    planeViews(ff);
    ff.makeHull();
    ff.sketch.yaw = 0.7; ff.sketch.pitch = 0.4;
  }
  window.demoReady = true;
}
