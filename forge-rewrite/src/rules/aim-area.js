// Sandbox E3 (Justin 2026-10-16, "e3 yes"): while aiming, the tiles a spell would strike from the hero at `tile`, read
// from the ability's own effect selectors (Fireball's 5 x 5, Frost Cone's cone, Radiant Beam's 3-wide line, Chain
// Lightning's likely jumps, Earthquake's radius, Upheaval's ridge and blast). Pure: works out tiles, changes nothing.

import { abilityRow, aimRange } from './abilities.js';
import { ridgeTiles, selectorTiles } from './effects/select.js';

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Every effect in the list and its then / else / options, flattened. */
function effectsOf(list, out = []) {
  for (const e of list ?? []) { out.push(e); effectsOf(e.then, out); effectsOf(e.else, out); for (const o of e.options ?? []) { effectsOf(o.effects, out); effectsOf(o.else, out); } }
  return out;
}

/** The struck tiles, unique, for ability `id` aimed at `tile` (null for a self ability). */
export function aimArea(state, id, tile) {
  const row = abilityRow(id), p = state.actors[state.playerId], f = state.floor;
  if (!row || !p) return [];
  const at = tile ?? p, seen = new Set(), out = [];
  const add = (x, y) => { const k = y * f.w + x; if (x >= 0 && y >= 0 && x < f.w && y < f.h && !seen.has(k)) { seen.add(k); out.push({ x, y }); } };
  const square = (c, n) => { for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) add(c.x + dx, c.y + dy); };
  let ridge = null;
  for (const e of effectsOf(row.effects)) {
    const sel = e.target ?? (e.verb === 'field' ? e.shape : null) ?? (e.verb === 'terrain' ? e.where : null);
    if (e.verb === 'terrain' && e.where?.selector === 'wall-across') { ridge = ridgeTiles(state, p, at, e.where.length ?? 7); ridge.forEach(t => add(t.x, t.y)); continue; }
    if (e.verb === 'summon') { square(at, e.within ?? 1); continue; }
    if (!sel) continue;
    if (sel.selector === 'radius' && sel.of) { for (const t of ridge ?? []) square(t, sel.n); continue; }
    const area = selectorTiles(state, sel, { owner: p, at, len: aimRange(state.hero, row) });   // C8: the spell's own tiles
    if (area) area.forEach(t => add(t.x, t.y));
    else if (sel.selector === 'all-visible') for (const id2 of state.order) { const a = state.actors[id2]; if (a.hp > 0 && a.side === 'foe' && state.vis?.[a.y * f.w + a.x]) add(a.x, a.y); }
    else if (sel.selector === 'chain') {
      // The likely jumps: from the aimed foe, the nearest seen foe not yet struck within range, as the spell picks.
      const foes = state.order.map(i => state.actors[i]).filter(a => a.hp > 0 && a.side === 'foe' && state.vis?.[a.y * f.w + a.x]);
      let cur = foes.find(a => a.x === at.x && a.y === at.y);
      const hit = [];
      while (cur && hit.length <= (sel.jumps ?? 4)) {
        hit.push(cur); add(cur.x, cur.y);
        const last = cur;
        cur = foes.filter(a => !hit.includes(a) && cheb(a, last) <= (sel.range ?? 4)).sort((a, b) => cheb(a, last) - cheb(b, last))[0];
      }
    }
  }
  // RB36 (1.7 targeting-cues.js:51-61): how each tile is drawn (look): Upheaval's rocks as walls; Glacial Tomb's body
  // (the creature at the tile, else the tile) as the tomb, the burst round it as ice; any other as the plain area.
  const rock = new Set((ridge ?? []).map(t => t.y * f.w + t.x)), inside = (b, c) => c.x >= b.x && c.y >= b.y && c.x < b.x + (b.size ?? 1) && c.y < b.y + (b.size ?? 1);
  const tomb = row.aim?.kind === 'foe-or-self' ? (state.order.map(i => state.actors[i]).find(a => a?.hp > 0 && inside(a, at)) ?? { x: at.x, y: at.y }) : null;
  for (const c of out) {
    if (rock.has(c.y * f.w + c.x)) c.look = 'wall';
    else if (tomb) c.look = inside(tomb, c) ? 'tomb' : 'ice';
  }
  return out;
}
