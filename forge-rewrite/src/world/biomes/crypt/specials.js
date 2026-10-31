// The Crypt's own special rooms (spec/world.md S22 heroes-tomb, S34 funeral-bell; rooms.json rows; the specials roll
// rules 6-7): built through the registry's `specials` hook from the shared roll (src/world/specials.js).
// Draws only from the generation stream.

import { next } from '../../../lib/rng.js';
import { giveOf } from '../../../rules/loot.js';
import { T, G } from '../../../data/tiles.js';
import { CRYPT_RARE } from './rare.js';
import { consecrated } from '../../fields.js';


/** S22: a 3x3 secret pocket off the host: a coffin at its heart, grave flowers round it, two rations, consecrated. */
function heroesTomb(gen, floor, rooms, host, out, { carvePocket }) {
  const pk = carvePocket(gen.rng, floor, rooms, 3, 3, 3, 3, h => h !== host);
  if (!pk) return false;
  const W = floor.w, r = pk.room;
  floor.tiles[pk.door.y * W + pk.door.x] = T.SECRET;
  floor.ground[pk.inside.y * W + pk.inside.x] = G.TELL;
  r.special = 'heroes-tomb'; r.rareEvent = true; r.consecrated = true;
  host.special = host.special ?? 'tomb-host';
  const cells = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    cells.push(y * W + x);
    if (x === r.cx && y === r.cy) floor.props.push({ id: 'coffin', x, y, keep: true, set: true });
    else floor.props.push({ id: 'grave-flowers-moss-' + (1 + (x + y) % 4), x, y, keep: true, set: true });
  }
  for (const dx of [-1, 1]) for (const it of giveOf(gen, { food: 'ration' }, gen.floorNo)) floor.items.push({ x: r.cx + dx, y: r.cy, item: it });
  (floor.fields ??= []).push(consecrated(cells));
  (floor.notes ??= []).push('heroes-tomb');
  return true;
}

/** S34: the funeral bell stands at the room's centre (rung once, rules/crypt.js). */
function funeralBell(gen, floor, rooms, host) {
  const W = floor.w;
  let c = { x: host.cx, y: host.cy };
  if (floor.tiles[c.y * W + c.x] !== T.FLOOR || floor.props.some(p => p.x === c.x && p.y === c.y)) {
    const free = [];
    for (let y = host.y + 1; y < host.y + host.h - 1; y++) for (let x = host.x + 1; x < host.x + host.w - 1; x++) if (floor.tiles[y * W + x] === T.FLOOR && !floor.props.some(p => p.x === x && p.y === y)) free.push({ x, y });
    if (!free.length) return false;
    c = free[Math.floor(next(gen.rng) * free.length)];
  }
  host.special = 'funeral-bell';
  floor.props.push({ id: 'crypt-funeral-bell', x: c.x, y: c.y, keep: true, set: true, bell: { rung: false, room: { x: host.x, y: host.y, w: host.w, h: host.h } } });
  return true;
}

// R6: the bone gauntlet and the hungry spider (crypt/rare.js, the specials session's).
export const CRYPT_SPECIALS = { 'heroes-tomb': heroesTomb, 'funeral-bell': funeralBell, ...CRYPT_RARE };
