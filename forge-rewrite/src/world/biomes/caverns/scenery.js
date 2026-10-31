// The Caverns' scenery (spec/world.md Caverns 80-99; biomes.json caverns wallFeatures, theme, clusters,
// chamberDressing, furniture, cleanup): wall features and the one waterfall, this floor's theme, cluster groups and glow
// moss (laid with the map, 1.7 caveDecorate), each plain chamber's tall pieces and kobold camp (decorateCavernRoom); 1.7's
// floor decals, lichen and glowing pool are not laid (item 204: "let's drop these sticker art pieces"); the Maw's arena
// (buildCaveArena), the shared furniture a cave asks for (CAVE_PROP) and the trims after the floor is built (cavefixes.js
// trim and clear). 1.7's dice in 1.7's order (caverns.js @3c8b312), less the ones the dropped pieces took.
//
// Output on the floor: props ({id, x, y}; a piece wider than a tile is a head plus `part` tiles, as the Crypt's
// placePiece), floor.caveDeco {walls:[{x,y,n,fall?}]}, floor.lights scene entries [{kind:'scene',x,y,colour,radius,strength}] (drawn
// only; the Caverns burn them at 55% strength and 85% reach, cavefixes.js 5) and floor.caveTheme.

import biomes from '../../../../data/biomes.json' with { type: 'json' };
import props from '../../../../data/props.json' with { type: 'json' };
import { next, roll, shuffled, pick, weighted } from '../../../lib/rng.js';
import { T, isObjectTile, isDoor } from '../../../data/tiles.js';
import { hash2 } from '../../../lib/noise.js';
import { roomCells, MW, MH } from './layout.js';
import { blob, components } from '../../../lib/grid.js';
import { D4 } from '../../../lib/geometry.js';
import { remapExempt } from '../../dress.js';
import { placePiece, footprint } from '../../pieces.js';


const B = biomes.rows.caverns;
const LE = { edge: 'le' };   // 1.7's cave draws stop at zero or below
const variant = (rng, base, n) => `${base}-${1 + Math.floor(next(rng) * n)}`;
/** Footprints of the cave pieces wider than a tile (caverns.js CAVE_PIECES w, h). */
/** A piece's size (props.json footprint). */
export const sizeOf = id => { const fp = footprint(id); return [fp.w, fp.h]; };
/** caverns.js CAVE_TALL: [kind, variants, weight]. */
const TALL = Object.entries(B.theme.tall.weights).map(([k, w]) => [k, B.theme.tall.variants[k] === 1 ? 0 : B.theme.tall.variants[k], w]);

const at = (f, x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? T.WALL : f.tiles[y * MW + x]);
const wallAt = (f, x, y) => { const t = at(f, x, y); return t === T.WALL || t === T.SECRET; };

/** The prop on a tile (a piece's part tiles count), as 1.7's propGrid answers. */
export function propOn(f, x, y) { return f.props.find(p => p.x === x && p.y === y) ?? null; }

/** 1.7 createProp: refused off the map, on a prop or on an object tile. */
export function addProp(f, x, y, id, extra = {}) {
  if (x < 0 || y < 0 || x >= MW || y >= MH || propOn(f, x, y) || isObjectTile(at(f, x, y))) return null;
  const p = { id, x, y, ...extra };
  f.props.push(p);
  return p;
}
/** 1.7 addSetPiece: a kept head on its top-left tile and a blocking part on each other tile. */
export function addPiece(f, x, y, id, w, h, extra = {}) {
  if (x < 0 || y < 0 || x >= MW || y >= MH || propOn(f, x, y) || isObjectTile(at(f, x, y))) return null;   // as addProp
  return placePiece(f, id, x, y, { w, h, head: { keep: true, ...extra }, blocks: true });
}
/** 1.7 cavePlace: a tall piece is not kept (keep:false), so the reach fallback may clear one that blocks a route. */
const place = (f, x, y, id, extra) => { const [w, h] = sizeOf(id); return w > 1 || h > 1 ? addPiece(f, x, y, id, w, h, { keep: false, cave: true, ...extra }) : addProp(f, x, y, id); };

/** 1.7 nearDoor with the cave's rooms: a door in the 3 x 3, or (for a chamber cell) a tunnel mouth beside it. */
export function nearDoor(f, grid, x, y) {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isDoor(at(f, x + dx, y + dy))) return true;
  if (grid[y * MW + x] < 0) return false;
  return D4.some(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < MW && ny < MH && at(f, nx, ny) === T.FLOOR && grid[ny * MW + nx] < 0; });
}
const free = (f, x, y) => at(f, x, y) === T.FLOOR && !propOn(f, x, y) && !f.items.some(i => i.x === x && i.y === y);
/** caveFootFree: a w x h footprint of this chamber's free floor, not by a door, not its centre. */
function footFree(f, grid, x, y, w, h, room) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
    if (!free(f, xx, yy) || nearDoor(f, grid, xx, yy) || (room && grid[yy * MW + xx] !== room.id) || (room && xx === room.cx && yy === room.cy)) return false;
  }
  return true;
}
/** caveEdgeCells, caveInteriorCells: a chamber's free floor cells against the rock, and away from it. */
export function edgeCells(f, grid, r) {
  return roomCells(grid, r).filter(({ x, y }) => at(f, x, y) === T.FLOOR && !propOn(f, x, y) && !nearDoor(f, grid, x, y) && !(x === r.cx && y === r.cy)
    && (wallAt(f, x - 1, y) || wallAt(f, x + 1, y) || wallAt(f, x, y - 1) || wallAt(f, x, y + 1)));
}
export function interiorCells(f, grid, r) {
  return roomCells(grid, r).filter(({ x, y }) => at(f, x, y) === T.FLOOR && !propOn(f, x, y) && !(x === r.cx && y === r.cy)
    && !(wallAt(f, x - 1, y) || wallAt(f, x + 1, y) || wallAt(f, x, y - 1) || wallAt(f, x, y + 1)));
}

/** The shared furniture a cave asks for (world.md Caverns 92): a dungeon id becomes a cave piece, else stays. */
export function caveFurniture(rng, id, extra = {}) {
  const list = B.furniture[id];
  if (!list || remapExempt(extra)) return id;
  return pick(rng, list);
}
/** 1.7 decorateEdges with cave edges and the cave theme on each piece. */
export function decorateEdges(rng, f, grid, r, names, n, extra = {}) {
  const e = shuffled(rng, edgeCells(f, grid, r));
  for (let i = 0; i < Math.min(n, e.length); i++) addProp(f, e[i].x, e[i].y, caveFurniture(rng, names[i % names.length], extra), extra);
}

/** This floor's look (1.7 caveTheme): 2-3 tall kinds and 2 cluster kinds by weight, lost miners 30%. */
function theme(rng, f) {
  if (f.caveTheme) return f.caveTheme;
  const some = (list, n) => {
    const l = list.slice(), out = [];
    while (out.length < n && l.length) {
      const t = weighted(rng, l, x => x[x.length - 1], LE);
      out.push(t); l.splice(l.indexOf(t), 1);
    }
    return out;
  };
  const n = roll(rng, B.theme.tall.pick[0], B.theme.tall.pick[1]);
  const tall = some(TALL, n);
  const clusters = some(Object.entries(B.theme.clusters.weights), B.theme.clusters.pick).map(c => c[0]);
  return (f.caveTheme = { tall, clusters, miner: next(rng) < B.theme.minerPct / 100 });
}

/** 1.7 caveDecorate: wall features and the waterfall, cluster groups, glow moss. No decals or lichen are laid on the
 *  floor (item 204, Justin 2026-10-19: "let's drop these sticker art pieces"). */
export function decorate(rng, f, grid, rooms) {
  const salt = Math.floor(next(rng) * 1e6), deco = { walls: [] }, lights = (f.lights ??= []);
  f.caveDeco = deco;
  // Wall features on cliff faces (rock with floor below), never side by side; one waterfall, half the floors.
  const WF = B.wallFeatures;
  let fallDone = next(rng) > WF.waterfallAllowedPct / 100;
  for (let y = 2; y < MH - 2; y++) for (let x = 2; x < MW - 2; x++) {
    if (!wallAt(f, x, y) || at(f, x, y + 1) !== T.FLOOR) continue;
    if (deco.walls.some(w => Math.abs(w.x - x) <= 1 && Math.abs(w.y - y) <= 1)) continue;
    if (!fallDone && at(f, x, y + 2) === T.FLOOR && at(f, x - 1, y + 1) === T.FLOOR && at(f, x + 1, y + 1) === T.FLOOR && wallAt(f, x - 1, y) && wallAt(f, x + 1, y) && next(rng) < WF.waterfallPct / 100) {
      fallDone = true; deco.walls.push({ x, y, n: 'wf-waterfall-1', fall: true });
      f.tiles[(y + 1) * MW + x] = T.WATER;
      blob(() => next(rng), MW, MH, x, y + 2, roll(rng, WF.waterfallPool[0], WF.waterfallPool[1]), (xx, yy) => { if (at(f, xx, yy) === T.FLOOR && Math.abs(xx - x) <= 2) f.tiles[yy * MW + xx] = T.WATER; });
      lights.push({ kind: 'scene', x, y: y + 1.2, colour: WF.waterfallLight.col, radius: WF.waterfallLight.r, strength: WF.waterfallLight.s });
      continue;
    }
    if (hash2(x, y, salt + 11) > WF.hashMax) continue;
    const r = hash2(x, y, salt + 13), name = r < WF.drapery.pct / 100 ? 'wf-stalactite-drapery-' + (1 + Math.floor(hash2(x, y, salt + 17) * WF.drapery.variants)) : 'wf-glowworm-curtain-' + (1 + Math.floor(hash2(x, y, salt + 19) * WF.glowworm.variants));
    deco.walls.push({ x, y, n: name });
    if (/glowworm/.test(name)) lights.push({ kind: 'scene', x, y: y + 0.9, colour: /-2$/.test(name) ? WF.glowworm.lights[1] : WF.glowworm.lights[0], radius: WF.glowworm.r, strength: WF.glowworm.s });
  }
  // Clusters: a few small groups a chamber, mostly along the rock; this floor's kinds only.
  const TH = theme(rng, f), CLW = B.clusters.weights, huggers = new Set(B.clusters.wallHuggers);
  const CL = Object.entries(CLW).filter(([k]) => TH.clusters.includes(k) || (k === 'lost-miner' && TH.miner));
  let miners = 0;
  const groupNear = (x, y) => f.props.some(p => /^cl-/.test(p.id) && Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2);
  const touches = (x, y) => wallAt(f, x - 1, y) || wallAt(f, x + 1, y) || wallAt(f, x, y - 1) || wallAt(f, x, y + 1);
  for (const room of rooms) {
    if (!room.cave) continue;
    const groups = room.arena ? roll(rng, 1, 2) : Math.min(2, Math.floor(room.n / 40) + (next(rng) < 0.4 ? 1 : 0));
    const edge = shuffled(rng, roomCells(grid, room).filter(c => free(f, c.x, c.y) && touches(c.x, c.y)));
    const inner = shuffled(rng, roomCells(grid, room).filter(c => free(f, c.x, c.y)));
    for (let g = 0; g < groups; g++) {
      let kind = weighted(rng, CL, t => t[1], LE)[0];
      if (kind === 'lost-miner' && miners++ >= B.clusters.minerMax) kind = 'rubble';
      const hugs = huggers.has(kind);
      let c;
      while ((c = hugs ? edge.pop() : ((next(rng) < B.clusters.otherEdgePct / 100 ? edge.pop() : inner.pop()) || edge.pop())) && groupNear(c.x, c.y)) { /* skip anchors by another group */ }
      if (!c) break;
      const n2 = kind === 'lost-miner' ? 1 : next(rng) < 0.3 ? 1 : next(rng) < 0.75 ? 2 : 3;
      for (const q of clusterCells(rng, c, n2, (x, y) => free(f, x, y) && grid[y * MW + x] === room.id)) addProp(f, q.x, q.y, variant(rng, 'cl-' + kind, 4));
    }
    // Glow moss creeps along the foot of the rock in a streak.
    if (next(rng) < B.clusters.glowMoss.chamberPct / 100) {
      const isEdge = (x, y) => free(f, x, y) && grid[y * MW + x] === room.id && touches(x, y);
      let st = edge.pop();
      const len = roll(rng, B.clusters.glowMoss.length[0], B.clusters.glowMoss.length[1]), used = new Set();
      for (let q = 0; st && q < len; q++) {
        addProp(f, st.x, st.y, variant(rng, 'cl-glow-moss', 4)); used.add(st.y * MW + st.x);
        const nxt = D4.map(([dx, dy]) => ({ x: st.x + dx, y: st.y + dy })).filter(c2 => !used.has(c2.y * MW + c2.x) && isEdge(c2.x, c2.y));
        st = nxt.length ? pick(rng, nxt) : null;
      }
    }
  }
}

/** caveClusterCells: the anchor, then ring cells that pass ok, never three in one row or column. */
function clusterCells(rng, c, n, ok) {
  const cells = [{ x: c.x, y: c.y }];
  const ring = shuffled(rng, [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]].map(d => ({ x: c.x + d[0], y: c.y + d[1] })));
  const collinear = list => list.length >= 3 && (list.every(q => q.x === list[0].x) || list.every(q => q.y === list[0].y));
  for (let i = 0; i < ring.length && cells.length < n; i++) {
    const q = ring[i]; if (!ok(q.x, q.y)) continue;
    if (collinear(cells.concat([q]))) continue;
    cells.push(q);
  }
  return cells;
}

/** caveTallSpot: a footprint against the rock (rock above it, or beside it), the row in front left open. */
function tallSpot(rng, f, grid, room, w, h) {
  for (const c of shuffled(rng, roomCells(grid, room))) {
    if (!footFree(f, grid, c.x, c.y, w, h, room)) continue;
    let backed = false; for (let xx = c.x; xx < c.x + w; xx++) if (wallAt(f, xx, c.y - 1)) backed = true;
    if (!backed && !(wallAt(f, c.x - 1, c.y) || wallAt(f, c.x + w, c.y))) continue;
    let front = 0; for (let fx = c.x - 1; fx <= c.x + w; fx++) if (at(f, fx, c.y + h) === T.FLOOR) front++;
    if (front < w + 1) continue;
    return c;
  }
  return null;
}
function tallPiece(rng, f, grid, room) {
  const t = weighted(rng, theme(rng, f).tall, x => x[2], LE);
  const name = t[1] ? variant(rng, t[0], t[1]) : t[0], [w, h] = sizeOf(name);
  const s = tallSpot(rng, f, grid, room, w, h);
  return s ? place(f, s.x, s.y, name) : null;
}
/** decorateCavernRoom: a plain chamber gets a tall piece or two, sometimes the floor's kobold camp (no glowing pool: item 204). */
export function dressChamber(rng, f, grid, r) {
  const D = B.chamberDressing;
  if (next(rng) < D.tallPct / 100) tallPiece(rng, f, grid, r);
  if (r.n >= D.secondTall.minCells && next(rng) < D.secondTall.pct / 100) tallPiece(rng, f, grid, r);
  if (!f.koboldCamp && r.role !== 'start' && r.n >= D.koboldCamp.minCells && next(rng) < D.koboldCamp.pct / 100) koboldCamp(rng, f, grid, r);
}
function koboldCamp(rng, f, grid, r) {
  const cells = shuffled(rng, interiorCells(f, grid, r)).filter(c => footFree(f, grid, c.x, c.y, 1, 1, r));
  for (const c of cells) {
    let around = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].map(o => ({ x: c.x + o[0], y: c.y + o[1] })).filter(p => footFree(f, grid, p.x, p.y, 1, 1, r));
    if (around.length < B.chamberDressing.koboldCamp.minFreeNeighbours) continue;
    place(f, c.x, c.y, 'kobold-campfire');
    around = shuffled(rng, around);
    place(f, around[2].x, around[2].y, next(rng) < 0.5 ? 'kobold-crate' : 'kobold-pickaxe');
    f.koboldCamp = { x: c.x, y: c.y };
    return true;
  }
  return false;
}

/** buildCaveArena (floor 15): 3-5 closed burrows, 4 cave lights round the walls, a faint cold light over the hall. */
export function buildArena(rng, f, grid, r) {
  r.role = 'boss';
  const centre = { x: r.cx, y: r.cy }, mounds = [];
  f.bossAt = centre;
  const spotOK = (x, y) => {
    for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = x - 1; xx <= x + 2; xx++) if (at(f, xx, yy) !== T.FLOOR || grid[yy * MW + xx] !== r.id || propOn(f, xx, yy)) return false;
    if (Math.max(Math.abs(x + 0.5 - centre.x), Math.abs(y + 0.5 - centre.y)) < 3) return false;
    return !mounds.some(m => Math.max(Math.abs(m.x - x), Math.abs(m.y - y)) < 5);
  };
  const want = roll(rng, 3, 5), cells = shuffled(rng, roomCells(grid, r));
  for (let i = 0; i < cells.length && mounds.length < want; i++) {
    const c = cells[i]; if (!spotOK(c.x, c.y)) continue;
    if (addPiece(f, c.x, c.y, 'worm-burrow-closed', 2, 2, { cave: true, mound: true })) mounds.push({ x: c.x, y: c.y });
  }
  f.bossArena = { x: r.x, y: r.y, w: r.w, h: r.h, mounds };
  decorateEdges(rng, f, grid, r, ['torch-stand'], 4);
  (f.lights ??= []).push({ kind: 'scene', x: centre.x, y: centre.y, colour: '#7A9CB0', radius: 7, strength: 0.35 });
}

/** finishGeneratedCaverns: no grass underground (grass to moss, trampled cleared); each body of water glows. */
export function finishCaverns(f, G) {
  for (let i = 0; i < f.ground.length; i++) { if (f.ground[i] === G.GRASS) f.ground[i] = G.MOSS; else if (f.ground[i] === G.SHORT) f.ground[i] = 0; }
  const L = B.lights.waterBody;
  for (const q of components(MW, MH, k => f.tiles[k] === T.WATER, { lists: true }).lists) {
    let sx = 0, sy = 0;
    for (const c of q) { sx += c % MW; sy += (c / MW) | 0; }
    (f.lights ??= []).push({ kind: 'scene', x: sx / q.length, y: sy / q.length, colour: L.col, radius: Math.min(5, 2.6 + q.length * 0.25), strength: L.s });
  }
}

const BIG = /^(geode|mushroom-pair|stalagmite-group|worm-burrow|mine-support|giant-mushroom|pylon|stalagmite-tall)/;
/** trimGeneratedCavernClusters and clearGeneratedCavernProps (world.md Caverns 90). */
export function trimScenery(f) {
  const moss = f.props.filter(p => !p.keep && /^cl-glow-moss/.test(p.id));
  const lone = moss.filter(p => !moss.some(q => q !== p && Math.abs(q.x - p.x) + Math.abs(q.y - p.y) === 1));
  const loose = f.props.filter(p => !p.keep && /^cl-(crystal-shards|rubble|small-mushrooms)/.test(p.id) && !D4.some(([dx, dy]) => wallAt(f, p.x + dx, p.y + dy)));
  const drop = new Set([...lone, ...loose]);
  f.props = f.props.filter(p => !drop.has(p));
  const TH = f.caveTheme;
  if (TH) {
    const tallKinds = TH.tall.map(t => t[0]);
    f.props = f.props.filter(p => {
      if (p.keep) return true;
      const m = p.id.match(/^cl-(small-mushrooms|crystal-shards|rubble|cave-pearls|lost-miner)/);
      if (m) return TH.clusters.includes(m[1]) || (m[1] === 'lost-miner' && TH.miner);
      const tl = p.id.match(/^(stalagmite-tall|giant-mushroom|pylon|stalagmite-group|geode|mushroom-pair|mine-cart|mine-support)/);
      if (tl && !p.part) return tallKinds.includes(tl[1]);
      return true;
    });
    // A tall piece's parts go with their head.
    const heads = new Set(f.props.filter(p => p.w || p.h).map(p => `${p.x},${p.y}`));
    f.props = f.props.filter(p => !p.part || heads.has(`${p.part.x},${p.part.y}`));
  }
  const bigs = f.props.filter(p => BIG.test(p.id) && !p.part);
  const nearBig = (x, y) => bigs.some(b => x >= b.x - 1 && x <= b.x + (b.w ?? 1) && y >= b.y - 1 && y <= b.y + (b.h ?? 1));
  f.props = f.props.filter(p => p.keep || !(/^cl-/.test(p.id) && nearBig(p.x, p.y)));
}

