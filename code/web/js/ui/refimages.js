// Reference images for the 3-plane workspace: a photo or drawing placed behind a view to trace its outline.
// The image is a DOM <img> under the transparent WebGL canvas, clipped to its cell, so strokes draw on top of it.
// State and the adjust maths are pure (see adjustImage) so they are unit-tested; the rest is plumbing.

export const IMAGE_VIEWS = ['front', 'side', 'top'];
export const MIN_SIZE = 0.2, MAX_SIZE = 6; // world units across
const STEP = { size: 1.1, move: 0.05, fade: 0.1 };

/** Largest size (world units across) that fits the workspace square (2 x 2) with the picture's proportions. */
export function fitWidth(aspect) { return aspect >= 1 ? 2 : 2 * aspect; }

export const newImage = (aspect) => ({ cx: 0, cy: 0, w: fitWidth(aspect), aspect, opacity: 0.6, flip: false });

/** op: 'bigger' | 'smaller' | 'left' | 'right' | 'up' | 'down' | 'fadeIn' | 'fadeOut' | 'flip' */
export function adjustImage(im, op) {
  const o = { ...im };
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  if (op === 'bigger') o.w = clamp(im.w * STEP.size, MIN_SIZE, MAX_SIZE);
  else if (op === 'smaller') o.w = clamp(im.w / STEP.size, MIN_SIZE, MAX_SIZE);
  else if (op === 'left') o.cx = im.cx - STEP.move;
  else if (op === 'right') o.cx = im.cx + STEP.move;
  else if (op === 'up') o.cy = im.cy + STEP.move;
  else if (op === 'down') o.cy = im.cy - STEP.move;
  else if (op === 'fadeIn') o.opacity = clamp(Math.round((im.opacity + STEP.fade) * 100) / 100, 0.1, 1);
  else if (op === 'fadeOut') o.opacity = clamp(Math.round((im.opacity - STEP.fade) * 100) / 100, 0.1, 1);
  else if (op === 'flip') o.flip = !im.flip;
  else if (op === 'fade') o.opacity = FADES.find((f) => f > im.opacity + 0.01) ?? FADES[0]; // cycle
  return o;
}

const FADES = [0.25, 0.45, 0.7, 1];

/** Slide the picture by (du, dv) world units, or resize it by `factor`, keeping it within sensible limits. */
export function moveImage(im, du, dv) {
  const lim = (v) => Math.min(Math.max(v, -3), 3);
  return { ...im, cx: lim(im.cx + du), cy: lim(im.cy + dv) };
}
export function scaleImage(im, factor) { return { ...im, w: Math.min(Math.max(im.w * factor, MIN_SIZE), MAX_SIZE) }; }

/**
 * Turn a traced silhouette (picture coordinates 0..1, y down) into world points on a view's plane, following where the
 * picture currently sits (centre, width, mirror). axes = { right, up } of that view.
 */
export function outlineFromTrace(pts, im, axes) {
  const h = im.w / im.aspect;
  return pts.map(([nx, ny]) => {
    const u = im.cx + (im.flip ? 0.5 - nx : nx - 0.5) * im.w;
    const v = im.cy - (ny - 0.5) * h;
    return [0, 1, 2].map((k) => axes.right[k] * u + axes.up[k] * v);
  });
}

// Words in a photo's file name that say which view it shows.
const VIEW_WORDS = {
  front: ['front', 'elevation', 'face'],
  side: ['side', 'left', 'right', 'profile', 'lateral'],
  top: ['top', 'plan', 'above', 'overhead', 'birdseye'],
};

/**
 * Decide which view each of several photos goes on: by its file name (mug_side.jpg -> side), otherwise into the empty
 * views in the order Front, Side, Top. taken = views that already have a photo. Returns [[view, fileIndex], ...] (at
 * most three). When every view is taken, the first photo replaces the Front.
 */
export function assignViews(names, taken = []) {
  const free = IMAGE_VIEWS.filter((v) => !taken.includes(v));
  if (!free.length) return names.length ? [['front', 0]] : [];
  const out = [], used = new Set(), done = new Set();
  const words = (n) => n.toLowerCase().replace(/\.[a-z0-9]+$/, '').split(/[^a-z]+/);
  names.forEach((n, i) => {
    const w = words(n);
    const v = free.find((view) => !used.has(view) && VIEW_WORDS[view].some((k) => w.includes(k)));
    if (v) { out.push([v, i]); used.add(v); done.add(i); }
  });
  names.forEach((n, i) => {
    if (done.has(i)) return;
    const v = free.find((view) => !used.has(view));
    if (v) { out.push([v, i]); used.add(v); }
  });
  return out.sort((a, b) => a[1] - b[1]);
}

export class RefImages {
  constructor(layout) {
    this.layout = layout;
    this.state = {}; // view -> image state
    this.els = {};
    this.visible = false;
    const gl = document.getElementById('gl');
    for (const v of IMAGE_VIEWS) {
      const wrap = document.createElement('div');
      wrap.className = `refimage ${v}`;
      wrap.hidden = true;
      const img = document.createElement('img');
      img.alt = `${v} reference`;
      img.draggable = false;
      wrap.append(img);
      gl.before(wrap);
      this.els[v] = { wrap, img };
    }
  }

  has(view) { return !!this.state[view]; }
  get any() { return Object.keys(this.state).length > 0; }

  /** Load an image File into a view. Resolves to the view's image state. */
  load(view, file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const e = this.els[view];
        if (e.img.dataset.url) URL.revokeObjectURL(e.img.dataset.url);
        e.img.src = url; e.img.dataset.url = url;
        this.state[view] = newImage(probe.naturalWidth / probe.naturalHeight);
        this.refresh();
        resolve(this.state[view]);
      };
      probe.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
      probe.src = url;
    });
  }

  /** RGBA pixels of a view's image, scaled down so the longest side is `max` (for silhouette detection). */
  pixels(view, max = 400) { // the outline is traced on this copy, so its size sets how fine the outline can be
    const img = this.els[view].img, im = this.state[view];
    if (!im) return null;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    return { data: g.getImageData(0, 0, w, h).data, w, h };
  }

  /** Replace a view's image state (from moveImage / scaleImage). */
  setState(view, im) { if (this.state[view]) { this.state[view] = im; this.refresh(); } }

  adjust(view, op) {
    if (!this.state[view]) return;
    this.state[view] = adjustImage(this.state[view], op);
    this.refresh();
  }

  remove(view) {
    const e = this.els[view];
    if (e.img.dataset.url) URL.revokeObjectURL(e.img.dataset.url);
    e.img.removeAttribute('src'); delete e.img.dataset.url;
    delete this.state[view];
    this.refresh();
  }

  show(on) { this.visible = on; this.refresh(); }

  /** Reposition every image to match the layout (call after layout or adjustment changes). */
  refresh() {
    for (const v of IMAGE_VIEWS) {
      const { wrap, img } = this.els[v];
      const im = this.state[v], cell = this.layout.cells && this.layout.cells[v];
      wrap.hidden = !(this.visible && im && cell && cell.w > 0);
      if (wrap.hidden) continue;
      Object.assign(wrap.style, { left: `${cell.x}px`, top: `${cell.y}px`, width: `${cell.w}px`, height: `${cell.h}px` });
      const k = this.layout.scale, w = im.w * k, h = w / im.aspect;
      const c = this.layout.centre(v);
      Object.assign(img.style, {
        width: `${w}px`, height: `${h}px`, opacity: im.opacity,
        left: `${c.x + im.cx * k - w / 2 - cell.x}px`, top: `${c.y - im.cy * k - h / 2 - cell.y}px`,
        transform: im.flip ? 'scaleX(-1)' : 'none',
      });
    }
  }
}
