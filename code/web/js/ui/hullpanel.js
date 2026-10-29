// The Visual hull panel: pick a view, draw a closed outline, repeat for another view, press Make 3D.
import { seg, markSeg } from './settings.js';

const VIEW_LABEL = { front: 'Front', side: 'Side', top: 'Top' };
const QUALITY = [['48', 'Fast'], ['64', 'Normal'], ['96', 'Fine'], ['128', 'Ultra']];
const ALIGN = [['true', 'On'], ['false', 'Off']];

export class HullPanel {
  /** api: { view(name), join(), make(), opt(key, value) } */
  constructor(parent, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.className = 'hudzone hullpanel';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="head"><b>Visual hull</b><button type="button" class="x" data-act="close" aria-label="Close">✕</button></div>
      <p class="help">Make a 3D shape from its outlines, like an engineering drawing.</p>
      <ol class="steps"><li>Pick a <b>view</b> — the camera turns to look straight at it.</li>
        <li>With <b>Freehand</b>, draw a <b>closed outline</b> of the object from that side. (Joining lines can close it for you.)</li>
        <li>Do the same for a second view (a third makes it more exact).</li><li>Press <b>Make 3D</b>.</li></ol>
      <div class="views">${['front', 'side', 'top'].map((v) => `<button type="button" data-view="${v}"><b>${VIEW_LABEL[v]}</b><small data-count="${v}">no outline</small></button>`).join('')}</div>
      <div class="opts"><span>Detail</span>${seg('n', QUALITY, '64')}<span>Match views</span>${seg('align', ALIGN, 'true')}</div>
      <div class="row"><button type="button" class="ghost" data-act="join">Join lines</button>
        <button type="button" class="primary" data-act="make" disabled>Make 3D</button></div>
      <div class="msg"></div>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.view) api.view(b.dataset.view);
      else if (b.dataset.set) { api.opt(b.dataset.set, b.dataset.v); markSeg(b); }
      else if (b.dataset.act === 'join') api.join();
      else if (b.dataset.act === 'make' && !b.disabled) api.make();
      else if (b.dataset.act === 'close') this.close();
    });
  }

  get open() { return !this.el.hidden; }
  show() { this.el.hidden = false; }
  close() { this.el.hidden = true; }
  toggle() { this.el.hidden ? this.show() : this.close(); }

  /** desc = describeOutlines(items); current = the camera's aligned view or null */
  update(desc, current) {
    for (const v of ['front', 'side', 'top']) {
      const n = desc[v];
      const b = this.el.querySelector(`[data-view=${v}]`);
      b.classList.toggle('done', n > 0);
      b.classList.toggle('current', current === v);
      b.querySelector('small').textContent = n ? `${n} outline${n > 1 ? 's' : ''} ✓` : current === v ? 'draw here' : 'no outline';
    }
    this.el.querySelector('[data-act=make]').disabled = desc.viewCount === 0;
    const notes = [];
    if (desc.open) notes.push(`${desc.open} open outline${desc.open > 1 ? 's' : ''} can’t be used yet — press <b>Join lines</b> to close ${desc.open > 1 ? 'them' : 'it'}.`);
    if (desc.oblique) notes.push(`${desc.oblique} outline${desc.oblique > 1 ? 's were' : ' was'} drawn at an angle — use a view button, then redraw.`);
    if (desc.autoClosed) notes.push(`${desc.autoClosed} almost-closed outline${desc.autoClosed > 1 ? 's' : ''} will be closed automatically.`);
    if (desc.viewCount === 1) notes.push('One view is extruded. Add a second view for a true hull.');
    if (!this.result) this.el.querySelector('.msg').innerHTML = notes.map((n) => `<p>${n}</p>`).join('');
  }

  /** Show what Make 3D did (or why it could not). */
  showResult(r) {
    this.result = r;
    const m = this.el.querySelector('.msg');
    if (!r.ok) { m.innerHTML = `<p class="bad">${r.reason}</p>`; return; }
    const iou = Object.entries(r.stats.iou).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ');
    m.innerHTML = `<p class="good">Built from ${r.stats.views.join(' + ')}: ${r.stats.triangles.toLocaleString()} triangles.</p>`
      + `<p>How well it matches each drawing: ${iou}</p>` + r.stats.warnings.map((w) => `<p class="warn">${w}</p>`).join('');
  }

  clearResult() { this.result = null; }
}
