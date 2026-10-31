// The cells an effect may land on (consolidation C17, moved from select.js: conditions.js reads them too): a prop that
// blocks, a body on a tile, the open cells of the floor's rooms (safe: away from foes, water and fire, none in a fight).

import props from '../../../data/props.json' with { type: 'json' };
import { walkable, tileAt, T } from '../../data/tiles.js';
import { realmAllows } from '../crucible.js';
import { fieldAt } from '../fields.js';

const propsRows = props.rows;
export const isBlocking = p => p.blocks || propsRows[p.id]?.blocks;
export const bodyOn = (state, x, y) => state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && a.x === x && a.y === y; });

/**
 * Teleport random-safe's landing tiles: walkable, empty tiles in ordinary rooms (traps 86). RB46 (1.7 balance-rulings.js
 * safeWobbleSpots): `safe` also keeps off water and fire, never beside a living foe, and gives none while a boss fight is on.
 */
export function randomSafeCells(state, safe) {
  const f = state.floor, cells = [];
  const inPocket = new Set((f.rooms ?? []).filter(r => r.pocket).flatMap(r => { const o = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) o.push(y * f.w + x); return o; }));
  for (const r of f.rooms ?? []) {
    if (r.special || r.pocket || r.puzzle) continue;
    // A cave room's own cells (Caverns, Underdark); its box may hold a pocket.
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if ((r.cells && !r.cells.includes(y * f.w + x)) || inPocket.has(y * f.w + x)) continue;
      if (!walkable(f, x, y) || f.props?.some(p => p.x === x && p.y === y && isBlocking(p)) || bodyOn(state, x, y) || !realmAllows(state, null, x, y)) continue;   // CH28
      cells.push({ x, y });
    }
  }
  if (safe) {
    const fighting = state.order.some(id => { const a = state.actors[id]; return a?.boss && a.hp > 0 && a.hunting; });
    const foes = state.order.map(id => state.actors[id]).filter(a => a?.side === 'foe' && a.hp > 0);
    const ok = t => tileAt(f, t.x, t.y) !== T.WATER && !fieldAt(state, t.x, t.y, 'fire') && !foes.some(a => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y)) <= 1);
    cells.splice(0, cells.length, ...(fighting ? [] : cells.filter(ok)));
  }
  return cells;
}
