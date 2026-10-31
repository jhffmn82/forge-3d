// Which floors hold a portal and where it stands (spec/planes.md rules 5-19; data/planes.json portal-rule-*,
// portal-placement-*). The biome plan rolls as 1.7's biomePlan does (js/world/world.js:76-101 @3c8b312), draw for
// draw. Placement is one rule for both portal biomes (ruled 2026-10-15, answer 7): the farthest qualifying room from
// the arrival, then the reachable-from-stairs repair (1.7 ran it in the Underdark only, planesfwa.js:722-745).
// A portal floor never loses its plane: past 1.7's repair a last fallback takes the farthest reachable plain floor.

import planes from '../../../data/planes.json' with { type: 'json' };
import { stream, next } from '../../lib/rng.js';
import { T, walkable, passable } from '../../data/tiles.js';
import { roomGrid, nearDoor } from '../dress.js';
import { portalLight } from '../floor-lights.js';
import { D4, cheb } from '../../lib/geometry.js';
import { distanceField } from '../../lib/grid.js';
import { propBlocks, propSolid } from '../../data/props.js';

const R = planes.rows, ROOM = R['portal-placement-room'];
const BIOME_PLANES = { 1: R['portal-rule-biome-1'].planes, 3: R['portal-rule-biome-3'].planes };

/**
 * Rule 7: each portal biome's plan on its own stream: forge, shrine (rerolls), the mote shuffle, then the portal floor
 * (never the forge floor) and the plane.
 * @param {number} runSeed @returns {{[biome:number]:{floor:number, plane:string, forge:number}}}
 */
export function planPortals(runSeed) {
  const out = {};
  for (const b of [1, 3]) {
    const st = stream((((runSeed || 1) ^ (0x51ed27 * (b + 1))) >>> 0)), r = () => next(st), base = b * 5;
    const forge = base + (r() < 0.5 ? 3 : 4);
    let shrine;
    do shrine = base + 1 + Math.floor(r() * 4); while (shrine === forge && r() < 0.7);
    for (let i = 5; i > 0; i--) Math.floor(r() * (i + 1));   // the six-element mote shuffle: its draws only
    let floor;
    do floor = base + 1 + Math.floor(r() * 4); while (floor === forge);
    const pool = BIOME_PLANES[b];
    out[b] = { floor, plane: pool[Math.floor(r() * pool.length)], forge };
  }
  return out;
}

/**
 * Rule 22: the floor's other pieces keep clear of the portal, as 1.7's generators keep clear of a PORTAL tile. Placed
 * last here, the portal clears round itself instead: no trap within 2 (trap spots), no creature within 2 (patrols, pack
 * spots, buried ghouls; each moves to the nearest free cell 3 or more away), no Crypt ooze within 3.
 */
function clearAround(floor, at, bodies) {
  const W = floor.w, H = floor.h;
  floor.traps = (floor.traps ?? []).filter(t => cheb(t, at) > 2);
  if (floor.ooze?.length) floor.ooze = floor.ooze.filter(k => cheb({ x: k % W, y: (k / W) | 0 }, at) > 3);
  const taken = new Set(bodies.map(b => b.y * W + b.x));
  for (const p of floor.props) taken.add(p.y * W + p.x);
  for (const b of bodies) {
    if (cheb(b, at) > 2) continue;
    let best = null, bd = 1e9;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x, d = Math.abs(x - b.x) + Math.abs(y - b.y);
      if (d >= bd || floor.tiles[k] !== T.FLOOR || taken.has(k) || cheb({ x, y }, at) <= 2) continue;
      bd = d; best = { x, y };
    }
    if (!best) continue;
    taken.delete(b.y * W + b.x); taken.add(best.y * W + best.x);
    b.x = best.x; b.y = best.y;
  }
}

/**
 * Rules 12-19 (answer 7): puts the portal on a host floor. Sets the PORTAL tile, floor.portal, the room's role and the
 * floor note. `bodies` are the floor's creatures (a portal never lands under one).
 * @returns {{x:number,y:number}|null}
 */
export function placePortal(floor, rooms, arrival, element, bodies = []) {
  const W = floor.w, H = floor.h, N = W * H;
  const blocked = new Uint8Array(N), stuff = new Uint8Array(N);
  for (const p of floor.props) {
    for (let y = p.y; y < p.y + (p.part ? 1 : p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.part ? 1 : p.w ?? 1); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      stuff[y * W + x] = 1;
      if (propBlocks(p)) blocked[y * W + x] = 1;
    }
  }
  for (const o of [...floor.items, ...bodies]) stuff[o.y * W + o.x] = 1;
  const busy = new Uint8Array(N);
  for (const t of floor.traps ?? []) busy[t.y * W + t.x] = 1;
  const centre = r => ({ x: r.cx ?? r.x + (r.w >> 1), y: r.cy ?? r.y + (r.h >> 1) });
  floor.notes ??= [];
  const put = (c, room) => {
    if (floor.portal && floor.tiles[floor.portal.y * W + floor.portal.x] === T.PORTAL) floor.tiles[floor.portal.y * W + floor.portal.x] = T.FLOOR;
    floor.tiles[c.y * W + c.x] = T.PORTAL;
    floor.portal = { x: c.x, y: c.y, plane: element, used: false };
    portalLight(floor);   // W3: its light born with it; engine/realm.js takes it away once the portal is used
    if (room && !room.role) room.role = 'portal';
    if (!floor.notes.some(n => n?.id === 'portal')) floor.notes.push({ id: 'portal', plane: element });
    clearAround(floor, c, bodies);
  };

  // Rules 12-15: plain rooms 4x4 or bigger, farthest from the arrival first; the cell is the centre column, second row.
  const cand = rooms.filter(r => !r.role && !r.pocket && !r.special && r.w >= ROOM.candidates.minW && r.h >= ROOM.candidates.minH)
    .sort((a, b) => { const ca = centre(a), cb = centre(b); return (Math.abs(cb.x - arrival.x) + Math.abs(cb.y - arrival.y)) - (Math.abs(ca.x - arrival.x) + Math.abs(ca.y - arrival.y)); });
  // Stepping on the portal leaves for the plane, so it never stands where the arrival's only way to the stairs passes
  // (Underdark robot, seeds 31677 and 253409: a portal in the mouth of the dead-end stairs passage).
  const goal = floor.stairs ?? floor.exit, solid = new Uint8Array(N);   // breakable pieces (web curtains, crates) give way
  for (const p of floor.props) if (propSolid(p)) solid[p.y * W + p.x] = 1;
  // What must stay reachable from the arrival: the stairs (or exit), vault and toll doors, the Forge and the shrine.
  const needs = [goal, floor.forge, floor.shrine].filter(Boolean).map(c => c.y * W + c.x);
  for (let k = 0; k < N; k++) if (floor.tiles[k] === T.LOCKED || floor.tiles[k] === T.TOLL) needs.push(k);
  const cuts = k => {
    if (!arrival || !needs.length) return false;
    const d = distanceField(W, H, arrival.y * W + arrival.x, n => n !== k && passable(floor, n % W, (n / W) | 0) && !solid[n]), seen = n => d[n] >= 0 || n === k;
    return needs.some(n => n !== k && !seen(n) && !D4.some(([dx, dy]) => seen(n + dy * W + dx) && n + dy * W + dx !== k));
  };
  for (const r of cand) {
    const c = { x: centre(r).x, y: r.y + 1 }, k = c.y * W + c.x;
    if (floor.tiles[k] === T.FLOOR && !stuff[k] && !busy[k] && !cuts(k)) { put(c, r); break; }   // never on a trap (rule 22: traps keep clear of it)
  }

  // Rules 17-19: walk from the first stairs cell (scan order) over route cells; a portal it cannot reach moves.
  let from = null;
  for (let k = 0; k < N && !from; k++) if (floor.tiles[k] === T.STAIRS) from = { x: k % W, y: (k / W) | 0 };
  from ??= floor.stairs ?? floor.exit ?? null;
  if (!from) return floor.portal ? { x: floor.portal.x, y: floor.portal.y } : null;
  const route = (x, y) => floor.tiles[y * W + x] === T.PORTAL || (passable(floor, x, y) && !blocked[y * W + x]);
  const d = distanceField(W, H, from.y * W + from.x, k => route(k % W, (k / W) | 0));
  const p = floor.portal;
  if (p && d[p.y * W + p.x] >= 0) return { x: p.x, y: p.y };
  const grid = roomGrid(floor, rooms), roomAt = (x, y) => rooms[grid[y * W + x]] ?? null;
  const walk = (x, y) => walkable(floor, x, y) && !blocked[y * W + x];
  const lava = (x, y) => D4.some(([dx, dy]) => floor.tiles[(y + dy) * W + x + dx] === T.LAVA);
  const pickFar = strict => {
    let best = null, bs = -1;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (floor.tiles[k] !== T.FLOOR || d[k] < 0 || stuff[k] || busy[k]) continue;
      if (cuts(k)) continue;
      if (strict) {
        if (nearDoor(floor, grid, x, y) || lava(x, y)) continue;
        let open = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (walk(x + ox, y + oy)) open++;
        if (open < 7) continue;
      }
      if (d[k] > bs) { bs = d[k]; best = { x, y }; }
    }
    return best;
  };
  const best = pickFar(true) ?? pickFar(false);
  if (!best) return p ? { x: p.x, y: p.y } : null;
  put(best, roomAt(best.x, best.y));
  return best;
}
