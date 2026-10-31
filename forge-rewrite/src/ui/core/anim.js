// U7 (ui-29): one way to run a timed change in the windows and the HUD, in place of a hand-rolled ticker loop or a
// guarded setTimeout in each file.

import { Ticker } from '../../../../forge-godot/runtime/pixi.js';

/**
 * Steps `frame(t)`, t from 0 to 1 over `ms` of ticker time, then calls `done`. `frame(0)` runs at once. It stops early,
 * without `done`, when `node` is destroyed or the returned stop() is called. `reduced` (kit.reduced, Options Motion)
 * jumps straight to the end: frame(1), then done.
 */
export function animate(ms, frame, { done, node, reduced = false, ticker = Ticker.shared } = {}) {
  if (reduced) { frame(1); done?.(); return () => {}; }
  let spent = 0, live = true;
  const stop = () => { if (live) { live = false; ticker.remove(step); } };
  const step = tk => {
    if (node?.destroyed) return stop();
    spent += tk.deltaMS;
    const t = Math.min(1, spent / ms);
    frame(t);
    if (t >= 1) { stop(); done?.(); }
  };
  frame(0);
  ticker.add(step);
  return stop;
}

/** Runs `fn` once after `ms`, unless `node` is destroyed first. Returns a cancel. */
export function after(ms, fn, node) {
  const id = setTimeout(() => { if (!node?.destroyed) fn(); }, ms);
  return () => clearTimeout(id);
}
