// 2D overlay: hand skeletons (blue = main hand, orange = second hand) and cursor markers, drawn over the 3D scene.
export const COLORS = { main: '#1473E6', second: '#E8590C' };

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() { this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight); }

  /** Where a normalised, mirrored video coordinate lands on screen (the video is shown 'cover'). */
  static videoToScreen(nx, ny, vw, vh) {
    const W = window.innerWidth, H = window.innerHeight;
    const k = Math.max(W / vw, H / vh);
    return [(nx - 0.5) * vw * k + W / 2, (ny - 0.5) * vh * k + H / 2];
  }

  skeleton(lm, role, vw, vh, reading) {
    const c = this.ctx, col = COLORS[role];
    const pts = lm.map((p) => Overlay.videoToScreen(p.x, p.y, vw, vh));
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = col; c.fillStyle = col;
    c.shadowColor = col; c.shadowBlur = 8;
    c.lineWidth = 2.5;
    c.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) { c.moveTo(...pts[a]); c.lineTo(...pts[b]); }
    c.stroke();
    for (const p of pts) { c.beginPath(); c.arc(p[0], p[1], 3.2, 0, 6.2832); c.fill(); }
    c.restore();
    if (reading) {
      const [x, y] = Overlay.videoToScreen(reading.cur[0], reading.cur[1], vw, vh);
      c.save();
      c.strokeStyle = '#1F2328'; c.fillStyle = '#1F2328'; c.lineWidth = 2;
      if (reading.fist) { c.strokeStyle = '#E8590C'; c.beginPath(); c.arc(...Overlay.videoToScreen(reading.center[0], reading.center[1], vw, vh), 18, 0, 6.2832); c.stroke(); }
      else if (reading.peace) { c.strokeStyle = '#1F2328'; c.beginPath(); c.arc(...Overlay.videoToScreen(reading.center[0], reading.center[1], vw, vh), 18, 0, 6.2832); c.stroke(); }
      else if (reading.pinch || reading.grab) { c.beginPath(); c.arc(x, y, reading.grab ? 11 : 9, 0, 6.2832); c.fill(); }
      c.restore();
    }
  }

  /** The pointer: a ring in the hand's colour (a filled dot while pinching). */
  /** A ring that fills as a point-and-hold selection nears (p = 0..1). */
  progress(x, y, p, color = '#E8590C') {
    const c = this.ctx;
    c.save();
    c.lineWidth = 5; c.lineCap = 'round'; c.strokeStyle = color;
    c.beginPath(); c.arc(x, y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p); c.stroke();
    c.restore();
  }

  cursor(x, y, role, down, label) {
    const c = this.ctx, col = COLORS[role];
    c.save();
    c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2.5;
    c.shadowColor = col; c.shadowBlur = 10;
    c.beginPath(); c.arc(x, y, down ? 9 : 15, 0, 6.2832); down ? c.fill() : c.stroke();
    if (label) { c.shadowBlur = 0; c.font = '600 11px system-ui, sans-serif'; c.fillText(label, x + 20, y - 14); }
    c.restore();
  }
}
