// Ground and air fields on the world clock (spec/effects.md `field`, spec/world.md 108, A15-A27 hazards, magic.md D44):
// burning ground with 1.7's ignite and spread, and every other field (gas, spores, static, ice, roots, holy, web, smoke,
// chaos poison patches, the slime and plague trails, darkness) as tiles that run their row's effects on whoever stands
// inside. One damage path for all hazards (world.md answer 2): their effects go through runEffect like any other.

import props from '../../data/props.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import statuses from '../../data/statuses.json' with { type: 'json' };
import { applyStatus, removeStatus } from './statuses.js';
import { next } from '../lib/rng.js';
import { T, tileAt, walkable, G } from '../data/tiles.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { chaosRegionAt } from './chaos-map.js';
const breakProp = (...a) => UP.breakProp(...a); const blowLitBarrels = (...a) => UP.blowLitBarrels(...a);   // C17: fire breaks and blows props (set-pieces.js UP, from props.js)
import { alive, fieldLimits, reaches, strongestPulse, airborne } from './field-options.js';
export { airborne };
import { hook, UP } from './set-pieces.js';
const holyPulse = (...a) => UP.holyPulse(...a);   // C17: holy ground's pulse (set-pieces.js UP, from spell-ground.js)




const P = props.rows, TURN = tuning.rows.clock.unitsPerGameTurn;

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const burnable = p => !!(p?.burnable ?? P[p?.id]?.burnable);   // a prop's own flag wins (a pot stack does not burn)


const statusRows = statuses.rows ?? statuses;

/** EP35 (1.7 sporecaller.js:89, enemy-fields.js:17): ground fields a flying or levitating body passes over untouched. */
const GROUND_KINDS = new Set(['spores', 'web', 'chaos-hazard', 'slime-trail', 'plague-trail']);


/**
 * E13 (1.7 elements.js:50-54, :65-76, :135-143; actor-ai.js:218): what a kind of field does when its row names nothing
 * else. Icy ground gives a grounded foe standing on it a Chill stack each game turn; grasping roots Root a grounded foe
 * that steps onto them for 1. One tick a kind a body, however many fields of it overlap (1.7 kept one count a tile).
 */
const KIND_RULES = {
  ice: { side: 'foes', grounded: true, each: [{ verb: 'add-stack', status: 'chill', n: 1 }] },
  roots: { side: 'foes', grounded: true, enter: [{ verb: 'apply-status', status: 'root', turns: 1 }] },
};

export const HOLY = /holy/;

/**
 * E13 (1.7 actor-ai.js:218 actorFinish): a foe that steps onto grasping roots, and is not airborne, is Rooted 1.
 * EP27 (1.7 enemy-fields.js:16-26 enter, called on every step and the hero's stepOn): web ground webs any grounded body
 * each time it walks in, unless it is already held or slowed (a Root or Slow by tag), so silk never pins for good.
 */
export function fieldEntered(state, a, events) {
  const f = state.floor;
  if (!f?.fields?.length || a.hp <= 0) return;
  const k = a.y * f.w + a.x, done = new Set();
  for (const r of f.fields) {
    if (done.has(r.kind) || !r.cells.includes(k) || !alive(r, state.now)) continue;
    if (r.kind === 'web') { done.add('web'); webEntered(state, a, r, events); continue; }
    if (!r.enter?.length || a.side !== 'foe' || (r.grounded && airborne(a))) continue;
    done.add(r.kind);
    for (const e of r.enter) runEffect(e, { state, owner: state.actors[r.owner] ?? a, target: a, source: state.actors[r.owner] ?? null, events, field: r });
  }
}

// E13: a field takes a body that walks onto it (moves.js moveBody, after the trap).
hook('stepped', (state, a, events) => fieldEntered(state, a, events), 20);

/** EP27: "webbed" over the body; the status says it to the hero, a seen foe gets "The webbing catches the X." */
function webEntered(state, a, r, events) {
  if (airborne(a) || a.flags?.includes('spider')) return;
  if (Object.keys(a.statuses ?? {}).some(id => { const t = statusRows[id]?.tags ?? []; return t.includes('root') || t.includes('slow'); })) return;
  if (!applyStatus(state, a, 'web', { turns: 1, source: r.owner ?? null }, events)) return;
  events.push({ type: 'float', id: a.id, words: 'webbed', tone: 'phys' });
  const f = state.floor;
  if (a.side !== 'player' && state.vis?.[a.y * f.w + a.x]) events.push({ type: 'log', words: `The webbing catches the <b>${a.name}</b>.`, cls: 'c-info' });
}

/**
 * World 108: a tile catches only with tall grass (5 turns), short grass, web ground or a burnable prop (3), never water.
 * CF16, F19 (1.7 sylla.js:176-183, ruled a refusal 2026-10-15): with `events` (the hero's own action lighting it), a god
 * whose conduct refuses igniting (Sylla) keeps grass, web and burnable props from catching and says so once an action.
 */
export function ignite(state, x, y, byPlayer, force = 0, events = null) {
  const f = state.floor;
  if (x < 0 || y < 0 || x >= f.w || y >= f.h || tileAt(f, x, y) === T.WATER) return false;
  const k = y * f.w + x, g = f.ground?.[k], prop = f.props?.find(p => p.x === x && p.y === y);
  if (events && byPlayer && (g === G.GRASS || g === G.SHORT || g === G.WEB || burnable(prop) || P[prop?.id]?.web || /web/.test(prop?.id ?? '')) && ignitionRefused(state, events)) return false;
  clearWeb(f, k);   // 1.7 burnWorld -> FoteEnemyFields.burn: fire reaching a tile takes the creatures' web off it
  const n = force || (g === G.GRASS ? 5 : g === G.SHORT || g === G.WEB || burnable(prop) ? 3 : 0);
  if (!n) return false;
  f.burning ??= {};
  const was = f.burning[k];
  f.burning[k] = { n: Math.max(was?.n ?? 0, n), player: !!byPlayer || !!was?.player };
  // CB46 (1.7 burnWorld p.ex): fire reaching a powder barrel blows it; blowLitBarrels sets it off with the events.
  if (prop && P[prop.id]?.explodes && !(f.lit ??= []).some(l => l.x === x && l.y === y)) f.lit.push({ x, y });
  // Webs burn away; ice doors and thorns melt or burn open (world 107; magic.md D38).
  if (prop && (P[prop.id]?.web || /web/.test(prop.id))) f.props = f.props.filter(p => p !== prop);
  if (tileAt(f, x, y) === T.ICE_DOOR || tileAt(f, x, y) === T.THORNS) f.tiles[k] = T.OPEN_DOOR;
  return !was;
}

/** CF16: the sworn god refuses the hero setting the world alight; "<God> will not allow that." once an action. */
export function ignitionRefused(state, events) {
  const h = state.hero, god = h?.faith?.god && gods.rows[h.faith.god];
  if (!god?.conduct?.refuseIgniting) return false;
  if (events && h.igniteRefusedAt !== state.actions) {
    h.igniteRefusedAt = state.actions;
    events.push({ type: 'log', words: `${god.name} will not allow that.`, sfx: 'ui-error' });
  }
  return true;
}

/** Takes cell k out of every web field (1.7 FoteEnemyFields.burn / wash); a web left with no cells ends. */
function clearWeb(f, k) {
  if (!f.fields?.length) return;
  for (const r of f.fields) if (r.kind === 'web' && r.cells.includes(k)) r.cells = r.cells.filter(c => c !== k);
  f.fields = f.fields.filter(r => r.kind !== 'web' || r.cells.length);
}

/**
 * Puts out fires within the tiles (Knowledge sigils' extinguish, water); water washes web ground off too (1.7 washGround),
 * and, chaos 64 (C10b), takes the tiles out of every field that water clears (the chaos poison patches).
 */
export function extinguish(state, tiles) {
  const f = state.floor;
  for (const t of tiles) {
    const k = t.y * f.w + t.x;
    if (f.burning?.[k]) delete f.burning[k];
    clearWeb(f, k);
    for (const r of f.fields ?? []) if (r.clearedBy?.includes('water')) r.cells = r.cells.filter(c => c !== k);
  }
  if (f.fields?.length) f.fields = f.fields.filter(r => !r.clearedBy?.includes('water') || r.cells.length);
}

/** Lays a field row on tiles: fire ignites (or burns outright without `only`), others become a live field. */
export function layField(state, e, tiles, owner, events) {
  const f = state.floor, byPlayer = owner?.side === 'player';
  if (e.field === 'fire') {
    let lit = 0;
    // CF16: the hero's own fire (not a status he burns with) is what his god may refuse.
    for (const t of tiles) lit += ignite(state, t.x, t.y, byPlayer, e.only === 'flammable' ? 0 : Math.max(1, e.turns ?? 3), e.fromStatus ? null : events) ? 1 : 0;
    if (lit) events.push({ type: 'field', kind: 'fire', tiles: tiles.length, sfx: 'fire-ignite' });
    blowLitBarrels(state, events);
    return;
  }
  f.fields ??= [];
  let cells = tiles.map(t => t.y * f.w + t.x);
  // C10b (effects.json shapeLimit): only the source's island ground, chasm and void out; nothing left lays nothing.
  if (e.shapeLimit === 'same-region') {
    const region = owner?.region ?? chaosRegionAt(f, owner?.x, owner?.y);
    cells = cells.filter(k => chaosRegionAt(f, k % f.w, (k / f.w) | 0) === region && walkable(f, k % f.w, (k / f.w) | 0));
    if (!cells.length) return;
  }
  const row = {
    id: `field-${(f.fieldSerial = (f.fieldSerial ?? 0) + 1)}`, kind: e.field, cells,
    until: e.permanent ? null : state.now + (e.turns ?? 3) * TURN, side: e.side ?? 'all', each: e.each ?? [], eachOnce: e.eachOnce ?? [],
    owner: owner?.id ?? null, byPlayer, seen: [],
  };
  // E13: a kind's own rule fills in what the row leaves out (icy ground's Chill, the roots' grip); holy ground's power.
  const rule = KIND_RULES[e.field];
  if (rule) {
    if (!e.each?.length && rule.each) row.each = rule.each;
    if (e.side === undefined) row.side = rule.side;
    if (rule.grounded) row.grounded = true;
    if (rule.enter) row.enter = rule.enter;
  }
  if (GROUND_KINDS.has(e.field)) row.grounded = true;
  if (e.power !== undefined) row.power = e.power;
  else if (HOLY.test(e.field)) row.power = owner?.divine ?? 1;   // RB50 (1.7 floorMeta.sanctuary.power): the prayer's power is fixed when it is cast
  fieldLimits(state, e, row, owner);
  if (e.cap) { const same = f.fields.filter(x => x.kind === e.field); while (same.length >= e.cap) f.fields.splice(f.fields.indexOf(same.shift()), 1); }
  if (e.field === 'smoke') f.fields = f.fields.filter(x => x.kind !== 'smoke');   // one smoke per floor (magic.md answer 21)
  f.fields.push(row);
  if (!e.quiet) events.push({ type: 'field', kind: e.field, id: row.id, tiles: tiles.length });
}

/** Is a body inside a live field of this kind (sight reads smoke and darkness)? */
export function fieldAt(state, x, y, kind) {
  const f = state.floor, k = y * f.w + x;
  return (f.fields ?? []).some(r => r.kind === kind && r.cells.includes(k));
}

/** C10b: lays a data row's field (floors.json hazards: the chaos poison patches) on cells, with the row's own options. */
export function makeField(state, e, tiles, owner, events, o = {}) { layField(state, { ...e, ...o, quiet: true }, tiles, owner, events); }

/** One world pulse: fires burn down and spread, burning ground sets bodies Burning, water douses, fields tick and expire. */
export function fieldPulse(state, events) {
  const f = state.floor;
  if (!f) return;
  blowLitBarrels(state, events);   // barrels lit by a rule with no events of its own (a bolt, a plane's fire)
  const bodies = state.order.map(id => state.actors[id]).filter(a => a.hp > 0);
  // Water: Burn ends and the body is Wet (1.7 onBeforePulse).
  for (const a of bodies) if (!airborne(a) && tileAt(f, a.x, a.y) === T.WATER) {
    if (a.statuses.burn) { removeStatus(state, a, 'burn', events); events.push({ type: 'float', id: a.id, words: 'hiss', tone: 'ice' }); }   // E45 (1.7 effect-adapter.js:114)
    applyStatus(state, a, 'wet', { turns: 3, replace: true }, events);
  }
  // Burning ground: whoever stands in it Burns 3 (fire creatures and the hero at Fire 6 are spared).
  if (f.burning) {
    for (const a of bodies) {
      const b = f.burning[a.y * f.w + a.x];
      if (!b || airborne(a) || a.element === 'fire' || (a.side === 'player' && (state.hero?.affinity?.fire ?? 0) >= 6)) continue;
      applyStatus(state, a, 'burn', { turns: 3, source: b.player ? state.playerId : null }, events);
    }
    fireTick(state, events);
  }
  if (!f.fields?.length) return;
  f.fieldNow = state.now;   // a trail's drawing fades by the time left at the last pulse (realm-view.js)
  holyPulse(state, bodies, events);
  const live = [], ticked = new Set();
  for (const r of f.fields) {
    if (!alive(r, state.now)) {
      events.push({ type: 'field-ended', id: r.id, kind: r.kind });
      if (r.kind === 'smoke') events.push({ type: 'log', words: 'Smoke ends.', cls: 'c-info' });   // E42 (1.7 sigils.js:285)
      continue;
    }
    live.push(r);
    if (r.known === false && r.cells.some(k => state.vis?.[k])) r.known = true;
    if (r.overlap === 'strongest') continue;
    const owner = state.actors[r.owner] ?? null;
    for (const a of bodies) {
      if (a.hp <= 0 || !r.cells.includes(a.y * f.w + a.x) || !reaches(state, r, a)) continue;
      if (KIND_RULES[r.kind]) { if (ticked.has(r.kind + ':' + a.id)) continue; ticked.add(r.kind + ':' + a.id); }
      const c = { state, owner: owner ?? a, target: a, source: owner, events, field: r };
      if (r.eachOnce.length && !r.seen.includes(a.id)) { r.seen.push(a.id); for (const e of r.eachOnce) runEffect(e, c); }
      for (const e of r.each) { if (a.hp <= 0) break; runEffect(e, c); }
    }
  }
  f.fields = live;
  strongestPulse(state, live.filter(r => r.overlap === 'strongest'), bodies, events);
}

/** World 108: burning tiles count down, burn out to ash or scorch, and spread to grass and burnable props. */
function fireTick(state, events) {
  const f = state.floor, spread = [];
  for (const key of Object.keys(f.burning)) {
    const k = +key, b = f.burning[k], x = k % f.w, y = (k / f.w) | 0;
    b.n -= 1;
    if (b.n <= 0) {
      delete f.burning[k];
      const prop = f.props?.find(p => p.x === x && p.y === y);
      // 1.7 fireTick: a burnable prop burns away; a fluid barrel spills instead (an explosive one went up when lit).
      if (prop && burnable(prop) && !P[prop.id]?.explodes) { if (P[prop.id]?.fluid) breakProp(state, x, y, events, { byFire: true }); else f.props = f.props.filter(p => p !== prop); }
      const g = f.ground?.[k];
      if (f.ground && (g === G.GRASS || g === G.SHORT || g === G.WEB || !g)) f.ground[k] = g ? G.ASH : G.SCORCH;
      events.push({ type: 'ground', at: { x, y } });
      continue;
    }
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h || f.burning[ny * f.w + nx]) continue;
      const ng = f.ground?.[ny * f.w + nx], np = f.props?.find(p => p.x === nx && p.y === ny);
      const ch = ng === G.GRASS ? 0.45 : ng === G.SHORT ? 0.18 : burnable(np) ? 0.25 : 0;
      if (ch && next(state.rng) < ch) spread.push([nx, ny, b.player]);
    }
  }
  // CB47 (1.7 systems.js:529): each tile the fire newly catches crackles where it is.
  for (const [x, y, pl] of spread) if (ignite(state, x, y, pl)) events.push({ type: 'ignited', at: { x, y }, sfx: 'fire-ignite' });
  blowLitBarrels(state, events);
}
