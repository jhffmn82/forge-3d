// The ground layer under bodies and props (spec/world.md "Tiles": ground) and what paints it on an ordinary floor:
// terrain patches (W37) and vegetation growth (vegetation 116-125). Numbers: floors.json terrain-patches,
// props.json placement-vegetation. Draws only from the generation stream it is given.

import floors from '../../data/floors.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next, roll, pick } from '../lib/rng.js';
import { T, wallLike, walkable, G, WEAR } from '../data/tiles.js';
import { flood } from './layout.js';
import { hash2, noise } from '../lib/noise.js';
import { blob, distanceField, zeroOneSearch } from '../lib/grid.js';
import { D4 } from '../lib/geometry.js';
import { propBlocks } from '../data/props.js';
import { allows, templateOf } from './templates.js';


const V = props.rows['placement-vegetation'], PATCH = floors.rows['terrain-patches'];




/**
 * Item 207 (Justin 2026-10-19: "the first biome needs to be a little more visually interesting, what are we misising?",
 * then "let's do 1-5 we need more variety to bring people into the game"): the Dungeon floor's wear, by area, as a layer
 * of its own (floor.wear), so the ground's marks and the rules never meet it. No worn paths along the corridors or the
 * rooms' routes (Justin 2026-10-19: "get rid of the trails"). An old room, by its template's wear (item 233,
 * data/rooms.json: 'cracked' always, 'aged' about a third of those of 20 cells or more by the room's hash, 'kept' never),
 * is cracked and broken in patches. Open floor
 * within two steps of water is damp. Only ordinary floor cells; drawn from `salt`, never the generation stream.
 */
export function wear(floor, rooms, salt) {
  const W = floor.w, H = floor.h, out = new Array(W * H).fill(0);
  rooms.forEach(r => {
    // An old room: cracked in patches of the floor's noise.
    const age = templateOf(r)?.wear;
    if (age === 'cracked' || (age === 'aged' && r.w * r.h >= 20 && hash2(r.x, r.y, salt) < 0.33)) {
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (floor.tiles[y * W + x] === T.FLOOR && noise(x * 0.45, y * 0.45, salt + 1) > 0.46) out[y * W + x] = WEAR.CRACKED;
    }
  });
  // Damp: ordinary floor within two steps of water.
  const water = [];
  for (let k = 0; k < W * H; k++) if (floor.tiles[k] === T.WATER) water.push(k);
  for (let k = 0; k < W * H; k++) {
    if (floor.tiles[k] !== T.FLOOR) continue;
    const x = k % W, y = (k / W) | 0;
    if (water.some(w => Math.abs((w % W) - x) + Math.abs(((w / W) | 0) - y) <= 2)) out[k] = WEAR.DAMP;
  }
  return out;
}

/** W37: grass blobs, water pools (not the start or boss room, never over a tell), and 8 tries at a ground splash; on an
 *  improved Dungeon floor only in the rooms whose template lets grass, water or that mark lie there (item 233). */
const MARK = { [G.PUDDLE]: 'puddle', [G.MOSS]: 'moss', [G.BONES]: 'bones', [G.BLOOD]: 'blood' };
export function patches(rng, floor, rooms) {
  const at = (x, y) => floor.tiles[y * floor.w + x], i = (x, y) => y * floor.w + x;
  const propAt = (x, y) => floor.props.some(p => p.x === x && p.y === y);
  const templated = rooms.some(r => r.template), green = rooms.filter(r => allows(r, 'grass'));
  const own = new Array(floor.w * floor.h);   // each cell's room (a later room over an earlier), so a blob never spills into a room that forbids it
  for (const r of rooms) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) own[i(x, y)] = r;
  const gn = roll(rng, PATCH.grass.blobs[0], PATCH.grass.blobs[1]);
  for (let n = 0; n < gn && green.length; n++) {
    const r = pick(rng, green);
    blob(() => next(rng), floor.w, floor.h, r.x + roll(rng, 0, r.w - 1), r.y + roll(rng, 0, r.h - 1), roll(rng, PATCH.grass.size[0], PATCH.grass.size[1]),
      (x, y) => { if (at(x, y) === T.FLOOR && !floor.ground[i(x, y)] && !propAt(x, y) && allows(own[i(x, y)], 'grass')) floor.ground[i(x, y)] = G.GRASS; });
  }
  const wn = roll(rng, PATCH.water.blobs[0], PATCH.water.blobs[1]);
  for (let n = 0; n < wn; n++) {
    const pool = rooms.filter(r => !PATCH.water.notRoles.includes(r.role) && allows(r, 'water'));
    if (!pool.length && templated) break;
    const r = (pool.length ? pick(rng, pool) : pick(rng, rooms));
    blob(() => next(rng), floor.w, floor.h, r.x + roll(rng, 1, Math.max(1, r.w - 2)), r.y + roll(rng, 1, Math.max(1, r.h - 2)), roll(rng, PATCH.water.size[0], PATCH.water.size[1]),
      (x, y) => { if (at(x, y) === T.FLOOR && !propAt(x, y) && floor.ground[i(x, y)] !== G.TELL && allows(own[i(x, y)], 'water')) { floor.tiles[i(x, y)] = T.WATER; floor.ground[i(x, y)] = 0; } });
  }
  const splash = [G.PUDDLE, G.MOSS, G.MOSS, G.BONES, G.BLOOD];
  for (let n = 0; n < PATCH.groundSpots.tries; n++) {
    const r = pick(rng, rooms), x = r.x + roll(rng, 0, r.w - 1), y = r.y + roll(rng, 0, r.h - 1);
    if (at(x, y) === T.FLOOR && !floor.ground[i(x, y)]) { const g = pick(rng, splash); if (allows(r, MARK[g])) floor.ground[i(x, y)] = g; }
  }
}

/**
 * Vegetation growth on a Dungeon floor (vegetation 116-125): the patch grass is cleared and regrown by each room's
 * mood and a moisture field; corner bunches, corridor weeds, plant spots and bushes. `player` is the arrival.
 * Returns the plant spots (for art). A new bush that cuts the way from the arrival to the stairs is removed.
 */
export function vegetation(rng, floor, rooms, player, occupied = new Set(), cave = null) {   // cave: the Caverns' chamber map (floor.cave), 1.7's cave branches
  const W = floor.w, N = W * floor.h, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= floor.h ? T.WALL : floor.tiles[y * W + x]);
  const i = (x, y) => y * W + x, wallAt = (x, y) => wallLike(floor, x, y);
  const propTiles = new Set(floor.props.map(p => i(p.x, p.y))), propAt = (x, y) => propTiles.has(i(x, y));
  const setG = (x, y, g) => { floor.ground[i(x, y)] = g; };
  const salt = Math.floor(next(rng) * 1e6);
  // The patch grass goes, except in gardens, which keep their own planting (1.7 vegetation.js:27-29).
  const inGarden = new Uint8Array(N);
  for (const r of rooms) if (r.special === 'garden' && !cave) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) inGarden[i(x, y)] = 1;
  for (let k = 0; k < N; k++) if (!inGarden[k] && (floor.ground[k] === G.GRASS || floor.ground[k] === G.SHORT)) floor.ground[k] = 0;
  // Orthogonal steps to water or a puddle, out to 4.
  const wets = []; for (let k = 0; k < N; k++) if (floor.tiles[k] === T.WATER || floor.ground[k] === G.PUDDLE) wets.push(k);
  const wet = distanceField(W, floor.h, wets, () => true).map(d => (d >= 0 && d <= 4 ? d : 9));
  const walls = new Uint8Array(N);   // wall-like tiles among the eight around each tile, counted once
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < W; x++) { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && wallAt(x + dx, y + dy)) n++; walls[i(x, y)] = n; }
  const wallN = (x, y) => walls[i(x, y)];
  const free = (x, y) => at(x, y) === T.FLOOR && (!floor.ground[i(x, y)] || (cave && floor.ground[i(x, y)] === G.MOSS)) && !propAt(x, y) && Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > 1;
  const moisture = (x, y) => {
    const w = wet[i(x, y)] < 9 ? Math.max(0, 1 - wet[i(x, y)] * 0.22) : 0, n = wallN(x, y);
    const wall = n >= 5 ? 0.42 : n >= 3 ? 0.34 : n >= 1 ? 0.22 : 0;
    const patch = (noise(x * 0.33, y * 0.33, salt + 1) - 0.5) * 0.55 + (noise(x * 0.9, y * 0.9, salt + 2) - 0.5) * 0.2;
    return Math.max(w, wall) + patch + (w > 0 && wall > 0 ? 0.1 : 0);
  };
  const M = V.moods, num = v => (typeof v === 'number' ? v : 9);
  const moods = Object.entries(M.weights), total = moods.reduce((a, [, w]) => a + w, 0);
  let spots = [];
  const inRoom = new Uint8Array(N), roomAt = new Array(N);
  for (const r of rooms) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { inRoom[i(x, y)] = 1; roomAt[i(x, y)] = r; }
    if (r.special === 'garden' && !cave) { r.greenery = 'lush'; continue; }   // a garden is not regrown (underground it is only moss: grown properly)
    let rr = next(rng) * total, mood = 'some';
    for (const [m, w] of moods) { rr -= w; if (rr <= 0) { mood = m; break; } }
    if (r.lean) mood = r.lean;   // an overgrown floor (improve.js D7) leans its rooms green
    if (r.role === 'start' && (mood === 'lush' || mood === 'overgrown')) mood = 'some';
    if (r.role === 'boss') mood = 'bare';
    if (cave && mood === 'overgrown') mood = 'lush';   // underground, lush is as green as it gets
    if (cave && r.special === 'garden') mood = 'lush';
    // Item 233: a template's room grows what its template says (none: nothing at all; a set piece by the mood above).
    const grows = templateOf(r)?.ground?.greenery;
    if (grows === 'none') { r.greenery = 'bare'; continue; }
    if (grows && grows !== 'mood') mood = grows;
    r.greenery = mood;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      if (!free(x, y)) continue;
      if (cave && cave[i(x, y)] !== r.id) continue;
      const m = moisture(x, y) + M.damp[mood], wt = wet[i(x, y)];
      if (m >= num(M.tallAt[mood]) && (!cave || wt <= 2)) setG(x, y, G.GRASS);   // underground, tall grass only by water: sight lines matter more
      else if (m >= num(M.shortAt[mood])) setG(x, y, G.SHORT);
      else if (wt <= 1 || (wt === 2 && noise(x * 0.8, y * 0.8, salt + 9) > 0.4)) setG(x, y, G.SHORT);
      if (m >= num(M.spotAt[mood]) && (wallN(x, y) >= 1 || mood === 'overgrown') && hash2(x, y, salt + 5) < (cave ? 0.18 : mood === 'overgrown' ? 0.22 : 0.35)) spots.push({ x, y, mood: mood === 'overgrown' ? 'lush' : mood, wet: wt < 3 });   // WT13: every spot knows if it is by water (1.7 vegetation.js)
    }
    if (mood === 'overgrown') {   // 121: at most 40% tall grass
      const cells = []; let tall = 0;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (at(x, y) === T.FLOOR) { cells.push([x, y]); if (floor.ground[i(x, y)] === G.GRASS) tall++; }
      const cap = Math.floor(cells.length * 0.4);
      for (let c = 0; tall > cap && c < cells.length; c++) { const [x, y] = cells[c]; if (floor.ground[i(x, y)] === G.GRASS && hash2(x, y, salt + 8) < 0.5) { setG(x, y, G.SHORT); tall--; } }
    }
    if (mood !== 'bare' && !cave) {   // 122: corner bunches (none underground)
      let corners = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (at(x, y) !== T.FLOOR || propAt(x, y)) continue;
        if ((wallAt(x, y - 1) || wallAt(x, y + 1)) && (wallAt(x - 1, y) || wallAt(x + 1, y))) corners.push({ x, y });
      }
      for (let k = corners.length - 1; k > 0; k--) { const j = roll(rng, 0, k); [corners[k], corners[j]] = [corners[j], corners[k]]; }
      corners = corners.slice(0, roll(rng, 1, 3));
      for (const c of corners) {
        if (Math.max(Math.abs(c.x - player.x), Math.abs(c.y - player.y)) <= 1) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = c.x + dx, y = c.y + dy, g = floor.ground[i(x, y)];
          if (at(x, y) !== T.FLOOR || propAt(x, y) || (g && g !== G.SHORT)) continue;
          if (!dx && !dy) setG(x, y, next(rng) < 0.6 ? G.GRASS : G.SHORT);
          else if (hash2(x, y, salt + 11) < 0.7 && g !== G.GRASS) setG(x, y, G.SHORT);
        }
        if (next(rng) < 0.5) spots.push({ x: c.x, y: c.y, mood: mood === 'overgrown' ? 'lush' : mood });
      }
    }
  }
  const seen = new Set();
  spots = spots.filter(s => { const k = i(s.x, s.y); if (seen.has(k)) return false; seen.add(k); return true; });
  // 123: corridors, the odd weed where the floor meets the wall.
  for (let y = 1; y < floor.h - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (inRoom[i(x, y)] || !free(x, y) || !wallN(x, y)) continue;
    if (noise(x * 0.5, y * 0.5, salt + 3) > 0.72 && hash2(x, y, salt + 4) < 0.6) setG(x, y, G.SHORT);
  }
  // 124: Dungeon bushes, often a short row along the wall.
  // 1.7 walkable: a blocking prop (an earlier bush too) closes the cell; nearDoor counts every kind of door.
  const blockTiles = new Set(floor.props.filter(p => propBlocks(p)).map(p => i(p.x, p.y))), blockingAt = (x, y) => blockTiles.has(i(x, y));
  const narrow = (x, y) => D4.filter(([dx, dy]) => walkable(floor, x + dx, y + dy) && !blockingAt(x + dx, y + dy)).length <= 2;
  const NEAR = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.ICE_DOOR, T.THORNS, T.TOLL, T.SEALED, T.SECRET, T.STAIRS, T.CHEST]);
  const nearDoor = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (NEAR.has(at(x + dx, y + dy))) return true; return false; };
  const itemTiles = new Set((floor.items ?? []).map(o => i(o.x, o.y)));   // a bush never hides a key or a prize under it
  const bushOK = (x, y) => at(x, y) === T.FLOOR && !propAt(x, y) && !occupied.has(i(x, y)) && !itemTiles.has(i(x, y)) && !nearDoor(x, y) && !narrow(x, y) && Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > 2;
  // 125: only the plants are judged (1.7 blockingPlants); other props are breakable or move later (W10).
  // Every required target (props.json routeGuard: the stairs, Forge, shrine, portal and food), as 1.7 inspectGeneratedFloor lists them.
  const targets = [floor.stairs, floor.forge, floor.shrine, floor.portal, ...(floor.items ?? []).filter(o => o.item?.kind === 'food')].filter(t => t && Number.isFinite(t.x));
  const bushes = [], before = cave ? null : distancesAround(floor, player, p => p.id === 'bush');   // the Caverns grow no bushes
  const addBush = (x, y) => { const p = { id: 'bush', x, y }; floor.props.push(p); bushes.push(p); propTiles.add(i(x, y)); blockTiles.add(i(x, y)); if (floor.ground[i(x, y)] === G.GRASS) setG(x, y, G.SHORT); };
  if (!cave) spots = spots.filter(sp => {
    if (next(rng) > (sp.mood === 'lush' ? 0.7 : 0.3) || !bushOK(sp.x, sp.y) || !allows(roomAt[i(sp.x, sp.y)], 'bushes')) return true;
    addBush(sp.x, sp.y);
    const run = roll(rng, 0, 2), dirs = D4.filter(([dx, dy]) => wallAt(sp.x + dy, sp.y + dx) || wallAt(sp.x - dy, sp.y - dx));
    const d = dirs.length ? pick(rng, dirs) : null;
    let bx = sp.x, by = sp.y;
    for (let k = 0; d && k < run; k++) { bx += d[0]; by += d[1]; if (!bushOK(bx, by) || !allows(roomAt[i(bx, by)], 'bushes')) break; addBush(bx, by); }
    return false;
  });
  // 125: spots left on props go; grass under a kept spot is cleared.
  spots = spots.filter(s => !propAt(s.x, s.y));   // (propTiles still holds every prop: bushes only come off below)
  for (const s of spots) if (floor.ground[i(s.x, s.y)] === G.GRASS || floor.ground[i(s.x, s.y)] === G.SHORT) floor.ground[i(s.x, s.y)] = 0;
  // Route guard (125, 1.7 blockingPlants): a target open before the bushes and cut after loses the new bushes on its
  // cheapest way in (fewest bushes), with no reward.
  if (before && bushes.length) {
    const after = distancesAround(floor, player, p => p.id === 'bush'), clear = new Set();
    for (const t of targets.filter(t => before[i(t.x, t.y)] >= 0 && after[i(t.x, t.y)] < 0)) for (const k of plantPath(floor, player, t, bushes, clear)) clear.add(k);
    if (clear.size) floor.props = floor.props.filter(p => !(bushes.includes(p) && clear.has(i(p.x, p.y))));
  }
  return spots;
}

/**
 * 1.7 blockingPlants: the way from `from` to `to` crossing the fewest new bushes (a 0-1 search: open floor costs 0, a new
 * bush 1, one already cleared 0; older bushes stay walls). Returns the tile indices of the bushes on it.
 */
function plantPath(floor, from, to, bushes, cleared) {
  const W = floor.w, start = from.y * W + from.x, goal = to.y * W + to.x;
  const plant = new Set(bushes.map(p => p.y * W + p.x)), old = new Set(floor.props.filter(p => p.id === 'bush' && !bushes.includes(p)).map(p => p.y * W + p.x));
  const found = zeroOneSearch(W, floor.h, start, goal, n => (floor.tiles[n] === T.WALL || old.has(n) ? Infinity : plant.has(n) && !cleared.has(n) ? 1 : 0));
  return found ? found.path.slice(1).reverse().filter(k => plant.has(k)) : [];
}

/** Walking distances with the chosen props as walls. */
function distancesAround(floor, from, solidProp) {
  const solid = new Uint8Array(floor.w * floor.h);
  for (const p of floor.props) if (solidProp(p)) solid[p.y * floor.w + p.x] = 1;
  return flood(floor.tiles, floor.w, floor.h, from.y * floor.w + from.x, solid);
}
