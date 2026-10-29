// Settings: which hand draws, how far you stand from the camera, detection sensitivity and reach calibration.
// The same segmented controls are reused in the onboarding guide, so the choice can be made before you start.
import { otherHand } from '../core/settings.js';

export const HAND_OPTIONS = [['Left', 'Left hand'], ['Right', 'Right hand']];
export const RANGE_OPTIONS = [['near', 'Near'], ['medium', 'Medium'], ['far', 'Far'], ['auto', 'Auto-follow']];
export const SENS_OPTIONS = [['normal', 'Normal'], ['high', 'High (small hands)']];

export const RANGE_HELP = {
  near: 'Laptop webcam, hands close to the camera.',
  medium: 'Webcam on a desk or tripod a few metres away.',
  far: 'Camera across the room (projector setup). Crops in on the middle of the picture.',
  auto: 'Zooms in on your hands wherever they are. Best for a far camera when you move around.',
};

/** HTML for a row of mutually exclusive buttons. */
export function seg(name, options, value) {
  return `<div class="seg" role="group" data-seg="${name}">${options.map(([v, label]) =>
    `<button type="button" class="${v === value ? 'on' : ''}" aria-pressed="${v === value}" data-set="${name}" data-v="${v}">${label}</button>`).join('')}</div>`;
}

/** Mark one button of a segmented control as the chosen one. */
export function markSeg(btn) {
  btn.parentElement.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b === btn);
    b.setAttribute('aria-pressed', String(b === btn));
  });
}

export class SettingsPanel {
  /** api: { get(): settings, set(key, value), reach(), resetReach(), close() } */
  constructor(parent, api) {
    this.api = api;
    this.el = document.createElement('div');
    this.el.className = 'hudzone settings';
    this.el.hidden = true;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.set) api.set(b.dataset.set, b.dataset.v);
      else if (b.dataset.act === 'reach') api.reach();
      else if (b.dataset.act === 'resetReach') api.resetReach();
      else if (b.dataset.act === 'close') this.close();
    });
    this.render();
  }

  get open() { return !this.el.hidden; }
  show() { this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; }
  toggle() { this.el.hidden ? this.show() : this.close(); }

  render() {
    const s = this.api.get();
    const nav = otherHand(s.dominant);
    this.el.innerHTML = `
      <div class="head"><b>Settings</b><button type="button" class="x" data-act="close" aria-label="Close">✕</button></div>
      <section><h4>Drawing hand</h4>
        ${seg('dominant', HAND_OPTIONS, s.dominant)}
        <p class="help"><span class="dot cyan"></span><b>${s.dominant} hand</b> draws, places and grabs.
        <span class="dot magenta"></span><b>${nav} hand</b> orbits, pans and zooms.</p></section>
      <section><h4>Distance from the camera</h4>
        ${seg('range', RANGE_OPTIONS, s.range)}
        <p class="help">${RANGE_HELP[s.range]}</p></section>
      <section><h4>Hand detection</h4>
        ${seg('sensitivity', SENS_OPTIONS, s.sensitivity)}
        <p class="help">High sensitivity finds smaller, fainter hands but may pick up more false hands.</p></section>
      <section><h4>Light correction</h4>
        ${seg('light', [['true', 'Auto'], ['false', 'Off']], String(s.light))}
        <p class="help">Brightens the picture the hand detector sees when your hand is dark: a window or lamp behind you, or a dim room.</p></section>
      <section><h4>Forearm tracking</h4>
        ${seg('forearm', [['true', 'On'], ['false', 'Off']], String(s.forearm))}
        <p class="help">Also follows your wrist and elbow, so a small, far or briefly hidden hand is kept and found again. Turn off if the frame rate drops.</p></section>
      <section><h4>Joining lines</h4>
        ${seg('askJoin', [['true', 'Ask me'], ['false', 'Never ask']], String(s.askJoin))}
        <p class="help">After a freehand line, offer to close the loop or join it to a nearby line.</p></section>
      <section><h4>Reach area</h4>
        <p class="help">${s.region ? 'Custom: your hands cover the whole screen from the area you showed.' : 'Using the preset for your distance.'}
        Show the camera the top-left and bottom-right of your working area (for a projector: the projected surface).</p>
        <div class="row"><button type="button" class="primary" data-act="reach">Calibrate reach</button>
        <button type="button" class="ghost" data-act="resetReach" ${s.region ? '' : 'disabled'}>Reset</button></div></section>
      <button type="button" class="done" data-act="close">Done</button>`;
  }
}
