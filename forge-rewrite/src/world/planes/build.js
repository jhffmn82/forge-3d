// An elemental plane floor from its seed (spec/planes.md rules 64-106), built in 1.7's order
// (js/engine/transition-adapter.js buildPlaneFloor @3c8b312): the layout (./layout.js), the base (portals.js
// generatePlaneBase: tiles, rune stone, chest, second seal, centrepiece, terrain features from planeterrain.js
// ptPlanFeatures with its reachability fix, the creatures), small props cleared near big pieces (cryptpack.js
// packPlaneClear), the wall-foot scatter, then the fire, water or air dressing (planesfwa.js fwaDress).
// Streams as 1.7 (rules 41-44): build mulberry32(S ^ 0x51A5E), dressing mulberry32((S ^ 0x2B8F5C1) >>> 0), and the
// play stream (the caller's state.rng) wherever 1.7 drew its main rng: nearFree picks, moss blobs, the scatter, the
// Heart's node spots, and one castCd draw per creature spawned (1.7 spawnRaw).
// Rulings 2026-10-15: no decorative pool on the Fire plane (answer 5); LIGHT cells do nothing off Earth (answer 10).
// Inside, props are 1.7-shaped ({name, x, y, w, h, set, b}) with 1.7's prop grid, so every "is there a prop here"
// answers as 1.7's did; they become rewrite props at the end, a multi-tile piece as its head and parts (world/pieces.js).

import { stream } from '../../lib/rng.js';
import { T } from '../../data/tiles.js';
import { PL } from './layout.js'; import { portalLight } from '../floor-lights.js';
import { D4 } from '../../lib/geometry.js';
import { distanceField } from '../../lib/grid.js';
import { BIG_PIECE } from '../dress.js';
import { R, planeKit } from './kit.js';
import { terrainFeatures } from './features.js';
import { planeCreatures } from './creatures.js';
import { wallFootScatter, elementDress } from './dress.js';

const LAY = R['plane-layout'].build;
const SMALL = /^(fern|root-tangle|glow-mushrooms|crystal-(gold|violet|amber)-small)$/;

/** Rules 66-72: tiles, plants, rune stone, chest (one scan, so the rune stone only sees cells already laid). */
function baseTiles(k) {
  const { element, K, m, W, H, cx, cy, rb, map, anchors, idx, inb, light, propAt, addProp, addSetPiece } = k;
  let decorN = 0, portalAt = null, treasureAt = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), v = m.cells[i];
    if (v === PL.ROCK) { map[i] = T.WALL; continue; }
    map[i] = v === PL.WATER ? T.WATER : T.FLOOR;
    if (v === PL.ENTRY) { map[i] = T.PORTAL; portalAt = { x, y }; }
    else if (v === PL.DECOR) { anchors.push({ x, y }); if (element === 'earth' && rb() < LAY.earthDecor.pct / 100) addProp(x, y, K.decor[decorN++ % K.decor.length]); }
    else if (v === PL.LIGHT) { if (element === 'earth') { addProp(x, y, K.lightProp); light(x, y, LAY.earthLight.light.col, LAY.earthLight.light.r, LAY.earthLight.light.s, 'mushroom'); } }
    else if (v === PL.BLOCK && K.stone) addProp(x, y, K.stone);
    else if (v === PL.RUNE) {
      const free = (cx, cy) => inb(cx, cy) && m.cells[idx(cx, cy)] !== PL.ROCK && !propAt(cx, cy) && map[idx(cx, cy)] === T.FLOOR;
      let spot = null;
      for (let r = 0; r <= LAY.rune.searchRings && !spot; r++) for (let oy = -r; oy <= r && !spot; oy++) for (let ox = -r; ox <= r; ox++) {
        const bx = x + ox, by = y + oy;
        if (free(bx, by) && free(bx + 1, by) && free(bx, by + 1) && free(bx + 1, by + 1)) { spot = { x: bx, y: by }; break; }
      }
      if (spot) addSetPiece(spot.x, spot.y, K.rune, 2, 2, { keep: true });
      else addProp(x, y, K.rune, { keep: true });
      const lit = spot ?? { x, y }, off = spot ? 0.5 : 0;
      light(lit.x + off, lit.y + off, K.lightCol, LAY.rune.light.r, LAY.rune.light.s, 'rune');
    } else if (v === PL.TREASURE) { map[i] = T.CHEST; treasureAt = { x, y }; }
  }
  return { portalAt, treasureAt };
}

/** Rule 73: the second seal, from the cell inside the portal. */
function secondSeal(k) {
  const { m, W, H, N, map, idx } = k;
  const e = m.entry, inner = idx(e.x + e.dx, e.y + e.dy);
  const seen = distanceField(W, H, map[inner] === T.WALL ? idx(e.x, e.y) : inner, i => map[i] !== T.WALL);
  for (let i = 0; i < N; i++) if (map[i] !== T.WALL && seen[i] < 0) map[i] = T.WALL;
}

/** Rules 74-76: the centrepiece (a standing 2x2 that blocks, ruled 2026-10-14), shadow's stepping stones, centre lights. */
function centrepiece(k) {
  const { element, row, K, cx, cy, rb, map, idx, inb, at, light, propAt, addProp, addSetPiece, removeProp } = k;
  if (K.center) {
    for (let y = cy; y <= cy + 1; y++) for (let x = cx; x <= cx + 1; x++) { if (map[idx(x, y)] !== T.FLOOR) map[idx(x, y)] = T.FLOOR; const p = propAt(x, y); if (p) removeProp(p); }
    addSetPiece(cx, cy, K.center, 2, 2, { keep: true, flat: false });
  }
  if (element === 'shadow') {
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 4; x <= cx + 4; x++)
      if (inb(x, y) && map[idx(x, y)] === T.FLOOR && rb() < LAY.shadowStepStones.pct / 100 && D4.some(([dx, dy]) => at(x + dx, y + dy) === T.WATER)) addProp(x, y, LAY.shadowStepStones.prop);
  }
  const cl = row.centrepiece.light;
  if (cl) light(cx + cl.dx, cy + cl.dy, cl.col, cl.r, cl.s, 'centre');
}

/** Rule 85: plants and small pieces within a tile of a big piece go (with a mushroom's light); ground by rune stones and the dais. */
function clearNearBig(k) {
  const { ground, lights, idx, inb, rebuild } = k;
  const nearBig = (x, y) => k.props.some(q => BIG_PIECE.test(q.name) && x >= q.x - 1 && x <= q.x + (q.w || 1) && y >= q.y - 1 && y <= q.y + (q.h || 1));
  const drop = k.props.filter(p => !p.keep && (SMALL.test(p.name) || (p.name === 'pt-cluster' && (p.size || 1) < 1)) && nearBig(p.x, p.y));
  if (drop.length) {
    k.props = k.props.filter(p => !drop.includes(p));
    for (let i = lights.length - 1; i >= 0; i--) if (drop.some(p => p.name === 'glow-mushrooms' && p.x === lights[i].x && p.y === lights[i].y)) lights.splice(i, 1);
    rebuild();
  }
  for (const q of k.props) {
    if (!/^(rune-stone-|sun-dais)/.test(q.name)) continue;
    for (let y = q.y - 1; y <= q.y + (q.h || 1); y++) for (let x = q.x - 1; x <= q.x + (q.w || 1); x++) if (inb(x, y)) ground[idx(x, y)] = 0;
  }
}

/**
 * Rules 64-106: the plane floor, its creatures and the arrival cell.
 * @param {number} S plane seed (rule 40) @param {string} element @param {number} hostFloorNo the portal's floor (6-9, 16-19)
 * @param {{s:number}} play the play stream (state.rng)
 * @param {{worldSeed?:number}} [o] the host floor's world seed (the grass salt); by default recovered from S (rule 40)
 */
export function buildPlane(S, element, hostFloorNo, play = stream(S), o = {}) {
  const k = planeKit(S, element, hostFloorNo, play, o), { W, H, cx, cy, map, ground, pool, lights, bodies, suns } = k;
  const { portalAt, treasureAt } = baseTiles(k);
  secondSeal(k);
  centrepiece(k);
  terrainFeatures(k);
  const { player, elite, heartNodes } = planeCreatures(k);
  clearNearBig(k);
  if (k.K.scatter) wallFootScatter(k, player);
  const { deep, vents } = elementDress(k, player, portalAt, treasureAt);

  // ---- Out: rewrite k.props (a multi-tile piece is one prop per covered cell, part 0 at the top-left carrying w and h).
  const outProps = [];
  for (const p of k.props) {
    const extra = {};
    for (const k of ['seed', 'size', 'wallDir', 'keep']) if (p[k] !== undefined && p[k] !== null) extra[k] = p[k];
    if (p.flat) extra.flat = true;
    // Relief shadows (lighting): a standing, blocking piece casts at its feet, half its width wide and its height tall.
    if (p.b && !p.flat) extra.shadow = { width: (p.w ?? 1) / 2, height: p.h ?? 1 };
    if (p.set && (p.w > 1 || p.h > 1)) {
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++)   // the head carries w and h; each other tile points at it (pieces.js)
        outProps.push(x === p.x && y === p.y ? { id: p.name, x, y, blocks: !!p.b, w: p.w, h: p.h, ...extra } : { id: p.name, x, y, part: { x: p.x, y: p.y }, blocks: !!p.b });
    } else outProps.push({ id: p.name, x: p.x, y: p.y, ...(p.b ? { blocks: true } : {}), ...extra });
  }
  const creatures = bodies.filter(b => b !== player);
  const floor = {
    w: W, h: H, tiles: Array.from(map), ground: Array.from(ground), props: outProps, items: [],
    chests: treasureAt ? [{ x: treasureAt.x, y: treasureAt.y, kind: 'chest-plane', plane: element }] : [], traps: [], rooms: [], lights,
    plane: element, biome: element, hostFloor: hostFloorNo,   // biome: the relief's normal set (lighting.json relief-normals)
    portalAt, portal: { x: portalAt.x, y: portalAt.y, plane: element, used: false, home: true },
    arrival: { x: player.x, y: player.y }, treasureAt, centre: { x: cx, y: cy },
    poolField: [...pool.keys()].filter(i => pool[i]), deep, vents, suns, eliteId: elite.id, heartNodes,
    exitOpen: false, noSpawns: true, notes: [],
  };
  portalLight(floor); return { floor, creatures, start: { x: player.x, y: player.y } };   // the way home glows (W3)
}