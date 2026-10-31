// The Caverns' layout (biome 3, floors 11-15; biomes.json caverns, floors.json caverns-maw-arena): cellular-automata
// chambers joined by narrow wandering tunnels, a rift crossed by rope bridges, sometimes a pit to walk round. Same seed,
// same rock as 1.7 (js/world/biomes/caverns/caverns.js cavePlan, caveTry, caveTunnel, caveRift, caveVoidPit,
// caveRoomBoxes @3c8b312): every die is drawn in 1.7's order. Each chamber is a room whose box is its bounding box;
// `cave` says which cells really belong to it (-1: rock or tunnel), so edges and interiors follow the rock.

import biomes from '../../../../data/biomes.json' with { type: 'json' };
import floors from '../../../../data/floors.json' with { type: 'json' };
import { next, roll, shuffled, pick } from '../../../lib/rng.js';
import { T } from '../../../data/tiles.js';
import { noise } from '../../../lib/noise.js';
import { blob } from '../../../lib/grid.js';

import { tunnel, spanningEdges, addLoops, caveReach, chamberDepth } from '../cave-kit.js';

const B = biomes.rows.caverns, A = floors.rows['caverns-maw-arena'];
const [MW, MH] = floors.rows.schedule.size;
const N = MW * MH;
const open = t => t === T.FLOOR || t === T.BRIDGE || t === T.WATER;

const reachOf = (tiles, sx, sy) => caveReach(tiles, MW, MH, sy * MW + sx);
const unreached = (tiles, sx, sy) => { const d = reachOf(tiles, sx, sy); return tiles.some((t, i) => open(t) && !d[i]); };

/** The chambers to grow: 7-9 ellipses that keep apart (or the boss floor's four, the arena last). */
function plan(rng, boss) {
  const ch = [];
  if (boss) {
    const [s, n, so, ar] = A.chambers;
    ch.push({ x: roll(rng, s.x.roll[0], s.x.roll[1]), y: roll(rng, 9, MH - 10), rx: s.rx, ry: s.ry });
    ch.push({ x: roll(rng, n.x.roll[0], n.x.roll[1]), y: roll(rng, n.y.roll[0], n.y.roll[1]), rx: roll(rng, n.rx.roll[0], n.rx.roll[1]), ry: roll(rng, n.ry.roll[0], n.ry.roll[1]) });
    ch.push({ x: roll(rng, so.x.roll[0], so.x.roll[1]), y: roll(rng, so.y.roll[0], so.y.roll[1]), rx: roll(rng, so.rx.roll[0], so.rx.roll[1]), ry: roll(rng, so.ry.roll[0], so.ry.roll[1]) });
    ch.push({ x: MW - 16, y: MH >> 1, rx: ar.rx, ry: ar.ry, arena: true });
    return ch;
  }
  const C = B.chambers, want = roll(rng, C.count[0], C.count[1]);
  for (let t = 0; t < C.tries && ch.length < want; t++) {
    const big = next(rng) < C.bigPct / 100, s = big ? C.big : C.small;
    const c = { rx: roll(rng, s.rx[0], s.rx[1]), ry: roll(rng, s.ry[0], s.ry[1]) };
    c.x = roll(rng, 2 + c.rx, MW - 3 - c.rx); c.y = roll(rng, 2 + c.ry, MH - 3 - c.ry);
    if (ch.every(o => { const dx = (c.x - o.x) / (c.rx + o.rx + 2), dy = (c.y - o.y) / (c.ry + o.ry + 2); return dx * dx + dy * dy >= 1; })) ch.push(c);
  }
  if (ch.length < C.minPlanned) return null;
  ch.sort((a, b) => a.x - b.x);
  if (next(rng) < C.reversePct / 100) ch.reverse();   // the start at one end, the stairs usually at the other
  return ch;
}


/** Boxes, cell counts and centres from the cell map (a centre is the cell deepest inside its chamber). */
export function roomBoxes(tiles, cave, rooms) {
  const byId = new Map(rooms.filter(r => r.cave).map(r => [r.id, r]));
  for (const r of byId.values()) Object.assign(r, { x: MW, y: MH, w: 0, h: 0, n: 0, _x1: 0, _y1: 0 });
  for (let i = 0; i < N; i++) {
    const r = byId.get(cave[i]); if (!r) continue;
    const x = i % MW, y = (i / MW) | 0;
    if (x < r.x) r.x = x; if (y < r.y) r.y = y; if (x > r._x1) r._x1 = x; if (y > r._y1) r._y1 = y;
    if (tiles[i] === T.FLOOR) r.n++;
  }
  for (const r of byId.values()) { r.w = r._x1 - r.x + 1; r.h = r._y1 - r.y + 1; delete r._x1; delete r._y1; }
  const depth = chamberDepth(tiles, cave, MW, MH);
  for (const r of byId.values()) {
    let best = -1, bi = -1;
    const mx = r.x + r.w / 2, my = r.y + r.h / 2;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const k = y * MW + x; if (cave[k] !== r.id || tiles[k] !== T.FLOOR) continue;
      const sc = depth[k] * 10 - Math.abs(x - mx) - Math.abs(y - my);
      if (sc > best) { best = sc; bi = k; }
    }
    if (bi >= 0) { r.cx = bi % MW; r.cy = (bi / MW) | 0; }
  }
}

/** A chamber's own cells. */
export function roomCells(cave, r) {
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (cave[y * MW + x] === r.id) out.push({ x, y });
  return out;
}

const at = (tiles, x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? T.WALL : tiles[y * MW + x]);

/** A rift 2-3 wide across a chamber, wall to wall, crossed by a rope bridge (two on a long rift); undone if it cuts anything off. */
function rift(rng, tiles, room, start) {
  const R = B.rift, vert = room.w >= R.minBoxForAxis && (room.h < R.minBoxForAxis || next(rng) < R.verticalPct / 100);
  if (!vert && room.h < R.minBoxForAxis) return false;
  const w = roll(rng, R.width[0], R.width[1]), along0 = vert ? room.cy : room.cx, cross0 = (vert ? room.cx : room.cy) + roll(rng, -2, 2) - (w >> 1);
  const C = (a, b) => (vert ? { x: b, y: a } : { x: a, y: b });
  const rows = [];
  for (const dir of [1, -1]) {
    let a = along0 + (dir < 0 ? -1 : 0), b = cross0, n = 0;
    while (n++ < R.maxRowsEachWay) {
      let all = true, ok = true;
      for (let k = 0; k < w; k++) { const p = C(a, b + k); if (p.x < 2 || p.y < 2 || p.x > MW - 3 || p.y > MH - 3) { ok = false; break; } if (at(tiles, p.x, p.y) !== T.WALL) all = false; }
      if (!ok || all) break;
      rows.push({ a, b });
      a += dir;
      if (next(rng) < R.wanderPct / 100) { const nb = b + (next(rng) < 0.5 ? -1 : 1); if (Math.abs(nb - cross0) <= R.wanderMax) b = nb; }
    }
  }
  if (rows.length < R.minRows) return false;
  const saved = [];
  const set = (p, t) => { const i = p.y * MW + p.x; saved.push([i, tiles[i]]); tiles[i] = t; };
  const undo = () => { for (let s = saved.length - 1; s >= 0; s--) tiles[saved[s][0]] = saved[s][1]; };
  for (const r of rows) for (let k = 0; k < w; k++) { const p = C(r.a, r.b + k); if (at(tiles, p.x, p.y) === T.FLOOR) set(p, T.CHASM); }
  // A bridge row: all chasm, the rift carrying on past it both ways, solid floor at both ends.
  const cands = rows.filter(r => {
    for (let k = 0; k < w; k++) {
      const p = C(r.a, r.b + k); if (at(tiles, p.x, p.y) !== T.CHASM) return false;
      const pa = C(r.a - 1, r.b + k), pb = C(r.a + 1, r.b + k); if (at(tiles, pa.x, pa.y) !== T.CHASM || at(tiles, pb.x, pb.y) !== T.CHASM) return false;
    }
    const e1 = C(r.a, r.b - 1), e2 = C(r.a, r.b + w);
    return at(tiles, e1.x, e1.y) === T.FLOOR && at(tiles, e2.x, e2.y) === T.FLOOR;
  }).sort((p, q) => Math.abs(p.a - along0) - Math.abs(q.a - along0));
  if (!cands.length) { undo(); return false; }
  const bridge = r => { r.bridged = true; for (let k = 0; k < w; k++) set(C(r.a, r.b + k), T.BRIDGE); };
  bridge(cands[0]);
  const far = cands.filter(r => Math.abs(r.a - cands[0].a) >= R.secondBridge.minGap);
  if (far.length && rows.length >= R.secondBridge.minRows && next(rng) < R.secondBridge.chancePct / 100) bridge(far[far.length - 1]);
  for (let guard = 0; guard < R.repairBridges; guard++) {
    const d = reachOf(tiles, start.cx, start.cy);
    let cut = false;
    for (let i = 0; i < N; i++) if (open(tiles[i]) && !d[i]) { cut = true; break; }
    if (!cut) return true;
    const fix = cands.filter(r => { if (r.bridged) return false; const e1 = C(r.a, r.b - 1), e2 = C(r.a, r.b + w); return !!d[e1.y * MW + e1.x] !== !!d[e2.y * MW + e2.x]; })[0];
    if (!fix) break;
    bridge(fix);
  }
  undo();
  return false;
}


/** A pit in a chamber with open ground all round it: walked round, not crossed. */
function voidPit(rng, tiles, cave, room, start) {
  const P = B.pit;
  const solid = (x, y) => { for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { if (at(tiles, x + ox, y + oy) !== T.FLOOR || cave[(y + oy) * MW + x + ox] !== room.id) return false; } return true; };
  const cells = roomCells(cave, room).filter(c => solid(c.x, c.y) && Math.abs(c.x - room.cx) + Math.abs(c.y - room.cy) >= P.minFromCentre);
  if (cells.length < P.minCandidates) return false;
  const c = pick(rng, cells), saved = [];
  blob(() => next(rng), MW, MH, c.x, c.y, roll(rng, P.blob[0], P.blob[1]), (x, y) => { if (at(tiles, x, y) === T.FLOOR && solid(x, y)) { saved.push(y * MW + x); tiles[y * MW + x] = T.CHASM; } });
  if (saved.length < P.minCells || unreached(tiles, start.cx, start.cy)) { for (const i of saved) tiles[i] = T.FLOOR; return false; }
  room.pit = true;
  return true;
}

/** One try (1.7 caveTry); null when it fails. */
function caveTry(rng, boss) {
  const tiles = new Uint8Array(N).fill(T.WALL);
  const ch = plan(rng, boss);
  if (!ch) return null;
  const AU = B.automaton, salt = Math.floor(next(rng) * 1e6);
  const E = new Float32Array(N).fill(99), own = new Int16Array(N).fill(-1);
  for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
    const i = y * MW + x, wob = (noise(x * AU.noise.scale, y * AU.noise.scale, salt) - 0.5) * AU.noise.amp;
    for (let k = 0; k < ch.length; k++) { const c = ch[k], dx = (x - c.x) / c.rx, dy = (y - c.y) / c.ry, d = Math.sqrt(dx * dx + dy * dy) + wob; if (d < E[i]) { E[i] = d; own[i] = k; } }
  }
  // Float32 as 1.7 keeps E; the comparisons below read the stored (rounded) values, as 1.7's do.
  const core = i => (own[i] >= 0 && ch[own[i]].arena ? AU.arenaCore : AU.core);
  let g = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const x = i % MW, y = (i / MW) | 0; if (x < 1 || y < 1 || x > MW - 2 || y > MH - 2) continue; g[i] = E[i] < core(i) ? 1 : E[i] < AU.seedBand ? (next(rng) < AU.seedOpenPct / 100 ? 1 : 0) : 0; }
  for (let pass = 0; pass < AU.rounds; pass++) {
    const n2 = new Uint8Array(N);
    for (let y = 1; y < MH - 1; y++) for (let x = 1; x < MW - 1; x++) {
      const i = y * MW + x;
      let walls = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (!g[i + oy * MW + ox]) walls++;
      n2[i] = walls >= AU.rockAtLeast ? 0 : 1;
      if (E[i] < core(i) * 0.8) n2[i] = 1;
      if (E[i] > AU.forceRockAbove) n2[i] = 0;
    }
    g = n2;
  }
  // Each chamber's anchor: its open cell nearest the centre (or a 3 x 3 opened there).
  const anchors = [];
  for (const c of ch) {
    let best = null, bd = 1e9;
    for (let y = Math.max(1, c.y - AU.anchorSearch); y <= Math.min(MH - 2, c.y + AU.anchorSearch); y++) for (let x = Math.max(1, c.x - AU.anchorSearch); x <= Math.min(MW - 2, c.x + AU.anchorSearch); x++) {
      if (!g[y * MW + x]) continue;
      const dd = Math.abs(x - c.x) + Math.abs(y - c.y); if (dd < bd) { bd = dd; best = { x, y }; }
    }
    if (!best) { best = { x: c.x, y: c.y }; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) g[(c.y + oy) * MW + c.x + ox] = 1; }
    anchors.push(best);
  }
  // Tunnels: a spanning tree over the chambers plus a loop or two.
  const edges = spanningEdges(ch.length, (ia, b) => Math.hypot(ch[ia].x - ch[b].x, (ch[ia].y - ch[b].y) * 1.3)
    + (boss && ch[b].arena && ch[ia].x < A.tunnels.westLimitX ? A.tunnels.arenaFromWestCost : 0));   // the start never opens straight onto the arena
  addLoops(rng, ch.length, edges, boss ? A.tunnels.loops : roll(rng, B.tunnels.loops[0], B.tunnels.loops[1]), B.tunnels.loopTries,
    (p, q) => !(boss && (ch[p].arena || ch[q].arena) && (p === 0 || q === 0)) && Math.hypot(ch[p].x - ch[q].x, ch[p].y - ch[q].y) <= B.tunnels.maxLoopLength);
  for (const e of edges) tunnel(rng, g, MW, MH, anchors[e[0]], anchors[e[1]], next(rng) < B.tunnels.widePct / 100, B.tunnels, 1);
  for (let i = 0; i < N; i++) tiles[i] = g[i] ? T.FLOOR : T.WALL;
  const reach = reachOf(tiles, anchors[0].x, anchors[0].y);
  for (let i = 0; i < N; i++) if (tiles[i] === T.FLOOR && !reach[i]) tiles[i] = T.WALL;
  let opened = 0; for (let i = 0; i < N; i++) if (tiles[i] === T.FLOOR) opened++;
  if (opened < (boss ? B.validity.bossMinOpenCells : B.validity.minOpenCells)) return null;
  // Chambers: the cells inside each one's wobbly ellipse; tunnel cells belong to none.
  const cave = new Int16Array(N).fill(-1), cnt = new Int32Array(ch.length);
  for (let i = 0; i < N; i++) if (tiles[i] === T.FLOOR && own[i] >= 0 && E[i] < B.validity.chamberBand) { cave[i] = own[i]; cnt[own[i]]++; }
  const keep = ch.map((_, k) => cnt[k] >= B.validity.chamberMinCells && !!reach[anchors[k].y * MW + anchors[k].x]);
  if (!keep[0]) return null;
  if (boss && !keep[ch.length - 1]) return null;
  const idMap = {}; let nid = 0;
  for (let k = 0; k < ch.length; k++) if (keep[k]) idMap[k] = nid++;
  for (let i = 0; i < N; i++) if (cave[i] >= 0) cave[i] = keep[cave[i]] ? idMap[cave[i]] : -1;
  if (nid < (boss ? B.validity.bossMinChambers : B.validity.minChambers)) return null;
  const rooms = [];
  for (let k = 0; k < ch.length; k++) { if (!keep[k]) continue; const r = { id: idMap[k], cave: true }; if (ch[k].arena) r.arena = true; rooms.push(r); }
  roomBoxes(tiles, cave, rooms);
  // Chasms: a rift on most floors, sometimes a pit (never in the boss arena).
  const start = rooms[0];
  let hasRift = false;
  const riftRooms = shuffled(rng, rooms.filter(r => r !== start && !r.arena && r.n >= B.rift.minChamberCells));
  if (!boss && next(rng) < B.rift.chancePct / 100) for (const r of riftRooms) if (rift(rng, tiles, r, start)) { r.rift = true; hasRift = true; break; }
  const pitRooms = shuffled(rng, rooms.filter(r => r !== start && !r.arena && !r.rift && r.n >= B.pit.minChamberCells));
  if (pitRooms.length && next(rng) < (boss ? B.pit.bossChancePct : B.pit.chancePct) / 100) voidPit(rng, tiles, cave, pitRooms[0], start);
  roomBoxes(tiles, cave, rooms);
  if (unreached(tiles, start.cx, start.cy)) return null;
  return { w: MW, h: MH, tiles, rooms, cave, rift: hasRift, notes: hasRift ? ['rift'] : [] };
}

/** The Caverns layout: up to 14 tries (1.7 generateCavernLayout); null when all fail (1.7 then lays BSP rooms). */
export function layoutCaves(rng, { boss = false } = {}) {
  for (let t = 0; t < B.layoutTries; t++) { const lay = caveTry(rng, boss); if (lay) return lay; }
  return null;
}

export { MW, MH };
