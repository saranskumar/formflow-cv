// Models panel: run each available model on the live camera for a few seconds and see how fast it is, whether it finds a hand,
// and the hand itself: a small live picture shows the camera with the points the model finds drawn on it.
import { MODELS, NOT_INSTALLED, describe, advice } from '../core/benchmark.js';
import { HAND_CONNECTIONS } from './overlay.js';

const POSE_CONNECTIONS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22]];

/** Draw a camera picture (mirrored, like the main view) and the points of a snapshot { hands, pose, label } on it. */
export function drawPreview(ctx, w, h, video, snap) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#20242a';
  ctx.fillRect(0, 0, w, h);
  if (video && video.readyState >= 2) { ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, w, h); ctx.restore(); }
  if (!snap) return;
  const px = (p) => [(snap.mirrored ? p.x : 1 - p.x) * w, p.y * h]; // model results are in camera orientation; the app's own are already mirrored
  const line = (pts, conns, color, r) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.beginPath();
    for (const [a, b] of conns) if (pts[a] && pts[b]) { ctx.moveTo(...px(pts[a])); ctx.lineTo(...px(pts[b])); }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const p of pts) { const [x, y] = px(p); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke(); }
  };
  if (snap.pose && snap.pose.length) line(snap.pose, POSE_CONNECTIONS, '#E8590C', 2.5);
  (snap.hands || []).forEach((hand, i) => line(hand, HAND_CONNECTIONS, i ? '#E8590C' : '#1473E6', 3));
  if (snap.label) { ctx.font = '600 14px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(snap.label, 10, 22); ctx.fillText(snap.label, 10, 22); }
}

export class ModelLab {
  /** api: { run(id, onProgress, onSnap) -> Promise<summary>, use(id), current() -> { active }, live() -> { video, snap } } */
  constructor(parent, api) {
    this.api = api;
    this.results = {};
    this.busy = null;
    this.snap = null; // the latest picture of the model under test
    this.el = document.createElement('div');
    this.el.className = 'hudzone modellab';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Model test');
    this.el.innerHTML = `<div class="head"><b>Models</b><button type="button" class="x" data-close aria-label="Close">✕</button></div>
      <div class="labrow"><div class="viewwrap"><canvas class="preview" width="480" height="270" aria-label="Camera with the points the model finds"></canvas><small class="viewnote"></small></div><div class="labbody"></div></div>`;
    parent.append(this.el);
    this.canvas = this.el.querySelector('canvas');
    this.note = this.el.querySelector('.viewnote');
    this.body = this.el.querySelector('.labbody');
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.close !== undefined) this.close();
      else if (b.dataset.run) this.run([b.dataset.run]);
      else if (b.dataset.all !== undefined) this.run(MODELS.map((m) => m.id));
      else if (b.dataset.use) { this.api.use(b.dataset.use); this.render(); }
    });
  }

  get open() { return !this.el.hidden; }

  show() {
    this.el.hidden = false;
    this.render();
    this.timer = setInterval(() => this._draw(), 90);
  }

  close() { this.el.hidden = true; clearInterval(this.timer); }
  toggle() { return this.open ? this.close() : this.show(); }

  _draw() {
    if (!this.open) return;
    const live = this.api.live();
    const testing = this.busy && this.snap;
    drawPreview(this.canvas.getContext('2d'), this.canvas.width, this.canvas.height, live.video, testing ? this.snap : live.snap);
    const text = this.busy ? `Testing ${this._title(this.busy.id)}…` : 'What the app sees now';
    if (this.note.textContent !== text) this.note.textContent = text;
  }

  _title(id) { const m = MODELS.find((x) => x.id === id); return `${m.title} (${m.delegate}${m.picture ? `, ${m.picture} px` : ''})`; }

  async run(ids) {
    if (this.busy) return;
    this.lastError = '';
    for (const id of ids) {
      this.busy = { id, progress: 0 };
      this.snap = null;
      this.render();
      try {
        this.results[id] = await this.api.run(id, (p) => { this.busy.progress = p; this._progress(); }, (s) => { this.snap = s; });
      } catch (e) {
        this.results[id] = null;
        this.lastError = `${this._title(id)}: ${e.message || e}`;
      }
    }
    this.busy = null;
    this.render();
  }

  _progress() {
    const bar = this.body.querySelector('.bar2 i');
    if (bar && this.busy) bar.style.width = `${Math.round(this.busy.progress * 100)}%`;
  }

  render() {
    const cur = this.api.current(), tips = advice(this.results);
    const rows = MODELS.map((m) => {
      const r = this.results[m.id], running = this.busy && this.busy.id === m.id;
      const usable = m.api === 'hand' || m.api === 'gesture'; // these can drive the app's hand tracking
      const inUse = usable && m.id === cur.active;
      const result = running ? `<span class="bar2"><i style="width:${Math.round(this.busy.progress * 100)}%"></i></span> ${m.url && this.busy.progress === 0 ? 'downloading…' : 'testing…'}`
        : r ? describe(r, m.kind) : r === null ? '<span class="warn">could not run</span>' : '<span class="dim">not tested yet</span>';
      const code = m.picture ? String(m.picture) : m.delegate;
      const faster = r && usable && !inUse && tips.some((a) => a.kind === 'hand' && a.best === code);
      return `<tr><td><b>${m.title}</b>${m.url ? ' <i class="net">downloaded when tested</i>' : ''}<small>${m.what}</small></td><td>${m.delegate}${m.picture ? `, ${m.picture} px` : ''}${inUse ? ' <i class="cur">in use</i>' : ''}</td><td>${m.size}</td>
        <td class="res">${result}</td>
        <td><button type="button" class="tb" data-run="${m.id}" ${this.busy ? 'disabled' : ''}>Test</button>${usable && !inUse ? ` <button type="button" class="tb ${faster ? 'wide' : ''}" data-use="${m.id}" title="Track your hands with this model">${faster ? 'Use (faster)' : 'Use'}</button>` : ''}</td></tr>`;
    }).join('');
    this.body.innerHTML = `<p class="help">Each test runs the model on about 3 seconds of live camera pictures. <b>Hold your open hand in view</b>: the picture on the left shows what the model finds. The app pauses while a test runs. Models marked "downloaded when tested" come from Google's model storage the first time (needs internet).</p>
      <div class="tablewrap"><table class="models"><thead><tr><th>Model</th><th>Runs on</th><th>Size</th><th>Result on this computer</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row"><button type="button" class="tb wide" data-all ${this.busy ? 'disabled' : ''}>Test all</button></div>
      ${this.lastError ? `<p class="warn">⚠ ${this.lastError}</p>` : ''}${tips.map((a) => `<p>${a.text}</p>`).join('')}
      <details><summary>Other models (not available here)</summary><ul>${NOT_INSTALLED.map((m) => `<li><b>${m.title}</b>: ${m.how}</li>`).join('')}</ul></details>`;
  }
}
