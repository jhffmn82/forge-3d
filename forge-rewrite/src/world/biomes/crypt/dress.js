// The Crypt's dressing (spec/world.md Crypt 23-50; biomes.json crypt, crypt-urn-chamber), as 1.7 lays it
// (js/world/biomes/crypt/cryptset.js, cryptpack.js, cryptrooms.js; js/engine/content-adapter.js prop stages @3c8b312):
//   per plain room: crumbled tombs, a mushroom patch, a moss patch, the pack dressing (candles, grave flowers,
//   cobwebs, plaques and niches);
//   over the floor, before the shared prop stages: storage rooms rebuilt as urn chambers, then 1.7's Crypt prop
//   stages on every piece not kept (grave posts, 2-cell sarcophagi and pedestals, urn groups, mushrooms to ground,
//   wisp posts, the furniture names);
//   once the floor is built: water to grave ooze (or two ooze blobs), shelf fungus and roots on wall faces, the
//   scatter rules (two kinds a floor, a few groups a room, candles lit).
// Draws only from the generation stream it is given.

import biomes from '../../../../data/biomes.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, roll, pick, shuffled } from '../../../lib/rng.js';
import { T, G } from '../../../data/tiles.js';
import { hash2 } from '../../../lib/noise.js';
import { nearDoor, BIG_PIECE } from '../../dress.js'; import { blob } from '../../../lib/grid.js';
import { placePiece } from './hall.js';
import { D4 } from '../../../lib/geometry.js';
import { faceTaken } from '../../torches.js';
import { propBlocks } from '../../../data/props.js';

const C = biomes.rows.crypt, D = C.roomDressing, S = C.scatterRules, U = biomes.rows['crypt-urn-chamber'], P = props.rows;
const tileAt = (f, x, y) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? T.WALL : f.tiles[y * f.w + x]);
const wallLike = t => t === T.WALL || t === T.SECRET;
const propOn = (f, x, y) => f.props.some(p => p.x === x && p.y === y);
const ooze = f => (f.oozeSet ??= new Set(f.ooze ?? []));
const addOoze = (f, k) => { if (!ooze(f).has(k)) { ooze(f).add(k); (f.ooze ??= []).push(k); } f.ground[k] = 0; };
/** 1.7 freeCell: plain floor with no prop, item or trap. */
const freeCell = (f, x, y) => tileAt(f, x, y) === T.FLOOR && !propOn(f, x, y) && !f.items.some(i => i.x === x && i.y === y) && !f.traps.some(t => t.x === x && t.y === y);
const inRoom = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function edges(r) {
  const out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1) out.push({ x, y });
  return out;
}

// ---------------------------------------------------------------- the pack's placement rules (31)
const BIG = BIG_PIECE;
function nearBig(f, x, y) {
  for (const q of f.props) {
    if (q.part || !BIG.test(q.id)) continue;
    if (x >= q.x - 1 && x <= q.x + (q.w ?? 1) && y >= q.y - 1 && y <= q.y + (q.h ?? 1)) return true;
  }
  return false;
}
const wallSide = (f, x, y) => D4.some(([dx, dy]) => tileAt(f, x + dx, y + dy) === T.WALL);   // wall-like and not a door of any kind
const floorFree = (f, g, x, y) => freeCell(f, x, y) && !nearDoor(f, g, x, y) && !ooze(f).has(y * f.w + x);
const scatterSpot = (f, g, x, y) => floorFree(f, g, x, y) && wallSide(f, x, y) && !nearBig(f, x, y);
const wallAt = (f, x, y) => x >= 0 && y >= 0 && x < f.w && y < f.h && wallLike(tileAt(f, x, y)) && tileAt(f, x, y) !== T.DOOR;

// ---------------------------------------------------------------- per plain room (28-30)
/** 29: one crumbled tomb 1 tile in from the walls, bones beside it, ooze leaking 45% of the time. */
function crumbledTomb(rng, f, g, r) {
  const [id, w, h] = pick(rng, D.crumbledTomb.kinds);
  if (r.w < w + 2 || r.h < h + 2) return false;
  for (let t = 0; t < D.crumbledTomb.tries; t++) {
    const x = r.x + 1 + roll(rng, 0, r.w - w - 2), y = r.y + 1 + roll(rng, 0, r.h - h - 2);
    let ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) if (!freeCell(f, xx, yy) || nearDoor(f, g, xx, yy) || (xx === r.cx && yy === r.cy)) ok = false;
    if (!ok) continue;
    placePiece(f, id, x, y, w, h, { set: true, keep: true });
    let ring = [];
    for (let ry = y - 1; ry <= y + h; ry++) for (let rx = x - 1; rx <= x + w; rx++) {
      if (rx >= x && rx < x + w && ry >= y && ry < y + h) continue;
      if (freeCell(f, rx, ry) && !nearDoor(f, g, rx, ry)) ring.push({ x: rx, y: ry });
    }
    ring = shuffled(rng, ring);
    const nb = 1 + (next(rng) < 0.5 ? 1 : 0);
    for (let i = 0; i < nb && ring.length; i++) { const c = ring.pop(); f.props.push({ id: 'bones', x: c.x, y: c.y }); }
    if (next(rng) < D.crumbledTomb.oozeLeakPct / 100 && ring.length) {
      const l = ring.pop();
      addOoze(f, l.y * f.w + l.x);
      const l2 = ring.find(q => Math.abs(q.x - l.x) + Math.abs(q.y - l.y) === 1);
      if (l2) addOoze(f, l2.y * f.w + l2.x);
    }
    return true;
  }
  return false;
}

/** A streak of 3-4 grave flowers along a wall from (x, y); nothing when fewer than 3 fit. */
function mossStreak(rng, f, g, x, y, d) {
  const n = D.mossStreak.length[0] + (next(rng) < 0.5 ? 1 : 0), cells = [];
  for (let i = 0; i < n; i++) { const cx = x + d[0] * i, cy = y + d[1] * i; if (!scatterSpot(f, g, cx, cy)) break; cells.push([cx, cy]); }
  if (cells.length < 3) return 0;
  const v = Math.floor(next(rng) * 4);
  cells.forEach(([cx, cy], i) => f.props.push({ id: 'grave-flowers-moss-' + (1 + (v + i) % 4), x: cx, y: cy }));
  return cells.length;
}

/** 30: the pack dressing of one room. */
function packRoom(rng, f, g, r) {
  if (r.w < 3 || r.h < 3) return;
  const edgeSpots = edges(r).filter(c => scatterSpot(f, g, c.x, c.y));
  if (next(rng) < D.candles.chancePct / 100 && edgeSpots.length) { const s = pick(rng, edgeSpots); f.props.push({ id: 'candles-' + (1 + Math.floor(next(rng) * 4)), x: s.x, y: s.y }); }
  if (next(rng) < D.mossStreak.chancePct / 100) {
    const starts = edgeSpots.filter(c => scatterSpot(f, g, c.x, c.y));
    for (let t = 0; t < D.mossStreak.starts && starts.length; t++) {
      const c = starts.splice(Math.floor(next(rng) * starts.length), 1)[0];
      const along = c.y === r.y || c.y === r.y + r.h - 1 ? [next(rng) < 0.5 ? 1 : -1, 0] : [0, next(rng) < 0.5 ? 1 : -1];
      if (mossStreak(rng, f, g, c.x, c.y, along)) break;
    }
  }
  if (next(rng) < D.cobweb.chancePct / 100) {
    const right = next(rng) < 0.5, cx = right ? r.x + r.w - 1 : r.x, cy = r.y - 1, s = right ? 1 : -1;
    if (wallAt(f, cx, cy) && wallAt(f, cx + s, cy) && wallAt(f, cx + s, r.y) && tileAt(f, cx, r.y) === T.FLOOR && !propOn(f, cx, cy))
      f.props.push({ id: 'wall-cobweb', x: cx, y: cy, wall: true, webLeft: !right });
  }
  if (next(rng) < D.plaqueOrNiche.chancePct / 100 && r.w >= D.plaqueOrNiche.minW) {
    for (let k = 0; k < D.plaqueOrNiche.tries; k++) {
      const wx = r.x + 1 + Math.floor(next(rng) * (r.w - 2)), wy = r.y - 1;
      if (!wallAt(f, wx, wy) || !wallAt(f, wx - 1, wy) || !wallAt(f, wx + 1, wy) || tileAt(f, wx, r.y) !== T.FLOOR || propOn(f, wx, wy) || nearDoor(f, g, wx, r.y) || nearBig(f, wx, r.y)) continue;
      const plaque = next(rng) < D.plaqueOrNiche.plaquePct / 100;
      f.props.push({ id: plaque ? 'wall-plaque' : 'wall-niche', x: wx, y: wy, wall: true, keep: true, ...(plaque ? { light: { col: C.lights.plaque.col, r: C.lights.plaque.r, s: C.lights.plaque.s, at: { x: wx, y: wy + 0.9 } } } : {}) });
      break;
    }
  }
}

/** 28: the Crypt pass over one plain room (after the shared dressing). */
export function dressCryptRoom(rng, f, g, r) {
  const W = f.w;
  if (next(rng) < D.crumbledTomb.chancePct / 100) crumbledTomb(rng, f, g, r);
  if (next(rng) < D.mushroomPatch.chancePct / 100) {
    const e = pick(rng, edges(r));
    if (e) blob(() => next(rng), f.w, f.h, e.x, e.y, roll(rng, D.mushroomPatch.blob[0], D.mushroomPatch.blob[1]), (x, y) => { const k = y * W + x; if (tileAt(f, x, y) === T.FLOOR && !f.ground[k] && !propOn(f, x, y) && !ooze(f).has(k)) f.ground[k] = G.GRASS; });
  }
  if (r.w * r.h >= D.secondTomb.minArea && next(rng) < D.secondTomb.chancePct / 100) crumbledTomb(rng, f, g, r);
  if (next(rng) < D.mossPatch.chancePct / 100) {
    const e = pick(rng, edges(r));
    if (e) blob(() => next(rng), f.w, f.h, e.x, e.y, roll(rng, D.mossPatch.blob[0], D.mossPatch.blob[1]), (x, y) => { const k = y * W + x; if (tileAt(f, x, y) === T.FLOOR && !f.ground[k]) f.ground[k] = G.MOSS; });
  }
  packRoom(rng, f, g, r);
}

// ---------------------------------------------------------------- urn chambers (33-36)
const urnGroup = (rng, extra = {}) => ({ id: 'urn-group', variant: Math.floor(next(rng) * 5), flip: next(rng) < 0.5, ...extra });

export function urnChamber(rng, f, g, r) {
  const W = f.w;
  f.props = f.props.filter(p => p.keep || !inRoom(r, p.x, p.y) || p.id === 'barrel-explosive' || P[p.id]?.fluid);
  const cx = r.x + (r.w >> 1);
  // 33: the recess in the wall above the top centre, its slab below, a green glow.
  let recess = null;
  if ([-1, 0, 1].every(d => wallLike(tileAt(f, cx + d, r.y - 1)) && !wallLike(tileAt(f, cx + d, r.y)))) {
    recess = { id: 'crypt-recess', x: cx, y: r.y - 1, wall: true, keep: true, set: true, light: { col: C.lights.recess.col, r: C.lights.recess.r, s: C.lights.recess.s, at: { x: cx, y: r.y - 1 + 0.9 } } };
    f.props.push(recess);
    if (tileAt(f, cx, r.y) === T.FLOOR && !f.items.some(i => i.x === cx && i.y === r.y)) placePiece(f, 'grave-slab', cx, r.y, 1, 2, { keep: true, set: true });
  }
  // 34: vessels along the top row, then down both side walls: short runs (1, or 2 by hash) split by gaps.
  const spots = [];
  for (let x = r.x; x < r.x + r.w; x++) if (Math.abs(x - cx) >= 2) spots.push({ x, y: r.y, row: 'top' });
  for (let y = r.y + 2; y < r.y + r.h - 1; y++) spots.push({ x: r.x, y, row: 'left' }, { x: r.x + r.w - 1, y, row: 'right' });
  const cap = Math.max(3, Math.round((r.w + r.h) / 3));
  let placed = 0, lastRow = null, run = 0;
  for (const s of spots) {
    if (!freeCell(f, s.x, s.y) || nearDoor(f, g, s.x, s.y)) { run = 0; continue; }
    if (s.row !== lastRow) { lastRow = s.row; run = 0; }
    if (placed >= cap || run >= 1 + (hash2(s.x, s.y, 5) < 0.35 ? 1 : 0) || next(rng) < U.vessels.skipPct / 100) { run = 0; continue; }
    const kind = pick(rng, U.vessels.family);
    if (kind !== 'urn-shattered') f.props.push(urnGroup(rng, { x: s.x, y: s.y }));
    else {
      f.props.push({ id: 'urn-shattered', x: s.x, y: s.y, set: true });
      if (next(rng) < U.vessels.shatteredBonesPct / 100 && s.row === 'top' && freeCell(f, s.x, s.y + 1)) f.props.push({ id: 'bones', x: s.x, y: s.y + 1 });
    }
    run++; placed++;
  }
  // 35: a disturbed burial in a big chamber, with bones and ooze beside it.
  if (r.w * r.h >= U.burial.minArea) {
    const opts = [];
    for (let y = r.y + Math.floor(r.h / 2); y < r.y + r.h - 1; y++) opts.push(['tomb-crumbled-v', r.x, y, 1, 2], ['tomb-crumbled-v', r.x + r.w - 1, y, 1, 2]);
    for (let x = r.x + 1; x < r.x + r.w - 2; x++) opts.push([next(rng) < 0.5 ? 'tomb-crumbled-h' : 'tomb-open-h', x, r.y + r.h - 1, 2, 1]);
    for (const [id, x, y, w, h] of shuffled(rng, opts)) {
      let ok = true;
      for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w && ok; xx++) if (!freeCell(f, xx, yy) || nearDoor(f, g, xx, yy)) ok = false;
      if (!ok) continue;
      placePiece(f, id, x, y, w, h, { set: true, keep: true });
      let ring = [];
      for (let ry = y - 1; ry <= y + h; ry++) for (let rx = x - 1; rx <= x + w; rx++) if (!(rx >= x && rx < x + w && ry >= y && ry < y + h) && freeCell(f, rx, ry) && !nearDoor(f, g, rx, ry)) ring.push({ x: rx, y: ry });
      ring = shuffled(rng, ring);
      if (ring.length) f.props.push({ id: 'bones', x: ring[0].x, y: ring[0].y });
      if (ring.length >= 2) addOoze(f, ring[1].y * W + ring[1].x);
      break;
    }
  }
  // 36: candles beside the recess.
  if (recess) for (const d of [-1, 1]) if (floorFree(f, g, recess.x + d, r.y) && next(rng) < 0.75) f.props.push({ id: 'candles-' + (1 + Math.floor(next(rng) * 4)), x: recess.x + d, y: r.y });
}

// ---------------------------------------------------------------- 1.7's prop stages in the Crypt (37-42)
const FURN = C.furniture;
const SARCISH = new Set(['sarcophagus', 'sarcophagus-open', 'coffin']);

/** Every prop not kept, in placement order, through 1.7's Crypt stages. */
function propStagesCrypt(rng, f, g) {
  const W = f.w, out = [], before = f.props;
  f.props = out;
  const freeNow = (x, y) => freeCell(f, x, y) && !before.some(p => p.x === x && p.y === y && !out.includes(p) && p.keep);
  for (const p of before) {
    if (p.keep || p.part || p.set) { out.push(p); continue; }
    const mapped = p.id === 'barrel-explosive' ? p.id : FURN[p.id] ?? p.id;
    // 41: grave pillars and half the coffins keep their names; other sarcophagi lie down as a 2-cell piece.
    const keepName = mapped === 'grave-pillar' || (mapped === 'coffin' && next(rng) < 0.5);
    if (!keepName && SARCISH.has(mapped)) {
      const kind = mapped === 'sarcophagus-open' ? 'open' : next(rng) < C.furnitureRules.twoCellSarc.crackedPct / 100 ? 'cracked' : 'intact';
      const horiz = freeNow(p.x + 1, p.y) && !nearDoor(f, g, p.x + 1, p.y), vert = freeNow(p.x, p.y + 1) && !nearDoor(f, g, p.x, p.y + 1);
      if (horiz && (!vert || next(rng) < 0.5)) { placePiece(f, 'sarc', p.x, p.y, 2, 1, { kind, horiz: true, seed: Math.floor(next(rng) * 97) }); continue; }
      if (vert) { placePiece(f, 'sarc', p.x, p.y, 1, 2, { kind, horiz: false, seed: Math.floor(next(rng) * 97) }); continue; }
      out.push({ id: 'pedestal', x: p.x, y: p.y, top: next(rng) < 0.5 ? 'skull' : 'none', seed: Math.floor(next(rng) * 97) });
      continue;
    }
    // 39: urns become urn groups.
    if (mapped === 'urn' || (p.id === 'stack-group' && ['crate', 'barrel', 'pot'].includes(p.family))) { out.push(urnGroup(rng, { x: p.x, y: p.y })); continue; }
    // 40: mushrooms become a mushroom-ground blob.
    if (p.id === 'mushrooms') {
      if (tileAt(f, p.x, p.y) === T.FLOOR) blob(() => next(rng), f.w, f.h, p.x, p.y, roll(rng, C.furnitureRules.mushroomsToGroundBlob[0], C.furnitureRules.mushroomsToGroundBlob[1]), (x, y) => { const k = y * W + x; if (tileAt(f, x, y) === T.FLOOR && !f.ground[k] && !propOn(f, x, y)) f.ground[k] = G.GRASS; });
      continue;
    }
    // 38: torch stands and candelabras become a grave post with soul wisps 35% of the time.
    if ((p.id === 'torch-stand' || p.id === 'candelabra') && next(rng) < C.furnitureRules.wispPostPct / 100) { out.push({ ...p, id: 'grave-post', set: true, wisps: true, light: { col: '#7CFFA0', dim: true } }); continue; }
    const q = { ...p, id: mapped };
    // 42: candelabras burn violet or green.
    if (q.id === 'candelabra') q.light = { col: hash2(p.x, p.y, 91) < C.furnitureRules.candelabraVioletPct / 100 ? '#B07CFF' : '#7CFFA0' };
    out.push(q);
  }
}

/** A room corner: wall on one side across and one side along (a body there has only two ways out). */
const cornerCell = (f, x, y) => (tileAt(f, x - 1, y) === T.WALL || tileAt(f, x + 1, y) === T.WALL) && (tileAt(f, x, y - 1) === T.WALL || tileAt(f, x, y + 1) === T.WALL);

/**
 * C17 (Justin 2026-10-16): sarcophagi, pedestals and grave posts never stand on a room corner, where with a neighbour
 * they could wall a creature in. One that does moves to a free edge cell of its room that is no corner (all its
 * cells), else it goes.
 */
function offCorners(rng, f, rooms, g) {
  const W = f.w;
  for (const p of f.props.slice()) {
    if (p.part || p.keep || !['sarc', 'pedestal', 'grave-post'].includes(p.id)) continue;
    const w = p.w ?? 1, h = p.h ?? 1, cells = (x, y) => { const o = []; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) o.push([xx, yy]); return o; };
    if (!cells(p.x, p.y).some(([x, y]) => cornerCell(f, x, y))) continue;
    const parts = f.props.filter(q => q === p || (q.part && q.part.x === p.x && q.part.y === p.y));
    f.props = f.props.filter(q => !parts.includes(q));
    const r = rooms[g[p.y * W + p.x]];
    const spots = r ? shuffled(rng, edges(r)).filter(c => cells(c.x, c.y).every(([x, y]) => inRoom(r, x, y) && freeCell(f, x, y) && !nearDoor(f, g, x, y) && !cornerCell(f, x, y))) : [];
    if (!spots.length) continue;
    const { id, x: _x, y: _y, w: _w, h: _h, ...extra } = p;
    placePiece(f, id, spots[0].x, spots[0].y, w, h, extra);
  }
}

/** Before the shared prop stages: urn chambers, then the Crypt's stages on everything placed so far. */
export function dressCryptFloor(rng, f, rooms, g) {
  for (const r of rooms) if (r.special === 'storage') { urnChamber(rng, f, g, r); r.special = 'urn-chamber'; }   // a zoo's storage fallback (ruling 12: rolled as its own kind)
  propStagesCrypt(rng, f, g);
  offCorners(rng, f, rooms, g);
}

// ---------------------------------------------------------------- once the floor is built (23-24, 32, 44-48)
/** 23-24: water to ooze outside puzzle rooms; with none, two blobs in rooms away from the start. */
export function cryptOoze(rng, f, rooms) {
  const W = f.w;
  let n = 0;
  for (let k = 0; k < f.tiles.length; k++) {
    if (f.tiles[k] !== T.WATER) continue;
    const x = k % W, y = (k / W) | 0;
    if (rooms.some(r => r.puzzle && inRoom(r, x, y))) continue;
    f.tiles[k] = T.FLOOR; addOoze(f, k); n++;
  }
  const F = C.oozeFallback;
  for (let i = 0; i < (n ? 0 : F.blobs); i++) {
    const c = rooms.filter(q => !F.notRoles.includes(q.role) && !q.hall && !q.hiddenSigil && !q.rareEvent && q.w * q.h >= F.roomMinArea);
    if (!c.length) break;
    const r = pick(rng, c);
    blob(() => next(rng), f.w, f.h, r.x + roll(rng, 1, Math.max(1, r.w - 2)), r.y + roll(rng, 1, Math.max(1, r.h - 2)), roll(rng, F.size[0], F.size[1]), (x, y) => {
      if (tileAt(f, x, y) === T.FLOOR && !propOn(f, x, y) && !f.items.some(it => it.x === x && it.y === y) && !f.traps.some(t => t.x === x && t.y === y)) addOoze(f, y * W + x);
    });
  }
}

/** 32: 2-4 shelf fungus or hanging roots on wall faces that look onto open floor, never two side by side. */
export function cryptWallVeg(rng, f) {
  const spots = [];
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < f.w - 1; x++) {
    const t = tileAt(f, x, y);
    if (!wallLike(t) || t === T.SECRET || tileAt(f, x, y + 1) !== T.FLOOR || faceTaken(f, x, y) || propOn(f, x, y + 1)) continue;
    spots.push({ x, y });
  }
  const used = new Set(), want = roll(rng, D.wallVeg.perFloor[0], D.wallVeg.perFloor[1]);
  let put = 0;
  for (const s of shuffled(rng, spots)) {
    if (put >= want) break;
    if (used.has(`${s.x - 1},${s.y}`) || used.has(`${s.x + 1},${s.y}`)) continue;
    const roots = next(rng) < D.wallVeg.rootsPct / 100;
    f.props.push({ id: (roots ? 'crypt-roots-' : 'crypt-shelf-fungus-') + (1 + Math.floor(next(rng) * D.wallVeg.variants)), x: s.x, y: s.y, wall: true, wallVeg: true });
    used.add(`${s.x},${s.y}`); put++;
  }
}

const KIND = { urn: /^urn-group$/, bone: /^(bones|bone-pile)$/, candle: /^candles-\d$/, moss: /^grave-flowers-moss-\d$/ };
const kindOf = p => Object.keys(KIND).find(k => KIND[k].test(p.id)) ?? null;
function mossGroups(list) {
  const groups = [], seen = new Set();
  for (const p of list) {
    if (seen.has(p)) continue;
    const comp = [p]; seen.add(p);
    for (let i = 0; i < comp.length; i++) for (const q of list) if (!seen.has(q) && Math.abs(q.x - comp[i].x) + Math.abs(q.y - comp[i].y) === 1) { seen.add(q); comp.push(q); }
    groups.push(comp);
  }
  return groups;
}

/** 44-48: the scatter rules, enforced once the floor is built. */
export function cryptScatterRules(rng, f, rooms, g) {
  const roomOf = (x, y) => (g[y * f.w + x] >= 0 ? rooms[g[y * f.w + x]] : null);
  const R = f.hallRect, inHall = p => R && p.x >= R.x && p.x < R.x + R.w && p.y >= R.y && p.y < R.y + R.h;
  const scatter = () => f.props.filter(p => !p.keep && !p.set && !p.wall && kindOf(p));
  const drop = p => { const i = f.props.indexOf(p); if (i >= 0) f.props.splice(i, 1); };
  // 45: moss by a big piece goes; other pieces not wall-side or by a big piece move to a spot within 4, else go.
  for (const p of scatter()) {
    if (kindOf(p) === 'moss') { if (nearBig(f, p.x, p.y)) drop(p); continue; }
    if (wallSide(f, p.x, p.y) && !nearBig(f, p.x, p.y)) continue;
    const r = roomOf(p.x, p.y);
    drop(p);
    let best = null, bd = 1e9;
    for (let dy = -S.moveRadius; dy <= S.moveRadius; dy++) for (let dx = -S.moveRadius; dx <= S.moveRadius; dx++) {
      const x = p.x + dx, y = p.y + dy, d = Math.abs(dx) + Math.abs(dy);
      if (d >= bd || x < 0 || y < 0 || x >= f.w || y >= f.h || (r ? roomOf(x, y) !== r : !!roomOf(x, y)) || !scatterSpot(f, g, x, y)) continue;
      best = { x, y }; bd = d;
    }
    if (best) f.props.push({ ...p, x: best.x, y: best.y });
  }
  // 46: two kinds a floor (the boss hall keeps its own arrangement); three on a large floor (C9).
  const kinds = ['urn', 'bone', 'candle', 'moss'], keep = [];
  // C9 (Justin 2026-10-16): a large floor (the top quarter by room area) keeps a third kind.
  const area = rooms.filter(r => !r.pocket).reduce((n, r) => n + r.w * r.h, 0);
  const want = S.largeFloor && area >= S.largeFloor.minRoomCells ? S.largeFloor.keptKinds : S.keptKindsPerFloor;
  while (keep.length < want) keep.push(kinds.splice(Math.floor(next(rng) * kinds.length), 1)[0]);
  f.scatterKinds = keep;
  for (const p of scatter()) if (!keep.includes(kindOf(p)) && !inHall(p)) drop(p);
  // 47: short flower streaks go; each room keeps 0, 1, 1 or 2 groups; groups outside rooms go.
  for (const gr of mossGroups(f.props.filter(p => !p.keep && kindOf(p) === 'moss'))) if (gr.length < S.minMossStreak) gr.forEach(drop);
  const groups = [...mossGroups(f.props.filter(p => !p.keep && kindOf(p) === 'moss' && !inHall(p))), ...scatter().filter(p => kindOf(p) !== 'moss' && !inHall(p)).map(p => [p])];
  const byRoom = new Map();
  for (const gr of groups) { const r = roomOf(gr[0].x, gr[0].y); if (!r) { gr.forEach(drop); continue; } if (!byRoom.has(r)) byRoom.set(r, []); byRoom.get(r).push(gr); }
  for (const list of byRoom.values()) { const cap = pick(rng, S.groupsPerRoom); shuffled(rng, list).slice(cap).forEach(gr => gr.forEach(drop)); }
  // 48: the candles that stayed light their bit of floor.
  for (const p of f.props) if (kindOf(p) === 'candle') p.light = { col: S.candleLight.col, r: S.candleLight.r, s: S.candleLight.s, at: { x: p.x, y: p.y + 0.2 } };
}

/** 50: a wall piece that blocks but stands on floor moves to the nearest wall within 2 with open ground below. */
export function repairWallPieces(f) {
  for (const p of f.props.slice()) {
    if (!p.wall || !propBlocks(p) || wallLike(tileAt(f, p.x, p.y))) continue;
    let best = null, score = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = p.x + dx, y = p.y + dy, d = Math.abs(dx) + Math.abs(dy);
      if (tileAt(f, x, y) !== T.WALL || propOn(f, x, y) || wallLike(tileAt(f, x, y + 1)) || y + 1 >= f.h) continue;
      if (d < score) { best = { x, y }; score = d; }
    }
    if (best) { if (p.light?.at) p.light = { ...p.light, at: { x: best.x, y: best.y + 0.9 } }; p.x = best.x; p.y = best.y; }
    else f.props.splice(f.props.indexOf(p), 1);
  }
}
