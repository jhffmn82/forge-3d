// A hotbar slot's cooldown face (consolidation H6, ui-24: out of hotbar.js): the grey and the lift on its icon, the clock
// sweep, the ready ring, and how much of each slot's cooldown is still to run.

import { ColorMatrixFilter } from '../../../../forge-godot/runtime/pixi.js';
import abilities from '../../../data/abilities.json' with { type: 'json' };

// RB37 (1.7 ui-adapter.js:16-56, hud.js:45-50): a slot on cooldown greys its icon (grayscale, brightness .45), lays a
// dark clock sweep (black .62) over the part still to run from twelve o'clock, and flashes once when ready again: a
// 2 px #ffe08a ring and a 12 px warm glow fading over 0.7 s. Each cooldown's longest time left is its length, kept
// per hero, so the sweep works for abilities, prayers and invokes alike.
const CD_SPAN = new WeakMap();
// H24 (1.7 hud.js:113-116 HOTBAR_ICON_EXPOSURE, interface.css:79-80): the dark shadow icons are lifted brighter in
// their slot, on cooldown as well (brightness first, then the grey), and every icon stands on a soft 1 px shadow.
export const EXPOSURE = { 'ic-into-the-dark': 2, 'ic-shadow-swarm': 1.6, 'ic-shadowstep': 1.4, 'ic-umbral-passage': 1.3, 'ic-shadow-bolt': 1.15 };
const greyFilters = new Map(), liftFilters = new Map();
export const grey = (k = 1) => {
  if (!greyFilters.has(k)) { const f = new ColorMatrixFilter(); f.desaturate(); f.brightness(0.45 * k, true); greyFilters.set(k, f); }
  return greyFilters.get(k);
};
export const lifted = k => {
  if (!liftFilters.has(k)) { const f = new ColorMatrixFilter(); f.brightness(k, false); liftFilters.set(k, f); }
  return liftFilters.get(k);
};
/** The points of the sweep: the slot's centre, then its rounded edge from twelve o'clock clockwise through frac of a turn. */
export function sweepPoints(w, h, frac, r = 6) {
  const cx = w / 2, cy = h / 2, out = [cx, cy], steps = Math.max(2, Math.ceil(frac * 96));
  for (let k = 0; k <= steps; k++) {
    const a = -Math.PI / 2 + (frac * Math.PI * 2 * k) / steps, dx = Math.cos(a), dy = Math.sin(a);
    const t = Math.min(dx ? (dx > 0 ? w - cx : -cx) / dx : Infinity, dy ? (dy > 0 ? h - cy : -cy) / dy : Infinity);
    let x = cx + dx * t, y = cy + dy * t;
    // inside a corner's square, onto its arc
    const ox = x < r ? r : x > w - r ? w - r : null, oy = y < r ? r : y > h - r ? h - r : null;
    if (ox !== null && oy !== null) { const d = Math.hypot(x - ox, y - oy) || 1; x = ox + ((x - ox) * r) / d; y = oy + ((y - oy) * r) / d; }
    out.push(Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y)));
  }
  return out;
}

/** RB37: the ready flash's ring on `g` (cleared first) round a w x h slot: 1.7's cdready gold ring and warm glow. */
export function readyRing(g, w, h) {
  g.clear();
  for (let k = 1; k <= 6; k++) g.roundRect(-k * 2 + 1, -k * 2 + 1, w + k * 4 - 2, h + k * 4 - 2, 6 + k * 2).stroke({ color: 0xffd26e, width: 2, alpha: 0.85 * (1 - k / 7) * 0.5 });
  g.roundRect(1, 1, w - 2, h - 2, 5).stroke({ color: 0xffe08a, width: 2 });
  g.visible = true;
  return g;
}

/**
 * RB37: each slot's share of its cooldown still to run, from the longest time left seen for that cooldown (kept per
 * hero). quiet: the slots whose flash must stop (cooling, or nothing that cools); ended: the slots whose cooldown just ended.
 */
export function cooldownFracs(hero, bar, views) {
  if (!hero || typeof hero !== 'object') return { fracs: [], quiet: [], ended: [] };
  const span = CD_SPAN.get(hero) ?? {}, quiet = [], ended = [];
  CD_SPAN.set(hero, span);
  const fracs = bar.map((e, i) => {
    const v = views[i];
    if (!e || !v || e.kind === 'item' || e.kind === 'ranged' || e.kind === 'amulet') { quiet.push(i); return 0; }
    const key = `${e.kind}:${e.id}`, was = span[key];
    if (v.left) {
      quiet.push(i);
      span[key] = Math.max(was ?? 0, v.left, e.kind === 'ability' ? abilities.rows[e.id]?.cooldown ?? 0 : 0);
      return v.left / span[key];
    }
    if (was) { delete span[key]; ended.push(i); }
    return 0;
  });
  return { fracs, quiet, ended };
}
