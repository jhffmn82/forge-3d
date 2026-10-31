// The planes builder's shared state and 1.7's helpers (spec/planes.md rules 64-106; consolidation W7, world-33): the
// streams, the map layers, 1.7's prop grid (a set piece claims its whole footprint), the movement rules and the spawn.
// Every stage of buildPlane (build.js, features.js, creatures.js, dress.js) works on this one object.

import planes from '../../../data/planes.json' with { type: 'json' };
import { stream, next, pick } from '../../lib/rng.js';
import { T, walkTile, isObjectTile } from '../../data/tiles.js';
import { makeCreature } from '../../rules/monsters.js';
import { planeLayout } from './layout.js';
import { distanceField } from '../../lib/grid.js';

export const R = planes.rows;
const BLOCKING = /^(rune-stone-|mossy-boulder$)/;

/** The builder for plane seed S: streams as 1.7 (rules 41-44), the layout, the empty layers and the helpers. */
export function planeKit(S, element, hostFloorNo, play, o) {
  const row = R['plane-' + element], K = row.kit, PAL = row.presentation.terrainPalette;
  const m = planeLayout(S, element), W = m.w, H = m.h, N = W * H;
  const rr = stream((S ^ 0x51a5e) >>> 0), rb = () => next(rr), rp = () => next(play), ri = (a, b) => a + Math.floor(rp() * (b - a + 1));
  const map = new Uint8Array(N), ground = new Uint8Array(N), pool = new Uint8Array(N), grid = new Int16Array(N).fill(-1);
  const k = { S, element, hostFloorNo, o, row, K, PAL, m, W, H, N, cx: m.cx, cy: m.cy, rr, rb, rp, ri, play, map, ground, pool, props: [], lights: [], bodies: [], anchors: [], suns: [] };
  const idx = (x, y) => y * W + x, inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inb(x, y) ? map[idx(x, y)] : T.WALL);
  // Lit as the lighting's per-entry 'beacon' (data/lighting.json); `role` keeps what the light is (rune, crystal, vent ...).
  const light = (x, y, colour, radius, strength, role) => k.lights.push({ kind: 'beacon', role, x, y, colour, radius, strength });
  // ---- 1.7's prop grid: a set piece claims its whole footprint; rebuilding puts singles first, set pieces over them.
  const propAt = (x, y) => (inb(x, y) && grid[idx(x, y)] >= 0 ? k.props[grid[idx(x, y)]] : null);
  const rebuild = () => {
    grid.fill(-1);
    k.props.forEach((p, i) => { grid[idx(p.x, p.y)] = i; });
    k.props.forEach((p, i) => { if (p.set) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (inb(x, y)) grid[idx(x, y)] = i; });
  };
  const addProp = (x, y, name, extra = {}) => {
    if (!inb(x, y) || propAt(x, y) || isObjectTile(at(x, y))) return null;
    const p = { name, x, y, ...(BLOCKING.test(name) ? { b: 1 } : {}), ...extra };
    k.props.push(p); grid[idx(x, y)] = k.props.length - 1;
    return p;
  };
  const addSetPiece = (x, y, name, w, h, extra = {}) => {
    const p = addProp(x, y, name, { set: true, w, h, b: 1, keep: true, ...extra });
    if (!p) return null;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (inb(xx, yy)) grid[idx(xx, yy)] = k.props.length - 1;
    return p;
  };
  const removeProp = p => { const i = k.props.indexOf(p); if (i >= 0) { k.props.splice(i, 1); rebuild(); } };
  // ---- 1.7's movement rules on this floor: PORTAL always walkable, a blocking prop is wall, bodies occupy (the Heart 2x2).
  const walkable = (x, y) => { if (!inb(x, y)) return false; const t = map[idx(x, y)]; if (t === T.PORTAL || t === T.STAIRS_UP) return true; const p = propAt(x, y); return walkTile(t) && !(p && p.b); };
  const occupied = (x, y) => k.bodies.some(e => x >= e.x && y >= e.y && x < e.x + (e.size ?? 1) && y < e.y + (e.size ?? 1));
  const wallCell = (x, y) => !inb(x, y) || map[idx(x, y)] === T.WALL || map[idx(x, y)] === T.SECRET;
  const bfs = (sx, sy) => distanceField(W, H, idx(sx, sy), i => { const x = i % W, y = (i / W) | 0, t = map[i]; return walkable(x, y) || t === T.DOOR || t === T.CHEST; });
  const nearFree = (x, y, r) => {
    const c = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx || dy) && walkable(x + dx, y + dy) && !occupied(x + dx, y + dy)) c.push({ x: x + dx, y: y + dy });
    return c.length ? pick(play, c) : null;
  };
  const spawn = (kind, x, y) => { const e = makeCreature(kind, x, y); e.castCd = ri(1, 3); k.bodies.push(e); return e; };
  return Object.assign(k, { idx, inb, at, light, propAt, rebuild, addProp, addSetPiece, removeProp, walkable, occupied, wallCell, bfs, nearFree, spawn });
}
