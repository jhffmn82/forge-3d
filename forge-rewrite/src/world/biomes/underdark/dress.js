// The Underdark's dressing (spec/world.md 107, 114-131; biomes.json underdark themes, dressing, curtains, vegetation,
// furniture; 1.7 deep.js deepThemeRoom, deepFinishRegions, deepDress, deepCurtains, deepLavaLights,
// growDeepVegetation, carveDeepPassage, propDeepTheme @3c8b312). Each room is dressed by its region: drow shrines,
// pillar rows, ritual circles and blood fonts in the temple; web nurseries of cocoons in the spider caves and web
// curtains across their tunnels; lava forges and embers in the volcanic caves. Draws only from the stream given.

import biomes from '../../../../data/biomes.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, roll, shuffled, pick } from '../../../lib/rng.js';
import { T, G, isDoor } from '../../../data/tiles.js';
import { hash2, noise } from '../../../lib/noise.js';
import { nearDoor, remapExempt } from '../../dress.js';
import { roomCells } from './layout.js';
import { D4 } from '../../../lib/geometry.js';
import { distanceField, components } from '../../../lib/grid.js';
import { placePiece } from '../../pieces.js';

const B = biomes.rows.underdark, P = props.rows;
const REGION_NAMES = ['temple', 'underdark', 'volcanic'];
const BIG = /^(blood-font|candelabra-tall|cocoon-large|egg-sac|drow-|spider-idol|lava-forge|ritual-circle|stairs-down-drow)/;

const at = (f, x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? T.WALL : f.tiles[y * f.w + x]);
const wallLike = (f, x, y) => { const t = at(f, x, y); return t === T.WALL || t === T.SECRET; };
const propAt = (f, x, y) => f.props.find(p => p.x === x && p.y === y) ?? null;
const itemAt = (f, x, y) => f.items.some(i => i.x === x && i.y === y) || f.chests.some(c => c.x === x && c.y === y);
export const lavaBeside = (f, x, y) => D4.some(([dx, dy]) => at(f, x + dx, y + dy) === T.LAVA);

/** Which room each tile belongs to: a cave by its own cells, a rectangle by its box (pockets included). */
export function caveGrid(floor, rooms) {
  const g = new Int16Array(floor.w * floor.h).fill(-1);
  rooms.forEach((r, k) => {
    if (r.cells) { for (const i of r.cells) g[i] = k; return; }
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) g[y * floor.w + x] = k;
  });
  return g;
}

/** A piece; a multi-cell piece adds its other cells (same id, `part` pointing at the head, blocking as it does). */
export const place = (floor, id, x, y, extra = {}) => placePiece(floor, id, x, y, { headFirst: { deep: true }, head: extra, part: { deep: true } });

/** 118: a free cell of this room: floor, nothing on it, not by a door or tunnel mouth, not beside lava, not its heart. */
function free(f, grid, rooms, x, y, r) {
  if (at(f, x, y) !== T.FLOOR || propAt(f, x, y) || itemAt(f, x, y) || nearDoor(f, grid, x, y) || lavaBeside(f, x, y)) return false;
  if (r && (rooms[grid[y * f.w + x]] !== r || (x === r.cx && y === r.cy))) return false;
  return true;
}
const foot = (f, grid, rooms, x, y, w, h, r) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!free(f, grid, rooms, xx, yy, r)) return false; return true; };

/** 118: a spot for a standing piece backed by rock above every column, open floor in front, never a notch. */
function backedSpot(rng, f, grid, rooms, r, w, h) {
  for (const c of shuffled(rng, roomCells(r))) {
    if (!foot(f, grid, rooms, c.x, c.y, w, h, r)) continue;
    let backed = true;
    for (let xx = c.x; xx < c.x + w; xx++) if (!wallLike(f, xx, c.y - 1)) backed = false;
    if (!backed) continue;
    let front = 0;
    for (let fx = c.x - 1; fx <= c.x + w; fx++) if (at(f, fx, c.y + h) === T.FLOOR && !propAt(f, fx, c.y + h)) front++;
    if (front < w + 1) continue;
    if (wallLike(f, c.x - 1, c.y + h - 1) && wallLike(f, c.x + w, c.y + h - 1)) continue;
    return c;
  }
  return null;
}
function backed(rng, f, grid, rooms, r, id, extra) {
  const fp = P[id]?.footprint ?? { w: 1, h: 1 }, s = backedSpot(rng, f, grid, rooms, r, fp.w, fp.h);
  return s ? place(f, id, s.x, s.y, extra) : null;
}

/** 115-117, 119: a room's set piece by its region (special: a themed special room, more likely a nursery). */
export function themeRoom(rng, floor, grid, rooms, r, special = false) {
  if (r.pocket || r.hall) return;
  const reg = r.region ?? 0, roll0 = next(rng), done = (floor.udDone ??= {}), big = (r.n ?? r.w * r.h) >= 30;
  const ok = (x, y) => free(floor, grid, rooms, x, y, r);
  if (reg === 0) {
    if (roll0 < 0.16 && !done.altar) {
      done.altar = 1; r.deepTheme = 'altar';
      const al = backed(rng, floor, grid, rooms, r, next(rng) < 0.5 ? 'drow-altar' : 'drow-altar-blood');
      if (al) for (const dx of [-1, 2]) if (ok(al.x + dx, al.y) && wallLike(floor, al.x + dx, al.y - 1)) place(floor, next(rng) < 0.6 ? 'spider-idol' : 'candelabra-tall', al.x + dx, al.y);
    } else if (roll0 < 0.34 && r.w >= 7 && r.h >= 5 && !r.cave) {
      r.deepTheme = 'pillars';
      for (let px = r.x + 1; px <= r.x + r.w - 2; px += 2) {
        const mx = r.x + r.w - 1 - (px - r.x);
        if (mx < px) break;
        for (const py of [r.y + 1, r.y + r.h - 2]) for (const xx of [px, mx]) if (ok(xx, py)) place(floor, next(rng) < 0.2 ? 'drow-pillar-broken' : 'drow-pillar', xx, py);
      }
    } else if (roll0 < 0.44 && big && !done.ritual) {   // Justin 2026-10-19: the ritual circle comes back (item 204 had dropped it)
      const cs = shuffled(rng, roomCells(r)).find(c => foot(floor, grid, rooms, c.x - 1, c.y - 1, 4, 4, r));
      if (cs) { done.ritual = 1; r.deepTheme = 'ritual'; place(floor, 'ritual-circle', cs.x, cs.y); }
    } else if (roll0 < 0.54) {
      r.deepTheme = 'font'; backed(rng, floor, grid, rooms, r, 'blood-font');
    } else if (roll0 < 0.64 && r.w >= 6) {
      r.deepTheme = 'obelisks';
      const o1 = backed(rng, floor, grid, rooms, r, 'drow-obelisk');
      if (o1 && !r.cave) { const ox = r.x + r.w - 1 - (o1.x - r.x); if (ox !== o1.x && ok(ox, o1.y) && wallLike(floor, ox, o1.y - 1)) place(floor, 'drow-obelisk', ox, o1.y); }
    }
  } else if (reg === 1) {
    if (roll0 < (special ? 0.9 : 0.38) && (done.nursery ?? 0) < 2) {
      done.nursery = (done.nursery ?? 0) + 1; r.deepTheme = 'nursery';
      const nc = roll(rng, 2, big ? 4 : 3);
      for (let i = 0; i < nc; i++) backed(rng, floor, grid, rooms, r, next(rng) < 0.5 ? 'cocoon-large-1' : 'cocoon-large-2', { hatch: true });
      if (next(rng) < 0.7) backed(rng, floor, grid, rooms, r, 'egg-sac-cluster', { hatch: true });
    } else if (roll0 < 0.52) { r.deepTheme = 'ruin'; backed(rng, floor, grid, rooms, r, 'drow-pillar-broken'); }
  } else if (roll0 < 0.24 && !done.forge && !r.lava) {
    if (backed(rng, floor, grid, rooms, r, 'lava-forge')) { done.forge = 1; r.deepTheme = 'forge'; }
  } else if (roll0 < 0.36) { r.deepTheme = 'obelisks'; backed(rng, floor, grid, rooms, r, 'drow-obelisk'); }
}

/** 126: the shared builders' furniture, mapped by the region it stands in (null: nothing here). */
export function mapFurniture(rng, floor) {
  const R = floor.region;
  if (!R) return;
  floor.props = floor.props.filter(p => {
    if (remapExempt(p)) return true;
    const table = B.furniture[REGION_NAMES[R[p.y * floor.w + p.x]]] ?? {};
    if (!(p.id in table)) return true;
    const to = table[p.id];
    if (to === null) return false;
    p.id = typeof to === 'string' ? to : pick(rng, to);
    return true;
  });
}

/** The eight neighbours row by row from the top left, the order 1.7's region spread tries them. */
const ROW_ORDER = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** 107: open ground keeps its region (rooms their own); rock takes the nearest open cell's, or the planned field 2+ away. */
export function finishRegions(floor, rooms) {
  const R = floor.region, src = floor.regionField, W = floor.w, H = floor.h, N = W * H;
  if (!R || !src) return;
  const open = k => { const t = floor.tiles[k]; return t !== T.WALL && t !== T.SECRET; };
  for (const r of rooms) {
    if (r.region === undefined || r.region === null) { r.region = src[Math.max(0, Math.min(H - 1, r.cy)) * W + Math.max(0, Math.min(W - 1, r.cx))]; r.shape = ['rect', 'smooth', 'jag'][r.region]; }
    for (const c of roomCells(r)) if (open(c.y * W + c.x)) R[c.y * W + c.x] = r.region;
  }
  const from = []; for (let i = 0; i < N; i++) if (open(i)) from.push(i);
  const d = distanceField(W, H, from, () => true, { dirs: ROW_ORDER, visit: (n, c) => { R[n] = R[c]; } });
  for (let i = 0; i < N; i++) if (d[i] >= 2) R[i] = src[i];
}

/** A big piece within a tile of (x, y)? Clusters keep away from them. */
function nearBig(f, x, y) {
  for (const q of f.props) {
    if (q.part || q.wall || !BIG.test(q.id)) continue;
    if (x >= q.x - 1 && x <= q.x + (q.w ?? 1) && y >= q.y - 1 && y <= q.y + (q.h ?? 1)) return true;
  }
  return false;
}
const wallSide = (f, x, y) => D4.some(([dx, dy]) => wallLike(f, x + dx, y + dy));
const trapAt = (f, x, y) => f.traps.some(t => t.x === x && t.y === y);

/** 124: a streak of 2-3 clusters along the foot of a wall (never one alone). */
function streak(rng, f, grid, rooms, r, base, lo, hi) {
  const okS = (x, y) => free(f, grid, rooms, x, y, r) && wallSide(f, x, y) && !nearBig(f, x, y) && !trapAt(f, x, y);
  const starts = shuffled(rng, roomCells(r).filter(c => okS(c.x, c.y)));
  for (let t = 0; t < starts.length && t < B.dressing.streakStarts; t++) {
    const run = [starts[t]], want = roll(rng, lo, hi), seen = new Set([`${starts[t].x},${starts[t].y}`]);
    for (let g = 0; g < 20 && run.length < want; g++) {
      const from = run[run.length - 1], nb = D4.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy })).filter(c => !seen.has(`${c.x},${c.y}`) && okS(c.x, c.y));
      if (!nb.length) break;
      const n = pick(rng, nb);
      seen.add(`${n.x},${n.y}`); run.push(n);
    }
    if (run.length < lo) continue;
    const v = Math.floor(next(rng) * 4);
    run.forEach((c, i) => place(f, `${base}-${1 + ((v + i) % 4)}`, c.x, c.y));
    return run.length;
  }
  return 0;
}

/** 122: a joined patch of 3-5 web tiles anywhere in the room, or nothing. */
function patch(rng, f, grid, rooms, r, base) {
  const cells = shuffled(rng, roomCells(r).filter(c => free(f, grid, rooms, c.x, c.y, r) && !nearBig(f, c.x, c.y)));
  const s = cells[0];
  if (!s) return 0;
  const out = [s], seen = new Set([`${s.x},${s.y}`]), want = roll(rng, 3, 5);
  for (let t = 0; t < 30 && out.length < want; t++) {
    const fr = pick(rng, out), d = D4[Math.floor(next(rng) * 4)], nx = fr.x + d[0], ny = fr.y + d[1];
    if (seen.has(`${nx},${ny}`) || !free(f, grid, rooms, nx, ny, r) || nearBig(f, nx, ny)) continue;
    seen.add(`${nx},${ny}`); out.push({ x: nx, y: ny });
  }
  if (out.length < 3) return 0;
  for (const c of out) place(f, `${base}-${1 + Math.floor(next(rng) * 4)}`, c.x, c.y);
  return out.length;
}

/** 121-122: a piece hung on the wall face above a room's floor; corners for webs. */
function wallPiece(rng, f, grid, rooms, r, id, corner) {
  const cells = shuffled(rng, roomCells(r).filter(c => {
    if (at(f, c.x, c.y) !== T.FLOOR || nearDoor(f, grid, c.x, c.y) || !wallLike(f, c.x, c.y - 1) || at(f, c.x, c.y - 1) === T.SECRET || propAt(f, c.x, c.y - 1) || !wallLike(f, c.x, c.y - 2)) return false;
    if (corner) return wallLike(f, c.x - 1, c.y) || wallLike(f, c.x + 1, c.y);
    return !wallLike(f, c.x - 1, c.y) && !wallLike(f, c.x + 1, c.y) && wallLike(f, c.x - 1, c.y - 1) && wallLike(f, c.x + 1, c.y - 1);
  }));
  const c = cells[0];
  return c ? place(f, id, c.x, c.y - 1, { wall: true, flip: corner ? wallLike(f, c.x + 1, c.y) : false }) : null;
}

/** 120-124: the dressing pass, flat clusters and wall pieces, then clusters touching a big piece go. */
export function dressFloor(rng, f, rooms, grid, only = null) {
  const TH = f.udKinds ??= {
    temple: next(rng) < 0.5 ? ['candles-scarlet'] : next(rng) < 0.5 ? ['obsidian-shards'] : ['candles-scarlet', 'obsidian-shards'],
    volcanic: next(rng) < 0.6 ? ['basalt-embers'] : ['basalt-embers', 'obsidian-shards'],
  };
  for (const r of rooms) {
    if (r.pocket || r.hall || r.w < 3 || r.h < 3 || (only && !only(r))) continue;
    const reg = r.region ?? 0;
    if (reg === 0) {
      if (next(rng) < (r.deepTheme ? 0.6 : 0.35)) streak(rng, f, grid, rooms, r, pick(rng, TH.temple), 2, 3);
      if (next(rng) < 0.4) {
        const b1 = wallPiece(rng, f, grid, rooms, r, 'silk-banner-' + (1 + Math.floor(next(rng) * 2)), false);
        if (b1 && !r.cave && next(rng) < 0.6) {
          const mx = r.x + r.w - 1 - (b1.x - r.x);
          if (mx !== b1.x && at(f, mx, b1.y + 1) === T.FLOOR && wallLike(f, mx, b1.y) && !propAt(f, mx, b1.y) && !nearDoor(f, grid, mx, b1.y + 1)) place(f, b1.id, mx, b1.y, { wall: true });
        }
      }
    } else if (reg === 1) {
      const nurse = r.deepTheme === 'nursery';
      if (nurse || next(rng) < 0.3) patch(rng, f, grid, rooms, r, 'web-floor');
      if (nurse && next(rng) < 0.8) streak(rng, f, grid, rooms, r, 'cocoons-small', 2, 3);
      const nw = nurse ? roll(rng, 1, 3) : next(rng) < 0.5 ? 1 : 0;
      for (let i = 0; i < nw; i++) wallPiece(rng, f, grid, rooms, r, 'web-corner-' + (1 + Math.floor(next(rng) * 2)), true);
    } else if (next(rng) < (r.lava ? 0.55 : 0.35)) streak(rng, f, grid, rooms, r, pick(rng, TH.volcanic), 2, 3);
  }
  f.props = f.props.filter(p => p.keep || !(P[p.id]?.cluster && nearBig(f, p.x, p.y)));
  // Small cocoon clusters hatch 2-3 spiderlings (ruled 2026-10-15, answer 7).
  for (const p of f.props) if (/^cocoons-small-/.test(p.id)) p.hatch = true;
}

/** 125: web curtains across the spider caves' one-wide straight tunnels (1-3 a floor, 6 apart). */
export function curtains(rng, f, grid, bodies) {
  const want = roll(rng, B.curtains.perFloor[0], B.curtains.perFloor[1]), cells = [], placed = [];
  const near = (x, y) => { for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const t = at(f, x + ox, y + oy); if (isDoor(t) || t === T.STAIRS || t === T.STAIRS_UP || t === T.CHEST || t === T.PORTAL || t === T.EXIT) return true; } return false; };
  for (let y = 2; y < f.h - 2; y++) for (let x = 2; x < f.w - 2; x++) {
    const k = y * f.w + x;
    if (at(f, x, y) !== T.FLOOR || grid[k] >= 0 || f.region[k] !== 1 || propAt(f, x, y) || itemAt(f, x, y) || trapAt(f, x, y) || bodies.some(b => b.x === x && b.y === y)) continue;
    const ns = wallLike(f, x - 1, y) && wallLike(f, x + 1, y) && at(f, x, y - 1) === T.FLOOR && at(f, x, y + 1) === T.FLOOR;
    const ew = wallLike(f, x, y - 1) && wallLike(f, x, y + 1) && at(f, x - 1, y) === T.FLOOR && at(f, x + 1, y) === T.FLOOR;
    if ((!ns && !ew) || near(x, y)) continue;
    cells.push({ x, y, ns });
  }
  let n = 0;
  for (const c of shuffled(rng, cells)) {
    if (n >= want) break;
    if (placed.some(p => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < B.curtains.spacing)) continue;
    place(f, c.ns ? 'web-curtain-h' : 'web-curtain-v', c.x, c.y, { keep: false });
    placed.push(c); n++;
  }
  return n;
}

/** Lava lights: one every four cells of each flow, a phase from the cell's hash (1.7 deepLavaLights). */
export function lavaLights(f) {
  const out = [];
  for (const flow of components(f.w, f.h, k => f.tiles[k] === T.LAVA, { lists: true }).lists) {
    const cells = flow.map(c => [c % f.w, (c / f.w) | 0]);
    const k = Math.max(1, Math.round(cells.length / 4));
    for (let j = 0; j < k; j++) { const cc = cells[Math.floor((j + 0.5) * cells.length / k)]; out.push({ kind: 'lava', x: cc[0], y: cc[1], phase: hash2(cc[0], cc[1], 7) * 6.28 }); }
  }
  return out;
}

/**
 * 128-130: the Underdark grows its own greenery. Violet cave grass along the damp walls of the spider caves and the
 * odd tuft in their tunnels, fungus clumps (a third glowing faintly), ashweed stands in the volcanic caves; the temple
 * stays clean stone. One growth per tile. Returns the spots.
 */
export function vegetation(rng, f, rooms, grid, player) {
  const V = B.vegetation, salt = Math.floor(next(rng) * 1e6), W = f.w, spots = [];
  for (let i = 0; i < f.ground.length; i++) if (f.ground[i] === G.GRASS || f.ground[i] === G.SHORT || f.ground[i] === G.MOSS) f.ground[i] = 0;
  const wallN = (x, y) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && wallLike(f, x + dx, y + dy)) n++; return n; };
  const ok = (x, y) => at(f, x, y) === T.FLOOR && !f.ground[y * W + x] && !propAt(f, x, y) && !lavaBeside(f, x, y) && Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) > 1;
  for (const r of rooms) {
    if (r.region !== 1 || r.role === 'boss') continue;
    let mood = next(rng) < 0.3 ? 'bare' : next(rng) < 0.6 ? 'some' : 'lush';
    if (r.role === 'start' && mood === 'lush') mood = 'some';
    r.greenery = mood;
    if (mood === 'bare') continue;
    for (const c of roomCells(r)) {
      if (!ok(c.x, c.y)) continue;
      const n = wallN(c.x, c.y), m = (n >= 3 ? V.wallTerm['3+'] : n >= 1 ? V.wallTerm['1+'] : 0) + (noise(c.x * 0.33, c.y * 0.33, salt + 1) - 0.5) * V.noiseAmp + (mood === 'lush' ? V.lushBonus : 0);
      if (m > V.grassAbove && mood === 'lush') f.ground[c.y * W + c.x] = G.GRASS;
      else if (m > V.trampledAbove) f.ground[c.y * W + c.x] = G.SHORT;
      if (m > V.fungus.above && n >= 1 && hash2(c.x, c.y, salt + 5) < V.fungus.hashMax) spots.push({ x: c.x, y: c.y, kind: 'fungus' });
    }
  }
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
    if (grid[y * W + x] >= 0 || f.region[y * W + x] !== 1 || !ok(x, y) || !wallN(x, y)) continue;
    if (noise(x * 0.5, y * 0.5, salt + 3) > V.tunnelTufts.noiseAbove && hash2(x, y, salt + 4) < V.tunnelTufts.hashMax) f.ground[y * W + x] = G.SHORT;
  }
  for (const r of rooms) {
    if (r.region !== 2 || next(rng) > V.ashweed.roomPct / 100) continue;
    const s = shuffled(rng, roomCells(r).filter(c => ok(c.x, c.y) && wallN(c.x, c.y) >= 1))[0];
    if (!s) continue;
    const stand = [s], seen = new Set([`${s.x},${s.y}`]);
    for (let t = 0; t < 24 && stand.length < roll(rng, V.ashweed.stand[0], V.ashweed.stand[1]); t++) {
      const fr = pick(rng, stand), d = D4[Math.floor(next(rng) * 4)], nx = fr.x + d[0], ny = fr.y + d[1];
      if (seen.has(`${nx},${ny}`) || !ok(nx, ny) || rooms[grid[ny * W + nx]] !== r) continue;
      seen.add(`${nx},${ny}`); stand.push({ x: nx, y: ny });
    }
    if (stand.length >= 3) for (const c of stand) spots.push({ x: c.x, y: c.y, kind: 'ashweed' });
  }
  // Sandbox U14 (Justin, 2026-10-16): the spider caves are lit only by their plants, and a thin seed grows 6 clumps
  // where another grows 15, so a floor with 60+ cells of spider cave gets at least 8: more along the cave walls.
  const caveRooms = rooms.filter(r => r.region === 1 && r.role !== 'boss' && !r.pocket);
  const caveCells = caveRooms.flatMap(r => roomCells(r)).filter(c => at(f, c.x, c.y) === T.FLOOR);
  const fungus = () => spots.filter(sp => sp.kind === 'fungus').length;
  if (caveCells.length >= 60 && fungus() < 8) {
    const taken = new Set(spots.map(sp => sp.y * W + sp.x));
    const wallSide = caveCells.filter(c => ok(c.x, c.y) && wallN(c.x, c.y) >= 2 && !taken.has(c.y * W + c.x))
      .sort((a, b) => hash2(a.x, a.y, salt + 21) - hash2(b.x, b.y, salt + 21));
    for (const c of wallSide) {
      if (fungus() >= 8) break;
      if (spots.some(sp => Math.max(Math.abs(sp.x - c.x), Math.abs(sp.y - c.y)) < 3)) continue;   // spread out, not one clump
      spots.push({ x: c.x, y: c.y, kind: 'fungus', topUp: true });
    }
  }
  const seenK = new Set();
  const kept = spots.filter(sp => { const k = sp.y * W + sp.x; if (seenK.has(k) || propAt(f, sp.x, sp.y)) return false; seenK.add(k); return true; });
  for (const sp of kept) { const k = sp.y * W + sp.x; if (f.ground[k] === G.GRASS || f.ground[k] === G.SHORT) f.ground[k] = 0; }
  return { spots: kept };
}

/**
 * The plants' own light as 1.7 lights them today (deeprender.js deepPlantLighting): every fungus and ashweed spot and
 * every tall-grass tile of the spider caves is a candidate; planted spots first, then grass, each in hash order (the
 * run's surface salt), one taken unless another taken light is nearer than its spacing. Light just below the plant.
 */
export function plantLights(f, spots, salt) {
  const L = B.vegetation.plantLights, s = salt + L.saltPlus, W = f.w, out = [];
  const cands = spots.filter(p => L[p.kind] && f.region[p.y * W + p.x] === L[p.kind].region).map(p => ({ x: p.x, y: p.y, kind: p.kind }));
  for (let i = 0; i < f.ground.length; i++) if (f.ground[i] === G.GRASS && f.region[i] === L.gloomgrass.region) cands.push({ x: i % W, y: (i / W) | 0, kind: 'gloomgrass' });
  cands.map(p => ({ p, h: hash2(p.x, p.y, s) }))
    .sort((a, b) => (a.p.kind === 'gloomgrass') - (b.p.kind === 'gloomgrass') || a.h - b.h || a.p.y - b.p.y || a.p.x - b.p.x)
    .forEach(({ p }) => {
      const row = L[p.kind];
      if (out.some(q => Math.hypot(p.x - q.x, p.y - (q.y - 0.2)) < row.apart)) return;
      out.push({ kind: 'glow', plant: p.kind, x: p.x, y: p.y + 0.2, colour: row.col, radius: row.r, strength: row.s, ...(p.kind === 'gloomgrass' ? { needsGround: G.GRASS } : {}) });   // trampled grass goes dark
    });
  return out;
}

/**
 * 114: stairs (down or up) at the end of a passage 2-4 long cut north into the rock from a room cell (rock on both
 * sides of every passage cell, rock past the end), so the drow stairway's arch sits in the rock face. Null if none fits.
 */
export function northPassage(rng, f, room) {
  const cells = shuffled(rng, roomCells(room)).filter(c => at(f, c.x, c.y) === T.FLOOR && !propAt(f, c.x, c.y) && wallLike(f, c.x, c.y - 1) && !lavaBeside(f, c.x, c.y) && !(c.x === room.cx && c.y === room.cy));
  for (const c of cells) {
    const len = roll(rng, B.stairs.length[0], B.stairs.length[1]), run = [];
    let ok = true;
    for (let i = 1; i <= len && ok; i++) {
      const y = c.y - i;
      if (y < 2 || at(f, c.x, y) !== T.WALL || at(f, c.x - 1, y) !== T.WALL || at(f, c.x + 1, y) !== T.WALL) ok = false; else run.push({ x: c.x, y });
    }
    const ey = c.y - len - 1;
    if (!ok || ey < 1 || at(f, c.x, ey) !== T.WALL || at(f, c.x - 1, ey) !== T.WALL || at(f, c.x + 1, ey) !== T.WALL) continue;
    for (const p of run) f.tiles[p.y * f.w + p.x] = T.FLOOR;
    return run[run.length - 1];
  }
  return null;
}

/** 131: no grass beside lava; standing water has no place in the volcanic caves (outside pockets). */
export function settle(f, rooms, grid) {
  for (let i = 0; i < f.tiles.length; i++) {
    if (f.tiles[i] === T.LAVA) {
      const x = i % f.w, y = (i / f.w) | 0;
      for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue; const n = ny * f.w + nx; if (f.ground[n] === G.GRASS || f.ground[n] === G.SHORT) f.ground[n] = 0; }
    }
    if (f.tiles[i] === T.WATER && f.region[i] === 2 && !rooms[grid[i]]?.pocket) f.tiles[i] = T.FLOOR;
  }
}
