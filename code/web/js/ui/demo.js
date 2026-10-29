// Demo gallery: ready-made photo sets (code/samples, listed by GET /api/samples) that turn into a 3D model with one click.
// Every card is a real <button>, so a mouse click and a hand pinch both press it.
export class DemoPanel {
  /** onPick(set): set = { id, title, blurb, tag, views: ['front', ...], round? } */
  constructor(parent, onPick) {
    this.onPick = onPick;
    this.sets = null; // fetched once
    this.el = document.createElement('div');
    this.el.className = 'hudzone demopanel';
    this.el.hidden = true;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Demo gallery');
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return this.close();
      const card = e.target.closest('[data-set]');
      if (card && this.sets) this.onPick(this.sets.find((s) => s.id === card.dataset.set));
    });
  }

  get open() { return !this.el.hidden; }

  async show() {
    this.el.hidden = false;
    this._render('<p class="help">Loading the demo pictures…</p>');
    if (!this.sets) {
      try { this.sets = await (await fetch('/api/samples')).json(); } catch { this.sets = []; }
    }
    this._render();
  }

  close() { this.el.hidden = true; }
  toggle() { return this.open ? this.close() : this.show(); }

  _render(message) {
    const head = '<div class="head"><b>Demo gallery</b><button type="button" class="x" data-close aria-label="Close">✕</button></div>';
    if (message) { this.el.innerHTML = `${head}${message}`; return; }
    if (!this.sets || !this.sets.length) {
      this.el.innerHTML = `${head}<p class="help">No demo pictures found. They live in the <b>samples</b> folder next to the app (make them with <code>python samples/make_samples.py</code>).</p>`;
      return;
    }
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    this.el.innerHTML = `${head}<p class="help">Press a card: its pictures are loaded into the views and outlined. Then press <b>Make 3D</b> to build the model. Undo brings your previous scene back.</p>
      <div class="demogrid">${this.sets.map((s) => `<button type="button" class="democard" data-set="${esc(s.id)}">
        <span class="thumbs">${s.views.slice(0, 3).map((v) => `<img src="/samples/${esc(s.id)}/${esc(v)}.png" alt="" loading="lazy">`).join('')}</span>
        <b>${esc(s.title)}</b><small>${esc(s.blurb || '')}</small><i>${esc(s.tag || '')}</i></button>`).join('')}</div>`;
  }
}
