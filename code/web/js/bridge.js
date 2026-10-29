// WebSocket bridge to the Python server: saves exports to disk and keeps the calibration. The app works without it.
export class Bridge {
  constructor(onState = () => {}, onMessage = () => {}) {
    this.onState = onState;
    this.onMessage = onMessage;
    this.ws = null;
    this.online = false;
    this.retry = 1000;
    this.pending = new Map();
    this._connect();
  }

  _connect() {
    if (location.protocol === 'file:') return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    try { this.ws = new WebSocket(url); } catch { return; }
    this.ws.onopen = () => { this.online = true; this.retry = 1000; this.onState(true); this.send('hello', {}); };
    this.ws.onclose = () => {
      this.online = false;
      this.onState(false);
      setTimeout(() => this._connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15000);
    };
    this.ws.onerror = () => {};
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.onMessage(m);
    };
  }

  send(type, payload = {}) {
    if (!this.online) return false;
    this.ws.send(JSON.stringify({ type, ...payload }));
    return true;
  }
}

export function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
