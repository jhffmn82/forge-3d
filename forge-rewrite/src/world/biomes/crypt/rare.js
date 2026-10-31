// The Crypt's unique rare rooms (spec/world.md R6, rules 68-69 and 72; rooms.json bone-gauntlet, hungry-spider): each
// lands on one Crypt floor in 5% of runs (src/world/rare.js uniqueRareKind) and takes the first special's room.
// Built through the registry's `specials` hook (crypt/specials.js). Draws only from the generation stream.

import rooms from '../../../../data/rooms.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { makeCreature } from '../../../rules/monsters.js';
import { T, G } from '../../../data/tiles.js';
import { buildSpecial } from '../../specials.js';
import { propBlocks } from '../../../data/props.js';

const R = rooms.rows, D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Rule 69: a 5 by 5 pocket off the host behind an ordinary door: bones on every cell, hidden spikes on the three rows
 * after the first, an enhanced gold chest in the middle of the far row; opening it raises two shades beside it and
 * two acolytes by the door (the four posts). No pocket: the host becomes a storage room.
 */
function boneGauntlet(gen, floor, rooms_, host, out, { carvePocket }) {
  const pk = carvePocket(gen.rng, floor, rooms_, 5, 5, 5, 5, h => h !== host);
  if (!pk) { host.special = 'storage'; return buildSpecial('storage', gen, floor, rooms_, host, out, { carvePocket }); }
  const W = floor.w, r = pk.room, A = R['bone-gauntlet'];
  floor.tiles[pk.door.y * W + pk.door.x] = T.DOOR;
  r.special = 'bone-gauntlet'; r.rareEvent = true;
  host.special = host.special ?? 'gauntlet-host';   // the host stays used; it is dressed plainly (ruling 29)
  // Depth runs away from the door (row 0 beside it), across along the door's wall.
  const horizontal = pk.door.x < r.x || pk.door.x >= r.x + r.w;
  const forward = horizontal ? (pk.door.x < r.x ? 1 : -1) : (pk.door.y < r.y ? 1 : -1);
  const cell = (depth, across) => horizontal ? { x: forward > 0 ? r.x + depth : r.x + r.w - 1 - depth, y: r.y + across } : { x: r.x + across, y: forward > 0 ? r.y + depth : r.y + r.h - 1 - depth };
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) floor.ground[y * W + x] = G.BONES;
  floor.traps ??= [];
  for (let depth = 1; depth <= 3; depth++) for (let across = 0; across < 5; across++) { const c = cell(depth, across); floor.traps.push({ x: c.x, y: c.y, kind: 'spikes', found: false, room: true }); }
  const c = cell(4, 2);
  floor.tiles[c.y * W + c.x] = T.CHEST;
  floor.chests.push({ x: c.x, y: c.y, kind: 'gold', table: 'chest-enhanced', art: 'chest-ornate',
    ambush: { kinds: A.ambush.roster.slice(), posts: [cell(4, 0), cell(4, 4), cell(0, 0), cell(0, 4)], room: { x: r.x, y: r.y, w: r.w, h: r.h }, log: A.ambush.log } });
  return true;
}

/**
 * Rule 72: web on every cell of the host and a neutral Hungry Web Spitter (no loot, no XP) on its deepest free cell.
 * It speaks when first seen, can be fed a ration to follow the hero, and turns hostile when harmed (rules/crypt.js).
 */
function hungrySpider(gen, floor, rooms_, host, out) {
  const W = floor.w, inside = (x, y) => x >= host.x && x < host.x + host.w && y >= host.y && y < host.y + host.h;
  const free = (x, y) => floor.tiles[y * W + x] === T.FLOOR && !floor.props.some(p => p.x === x && p.y === y) && !floor.items.some(i => i.x === x && i.y === y);
  const cells = [];
  for (let y = host.y; y < host.y + host.h; y++) for (let x = host.x; x < host.x + host.w; x++) if (floor.tiles[y * W + x] === T.FLOOR && !floor.props.some(p => p.x === x && p.y === y && propBlocks(p))) cells.push({ x, y });
  // Depth: walking steps from the room's mouths (cells beside an outside walkable tile or door).
  const mouths = cells.filter(c => D4.some(([dx, dy]) => !inside(c.x + dx, c.y + dy) && [T.FLOOR, T.DOOR, T.OPEN_DOOR, T.LOCKED, T.SECRET].includes(floor.tiles[(c.y + dy) * W + c.x + dx])));
  const depth = c => mouths.length ? Math.min(...mouths.map(m => Math.abs(m.x - c.x) + Math.abs(m.y - c.y))) : 0;
  const post = cells.filter(c => free(c.x, c.y)).sort((a, b) => depth(b) - depth(a))[0];
  if (!post) return false;
  host.special = 'hungry-spider'; host.rareEvent = true;
  for (const c of cells) floor.ground[c.y * W + c.x] = G.WEB;
  const m = makeCreature('webspitter', post.x, post.y);
  Object.assign(m, { name: 'Hungry Web Spitter', side: 'neutral', asleep: false, hunting: false, resident: true, noXp: true, drops: 'kill-none', noLoot: true,
    hungrySpider: { room: { x: host.x, y: host.y, w: host.w, h: host.h } } });
  out.push(m);
  return true;
}

export const CRYPT_RARE = { 'bone-gauntlet': boneGauntlet, 'hungry-spider': hungrySpider };
