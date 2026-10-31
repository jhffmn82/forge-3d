// Room templates on Dungeon floors 1-5 (item 233, Justin 2026-10-19: "given the amount of props, I think it is
// increasingly important to limit certain props to themed rooms. I a desk shouldn't be surrounded by grass. And generate
// several templates of rooms in biome 1 and limit what can occur in them"; "otherwise the rooms read as just random
// nonsense"). Each template is a rooms.json row of kind 'template': what stands in its room and where (pieces), what may
// grow or lie there (ground), and what its floor (wear), walls and light are, read by those passes. Every room takes
// exactly one (room.template): a room its own builder dressed is a set piece; the rest draw one by the floor's weights
// and their size, leaning with the floor's mood. The pieces are laid by role, not scattered: a run along a wall, against
// the north wall's middle, heaped in corners, through the middle, beside or just north of the step before, well inside.
// Draws only from the stream given.

import rooms from '../../data/rooms.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next, roll, shuffled, weighted } from '../lib/rng.js';
import { T } from '../data/tiles.js';
import { D4 } from '../lib/geometry.js';
import { nearDoor, roomJoined, facesWall } from './dress.js';
import { placePiece, footprint } from './pieces.js';

const P = props.rows;
export const TEMPLATES = Object.fromEntries(Object.entries(rooms.rows).filter(([, r]) => r.kind === 'template' && r.biome === 'dungeon'));
export const SET_PIECE = 'template-set-piece', PLAIN = 'template-plain';

/** A room's template row (null for a room without one: the other biomes and 1.7's classic floors). */
export const templateOf = r => (r?.template ? TEMPLATES[r.template] : null);

/** A room that dressed itself: a role's room past the start and the stairs, a special (not a pocket's host), a rare event,
 *  a sigil room or a puzzle. Its builder's pieces stand; no template adds to them. */
const setPiece = r => (r.role && r.role !== 'start' && r.role !== 'goal') || (r.special && !/-host$/.test(r.special) && !['vault', 'toll', 'hidden'].includes(r.special)) || r.rareEvent || r.hiddenSigil || r.puzzle;

/** Every room's template: a set piece, else the start, the stairs' room and a pocket plain, else one drawn by the
 *  floor's weights (floors 1-5, deeper as 5) among the templates whose area holds the room, leaning with the mood. */
export function assignTemplates(rng, floorRooms, floorNo, mood = null) {
  const f = Math.min(Math.max(floorNo, 1), 5) - 1;
  for (const r of floorRooms) {
    if (r.template) continue;
    if (setPiece(r)) { r.template = SET_PIECE; continue; }
    if (r.role || r.pocket) { r.template = PLAIN; continue; }   // the start, the stairs' room, a vault, toll or hidden pocket: plain, as 1.7 dressed them
    const area = r.w * r.h;
    const fits = Object.entries(TEMPLATES).filter(([, t]) => t.weight[f] > 0 && area >= t.area[0] && area <= t.area[1]);
    r.template = fits.length ? weighted(rng, fits, ([, t]) => t.weight[f] * (t.moods?.[mood] ?? 1))[0] : PLAIN;
  }
}

/** Lays a room's template pieces. Blocking pieces never cut the room off from itself (W73); nothing by a door. */
export function dressTemplate(rng, floor, grid, r) {
  const t = templateOf(r);
  if (!t) return;
  const W = floor.w, inRoom = (x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  const taken = new Set(floor.props.map(p => p.y * W + p.x));
  const free = (x, y) => inRoom(x, y) && floor.tiles[y * W + x] === T.FLOOR && !taken.has(y * W + x) && !nearDoor(floor, grid, x, y);
  const fits = (id, c) => { const fp = footprint(id); for (let y = c.y; y < c.y + fp.h; y++) for (let x = c.x; x < c.x + fp.w; x++) if (!free(x, y)) return false; return true; };
  const put = (id, c) => {
    if (!fits(id, c) || facesWall(floor, id, c.x, c.y)) return false;
    const before = floor.props.length;
    placePiece(floor, id, c.x, c.y);
    if (P[id]?.blocks && !roomJoined(floor, r)) { floor.props.length = before; return false; }
    for (const p of floor.props.slice(before)) taken.add(p.y * W + p.x);
    return true;
  };
  const cells = (x0, y0, x1, y1) => { const o = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.push({ x, y }); return o; };
  const near = (list, to) => (to.length ? list.slice().sort((a, b) => Math.min(...to.map(p => Math.abs(a.x - p.x) + Math.abs(a.y - p.y))) - Math.min(...to.map(p => Math.abs(b.x - p.x) + Math.abs(b.y - p.y)))) : list);
  // The pool of a damp room: a blob of water well inside (ground.pool cells), before its pieces.
  if (t.ground?.pool) {
    const inner = shuffled(rng, cells(r.x + 1, r.y + 1, r.x + r.w - 2, r.y + r.h - 2).filter(c => free(c.x, c.y)));
    const want = roll(rng, t.ground.pool[0], t.ground.pool[1]), pool = inner.length ? [inner[0]] : [];
    for (let k = 0; k < 40 && pool.length && pool.length < want; k++) {
      const from = pool[Math.floor(next(rng) * pool.length)], d = D4[Math.floor(next(rng) * 4)], c = { x: from.x + d[0], y: from.y + d[1] };
      if (free(c.x, c.y) && c.x > r.x && c.y > r.y && c.x < r.x + r.w - 1 && c.y < r.y + r.h - 1 && !pool.some(q => q.x === c.x && q.y === c.y)) pool.push(c);
    }
    for (const c of pool) { floor.tiles[c.y * W + c.x] = T.WATER; floor.ground[c.y * W + c.x] = 0; }
  }
  let last = [], wall = [];
  for (const step of t.pieces ?? []) {
    const n = roll(rng, step.count[0], step.count[1]);
    if (!n) continue;
    let list;
    if (step.where === 'wall') {   // a run along the north wall (the wall the camera faces), then the side walls
      const north = shuffled(rng, cells(r.x, r.y, r.x + r.w - 1, r.y)), sides = cells(r.x, r.y + 1, r.x, r.y + r.h - 1).concat(cells(r.x + r.w - 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1));
      list = near(north, wall.length ? wall : north.slice(0, 1)).concat(shuffled(rng, sides));
    } else if (step.where === 'north') {   // against the north wall, nearest its middle: a wall fixture or a centrepiece
      list = cells(r.x, r.y, r.x + r.w - 1, r.y).sort((a, b) => Math.abs(a.x - r.cx) - Math.abs(b.x - r.cx));
    } else if (step.where === 'corner') {   // heaped in corners: a corner cell and the cells along its two walls
      list = [];
      for (const [cx, cy, dx, dy] of shuffled(rng, [[r.x, r.y, 1, 1], [r.x + r.w - 1, r.y, -1, 1], [r.x, r.y + r.h - 1, 1, -1], [r.x + r.w - 1, r.y + r.h - 1, -1, -1]]))
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [2, 0], [0, 2], [1, 1]]) list.push({ x: cx + ox * dx, y: cy + oy * dy });
    } else if (step.where === 'centre') {   // through the middle, along the room's longer side, nearest the centre first
      const wide = r.w >= r.h;
      list = cells(r.x + 1, r.y + 1, r.x + r.w - 2, r.y + r.h - 2).filter(c => (wide ? c.y === r.cy : c.x === r.cx))
        .sort((a, b) => Math.abs(a.x - r.cx) + Math.abs(a.y - r.cy) - Math.abs(b.x - r.cx) - Math.abs(b.y - r.cy));
    } else if (step.where === 'beside') {   // next to what the step before laid
      list = shuffled(rng, last.flatMap(p => D4.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))));
    } else if (step.where === 'above') {   // just north of the step before: a chair faces south, so it faces what it is at
      list = shuffled(rng, last.map(p => ({ x: p.x, y: p.y - 1 })));
    } else if (step.where === 'near-water') {
      list = shuffled(rng, cells(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1).filter(c => D4.some(([dx, dy]) => floor.tiles[(c.y + dy) * W + c.x + dx] === T.WATER)));
    } else if (step.where === 'edge') {
      list = shuffled(rng, cells(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1).filter(c => c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1));
    } else {   // inner: well inside, a cell off every wall
      list = shuffled(rng, cells(r.x + 1, r.y + 1, r.x + r.w - 2, r.y + r.h - 2));
    }
    const got = [];
    for (let i = 0, k = 0; i < n && k < list.length; k++) {
      const id = step.ids[i % step.ids.length];
      if (put(id, list[k])) { const fp = footprint(id); for (let y = 0; y < fp.h; y++) for (let x = 0; x < fp.w; x++) got.push({ x: list[k].x + x, y: list[k].y + y }); i++; }
    }
    // beside and above go by the last step that laid a piece by its own place (a table's chair, a desk's candelabrum),
    // not by each other.
    if (got.length && step.where !== 'beside' && step.where !== 'above') { last = got; if (step.where === 'wall') wall = wall.concat(got); }
  }
}

/** Whether a room's template lets this grow or lie in it: 'grass', 'bushes', 'water', or a ground mark ('puddle', 'moss',
 *  'bones', 'blood'). A room without a template allows all (the other biomes, the classic floors). */
export function allows(r, what) {
  const t = templateOf(r);
  if (!t) return true;
  const g = t.ground ?? {};
  if (what === 'grass') return g.greenery !== 'none';
  if (what === 'bushes') return !!g.bushes;
  if (what === 'water') return !!g.water;
  return (g.marks ?? []).includes(what);
}

/** The props a template's room may hold: its pieces (a crate, barrel or pot stack as its family). */
export function allowedProps(r) {
  const t = templateOf(r);
  return t ? new Set((t.pieces ?? []).flatMap(s => s.ids)) : null;
}
