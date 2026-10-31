// An elemental plane's cave layout (spec/planes.md rules 45-63; data/planes.json plane-layout), 1.7's makePlaneMap
// draw for draw (js/world/planes/planes.js:23-125 @3c8b312): the same seed gives the very grid 1.7 gives
// (tools/mapgen/planes-match.mjs checks it). One layout stream, mulberry32((S >>> 0) ^ 0x9E3779B9) (rule 41).
// The element only picks the centrepiece pass, after the cave is fixed.

import planes from '../../../data/planes.json' with { type: 'json' };
import { stream, next } from '../../lib/rng.js';
import { distanceField } from '../../lib/grid.js';

const LAY = planes.rows['plane-layout'];
const pass = name => LAY.passes.find(p => p.pass === name);
export const PL = LAY.codes;   // ROCK 0, FLOOR 1, WATER 2, CENTER 3, DECOR 4, TREASURE 5, RUNE 6, ENTRY 7, LIGHT 8, BLOCK 9
const [W, H] = LAY.size;
const FILL = pass('fill').floorPct / 100, SMOOTH = pass('smooth');
const CORNERS = pass('grotto-corners'), DECOR = pass('decor-scan');

/** Which centrepiece each plane's layout digs (rule 60): voidpool, mound or dais. */
export const centreKind = el => planes.rows['plane-' + el]?.centrepiece.layout ?? 'dais';

/**
 * Rules 45-63: one plane layout from the plane seed S.
 * @param {number} S the plane seed @param {string} element
 * @returns {{w:number,h:number,cells:Uint8Array,entry:{x:number,y:number,dx:number,dy:number},cx:number,cy:number,
 *   treasure:{x:number,y:number},rune:{x:number,y:number},pool:{x:number,y:number,r:number},pockets:{x:number,y:number}[],
 *   side:number,floorCount:number,decor:number,lights:number}}
 */
export function planeLayout(S, element) {
  const st = stream(((S >>> 0) ^ 0x9e3779b9) >>> 0), r = () => next(st);
  let g = new Uint8Array(W * H);
  const I = (x, y) => y * W + x;
  const inside = (x, y, m = 1) => x >= m && y >= m && x < W - m && y < H - m;
  const rnd = (a, b) => a + Math.floor(r() * (b - a + 1));
  // Rule 52: the wobbly ellipse every room uses; returns the cells it painted.
  const blob = (cx, cy, rx, ry, val = PL.FLOOR, round = false) => {
    const cells = [];
    for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
      if (!inside(x, y, 2)) continue;
      const a = Math.atan2(y - cy, x - cx), wob = round ? 1 + 0.06 * Math.sin(a * 4 + cx) : 1 + 0.18 * Math.sin(a * 3 + cx) + 0.12 * Math.sin(a * 5 + cy);
      const d = Math.pow((x - cx) / (rx * wob), 2) + Math.pow((y - cy) / (ry * wob), 2);
      if (d <= 1) { g[I(x, y)] = val; cells.push({ x, y }); }
    }
    return cells;
  };
  // Rule 54: a drunken tunnel, carving a width x width square after each step.
  const carve = (x, y, width) => { for (let oy = 0; oy < width; oy++) for (let ox = 0; ox < width; ox++) if (inside(x + ox, y + oy, 2) && g[I(x + ox, y + oy)] === PL.ROCK) g[I(x + ox, y + oy)] = PL.FLOOR; };
  const tunnel = (ax, ay, bx, by, width) => {
    let x = ax, y = ay, guard = 0;
    carve(x, y, width);
    while ((x !== bx || y !== by) && guard++ < 400) {
      if (r() < 0.72) { if (Math.abs(bx - x) > Math.abs(by - y)) x += Math.sign(bx - x); else y += Math.sign(by - y); }
      else if (r() < 0.5) x += Math.sign(bx - x) || rnd(-1, 1);
      else y += Math.sign(by - y) || rnd(-1, 1);
      x = Math.max(2, Math.min(W - 3, x)); y = Math.max(2, Math.min(H - 3, y));
      carve(x, y, width);
    }
  };

  // 1. Rule 47: rough cave, then smoothing.
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) g[I(x, y)] = r() < FILL ? PL.FLOOR : PL.ROCK;
  for (let it = 0; it < SMOOTH.iterations; it++) {
    const n2 = new Uint8Array(g);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      let walls = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && g[I(x + dx, y + dy)] === PL.ROCK) walls++;
      n2[I(x, y)] = walls >= SMOOTH.rockIfRockAtLeast ? PL.ROCK : walls <= SMOOTH.floorIfRockAtMost ? PL.FLOOR : g[I(x, y)];
    }
    g = n2;
  }

  // 2. Rule 48: the entrance side.
  const side = rnd(0, 3);
  const midX = () => rnd(Math.floor(W * 0.35), Math.floor(W * 0.65)), midY = () => rnd(Math.floor(H * 0.35), Math.floor(H * 0.65));
  const ent = side === 0 ? { x: midX(), y: H - 3, dx: 0, dy: -1 } : side === 1 ? { x: midX(), y: 2, dx: 0, dy: 1 }
    : side === 2 ? { x: 2, y: midY(), dx: 1, dy: 0 } : { x: W - 3, y: midY(), dx: -1, dy: 0 };

  // 3. Rules 49-50: the chamber centre, then the grottos in the corners away from the entrance.
  const cx = Math.floor(W / 2) + rnd(-5, 5) - ent.dx * 3, cy = Math.floor(H / 2) + rnd(-2, 2) - ent.dy * 2;
  const corners = CORNERS.corners.map(([x0, y0]) => ({ x: x0 + rnd(-CORNERS.jitter.x, CORNERS.jitter.x), y: y0 + rnd(-CORNERS.jitter.y, CORNERS.jitter.y), d: Math.abs(x0 - ent.x) + Math.abs(y0 - ent.y) }))
    .sort((a, b) => b.d - a.d);
  let treasureAt = corners[0], poolAt = corners[1];
  if (r() < CORNERS.swapPct / 100) [treasureAt, poolAt] = [poolAt, treasureAt];
  const clearRing = (c, rad) => { for (let y = c.y - rad; y <= c.y + rad; y++) for (let x = c.x - rad; x <= c.x + rad; x++) if (inside(x, y, 2)) g[I(x, y)] = PL.ROCK; };
  clearRing(treasureAt, CORNERS.forceRockRadius.treasure); clearRing(poolAt, CORNERS.forceRockRadius.pool);

  // 4. Rules 51-55: the chamber, the hallway in its band of rock, the tunnel between them.
  blob(cx, cy, rnd(8, 10), rnd(5, 6));
  const hallLen = rnd(5, 7);
  let hx = ent.x, hy = ent.y;
  for (let k = -1; k <= hallLen; k++) for (let w = -2; w <= 2; w++) {
    const x = ent.x + ent.dx * k + (ent.dx === 0 ? w : 0), y = ent.y + ent.dy * k + (ent.dy === 0 ? w : 0);
    if (inside(x, y, 1)) g[I(x, y)] = PL.ROCK;
  }
  for (let k = 0; k < hallLen; k++) {
    g[I(hx, hy)] = PL.FLOOR;
    if (ent.dx === 0) { g[I(hx + 1, hy)] = PL.ROCK; g[I(hx - 1, hy)] = PL.ROCK; } else { g[I(hx, hy + 1)] = PL.ROCK; g[I(hx, hy - 1)] = PL.ROCK; }
    hx += ent.dx; hy += ent.dy;
  }
  tunnel(hx, hy, cx, cy, 2);

  // Rules 56-58: the grottos, the treasure's dead-end neck, the side pockets.
  const tr = rnd(3, 4), pr = rnd(3, 4);
  blob(treasureAt.x, treasureAt.y, tr, tr - 1, PL.FLOOR, true);
  blob(poolAt.x, poolAt.y, pr + 1, pr, PL.FLOOR, true);
  tunnel(treasureAt.x, treasureAt.y, cx + Math.sign(treasureAt.x - cx) * 4, cy, 1);
  tunnel(poolAt.x, poolAt.y, cx, cy, 2);
  const pockets = rnd(1, 2), sidePockets = [];
  for (let p = 0; p < pockets; p++) {
    const px = r() < 0.5 ? rnd(5, 12) : rnd(W - 13, W - 6), py = midY();
    blob(px, py, rnd(2, 3), 2); tunnel(px, py, cx, cy, 1); sidePockets.push({ x: px, y: py });
  }

  // 5. Rule 59: keep only what the entrance reaches.
  const seen = distanceField(W, H, I(ent.x, ent.y), i => inside(i % W, (i / W) | 0, 1) && g[i] !== PL.ROCK);
  for (let i = 0; i < g.length; i++) if (seen[i] < 0) g[i] = PL.ROCK;

  // 6. Rules 60-63: the pieces.
  g[I(ent.x, ent.y)] = PL.ENTRY;
  const kind = centreKind(element);
  if (kind === 'voidpool') { for (const c of blob(cx, cy, 4, 2, PL.WATER)) if (r() < 0.08) g[I(c.x, c.y)] = PL.FLOOR; g[I(cx, cy)] = PL.CENTER; }
  else if (kind === 'mound') { blob(cx, cy, 2, 1, PL.BLOCK); for (const [ox, oy] of [[-3, -1], [3, 1], [-2, 2], [2, -2]]) g[I(cx + ox, cy + oy)] = PL.BLOCK; }
  else blob(cx, cy, 2, 2, PL.CENTER);
  blob(poolAt.x, poolAt.y, Math.max(1, pr - 1), Math.max(1, pr - 2), PL.WATER);
  const rune = { x: treasureAt.x - Math.sign(cx - treasureAt.x), y: treasureAt.y - Math.sign(cy - treasureAt.y) };
  g[I(rune.x, rune.y)] = PL.RUNE; g[I(treasureAt.x, treasureAt.y)] = PL.TREASURE;
  let decor = 0, lights = 0;
  for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
    if (g[I(x, y)] !== PL.FLOOR) continue;
    let rock = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[I(x + dx, y + dy)] === PL.ROCK) rock++;
    if (rock >= DECOR.decor.rockIn3x3AtLeast && r() < DECOR.decor.pct / 100) { g[I(x, y)] = PL.DECOR; decor++; }
    else if (rock === DECOR.light.rockIn3x3 && r() < DECOR.light.pct / 100) { g[I(x, y)] = PL.LIGHT; lights++; }
  }
  let floorCount = 0;
  for (const v of g) if (v !== PL.ROCK) floorCount++;
  return { w: W, h: H, cells: g, element, seed: S, side, entry: ent, cx, cy, treasure: { x: treasureAt.x, y: treasureAt.y }, rune,
    pool: { x: poolAt.x, y: poolAt.y, r: pr }, pockets: sidePockets, floorCount, decor, lights };
}
