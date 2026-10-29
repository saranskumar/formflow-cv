// UI for the 3-plane workspace:
//   * the mode switch at the top of the screen,
//   * a label and a small toolbar on each drawing cell (add a photo, auto outline or trace by hand, adjust the photo),
//   * a compact bar underneath: progress per view, preview options and the Make 3D button.
// Everything is a real <button> inside a .hudzone, so a mouse click and a hand pinch both press it.
import { seg, markSeg } from './settings.js';
import { CELL_NAMES, PLANE_VIEWS } from '../core/planes.js';

const QUALITY = [['48', 'Fast'], ['64', 'Normal'], ['96', 'Fine'], ['128', 'Ultra']];
const ONOFF = [['true', 'On'], ['false', 'Off']];
const VIEW_TITLE = { front: 'Front', side: 'Side', top: 'Top' };
const OBJECT_LABEL = { auto: 'Auto', dark: 'Dark', light: 'Light' };
export const DRAW_VIEWS = ['front', 'side', 'top'];

export class ModeSwitch {
  /** onPick(mode): 'sketch' | 'planes' */
  constructor(parent, onPick) {
    this.el = document.createElement('div');
    this.el.className = 'modeswitch';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Workspace');
    this.el.innerHTML = `<button type="button" data-mode="sketch" class="on" aria-pressed="true"><b>3D Sketch</b><small>draw in the air</small></button>`
      + `<button type="button" data-mode="planes" aria-pressed="false"><b>3-Plane Hull</b><small>front · side · top</small></button>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) onPick(b.dataset.mode); });
  }

  set(mode) {
    this.el.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
  }
}

/** The toolbar on one drawing cell. state = { image: bool, source: 'auto'|'hand', object, adjusting, outline: bool } */
class CellTools {
  constructor(parent, view, api) {
    this.view = view;
    this.el = document.createElement('div');
    this.el.className = 'hudzone celltools';
    this.el.hidden = true;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', `${VIEW_TITLE[view]} view`);
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.op) api(view, b.dataset.op);
    });
    this.key = '';
  }

  render(st) {
    const key = JSON.stringify(st);
    if (key === this.key) return; // re-rendering would drop the hand-hover highlight every frame
    this.key = key;
    const open = `<button type="button" class="tb icon" data-op="focus" aria-label="Open this view full screen" title="Open this view full screen, or go back to the three views">⤢</button>`;
    if (!st.image) {
      this.el.innerHTML = `${open}<button type="button" class="tb wide" data-op="photo" title="Put a photo or drawing of the object behind this view">
        <span aria-hidden="true">🖼</span> Add photo</button>`;
      return;
    }
    const pressed = (on, cls = 'tb') => `aria-pressed="${on}" class="${cls}${on ? ' on' : ''}"`;
    this.el.innerHTML = `${open}
      <span class="grp" role="group" aria-label="Outline from the photo">
        <button type="button" data-op="auto" ${pressed(st.source === 'auto')} title="Find the object's outline in the photo automatically">Auto</button>
        <button type="button" data-op="hand" ${pressed(st.source === 'hand')} title="Keep the photo as a guide and trace it yourself with Freehand">Trace</button>
      </span>
      ${st.source === 'auto' ? `<button type="button" class="tb" data-op="object" title="Object vs background: Auto, a dark object on a light page, or a light object on a dark background">Object: ${OBJECT_LABEL[st.object]}</button>` : ''}
      <span class="sep" aria-hidden="true"></span>
      <button type="button" data-op="adjust" ${pressed(st.adjusting, 'tb icon')} aria-label="Move the photo by dragging" title="Adjust: drag in this view to move the photo, mouse wheel resizes it">✥</button>
      <button type="button" class="tb icon" data-op="smaller" aria-label="Make photo smaller" title="Smaller">−</button>
      <button type="button" class="tb icon" data-op="bigger" aria-label="Make photo bigger" title="Bigger">+</button>
      <button type="button" class="tb icon" data-op="fade" aria-label="Change photo opacity" title="Fade">◐</button>
      <button type="button" class="tb icon" data-op="flip" aria-label="Mirror photo" title="Mirror">⇋</button>
      <button type="button" class="tb icon del" data-op="remove" aria-label="Remove photo" title="Remove photo">✕</button>`;
  }
}

/** The toolbar of the 3D preview cell: just the button that opens it full screen. */
class PreviewTools {
  constructor(parent, api) {
    this.el = document.createElement('div');
    this.el.className = 'hudzone celltools';
    this.el.hidden = true;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', '3D preview');
    this.el.innerHTML = '<button type="button" class="tb icon" data-op="focus" aria-label="Open the 3D preview full screen" title="Open the 3D preview full screen, or go back to the three views">⤢</button>';
    parent.append(this.el);
    this.el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.op) api('preview', b.dataset.op); });
  }
}

const FOCUS_TABS = [['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['preview', '3D preview']];

export class PlaneBar {
  /** api: { join(), make(), clear(), photos(), opt(key, value), cell(view, op) } */
  constructor(parent, api) {
    this.api = api;
    this.labels = {};
    this.tools = {};
    this.labelHost = document.createElement('div');
    this.labelHost.className = 'celllabels';
    this.labelHost.hidden = true;
    for (const n of CELL_NAMES) {
      const d = document.createElement('div');
      d.className = `celllabel ${n}`;
      d.innerHTML = n === 'preview' ? '<b>3D PREVIEW</b><small>builds itself as you draw</small>'
        : `<b>${PLANE_VIEWS[n].label}</b><small>${PLANE_VIEWS[n].hint}</small><i class="state"></i>`;
      this.labelHost.append(d);
      this.labels[n] = d;
    }
    parent.append(this.labelHost);
    for (const v of DRAW_VIEWS) this.tools[v] = new CellTools(parent, v, (view, op) => api.cell(view, op));
    this.tools.preview = new PreviewTools(parent, (view, op) => api.cell(view, op));
    this.focused = null;
    // while one view fills the screen: a strip to go back to the three views or jump to another view
    this.focusbar = document.createElement('div');
    this.focusbar.className = 'hudzone focusbar';
    this.focusbar.hidden = true;
    this.focusbar.setAttribute('role', 'toolbar');
    this.focusbar.setAttribute('aria-label', 'Full screen view');
    this.focusbar.innerHTML = `<button type="button" class="tb wide" data-close title="Back to the three views (Esc)">✕ Back to 3 views</button>
      <span class="grp" role="group" aria-label="Open another view">${FOCUS_TABS.map(([v, t]) => `<button type="button" class="tb" data-focus="${v}">${t}</button>`).join('')}</span>`;
    parent.append(this.focusbar);
    this.focusbar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.close !== undefined) api.focus(null);
      else if (b.dataset.focus) api.focus(b.dataset.focus);
    });

    this.el = document.createElement('div');
    this.el.className = 'hudzone planebar';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="steps" aria-label="Views done">${DRAW_VIEWS.map((v) => `<span class="step" data-step="${v}"><b>${VIEW_TITLE[v]}</b><small>empty</small></span>`).join('')}</div>
      <div class="opts">
        <span class="opt">Preview ${seg('live', ONOFF, 'true')}</span>
        <span class="opt">Detail ${seg('n', QUALITY, '64')}</span>
        <span class="opt" title="Soften the finished surface (Taubin smoothing). Rounds sharp corners slightly.">Smooth ${seg('smooth', [['0', 'Off'], ['2', 'On']], '0')}</span>
        <span class="opt" title="Stretch the views so their shared sizes agree">Match sizes ${seg('align', ONOFF, 'true')}</span>
        <span class="opt" title="With only a Front or Side view: extrude it to a slab, or spin it into a round object (bottle, vase, cup)">One view ${seg('round', [['false', 'Extrude'], ['true', 'Round']], 'false')}</span>
      </div>
      <div class="acts">
        <button type="button" class="ghost" data-act="photos" title="Pick up to three photos of the object (front, side, top); their outlines are found and turned into a 3D model">🖼 Photos → 3D</button>
        <button type="button" class="ghost" data-act="join" title="Close nearly-closed outlines and join lines that almost touch">Join lines</button>
        <button type="button" class="ghost" data-act="clear" title="Remove the outlines of the view you drew in last">Clear view</button>
        <button type="button" class="primary" data-act="make" disabled>Make 3D</button>
      </div>
      <div class="msg" aria-live="polite"></div>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.set) { api.opt(b.dataset.set, b.dataset.v); markSeg(b); }
      else if (b.dataset.act === 'join') api.join();
      else if (b.dataset.act === 'photos') api.photos();
      else if (b.dataset.act === 'clear') api.clear();
      else if (b.dataset.act === 'make' && !b.disabled) api.make();
    });
  }

  get open() { return !this.el.hidden; }

  show(on) {
    this.el.hidden = this.labelHost.hidden = !on;
    for (const t of Object.values(this.tools)) t.el.hidden = !on;
    this.focusbar.hidden = !on || !this.focused;
  }

  /** One view full screen (a name), or back to all four (null). */
  setFocus(name) {
    this.focused = name || null;
    this.focusbar.hidden = !this.focused || this.el.hidden;
    this.el.classList.toggle('focus', !!this.focused); // the option row folds away: the picture needs the room
    for (const b of this.focusbar.querySelectorAll('[data-focus]')) { const on = b.dataset.focus === this.focused; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }

  /** Move the cell labels and toolbars to match the layout. */
  place(layout) {
    if (!layout.cells) return;
    for (const n of CELL_NAMES) {
      const c = layout.cells[n], d = this.labels[n], gone = c.w <= 0;
      Object.assign(d.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
      d.classList.toggle('cellhidden', gone || this.focused === n); // the strip names the open view
      const t = this.tools[n];
      if (t) {
        t.el.classList.toggle('cellhidden', gone);
        Object.assign(t.el.style, { right: `${window.innerWidth - (c.x + c.w) + 6}px`, top: `${c.y + 6}px`, maxWidth: `${Math.max(c.w - (this.focused === n ? 520 : 88), 160)}px` });
      }
      if (this.focused === n) Object.assign(this.focusbar.style, { left: `${c.x + 8}px`, top: `${c.y + 6}px` });
    }
  }

  /** states = { front: CellTools state, ... } */
  setCells(states) { for (const v of DRAW_VIEWS) this.tools[v].render(states[v]); }

  /** desc = describeOutlines(items); shared = sharedDimensions(items); active = view being drawn in; photos = {view: bool} */
  update(desc, shared, active, photos = {}) {
    const count = { front: desc.front, side: desc.side, top: desc.top };
    for (const v of DRAW_VIEWS) {
      const s = this.el.querySelector(`[data-step=${v}]`);
      s.classList.toggle('done', count[v] > 0);
      const what = count[v] ? `${count[v]} outline${count[v] > 1 ? 's' : ''} ✓` : photos[v] ? 'photo, no outline' : 'empty';
      if (s.lastChild.textContent !== what) s.lastChild.textContent = what;
      this.labels[v].querySelector('.state').textContent = count[v] ? '✓' : '';
      this.labels[v].classList.toggle('done', count[v] > 0);
      this.labels[v].classList.toggle('active', active === v);
    }
    this.el.querySelector('[data-act=make]').disabled = desc.viewCount === 0;
    const notes = [];
    if (!desc.viewCount && !desc.open) notes.push('Draw a <b>closed outline</b> of your object in two views, or press <b>Add photo</b> on a view.');
    if (desc.open) notes.push(`${desc.open} open outline${desc.open > 1 ? 's' : ''} ignored. <b>Join lines</b> closes ${desc.open > 1 ? 'them' : 'it'}.`);
    if (desc.viewCount === 1) notes.push(this.round && desc.top === 0 ? 'One view, <b>Round</b>: the outline is spun into a round object.' : 'One view only, so the shape is extruded. Add a second view to set its depth, or choose <b>One view: Round</b> for a round object.');
    for (const w of shared.warnings) notes.push(`<span class="warn">⚠ ${w}</span>`);
    const html = notes.map((n) => `<p>${n}</p>`).join('');
    const m = this.el.querySelector('.msg');
    if (m.innerHTML !== html) m.innerHTML = html;
  }
}
