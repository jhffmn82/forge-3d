// The Underdark's layout, floors 16-20 (spec/world.md 104-114, 132-134; biomes.json underdark; 1.7 deep.js
// deepPlanRegions, deepPlanRooms, deepCarveCave, deepHall, deepTunnel, deepTry, carveDeepLavaRoom @3c8b312).
// Regions first (drow temple 0, spider underdark 1, volcanic 2, a noise-warped Voronoi), then rooms in their region's
// shape: temple rooms are walled rectangles with doors, underdark caves smooth and round, volcanic caves jagged. Temple
// rooms are joined by straight hallways, anything touching a cave by a wandering tunnel. Volcanic caves of 22+ cells
// get lava (ruled 2026-10-15, world.md answer 4). A failed try is retried with the stream's next draws until one holds
// (answer 5: no fallback to BSP rooms). Draws only from the generation stream it is given.

import biomes from '../../../../data/biomes.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, roll, shuffled, pick } from '../../../lib/rng.js';
import { noise } from '../../../lib/noise.js';
import { T, isDoor } from '../../../data/tiles.js';
import { D4 } from '../../../lib/geometry.js';
import { distanceField, components } from '../../../lib/grid.js';
import { propSolid } from '../../../data/props.js';
import { tunnel, spanningEdges, addLoops, caveReach, chamberDepth } from '../cave-kit.js';
import floors from '../../../../data/floors.json' with { type: 'json' };

const B = biomes.rows.underdark, CC = B.caveCarve;
const [MW, MH] = B.size, N = MW * MH;
const SHAPES = ['rect', 'smooth', 'jag'];
const MAX_TRIES = 400;
const idx = (x, y) => y * MW + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;

/** 104-106: each cell's planned region. One, two or three kinds; floor 20 is temple only. */
export function planRegions(rng, bf, boss) {
  const R = new Uint8Array(N);
  if (boss) return R;
  const r0 = next(rng), n = r0 < 0.3 ? 1 : r0 < 0.7 ? 2 : 3;
  const W = [1.0, 1.3 - 0.1 * bf, 0.45 + 0.25 * bf], kinds = [];
  while (kinds.length < n) {
    let tot = 0;
    for (let k = 0; k < 3; k++) if (!kinds.includes(k)) tot += W[k];
    let r = next(rng) * tot, got = false;
    for (let k = 0; k < 3; k++) { if (kinds.includes(k)) continue; r -= W[k]; if (r <= 0) { kinds.push(k); got = true; break; } }
    if (!got) for (let k = 2; k >= 0; k--) if (!kinds.includes(k)) { kinds.push(k); break; }
  }
  if (n === 1) return R.fill(kinds[0]);
  for (let t = 0; t < B.regions.voronoi.tries; t++) {
    const seeds = shuffled(rng, kinds).map((k, i) => ({ k, x: (i + 0.5) / n * MW + (next(rng) - 0.5) * MW / (n * 2), y: roll(rng, 6, MH - 7), wt: 0.85 + next(rng) * 0.3 }));
    const s1 = Math.floor(next(rng) * 1e6), cnt = [0, 0, 0];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const wx = x + (noise(x * 0.07, y * 0.07, s1) - 0.5) * 18 + (noise(x * 0.2, y * 0.2, s1 + 7) - 0.5) * 4;
      const wy = y + (noise(x * 0.07 + 11, y * 0.07, s1 + 3) - 0.5) * 14 + (noise(x * 0.2 + 5, y * 0.2, s1 + 9) - 0.5) * 4;
      let best = 0, bd = Infinity;
      for (const s of seeds) { const dx = wx - s.x, dy = (wy - s.y) * 1.2, d = Math.sqrt(dx * dx + dy * dy) / s.wt; if (d < bd) { bd = d; best = s.k; } }
      R[idx(x, y)] = best; cnt[best]++;
    }
    if (kinds.every(k => cnt[k] >= N * B.regions.voronoi.minSharePct / 100)) return R;
  }
  return R;
}

/** 108, 132: the room plan. Floor 20: the 21 x 15 hall in the east and up to 3 approach rooms west of it. */
function planRooms(rng, R, boss) {
  const ch = [], want = boss ? 3 : roll(rng, B.rooms.count[0], B.rooms.count[1]);
  const fits = (c, margin) => {
    if (c.x0 < 2 || c.y0 < 2 || c.x0 + c.w > MW - 2 || c.y0 + c.h > MH - 2) return false;
    for (const o of ch) {
      const m = c.reg === 0 && o.reg === 0 ? B.rooms.templeMargin : margin;
      if (c.x0 < o.x0 + o.w + m && o.x0 < c.x0 + c.w + m && c.y0 < o.y0 + o.h + m && o.y0 < c.y0 + c.h + m) return false;
    }
    return true;
  };
  if (boss) {
    const hall = { reg: 0, w: 21, h: 15, hall: true };
    hall.x0 = MW - 2 - hall.w; hall.y0 = (MH - hall.h) >> 1; hall.x = hall.x0 + (hall.w >> 1); hall.y = hall.y0 + (hall.h >> 1);
    ch.push(hall);
    // Sandbox U10 (Justin, 2026-10-16): a longer road to the Matron. Before her hall lies a spider cave or a volcanic cave
    // (half and half), the last room before the hall, so its hallway leaves from the cave; the temple approach rooms
    // stand west of it.
    const reg = next(rng) < 0.5 ? 1 : 2, rx = roll(rng, 5, 6), ry = roll(rng, 4, 5);
    const cave = { reg, rx, ry, x: hall.x0 - B.rooms.margin - rx - 2, y: roll(rng, 4 + ry, MH - 5 - ry), road: true };
    Object.assign(cave, { x0: cave.x - rx, y0: cave.y - ry, w: 2 * rx + 1, h: 2 * ry + 1 });
    if (!fits(cave, B.rooms.margin)) return null;
    ch.push(cave);
    for (let t = 0; t < 500 && ch.length < 5; t++) {
      const c = { reg: 0, w: roll(rng, 5, 8), h: roll(rng, 4, 6) };
      c.x0 = roll(rng, 2, Math.max(2, cave.x0 - c.w - 4)); c.y0 = roll(rng, 2, MH - 2 - c.h); c.x = c.x0 + (c.w >> 1); c.y = c.y0 + (c.h >> 1);
      if (fits(c, B.rooms.margin)) ch.push(c);
    }
    if (ch.length < 4) return null;
    return ch.sort((a, b) => a.x - b.x);
  }
  for (let t = 0; t < B.rooms.tries && ch.length < want; t++) {
    const x = roll(rng, 4, MW - 5), y = roll(rng, 4, MH - 5), reg = R[idx(x, y)], c = { x, y, reg };
    if (reg === 0) {
      const big = next(rng) < 0.2;
      c.w = big ? roll(rng, 9, 12) : roll(rng, 5, 8); c.h = big ? roll(rng, 6, 8) : roll(rng, 4, 6); c.x0 = x - (c.w >> 1); c.y0 = y - (c.h >> 1);
    } else {
      const big = next(rng) < (reg === 2 ? 0.4 : 0.22);
      c.rx = big ? roll(rng, 5, 7) : roll(rng, 3, 5); c.ry = big ? roll(rng, 4, 5) : roll(rng, 3, 4); c.x0 = x - c.rx; c.y0 = y - c.ry; c.w = 2 * c.rx + 1; c.h = 2 * c.ry + 1;
    }
    if (fits(c, B.rooms.margin)) ch.push(c);
  }
  if (ch.length < B.rooms.minRooms) return null;
  ch.sort((a, b) => a.x - b.x);
  if (next(rng) < B.rooms.reversePct / 100) ch.reverse();   // the start at one end, the stairs usually at the other
  return ch;
}

/** 109: an organic chamber, smooth (underdark) or jagged (volcanic); only the part joined to its centre is kept. */
function carveCave(rng, c, g, G, id, salt) {
  const smooth = c.reg === 1, loc = new Uint8Array(N), cells = [];
  for (let y = c.y0 - 1; y <= c.y0 + c.h; y++) for (let x = c.x0 - 1; x <= c.x0 + c.w; x++) {
    if (x < 2 || y < 2 || x > MW - 3 || y > MH - 3) continue;
    const dx = (x - c.x) / c.rx, dy = (y - c.y) / c.ry;
    const wob = smooth ? (noise(x * CC.smooth.noise, y * CC.smooth.noise, salt) - 0.5) * CC.smooth.amp
      : (noise(x * CC.jag.noise, y * CC.jag.noise, salt) - 0.5) * CC.jag.amp + (0.5 - Math.abs(noise(x * CC.jag.ridge.scale, y * CC.jag.ridge.scale, salt + 3) * 2 - 1)) * CC.jag.ridge.amp;
    const d = Math.sqrt(dx * dx + dy * dy) + wob;
    loc[idx(x, y)] = d < CC.open ? 1 : d < CC.band ? (next(rng) < CC.bandOpenPct / 100 ? 1 : 0) : 0;
    cells.push({ x, y, d });
  }
  for (let pass = 0; pass < (smooth ? CC.smooth.rounds : CC.jag.rounds); pass++) {
    const nl = cells.map(q => {
      let walls = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!inb(q.x + ox, q.y + oy) || !loc[idx(q.x + ox, q.y + oy)]) walls++;
      return q.d < CC.forceOpen ? 1 : walls >= 5 ? 0 : 1;
    });
    cells.forEach((q, i) => { loc[idx(q.x, q.y)] = nl[i]; });
  }
  loc[idx(c.x, c.y)] = 1;
  const keep = distanceField(MW, MH, idx(c.x, c.y), k => loc[k]);
  let n = 0;
  for (let k = 0; k < N; k++) if (keep[k] >= 0) { g[k] = 1; if (G[k] < 0) { G[k] = id; n++; } }
  return n;
}

/** 110: a straight L-shaped hallway between temple rooms. */
function hall(rng, g, a, b, vfirst) {
  let x = a.x, y = a.y;
  const hf = vfirst ? false : next(rng) < 0.5;
  const dig = () => { if (x >= 1 && y >= 1 && x < MW - 1 && y < MH - 1) g[idx(x, y)] = 1; };
  dig();
  if (hf) { while (x !== b.x) { x += x < b.x ? 1 : -1; dig(); } while (y !== b.y) { y += y < b.y ? 1 : -1; dig(); } }
  else { while (y !== b.y) { y += y < b.y ? 1 : -1; dig(); } while (x !== b.x) { x += x < b.x ? 1 : -1; dig(); } }
}



/** 111: walkable ground (floor or a door) the start cannot reach; lava is not ground. */
export function unreached(tiles, from) {
  const ok = t => t === T.FLOOR || t === T.DOOR || t === T.BRIDGE || t === T.WATER, d = distanceField(MW, MH, from, i => ok(tiles[i]));
  return tiles.some((t, j) => (t === T.FLOOR || t === T.DOOR) && d[j] < 0);
}

/** 1.7 caveRoomBoxes: a cave room's box, floor count and centre (the deepest cell, nearest the box's middle). */
function caveBoxes(tiles, G, rooms) {
  for (const r of rooms) if (r.cave) {
    let x0 = MW, y0 = MH, x1 = 0, y1 = 0, n = 0;
    for (const k of r.cells) { const x = k % MW, y = (k / MW) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); if (tiles[k] === T.FLOOR) n++; }
    Object.assign(r, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
  }
  const depth = chamberDepth(tiles, G, MW, MH);
  for (const r of rooms) if (r.cave) {
    let best = -Infinity, bi = -1;
    const mx = r.x + r.w / 2, my = r.y + r.h / 2;
    for (const k of r.cells) {
      if (tiles[k] !== T.FLOOR) continue;
      const x = k % MW, y = (k / MW) | 0, sc = depth[k] * 10 - Math.abs(x - mx) - Math.abs(y - my);
      if (sc > best) { best = sc; bi = k; }
    }
    if (bi >= 0) { r.cx = bi % MW; r.cy = (bi / MW) | 0; }
  }
}

/** 112: 1.7 doorSpot, a one-wide gap with passage on both sides. */
function doorSpot(tiles, x, y, across) {
  const at = (a, b) => (inb(a, b) ? tiles[idx(a, b)] : T.WALL);
  const passage = t => t === T.FLOOR || t === T.DOOR || t === T.OPEN_DOOR;
  if (at(x, y) !== T.FLOOR) return false;
  return across ? at(x - 1, y) === T.WALL && at(x + 1, y) === T.WALL && passage(at(x, y - 1)) && passage(at(x, y + 1))
    : at(x, y - 1) === T.WALL && at(x, y + 1) === T.WALL && passage(at(x - 1, y)) && passage(at(x + 1, y));
}

/** A room's cells: a cave's own, a rectangle's every cell. */
export const roomCells = r => {
  if (r.cells) return r.cells.map(k => ({ x: k % MW, y: (k / MW) | 0 }));
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (inb(x, y)) out.push({ x, y });
  return out;
};

/**
 * Lava (ruled on 2026-10-15, biomes.json underdark lava.design; 1.7 carveDeepLavaRoom): a channel along the cave's
 * long axis (60%) or a pool, kept off tunnel mouths and doors, with a ford where it cuts the cave; the cave's heart
 * moves to the ground furthest from it (3+ clear), or the lava is undone.
 */
export function carveLava(rng, tiles, G, room, start) {
  const saved = [], D = B.lava.design;
  const inRoom = (x, y) => inb(x, y) && G[idx(x, y)] === room.id && tiles[idx(x, y)] === T.FLOOR;
  const at = (x, y) => (inb(x, y) ? tiles[idx(x, y)] : T.WALL);
  const okCell = (x, y) => {
    if (!inRoom(x, y)) return false;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const t = at(x + ox, y + oy);
      if (isDoor(t)) return false;
      if (t === T.FLOOR && G[idx(x + ox, y + oy)] !== room.id && (!ox || !oy)) return false;   // a tunnel mouth
    }
    return true;
  };
  const set = (x, y) => { saved.push(idx(x, y)); tiles[idx(x, y)] = T.LAVA; };
  const undo = () => { for (const i of saved) tiles[i] = T.FLOOR; saved.length = 0; };
  const cells = roomCells(room).filter(c => okCell(c.x, c.y));
  if (cells.length < 6) return false;
  if (next(rng) < D.channelPct / 100) {
    const vert = room.h > room.w, off = (next(rng) < 0.5 ? -1 : 1) * roll(rng, 1, 2), w = next(rng) < 0.35 ? 2 : 1;
    const a0 = vert ? room.y : room.x, a1 = vert ? room.y + room.h - 1 : room.x + room.w - 1, mid = (vert ? room.cx : room.cy) + off;
    let b = mid;
    for (let a = a0; a <= a1; a++) {
      if (next(rng) < D.wanderPct / 100) { const nb = b + (next(rng) < 0.5 ? -1 : 1); if (Math.abs(nb - mid) <= 1) b = nb; }
      const ww = w + (next(rng) < D.swellPct / 100 ? 1 : 0);
      for (let k = 0; k < ww; k++) { const x = vert ? b + k : a, y = vert ? a : b + k; if (okCell(x, y)) set(x, y); }
    }
    if (saved.length < 3) undo();   // the channel found no room: a pool instead
  }
  if (!saved.length) {
    const c = pick(rng, cells), size = roll(rng, D.poolBlob[0], D.poolBlob[1]);
    const walk = [[c.x, c.y]], seen = new Set();
    for (let i = 0; i < walk.length && i < size * 3 && seen.size < size; i++) {
      const p = pick(rng, walk), k = idx(p[0], p[1]);
      if (!seen.has(k)) { seen.add(k); if (okCell(p[0], p[1])) set(p[0], p[1]); }
      const d = D4[Math.floor(next(rng) * 4)], nx = p[0] + d[0], ny = p[1] + d[1];
      if (inb(nx, ny)) walk.push([nx, ny]);
    }
  }
  if (saved.length < 3) { undo(); return false; }
  const home = idx(start.cx, start.cy);
  for (let guard = 0; guard < D.fordTries && unreached(tiles, home); guard++) {
    const mid = saved[Math.floor(saved.length / 2 + (next(rng) - 0.5) * saved.length * 0.5)];
    if (mid === undefined) break;
    const mx = mid % MW, my = (mid / MW) | 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!inb(mx + ox, my + oy)) continue;
      const i = idx(mx + ox, my + oy);
      if (tiles[i] === T.LAVA) { tiles[i] = T.FLOOR; saved.splice(saved.indexOf(i), 1); }
    }
  }
  if (unreached(tiles, home) || saved.length < 3) { undo(); return false; }
  let best = null, bs = -1;
  for (const c of roomCells(room)) {
    if (at(c.x, c.y) !== T.FLOOR) continue;
    let dl = 9;
    for (const i of saved) dl = Math.min(dl, Math.max(Math.abs(i % MW - c.x), Math.abs(((i / MW) | 0) - c.y)));
    if (dl < D.heartClear) continue;
    let open = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (at(c.x + ox, c.y + oy) === T.FLOOR) open++;
    const sc = open * 10 + Math.min(dl, 5);
    if (sc > bs) { bs = sc; best = c; }
  }
  if (!best || bs < D.heartScoreMin) { undo(); return false; }
  room.cx = best.x; room.cy = best.y; room.lava = true;
  return true;
}

/** One try (1.7 deepTry). Null when it fails. */
function tryOnce(rng, { bf, boss }) {
  const R = planRegions(rng, bf, boss);
  const ch = planRooms(rng, R, boss);
  if (!ch) return null;
  const g = new Uint8Array(N), G = new Int16Array(N).fill(-1), salt = Math.floor(next(rng) * 1e6);
  ch.forEach((c, k) => {
    if (c.reg === 0) { for (let y = c.y0; y < c.y0 + c.h; y++) for (let x = c.x0; x < c.x0 + c.w; x++) g[idx(x, y)] = 1; c.n = c.w * c.h; c.ax = c.x0 + (c.w >> 1); c.ay = c.y0 + (c.h >> 1); }
    else { c.n = carveCave(rng, c, g, G, k, salt + k * 101); c.ax = c.x; c.ay = c.y; }
  });
  // 110: a spanning tree over the anchors (the boss hall joined last), then 1-2 loops.
  const edges = spanningEdges(ch.length, (ia, b, joined) => Math.hypot(ch[ia].ax - ch[b].ax, (ch[ia].ay - ch[b].ay) * 1.3) + (boss && ch[b].hall && joined < ch.length - 1 ? floors.rows['underdark-boss-approach'].hallEdgeCost : 0));
  addLoops(rng, ch.length, edges, boss ? 0 : roll(rng, B.connections.loops[0], B.connections.loops[1]), B.connections.loopTries,
    (p, q) => Math.hypot(ch[p].ax - ch[q].ax, ch[p].ay - ch[q].ay) <= B.connections.maxLoopLength);
  for (const [ea, eb] of edges) {
    const A = ch[ea], Bb = ch[eb];
    if (A.hall || Bb.hall) { const o = A.hall ? Bb : A, H = A.hall ? A : Bb; hall(rng, g, { x: o.ax, y: o.ay }, { x: H.x0 + 1, y: H.y0 + (H.h >> 1) }, true); continue; }
    if (A.reg === 0 && Bb.reg === 0) hall(rng, g, { x: A.ax, y: A.ay }, { x: Bb.ax, y: Bb.ay });
    else tunnel(rng, g, MW, MH, { x: A.ax, y: A.ay }, { x: Bb.ax, y: Bb.ay }, (A.reg === 1 || Bb.reg === 1) && next(rng) < B.connections.tunnel.widePct / 100, B.connections.tunnel, 2);
  }
  const tiles = new Uint8Array(N);
  for (let i = 0; i < N; i++) tiles[i] = g[i] ? T.FLOOR : T.WALL;
  // 111: whatever the start cannot reach goes back to rock.
  const reach = caveReach(tiles, MW, MH, idx(ch[0].ax, ch[0].ay));
  let open = 0;
  for (let i = 0; i < N; i++) { if (tiles[i] === T.FLOOR && !reach[i]) { tiles[i] = T.WALL; G[i] = -1; } if (tiles[i] === T.FLOOR) open++; }
  if (open < (boss ? B.validity.bossMinOpenCells : B.validity.minOpenCells)) return null;
  if (ch.some(c => !reach[idx(c.ax, c.ay)])) return null;
  const rooms = [];
  for (let k = 0; k < ch.length; k++) {
    const c = ch[k];
    let r;
    if (c.reg === 0) { r = { x: c.x0, y: c.y0, w: c.w, h: c.h, cx: c.x0 + (c.w >> 1), cy: c.y0 + (c.h >> 1), id: k, n: c.n }; if (c.hall) r.hall = true; }
    else {
      const cells = [];
      for (let i = 0; i < N; i++) if (G[i] === k && tiles[i] === T.FLOOR) cells.push(i);
      if (cells.length < B.validity.caveMinCells) { for (let i = 0; i < N; i++) if (G[i] === k) G[i] = -1; if (k === 0) return null; continue; }
      r = { id: k, cave: true, cells, ...(c.road ? { road: true } : {}) };
    }
    r.region = c.reg; r.shape = SHAPES[c.reg];
    rooms.push(r);
  }
  caveBoxes(tiles, G, rooms);
  const start = rooms[0];
  // 112: doors where hallways meet the built rooms.
  for (const r of rooms) {
    if (r.cave || r.hall) continue;
    const tryDoor = (x, y, across) => { if (doorSpot(tiles, x, y, across) && next(rng) < B.doors.chancePct / 100) tiles[idx(x, y)] = T.DOOR; };
    for (let x = r.x; x < r.x + r.w; x++) { tryDoor(x, r.y - 1, true); tryDoor(x, r.y + r.h, true); }
    for (let y = r.y; y < r.y + r.h; y++) { tryDoor(r.x - 1, y, false); tryDoor(r.x + r.w, y, false); }
  }
  // 107: each room's cells take its own region.
  for (const r of rooms) for (const c of roomCells(r)) R[idx(c.x, c.y)] = r.region;
  // Lava in the volcanic caves of 22+ cells (not the start).
  if (B.lava.design) for (const r of shuffled(rng, rooms.filter(o => o.region === 2 && o !== start && o.cave && o.n >= B.lava.design.minCells))) carveLava(rng, tiles, G, r, start);   // floor 20's volcanic road too (U10)
  if (unreached(tiles, idx(start.cx, start.cy))) return null;
  return { w: MW, h: MH, tiles, rooms, region: R, field: R.slice(), caveRoom: G, lava: tiles.some(t => t === T.LAVA) };
}

/**
 * An Underdark layout from the generation stream. Tries until one holds (answer 5); `tries` says how many it took.
 * @returns {{w,h,tiles:Uint8Array, rooms:object[], region:Uint8Array, field:Uint8Array, caveRoom:Int16Array, lava:boolean, tries:number}}
 */
export function layoutUnderdark(rng, { bf = 1, boss = false } = {}) {
  for (let t = 1; t <= MAX_TRIES; t++) {
    const lay = tryOnce(rng, { bf, boss });
    if (lay) return Object.assign(lay, { tries: t });
  }
  throw new Error('Underdark layout: no try held in ' + MAX_TRIES);
}

export { MW, MH };

/**
 * Would blocking these cells cut part of a room off (4-way)? Counts the pieces the room's open floor falls into before
 * and after; a kept piece may never add one (census 93cfcf4: floor 17 run 41, a ritual altar, cage and two braziers
 * closed a cell against the wall; a forge's brazier and torch stand, a shrine's statue and banner the same). Solid
 * props and chests (nobody stands on one) count as shut.
 * @param {{x:number,y:number}[]} cells the room's cells
 */
export function splitsRoom(floor, cells, add) {
  const W = floor.w, solid = new Set();
  for (const p of floor.props) if (propSolid(p)) solid.add(p.y * W + p.x);
  const pieces = extra => {
    const open = new Set(cells.map(c => c.y * W + c.x).filter(k => !solid.has(k) && !extra.has(k) && floor.tiles[k] === T.FLOOR));
    return components(W, floor.h, k => open.has(k)).count;
  };
  return pieces(new Set(add.map(c => c.y * W + c.x))) > pieces(new Set());
}
