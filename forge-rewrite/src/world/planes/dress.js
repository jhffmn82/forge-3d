// Rules 86-97 of the plane (spec/planes.md; consolidation W7): the fire, water and air wall-foot scatter (play stream)
// and the element's own dressing on its own stream (planesfwa.js fwaDress).

import { stream, next, pick, shuffle } from '../../lib/rng.js';
import { T, G } from '../../data/tiles.js';
import { D4 } from '../../lib/geometry.js';
import { R } from './kit.js';

const DRESS = { fire: R['plane-dress-fire'], water: R['plane-dress-water'], air: R['plane-dress-air'] };

/** Rule 86: the wall-foot scatter in streaks of 3-4, kept 3 from the arrival. */
export function wallFootScatter(k, player) {
  const { element, K, W, H, ri, play, at, propAt, addProp } = k;
  if (K.scatter) {
    let spots = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (at(x, y) !== T.FLOOR || propAt(x, y) || Math.max(Math.abs(x - player.x), Math.abs(y - player.y)) < 3) continue;
      if (D4.some(([dx, dy]) => at(x + dx, y + dy) === T.WALL || at(x + dx, y + dy) === T.SECRET)) spots.push({ x, y });
    }
    spots = spots.slice();
    shuffle(play, spots);
    for (let k = 0, put = 0; k < spots.length && put < DRESS[element].scatter.streaks; k++) {
      const sp = spots[k], run = ri(3, 4);
      for (let j = 0; j < run; j++) {
        if (at(sp.x + j, sp.y) !== T.FLOOR || propAt(sp.x + j, sp.y)) break;
        addProp(sp.x + j, sp.y, pick(play, K.scatter), { flat: 1 });
      }
      put++;
    }
  }
}

/** Rules 87-97: the element's dressing (lava, the lagoon, vents). Returns {deep, vents}. */
export function elementDress(k, player, portalAt, treasureAt) {
  const { S, element, W, H, N, cx, cy, map, ground, pool, bodies, idx, inb, at, light, propAt, addProp, walkable, occupied, bfs, nearFree } = k;
  const deep = [], vents = [];
  if (DRESS[element]) {
    const rd = stream((S ^ 0x2b8f5c1) >>> 0), rx = () => next(rd), D = DRESS[element];
    const free = (x, y) => inb(x, y) && map[idx(x, y)] === T.FLOOR && !propAt(x, y)
      && !(Math.abs(x - portalAt.x) + Math.abs(y - portalAt.y) <= 2) && !(treasureAt && Math.abs(x - treasureAt.x) + Math.abs(y - treasureAt.y) <= 2);
    if (element === 'fire') {
      const oldPool = [];
      for (let i = 0; i < N; i++) if (map[i] === T.WATER) { map[i] = T.FLOOR; oldPool.push(i); pool[i] = 0; }
      const allReachable = () => { const d = bfs(player.x, player.y); for (let i = 0; i < N; i++) if (walkable(i % W, (i / W) | 0) && d[i] < 0) return false; return true; };
      const lavaBlock = cells => {
        if (!cells.length) return 0;
        const old = cells.map(i => map[i]);
        for (const i of cells) map[i] = T.LAVA;
        if (allReachable()) return cells.length;
        cells.forEach((i, k) => { map[i] = old[k]; });
        return 0;
      };
      const lit = [];
      let poured = 0;
      const pour = (x0, y0, rad, wob) => {
        const cells = [];
        for (let y = y0 - rad - 1; y <= y0 + rad + 1; y++) for (let x = x0 - rad - 1; x <= x0 + rad + 1; x++) {
          if (!free(x, y)) continue;
          const a = Math.atan2(y - y0, x - x0), rw = rad * (1 + wob * Math.sin(a * 3 + x0) + wob * 0.6 * Math.sin(a * 5 + y0));
          if (Math.hypot(x - x0, (y - y0) * 1.35) <= rw) cells.push(idx(x, y));
        }
        const n2 = lavaBlock(cells);
        if (n2) { poured += n2; lit.push({ x: x0, y: y0, r: Math.max(3.5, rad * 1.8) }); }
        return n2;
      };
      const lx = cx + (rx() < 0.5 ? -5 : 5);
      pour(lx, cy - 3, 2 + Math.floor(rx() * 2), D.lake.wobble);
      for (let s = 0; s < D.seams.tries && (lit.length < D.seams.until.pours || poured < D.seams.until.cells); s++) {
        const sx = 2 + Math.floor(rx() * (W - 4)), sy = 2 + Math.floor(rx() * (H - 4));
        if (!free(sx, sy) || Math.hypot(sx - cx, sy - cy) < D.seams.minFromCentre) continue;
        pour(sx, sy, s < 40 ? 1 + Math.floor(rx() * 2) : 1, D.seams.wobble);
      }
      const inOld = new Set(oldPool);
      const mid = oldPool.filter(i => { const x = i % W, y = (i / W) | 0; return inOld.has(idx(x - 1, y)) && inOld.has(idx(x + 1, y)) && inOld.has(idx(x, y - 1)) && inOld.has(idx(x, y + 1)) && free(x, y); });
      if (mid.length && lavaBlock(mid)) lit.push({ x: mid[0] % W, y: (mid[0] / W) | 0, r: D.grottoPool.light.r });
      for (let i = 0; i < N; i++) if (map[i] === T.LAVA) pool[i] = 1;
      for (const l of lit) light(l.x, l.y, D.pourLight.col, l.r, D.pourLight.s, 'lava');
      for (const b of bodies.slice()) {
        if (b === player || map[idx(b.x, b.y)] !== T.LAVA) continue;
        const sp = nearFree(b.x, b.y, 4);
        if (sp) { b.x = sp.x; b.y = sp.y; } else bodies.splice(bodies.indexOf(b), 1);
      }
      if (map[idx(player.x, player.y)] === T.LAVA) { const ps = nearFree(player.x, player.y, 5); if (ps) { player.x = ps.x; player.y = ps.y; } }
    }
    if (element === 'water') {
      for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 7; x <= cx + 7; x++) {
        if (!free(x, y)) continue;
        const a = Math.atan2(y - cy, x - cx), wob = 1 + 0.18 * Math.sin(a * 3 + cx) + 0.1 * Math.sin(a * 5 + cy);
        if (Math.hypot((x - cx) / (D.lagoon.ellipse.rx * wob), (y - cy) / (D.lagoon.ellipse.ry * wob)) > 1) continue;
        map[idx(x, y)] = T.WATER; pool[idx(x, y)] = 1;
      }
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++)
        if (at(x, y) === T.WATER && at(x - 1, y) === T.WATER && at(x + 1, y) === T.WATER && at(x, y - 1) === T.WATER && at(x, y + 1) === T.WATER) deep.push(idx(x, y));
      if (deep.length) light(cx, cy, D.deepLight.col, D.deepLight.r, D.deepLight.s, 'deep');
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (map[idx(x, y)] !== T.FLOOR || ground[idx(x, y)]) continue;
        let near = 0;
        for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) if (at(x + ox, y + oy) === T.WATER) near++;
        if (near && rx() < Math.min(0.75, near * 0.09)) ground[idx(x, y)] = G.MOSS;
      }
    }
    if (element === 'air') {
      const V = D.vents;
      for (let tries = 0; vents.length < V.target && tries++ < V.tries;) {
        const vx = 2 + Math.floor(rx() * (W - 4)), vy = 2 + Math.floor(rx() * (H - 4));
        if (!free(vx, vy) || occupied(vx, vy)) continue;
        let openN = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (walkable(vx + ox, vy + oy)) openN++;
        if (openN < 8 || vents.some(v => Math.abs(v.x - vx) + Math.abs(v.y - vy) < V.minManhattanApart)) continue;
        if (addProp(vx, vy, V.prop, { flat: 1 })) { vents.push({ x: vx, y: vy }); light(vx, vy, V.light.col, V.light.r, V.light.s, 'vent'); }
      }
    }
  }
  return { deep, vents };
}
