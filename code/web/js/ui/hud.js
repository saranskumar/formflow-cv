// HUD: a top bar (workspace, drawing tools, status) and a bottom bar (messages, actions). Every control is a real HTML button, so the mouse
// clicks it natively and a pinch over it presses it (see Controller). Hovering never activates anything.
export const TOOL_INFO = {
  free: ['✎', 'Freehand', 'Pinch and move to draw a curve'],
  line: ['╱', 'Line', 'Pinch at the start, drag, release at the end'],
  rect: ['▭', 'Rectangle', 'Pinch at one corner, drag to the opposite corner'],
  circle: ['◯', 'Circle', 'Pinch at the centre, drag out for the radius'],
  cube: ['▣', 'Cube', 'Pinch at the centre, drag outward to size it'],
  sphere: ['●', 'Sphere', 'Pinch at the centre, drag outward to size it'],
  cylinder: ['⬭', 'Cylinder', 'Pinch at the centre, drag outward to size it'],
  cone: ['▲', 'Cone', 'Pinch at the centre, drag outward to size it'],
  pyramid: ['△', 'Pyramid', 'Pinch at the centre, drag outward to size it'],
  move: ['✥', 'Move', 'Pinch an object and drag it (or grab with thumb + middle finger)'],
  scale: ['⤢', 'Scale', 'Pinch an object, drag up to grow it, down to shrink it'],
  extrude: ['⬆', 'Extrude', 'Pinch inside a closed outline, drag up to pull it out into a solid (down pushes it the other way)'],
  cut: ['⬇', 'Cut', 'Pinch inside a closed outline drawn over a solid, drag up to cut a pocket or hole into it'],
};

// The toolbar is laid out in labelled groups. The top bar holds the drawing tools, the bottom bar the actions.
const TOOL_GROUPS = [
  ['draw', 'Draw', ['free', 'line', 'rect', 'circle']],
  ['solids', 'Solids', ['cube', 'sphere', 'cylinder', 'cone', 'pyramid']],
  ['edit', 'Edit', ['move', 'scale']],
  ['shape', 'Shape', ['extrude', 'cut']],
];
const ACTION_GROUPS = [
  ['history', 'History', [['undo', '↶', 'Undo'], ['clear', '✕', 'Clear scene']]],
  ['build', 'Build', [['join', '⛓', 'Join lines'], ['hull', '⬡', 'Visual hull'], ['photos', '🖼', 'Photos → 3D']]],
  ['file', 'File', [['import', '⇪', 'Import model'], ['exportOBJ', '⇩', 'Export OBJ'], ['exportSTL', '⇩', 'Export STL']]],
  ['depth', 'Depth', [['depthDown', '−', 'Depth −'], ['depthUp', '+', 'Depth +']]],
  ['view', 'View', [['snap', '▦', 'Snap'], ['resetView', '⌂', 'Reset view'], ['camera', '◉', 'Camera']]],
];
const NAV_ACTIONS = [['models', '🧪', 'Models'], ['demo', '▶', 'Demo'], ['settings', '⚙', 'Settings'], ['help', '?', 'Guide']]; // top right, next to the status chips

// The keyboard key of every button, shown on the button and in its tooltip, so the shortcuts can be learned by using the app
const KEYS = {
  tool: { free: '1', line: '2', rect: '3', circle: '4', cube: '5', sphere: '6', cylinder: '7', cone: '8', pyramid: '9', move: '0', scale: 'X', extrude: 'Q', cut: 'K' },
  action: { undo: 'Z', clear: 'C', join: 'J', hull: 'U', import: 'I', exportOBJ: 'E', resetView: 'V', depthDown: '[', depthUp: ']', snap: 'S', settings: ',', help: 'G', demo: 'O', models: 'M' },
};

const el = (tag, cls, html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; e.innerHTML = html; return e; };

export class Hud {
  constructor(root, onAction, onTool) {
    this.root = root;
    this.onAction = onAction;
    this.onTool = onTool;
    this.buttons = new Map();
    this.onLayout = () => {}; // called when the top or bottom bar changes height, so the workspace can move out of the way

    // ---- top bar: brand, workspace switch, drawing tools, status
    this.top = el('header', 'topbar hudzone');
    this.top.setAttribute('role', 'toolbar');
    this.top.setAttribute('aria-label', 'Drawing tools');
    this.brand = el('div', 'brand', '<b>Form</b>Flow');
    this.modeSlot = el('div', 'slot-mode');
    this.toolBar = el('div', 'tools');
    for (const [id, title, tools] of TOOL_GROUPS) {
      const g = this._group(id, title);
      for (const t of tools) {
        const [glyph, label, tip] = TOOL_INFO[t];
        g.append(this._button('tool', t, glyph, label, tip, () => onTool(t)));
      }
      this.toolBar.append(g);
    }
    this.chips = el('div', 'chips');
    this.chipMain = el('span', 'chip main', '<i></i>Main hand');
    this.chipSecond = el('span', 'chip second', '<i></i>Second hand');
    this.chipLink = el('span', 'chip link', '<i></i>Backend');
    this.chipFps = el('span', 'chip fps', '60 fps');
    this.chips.append(this.chipMain, this.chipSecond, this.chipLink, this.chipFps);
    this.navBar = el('div', 'navactions');
    for (const [id, glyph, label] of NAV_ACTIONS) this.navBar.append(this._button('action', id, glyph, label, label, () => onAction(id)));
    this.top.append(this.brand, this.modeSlot, this.toolBar, this.chips, this.navBar);

    // ---- bottom bar: what is going on, then the actions
    this.bottom = el('footer', 'bottombar hudzone');
    this.bar = el('div', 'bar');
    this.bar.setAttribute('role', 'status');
    this.bar.setAttribute('aria-live', 'polite');
    this.barText = el('div', 'msg', 'Pick a tool, then pinch and drag in the scene.');
    this.bar.append(this.barText);
    this.actionBar = el('div', 'actions');
    this.actionBar.setAttribute('role', 'toolbar');
    this.actionBar.setAttribute('aria-label', 'Actions');
    for (const [id, title, acts] of ACTION_GROUPS) {
      const g = this._group(id, title);
      for (const [a, glyph, label] of acts) g.append(this._button('action', a, glyph, label, label, () => onAction(a)));
      this.actionBar.append(g);
    }
    this.bottom.append(this.bar, this.actionBar);
    root.append(this.top, this.bottom);
    this.toastTimer = 0;
    this.hovered = null;
    this._watchBars();
  }

  _group(id, title) {
    const g = el('div', `grp ${id}`);
    g.setAttribute('role', 'group');
    g.setAttribute('aria-label', title);
    return g;
  }

  _button(kind, id, glyph, label, tip, onClick) {
    const key = KEYS[kind] && KEYS[kind][id];
    const b = el('button', `btn ${kind} v`, `<span class="g" aria-hidden="true">${glyph}</span><span class="t">${label}</span>${key ? `<kbd class="k" aria-hidden="true">${key}</kbd>` : ''}`);
    b.type = 'button'; b.title = key ? `${tip} (key ${key})` : tip;
    if (key) b.setAttribute('aria-keyshortcuts', key);
    b.dataset[kind] = id;
    b.addEventListener('click', onClick);
    this.buttons.set(`${kind}:${id}`, b);
    return b;
  }

  /** Publish the bars' heights as CSS variables (panels, prompts and the 3-plane workspace sit between them). */
  _watchBars() {
    const measure = () => {
      const t = Math.ceil(this.top.getBoundingClientRect().height), b = Math.ceil(this.bottom.getBoundingClientRect().height);
      if (t === this.topH && b === this.botH) return;
      this.topH = t; this.botH = b;
      document.documentElement.style.setProperty('--topH', `${t}px`);
      document.documentElement.style.setProperty('--botH', `${b}px`);
      this.onLayout(t, b);
    };
    this.topH = this.botH = 0;
    if (typeof ResizeObserver === 'function') { const ro = new ResizeObserver(measure); ro.observe(this.top); ro.observe(this.bottom); }
    window.addEventListener('resize', measure);
    measure();
  }

  setTool(tool) {
    for (const [k, b] of this.buttons) if (k.startsWith('tool:')) { b.classList.toggle('active', k === `tool:${tool}`); b.setAttribute('aria-pressed', String(k === `tool:${tool}`)); }
  }

  /** Name the chips after the physical hands: the drawing hand (cyan) and the navigation hand (magenta). */
  setHandLabels(draw, nav) {
    if (!this.chipMain.classList.contains('on')) this.chipMain.lastChild.textContent = `Draw hand (${draw})`;
    if (!this.chipSecond.classList.contains('on')) this.chipSecond.lastChild.textContent = `Nav hand (${nav})`;
  }

  /** Grey out an action that would do nothing right now (nothing to undo, nothing to export...). */
  setEnabled(action, on) {
    const b = this.buttons.get(`action:${action}`);
    if (b && b.disabled === on) b.disabled = !on;
  }

  setActive(action, on) { this.buttons.get(`action:${action}`)?.classList.toggle('active', !!on); }

  setHand(role, tracked, label) {
    const chip = role === 'main' ? this.chipMain : this.chipSecond;
    chip.classList.toggle('on', tracked);
    chip.lastChild.textContent = label;
  }

  setLink(online) {
    this.chipLink.classList.toggle('on', online);
    this.chipLink.lastChild.textContent = online ? 'Backend online' : 'Backend offline';
  }

  setFps(fps) { this.chipFps.textContent = `${Math.round(fps)} fps`; }

  toast(msg, kind = 'info', ms = 3500) {
    this.barText.textContent = msg;
    this.bar.dataset.kind = kind;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.bar.dataset.kind = 'info'; }, ms);
  }

  /** The HUD element under a screen point, or null over the open 3D scene. */
  hit(x, y) {
    const e = document.elementFromPoint(x, y);
    return e && e.closest('.hudzone') ? e.closest('button') || e.closest('.hudzone') : null;
  }

  /** A pinch over a HUD element is a click. */
  press(e) {
    const b = e.closest ? e.closest('button') : null;
    if (b) b.click();
  }

  /** Visual feedback only: highlight the button under a hand cursor. */
  hover(e) {
    const b = e && e.tagName === 'BUTTON' ? e : null;
    if (b === this.hovered) return;
    this.hovered?.classList.remove('hand-hover');
    b?.classList.add('hand-hover');
    this.hovered = b;
  }
}
