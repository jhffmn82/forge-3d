// The light's per-step pictures (lighting-design.md S2), worked out when sight, terrain, the floor or the light set
// changes, never per frame. Pure: plain arrays, no drawing; lighting.js uploads them. Numbering as lights.js: a tile's
// corner on whole numbers. Three pictures over the whole floor:
// - admission, one texel a tile: bit k set where light k reaches that tile (in sight, and a clear line from the light;
//   the hero's lamp: in sight). A face is lit from the floor tile below it, so the passes read the tile below.
// - surface, one texel a tile: R what the tile is to the light (K below), G its area (the row a tile's normals and
//   bleed come from), B how much fluid lies over it, A 255 in sight, 128 remembered, 0 never seen.
// - ambient, samplesPerTile a tile: RGB the light before any lamp (the area's ambient in sight, memory where remembered,
//   0 never seen; a face x share x rock reach; a wall top its mass plus the bleed of the ambient beside it), A rock reach.
// Plus the lights past the budget folded into the ambient as flat light. The tile classes the lighting reads live here
// only: what a tile is to the light, what stops a line of light, what casts as a solid, what the wall band shades.

import data from '../../data/lighting.json' with { type: 'json' };
import { T, G } from '../data/tiles.js';
import { areasOf, inDarkRoom } from './light-areas.js';
import { addAccent } from './light-accent.js';

const P = data.rows.pipeline, S = P.samplesPerTile, AREAS = data.rows.areas;
/** What a tile is to the light. Only WALL and SECRET are wall (1.7 level-lighting.js:43, render.js:345): tall grass,
 *  doors and rocks are floor, lit from every side. */
export const K = { none: 0, floor: 1, face: 2, top: 3, flat: 4, doorway: 5 };
const WALL_LIKE = new Set([T.WALL, T.SECRET]);
const DOORISH = new Set([T.DOOR, T.LOCKED, T.TOLL, T.ICE_DOOR, T.THORNS, T.SEALED]);
const FLUID = new Set([T.CHASM, T.WATER, T.LAVA]);
// 1.7 lightBlocks (render.js:1399): walls and doors stop light; grass, water and rocks do not.
const BLOCKS = new Set([T.WALL, T.SECRET, T.DOOR, T.LOCKED, T.ICE_DOOR, T.THORNS, T.SEALED, T.TOLL]);

// The tile objects that cast as solids (lighting.json casters; 1.7 draws them as 'sprite' surfaces).
const CASTS = new Set(data.rows.casters.tiles.map(name => T[name]));
// The wall band's walls (a door shades the ground beside it too) and the laid ground it falls on.
const BAND_WALL = new Set([T.WALL, T.SECRET, T.DOOR, T.LOCKED, T.ICE_DOOR, T.SEALED, T.TOLL]);
const BAND_GROUND = new Set([T.FLOOR, T.RUBBLE, T.STAIRS, T.STAIRS_UP, T.OPEN_DOOR, T.CHEST, T.EXIT, T.PORTAL, T.FORGE, T.SHRINE, T.THORNS]);

const tileOf = (f, x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? T.WALL : f.tiles[y * f.w + x]);
export const castsAsSolid = (f, x, y) => CASTS.has(tileOf(f, x, y));
/** Each tile to the wall band (wall-band.js): 2 a wall or door, 1 laid ground, 0 neither. */
export const bandTiles = f => Uint8Array.from(f.tiles, t => (BAND_WALL.has(t) ? 2 : BAND_GROUND.has(t) ? 1 : 0));
const wallAt = (f, x, y) => WALL_LIKE.has(tileOf(f, x, y));
const sideDoor = (f, x, y) => wallAt(f, x, y - 1) && wallAt(f, x, y + 1) && !wallAt(f, x - 1, y) && !wallAt(f, x + 1, y);

/** 1.7 lightLOS (render.js:1400-1408): a Bresenham line from the light's tile; the end tile itself is never tested. */
export function lightLOS(f, x0, y0, x1, y1) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    if (x === x1 && y === y1) return true;
    if (BLOCKS.has(tileOf(f, x, y))) return false;
  }
  return true;
}

/** Each tile's kind: a wall is a face when the tile below it is not wall (and not a side door's), else a top. */
export function kindOf(f, x, y) {
  const t = tileOf(f, x, y);
  if (WALL_LIKE.has(t)) {
    const below = tileOf(f, x, y + 1);
    return !WALL_LIKE.has(below) && !((DOORISH.has(below) || below === T.OPEN_DOOR) && sideDoor(f, x, y + 1)) ? K.face : K.top;
  }
  if (DOORISH.has(t) && !sideDoor(f, x, y)) return K.doorway;
  if (FLUID.has(t)) return K.flat;
  return K.floor;
}

/** How much fluid lies over each tile (water, lava, ice, ooze, the planes' and Chaos pools): its relief fades out. */
function wetOf(f, out) {
  for (let i = 0; i < out.length; i++) out[i] = f.tiles[i] === T.WATER || f.tiles[i] === T.LAVA || f.ground?.[i] === G.ICE ? 255 : 0;
  for (const i of f.ooze ?? []) out[i] = 255;
  for (const i of f.poolField ?? []) out[i] = 255;
  for (const p of f.chaos?.pools ?? []) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
    const rim = x === p.x || y === p.y || x === p.x + p.w - 1 || y === p.y + p.h - 1;
    out[y * f.w + x] = Math.max(out[y * f.w + x], rim && p.w > 2 && p.h > 2 ? 140 : 255);
  }
}

/** Natural rock: how far into the rock each sample is (a two-pass chamfer from every open sample), as a reach 0-1. */
let distKept = null;
function rockReach(f, depthAt, out) {
  const W = f.w * S, H = f.h * S, D2 = Math.SQRT2, dist = distKept?.length === W * H ? distKept : (distKept = new Float32Array(W * H));
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) dist[sy * W + sx] = wallAt(f, Math.floor(sx / S), Math.floor(sy / S)) ? 1e4 : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let v = dist[i];
    if (!v) continue;
    if (x > 0) v = Math.min(v, dist[i - 1] + 1);
    if (y > 0) { v = Math.min(v, dist[i - W] + 1); if (x > 0) v = Math.min(v, dist[i - W - 1] + D2); if (x < W - 1) v = Math.min(v, dist[i - W + 1] + D2); }
    dist[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; let v = dist[i];
    if (!v) continue;
    if (x < W - 1) v = Math.min(v, dist[i + 1] + 1);
    if (y < H - 1) { v = Math.min(v, dist[i + W] + 1); if (x < W - 1) v = Math.min(v, dist[i + W + 1] + D2); if (x > 0) v = Math.min(v, dist[i + W - 1] + D2); }
    dist[i] = v;
  }
  for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
    const i = sy * W + sx, depth = depthAt(Math.floor(sx / S), Math.floor(sy / S)), dd = dist[i];
    if (depth == null || dd <= 0) { out[i] = 1; continue; }
    const pen = Math.max(0.35, depth * S);
    out[i] = dd >= pen ? 0 : (1 - dd / pen) ** 2;   // bright at the lip, gone quickly behind it (level-lighting.js:225-234)
  }
}

const tilesKey = f => { let k = f.w * 7 + f.h; for (let i = 0; i < f.tiles.length; i++) k = (Math.imul(k, 31) + f.tiles[i]) | 0; return k; };

/** Lines of light kept per floor until a wall or door changes (they depend on nothing else). */
const LOS = new WeakMap();
function losOf(f, key) {
  let c = LOS.get(f);
  if (!c || c.key !== key || c.map.size > 400000) { c = { key, map: new Map() }; LOS.set(f, c); }
  return c.map;
}

/** The last call's pictures and the box of tiles its sight covered: the next step redoes only that box and its own. */
let keep = null;

/** A tile's kind, area and fluid, and its samples' kinds (the raster field's where it has one), into the kept pictures. */
function placeTile(Q, f, A, F, x, y) {
  const i = y * f.w + x, W = f.w * S;
  Q.surface[i * 4] = kindOf(f, x, y); Q.surface[i * 4 + 1] = A.at(x, y); Q.surface[i * 4 + 2] = Q.wet[i];
  for (let sy = y * S; sy < (y + 1) * S; sy++) for (let sx = x * S; sx < (x + 1) * S; sx++) {
    let fk = 0;
    if (F) { const fx = Math.floor((sx + 0.5) / S * F.S), fy = Math.floor((sy + 0.5) / S * F.S), q = (fy * F.w + fx) * 4; if (fx < F.w && fy < F.h && F.data[q + 3] > 127) fk = F.data[q]; }
    Q.kind[sy * W + sx] = fk ? (fk === 3 ? K.top : K.floor) : Q.surface[i * 4];
  }
}

/**
 * The per-step pictures for this state and light list. Arrays are kept and reused from call to call: each call redoes
 * the tiles round this step's sight and the last step's (everything when the floor, its walls, the look, a dark room or
 * the terrain's fields change) and says which box it redid (dirty, in tiles) for the upload.
 * @param {object} state the game state (floor, vis, seen, actors, playerId, hero, floorNo)
 * @param {object[]} lights gatherLights' list
 * @param {{look?: string, fine?: {S:number, w:number, h:number, data:Uint8Array}|null, accent?: object|null}} [o]
 *   fine: raster terrain's per-pixel kinds (cave and plane rock), so samples follow the rock's outline; accent: the
 *   terrain's own glow
 * @returns {{w:number, h:number, S:number, shaded:object[], folded:number, admission:Uint8Array, surface:Uint8Array,
 *   ambient:Uint8Array, areas:object[], areaNames:string[], dirty:number[]|null, full:boolean}}
 */
export function buildGrid(state, lights, o = {}) {
  const f = state.floor, w = f.w, h = f.h, W = w * S, H = h * S, look = o.look ?? 'relief', V = state.vis, SEEN = state.seen ?? V;
  const A = areasOf(state), dark = inDarkRoom(state), F = o.fine, tk = tilesKey(f);
  const key = [look, dark ? 1 : 0, A.names.join(','), F ? F.w + 'x' + F.h : '', o.accent ? 'glow' : ''].join('|');
  // A new floor makes the kept pictures; a new look, dark room, area set or terrain field redoes them in place; a tile
  // that changed since the last step (a door opening, a secret found) redoes only itself and its neighbours.
  const fresh = !keep || keep.f !== f, why = fresh ? 'floor' : keep.key !== key ? 'key' : keep.fine !== F ? 'fine' : keep.accent !== (o.accent ?? null) ? 'accent' : null, full = !!why;
  if (fresh) keep = { f, box: null, admission: new Uint8Array(w * h * 4), surface: new Uint8Array(w * h * 4), amb: new Float32Array(W * H * 3), reach: new Float32Array(W * H),
    kind: new Uint8Array(W * H), lit: new Uint8Array(W * H), ambient: new Uint8Array(W * H * 4), wet: new Uint8Array(w * h), tiles: Uint8Array.from(f.tiles) };
  const changed = [];
  if (full) {
    Object.assign(keep, { key, fine: F, accent: o.accent ?? null });
    keep.tiles.set(f.tiles); wetOf(f, keep.wet);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) placeTile(keep, f, A, F, x, y);
    // Rock reach for natural walls (depth from the area row).
    keep.reach.fill(1);
    if (A.list.some(r => r.depth != null)) rockReach(f, (x, y) => A.list[A.at(x, y)].depth, keep.reach);
  } else for (let i = 0; i < f.tiles.length; i++) if (f.tiles[i] !== keep.tiles[i]) { keep.tiles[i] = f.tiles[i]; changed.push(i); }
  for (const i of changed) { const x = i % w, y = (i / w) | 0; for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) placeTile(keep, f, A, F, nx, ny); }
  const Q = keep, amb = Q.amb, kindS = Q.kind, lit = Q.lit, reachA = Q.reach;
  const classicOf = row => row.classic ?? AREAS.dungeon.classic;
  const ambientOf = (x, y) => { const row = A.list[A.at(x, y)]; return dark ? P.darkRoomAmbient : look === 'classic' ? classicOf(row).ambient : row.ambient; };
  const memoryOf = (x, y, c) => { const row = A.list[A.at(x, y)]; return look === 'classic' ? classicOf(row).memory[c] * P.memoryShareClassic : row.memory[c]; };

  // What is in sight, as a box: a light that cannot reach it adds nothing; the pictures change only round it.
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (V?.[y * w + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const grow = o.accent ? 6 : 2, cur = bx1 < 0 ? null : [Math.max(0, bx0 - grow), Math.max(0, by0 - grow), Math.min(w - 1, bx1 + grow), Math.min(h - 1, by1 + grow)];
  let box = full ? [0, 0, w - 1, h - 1] : !cur ? Q.box : !Q.box ? cur : [Math.min(cur[0], Q.box[0]), Math.min(cur[1], Q.box[1]), Math.max(cur[2], Q.box[2]), Math.max(cur[3], Q.box[3])];
  for (const i of changed) { const x = i % w, y = (i / w) | 0; box = box ? [Math.min(box[0], Math.max(0, x - 2)), Math.min(box[1], Math.max(0, y - 2)), Math.max(box[2], Math.min(w - 1, x + 2)), Math.max(box[3], Math.min(h - 1, y + 2))] : [Math.max(0, x - 2), Math.max(0, y - 2), Math.min(w - 1, x + 2), Math.min(h - 1, y + 2)]; }
  Q.box = cur;

  // Each light's admitted tiles (in sight, not wall, in reach, a clear line; the hero's lamp: in sight) and how much
  // light it lays there; the strongest 32 are shaded per pixel (the hero's lamp always), the rest folded into the ambient.
  const los = losOf(f, tk), WH = w * h, reached = [];
  for (const L of lights) {
    if (bx1 < 0 || L.x + L.r < bx0 || L.x - L.r > bx1 + 1 || L.y + L.r < by0 || L.y - L.r > by1 + 1) continue;
    const tiles = [];
    let weight = 0;
    const x0 = Math.max(bx0, Math.floor(L.x - L.r - 1)), x1 = Math.min(bx1, Math.ceil(L.x + L.r + 1));
    const y0 = Math.max(by0, Math.floor(L.y - L.r - 1)), y1 = Math.min(by1, Math.ceil(L.y + L.r + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!V[y * w + x] || WALL_LIKE.has(f.tiles[y * w + x])) continue;
      const d = Math.hypot(x + 0.5 - L.x, y + 0.5 - L.y);
      if (d > L.r + 0.75) continue;
      if (!L.hero) {
        const k = (L.ty * w + L.tx) * WH + y * w + x;
        let ok = los.get(k);
        if (ok === undefined) { ok = lightLOS(f, L.tx, L.ty, x, y); los.set(k, ok); }
        if (!ok) continue;
      }
      tiles.push(y * w + x);
      weight += Math.max(0, 1 - d / L.r) ** L.falloff * L.s;
    }
    if (tiles.length) reached.push({ L, tiles, weight: L.hero ? Infinity : weight });
  }
  reached.sort((a, b) => b.weight - a.weight);
  const shaded = reached.slice(0, P.maxLights), extra = reached.slice(P.maxLights);
  Q.admission.fill(0);
  shaded.forEach(({ L, tiles }, k) => {
    const byte = k >> 3, bit = 1 << (k & 7);
    for (const t of tiles) {
      Q.admission[t * 4 + byte] |= bit;
      // A wall face above an admitted tile takes the light too, when the light is at or south of the face's foot (1.7's
      // face sample is lit from the tile below, level-lighting.js:256-264), so the floor's ramp toward the face stays full.
      const up = t - w;
      if (up >= 0 && Q.surface[up * 4] === K.face && L.y >= Math.floor(up / w) + 1) Q.admission[up * 4 + byte] |= bit;
    }
  });
  if (!box) return { w, h, S, shaded: shaded.map(e => e.L), folded: extra.length, admission: Q.admission, surface: Q.surface, ambient: Q.ambient, areas: A.list, areaNames: A.names, dirty: null, full, fresh, why, changed };
  const [tx0, ty0, tx1, ty1] = box, sx0 = tx0 * S, sy0 = ty0 * S, sx1 = (tx1 + 1) * S - 1, sy1 = (ty1 + 1) * S - 1;

  // In sight (a wall beside open ground counts; 250 open water, which shimmers, SB13: pools, not puddles, item 155),
  // remembered, never seen.
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * w + x;
    let shown = !!V?.[i];
    if (!shown && WALL_LIKE.has(f.tiles[i])) for (let dy = -1; dy <= 1 && !shown; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && V?.[ny * w + nx] && !WALL_LIKE.has(f.tiles[ny * w + nx])) { shown = true; break; } }
    Q.surface[i * 4 + 3] = shown ? (!f.plane && f.tiles[i] === T.WATER ? 250 : 255) : SEEN?.[i] ? 128 : 0;
  }

  // Ambient over the box: open samples their area's ambient (plus the terrain's glow), faces x share x reach, tops their
  // mass plus the bleed of the open ambient beside them; remembered the memory colour; never seen 0.
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) { const i = sy * W + sx; amb[i * 3] = amb[i * 3 + 1] = amb[i * 3 + 2] = 0; lit[i] = 0; }
  if (o.accent && !dark && !state.actors?.[state.playerId]?.statuses?.blind) addAccent(o.accent, state, amb, (x, y) => !wallAt(f, x, y));
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) {
    const x = Math.floor(sx / S), y = Math.floor(sy / S), i = sy * W + sx, kind = kindS[i], known = Q.surface[(y * w + x) * 4 + 3];
    if (!known) { amb[i * 3] = amb[i * 3 + 1] = amb[i * 3 + 2] = 0; continue; }
    if (known === 128) { for (let c = 0; c < 3; c++) amb[i * 3 + c] = memoryOf(x, y, c); lit[i] = 2; continue; }
    lit[i] = 1;
    if (kind === K.top) continue;   // tops below, once the open samples are known
    const a = ambientOf(x, y);
    if (kind === K.face) for (let c = 0; c < 3; c++) amb[i * 3 + c] = a[c] * P.faceShare * reachA[i];
    else for (let c = 0; c < 3; c++) amb[i * 3 + c] += a[c];
  }
  const inRock = lights.filter(L => L.wr > 0 && L.ws > 0);
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) {
    const i = sy * W + sx;
    if (kindS[i] !== K.top || lit[i] !== 1) continue;
    const x = Math.floor(sx / S), y = Math.floor(sy / S), a = ambientOf(x, y), row = A.list[A.at(x, y)];
    const wf = reachA[i], mf = row.depth != null ? P.massFloor : P.topShare, share = mf + (P.topShare - mf) * wf, bleed = P.bleed[row.bleed] ?? P.bleed.brick;
    // 1.7 level-lighting.js:311-326: the mean over the 4 neighbour samples that are not wall; a never-seen one counts 0.
    let n = 0, r = 0, g = 0, b = 0;
    for (let k = 0; k < 4; k++) {
      const nx = sx + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = sy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (kindS[j] === K.top || kindS[j] === K.face) continue;
      n++; r += amb[j * 3]; g += amb[j * 3 + 1]; b += amb[j * 3 + 2];
    }
    const k2 = n ? bleed * wf / n : 0;
    amb[i * 3] = a[0] * share + r * k2; amb[i * 3 + 1] = a[1] * share + g * k2; amb[i * 3 + 2] = a[2] * share + b * k2;
    // 1.7 level-lighting.js:327-345: a light set in rock (a crystal, a vein, a Realm lamp) lights the rock tops in sight
    // within its wall radius, with no line of light (it is in the rock). 1.7 measured from the tile's centre to the light
    // half a tile off its own numbering, so the distance runs to the tile's lower right corner here, as 1.7 drew it.
    for (const L of inRock) {
      const d = Math.hypot(L.x - x - 1, L.y - y - 1);
      if (d >= L.wr) continue;
      const q = (1 - d / L.wr) ** P.wallLightFalloff * L.ws;
      for (let c = 0; c < 3; c++) amb[i * 3 + c] += L.c[c] * q;
    }
  }
  // Lights past the budget, as flat light on their admitted open samples (1.7 shades every light; rare here).
  for (const { L, tiles } of extra) {
    if (L.daylight) continue;
    for (const t of tiles) {
      const x = t % w, y = (t / w) | 0;
      for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
        const sx = x * S + u, sy = y * S + v, i = sy * W + sx;
        if (lit[i] !== 1 || kindS[i] === K.top || kindS[i] === K.face) continue;
        const d = Math.hypot((sx + 0.5) / S - L.x, (sy + 0.5) / S - L.y);
        if (d >= L.r) continue;
        const q = (1 - d / L.r) ** L.falloff * L.s;
        for (let c = 0; c < 3; c++) amb[i * 3 + c] += L.c[c] * q;
      }
    }
  }
  for (let sy = sy0; sy <= sy1; sy++) for (let sx = sx0; sx <= sx1; sx++) {
    const i = sy * W + sx;
    for (let c = 0; c < 3; c++) Q.ambient[i * 4 + c] = Math.min(255, Math.round(amb[i * 3 + c] * 255));
    Q.ambient[i * 4 + 3] = Math.round(reachA[i] * 255);
  }
  return { w, h, S, shaded: shaded.map(e => e.L), folded: extra.length, admission: Q.admission, surface: Q.surface, ambient: Q.ambient, areas: A.list, areaNames: A.names, dirty: box, full, fresh, why, changed };
}
