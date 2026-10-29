// "Join these lines?" prompt. It is a normal HUD element, so a pinch over a button presses it (and so does the mouse),
// and Y / N on the keyboard answers it. It never blocks drawing: starting a new stroke simply dismisses it.
export class JoinPrompt {
  /** onAnswer('yes' | 'no' | 'all') */
  constructor(parent, onAnswer, { timeout = 14000, onExpire = () => {} } = {}) {
    this.onAnswer = onAnswer;
    this.onExpire = onExpire; // called when the prompt times out unanswered
    this.timeout = timeout;
    this.timer = 0;
    this.el = document.createElement('div');
    this.el.className = 'hudzone joinprompt';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="q"><b></b><small></small></div>
      <div class="row"><button type="button" class="primary" data-ans="yes"></button>
      <button type="button" class="ghost" data-ans="no"></button>
      <button type="button" class="ghost" data-ans="all">Stitch all nearby</button></div>`;
    parent.append(this.el);
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ans]');
      if (b) this.onAnswer(b.dataset.ans);
    });
  }

  get open() { return !this.el.hidden; }

  show({ title, detail, yes, no, all = true }) {
    this.el.querySelector('b').textContent = title;
    this.el.querySelector('small').textContent = detail;
    this.el.querySelector('[data-ans=yes]').textContent = yes;
    this.el.querySelector('[data-ans=no]').textContent = no;
    this.el.querySelector('[data-ans=all]').hidden = !all;
    this.el.hidden = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.hide(); this.onExpire(); }, this.timeout);
  }

  hide() {
    clearTimeout(this.timer);
    this.el.hidden = true;
  }
}
