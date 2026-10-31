// Grid searches over a w x h board indexed y * w + x (consolidation C5; engine-rules-11, world-03, world-12). Pure:
// imports nothing. Which cells are open comes in as a predicate on the index, so walls, props, regions and fire are the
// caller's rule and every search is the same loop.

import { D4 } from './geometry.js';

/**
 * Breadth-first distances from one or more start indices over open(i) (-1: unreached).
 * dirs: D4 (default) or D8, in the order neighbours are tried; corner(cx, cy, dx, dy) may refuse a diagonal step;
 * visit(n, c) hears each cell as it is reached and from where (a parent map, a region spread).
 */
export function distanceField(w, h, from, open, { dirs = D4, corner = null, visit = null } = {}) {
  const d = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (const s of Array.isArray(from) ? from : [from]) if (d[s] < 0) { d[s] = 0; q[tail++] = s; }
  while (head < tail) {
    const c = q[head++], cx = c % w, cy = (c / w) | 0, dc = d[c] + 1;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (d[n] >= 0 || !open(n)) continue;
      if (dx && dy && corner && !corner(cx, cy, dx, dy)) continue;
      d[n] = dc; q[tail++] = n;
      visit?.(n, c);
    }
  }
  return d;
}

/**
 * Labels each open cell with its connected area (0, 1, ...; -1 closed), areas numbered in scan order; returns {label,
 * count, sizes}, and with lists: true each area's cells in the order the search took them (lists). corner as in
 * distanceField; stack: true walks each area depth first, last found first (1.7's room-plan group walk).
 */
export function components(w, h, open, { dirs = D4, corner = null, lists = false, stack = false } = {}) {
  const label = new Int32Array(w * h).fill(-1), sizes = [], all = lists ? [] : null;
  const q = new Int32Array(w * h), seq = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || !open(s)) continue;
    const id = sizes.length;
    let head = 0, tail = 0, n = 0;
    label[s] = id; q[tail++] = s;
    while (stack ? tail > 0 : head < tail) {
      const c = stack ? q[--tail] : q[head++], cx = c % w, cy = (c / w) | 0;
      seq[n++] = c;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (label[k] < 0 && open(k) && !(dx && dy && corner && !corner(cx, cy, dx, dy))) { label[k] = id; q[tail++] = k; }
      }
    }
    sizes.push(n);
    all?.push(Array.from(seq.subarray(0, n)));
  }
  return { label, count: sizes.length, sizes, ...(lists && { lists: all }) };
}

/**
 * The first cell goal(i) finds, breadth first from `from` over open(i), in the order neighbours are reached (a free
 * cell near a spot). A goal cell is taken as it is reached; only cells under maxDepth steps are walked on. -1: none.
 */
export function nearest(w, h, from, open, goal, { dirs = D4, maxDepth = Infinity } = {}) {
  const d = new Int32Array(w * h).fill(-1), q = new Int32Array(w * h);
  let head = 0, tail = 0;
  d[from] = 0; q[tail++] = from;
  while (head < tail) {
    const c = q[head++], cx = c % w, cy = (c / w) | 0;
    if (d[c] >= maxDepth) break;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (d[n] >= 0 || !open(n)) continue;
      d[n] = d[c] + 1;
      if (goal(n)) return n;
      q[tail++] = n;
    }
  }
  return -1;
}

/**
 * The cheapest way from `from` (an index or a list) to `to` (an index, or a test taken as each cell comes off the
 * queue) where each step costs costAt(i): 0 or 1 (Infinity: closed), D4 steps (1.7 blockingPlants, the bypass dig).
 * Returns {cost, path (index list from..to)} or null when unreachable.
 */
export function zeroOneSearch(w, h, from, to, costAt, { dirs = D4 } = {}) {
  const cost = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1);
  const dq = Array.isArray(from) ? from.slice() : [from], done = typeof to === 'function' ? to : c => c === to;
  let head = 0, end = -1;
  for (const s of dq) cost[s] = 0;
  const front = [];
  while (head < dq.length || front.length) {
    const c = front.length ? front.pop() : dq[head++];
    if (done(c)) { end = c; break; }
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx, step = costAt(n);
      if (!Number.isFinite(step) || cost[c] + step >= cost[n]) continue;
      cost[n] = cost[c] + step; prev[n] = c;
      if (step === 0) front.push(n); else dq.push(n);
    }
  }
  if (end < 0) return null;
  const path = [];
  for (let c = end; c >= 0; c = prev[c]) path.push(c);
  return { cost: cost[end], path: path.reverse() };
}

/**
 * 1.7 blob (world.js): a random walk from (x, y) painting up to `size` distinct cells in at most 3 x size steps,
 * kept inside the w x h board. rand() is the caller's draw in [0, 1) (two per step: the cell, then the direction).
 */
export function blob(rand, w, h, x, y, size, paint) {
  const cells = [[x, y]], seen = new Set();
  for (let i = 0; i < cells.length && i < size * 3 && seen.size < size; i++) {
    const c = cells[Math.floor(rand() * cells.length)], k = c[1] * w + c[0];
    if (!seen.has(k)) { seen.add(k); paint(c[0], c[1]); }
    const d = D4[Math.floor(rand() * 4)], nx = c[0] + d[0], ny = c[1] + d[1];
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) cells.push([nx, ny]);
  }
}
