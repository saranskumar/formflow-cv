// A small live read-out of what the hand detector is doing. Press D (or open the page with ?debug) when tracking looks
// wrong: it shows how often the raw detector is glitching and what the tracker did about it.
const ms = (v) => (v ? v.toFixed(1) : '–');
const WHY = { js: 'busy: the page itself is the limit', gpu: 'the graphics card or screen is the limit', ok: 'smooth' };
const NAMES = { detect: 'hand detection', pose: 'arm model', light: 'light correction', draw: '3D drawing' };

/** Where the time of a frame goes, so "it feels laggy" becomes a number. */
function perfRow(p) {
  if (!p || !p.frame) return '';
  const lvl = p.level ? ` · quality lowered (level ${p.level}: ${p.quality.pixelRatio}× resolution${p.quality.detectEvery > 1 ? ', detection every other frame' : ''})` : '';
  return `<div class="row"><b>Frame time</b><span>${p.fps.toFixed(0)} fps (${ms(p.frame)} ms, worst ${ms(p.worst)}) · ${WHY[p.bound]}${lvl}</span></div>
      <div class="row"><b>Per run</b><span>detect ${ms(p.detect)} · arm ${ms(p.pose)} · light ${ms(p.light)} · draw ${ms(p.draw)} ms${p.heaviest ? ` · heaviest: ${NAMES[p.heaviest]}` : ''}</span></div>`;
}

/** One line about what the camera really delivers and which of its own controls could be used. */
function cameraLine(c) {
  if (!c) return 'not started';
  const size = c.width ? `${c.width}×${c.height}` : '';
  const fps = c.frameRate ? `${Math.round(c.frameRate)} fps` : '';
  const comp = c.controls.includes('exposureCompensation') ? `exposure ${c.comp >= 0 ? '+' : ''}${c.comp.toFixed(1)} EV` : 'no exposure control';
  return [size, fps, comp].filter(Boolean).join(' · ');
}

export class Diagnostics {
  constructor(parent, { onSave } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'hudzone diagnostics';
    this.el.hidden = true;
    parent.append(this.el);
    // the panel is redrawn four times a second, which would swallow a click whose button is replaced between press and release
    this.el.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-act="save"]') && onSave) onSave(); });
  }

  get open() { return !this.el.hidden; }
  toggle() { this.el.hidden = !this.el.hidden; }

  /** info: { inferFps, mode, crop, stats, hands: {main, second}, labels: {main, second}, dominant } */
  update(info) {
    if (!this.open) return;
    const s = info.stats;
    const per = (role, title) => {
      const h = info.hands[role];
      if (!h) return `<div class="row off"><b>${title}</b><span>not tracked</span></div>`;
      const r = h.reading;
      const pose = r.fist ? 'fist' : r.peace ? 'peace' : r.pinch ? 'pinch' : r.grab ? 'grab' : r.point ? 'point' : 'open';
      return `<div class="row"><b>${title}</b><span>${h.held ? '<i class="warn">held (missed this frame)</i> · ' : ''}${pose} · palm ${r.palm.toFixed(3)} · pinch ratio ${r.rI.toFixed(2)} · ${r.world ? '3D ✓' : '2D only'} · label ${h.label || '?'}</span></div>`;
    };
    const per1 = (n) => (s.frames ? (n / s.frames).toFixed(2) : '0');
    this.el.innerHTML = `<div class="head"><b>Hand detection</b><span>press D to hide</span></div>
      <div class="row"><b>Detector</b><span>${info.inferFps.toFixed(0)} fps · ${info.mode}${info.crop ? ` · crop ${info.crop}` : ''}</span></div>
      ${perfRow(info.perf)}
      <div class="row"><b>Light correction</b><span>${info.light || 'off'}</span></div>
      <div class="row"><b>Conditions</b><span>${info.conditions || 'none'}</span></div>
      <div class="row"><b>Camera</b><span>${cameraLine(info.camera)}</span></div>
      <div class="row"><b>Hand tracked (3 s)</b><span>${info.rate == null ? '—' : `${Math.round(info.rate * 100)}% of frames`} · <button data-act="save" type="button">Save log</button></span></div>
      <div class="row"><b>Forearm</b><span>${info.forearm || 'off'}</span></div>
      <div class="row"><b>Raw hands / frame</b><span>${per1(s.seen)} seen</span></div>
      ${per('main', `Draw hand (${info.dominant})`)}${per('second', `Nav hand`)}
      <div class="sub">What the tracker fixed so far</div>
      <div class="grid">
        <span>duplicate ghosts removed</span><b>${s.ghosts}</b>
        <span>left/right label flips ignored</span><b>${s.flipsIgnored}</b>
        <span>false hands rejected</span><b>${s.blips}</b>
        <span>low-confidence second hands</span><b>${s.lowScore}</b>
        <span>too-small hands ignored</span><b>${s.tooSmall}</b>
        <span>frames bridged (dropouts)</span><b>${s.held}</b>
        <span>hands lost</span><b>${s.released}</b>
        <span>role swaps</span><b>${s.swaps}</b>
        <span>dropouts bridged by the arm</span><b>${s.armBridged}</b>
        <span>hands accepted sooner (arm)</span><b>${s.armBoost}</b>
      </div>`;
  }
}
