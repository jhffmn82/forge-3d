// Keyboard and gamepad focus over the controls a screen registered (kit.hooks.controls).
// Arrows and the d-pad move to the nearest control that way; confirm acts. Focus shows as a filled block.

import { Graphics } from '../../../../forge-godot/runtime/pixi.js';
import { color } from './widgets.js';
import { boundsIn } from './layout.js';

const DIR = { 'move-n': [0, -1], 'move-s': [0, 1], 'move-w': [-1, 0], 'move-e': [1, 0] };

/** @param {{hooks:{controls:{node:any, act:()=>void}[]}}} kit @param {import('../../../../forge-godot/runtime/pixi.js').Container} layer where the fallback mark is drawn */
export function createFocus(kit, layer) {
  let current = null;
  const mark = new Graphics();
  mark.eventMode = 'none';

  const shown = n => { for (; n; n = n.parent) if (n.destroyed || !n.visible) return false; return true; };
  const live = () => kit.hooks.controls.filter(c => c.node.parent && shown(c.node));
  const centre = n => { const b = n.getBounds(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

  function set(c) {
    if (current?.node.setFocus && !current.node.destroyed) current.node.setFocus(false);
    mark.clear();
    current = c;
    if (!c) return;
    if (c.node.setFocus) { c.node.setFocus(true); return; }
    const r = boundsIn(c.node, layer);
    mark.rect(r.x, r.y, r.w, r.h).fill({ color: color.ink, alpha: 0.12 });
    if (!mark.parent) layer.addChild(mark);
  }

  return {
    /** Handles a named action; returns true when focus used it. */
    action(name) {
      const list = live();
      if (!list.length) return false;
      if (name === 'confirm') { if (!current) return false; current.act(); return true; }
      const d = DIR[name];
      if (!d) return false;
      if (!current || !list.includes(current)) { set(list[0]); return true; }
      const from = centre(current.node);
      let best = null, bestScore = Infinity;
      for (const c of list) {
        if (c === current) continue;
        const p = centre(c.node), dx = p.x - from.x, dy = p.y - from.y;
        const along = dx * d[0] + dy * d[1];
        if (along <= 1) continue;
        const across = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
        const score = along + across * 2;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (best) set(best);
      return true;
    },
    clear() { set(null); },
    get current() { return current; },
    destroy() { mark.destroy(); current = null; },
  };
}
