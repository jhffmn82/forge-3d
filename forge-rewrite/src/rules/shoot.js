// Shooting the bow at a foe across the room (spec/combat.md C70-C71; 1.7 js/combat/systems.js:765-785 shootAt,
// js/world/travel.js clickIntent 'shoot'). A click or tap on a foe further than a tile away, in sight and within
// the bow's range, looses an arrow; the first body on the line takes it: a foe in the way is hit instead ("The X is
// in the way and takes the arrow."), an ally or anything else in the way stops the shot with no time spent.
// The bow answers for the shot (its damage and accuracy, derive.js rangedOf); the main hand never changes.
// Item 287 (Justin 2026-10-20: "how about bows cant be used up close"): a foe beside the hero is never shot.

import { weaponAttack } from './attack.js';
import { blocks } from './statuses.js';
import { bodyAt, shotBodyAt } from './moves.js';
import { opaque } from '../data/tiles.js';
import { projectilePath } from '../lib/geometry.js';
import props from '../../data/props.json' with { type: 'json' };
import { breakProp } from './props.js';

/**
 * 1.7 boltPath (cavernmobs): the Bresenham line from a to b (lib/geometry), stopped before an opaque or off-floor
 * tile and on the first body that is not a Tiny one (G43). The hero's arrows and the cavern creatures' lanes (C10e).
 */
export const boltPath = (state, a, b) => projectilePath(a, b, {
  algorithm: 'bresenham',
  wall: (x, y) => x < 0 || y < 0 || x >= state.floor.w || y >= state.floor.h || opaque(state.floor, x, y),
  body: (x, y) => (x !== b.x || y !== b.y) && !!shotBodyAt(state, x, y),
});

const propOn = (s, x, y) => s.floor.props.find(q => q.x === x && q.y === y);
const shootable = q => !!q && !!props.rows[q.id]?.breakable && !q.hoard;
const blocksShot = q => { const r = props.rows[q.id] ?? {}; return !!(q.blocks || r.blocks || r.breakable); };

/** CB02 (1.7 travel.js:87 clickIntent): a click on a breakable prop (not a hoard's ice) 2+ away with a bow shoots it. */
export function canShootProp(state, x, y) {
  const p = state?.actors?.[state.playerId], q = p?.bow && state.floor ? propOn(state, x, y) : null;
  return shootable(q) && cheb(p, q) > 1;
}

/**
 * CB02 (1.7 systems.js:746-763 shootProp, propProjectilePath): the bow looses an arrow at a breakable prop in sight
 * and range; the flight stops at the first blocking prop, so another crate in the way refuses the shot. It breaks it.
 */
function shootProp(state, at, events) {
  const p = state.actors[state.playerId], q = propOn(state, at.x, at.y);
  const refuse = (why, words) => { events.push({ type: 'refused', id: p.id, why, command: 'shoot' }); if (words) events.push({ type: 'log', words, cls: 'c-info' }); return 'refused'; };
  if (!p.bow) return refuse('no-bow', 'No bow equipped.');
  if (!shootable(q)) return refuse('no-target');
  if (!seen(state, q.x, q.y)) return refuse('unseen', 'You cannot see that tile.');
  if (cheb(p, q) > p.bow.range) return refuse('out-of-range', 'Out of range.');
  if (blocks(p, 'melee') || blocks(p, 'ranged')) return refuse('cannot-attack');
  const path = boltPath(state, p, q), cut = path.findIndex(c => { const o = propOn(state, c.x, c.y); return o && blocksShot(o); });
  const end = cut < 0 ? path.at(-1) : path[cut];
  if (!end || end.x !== q.x || end.y !== q.y) return refuse('blocked', 'Something is in the way.');
  events.push({ type: 'bolt', from: { x: p.x, y: p.y }, to: { x: q.x, y: q.y }, kind: 'phys', arrow: true, by: p.id, sfx: 'bow-shot' });
  breakProp(state, q.x, q.y, events);
  return 'act';
}

const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const seen = (s, x, y) => !!s.vis?.[y * s.floor.w + x];
/** Every tile a body covers (a big body's whole footprint). */
const covers = (a, x, y) => { const n = a.size ?? 1; return x >= a.x && y >= a.y && x < a.x + n && y < a.y + n; };
const nameAlone = n => /^The | the /.test(n ?? '');   // 1.7 data.js nameAlone: a name that carries its own 'the'

/** True when a click on this foe shoots it (1.7 clickIntent: range over 1, foe 2..range away, in sight). */
export function canShoot(state, foe) {
  const p = state?.actors?.[state.playerId];
  if (!p?.bow || !foe || foe.hp <= 0 || foe.side !== 'foe' || foe.hidden) return false;
  const d = cheb(p, foe);
  return d > 1 && d <= p.bow.range && seen(state, foe.x, foe.y);
}

/**
 * The 'shoot' command ({type:'shoot', id}). Returns 'act' when an arrow flew, else 'refused' (no time passes).
 * Up close it is not a shot: the caller bumps instead (1.7 tryMove).
 */
export function shoot(state, c, events) {
  if (c.at) return shootProp(state, c.at, events);
  const p = state.actors[state.playerId];
  let t = state.actors[c.id];
  const refuse = (why, words) => { events.push({ type: 'refused', id: p.id, why, command: 'shoot' }); if (words) events.push({ type: 'log', words }); return 'refused'; };
  if (!p.bow) return refuse('no-bow', 'No bow equipped.');
  if (!t || t.hp <= 0 || t.side !== 'foe' || t.hidden || !seen(state, t.x, t.y)) return refuse('no-target');
  if (cheb(p, t) <= 1) return refuse('too-close', 'Too close to shoot.');
  if (cheb(p, t) > p.bow.range) return refuse('out-of-range', 'Out of range.');
  if (blocks(p, 'melee') || blocks(p, 'ranged')) return refuse('cannot-attack');
  const path = boltPath(state, p, t), end = path.at(-1);
  if (!end || !covers(t, end.x, end.y)) {
    const front = end ? bodyAt(state, end.x, end.y) : null;
    if (!front || front.side !== 'foe') return refuse('blocked', front ? `Your ${front.name} is in the way.` : 'Something is in the way.');
    events.push({ type: 'log', words: `${nameAlone(front.name) ? '' : 'The '}${front.name} is in the way and takes the arrow.` });
    t = front;
  }
  // The shot is resolved with the bow's numbers (1.7 attackView); C7 (engine-rules-38): passed in, the body never changed.
  weaponAttack(state, p, t, events, { ranged: true, weapon: 'ranged', dmg: p.bow.dmg, acc: p.bow.acc });
  if (state.hero) state.hero.lastAttacked = t.id;
  return 'act';
}
