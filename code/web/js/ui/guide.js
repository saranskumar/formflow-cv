// Onboarding guide shown on launch: roles, an animated gesture index, controls table, and a practice
// sandbox where the user must perform a real pinch and a real fist before entering the workspace.
import { PracticeSession } from '../core/practice.js';
import { CONTROLS, handName } from '../core/controls.js';
import { seg, HAND_OPTIONS, RANGE_OPTIONS, RANGE_HELP } from './settings.js';

const CYAN = '#1473E6', MAGENTA = '#E8590C'; // the drawing hand is blue, the navigation hand orange

/** A stylised hand. pose: open | pinch | grab | fist | peace */
export function handSvg(pose, color, x = 0, y = 0, s = 1) {
  const f = (d) => `<path d="${d}" />`;
  const finger = {
    index: { base: [41, 74], up: 'M41 74 L38 28', curl: 'M41 74 L41 58 L44 74' },
    middle: { base: [53, 72], up: 'M53 72 L53 22', curl: 'M53 72 L53 56 L56 72' },
    ring: { base: [65, 74], up: 'M65 74 L68 28', curl: 'M65 74 L65 58 L62 74' },
    pinky: { base: [77, 78], up: 'M77 78 L82 40', curl: 'M77 78 L77 64 L74 78' },
  };
  const paths = [];
  const thumbs = { open: 'M36 106 L16 88', pinch: 'M36 106 L26 88 L28 66', grab: 'M36 106 L30 90 L32 68', fist: 'M36 106 L52 96', peace: 'M36 106 L54 98' };
  let idx = finger.index.up, mid = finger.middle.up, ring = finger.ring.up, pink = finger.pinky.up;
  if (pose === 'pinch') idx = 'M41 74 L36 44 L30 64';
  if (pose === 'grab') mid = 'M53 72 L48 40 L34 62';
  if (pose === 'fist') { idx = finger.index.curl; mid = finger.middle.curl; ring = finger.ring.curl; pink = finger.pinky.curl; }
  if (pose === 'peace') { idx = 'M41 74 L28 28'; mid = 'M53 72 L66 24'; ring = finger.ring.curl; pink = finger.pinky.curl; }
  [idx, mid, ring, pink, thumbs[pose]].forEach((d) => paths.push(f(d)));
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <rect x="32" y="70" width="56" height="58" rx="18" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="3"/>
    <g fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 5px ${color})">${paths.join('')}</g>
  </g>`;
}

const svg = (inner, w = 250) => `<svg viewBox="0 0 250 150" width="${w}" class="ill">${inner}</svg>`;

const CARDS = [
  { name: 'Draw / place a shape', who: 'Main hand', color: CYAN, how: 'Pinch thumb + index, then drag',
    art: svg(`${handSvg('pinch', CYAN, 0, 0)}<path class="fx draw" d="M130 110 C150 40 170 130 190 60 S225 80 235 45" fill="none" stroke="#E8590C" stroke-width="5" stroke-linecap="round"/>`) },
  { name: 'Move an object', who: 'Main hand', color: CYAN, how: 'Pinch thumb + middle finger, then drag',
    art: svg(`${handSvg('grab', CYAN, 0, 0)}<g class="fx slide"><rect x="150" y="62" width="44" height="44" rx="5" fill="#E8590C" fill-opacity=".3" stroke="#E8590C" stroke-width="3"/></g>`) },
  { name: 'Orbit the camera', who: 'Second hand', color: MAGENTA, how: 'Make a fist and move',
    art: svg(`${handSvg('fist', MAGENTA, 0, 0)}<g class="fx spin" style="transform-origin:185px 84px"><path d="M185 40 A44 44 0 1 1 141 84" fill="none" stroke="#E8590C" stroke-width="5" stroke-linecap="round"/><path d="M130 76 L141 90 L152 76" fill="none" stroke="#E8590C" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g><rect x="167" y="66" width="36" height="36" rx="4" fill="#E8590C" fill-opacity=".3" stroke="#E8590C" stroke-width="3"/>`) },
  { name: 'Pan the camera', who: 'Second hand', color: MAGENTA, how: 'Peace sign (index + middle up) and move',
    art: svg(`${handSvg('peace', MAGENTA, 0, 0)}<g class="fx pan"><path d="M130 84 H236 M218 66 L236 84 L218 102 M148 66 L130 84 L148 102" fill="none" stroke="#1473E6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></g>`) },
  { name: 'Zoom', who: 'Both hands', color: '#1F2328', how: 'Pinch with both hands, move them apart or together',
    art: svg(`<g class="fx zl">${handSvg('pinch', MAGENTA, -6, 8, 0.62)}</g><g class="fx zr">${handSvg('pinch', CYAN, 156, 8, 0.62)}</g><path d="M92 120 H158 M104 108 L92 120 L104 132 M146 108 L158 120 L146 132" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`) },
];

const PRACTICE = [
  ['hand', 'Show your hand', 'Hold a hand in view of the camera'],
  ['pinch', 'Pinch', 'Touch your thumb and index finger together and hold'],
  ['fist', 'Fist', 'Close all your fingers into a fist and hold'],
  ['grab', 'Grab  (bonus)', 'Touch your thumb and middle finger together'],
  ['peace', 'Peace sign  (bonus)', 'Raise index + middle, fold the others'],
];

const ring = (k, label, hint) => `<li data-k="${k}"><div class="ring" style="--p:0"><span>✓</span></div><div><b>${label}</b><small>${hint}</small></div></li>`;

export class Guide {
  /**
   * onEnter({ calibration, mouseOnly })
   * opts: { getSettings(): settings, onSetting(key, value) }  - the guide shares its choices with the Settings panel
   */
  constructor(root, onEnter, opts = {}) {
    this.root = root;
    this.onEnter = onEnter;
    this.getSettings = opts.getSettings || (() => ({ dominant: 'Right', range: 'near' }));
    this.onSetting = opts.onSetting || (() => {});
    this.page = 0;
    this.practice = new PracticeSession();
    this.tracker = { state: 'loading', msg: 'Starting camera…' };
    this.visible = false;
    this.pageFns = [() => this._welcome(), () => this._roles(), () => this._gestures(), () => this._controls(), () => this._practice()];
    root.innerHTML = `<div class="panel">
      <div class="pages"></div>
      <div class="nav"><button type="button" class="skip" data-a="skip">Skip guide</button><div class="dots"></div>
      <button type="button" data-a="back" class="ghost">Back</button><button type="button" data-a="next" class="primary">Next</button></div></div>`;
    this.pagesEl = root.querySelector('.pages');
    this.dotsEl = root.querySelector('.dots');
    this.dotsEl.innerHTML = this.pageFns.map((_, i) => `<button type="button" data-i="${i}" aria-label="Guide page ${i + 1}"></button>`).join('');
    root.addEventListener('click', (e) => {
      const setBtn = e.target.closest('[data-set]');
      if (setBtn) { this.onSetting(setBtn.dataset.set, setBtn.dataset.v); return; }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'next') this.go(this.page + 1);
      else if (a === 'back') this.go(this.page - 1);
      else if (a === 'skip' || a === 'mouse') this.enter(true);
      else if (a === 'enter' && this.practice.ready) this.enter(false);
      else if (e.target.dataset.i) this.go(+e.target.dataset.i);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.key === 'ArrowRight') this.go(this.page + 1);
      if (e.key === 'ArrowLeft') this.go(this.page - 1);
      if (e.key === 'Escape') this.enter(true);
    });
  }

  get pages() { return this.pageFns; }

  _welcome() {
    return `<h1>Welcome to <b>Form</b>Flow</h1>
      <p class="lead">Build 3D scenes with your hands. Pick a shape, pinch in the air, drag to size it — then orbit, move and export it.</p>
      <div class="three"><div><span class="big">✋</span><b>No mouse needed</b><small>Your webcam tracks both hands in the browser, on your GPU. It works for a laptop camera and for a camera across the room feeding a projector.</small></div>
      <div><span class="big">🧊</span><b>Real 3D objects</b><small>Cubes, spheres, cylinders, cones, pyramids, your own OBJ / STL models, or a solid built from Front / Side / Top outlines or photos (3-Plane Hull).</small></div>
      <div><span class="big">⌨</span><b>Hands + shortcuts</b><small>Hand gestures do the drawing; buttons and keyboard shortcuts cover everything else. The mouse works too.</small></div></div>
      <p class="fine">This takes about a minute. You choose which hand draws, then finish with a quick test that your camera tracking works.</p>`;
  }

  _roles() {
    const s = this.getSettings();
    const drawHand = handName('draw', s.dominant), navHand = handName('nav', s.dominant);
    return `<h2>Your two hands</h2>
      <p class="lead">FormFlow tracks at most two hands — yours. Anyone standing behind you is ignored. <b>Which hand do you want to draw with?</b></p>
      ${seg('dominant', HAND_OPTIONS, s.dominant)}
      <div class="roles">
        <div class="role" style="--c:${CYAN}">${svg(handSvg('open', CYAN, 70, 0), 200)}<h3>Cyan = Drawing hand</h3><small>Your <b>${drawHand}</b></small>
          <ul><li><b>Pinch</b> thumb + index → draw and place shapes</li><li><b>Pinch</b> thumb + middle → grab and move objects</li><li><b>Pinch</b> a button → press it</li></ul></div>
        <div class="role" style="--c:${MAGENTA}">${svg(handSvg('open', MAGENTA, 70, 0), 200)}<h3>Magenta = Navigation hand</h3><small>Your <b>${navHand}</b></small>
          <ul><li><b>Fist</b> + move → orbit the camera</li><li><b>Peace sign</b> + move → pan</li><li><b>Both hands pinched</b> → zoom</li></ul></div>
      </div>
      <p class="fine">You can change this any time in Settings (⚙) or by pressing <kbd>H</kbd>. Buttons never trigger by hovering: every selection is a deliberate pinch (or a click).</p>`;
  }

  _gestures() {
    return `<h2>Gesture index</h2>
      <div class="cards">${CARDS.map((c) => `<div class="card" style="--c:${c.color}">${c.art}<h3>${c.name}</h3><span class="who">${c.who}</span><small>${c.how}</small></div>`).join('')}</div>`;
  }

  _controls() {
    const s = this.getSettings();
    const who = (c) => {
      if (!c.hand) return '<span class="dim">—</span>';
      const cls = c.hand === 'draw' ? 'cyan' : c.hand === 'nav' ? 'magenta' : 'white';
      return `<span class="dot ${cls}"></span>${handName(c.hand, s.dominant)}`;
    };
    const row = (c) => `<tr><td><b>${c.action}</b></td><td class="who">${who(c)}</td><td>${c.gesture || '<span class="dim">—</span>'}</td>
      <td>${c.key ? `<kbd>${c.key}</kbd>` : '<span class="dim">—</span>'}</td><td>${c.button || '<span class="dim">—</span>'}</td></tr>`;
    return `<h2>Every action, and how to do it</h2>
      <p class="lead small"><span class="dot cyan"></span><b>${handName('draw', s.dominant)}</b> draws &nbsp; <span class="dot magenta"></span><b>${handName('nav', s.dominant)}</b> navigates.</p>
      <div class="tablewrap"><table class="controls"><thead><tr><th>Action</th><th>Hand</th><th>Gesture</th><th>Key</th><th>Button</th></tr></thead>
      <tbody>${CONTROLS.map(row).join('')}</tbody></table></div>`;
  }

  _practice() {
    const s = this.getSettings();
    return `<div class="practice"><h2>Practice</h2>
      <p class="lead">Let’s check that tracking works. Your camera is behind this window — your hand should light up in colour.</p>
      <div class="tstate"></div>
      <div class="distance"><b>How far is the camera from you?</b>${seg('range', RANGE_OPTIONS, s.range)}<small class="rangehelp">${RANGE_HELP[s.range]}</small></div>
      <ul class="checks">${PRACTICE.map(([k, l, h]) => ring(k, l, h)).join('')}</ul>
      <div class="actions"><button data-a="enter" class="primary big" disabled>Enter workspace</button>
      <button data-a="mouse" class="ghost">No camera? Continue with mouse</button></div>
      <p class="fine calnote"></p></div>`;
  }

  show() {
    this.visible = true;
    this.root.classList.add('open');
    this.go(0);
  }

  hide() { this.visible = false; this.root.classList.remove('open'); }

  /** Re-draw the current page (a setting changed) without losing practice progress. */
  refresh() {
    if (!this.visible) return;
    this.pagesEl.innerHTML = this.pageFns[this.page]();
    this._renderPractice();
  }

  go(i) {
    this.page = Math.max(0, Math.min(this.pageFns.length - 1, i));
    this.pagesEl.innerHTML = this.pageFns[this.page]();
    this.root.classList.toggle('on-practice', this.page === this.pageFns.length - 1);
    this.root.classList.toggle('wide', this.page === 3);
    this.dotsEl.querySelectorAll('button').forEach((d, k) => { d.classList.toggle('on', k === this.page); d.setAttribute('aria-current', k === this.page ? 'step' : 'false'); });
    this.root.querySelector('[data-a=back]').style.visibility = this.page ? 'visible' : 'hidden';
    const last = this.page === this.pageFns.length - 1;
    this.root.querySelector('[data-a=next]').style.display = last ? 'none' : '';
    this._renderPractice();
  }

  get practiceActive() { return this.visible && this.page === this.pageFns.length - 1; }

  setTracker(state, msg) { this.tracker = { state, msg }; this._renderPractice(); }

  /** Called every frame with the main (or only) hand's reading while the practice page is open. */
  feed(reading, now) {
    if (!this.practiceActive) return;
    this.practice.feed(reading, now);
    this._renderPractice();
  }

  _renderPractice() {
    if (!this.practiceActive) return;
    const r = this.root;
    const t = r.querySelector('.tstate');
    if (t) {
      t.dataset.state = this.tracker.state;
      t.textContent = this.tracker.state === 'ready'
        ? (this.practice.done.hand ? 'Hand tracking is working' : 'Camera ready. Show your hand.') : this.tracker.msg;
    }
    PRACTICE.forEach(([k]) => {
      const li = r.querySelector(`li[data-k=${k}]`);
      if (!li) return;
      const p = k === 'hand' ? (this.practice.done.hand ? 1 : 0) : this.practice.progress(k);
      li.querySelector('.ring').style.setProperty('--p', p);
      li.classList.toggle('done', this.practice.done[k]);
    });
    const btn = r.querySelector('[data-a=enter]');
    if (btn) btn.disabled = !this.practice.ready;
    const note = r.querySelector('.calnote');
    if (note && this.practice.ready) note.textContent = this.practice.calibration() ? 'Pinch sensitivity tuned to your hand.' : 'Using default sensitivity.';
  }

  enter(mouseOnly) {
    this.hide();
    this.onEnter({ calibration: mouseOnly ? null : this.practice.calibration(), mouseOnly });
  }
}
