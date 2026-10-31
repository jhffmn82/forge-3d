// Dungeon floors 1-5 past 1.7 (Justin's picks from improvements-dungeon.md, sandbox thread 2026-10-16: D1-D5, D7-D13;
// D6 declined, gardens keep hiding their loot and enemies). Every pass here changes a seed's floor against 1.7's, so
// generateFloor runs them only when not asked for the classic floor (census and parity checks ask for it).
// D1 and D4 run inside the layout (layout-trim.js). Each other pass draws from the floor's own improvement stream (floor seed ^ 0xD1D1), never the generation stream, so 1.7's
// draws for the rooms, corridors and doors stay in their order.

import floors from '../../data/floors.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next, roll, pick, shuffled, weighted } from '../lib/rng.js';
import { T, walkable, G } from '../data/tiles.js';
import { flood } from './layout.js';
import { makeCreature } from '../rules/monsters.js';
import { edgeCells, interiorCells, nearDoor, decorateEdgesOpen } from './dress.js';
import { allows, allowedProps } from './templates.js';
import { D4 } from '../lib/geometry.js';
import { zeroOneSearch } from '../lib/grid.js';
import { propBlocks } from '../data/props.js';
import { rosterRows } from '../data/roster.js';

const P = props.rows, F = floors.rows;
const DI = F['dungeon-improvements'];

/**
 * D2: the run no longer always starts on the left. The finished layout is mirrored left to right, top to bottom, both
 * or neither (one draw of four); rooms keep their order, so rooms[0], the start, is the same room wherever it lands.
 */
export function orient(lay, rng) {
  const o = Math.floor(next(rng) * 4), fx = o & 1, fy = o & 2;
  if (!o) return 0;
  const { w, h } = lay, t = lay.tiles, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[(fy ? h - 1 - y : y) * w + (fx ? w - 1 - x : x)] = t[y * w + x];
  lay.tiles = out;
  for (const r of lay.rooms) {
    if (fx) { r.x = w - r.x - r.w; r.cx = w - 1 - r.cx; }
    if (fy) { r.y = h - r.y - r.h; r.cy = h - 1 - r.cy; }
  }
  lay.orient = o;
  return o;
}

/** What stands on a tile, as a set of tile indexes (props, items, traps, chests, bodies). */
const busy = (floor, creatures) => new Set([...floor.props, ...floor.items, ...floor.traps, ...(floor.chests ?? []), ...creatures].map(o => o.y * floor.w + o.x));

/**
 * D3: rooms beyond rectangles, in rooms nothing else claimed (no role, special, event or pocket). A room 7 or 8 across
 * (the 8 x 8 cap, Justin 2026-10-18) gets 2 x 2 blocks of plain wall as pillars (Justin 2026-10-16: "a block of 2x2
 * walls"), one on a side of 7, two on a side of 8, each with a lap of open floor round it (pillar dancing); a room 6 x 5 or more may lose a corner to the wall and become an L.
 * A cut never touches a way in; anything already standing where a wall would go keeps the room as it was, and so does a
 * cut or pillar that would leave any open tile unreachable.
 */
export function shapeRooms(rng, floor, rooms, creatures, start) {
  const W = floor.w, out = { pillars: 0, cuts: 0 };
  const plain = rooms.filter(r => !r.role && !r.special && !r.rareEvent && !r.pocket && !r.puzzle && !r.hiddenSigil);
  const reachCount = () => { const d = flood(floor.tiles, W, floor.h, start.y * W + start.x); let n = 0; for (let k = 0; k < d.length; k++) if (floor.tiles[k] !== T.WALL && d[k] >= 0) n++; return { n, d }; };
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= floor.h ? T.WALL : floor.tiles[y * W + x]);
  for (const r of plain) {
    const taken = busy(floor, creatures);
    const free = (x, y) => at(x, y) === T.FLOOR && !taken.has(y * W + x) && !(x === r.cx && y === r.cy);
    const hall = r.w >= DI.D3.pillarRoom && r.h >= DI.D3.pillarRoom;
    let cells = [], kind = null;
    if (hall && next(rng) < DI.D3.pillarsPct / 100) {
      kind = 'pillars';
      // One pillar on a side of 7, two on a side of 8; each keeps a lap of open floor round it (no blocking prop).
      const spots = len => (len >= 8 ? [1, len - 3] : [Math.floor((len - 2) / 2)]);
      const lapOpen = (x, y) => at(x, y) !== T.WALL && !floor.props.some(p => p.x === x && p.y === y && propBlocks(p));
      for (const oy of spots(r.h)) for (const ox of spots(r.w)) {
        const px = r.x + ox, py = r.y + oy, block = [[px, py], [px + 1, py], [px, py + 1], [px + 1, py + 1]], lap = [];
        for (let y = py - 1; y <= py + 2; y++) for (let x = px - 1; x <= px + 2; x++) if (x < px || x > px + 1 || y < py || y > py + 1) lap.push([x, y]);
        if (block.every(([x, y]) => free(x, y) && !nearDoor(floor, [], x, y)) && lap.every(([x, y]) => lapOpen(x, y))) cells.push(...block);
      }
    } else if (r.w >= DI.D3.corner[0] && r.h >= DI.D3.corner[1] && next(rng) < DI.D3.cornerPct / 100) {
      kind = 'L';
      const cw = roll(rng, 2, r.w >> 1), ch = roll(rng, 2, r.h >> 1), corner = Math.floor(next(rng) * 4);
      const x0 = corner & 1 ? r.x + r.w - cw : r.x, y0 = corner & 2 ? r.y + r.h - ch : r.y;
      for (let y = y0; y < y0 + ch; y++) for (let x = x0; x < x0 + cw; x++) cells.push([x, y]);
      // No way in on the cut's outer sides: every neighbour outside the room is wall.
      const inR = (x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      const shut = cells.every(([x, y]) => D4.every(([dx, dy]) => inR(x + dx, y + dy) || at(x + dx, y + dy) === T.WALL));
      if (!shut || !cells.every(([x, y]) => free(x, y))) cells = [];
    }
    if (!cells.length) continue;
    const before = reachCount().n;
    for (const [x, y] of cells) { floor.tiles[y * W + x] = T.WALL; floor.ground[y * W + x] = 0; }
    if (reachCount().n !== before - cells.length) {   // something cut off: the room stays as it was
      for (const [x, y] of cells) floor.tiles[y * W + x] = T.FLOOR;
      continue;
    }
    if (kind === 'pillars') out.pillars += cells.length / 4; else out.cuts++;
    r.shape = kind;
  }
  return out;
}

/**
 * D7: now and then a whole floor leans one way. 40% of ordinary floors 1-4 get a mood, picked evenly: flooded (more
 * pools and puddles, so the growth follows the wet), overgrown (most rooms grow lush), dark (most torches out, fewer
 * lights in plain rooms), collapsed (rubble and fallen statues through rooms and passages).
 */
export const MOODS = ['flooded', 'overgrown', 'dark', 'collapsed'];
export function floorMood(rng, floorNo, boss) {
  if (boss || floorNo > DI.D7.lastFloor || next(rng) >= DI.D7.moodPct / 100) return null;
  return pick(rng, MOODS);
}

/** The flooded floor's water: 3-5 more pools in rooms (not the start, the goal or a kept room) and puddles, only where the
 *  room's template lets water and puddles lie (item 233; the flooded mood also leans the templates damp). */
export function floodFloor(rng, floor, rooms) {
  const W = floor.w, pool = rooms.filter(r => !r.role && !r.rareEvent && r.w >= 4 && r.h >= 4 && allows(r, 'water'));
  const busyK = new Set(floor.props.map(p => p.y * W + p.x));
  const wet = (x, y) => { const k = y * W + x; if (floor.tiles[k] === T.FLOOR && !busyK.has(k) && floor.ground[k] !== G.TELL) { floor.tiles[k] = T.WATER; floor.ground[k] = 0; } };
  const FL = DI.D7.flooded;
  for (let n = roll(rng, FL.pools[0], FL.pools[1]); n > 0 && pool.length; n--) {
    const r = pick(rng, pool), cx = r.x + roll(rng, 1, r.w - 2), cy = r.y + roll(rng, 1, r.h - 2), size = roll(rng, FL.poolSize[0], FL.poolSize[1]);
    const cells = [[cx, cy]], seen = new Set();
    for (let i = 0; i < cells.length && i < size * 3 && seen.size < size; i++) {
      const c = pick(rng, cells), k = c[1] * W + c[0];
      if (c[0] <= r.x || c[1] <= r.y || c[0] >= r.x + r.w - 1 || c[1] >= r.y + r.h - 1) continue;   // a tile clear of the walls
      if (!seen.has(k)) { seen.add(k); wet(c[0], c[1]); }
      const d = D4[Math.floor(next(rng) * 4)]; cells.push([c[0] + d[0], c[1] + d[1]]);
    }
  }
  const damp = rooms.filter(r => allows(r, 'puddle'));
  for (let n = 0; n < FL.puddles && damp.length; n++) {
    const r = pick(rng, damp), x = r.x + roll(rng, 0, r.w - 1), y = r.y + roll(rng, 0, r.h - 1), k = y * W + x;
    if (floor.tiles[k] === T.FLOOR && !floor.ground[k]) floor.ground[k] = G.PUDDLE;
  }
}

/** The overgrown floor: about 60% of rooms (not the start or the boss's) grow lush or overgrown (ground.js vegetation). */
export function leanGreen(rng, rooms) {
  for (const r of rooms) if (r.role !== 'start' && r.role !== 'boss' && !r.pocket && next(rng) < DI.D7.overgrown.roomPct / 100) r.lean = next(rng) < DI.D7.overgrown.overgrownPct / 100 ? 'overgrown' : 'lush';
}

/** The dark floor, after the lights are worked out: two in three wall torches out, plain rooms' own lights mostly gone. */
const LIGHT_PROP = /^(brazier-lit|torch-stand|table-candle|candelabra|candles-\d)$/;
export function darken(rng, floor, rooms) {
  const plainAt = (x, y) => rooms.some(r => !r.role && !r.special && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  floor.props = floor.props.filter(p => p.keep || !LIGHT_PROP.test(p.id) || !plainAt(p.x, p.y) || next(rng) < DI.D7.dark.keepLightPct / 100);
  floor.lights = floor.lights.filter(l => l.kind !== 'wall-torch' || next(rng) < DI.D7.dark.keepTorchPct / 100);
}

/** The collapsed floor: 10-16 heaps of rubble and bones through rooms and passages, and a fallen statue or two; in a room
 *  only what its template lets stand there (item 233; the collapsed mood also leans the templates to ruins). */
export function collapse(rng, floor, rooms, grid) {
  const W = floor.w, taken = new Set([...floor.props, ...floor.items, ...floor.traps].map(o => o.y * W + o.x));
  const lets = (id, x, y) => { const r = rooms[grid[y * W + x]], a = r && allowedProps(r); return !a || a.has(id); };
  const ok = (x, y, id = null) => floor.tiles[y * W + x] === T.FLOOR && !taken.has(y * W + x) && !nearDoor(floor, grid, x, y) && (!id || lets(id, x, y));
  const open = [];
  for (let y = 1; y < floor.h - 1; y++) for (let x = 1; x < W - 1; x++) if (ok(x, y)) open.push({ x, y });
  const CO = DI.D7.collapsed;
  for (let n = roll(rng, CO.heaps[0], CO.heaps[1]); n > 0 && open.length; n--) {
    const c = pick(rng, open);
    for (const [dx, dy] of [[0, 0], ...shuffled(rng, D4).slice(0, roll(rng, CO.spread[0], CO.spread[1]))]) {
      const x = c.x + dx, y = c.y + dy;
      const id = next(rng) < CO.rubblePct / 100 ? 'rubble' : 'bones';
      if (!ok(x, y, id)) continue;
      floor.props.push({ id, x, y }); taken.add(y * W + x);
    }
  }
  const edges = shuffled(rng, rooms.filter(r => !r.role && !r.special).flatMap(r => edgeCells(floor, grid, r)));
  for (let i = 0, n = roll(rng, CO.statues[0], CO.statues[1]); i < Math.min(n, edges.length); i++) if (!taken.has(edges[i].y * W + edges[i].x) && lets('statue-broken', edges[i].x, edges[i].y)) floor.props.push({ id: 'statue-broken', x: edges[i].x, y: edges[i].y });
}

/**
 * D8: loot with intent. The floor scatter's open cells, weighted: a side room (one way in) counts 4 times, a room off the
 * walk from the arrival to the stairs twice, the rest once. Exploring off the main route pays.
 */
export function lootWeights(floor, rooms, grid, open, start, goal) {
  const W = floor.w;
  const ways = rooms.map(r => {
    let n = 0;
    for (let x = r.x; x < r.x + r.w; x++) for (const y of [r.y - 1, r.y + r.h]) if (y >= 0 && y < floor.h && floor.tiles[y * W + x] !== T.WALL && floor.tiles[y * W + x] !== T.SECRET && grid[y * W + x] < 0) n++;
    for (let y = r.y; y < r.y + r.h; y++) for (const x of [r.x - 1, r.x + r.w]) if (x >= 0 && x < W && floor.tiles[y * W + x] !== T.WALL && floor.tiles[y * W + x] !== T.SECRET && grid[y * W + x] < 0) n++;
    return n;
  });
  // The main route: tiles on some shortest walk from the arrival to the goal (d(start) + d(goal) = the walk's length).
  const ds = flood(floor.tiles, W, floor.h, start.y * W + start.x), dg = goal ? flood(floor.tiles, W, floor.h, goal.y * W + goal.x) : null;
  const len = dg ? ds[goal.y * W + goal.x] : -1, onRoute = new Set();
  if (len > 0) for (let k = 0; k < ds.length; k++) if (ds[k] >= 0 && dg[k] >= 0 && ds[k] + dg[k] === len && grid[k] >= 0) onRoute.add(grid[k]);
  const out = [];
  for (const c of open) {
    const ri = grid[c.y * W + c.x], wt = ri < 0 ? 1 : ways[ri] === 1 ? DI.D8.sideRoom : onRoute.has(ri) ? 1 : DI.D8.offRoute;
    for (let i = 0; i < wt; i++) out.push(c);
  }
  return out;
}

/**
 * D9: guards where it matters. A watch of 2-3 of the floor's fighters (goblins, archers, brutes, shamans, as the
 * roster has them on this floor; rats where nothing else stands yet) stands 2-4 steps from a post: the vault's way in,
 * else the boss antechamber's door, else the stairs. Awake. They come off the floor's creature count.
 */
const WATCH = new Set(DI.D9.watch);
export function postGuards(rng, floor, rooms, grid, floorNo, startC, post, isQuiet) {
  if (!post) return [];
  const pop = F['monster-population'], all = rosterRows(floorNo);
  const rows = all.some(r => WATCH.has(r.creature)) ? all.filter(r => WATCH.has(r.creature)) : all;
  if (!rows.length) return [];
  const draw = () => weighted(rng, rows);
  const W = floor.w, d = flood(floor.tiles, W, floor.h, post.y * W + post.x);
  const solid = new Set(floor.props.filter(p => propBlocks(p)).map(p => p.y * W + p.x));
  const spots = [];
  for (let k = 0; k < d.length; k++) {
    if (d[k] < DI.D9.steps[0] || d[k] > DI.D9.steps[1]) continue;
    const x = k % W, y = (k / W) | 0;
    if (!walkable(floor, x, y) || floor.tiles[k] !== T.FLOOR || solid.has(k) || isQuiet(k) || Math.abs(x - startC.x) + Math.abs(y - startC.y) < pop.minDistanceFromStart) continue;
    spots.push({ x, y });
  }
  const n = Math.min(spots.length, roll(rng, DI.D9.size[0], DI.D9.size[1]));
  if (n < 2) return [];
  return shuffled(rng, spots).slice(0, n).map(c => Object.assign(makeCreature(draw().creature, c.x, c.y, { asleep: false }), { post: { x: post.x, y: post.y } }));
}

/**
 * D10: a boss approach. On the Dungeon's boss floor every way into Grukk's room but the one nearest the arrival is
 * walled; where that cuts a room off (a corridor that ran through or along the boss room), a bypass is dug round it,
 * two tiles clear of its walls. The kept way becomes a door, and the room before it is the antechamber: torches and
 * banners at its walls, old bones, and (D9) a guard pack at the door. Corridor stubs the walling leaves are filled.
 */
export function bossApproach(rng, floor, rooms, boss, start) {
  const W = floor.w, H = floor.h, N = W * H, t = floor.tiles;
  const near = new Uint8Array(N), blockBoss = new Uint8Array(N), inAny = new Uint8Array(N);
  for (let y = boss.y - 1; y <= boss.y + boss.h; y++) for (let x = boss.x - 1; x <= boss.x + boss.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) near[y * W + x] = 1;
  for (let y = boss.y; y < boss.y + boss.h; y++) for (let x = boss.x; x < boss.x + boss.w; x++) blockBoss[y * W + x] = 1;
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inAny[y * W + x] = 1;
  const opens = () => {
    const out = [];
    for (let x = boss.x; x < boss.x + boss.w; x++) for (const y of [boss.y - 1, boss.y + boss.h]) if (y >= 0 && y < H && t[y * W + x] !== T.WALL) out.push(y * W + x);
    for (let y = boss.y; y < boss.y + boss.h; y++) for (const x of [boss.x - 1, boss.x + boss.w]) if (x >= 0 && x < W && t[y * W + x] !== T.WALL) out.push(y * W + x);
    return out;
  };
  const from = start.y * W + start.x;
  let first = opens();
  if (!first.length) return null;
  const ds = flood(t, W, H, from, blockBoss);
  first.sort((a, b) => (ds[a] < 0 ? 1e9 : ds[a]) - (ds[b] < 0 ? 1e9 : ds[b]));
  const kk = first[0];
  const centres = [...rooms.filter(r => r !== boss).map(r => r.cy * W + r.cx), kk];
  // A bypass from the tiles cut off to the tiles still reached: fewest walls dug (0-1 search), clear of the boss room.
  const bypass = d => {
    const cut = []; for (let k = 0; k < N; k++) if (t[k] !== T.WALL && d[k] < 0 && !blockBoss[k]) cut.push(k);
    const found = zeroOneSearch(W, H, cut, c => t[c] !== T.WALL && d[c] >= 0, n => {   // reached: dig the walls on the way back
      const x = n % W, y = (n / W) | 0;
      return x < 1 || y < 1 || x >= W - 1 || y >= H - 1 || blockBoss[n] || (t[n] === T.WALL && near[n]) ? Infinity : t[n] === T.WALL ? 1 : 0;
    });
    if (found) for (const k of found.path) if (t[k] === T.WALL) t[k] = T.FLOOR;
    return !!found;
  };
  for (let guard = 0; guard < 40; guard++) {
    const rest = opens().filter(k => k !== kk);
    if (!rest.length) break;
    let progress = false;
    for (const k of rest) {
      if (t[k] === T.WALL) continue;
      const was = t[k];
      t[k] = T.WALL;
      let d = flood(t, W, H, from), ok = centres.every(i => d[i] >= 0);
      for (let tries = 0; !ok && tries < 3 && bypass(d); tries++) { d = flood(t, W, H, from); ok = centres.every(i => d[i] >= 0); }
      if (!ok) t[k] = was; else progress = true;
    }
    if (!progress) break;
  }
  // Stubs: corridor floors and doors with one open neighbour or none, but the kept way.
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const k = y * W + x;
      if (k === kk || inAny[k] || (t[k] !== T.FLOOR && t[k] !== T.DOOR)) continue;
      if (D4.filter(([dx, dy]) => t[k + dy * W + dx] !== T.WALL).length > 1) continue;
      t[k] = T.WALL; changed = true;
    }
  }
  const keep = { x: kk % W, y: (kk / W) | 0 };
  if (t[kk] === T.FLOOR) t[kk] = T.DOOR;
  // The antechamber: the nearest other room to the door on foot, if it is close.
  const dd = flood(t, W, H, kk, blockBoss);
  const ante = rooms.filter(r => r !== boss && !r.pocket && r.role !== 'start' && !r.role && !r.special).map(r => ({ r, d: dd[r.cy * W + r.cx] })).filter(o => o.d >= 0 && o.d <= 16).sort((a, b) => a.d - b.d)[0]?.r;
  if (ante) {
    ante.role = 'antechamber';
    const grid = new Int16Array(W * H).fill(-1);
    rooms.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y * W + x] = i; });
    // Four stands at its walls, each only where every floor tile of the room stays reachable (sandbox lead, seed 23758).
    decorateEdgesOpen(rng, floor, grid, ante, ['torch-stand', 'banner-stand', 'torch-stand', 'banner-stand'], 4, { keep: true });
    const inner = shuffled(rng, interiorCells(floor, ante));
    for (let i = 0; i < Math.min(3, inner.length); i++) floor.ground[inner[i].y * W + inner[i].x] = pick(rng, [G.BONES, G.BLOOD]);
  }
  floor.bossDoor = { x: keep.x, y: keep.y };
  return { door: keep, ante };
}

/**
 * D12: torches on the side walls of large rooms (8+ wide, 6+ tall): one on the west wall and one on the east at most,
 * at the wall's middle row, on a wall tile with the room beside it, none within 4 of another light.
 * Entries are {kind:'wall-torch', x, y, side} on the side wall tile; side is the wall it hangs on ('w' or 'e').
 */
export function sideTorches(floor, rooms, lights) {
  const W = floor.w, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= floor.h ? T.WALL : floor.tiles[y * W + x]);
  const lit = [...lights.map(l => ({ x: l.x, y: l.y + 1 })), ...floor.props.filter(p => P[p.id]?.light).map(p => ({ x: p.x, y: p.y }))];
  const out = [];
  for (const r of rooms) {
    if (r.dark || r.pocket || r.w < 8 || r.h < 6) continue;
    for (const [side, wx, fx] of [['w', r.x - 1, r.x], ['e', r.x + r.w, r.x + r.w - 1]]) {
      const mid = r.y + (r.h >> 1);
      for (const y of [mid, mid - 1, mid + 1, mid - 2, mid + 2]) {
        if (y <= r.y || y >= r.y + r.h - 1 || at(wx, y) !== T.WALL || at(wx, y - 1) !== T.WALL || at(wx, y + 1) !== T.WALL || at(fx, y) !== T.FLOOR) continue;
        if (lit.some(q => (q.x - fx) ** 2 + (q.y - y) ** 2 < 16)) break;
        const l = { kind: 'wall-torch', x: wx, y, side };
        out.push(l); lit.push({ x: fx, y });
        break;
      }
    }
  }
  return out;
}
