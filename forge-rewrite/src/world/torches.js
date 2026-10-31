// Wall torches on a Dungeon floor, worked out from the finished map as 1.7 works them out at draw time
// (js/presentation/render/render.js:1410-1501 @3c8b312): a sconce on a rare wall face picked by hash, one torch on each
// room's north wall (the face nearest the middle, through up to two corridor rows), and hallway torches where a
// corridor meets a wall face, none within 4 of another light and none within 6 of another hallway torch.
// Returns light entries for floor.lights ({kind:'wall-torch', x, y}: the wall face the sconce hangs on).

import props from '../../data/props.json' with { type: 'json' };
import { T, isDoor } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';

const WALL_FACE_RARE = [1, 2, 6, 9, 10, 12];
const wallish = t => t === T.WALL || t === T.SECRET;

/**
 * Item 242 (Justin 2026-10-20: "the shelf fungus also seems to be on top of a torch"): a wall face that already holds a
 * piece (a prop on it, such as the Crypt's shelf fungus or roots) or a wall torch takes nothing more. The one check the
 * torches and the Crypt's wall growth (crypt/dress.js cryptWallVeg) both ask, whichever is placed first.
 */
export const faceTaken = (floor, x, y) => floor.props.some(p => p.x === x && p.y === y) || (floor.lights ?? []).some(l => l.kind === 'wall-torch' && l.x === x && l.y === y);

/**
 * Options (1.7 deeprender.js deepTempleLighting's view): `ok(x, y)` says which walls may hold a sconce, every other
 * wall reading as a secret wall here (still wall to the geometry, never a candidate); `lit(room)` says which rooms get
 * a north-wall torch (all rooms still count as rooms for the hallway torches).
 */
export function wallTorches(floor, rooms, salt, { ok = null, lit = null } = {}) {
  const W = floor.w, H = floor.h, raw = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? T.WALL : floor.tiles[y * W + x]);
  const at = ok ? (x, y) => { const t = raw(x, y); return t === T.WALL && !ok(x, y) ? T.SECRET : t; } : raw;
  const grid = new Int16Array(W * H).fill(-1);
  rooms.forEach((r, k) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y * W + x] = k; });
  const roomAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : grid[y * W + x]);
  const sideDoorAt = (x, y) => (isDoor(at(x, y)) || at(x, y) === T.OPEN_DOOR) && wallish(at(x, y - 1)) && wallish(at(x, y + 1)) && !wallish(at(x - 1, y)) && !wallish(at(x + 1, y));
  const faces = (x, y) => !wallish(at(x, y + 1)) && !sideDoorAt(x, y + 1);
  const masonry = (x, y) => at(x, y) === T.WALL && !wallish(at(x, y + 1)) && hash2(x, y, 11) < 0.12 && WALL_FACE_RARE[Math.floor(hash2(x, y, 5) * WALL_FACE_RARE.length)] === 12;
  const roomCandidate = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && at(x, y) === T.WALL && faces(x, y) && !faceTaken(floor, x, y);
  const hallCandidate = (x, y) => {
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 2 || at(x, y) !== T.WALL || at(x, y + 1) !== T.FLOOR || roomAt(x, y + 1) >= 0 || faceTaken(floor, x, y)) return false;
    let passage = false;
    for (const [nx, ny] of [[x - 1, y + 1], [x + 1, y + 1], [x, y + 2]]) if (at(nx, ny) === T.FLOOR && roomAt(nx, ny) < 0) passage = true;
    if (!passage) return false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (isDoor(at(x + dx, y + 1 + dy))) return false;
    return true;
  };
  const out = new Map(), lights = floor.props.filter(p => props.rows[p.id]?.light).map(p => ({ x: p.x, y: p.y }));
  const put = (x, y) => out.set(y * W + x, { kind: 'wall-torch', x, y });
  rooms.forEach((room, k) => {
    if (room.dark || !(room.w > 0 && room.h > 0) || (lit && !lit(room))) return;
    let best = null;
    const center = room.x + (room.w - 1) / 2;
    for (let depth = 1; depth <= 3 && !best; depth++) for (let x = room.x; x < room.x + room.w; x++) {
      const y = room.y - depth;
      if (roomAt(x, room.y) !== k || !roomCandidate(x, y)) continue;
      let clear = true;
      for (let py = y + 1; py < room.y; py++) if (roomAt(x, py) >= 0 || (at(x, py) !== T.FLOOR && at(x, py) !== T.WATER)) { clear = false; break; }
      if (!clear) continue;
      if (masonry(x, y)) { best = { x, y }; break; }
      if (!best || Math.abs(x - center) < Math.abs(best.x - center)) best = { x, y };
    }
    if (best) { put(best.x, best.y); lights.push(best); }
  });
  const fixed = t => t === T.FORGE || t === T.SHRINE || t === T.STAIRS || t === T.CHEST || t === T.EXIT;
  const cands = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (masonry(x, y) || fixed(at(x, y))) lights.push({ x, y });
    if (masonry(x, y) && !faceTaken(floor, x, y)) put(x, y);
    if (hallCandidate(x, y)) cands.push({ x, y, priority: hash2(x, y, salt) });
  }
  cands.sort((a, b) => a.priority - b.priority || a.y - b.y || a.x - b.x);
  const near = (a, b, d) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < d * d, added = [];
  for (const p of cands) {
    if (lights.some(q => near(p, q, 4)) || added.some(q => near(p, q, 6))) continue;
    put(p.x, p.y); added.push(p);
  }
  return [...out.values()];
}

/**
 * Daylight patches (Dungeon, render.js:1453-1473 @3c8b312): in each room that is not dark, up to min(3, ceil(grass
 * tiles / 12)) of its grassy floor tiles by the same hash priority as the hallway torches, at least 4 apart; each is a
 * shaft of daylight on the growth below.
 */
export function daylightPatches(floor, rooms, salt) {
  const W = floor.w, out = [];
  rooms.forEach(room => {
    if (room.dark || !(room.w > 0 && room.h > 0)) return;
    const grass = [];
    for (let y = room.y; y < room.y + room.h; y++) for (let x = room.x; x < room.x + room.w; x++) {
      const k = y * W + x, g = floor.ground[k];
      if (floor.tiles[k] === T.FLOOR && (g === 1 || g === 2)) grass.push({ x, y, priority: hash2(x, y, salt) });
    }
    grass.sort((a, b) => a.priority - b.priority || a.y - b.y || a.x - b.x);
    const picked = [], limit = Math.min(3, Math.ceil(grass.length / 12));
    for (const p of grass) {
      if (picked.length >= limit) break;
      if (picked.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 4)) continue;
      picked.push(p);
      out.push({ kind: 'daylight', x: p.x, y: p.y, beamRadius: 2.8 + p.priority * 0.4 });
    }
  });
  return out;
}

/**
 * Beacons (render.js:1527-1534, :2026-2042 @3c8b312): the stairs and an open exit glow pale blue, a sealed exit
 * dimmer (an exit entry carries the open look in `open`, for when the guardian falls), the forge warm, a shrine in its
 * god's colour, a gold or enhanced chest gold. Height 0.6, the forge 1.15.
 */
export function beacons(floor, godColour = null) {
  const W = floor.w, out = [], at = (x, y) => floor.tiles[y * W + x];
  const STAIRS = { colour: '#9FD8FF', radius: 4.4, strength: 1.35, height: 0.6 };
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < W; x++) {
    const t = at(x, y);
    if (t === T.STAIRS) out.push({ kind: 'beacon', x, y, ...STAIRS });
    else if (t === T.EXIT) out.push({ kind: 'beacon', x, y, colour: '#6F93B8', radius: 3.2, strength: 0.95, height: 0.6, exit: true, open: STAIRS });
    else if (t === T.FORGE) out.push({ kind: 'beacon', x, y, colour: '#FFC45C', radius: 4.6, strength: 1.2, height: 1.15 });
    else if (t === T.SHRINE) out.push({ kind: 'beacon', x, y, colour: godColour ?? '#E6D9BC', radius: 2.8, strength: 0.62, height: 0.6 });
  }
  for (const c of floor.chests ?? []) if (!c.mimic && (c.kind === 'gold' || c.enhanced)) out.push({ kind: 'beacon', x: c.x, y: c.y, colour: '#E8B44A', radius: 2.3, strength: 0.62, height: 0.6 });
  return out;
}
