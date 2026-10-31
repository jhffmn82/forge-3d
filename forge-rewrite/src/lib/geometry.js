// Shared geometry (consolidation C5; engine-rules-12, engine-rules-13, ui-19, world-33). Pure: imports nothing. Every
// tile test a caller needs (walls, opacity, bodies) comes in as a predicate, so rules, world, render and UI read one copy.

/** Chebyshev distance: the number of king steps between two cells. */
export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The four steps, east, west, south, north (the order every flood and draw uses today). */
export const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** The eight steps: D4, then the diagonals. */
export const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** The eight steps clockwise from north (1.7 explore order). */
export const D8_CLOCKWISE = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

/** Whether (x, y) is inside the rectangle {x, y, w, h}. */
export const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Whether a body's square footprint (size, default 1, from its top-left) covers (x, y). */
export const covers = (body, x, y) => { const n = body.size ?? 1; return x >= body.x && y >= body.y && x < body.x + n && y < body.y + n; };

/** The Chebyshev gap from a body's footprint to a cell: 0 on it, 1 beside it. */
export function footprintGap(body, cell) {
  const n = (body.size ?? 1) - 1;
  return Math.max(Math.max(body.x - cell.x, 0, cell.x - (body.x + n)), Math.max(body.y - cell.y, 0, cell.y - (body.y + n)));
}

/**
 * The cells from a toward b, a left out, b included.
 * - 'round' (1.7 chaos-enemies boltPath, the creature clear-shot checks): each step rounds the straight line.
 * - 'bresenham' (1.7 cavernmobs boltPath, the hero's arrows): integer error steps, at most `guard` cells.
 */
export function lineCells(a, b, { algorithm = 'round', guard = 64 } = {}) {
  const out = [];
  if (algorithm === 'bresenham') {
    let x = a.x, y = a.y, err;
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
    err = dx - dy;
    for (let i = 0; i < guard && (x !== b.x || y !== b.y); i++) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
      out.push({ x, y });
    }
    return out;
  }
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 1; i <= n; i++) out.push({ x: a.x + Math.round(dx * i / n), y: a.y + Math.round(dy * i / n) });
  return out;
}

/**
 * A projectile's cells from a toward b: it stops before a cell where wall(x, y) holds and on the first cell where
 * body(x, y) holds (that cell included).
 */
export function projectilePath(a, b, { algorithm = 'round', wall = () => false, body = () => false } = {}) {
  const out = [];
  for (const c of lineCells(a, b, { algorithm })) {
    if (wall(c.x, c.y)) break;
    out.push(c);
    if (body(c.x, c.y)) break;
  }
  return out;
}

/**
 * 1.7 traceLine (js/engine/geometry.js:40-67), the sight ray (spec/sight.md V3): the integer cell-centre ray from a
 * to b, cut at the first cell where blocked(x, y) holds, or at a diagonal squeezed between two blocked cells. On an
 * exact tie it tries the ray leaning the other way too. Returns {path (a left out), clear}.
 */
export function traceRay(a, b, blocked) {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), horizontal = dx >= dy, steps = Math.max(dx, dy);
  if (!steps) return { path: [], clear: true };
  const reverse = horizontal ? a.x > b.x : a.y > b.y, p = reverse ? b : a, q = reverse ? a : b;
  const minor = horizontal ? q.y - p.y : q.x - p.x, sign = minor < 0 ? -1 : 1, span = Math.abs(minor);
  let ties = false;
  const ray = upper => {
    const cells = [];
    for (let i = 0; i <= steps; i++) {
      const twice = 2 * span * i, rem = twice % (2 * steps);
      let off = Math.floor(twice / (2 * steps));
      if (rem === steps) { ties = true; if (upper) off++; } else if (rem > steps) off++;
      cells.push(horizontal ? { x: p.x + i, y: p.y + sign * off } : { x: p.x + sign * off, y: p.y + i });
    }
    if (reverse) cells.reverse();
    const path = [];
    for (let j = 1; j < cells.length; j++) {
      const c = cells[j], prev = cells[j - 1];
      if (c.x !== prev.x && c.y !== prev.y && blocked(c.x, prev.y) && blocked(prev.x, c.y)) { path.push({ x: c.x, y: prev.y }); return { path, clear: false }; }
      path.push(c);
      if (blocked(c.x, c.y)) return { path, clear: false };
    }
    return { path, clear: true };
  };
  const first = ray(false);
  if (first.clear || !ties) return first;
  const second = ray(true);
  return second.clear || second.path.length > first.path.length ? second : first;
}

/**
 * The creature clear-shot rule (1.7 actor-ai clearShot): the sight ray from a to t is open (t itself never blocks it)
 * and no body stands on the rounded line between them.
 */
export function clearShot(a, t, { opaque, body }) {
  if (!traceRay(a, t, (x, y) => !(x === t.x && y === t.y) && opaque(x, y)).clear) return false;
  return lineCells(a, t).slice(0, -1).every(c => !body(c.x, c.y));
}
