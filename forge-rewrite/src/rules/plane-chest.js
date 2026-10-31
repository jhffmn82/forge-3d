// The rune chest in a plane's treasure grotto (spec/planes.md rules 110-111; data/planes.json plane-rune-chest),
// 1.7's openPlaneChest (js/world/planes/portals.js:220-231 @3c8b312): 2 gear pieces made uncursed, raised to at
// least +0 then +1 (cap +3), weapons and armour enchanted with the plane's element; 2 motes and a third on a coin;
// essence 80-120, scaled once at pickup (ruled 2026-10-15, answer 6). Each lands on a free cell within 2.
// Play rules, so it lives in rules (consolidation C3, world-19; was world/planes/chest.js).

import planes from '../../data/planes.json' with { type: 'json' };
import propsData from '../../data/props.json' with { type: 'json' };
import { next } from '../lib/rng.js';
import { T, walkable } from '../data/tiles.js';
import { randomGear } from './loot.js';

const C = planes.rows['plane-rune-chest'];

/** The plane's title: "the Plane of Fire". */
export const planeTitle = el => planes.rows['plane-' + el]?.name ?? 'the Plane of ' + el;

/**
 * Opens a plane chest: the tile becomes floor, the loot spills around it, and the log names the plane.
 * @param {any} state @param {{x:number,y:number,kind:string,plane:string,open?:boolean}} chest @param {any[]} events
 */
export function openPlaneChest(state, chest, events) {
  if (!chest || chest.open) return false;
  const f = state.floor, el = chest.plane ?? f.plane, floorNo = f.hostFloor ?? state.floorNo, rng = state.rng;
  chest.open = true;
  f.tiles[chest.y * f.w + chest.x] = T.FLOOR;
  const loot = [];
  for (let g = 0; g < C.gear.count; g++) {
    const it = randomGear(state, floorNo);
    if (it.cursed) { it.cursed = false; it.plus = Math.max(C.gear.minPlus, it.plus); }
    it.plus = Math.min(C.gear.plusCap, Math.max(C.gear.minPlus, it.plus ?? 0) + C.gear.plusAdd);
    if (it.kind === 'weapon' || it.kind === 'armour') it.enchant = el;
    loot.push(it);
  }
  const motes = 2 + (next(rng) < 0.5 ? 1 : 0);
  for (let i = 0; i < motes; i++) loot.push({ kind: 'mote', el });
  loot.push({ kind: 'essence', n: Math.round(80 + next(rng) * 40) });
  // 1.7 nearFree: walkable, no blocking prop, no body, never the centre cell; a pick on the play stream.
  const blocks = (x, y) => f.props.some(p => p.x === x && p.y === y && (p.blocks || propsData.rows[p.id]?.blocks));
  const body = (x, y) => (state.order ?? []).some(id => { const a = state.actors[id]; return a && a.hp > 0 && a.x === x && a.y === y; });
  for (const it of loot) {
    const c = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = chest.x + dx, y = chest.y + dy;
      if ((dx || dy) && walkable(f, x, y) && !blocks(x, y) && !body(x, y)) c.push({ x, y });
    }
    const at = c.length ? c[Math.floor(next(rng) * c.length)] : { x: chest.x, y: chest.y };
    f.items.push({ x: at.x, y: at.y, item: it });
  }
  events.push({ type: 'chest', at: { x: chest.x, y: chest.y }, n: loot.length, sfx: C.sfx, sparkle: C.sparkle },
    { type: 'log', words: C.log.replace('{planeTitle}', planeTitle(el)), tone: 'kill' });
  return true;
}
