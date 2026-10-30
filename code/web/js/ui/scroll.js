// Scrolling that works without a mouse wheel: two big arrow buttons that appear beside any panel too long for the screen
// (press or point-and-hold: one page up or down), with a "page 2 of 3" read-out. Panels can also be dragged with a pinch
// (Controller + Hud.scrollBy), and the settings have a section menu (see sectionNav).

// the panels that can be longer than the window, most "on top" first
const PANELS = ['.modal.open .pages', '.modellab', '.demopanel', '.settings', '.hullpanel'];

export class ScrollFab {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'hudzone scrollfab';
    this.el.hidden = true;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Scroll the panel');
    this.el.innerHTML = '<button type="button" data-dir="-1" aria-label="Scroll up" title="Up one page">▲</button><span class="where"></span><button type="button" data-dir="1" aria-label="Scroll down" title="Down one page">▼</button>';
    parent.append(this.el);
    this.panel = null;
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled || !this.panel) return;
      this.panel.scrollBy({ top: +b.dataset.dir * this.panel.clientHeight * 0.8, behavior: 'smooth' });
    });
  }

  /** The visible panel that overflows, or null. */
  static find(doc = document) {
    for (const sel of PANELS) {
      const el = doc.querySelector(sel);
      if (el && !el.hidden && el.offsetParent !== null && el.scrollHeight > el.clientHeight + 4) return el;
    }
    return null;
  }

  /** Call a few times a second: show the arrows beside the open panel when it needs them. */
  update() {
    const p = ScrollFab.find();
    this.panel = p;
    this.el.hidden = !p;
    if (!p) return;
    const r = p.getBoundingClientRect(), max = p.scrollHeight - p.clientHeight;
    const pages = Math.ceil(p.scrollHeight / p.clientHeight), page = Math.min(pages, Math.floor((p.scrollTop / Math.max(max, 1)) * (pages - 1) + 0.5) + 1);
    const [up, down] = this.el.querySelectorAll('button');
    up.disabled = p.scrollTop <= 2;
    down.disabled = p.scrollTop >= max - 2;
    const text = `${page}/${pages}`;
    const where = this.el.querySelector('.where');
    if (where.textContent !== text) where.textContent = text;
    // beside the panel when there is room, else over its right edge
    const w = this.el.offsetWidth || 56, room = window.innerWidth - r.right;
    this.el.style.left = `${room >= w + 10 ? r.right + 8 : r.right - w - 14}px`;
    this.el.style.top = `${Math.max(r.top + 8, Math.min(r.bottom - (this.el.offsetHeight || 120) - 8, r.top + r.height / 2 - (this.el.offsetHeight || 120) / 2))}px`;
  }
}

/** A row of buttons that jump to the sections of a long panel. Returns the HTML; click handling is sectionJump. */
export function sectionNav(el, selector = 'section', title = 'h4') {
  const secs = [...el.querySelectorAll(selector)];
  if (secs.length < 3) return '';
  return `<nav class="sectnav" aria-label="Sections">${secs.map((s, i) => `<button type="button" data-jump="${i}">${s.querySelector(title).textContent}</button>`).join('')}</nav>`;
}

/** Scroll a panel so section i is at the top (below the sticky heading). */
export function sectionJump(el, i, selector = 'section') {
  const s = el.querySelectorAll(selector)[i];
  if (s) el.scrollTo({ top: s.offsetTop - (el.querySelector('.head')?.offsetHeight || 0) - (el.querySelector('.sectnav')?.offsetHeight || 0) - 4, behavior: 'smooth' });
}
