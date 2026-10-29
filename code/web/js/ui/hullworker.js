// Runs buildHull in a Web Worker when the browser allows it (module workers need Chrome 80+ / Edge 80+ / Firefox 114+).
// build() resolves with the result, or with null when a newer request replaced this one before it finished.
import { buildHull, outlineData } from '../core/hull.js';

export class HullWorker {
  constructor() {
    this.id = 0;
    this.pending = new Map();
    this.worker = null;
    try {
      this.worker = new Worker(new URL('../core/hullWorker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._done(e.data.id, e.data.result);
      this.worker.onerror = () => this._fail();
    } catch { this.worker = null; }
  }

  get ok() { return !!this.worker; }

  _done(id, result) {
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    if (resolve) resolve(id === this.id ? result : null);
  }

  _fail() { // the worker cannot run here (blocked, or failed to load): fall back to building on the main thread
    for (const resolve of this.pending.values()) resolve(undefined);
    this.pending.clear();
    this.worker = null;
  }

  /** items: the scene's items. Returns a Promise of the result, null if superseded, or undefined if no worker (build it yourself). */
  build(items, opts) {
    if (!this.worker) return Promise.resolve(undefined);
    const id = ++this.id;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, outlines: outlineData(items), opts });
    });
  }
}

/** Build now, on this thread (used when there is no worker, and for the final shape). */
export const buildHere = (items, opts) => buildHull(items, opts);
