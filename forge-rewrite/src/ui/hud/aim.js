// Aim mode, as 1.7's targeted abilities work (casting-adapter.js): the first press of an ability that takes a
// target aims it and washes the tiles in range on the map; a bolt, chain, beam or tomb spell also picks the nearest
// foe it can hit (1.7 AUTO_AIM_KINDS) and a second press casts at it; a tap on the map casts at that tile; Esc,
// Cancel aim or a press with nothing picked ends it. Abilities that act on the hero alone (aim 'self') cast at
// once. The engine checks the target.

import gods from '../../../data/gods.json' with { type: 'json' };
import { litAt, seenAt, abilityRow, aimRange, aimArea, lanePath, amuletValues, itemRow, itemName, canShoot, boltPath } from '../../engine/reads.js';
import { cheb, covers, footprintGap } from '../../lib/geometry.js';

// RB35: 1.7's bolt spells (data.js kind 'bolt'), whose aim shows the flight path as dots (targeting-cues.js previewPath).
const BOLTS = new Set(['missile', 'sap', 'firebolt', 'frostshard', 'spark', 'root', 'smite', 'shadowbolt', 'arcanelance', 'bonespear']);
// AA1 (1.7 autoaim.js AUTO_AIM_KINDS bolt, chain, beam, tomb; casting-adapter.js:234, gods.js:544): only these pick a foe
// when aimed. Blast, cone, swarm, flame, quake, storm, upheaval, lunge and blink wait for a tap. Item 137 (Justin 2026-10-17:
// "double attack and charge needs to auto pick a target during targeting to allow for a double tap to attack just like
// how bows and spells work"): Charge and Double Strike pick too (aimFor), each by its own rule.
const AUTO_AIM = new Set([...BOLTS, 'chainbolt', 'radiantbeam', 'glacialtomb', 'lance']);

/**
 * RB33 (1.7 game.js actorMarkRect): the square a mark stands on around a creature's whole picture, in tiles: a big
 * body across its footprint at 0.98 of it times its bigScale, a tall one (art over 1) up from its feet; the hero
 * and anything drawn a tile or less keep the tile.
 * @returns {{x:number, y:number, w:number}}
 */
export function markRect(a, hero = false) {
  const n = Math.max(1, a.size ?? 1), big = n > 1;
  const drawn = hero ? 1 : big ? n * 0.98 * (a.look?.bigScale ?? 1) : (a.look?.art ?? 0.9);
  const side = Math.max(n, drawn);
  return { x: a.x + (n - side) / 2, y: a.y + n - side, w: side };
}

/** RB35: the dots of a bolt's flight from the hero to a tile, the last (the target's own) left out. */
export function boltDots(state, at) {
  const p = state?.actors?.[state.playerId];
  if (!p || !at) return [];
  return boltPath(state, p, at).slice(0, -1);
}

/**
 * EQ12 (1.7 rangedslot.js bowNextTarget): the foe the bow slot draws on next: those it can hit (a clear line, 2 to
 * the bow's range, in sight), nearest first and among equals the most hurt, the one after `current` in that order.
 */
export function bowNextTarget(state, current = null) {
  const p = state?.actors?.[state.playerId];
  if (!p) return null;
  const list = (state.order ?? []).map(id => state.actors[id]).filter(a => bowCanHit(state, a))
    .sort((a, b) => (cheb(p, a) - cheb(p, b)) || (a.hp / a.maxhp - b.hp / b.maxhp));
  if (!list.length) return null;
  return list[(list.findIndex(a => a.id === current) + 1) % list.length];
}

/** True when the bow can loose at this foe now (1.7 bowCanHit: in range, in sight and the arrow's line ends on it). */
export function bowCanHit(state, a) {
  if (!canShoot(state, a)) return false;
  const end = boltPath(state, state.actors[state.playerId], a).at(-1);
  return !!end && covers(a, end.x, end.y);
}

/**
 * AA1 (1.7 autoaim.js autoAimPoint): the cell of a foe's body an aim at it strikes, or null when none can be: the
 * cells in sight and in range, nearest first; a bolt takes the first whose flight from the hero ends on the body
 * (1.7 projectileLine), so a foe behind another body or a corner is not picked.
 */
export function autoAimPoint(state, a, range, bolt = false) {
  const p = state?.actors?.[state.playerId], f = state?.floor;
  if (!p || !a || !f) return null;
  const n = a.size ?? 1, cells = [];
  for (let y = a.y; y < a.y + n; y++) for (let x = a.x; x < a.x + n; x++) {
    if (litAt(state, x, y) && cheb({ x, y }, p) <= range) cells.push({ x, y });
  }
  cells.sort((c, d) => cheb(c, p) - cheb(d, p) || c.y - d.y || c.x - d.x);
  if (!bolt) return cells[0] ?? null;
  return cells.find(c => { const end = boltPath(state, p, c).at(-1); return end && end.x >= a.x && end.y >= a.y && end.x < a.x + n && end.y < a.y + n; }) ?? null;
}

/** AA1 (1.7 autoAimTarget): the foe an aim picks: one it can hit, nearest body first (1.7 dist), among equals the most hurt. */
export function autoAimTarget(state, range, bolt = false, ok = null) {
  const p = state.actors[state.playerId];
  let best = null, bd = Infinity;
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || a.hp <= 0 || a.side !== 'foe' || a.hidden) continue;
    const at = autoAimPoint(state, a, range, bolt);
    if (!at || (ok && !ok(a, at))) continue;
    const d = footprintGap(a, p);   // 1.7 FoteGeometry.bodyDistance
    if (d < bd || (d === bd && a.hp / (a.maxhp || 1) < best.hp / (best.maxhp || 1))) { best = a; bd = d; }
  }
  return best;
}

/**
 * EQ2 (1.7 amulets.js useAmulet, castAmuletTarget): the worn amulet's aim when it takes a target (the Hook, Exchange,
 * Tide, Pillar) and has a charge: the tiles in sight within its range, the nearest foe it can reach picked.
 */
function amuletAim(state) {
  const it = state?.hero?.worn?.amulet;
  if (!it || (it.charges ?? 0) < 1 || !itemRow(it.id).row.aim) return null;
  const p = state.actors[state.playerId], range = amuletValues(it).range ?? 8, tiles = [];
  for (let y = p.y - range; y <= p.y + range; y++) for (let x = p.x - range; x <= p.x + range; x++) {
    if ((x !== p.x || y !== p.y) && litAt(state, x, y)) tiles.push({ x, y });
  }
  const foe = autoAimTarget(state, range), name = itemName(it, state);
  return { name, range, tiles, target: foe ? { x: foe.x, y: foe.y } : null, hint: `${name}: choose a target.`, area: [], bolt: false, explored: false, mark: foe ? markRect(foe) : null, path: [] };
}

/** The ability a slot entry casts, by its row id (a Cleric's invoke is the god's invoke prayer). */
function rowOf(hero, entry) {
  if (entry?.kind === 'ability' && entry.id === 'invoke') return abilityRow(gods.rows[hero?.faith?.god ?? hero?.god]?.invoke);
  if (entry?.kind === 'ability' || entry?.kind === 'prayer') return abilityRow(entry.id);
  return null;
}

/** Item 137, Charge (D16, rules/abilities.js): the nearest foe within its range at the end of a clear straight lane (effects.js lanePath). */
export function chargeTarget(state, range) {
  const p = state.actors[state.playerId];
  return autoAimTarget(state, range, false, (a, at) => !!lanePath(state, p, at, false, range));
}

/** Item 137, Double Strike: the foe last attacked when it stands beside the hero, else the nearest beside it (rules/abilities.js). */
export function doubleTarget(state, range) {
  const last = state.actors[state.hero?.lastAttacked];
  if (last && last.hp > 0 && last.side === 'foe' && !last.hidden && autoAimPoint(state, last, range)) return last;
  return autoAimTarget(state, range);
}

/**
 * What aiming this entry looks like now, or null when it casts at once.
 * @returns {{name:string, range:number, tiles:{x:number,y:number}[], target:{x:number,y:number}|null, hint:string}|null}
 */
export function aimFor(state, entry) {
  if (entry?.kind === 'amulet') return amuletAim(state);
  const hero = state?.hero, row = rowOf(hero, entry), kind = row?.aim?.kind;
  if (!row || !kind || kind === 'self') return null;
  const p = state.actors[state.playerId], range = aimRange(hero, row), w = state.floor.w;
  const tiles = [];
  if (kind === 'explored-tile') {
    // RB34 (1.7 casting-adapter.js inRange 'umbral'): Umbral Passage reaches any explored ground, remembered or in sight.
    for (let y = 0; y < state.floor.h; y++) for (let x = 0; x < w; x++) {
      const lit = litAt(state, x, y);
      if ((x !== p.x || y !== p.y) && (lit || seenAt(state, x, y))) tiles.push(lit ? { x, y } : { x, y, remembered: true });
    }
  } else for (let y = p.y - range; y <= p.y + range; y++) for (let x = p.x - range; x <= p.x + range; x++) {
    if ((x !== p.x || y !== p.y) && litAt(state, x, y)) tiles.push({ x, y });
  }
  const id = entry.kind === 'ability' && entry.id === 'invoke' ? gods.rows[hero?.faith?.god ?? hero?.god]?.invoke : entry.id, bolt = BOLTS.has(id);
  // AA1 (1.7 autoaim.js autoAimTarget): the nearest foe it can actually hit, among equals the most hurt, aimed at
  // the cell of its body the spell reaches (autoAimPoint).
  // Only bolt, chain, beam and tomb spells pick one (AUTO_AIM); the rest open the aim with nothing picked.
  const foe = AUTO_AIM.has(id) ? autoAimTarget(state, range, bolt) : id === 'charge' ? chargeTarget(state, range) : id === 'double' ? doubleTarget(state, range) : null;
  // 1.7's words while aiming, said only when nothing is picked (the brackets say it then): Charge names its lane,
  // Glacial Tomb takes a creature or the hero, Umbral explored ground, Arcane Blink visible ground; the rest a target.
  const ask = { charge: `straight path, ${row.aim.range ?? range} tiles`,   // 1.7 casting-adapter.js:235 names the foe range (6), not the empty-ground limit
                glacialtomb: 'choose a creature or yourself', umbral: 'choose explored ground', arcaneblink: 'choose visible ground' }[id] ?? 'choose a target';
  const hint = foe ? null : `${row.name}: ${ask}.`;
  const target = foe ? autoAimPoint(state, foe, range, bolt) : null;
  // Sandbox E3: the tiles the spell would strike at that target. RB33: the mark frames the foe's whole picture;
  // RB35: a bolt's flight to it in dots (1.7 autoaim.js drawAutoAimOverlay).
  return { id, name: row.name, range, tiles, target, hint, area: target ? aimArea(state, id, target) : [], bolt, explored: kind === 'explored-tile',
    mark: foe ? markRect(foe) : null, path: foe && bolt ? boltDots(state, target) : [] };
}
