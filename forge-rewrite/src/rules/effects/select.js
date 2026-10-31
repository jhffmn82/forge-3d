// The tiles and bodies an effect reaches (consolidation C8; engine-rules-27, engine-rules-34): cones, beams, lanes,
// shapes, the selectors, the area a spell strikes and the safe landing cells. Moved from effects.js.

import props from '../../../data/props.json' with { type: 'json' };
import { walkable, opaque, tileAt, T } from '../../data/tiles.js';
import { conditionHolds } from './conditions.js';
import { isBlocking, bodyOn, randomSafeCells } from './cells.js';
export { isBlocking, bodyOn, randomSafeCells };
import abilities from '../../../data/abilities.json' with { type: 'json' };


/** D22: tiles within n of the owner inside a cone toward the aim (half-angle 22.5 degrees + 0.12 / distance radians). */
export function coneTiles(s, o, aim, n) {
  if (!aim) return [];
  const dir = Math.atan2(aim.y - o.y, aim.x - o.x), out = [];
  for (let y = o.y - n; y <= o.y + n; y++) for (let x = o.x - n; x <= o.x + n; x++) {
    const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
    if (!d || d > n + 0.5 || !s.vis?.[y * s.floor.w + x]) continue;
    let off = Math.abs(Math.atan2(dy, dx) - dir);
    if (off > Math.PI) off = 2 * Math.PI - off;
    if (off <= Math.PI / 8 + 0.12 / d) out.push({ x, y });
  }
  return out;
}

/** D25: a beam `width` tiles wide from the owner toward the aim, `len` long, stopped by opaque tiles. */
export function beamTiles(s, o, aim, len, width) {
  if (!aim || (aim.x === o.x && aim.y === o.y)) return [];
  const d = Math.hypot(aim.x - o.x, aim.y - o.y), ux = (aim.x - o.x) / d, uy = (aim.y - o.y) / d, half = Math.floor(width / 2), out = [], key = new Set();
  for (let i = 1; i <= len; i++) {
    const cx = Math.round(o.x + ux * i), cy = Math.round(o.y + uy * i);
    if (opaque(s.floor, cx, cy)) break;
    for (let k = -half; k <= half; k++) {
      const x = Math.round(o.x + ux * i - uy * k), y = Math.round(o.y + uy * i + ux * k);
      if (opaque(s.floor, x, y) || key.has(x + ',' + y)) continue;
      key.add(x + ',' + y); out.push({ x, y });
    }
  }
  return out;
}

export const lineCells = (a, b) => {
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)), out = [];
  for (let i = 1; i <= n; i++) out.push({ x: Math.round(a.x + (b.x - a.x) * i / n), y: Math.round(a.y + (b.y - a.y) * i / n) });
  return out;
};

/** 1.7 chargeLane: the clear tiles from a toward b (b itself when `ground`), null when anything stands in the way or it is too long. */
export function lanePath(s, a, b, ground, range) {
  const path = lineCells(a, b), end = path.at(-1);
  if (!end) return null;
  if (!ground && !(end.x === b.x && end.y === b.y)) return null;
  const run = ground ? path : path.slice(0, -1);
  if (run.length > range - 1) return null;
  for (const t of run) if (!walkable(s.floor, t.x, t.y) || bodyOn(s, t.x, t.y) || s.floor.props?.some(p => p.x === t.x && p.y === t.y && isBlocking(p))) return null;
  return run;
}

/** The first live body on the line from a to b (b's own tile included); a Tiny one short of b is flown past (G43). */
export function firstBodyOnLine(s, a, b) {
  for (const { x, y } of lineCells(a, b)) {
    const end = x === b.x && y === b.y;
    const hit = s.order.map(id => s.actors[id]).find(q => q.hp > 0 && q !== a && q.x === x && q.y === y && (end || !(q.flags ?? []).includes('tiny')));
    if (hit) return hit;
  }
  return null;
}


/** The tiles a field or terrain shape names: tile, radius / square (centre self, point or target; notSelf, walkable), room. */
export function shapeTiles(sh, c) {
  const s = c.state, f = s.floor, out = [];
  const centre = sh.centre === 'self' ? c.owner : sh.centre === 'point' ? (c.tile ?? c.target ?? c.owner) : (c.target ?? c.tile ?? c.owner);
  if (!centre) return out;
  const push = (x, y) => { if (x >= 0 && y >= 0 && x < f.w && y < f.h && (!sh.walkable || walkable(f, x, y)) && !(sh.notSelf && x === centre.x && y === centre.y)) out.push({ x, y }); };
  if (sh.selector === 'tile') { push(centre.x, centre.y); return out; }
  if (sh.selector === 'room') {
    const r = (f.rooms ?? []).find(q => centre.x >= q.x && centre.x < q.x + q.w && centre.y >= q.y && centre.y < q.y + q.h);
    if (r) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (walkable(f, x, y)) push(x, y); return out; }
    return shapeTiles({ ...sh, selector: 'radius', n: sh.orRadius ?? 3 }, c);
  }
  const n = sh.selector === 'square' ? Math.floor((sh.n ?? 3) / 2) : (sh.n ?? 1);
  for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) push(centre.x + dx, centre.y + dy);
  return out;
}

/** D30: a ridge of up to `length` tiles centred on the point, across the line from the owner, on plain open floor. */
export function ridgeTiles(s, o, at, length = 7) {
  const sx = Math.sign(at.x - o.x), sy = Math.sign(at.y - o.y), px = -sy || (sx ? 0 : 1), py = sx || 0, half = Math.floor(length / 2), out = [];
  for (let k = -half; k <= half; k++) {
    const x = at.x + px * k, y = at.y + py * k;
    if (tileAt(s.floor, x, y) !== T.FLOOR || bodyOn(s, x, y) || s.floor.props?.some(p => p.x === x && p.y === y) || s.floor.items?.some(i => i.x === x && i.y === y)) continue;
    out.push({ x, y });
  }
  return out;
}

/** D30, D45: Upheaval's rocks crumble when their time is up ("Upheaval ends."). */
export function crumbleRocks(s, events) {
  const f = s.floor, gone = (f.props ?? []).filter(p => p.upheaval && p.until <= s.now);
  if (!gone.length) return;
  f.props = f.props.filter(p => !gone.includes(p));
  for (const p of gone) delete f.rocks[p.y * f.w + p.x];
  events.push({ type: 'terrain', what: 'upheaval-ends' }, { type: 'log', words: 'Upheaval ends.' });
}


/** The bodies an effect's `target` or `who` selector names (spec/effects.md selectors built so far). */
export function select(sel, c) {
  if (!sel || sel.selector === 'target' || sel.selector === 'self') return [sel?.selector === 'self' ? c.owner : c.target].filter(Boolean);
  // The body that attacked or hurt the owner (a boon's answer: Coward's Mark, Perfect Counter).
  if (sel.selector === 'source') return [c.attacker ?? c.source].filter(a => a && a.hp > 0 && a !== c.owner);
  const centre = sel.centre === 'self' ? c.owner : sel.centre === 'point' ? (c.tile ?? c.target ?? c.owner) : (c.target ?? c.owner);
  // Sides are the effect owner's (a spell's foes are the hero's foes wherever the area is centred).
  const ref = c.owner?.side ? c.owner : centre;
  const sideOk = a => sel.side === 'any' || !sel.side ? true : sel.side === 'foes' ? a.side !== ref.side && a.side !== 'neutral' && !(ref.side === 'player' && a.side === 'ally') : a.side === ref.side;
  const s = c.state, seen = a => !sel.visibleOnly || !!s.vis?.[a.y * s.floor.w + a.x];
  const bodies = s.order.map(id => s.actors[id]).filter(a => a.hp > 0 && sideOk(a) && seen(a) && !(sel.notTarget && a === c.target));
  const ch = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  if (sel.selector === 'radius' && sel.of) return bodies.filter(a => (c.shared?.raised ?? []).some(t => ch(a, t) <= sel.n));
  // E26 Permafrost: every body of the side on the floor that meets the selector's own condition (Rooted foes).
  if (sel.selector === 'floor') return bodies.filter(a => a !== c.owner && (!sel.if || conditionHolds(sel.if, { ...c, target: a })));
  if (sel.selector === 'all-visible') return bodies.filter(a => !!s.vis?.[a.y * s.floor.w + a.x] && (sel.within === undefined || ch(a, c.owner) <= sel.within));
  // nearest to the body the selector is of (an arc's struck body, Wildfire's burned victim), else to the owner
  if (sel.selector === 'nearest') { const at = (sel.of && c[sel.of]) || c.owner; return bodies.filter(a => a !== c.owner && (sel.range === undefined || ch(a, at) <= sel.range)).sort((a, b) => ch(a, at) - ch(b, at)).slice(0, sel.n ?? 1); }
  if (sel.selector === 'cone') return coneTiles(s, c.owner, c.tile ?? c.target, sel.n).flatMap(t => bodies.filter(a => a.x === t.x && a.y === t.y));
  if (sel.selector === 'beam') return beamTiles(s, c.owner, c.tile ?? c.target, c.range ?? sel.n ?? 6, sel.width ?? 3).flatMap(t => bodies.filter(a => a.x === t.x && a.y === t.y));
  if (sel.selector === 'chain') {
    // D23: the target, then each jump to the nearest seen foe not yet struck within `range` of the last.
    const out = c.target && c.target.hp > 0 && c.target !== c.owner ? [c.target] : [];
    for (let j = 0; j < (sel.jumps ?? 4) && out.length; j++) {
      const last = out.at(-1), nextOne = bodies.filter(a => !out.includes(a) && a !== c.owner && ch(a, last) <= (sel.range ?? 4) && !!s.vis?.[a.y * s.floor.w + a.x]).sort((a, b) => ch(a, last) - ch(b, last))[0];
      if (!nextOne) break;
      out.push(nextOne);
    }
    return out;
  }
  // Bone Spear's piercing line (1.7 recovery.js:61-80): from the caster toward the aim, up to n tiles, stopped by
  // walls; piercing takes every body on it, else the first.
  if (sel.selector === 'line') {
    const out = [];
    for (const { x, y } of linePath(s, c.owner, c.tile ?? c.target, sel.n ?? 6)) {
      const here = bodies.filter(a => a.x === x && a.y === y);
      out.push(...here);
      if (here.length && !sel.piercing) break;
    }
    return out;
  }
  if (sel.selector === 'square') { const h = Math.floor(sel.n / 2); return bodies.filter(a => Math.abs(a.x - centre.x) <= h && Math.abs(a.y - centre.y) <= h); }
  // Adjacent centres on the owner (Charge stuns every foe beside where the hero stopped).
  // Round the target, foes are the owner's: the hero's allies are on his side (the Living Flame's splash, E16).
  const team = a => (a?.side === 'ally' ? 'player' : a?.side);
  if (sel.selector === 'adjacent') { const o = sel.centre === 'target' ? centre : c.owner, mine = a => sel.side === 'foes' ? (sel.centre === 'target' ? team(a) !== team(ref) : a.side !== o.side) && a.side !== 'neutral' : sideOk(a); return c.state.order.map(id => c.state.actors[id]).filter(a => a.hp > 0 && a !== o && mine(a) && Math.max(Math.abs(a.x - o.x), Math.abs(a.y - o.y)) === 1); }
  if (sel.selector === 'radius') return bodies.filter(a => Math.max(Math.abs(a.x - centre.x), Math.abs(a.y - centre.y)) <= sel.n);
  c.state.unbuilt['selector:' + sel.selector] = (c.state.unbuilt['selector:' + sel.selector] ?? 0) + 1;
  return [];
}

/** Bone Spear's line (1.7 recovery.js:61-80): from o toward `to`, up to n tiles, stopped by walls. The ability event carries it. */
export function linePath(state, o, to, n) {
  const dx = to.x - o.x, dy = to.y - o.y, steps = Math.max(Math.abs(dx), Math.abs(dy)), out = [];
  for (let i = 1; steps && i <= n; i++) {
    const x = Math.round(o.x + dx * i / steps), y = Math.round(o.y + dy * i / steps);
    if (opaque(state.floor, x, y)) break;
    out.push({ x, y });
  }
  return out;
}

/**
 * C8 (engine-rules-34, render-05): the tiles one area selector covers from `owner` aimed at `at`: radius and square round
 * their centre (self or the aim), a cone (n, default 6) and a beam (len, else n, default 6; width 3) toward the aim; null
 * for a selector that names bodies, not an area. The spell's own strike, its aim preview, the struck surface and a
 * puzzle room's footprint all read this one answer. Tiles may lie off the map; callers keep the ones they need.
 */
export function selectorTiles(state, sel, { owner, at, len } = {}) {
  const aim = at ?? owner;
  if (sel.selector === 'radius' || sel.selector === 'square') {
    const centre = sel.centre === 'self' ? owner : aim, n = sel.selector === 'square' ? Math.floor((sel.n ?? 3) / 2) : (sel.n ?? 1), out = [];
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) out.push({ x: centre.x + dx, y: centre.y + dy });
    return out;
  }
  if (sel.selector === 'cone') return coneTiles(state, owner, aim, sel.n ?? 6);
  if (sel.selector === 'beam') return beamTiles(state, owner, aim, len ?? sel.n ?? 6, sel.width ?? 3);
  return null;
}

/** E13: the tiles an area spell's selector covers (1.7 markGround's tile lists); else the tiles of the bodies it took. */
export function areaTiles(sel, c, targets) {
  const s = c.state, o = c.owner, out = [];
  if (sel.selector === 'radius' && sel.of) {
    for (const t of c.shared?.raised ?? []) for (let dy = -sel.n; dy <= sel.n; dy++) for (let dx = -sel.n; dx <= sel.n; dx++) out.push({ x: t.x + dx, y: t.y + dy });
    return out;
  }
  const at = sel.centre === 'point' ? (c.tile ?? c.target ?? o) : (sel.selector === 'cone' || sel.selector === 'beam' ? c.tile ?? c.target : c.target ?? o);
  return selectorTiles(s, sel, { owner: o, at, len: c.range }) ?? targets.filter(Boolean).map(a => ({ x: a.x, y: a.y }));
}


/** beta-world.js effectFootprint: the tiles a cast covers (areas by their selector, a bolt or a single target its tile). */
export function castFootprint(state, row, at) {
  const p = state.actors[state.playerId], aim = at ?? p, out = [];
  for (const e of row.effects ?? []) {
    const sel = e.target ?? e.shape;
    if (!sel?.selector) continue;
    out.push(...(selectorTiles(state, sel, { owner: p, at: aim }) ?? []));   // C8: the spell's own tiles (a beam stops at walls)
  }
  return out.length ? out : [aim];
}

/**
 * WC5 (1.7 casting-adapter.js:293): the distinct on-map tiles an ability cast at `at` covers, for the 0.65 s struck
 * surface the map shows after a cast of two tiles or more (fx-kit.js castSurface).
 */
export function castTiles(state, id, at) {
  const row = abilities.rows[id], f = state?.floor;
  if (!row || !f) return [];
  const seen = new Set(), out = [];
  for (const t of castFootprint(state, row, at)) {
    const k = t.y * f.w + t.x;
    if (t.x < 0 || t.y < 0 || t.x >= f.w || t.y >= f.h || seen.has(k)) continue;
    seen.add(k); out.push({ x: t.x, y: t.y });
  }
  return out;
}

/**
 * C8 (render-05): what a cast struck, for the map to draw instead of working it out again: the distinct cast tiles (the
 * struck surface, a Glacial Tomb's splash), a line spell's path (Bone Spear) and an area's radius (Earthquake).
 */
export function struckShape(state, p, id, row, tile) {
  const sels = (row.effects ?? []).map(e => e.target).filter(Boolean), line = sels.find(t => t.selector === 'line'), ring = sels.find(t => t.selector === 'radius' && !t.of);
  return { struck: castTiles(state, id, tile), line: line && tile ? linePath(state, p, tile, line.n ?? 6) : null, radius: ring?.n ?? null };
}
