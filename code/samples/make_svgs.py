"""Draw the SVG sources of the demo photo sets: samples/svg/<set>/<view>.svg.

    python samples/make_svgs.py        # then:  python samples/svg_to_png.py

Each object is described once, in world units, and projected into the app's three views, so the pictures agree with each other
(same scale, same alignment, 250 px per world unit on a 720 x 540 picture). The views follow the app's cells:
  front  looks along -Z   picture right = +X   picture up = +Y
  side   looks along -X   picture right = -Z   (a feature on the +Z side appears on the LEFT)
  top    looks along -Y   picture right = +X   picture up = -Z
Rules for a good set: no see-through holes (the outline fills holes), nothing hidden that the shape needs, plain background.
"""
import math
import os

W, H, S = 720, 540, 250.0
HERE = os.path.dirname(os.path.abspath(__file__))


def mix(c, t, to):
    c = [int(c[i:i + 2], 16) for i in (1, 3, 5)]
    return '#%02x%02x%02x' % tuple(round(a + (to - a) * t) for a in c)


class Svg:
    def __init__(self):
        self.defs, self.body, self.n = [], [], 0
        self.cache = {}

    def paint(self, color, horizontal=False):
        key = (color, horizontal)
        if key not in self.cache:
            self.n += 1
            i = f'g{self.n}'
            x2, y2 = ('1', '0') if horizontal else ('0', '1')
            self.defs.append(f'<linearGradient id="{i}" x1="0" y1="0" x2="{x2}" y2="{y2}">'
                             f'<stop offset="0" stop-color="{mix(color, 0.38, 255)}"/><stop offset=".55" stop-color="{color}"/>'
                             f'<stop offset="1" stop-color="{mix(color, 0.28, 0)}"/></linearGradient>')
            self.cache[key] = f'url(#{i})'
        return self.cache[key]

    @staticmethod
    def xy(p):
        return 360 + p[0] * S, 270 - p[1] * S

    def poly(self, pts, color, horizontal=False, stroke=True):
        d = ' '.join('%.1f,%.1f' % self.xy(p) for p in pts)
        edge = f' stroke="{mix(color, 0.45, 0)}" stroke-width="1.2" stroke-linejoin="round"' if stroke else ''
        self.body.append(f'<polygon points="{d}" fill="{self.paint(color, horizontal)}"{edge}/>')

    def rect(self, u0, u1, v0, v1, color, horizontal=False, stroke=True):
        self.poly([(u0, v0), (u1, v0), (u1, v1), (u0, v1)], color, horizontal, stroke)

    def circle(self, u, v, r, color, stroke=True):
        cx, cy = self.xy((u, v))
        edge = f' stroke="{mix(color, 0.45, 0)}" stroke-width="1.2"' if stroke else ''
        self.body.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * S:.1f}" fill="{self.paint(color)}"{edge}/>')

    def ellipse(self, u, v, ru, rv, color):
        cx, cy = self.xy((u, v))
        self.body.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{ru * S:.1f}" ry="{rv * S:.1f}" fill="{self.paint(color)}" stroke="{mix(color, 0.45, 0)}" stroke-width="1.2"/>')

    def text(self, s):
        self.body.append(s)

    def save(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
               f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f3f0"/><stop offset="1" stop-color="#e7e6e2"/></linearGradient>'
               + ''.join(self.defs) + '</defs>'
               '<rect width="100%" height="100%" fill="url(#bg)"/>' + ''.join(self.body) + '</svg>')
        open(path, 'w', encoding='utf-8').write(svg)


# world -> picture coordinates (u right, v up) for each view
F = lambda x, y: (x, y)        # front: (x, y)
Sd = lambda z, y: (-z, y)      # side:  (z, y), +Z on the left
T = lambda x, z: (x, -z)       # top:   (x, z), +Z down


def mirrored(pts):
    return [(-a, b) for a, b in pts]


def sym(svg, pts, color, h=False):
    svg.poly(pts, color, h)
    svg.poly(mirrored(pts), color, h)


# ------------------------------------------------------------------------------------------------------ airplane
def airplane():
    body, wing, red, glass = '#b4c3d3', '#6f879f', '#c0392b', '#5aa0d0'
    fus = [(-0.9, 0.05), (-0.6, 0.12), (0.4, 0.12), (0.65, 0.09), (0.92, 0.0), (0.65, -0.09), (0.4, -0.12), (-0.6, -0.12), (-0.9, -0.05)]
    f, s, t = Svg(), Svg(), Svg()
    # front: the fuselage is a disc, the wings and tail planes are thin bands, the fin a thin blade
    f.rect(-0.85, 0.85, -0.03, 0.02, wing)
    f.rect(-0.35, 0.35, 0.02, 0.05, wing)
    f.rect(-0.016, 0.016, 0.1, 0.38, red)
    f.circle(0, 0, 0.12, body)
    f.ellipse(0, 0.12, 0.07, 0.06, glass)
    f.circle(0, 0, 0.035, red)
    # side
    s.rect(-0.25, 0.3, -0.03, 0.02, wing)
    s.rect(0.7, 0.93, 0.02, 0.05, wing)
    s.poly([Sd(*p) for p in [(-0.55, 0.1), (-0.9, 0.38), (-0.96, 0.38), (-0.93, 0.1)]], red)
    s.poly([Sd(*p) for p in fus], body)
    s.ellipse(*Sd(0.25, 0.12), 0.14, 0.06, glass)
    s.rect(0.89, 0.926, -0.05, 0.05, red)                     # a red tail cap (the tail is at -Z, so on the right)
    # top: the whole planform
    nose = [T(*p) for p in [(-0.05, -0.9), (0.05, -0.9), (0.12, -0.6), (0.12, 0.45), (0.07, 0.75), (0, 0.92), (-0.07, 0.75), (-0.12, 0.45), (-0.12, -0.6)]]
    wing_r = [T(*p) for p in [(0.12, 0.25), (0.85, -0.15), (0.85, -0.3), (0.12, -0.2)]]
    stab_r = [T(*p) for p in [(0.05, -0.72), (0.35, -0.88), (0.35, -0.93), (0.05, -0.9)]]
    sym(t, wing_r, wing)
    sym(t, stab_r, wing)
    t.rect(-0.016, 0.016, 0.55, 0.96, red)                    # the fin, from above
    t.poly(nose, body)
    t.ellipse(0, -0.25, 0.07, 0.14, glass)
    return {'front': f, 'side': s, 'top': t}


# --------------------------------------------------------------------------------------------------------- castle
def castle():
    stone, dark, red, ground, wood, win = '#cfc5ad', '#b7ab92', '#b5382c', '#8fae7e', '#6b4a2f', '#41546b'
    f, s, t = Svg(), Svg(), Svg()
    for v in (f, s):  # the castle is the same seen from the front and from the side
        v.rect(-0.8, 0.8, -0.7, -0.6, ground)
        v.rect(-0.55, 0.55, -0.6, -0.05, stone)
        for sx in (-1, 1):
            v.rect(*sorted((sx * 0.41, sx * 0.69)), -0.6, 0.25, dark, horizontal=True)
            v.poly([(sx * 0.37, 0.25), (sx * 0.73, 0.25), (sx * 0.55, 0.58)], red)
            v.rect(sx * 0.55 - 0.03, sx * 0.55 + 0.03, 0.0, 0.14, win)
        v.rect(-0.25, 0.25, -0.05, 0.4, stone, horizontal=True)
        v.poly([(-0.3, 0.4), (0.3, 0.4), (0, 0.74)], red)
        v.rect(-0.012, 0.012, 0.74, 0.92, '#5a5a5a')
        for x in (-0.12, 0.12):
            v.rect(x - 0.035, x + 0.035, 0.12, 0.26, win)
    f.rect(-0.1, 0.1, -0.6, -0.34, wood)                 # the gate
    f.rect(0.012, 0.15, 0.78, 0.9, red)                  # the flag lies in the front plane: a blade from the side
    t.rect(-0.8, 0.8, -0.8, 0.8, ground)
    t.rect(-0.55, 0.55, -0.55, 0.55, stone)
    for sx in (-1, 1):
        for sz in (-1, 1):
            t.rect(*sorted((sx * 0.37, sx * 0.73)), *sorted((sz * 0.37, sz * 0.73)), red)
    t.rect(-0.3, 0.3, -0.3, 0.3, red)
    t.rect(-0.012, 0.15, -0.012, 0.012, red)             # the flag, from above
    return {'front': f, 'side': s, 'top': t}


# --------------------------------------------------------------------------------------------------------- robot
def robot():
    steel, light, dark, orange, eye = '#8fa3b8', '#b9c6d3', '#4a5568', '#e07a2f', '#ffd24a'
    f, s, t = Svg(), Svg(), Svg()
    # feet, legs
    for sx in (-1, 1):
        f.rect(*sorted((sx * 0.04, sx * 0.24)), -0.8, -0.7, dark)
        f.rect(*sorted((sx * 0.06, sx * 0.2)), -0.7, -0.2, steel, horizontal=True)
    s.rect(-0.22, 0.12, -0.8, -0.7, dark)
    s.rect(-0.1, 0.1, -0.7, -0.2, steel, horizontal=True)
    for sx in (-1, 1):
        t.rect(*sorted((sx * 0.04, sx * 0.24)), -0.22, 0.12, dark)
    # torso, arms
    f.rect(-0.3, 0.3, -0.2, 0.4, steel, horizontal=True)
    f.circle(0, 0.12, 0.07, orange)
    f.rect(-0.16, 0.16, -0.12, -0.04, dark)
    s.rect(-0.2, 0.2, -0.2, 0.4, steel, horizontal=True)
    t.rect(-0.3, 0.3, -0.2, 0.2, steel)
    for sx in (-1, 1):
        f.rect(*sorted((sx * 0.3, sx * 0.42)), -0.12, 0.34, light, horizontal=True)
        f.rect(*sorted((sx * 0.3, sx * 0.44)), -0.12, -0.02, orange)
        t.rect(*sorted((sx * 0.3, sx * 0.42)), -0.08, 0.08, light)
    s.rect(-0.08, 0.08, -0.12, 0.34, light, horizontal=True)
    s.rect(-0.08, 0.08, -0.12, -0.02, orange)
    # neck, head, antenna
    f.rect(-0.06, 0.06, 0.4, 0.46, dark)
    s.rect(-0.06, 0.06, 0.4, 0.46, dark)
    f.rect(-0.2, 0.2, 0.46, 0.8, light, horizontal=True)
    s.rect(-0.2, 0.2, 0.46, 0.8, light, horizontal=True)
    t.rect(-0.2, 0.2, -0.2, 0.2, light)
    for sx in (-1, 1):
        f.circle(sx * 0.08, 0.65, 0.045, eye)
    f.rect(-0.09, 0.09, 0.52, 0.56, dark)
    s.circle(-0.12, 0.65, 0.045, eye)
    f.rect(-0.012, 0.012, 0.8, 0.95, dark)
    s.rect(-0.012, 0.012, 0.8, 0.95, dark)
    for v, pos in ((f, (0, 0.97)), (s, (0, 0.97)), (t, (0, 0))):
        v.circle(*pos, 0.04, orange)
    return {'front': f, 'side': s, 'top': t}


# ----------------------------------------------------------------------------------------------------------- car
def car():
    paint, roof, glass, tyre, hub, lamp = '#d8453a', '#c23a30', '#7fb4d6', '#2b2d33', '#b9bec7', '#ffe08a'
    f, s, t = Svg(), Svg(), Svg()
    # front: body, cabin, the wheels' outer faces
    for sx in (-1, 1):
        f.rect(*sorted((sx * 0.3, sx * 0.4)), -0.42, -0.08, tyre)
    f.rect(-0.32, 0.32, -0.25, 0.02, paint, horizontal=True)
    f.rect(-0.27, 0.27, 0.02, 0.3, roof, horizontal=True)
    f.rect(-0.2, 0.2, 0.06, 0.24, glass)
    for sx in (-1, 1):
        f.circle(sx * 0.23, -0.12, 0.04, lamp)
    # side: body, cabin with a sloping windscreen, round wheels (+Z, the front of the car, is on the left)
    s.rect(-0.7, 0.7, -0.25, 0.02, paint)
    s.poly([(0.4, 0.02), (-0.32, 0.02), (-0.2, 0.3), (0.28, 0.3)], roof)
    s.poly([(0.33, 0.06), (-0.26, 0.06), (-0.16, 0.26), (0.24, 0.26)], glass)
    s.rect(0.64, 0.7, -0.16, -0.08, lamp)
    for u in (-0.45, 0.45):
        s.circle(u, -0.25, 0.17, tyre)
        s.circle(u, -0.25, 0.08, hub)
    # top
    for sx in (-1, 1):
        for z in (-0.45, 0.45):
            t.rect(*sorted((sx * 0.3, sx * 0.4)), -(z + 0.17), -(z - 0.17), tyre)
    t.rect(-0.32, 0.32, -0.7, 0.7, paint, horizontal=True)
    t.rect(-0.27, 0.27, -0.32, 0.4, roof, horizontal=True)
    t.rect(-0.2, 0.2, -0.26, 0.3, glass)
    return {'front': f, 'side': s, 'top': t}


# ---------------------------------------------------------------------------------------------------------- pawn
def pawn():
    ivory = '#e9dcc0'
    f = Svg()
    # the right half of the profile, from the base up to the collar; the head is a ball on top
    half = [(r, y) for y, r in [(-0.8, 0.40), (-0.72, 0.40), (-0.66, 0.36), (-0.58, 0.26), (-0.45, 0.17), (-0.2, 0.12), (0.0, 0.1), (0.08, 0.13), (0.1, 0.24), (0.15, 0.27), (0.2, 0.2), (0.2, 0.14)]]
    full = half + [(-x, y) for x, y in reversed(half)]
    f.poly(full, ivory, horizontal=True)
    f.circle(0, 0.38, 0.2, ivory)
    # a little shine on the head
    f.ellipse(-0.07, 0.45, 0.05, 0.035, '#fff7e6')
    return {'front': f}


SETS = {'airplane': airplane, 'castle': castle, 'robot': robot, 'car': car, 'pawn': pawn}

if __name__ == '__main__':
    for name, make in SETS.items():
        for view, svg in make().items():
            svg.save(os.path.join(HERE, 'svg', name, f'{view}.svg'))
            print('wrote svg/%s/%s.svg' % (name, view))
