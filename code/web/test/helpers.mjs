// Synthetic hands. Coordinates are in "palm units" (wrist -> middle knuckle = 1) laid out in true aspect space,
// then converted to image fractions, so distances behave exactly like real landmarks.
export const ASPECT = 16 / 9;

const FINGERS = {
  index: { pip: [0.4, -1.2], ext: [0.4, -2.0], cur: [0.4, -0.7], ids: [6, 8] },
  middle: { pip: [0.0, -1.25], ext: [0.0, -2.1], cur: [0.0, -0.7], ids: [10, 12] },
  ring: { pip: [-0.35, -1.2], ext: [-0.35, -2.0], cur: [-0.35, -0.7], ids: [14, 16] },
  pinky: { pip: [-0.65, -1.1], ext: [-0.65, -1.8], cur: [-0.65, -0.6], ids: [18, 20] },
};

/** Palm-unit points [x, y] of a pose (wrist at 0,0; wrist to middle knuckle = 1). */
export function palmPoints(pose = 'open', g = 0.05) {
  const P = new Array(21).fill(null).map(() => [0, 0]);
  P[0] = [0, 0];
  P[9] = [0, -1];
  const up = { index: true, middle: true, ring: true, pinky: true };
  if (pose === 'fist') Object.keys(up).forEach((k) => (up[k] = false));
  if (pose === 'peace') { up.ring = false; up.pinky = false; }
  if (pose === 'point') { up.middle = false; up.ring = false; up.pinky = false; }
  for (const [k, f] of Object.entries(FINGERS)) {
    P[f.ids[0]] = f.pip;
    P[f.ids[1]] = up[k] ? f.ext : f.cur;
  }
  let thumb = [0.9, -1.4];
  if (pose === 'pinch') {
    thumb = [0.45, -1.45];
    P[8] = [thumb[0] + g, thumb[1]];
  } else if (pose === 'grab') {
    thumb = [0.1, -1.5];
    P[12] = [thumb[0] + g, thumb[1]];
  } else if (pose === 'fist') {
    thumb = [0.3, -0.9];
  } else if (pose === 'peace' || pose === 'point') {
    thumb = [0.7, -0.8];
  }
  P[4] = thumb;
  return P;
}

/** pose: open | pinch | grab | fist | peace.  g = gap (palm units) between the pinching fingertips. */
export function hand({ pose = 'open', g = 0.05, at = [0.5, 0.5], size = 0.1 } = {}) {
  return palmPoints(pose, g).map(([x, y]) => ({ x: at[0] + (x * size) / ASPECT, y: at[1] + y * size, z: 0 }));
}

/**
 * A hand with both views of it: image landmarks (what the camera sees, foreshortened when the hand is turned) and 3D
 * world landmarks in metres (what MediaPipe reports, unaffected by turning). rotY = turn about the vertical axis.
 */
export function hand3d({ pose = 'open', g = 0.05, at = [0.5, 0.5], size = 0.1, rotY = 0 } = {}) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const pts = palmPoints(pose, g).map(([x, y]) => [x * c, y, -x * s]); // z is 0 before the turn: pure foreshortening
  return {
    lm: pts.map(([x, y, z]) => ({ x: at[0] + (x * size) / ASPECT, y: at[1] + y * size, z: z * size })),
    world: pts.map(([x, y, z]) => ({ x: x * 0.09, y: y * 0.09, z: z * 0.09 })),
  };
}

/** A detection as the tracker receives it. */
export function det(side, at, size, { pose = 'open', g = 0.05, score = 0.9, rotY = 0, world = true } = {}) {
  const h = hand3d({ pose, g, at, size, rotY });
  return { side, score, lm: h.lm, world: world ? h.world : null };
}

export function feed(track, secs, opts, t0 = 0, fps = 30) {
  let out = null;
  let t = t0;
  for (let i = 0; i < Math.round(secs * fps); i++) {
    out = track.step(hand(opts), t);
    t += 1 / fps;
  }
  return [out, t];
}
