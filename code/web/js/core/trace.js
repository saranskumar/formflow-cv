// Find the silhouette of the main object in a picture, as a closed outline.
//
// Pipeline: pixels -> "is this the object?" mask -> remove specks, fill holes -> largest blob -> boundary walk ->
// simplify. Pure functions over RGBA data so they run (and are tested) in Node.
//
// mode: 'auto'  the object is whatever differs from the picture's background. Real photos are unevenly lit, so the
//                background is modelled per pixel by blending the colours along the four borders (a Coons patch),
//                which follows gradients and vignetting. Several candidate masks (that model, one background
//                colour, dark object, light object) are tried and the most object-like one wins. Transparent
//                pixels count as background;
//       'dark'  dark object on a light page (scans, pencil drawings);
//       'light' light object on a dark background.

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Otsu's threshold of a 0..255 histogram: the cut that best separates two groups. */
export function otsu(hist) {
  const total = hist.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wB = 0, sB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** 3x3 box blur of the RGB channels: takes the edge off camera noise and JPEG blocks before thresholding. */
export function blur3({ data, w, h }) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const i = (yy * w + xx) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    const o = (y * w + x) * 4;
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = data[o + 3];
  }
  return { data: out, w, h };
}

/** Colours along one border line, median-smoothed so noise and a small object touching the edge do not count. */
function edgeColours(data, idx, win = 7) {
  const n = idx.length, out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    for (let ch = 0; ch < 3; ch++) {
      const v = [];
      for (let j = Math.max(0, k - win); j <= Math.min(n - 1, k + win); j++) v.push(data[idx[j] * 4 + ch]);
      v.sort((a, b) => a - b);
      out[k * 3 + ch] = v[v.length >> 1];
    }
  }
  return out;
}

/** Per-pixel background estimate: a Coons patch through the four (smoothed) borders. Returns Float32Array RGB. */
export function backgroundModel({ data, w, h }) {
  const top = edgeColours(data, [...Array(w)].map((_, x) => x));
  const bot = edgeColours(data, [...Array(w)].map((_, x) => (h - 1) * w + x));
  const left = edgeColours(data, [...Array(h)].map((_, y) => y * w));
  const right = edgeColours(data, [...Array(h)].map((_, y) => y * w + w - 1));
  const bg = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0;
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0;
      for (let ch = 0; ch < 3; ch++) {
        const c00 = top[ch], c10 = top[(w - 1) * 3 + ch], c01 = bot[ch], c11 = bot[(w - 1) * 3 + ch];
        bg[(y * w + x) * 3 + ch] = (1 - u) * left[y * 3 + ch] + u * right[y * 3 + ch] + (1 - v) * top[x * 3 + ch] + v * bot[x * 3 + ch]
          - ((1 - u) * (1 - v) * c00 + u * (1 - v) * c10 + (1 - u) * v * c01 + u * v * c11);
      }
    }
  }
  return bg;
}

/** Object = far from a background (one colour, or a per-pixel model), split by Otsu on the colour distance. */
function distanceMask({ data, w, h }, bgAt) {
  const n = w * h, mask = new Uint8Array(n), dist = new Float32Array(n), hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = bgAt(i);
    const d = Math.hypot(data[i * 4] - r, data[i * 4 + 1] - g, data[i * 4 + 2] - b) / 1.732;
    dist[i] = d; hist[Math.min(255, Math.round(d))]++;
  }
  const t = Math.max(otsu(hist), 18); // never treat faint noise as the object
  for (let i = 0; i < n; i++) mask[i] = dist[i] > t ? 1 : 0;
  return mask;
}

/** The candidate masks tried in 'auto' mode, most trusted first. */
export function candidateMasks(pixels) {
  const px = blur3(pixels);
  const bg = backgroundModel(px);
  return [
    ['model', distanceMask(px, (i) => [bg[i * 3], bg[i * 3 + 1], bg[i * 3 + 2]])],
    ['border', objectMask(px, 'border')],
    ['dark', objectMask(px, 'dark')],
    ['light', objectMask(px, 'light')],
  ];
}

/**
 * How much a filled blob looks like "the object": it should not run along the picture's edges (that is background or
 * a crop), should cover a sensible part of the picture, and should be fairly solid. Higher is better.
 */
export function blobScore(blob, w, h) {
  let area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (blob[y * w + x]) {
    area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!area) return -Infinity;
  let edge = 0;
  for (let x = 0; x < w; x++) edge += blob[x] + blob[(h - 1) * w + x];
  for (let y = 1; y < h - 1; y++) edge += blob[y * w] + blob[y * w + w - 1];
  const touch = edge / (2 * (w + h) - 4);
  const frac = area / (w * h), solid = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
  return 0.6 * solid - 3 * touch - (frac < 0.01 ? 2 : 0) - (frac > 0.9 ? 2 : 0) - (frac > 0.75 ? 0.5 : 0);
}

/** Boolean mask (Uint8Array, 1 = object) from RGBA pixels. mode 'border' = one background colour from the border. */
export function objectMask({ data, w, h }, mode = 'auto') {
  const n = w * h, mask = new Uint8Array(n);
  const alpha = (i) => data[i * 4 + 3];
  const hasAlpha = (() => { for (let i = 0; i < n; i += 7) if (alpha(i) < 250) return true; return false; })();
  if ((mode === 'auto' || mode === 'border') && hasAlpha) { // a cut-out: the picture already says what the object is
    for (let i = 0; i < n; i++) mask[i] = alpha(i) > 127 ? 1 : 0;
    return mask;
  }
  if (mode === 'dark' || mode === 'light') {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < n; i++) hist[Math.round(lum(data, i * 4))]++;
    const t = otsu(hist);
    for (let i = 0; i < n; i++) { const l = lum(data, i * 4); mask[i] = (mode === 'dark' ? l <= t : l > t) ? 1 : 0; }
    return mask;
  }
  // one background colour = median of the border pixels; object = far from it (Otsu on the colour distance)
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const med = (ch) => { const v = border.map((i) => data[i * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const bg = [med(0), med(1), med(2)];
  return distanceMask({ data, w, h }, () => bg);
}

function dilate(m, w, h) {
  const o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let dy = -1; dy <= 1 && !v; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && m[yy * w + xx]) { v = 1; break; }
    }
    o[y * w + x] = v;
  }
  return o;
}
const erode = (m, w, h) => { const inv = m.map((v) => 1 - v); return dilate(inv, w, h).map((v) => 1 - v); };

/** Connected components (8-neighbour). Returns { label: Int32Array, sizes: [] } with labels starting at 1. */
export function components(mask, w, h) {
  const label = new Int32Array(mask.length), sizes = [0];
  const stack = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(s); label[s] = id;
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = id; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = id; stack.push(i + w); }
      // diagonal neighbours too: a thin fin or wing joined to the body at a corner is still part of it
      for (const j of [i - w - 1, i - w + 1, i + w - 1, i + w + 1]) {
        const jx = j % w;
        if (j >= 0 && j < mask.length && Math.abs(jx - x) === 1 && mask[j] && !label[j]) { label[j] = id; stack.push(j); }
      }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Mask of only the largest blob, with its holes filled (the outline is the outer boundary). */
export function largestFilled(mask, w, h) {
  // close small gaps, then drop specks
  // close gaps: a fin or a wing is often separated from the body by a thin line the mask misses, and must stay part of the object
  const r = Math.max(1, Math.round(Math.max(w, h) / 130));
  let m = mask;
  for (let i = 0; i < r; i++) m = dilate(m, w, h);
  for (let i = 0; i < r; i++) m = erode(m, w, h);
  const { label, sizes } = components(m, w, h);
  if (sizes.length < 2) return null;
  let best = 1;
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const blob = new Uint8Array(m.length);
  for (let i = 0; i < blob.length; i++) blob[i] = label[i] === best ? 1 : 0;
  // fill holes: whatever background cannot be reached from the border is inside
  const outside = new Uint8Array(blob.length), stack = [];
  const push = (i) => { if (!blob[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < blob.length; i++) blob[i] = outside[i] ? 0 : 1;
  return blob;
}

/**
 * The same for a drawing or a cropped picture. Line art is outline strokes on white: the figure's inside is as white as the
 * paper, and when the drawing runs off the bottom or a side of the picture, the inside meets the picture's edge too, so
 * "background = whatever touches the border" would flood into it. Here the background is only what touches a CORNER; a
 * white region that meets the edge between two strokes is the inside of the figure. Gaps in the strokes are first closed
 * by growing them a little (and shrunk back afterwards).
 */
export function largestFilledCorners(mask, w, h) {
  const r = Math.max(1, Math.round(Math.max(w, h) / 160));
  let m = mask;
  for (let i = 0; i < r; i++) m = dilate(m, w, h);
  const { label, sizes } = components(m, w, h);
  if (sizes.length < 2) return null;
  let best = 1;
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const blob = new Uint8Array(m.length);
  for (let i = 0; i < blob.length; i++) blob[i] = label[i] === best ? 1 : 0;
  const outside = new Uint8Array(blob.length), stack = [];
  for (const i of [0, w - 1, (h - 1) * w, h * w - 1]) if (!blob[i] && !outside[i]) { outside[i] = 1; stack.push(i); }
  if (!stack.length) return null; // every corner is on the object: nothing can be told apart
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    const go = (j) => { if (!blob[j] && !outside[j]) { outside[j] = 1; stack.push(j); } };
    if (x > 0) go(i - 1); if (x < w - 1) go(i + 1); if (y > 0) go(i - w); if (y < h - 1) go(i + w);
  }
  let filled = new Uint8Array(blob.length);
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1;
  for (let i = 0; i < r; i++) filled = erode(filled, w, h);
  filled = dilate(erode(filled, w, h), w, h); // a light opening: loose specks go, but a thin fin or a wing must survive
  const c = components(filled, w, h);
  if (c.sizes.length < 2) return null;
  let top = 1;
  for (let i = 2; i < c.sizes.length; i++) if (c.sizes[i] > c.sizes[top]) top = i;
  for (let i = 0; i < filled.length; i++) filled[i] = c.label[i] === top ? 1 : 0;
  return filled;
}

/** Outer boundary of a single blob as pixel-corner coordinates, walking clockwise (image y points down). */
export function boundary(blob, w, h) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? blob[y * w + x] : 0);
  let sx = -1, sy = -1;
  outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (at(x, y)) { sx = x; sy = y; break outer; }
  if (sx < 0) return [];
  // walk along pixel edges keeping the object on the right-hand side
  const pts = [];
  let x = sx, y = sy, dir = 0; // start on the top edge of the first pixel, heading right: dirs 0=right 1=down 2=left 3=up
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const sxE = x, syE = y;
  let guard = 0;
  do {
    pts.push([x, y]);
    // the two pixels ahead of the current edge, relative to the heading
    const ahead = [[0, 0], [-1, 0], [-1, -1], [0, -1]][dir]; // pixel ahead-right (object side)
    const left = [[0, -1], [0, 0], [-1, 0], [-1, -1]][dir]; // pixel ahead-left
    const ar = at(x + ahead[0], y + ahead[1]), al = at(x + left[0], y + left[1]);
    if (al) dir = (dir + 3) % 4; // turn left
    else if (!ar) dir = (dir + 1) % 4; // turn right
    x += DX[dir]; y += DY[dir];
  } while ((x !== sxE || y !== syE) && ++guard < w * h * 4 + 16);
  return pts;
}

/** Douglas-Peucker simplification of a closed polygon. */
export function simplify(pts, eps) {
  if (pts.length < 4) return pts.slice();
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
  };
  const rec = (lo, hi, keep) => {
    let m = -1, md = eps * eps;
    for (let i = lo + 1; i < hi; i++) { const d = d2(pts[i], pts[lo], pts[hi]); if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m] = 1; rec(lo, m, keep); rec(m, hi, keep); }
  };
  // split the loop at the two points farthest apart so neither half is degenerate
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i += Math.max(1, (pts.length / 60) | 0)) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) { best = d; b = i; }
  }
  const keep = new Uint8Array(pts.length);
  keep[a] = keep[b] = 1;
  rec(a, b, keep);
  const wrap = pts.slice(b).concat(pts.slice(0, a + 1)); // second half, wrapping around
  const keep2 = new Uint8Array(wrap.length);
  keep2[0] = keep2[wrap.length - 1] = 1;
  const saved = pts; pts = wrap; rec(0, wrap.length - 1, keep2); pts = saved;
  const out = [];
  for (let i = 0; i <= b; i++) if (keep[i]) out.push(pts[i]);
  for (let i = 1; i < wrap.length - 1; i++) if (keep2[i]) out.push(wrap[i]);
  return out;
}

/**
 * Silhouette of the main object. pixels = { data (RGBA), w, h }.
 * Returns { ok: true, pts: [[nx, ny]...] closed (first point repeated), area } in 0..1 picture coordinates
 * (y down), or { ok: false, reason }.
 */
export function traceSilhouette(pixels, { mode = 'auto', detail = 0.0025 } = {}) {
  const { w, h } = pixels;
  const fracOf = (m) => m.reduce((a, b) => a + b, 0) / m.length;
  let blob = null, method = mode;
  if (mode === 'auto' && !hasTransparency(pixels)) { // (a transparent cut-out already says what the object is)
    let best = -Infinity, any = false;
    for (const [name, m] of candidateMasks(pixels)) {
      const f = fracOf(m);
      if (f < 0.003 || f > 0.97) continue;
      any = true;
      let plain = null;
      for (const [how, fill] of [['', largestFilled], ['+corners', largestFilledCorners]]) {
        if (how && f >= 0.12) continue; // only a drawing (thin strokes, little ink) can need the corner fill; skip its cost for a photo
        const bl = fill(m, w, h);
        if (!bl) continue;
        const area = bl.reduce((x, y) => x + y, 0);
        let sc = blobScore(bl, w, h) + (name === 'model' ? 0.15 : 0) - (how ? 0.05 : 0); // a small preference for the most general model, and for the plain fill
        if (!how) plain = area;
        // A drawing: thin strokes (little ink) that, with the inside of the figure filled in from the corners, cover far more than the
        // strokes' own closed loops do. The figure may run off the picture, which the plain score punishes, so it gets a bonus instead.
        else if (plain !== null && f < 0.12 && area > 1.6 * plain) sc += 0.6;
        if (sc > best) { best = sc; blob = bl; method = name + how; }
      }
    }
    if (!any) return { ok: false, reason: 'No object stood out from the background. Try the Dark or Light setting, or a plainer background.' };
  } else {
    const mask = objectMask(pixels, mode);
    const frac = fracOf(mask);
    if (frac < 0.003) return { ok: false, reason: 'No object stood out from the background. Try the Dark or Light setting.' };
    if (frac > 0.97) return { ok: false, reason: 'The whole picture looks like one object. Try the Dark or Light setting.' };
    blob = largestFilled(mask, w, h);
  }
  if (!blob) return { ok: false, reason: 'No object found in the picture.' };
  const ring = boundary(blob, w, h);
  if (ring.length < 8) return { ok: false, reason: 'The object is too small to outline.' };
  const scale = Math.max(w, h);
  let poly = simplify(ring, Math.min(Math.max(detail * scale, 1.1), 5)); // pixels: fine enough for a small picture, not jittery on a big one
  if (poly.length < 4) poly = ring;
  const pts = poly.map(([x, y]) => [x / w, y / h]);
  pts.push(pts[0].slice());
  const area = blob.reduce((a, b) => a + b, 0) / blob.length;
  return { ok: true, pts, area, method };
}

function hasTransparency({ data, w, h }) {
  for (let i = 0; i < w * h; i += 7) if (data[i * 4 + 3] < 250) return true;
  return false;
}
