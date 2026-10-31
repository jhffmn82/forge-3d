// Rules 77-84 of the plane (spec/planes.md; consolidation W7, world-33): the terrain features, planeterrain.js
// ptPlanFeatures, on the build stream, then the fix that moves a blocking feature that cuts the cave.

import { T, G, isOpaqueTile } from '../../data/tiles.js';
import { hash2, noise } from '../../lib/noise.js';
import { pick, shuffle } from '../../lib/rng.js';
import { D4, traceRay } from '../../lib/geometry.js';
import { R } from './kit.js';

const FEAT = R['plane-terrain-features'];

/** 1.7's ptVor (planeterrain.js:118): nearest and second-nearest Voronoi seed distances. */
function voronoi(wx, wy, scale, s) {
  const gx = wx / scale, gy = wy / scale, cx = Math.floor(gx), cy = Math.floor(gy);
  let d1 = 9, d2 = 9;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const lx = cx + ox, ly = cy + oy, px = lx + 0.15 + 0.7 * hash2(lx, ly, s), py = ly + 0.15 + 0.7 * hash2(lx, ly, s + 1);
    const d = (gx - px) ** 2 + (gy - py) ** 2;
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return { d1: Math.sqrt(d1) * scale, d2: Math.sqrt(d2) * scale };
}

/** Rules 77-84: terrain features (planeterrain.js ptPlanFeatures), build stream; then rule 84's reachability fix. */
export function terrainFeatures(k) {
  const { S, element, hostFloorNo, o, PAL, W, H, N, cx, cy, rr, rb, rp, ri, play, map, ground, pool, anchors, suns, idx, inb, at, light, propAt, rebuild, addSetPiece, removeProp, walkable, occupied, wallCell, bfs } = k;
    const water = [];
    for (let i = 0; i < N; i++) if (map[i] === T.WATER) water.push(i);
    if (water.length) {
      let sx = 0, sy = 0;
      for (const i of water) { pool[i] = 1; sx += i % W; sy += (i / W) | 0; }
      sx /= water.length; sy /= water.length;
      light(sx, sy, PAL.poolLight, FEAT.spring.light.r, FEAT.spring.light.s, 'spring');
      let best = null, bd = 1e9;
      for (let yy = Math.floor(sy) - 5; yy <= Math.floor(sy) + 5; yy++) for (let xx = Math.floor(sx) - 6; xx <= Math.floor(sx) + 6; xx++) {
        if (!inb(xx, yy) || map[idx(xx, yy)] !== T.FLOOR) continue;
        if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oy]) => inb(xx + ox, yy + oy) && map[idx(xx + ox, yy + oy)] === T.FLOOR && !propAt(xx + ox, yy + oy))) continue;
        const dd = Math.abs(Math.hypot(xx + 0.5 - sx, yy + 0.5 - sy) - 2.5);
        if (dd < bd) { bd = dd; best = { x: xx + 0.5, y: yy + 0.5 }; }
      }
      if (best) suns.push(best);
    }
    const Px = cx + 1, Py = cy + 1, OC = FEAT.outcrop;
    const floorFree = (x, y) => inb(x, y) && map[idx(x, y)] === T.FLOOR && !propAt(x, y);
    const opaque = (x, y) => isOpaqueTile(map[idx(x, y)]) || ground[idx(x, y)] === G.GRASS;
    // Rule 79: the outcrop.
    let best = null, bs = -1e9;
    for (let y = Py - 10; y <= Py; y++) for (let x = Px + 1; x <= Px + 11; x++) {
      let ok = true;
      for (let yy = y; yy < y + 2 && ok; yy++) for (let xx = x; xx < x + 3; xx++) if (!floorFree(xx, yy)) { ok = false; break; }
      if (!ok) continue;
      let above = 0;
      for (let xx = x; xx < x + 3; xx++) if (wallCell(xx, y - 1)) above++;
      if (above < OC.wallsAboveAtLeast) continue;
      let front = 0;
      for (let xx = x - 1; xx <= x + 3; xx++) if (floorFree(xx, y + 2)) front++;
      if (front < OC.frontFloorAtLeast) continue;
      let seenAll = true;
      for (let ly = y; ly <= y + 2 && seenAll; ly++) for (let lx = x; lx < x + 3; lx++) {
        const path = traceRay({ x: Px, y: Py }, { x: lx, y: ly }, (bx, by) => !inb(bx, by) || opaque(bx, by)).path, le = path[path.length - 1];
        if (!le || le.x !== lx || le.y !== ly) { seenAll = false; break; }
      }
      if (!seenAll) continue;
      const d = Math.hypot(x + 1.5 - Px, y + 1 - Py);
      if (d > OC.maxDistance) continue;
      const sc = (x - Px) * 1.0 + (Py - y) * 1.2 - Math.abs(d - 6) * 1.5;
      if (sc > bs) { bs = sc; best = { x, y }; }
    }
    if (best) {
      const p = addSetPiece(best.x, best.y, OC.prop, 3, 2, { keep: true });
      if (p) { p.b = 1; p.seed = Math.floor(rb() * 1e6); light(best.x + 1.5, best.y + 0.8, PAL.crystalLight, OC.light.r, OC.light.s, 'crystal'); }
    }
    // Rule 80: the decorative pool; none on the Fire plane (ruled 2026-10-15, answer 5).
    if (element !== 'fire') {
      let pb = null, ps = -1e9;
      for (let y = Py - 9; y <= Py - 1; y++) for (let x = Px - 11; x <= Px - 2; x++) {
        let clear = true;
        for (let oy = -1; oy <= 2 && clear; oy++) for (let ox = -1; ox <= 3; ox++) if (!floorFree(x + ox, y + oy)) { clear = false; break; }
        if (!clear) continue;
        const sc = -(Math.abs(x + 1 - (Px - 5)) + Math.abs(y + 0.5 - (Py - 4)));
        if (sc > ps) { ps = sc; pb = { x, y }; }
      }
      if (pb) {
        const DP = FEAT.decorativePool;
        DP.cells.forEach(([ox, oy], k) => { if (k < DP.alwaysFirst || rb() < DP.otherPct / 100) pool[idx(pb.x + ox, pb.y + oy)] = 1; });
        light(pb.x + 1.2, pb.y + 0.6, PAL.poolLight, DP.light.r, DP.light.s, 'pool');
      }
    }
    // Rules 81-82: wall formations at shuffled DECOR anchors.
    const A = anchors.slice(), picked = [], WF = FEAT.wallFormations;
    shuffle(rr, A);
    const wallDir = (x, y) => [[0, -1], [-1, 0], [1, 0]].find(([dx, dy]) => wallCell(x + dx, y + dy)) ?? null;
    const chokepoint = (x, y) => {
      const n = !wallCell(x, y - 1), s = !wallCell(x, y + 1), w = !wallCell(x - 1, y), e = !wallCell(x + 1, y);
      if ((n && s && !w && !e) || (w && e && !n && !s)) return true;
      let open = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && !wallCell(x + ox, y + oy)) open++;
      return open <= 4;
    };
    for (const a of A) {
      if (picked.length >= WF.max || !floorFree(a.x, a.y) || chokepoint(a.x, a.y) || wallCell(a.x, a.y + 1)) continue;
      if (Math.hypot(a.x - Px, a.y - Py) < 5 || picked.some(q => Math.abs(q.x - a.x) + Math.abs(q.y - a.y) < 9) || pool[idx(a.x, a.y)]) continue;
      picked.push(a);
      const big = addSetPiece(a.x, a.y, 'pt-cluster', 1, 1, { keep: true });
      if (big) { big.b = 1; big.seed = Math.floor(rb() * 1e6); big.size = 1; big.wallDir = wallDir(a.x, a.y); }
      light(a.x, a.y, PAL.crystalLight, WF.big.light.r, WF.big.light.s, 'crystal');
      const n = 1 + (rb() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const dx = (rb() < 0.5 ? -1 : 1) * (1 + Math.floor(rb() * 2)), dy = Math.floor(rb() * 3) - 1, x3 = a.x + dx, y3 = a.y + dy;
        if (!floorFree(x3, y3) || !D4.some(([ox, oy]) => wallCell(x3 + ox, y3 + oy)) || wallCell(x3, y3 + 1)) continue;
        const sm = addSetPiece(x3, y3, 'pt-cluster', 1, 1, { keep: true });
        if (sm) { sm.b = 0; sm.flat = 1; sm.seed = Math.floor(rb() * 1e6); sm.size = WF.small.sizes[k]; sm.wallDir = wallDir(x3, y3); }
      }
    }
    // Rule 83: Earth's moss (blobs on the play stream) and grass along Voronoi cracks.
    if (element === 'earth') {
      const seeds = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (map[idx(x, y)] !== T.FLOOR) continue;
        let wall = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (wallCell(x + ox, y + oy)) wall++;
        const wet = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([ox, oy]) => inb(x + ox, y + oy) && pool[idx(x + ox, y + oy)]) ? 1 : 0;
        const pl = propAt(x, y), plant = pl && /fern|mushroom|root/.test(pl.name) ? 1 : 0;
        if (rb() < 0.04 + wall * 0.05 + wet * 0.3 + plant * 0.42) seeds.push({ x, y });
      }
      for (const c of seeds) {
        const size = ri(2, 4), cells = [[c.x, c.y]], done = new Set();
        for (let i = 0; i < cells.length && i < size * 3 && done.size < size; i++) {
          const b = pick(play, cells), k = b[0] + ',' + b[1];
          if (!done.has(k)) { done.add(k); if (map[idx(b[0], b[1])] === T.FLOOR && !ground[idx(b[0], b[1])]) ground[idx(b[0], b[1])] = G.MOSS; }
          const [dx, dy] = D4[Math.floor(rp() * 4)];
          if (inb(b[0] + dx, b[1] + dy)) cells.push([b[0] + dx, b[1] + dy]);
        }
      }
      const worldSeed = o.worldSeed ?? ((S ^ 0x7a11e5 ^ (hostFloorNo * 131)) >>> 0), salt = (worldSeed % 9973) + hostFloorNo * 31 + 911;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (map[idx(x, y)] !== T.FLOOR || ground[idx(x, y)] !== G.MOSS || propAt(x, y)) continue;
        const wx = x + 0.5, wy = y + 0.5, v = voronoi(wx + 0.3 * noise(wx * 1.4, wy * 1.4, salt + 67), wy, 1.5, salt + 61);
        const along = Math.max(0, 1 - (v.d2 - v.d1) / 0.16);
        if (along > 0.35 && rb() < 0.5 + along * 0.4) ground[idx(x, y)] = G.GRASS;
      }
    }
    // Rule 84: a blocking feature that cuts the cave moves to a ring 2..7 away, else is left out.
    const firstWalkable = () => { for (let i = 0; i < N; i++) if (walkable(i % W, (i / W) | 0)) return { x: i % W, y: (i / W) | 0 }; return null; };
    const unreachable = () => {
      const s0 = firstWalkable(); if (!s0) return null;
      const d = bfs(s0.x, s0.y);
      for (let i = 0; i < N; i++) if (walkable(i % W, (i / W) | 0) && d[i] < 0) return { x: i % W, y: (i / W) | 0 };
      return null;
    };
    const goodSpot = (p, x, y) => {
      const pw = p.w || 1, ph = p.h || 1;
      for (let yy = y; yy < y + ph; yy++) for (let xx = x; xx < x + pw; xx++) {
        if (!inb(xx, yy) || map[idx(xx, yy)] !== T.FLOOR || occupied(xx, yy)) return false;
        const q = propAt(xx, yy); if (q && q !== p) return false;
        if (wallCell(xx, y + ph)) return false;
        let open = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && !wallCell(xx + ox, yy + oy)) open++;
        if (open < 5) return false;
      }
      return true;
    };
    for (let passN = 0; passN < FEAT.reachabilityFix.passes; passN++) {
      const bad = unreachable(); if (!bad) break;
      const p = k.props.filter(q => (q.name === 'pt-cluster' || q.name === 'pt-outcrop' || /^rune-stone/.test(q.name)) && q.b)
        .sort((a, b) => (Math.abs(a.x - bad.x) + Math.abs(a.y - bad.y)) - (Math.abs(b.x - bad.x) + Math.abs(b.y - bad.y)))[0];
      if (!p) break;
      const ox0 = p.x, oy0 = p.y;
      let moved = false;
      for (let r = 2; r <= 7 && !moved; r++) for (let dy = -r; dy <= r && !moved; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = ox0 + dx, ny = oy0 + dy;
        if (Math.abs(dx) + Math.abs(dy) < 2 || !goodSpot(p, nx, ny)) continue;
        p.x = nx; p.y = ny; if (p.wallDir) p.wallDir = wallDir(nx, ny);
        rebuild();
        if (!unreachable()) { moved = true; break; }
        p.x = ox0; p.y = oy0; rebuild();
      }
      if (!moved) removeProp(p);
    }
}
