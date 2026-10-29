"""Make the demo photo sets in samples/: front, side and top pictures of a few objects, rendered the way a camera at
infinity would see them, on a plain background, all at the same scale.

    python samples/make_samples.py            # writes samples/rocket, samples/house, samples/vase

Why these objects: a photo set only gives a good 3D result when the three views describe the shape and nothing in a view is
hidden or see-through. The rocket needs all three views (its four fins only separate in the top view), the house shows the
chimney's exact place, the vase is round so one photo is enough (One view: Round). Needs numpy and Pillow (not part of the
app, only of this script).

View conventions (the same as the app's three cells): front looks along -Z with +X to the right; side looks along -X with
-Z to the right (so a feature on the +Z side, like the house door, appears on the LEFT of the side picture); top looks
along -Y with +X to the right and +Z down.
"""
import os
import sys

import numpy as np
from PIL import Image

W, H, S = 720, 540, 250.0  # picture size, and pixels per world unit (the same in every view)
HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------------------------- distance functions
def length(*c):
    return np.sqrt(sum(x * x for x in c))


def box(x, y, z, cx, cy, cz, hx, hy, hz, r=0.0):
    qx, qy, qz = np.abs(x - cx) - hx + r, np.abs(y - cy) - hy + r, np.abs(z - cz) - hz + r
    return length(np.maximum(qx, 0), np.maximum(qy, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(np.maximum(qx, qy), qz), 0) - r


def revolve(x, y, z, profile, y0, y1):
    """A solid of revolution about the Y axis; profile = [(y, radius), ...] with y increasing."""
    ys, rs = zip(*profile)
    r = np.interp(y, ys, rs)
    d = (length(x, z) - r) * 0.85
    return np.maximum(d, np.maximum(y0 - y, y - y1))


def poly2(px, py, pts):
    """Exact signed distance (negative inside) from points to a 2D polygon."""
    n = len(pts)
    d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2
    s = np.ones_like(px)
    for i in range(n):
        a, b = np.array(pts[i]), np.array(pts[(i + 1) % n])
        e, w = b - a, np.stack([px - a[0], py - a[1]])
        t = np.clip((w[0] * e[0] + w[1] * e[1]) / (e @ e), 0, 1)
        d = np.minimum(d, (w[0] - e[0] * t) ** 2 + (w[1] - e[1] * t) ** 2)
        c1, c2, c3 = py >= a[1], py < b[1], e[0] * w[1] > e[1] * w[0]
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def prism(px, py, pz, pts, half):
    """A 2D polygon in (px, py) extruded +-half along pz."""
    d = poly2(px, py, pts)
    wx, wy = d, np.abs(pz) - half
    return np.minimum(np.maximum(wx, wy), 0) + length(np.maximum(wx, 0), np.maximum(wy, 0))


# ------------------------------------------------------------------------------------------------------- objects
# each scene(x, y, z) returns (distance, material id); colour(id, p, n) returns RGB in 0..1
def rocket_scene(x, y, z):
    body = revolve(x, y, z, [(-0.75, 0.15), (-0.6, 0.17), (-0.55, 0.27), (0.35, 0.27), (0.55, 0.2), (0.75, 0.11), (0.95, 0.0)], -0.75, 0.95)
    fin = [(0.22, -0.02), (0.62, -0.55), (0.62, -0.78), (0.22, -0.62)]
    fx = prism(np.abs(x), y, z, fin, 0.035)
    fz = prism(np.abs(z), y, x, fin, 0.035)
    fins = np.minimum(fx, fz)
    d = np.minimum(body, fins)
    mid = np.where(fins < body, 2, np.where(y > 0.35, 1, 0))
    return d, mid


def rocket_colour(mid, p, n):
    white, red, grey = np.array([0.94, 0.94, 0.92]), np.array([0.82, 0.16, 0.14]), np.array([0.35, 0.36, 0.4])
    c = np.where((mid == 0)[:, None], white, red)
    band = (mid == 0) & (np.abs(p[:, 1] + 0.42) < 0.05)
    c = np.where(band[:, None], red, c)
    c = np.where(((mid == 0) & (p[:, 1] < -0.6))[:, None], grey, c)
    port = (mid == 0) & (p[:, 2] > 0) & (np.hypot(p[:, 0], p[:, 1] - 0.12) < 0.1) & (n[:, 2] > 0.5)
    ring = (mid == 0) & (p[:, 2] > 0) & (np.hypot(p[:, 0], p[:, 1] - 0.12) < 0.125) & (n[:, 2] > 0.5)
    c = np.where(ring[:, None], grey, c)
    return np.where(port[:, None], np.array([0.45, 0.7, 0.9]), c)


def house_scene(x, y, z):
    walls = box(x, y, z, 0, -0.3, 0, 0.55, 0.3, 0.42, 0.01)
    roof = prism(x, y, z, [(-0.7, 0.0), (0.7, 0.0), (0.0, 0.55)], 0.52)
    chimney = box(x, y, z, 0.32, 0.42, -0.12, 0.08, 0.2, 0.08)
    door = box(x, y, z, 0.0, -0.46, 0.43, 0.1, 0.17, 0.025)
    base = box(x, y, z, 0, -0.63, 0, 0.66, 0.03, 0.54, 0.01)
    parts = np.stack([walls, roof, chimney, door, base])
    return parts.min(0), parts.argmin(0)


def house_colour(mid, p, n):
    table = np.array([[0.93, 0.86, 0.7], [0.62, 0.24, 0.2], [0.58, 0.3, 0.24], [0.4, 0.26, 0.16], [0.55, 0.57, 0.6]])
    c = table[mid]
    win = (mid == 0) & (
        ((n[:, 2] > 0.5) & (np.abs(np.abs(p[:, 0]) - 0.3) < 0.1) & (np.abs(p[:, 1] + 0.2) < 0.1))
        | ((np.abs(n[:, 0]) > 0.5) & (np.abs(p[:, 2]) < 0.14) & (np.abs(p[:, 1] + 0.22) < 0.1)))
    return np.where(win[:, None], np.array([0.5, 0.72, 0.9]), c)


def smooth(profile, per=24):
    """Round off a profile with a Catmull-Rom spline through its points (a vase is curved, not a stack of cones)."""
    pts = np.array(profile, float)
    ext = np.vstack([2 * pts[0] - pts[1], pts, 2 * pts[-1] - pts[-2]])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for t in np.linspace(0, 1, per, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return [tuple(q) for q in out]


VASE = smooth([(-0.8, 0.2), (-0.72, 0.27), (-0.4, 0.4), (-0.05, 0.46), (0.25, 0.34), (0.5, 0.17), (0.62, 0.15), (0.75, 0.2), (0.8, 0.26)])


def vase_scene(x, y, z):
    return revolve(x, y, z, VASE, -0.8, 0.8), np.zeros_like(y, dtype=int)


def vase_colour(mid, p, n):
    t = np.clip((p[:, 1] + 0.8) / 1.6, 0, 1)[:, None]
    c = np.array([0.1, 0.25, 0.55]) * (1 - t) + np.array([0.3, 0.55, 0.8]) * t
    for yy in (-0.3, 0.05, 0.55):
        c = np.where((np.abs(p[:, 1] - yy) < 0.035)[:, None], np.array([0.95, 0.92, 0.85]), c)
    return c


SETS = {'rocket': (rocket_scene, rocket_colour), 'house': (house_scene, house_colour), 'vase': (vase_scene, vase_colour)}

# ------------------------------------------------------------------------------------------------------ camera
# (origin direction towards the camera, picture right, picture up) in world coordinates
VIEWS = {
    'front': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
    'side': ((1, 0, 0), (0, 0, -1), (0, 1, 0)),
    'top': ((0, 1, 0), (1, 0, 0), (0, 0, -1)),
}
LIGHT = np.array([-0.45, 0.75, 0.5])
LIGHT /= np.linalg.norm(LIGHT)


def render(scene, colour, view):
    toward, right, up = (np.array(v, float) for v in VIEWS[view])
    px, py = np.meshgrid(np.arange(W) + 0.5, np.arange(H) + 0.5)
    u, v = ((px - W / 2) / S).ravel(), (-(py - H / 2) / S).ravel()
    o = toward[None, :] * 2.0 + u[:, None] * right[None, :] + v[:, None] * up[None, :]
    dirn = -toward
    n = len(u)
    t = np.zeros(n)
    hit = np.zeros(n, bool)
    dmin = np.full(n, 9.0)
    active = np.arange(n)
    for _ in range(70):
        if not len(active):
            break
        p = o[active] + t[active, None] * dirn[None, :]
        d, _ = scene(p[:, 0], p[:, 1], p[:, 2])
        dmin[active] = np.minimum(dmin[active], d)
        h = d < 1e-3
        hit[active[h]] = True
        keep = ~h & (t[active] < 4.0)
        t[active] += np.where(keep, d * 0.95, 0)
        active = active[keep]
    ids = np.where(hit)[0]
    img = np.zeros((n, 3))
    bg = np.linspace(0.955, 0.905, H)[:, None] * np.ones((1, W))
    img[:] = bg.ravel()[:, None]
    alpha = np.clip(1.0 - dmin * S, 0, 1) * (~hit)  # soft edge for pixels the ray only grazed
    if len(ids):
        p = o[ids] + t[ids, None] * dirn[None, :]
        e = 1e-3
        grad = np.stack([scene(p[:, 0] + e, p[:, 1], p[:, 2])[0] - scene(p[:, 0] - e, p[:, 1], p[:, 2])[0],
                         scene(p[:, 0], p[:, 1] + e, p[:, 2])[0] - scene(p[:, 0], p[:, 1] - e, p[:, 2])[0],
                         scene(p[:, 0], p[:, 1], p[:, 2] + e)[0] - scene(p[:, 0], p[:, 1], p[:, 2] - e)[0]], 1)
        nrm = grad / (np.linalg.norm(grad, axis=1, keepdims=True) + 1e-9)
        mid = scene(p[:, 0], p[:, 1], p[:, 2])[1]
        base = colour(mid, p, nrm)
        lam = np.clip(nrm @ LIGHT, 0, 1)
        hemi = 0.5 + 0.5 * nrm[:, 1]
        ao = np.ones(len(ids))
        for k, w in ((0.05, 0.5), (0.12, 0.3)):  # darken creases a little
            q = p + nrm * k
            ao -= w * np.clip((k - scene(q[:, 0], q[:, 1], q[:, 2])[0]) / k, 0, 1)
        shade = (0.30 + 0.62 * lam + 0.18 * hemi) * ao
        spec = 0.18 * np.clip(nrm @ (LIGHT + toward) / np.linalg.norm(LIGHT + toward), 0, 1) ** 24
        img[ids] = np.clip(base * shade[:, None] + spec[:, None], 0, 1)
    # a grazed pixel blends the object's colour at the edge into the background
    edge = np.where(alpha > 0)[0]
    if len(edge):
        img[edge] = img[edge] * (1 - alpha[edge, None]) + np.array([0.25, 0.25, 0.27]) * alpha[edge, None]
    out = img.reshape(H, W, 3)
    out = out + np.random.default_rng(7).normal(0, 0.006, out.shape)  # a little sensor noise, like a real photo
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8))


def main(names):
    for name in names:
        scene, colour = SETS[name]
        os.makedirs(os.path.join(HERE, name), exist_ok=True)
        for view in VIEWS:
            path = os.path.join(HERE, name, f'{view}.png')
            render(scene, colour, view).save(path)
            print('wrote', os.path.relpath(path, HERE))


if __name__ == '__main__':
    main(sys.argv[1:] or list(SETS))
