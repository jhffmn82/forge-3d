// Rules 35 and 101-105 of the plane (spec/planes.md; consolidation W7): the arrival, the creatures, the elite at the
// chamber, the Heart's limbs and nodes.

import { T } from '../../data/tiles.js';
import { pick } from '../../lib/rng.js';
import { R } from './kit.js';

const PLACE = R['plane-creature-placement'];

/** The arrival one cell in from the portal, then the creatures. Returns {player, start, elite, heartNodes}. */
export function planeCreatures(k) {
  const { hostFloorNo, row, m, W, N, cx, cy, rr, rb, ri, map, bodies, idx, inb, at, propAt, removeProp, walkable, occupied, bfs, nearFree, spawn } = k;
  const e = m.entry;
  let start = { x: e.x + e.dx, y: e.y + e.dy };
  if (!walkable(start.x, start.y)) start = { x: e.x, y: e.y };
  const player = { x: start.x, y: start.y };
  bodies.push(player);

  // Rules 101-105: the creatures, the elite at the chamber, the Heart's limbs and nodes.
  const roster = row.roster, bf = ((hostFloorNo - 1) % 5) + 1;
  let open = [];
  for (let j = 0; j < N; j++) { const x = j % W, y = (j / W) | 0; if (walkable(x, y) && !propAt(x, y) && map[j] !== T.PORTAL && Math.abs(x - start.x) + Math.abs(y - start.y) > 9) open.push({ x, y }); }
  const n = 12 + bf * 2;
  for (let k = 0; k < n && open.length; k++) {
    open = open.filter(c => !occupied(c.x, c.y)); if (!open.length) break;
    const c = open.splice(Math.floor(rb() * open.length), 1)[0];
    const kind = pick(rr, roster.regulars), b = spawn(kind, c.x, c.y);
    b.asleep = rb() < PLACE.asleepPct / 100;
    if (kind === 'umbralhound') { const c2 = nearFree(c.x, c.y, PLACE.umbralHoundCompanion.radius); if (c2) { const b2 = spawn(kind, c2.x, c2.y); b2.asleep = b.asleep; b2.companion = true; } }
  }
  let cc = nearFree(cx, cy + 2, 3) ?? { x: cx, y: cy };
  // The Heart of the Mountain is 2x2 and never moves: a spot where that body cuts the cave in two (a 2-wide neck, the
  // only way to its crystal nodes) would lock the run, so the nearest spot that seals nothing off is taken instead.
  const heartWall = roster.elite === 'mountainheart' && ((x, y) => [[0, 0], [1, 0], [0, 1], [1, 1]].map(([ox, oy]) => idx(x + ox, y + oy)));
  if (heartWall && seals(heartWall(cc.x, cc.y))) {
    const tx = cx, ty = cy + 2, spots = [];
    for (let y = ty - 6; y <= ty + 6; y++) for (let x = tx - 6; x <= tx + 6; x++) {
      if (!inb(x + 1, y + 1) || !inb(x, y)) continue;
      if (![[0, 0], [1, 0], [0, 1], [1, 1]].every(([ox, oy]) => walkable(x + ox, y + oy) && !occupied(x + ox, y + oy) && !propAt(x + ox, y + oy))) continue;
      spots.push({ x, y, d: Math.abs(x - tx) + Math.abs(y - ty) });
    }
    spots.sort((p1, p2) => p1.d - p2.d || p1.y - p2.y || p1.x - p2.x);
    cc = spots.find(c => !seals(heartWall(c.x, c.y))) ?? cc;
  }
  const elite = spawn(roster.elite, cc.x, cc.y);
  elite.asleep = true; elite.elite = true;
  const heartNodes = [];
  if (roster.elite === 'mountainheart') {
    elite.size = 2;
    for (const [ox, oy] of PLACE.mountainHeart.limbs.offsets) {
      const x = elite.x + ox, y = elite.y + oy;
      if (!inb(x, y)) continue;
      if (!walkable(x, y)) map[idx(x, y)] = T.FLOOR;
      const p = propAt(x, y); if (p) removeProp(p);
      const limb = spawn('heartlimb', x, y);
      limb.limbOf = elite.id; limb.noXp = true; limb.asleep = false; limb.hunting = true;
    }
    const reach = reachFrom(start, new Set(heartWall(elite.x, elite.y))), NODES = PLACE.mountainHeart.nodes;   // round the Heart, never through it
    const nodeSpot = () => {
      for (let t = 0; t < NODES.tries; t++) {
        const rad = 3 + Math.floor(t / 50), hx = elite.x + ri(-rad, rad), hy = elite.y + ri(-rad, rad), c = nearFree(hx, hy, NODES.spotRadius);
        if (!c || (Math.abs(c.x - elite.x) <= 1 && Math.abs(c.y - elite.y) <= 1) || !(reach[idx(c.x, c.y)] >= 0) || occupied(c.x, c.y)) continue;
        return c;
      }
      return null;
    };
    for (let i = 0; i < NODES.count; i++) {
      const c = nodeSpot(); if (!c) break;
      const node = spawn('crystalnode', c.x, c.y); node.asleep = false; node.hunting = true; heartNodes.push(node.id);
    }
    elite.nodes = heartNodes;
  }
  return { player, start, elite, heartNodes };

  /** Distances from a cell over walkable ground, never through the cells in `shut`. */
  function reachFrom(from, shut) {
    const d = new Int32Array(N).fill(-1), q = [idx(from.x, from.y)];
    d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = idx(nx, ny);
        if (!inb(nx, ny) || d[nk] >= 0 || shut.has(nk) || !walkable(nx, ny)) continue;
        d[nk] = d[c] + 1; q.push(nk);
      }
    }
    return d;
  }
  /** True when walling these cells leaves open ground the arrival could reach before cut off from it. */
  function seals(cells) {
    const shut = new Set(cells), before = reachFrom(start, new Set()), after = reachFrom(start, shut);
    for (let j = 0; j < N; j++) if (before[j] >= 0 && after[j] < 0 && !shut.has(j)) return true;
    return false;
  }
}
