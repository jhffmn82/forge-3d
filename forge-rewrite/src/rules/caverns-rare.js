// The Caverns' Sealed Lamp in play (spec/world.md S41, rule 73; rooms.json sealed-lamp; 1.7 rare-rooms.js
// releaseSealedLamp, systems.js grab): picking up the Sealed Magic Lamp shatters it and frees a hostile Chaos Prism
// Seer on the free room cell nearest the lamp that is at least 2 from the hero, not beside a door, with no stairs,
// upstairs, exit or portal within 3; the floor becomes a chaos incursion. No such cell: the seal holds and the lamp
// stays. Built by src/world/biomes/caverns/specials.js.

import rooms from '../../data/rooms.json' with { type: 'json' };
import { ITEM_PICKED } from './set-pieces.js';
import { chaosBody } from './monsters.js';
import { bodyAt } from './moves.js';
import { T, tileAt } from '../data/tiles.js';

const SL = rooms.rows['sealed-lamp'].interaction;
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const WAYS = new Set([T.STAIRS, T.STAIRS_UP, T.EXIT, T.PORTAL]);

/** The cell the Prism Seer tears free on, or null. */
function seerCell(state, lying) {
  const f = state.floor, p = state.actors[state.playerId];
  const free = c => tileAt(f, c.x, c.y) === T.FLOOR && !f.props.some(q => q.x === c.x && q.y === c.y) && !f.items.some(i => i.x === c.x && i.y === c.y) && !bodyAt(state, c.x, c.y) && !(p.x === c.x && p.y === c.y);
  const clearOfWays = c => { for (let y = c.y - 3; y <= c.y + 3; y++) for (let x = c.x - 3; x <= c.x + 3; x++) if (WAYS.has(tileAt(f, x, y))) return false; return true; };
  return lying.lamp.cells.filter(c => free(c) && cheb(c, p) >= 2 && clearOfWays(c)).sort((a, b) => cheb(a, lying) - cheb(b, lying))[0] ?? null;
}

ITEM_PICKED.push((state, lying, events) => {
  if (lying.item?.id !== 'sealed-lamp' || !lying.lamp) return undefined;
  const f = state.floor, p = state.actors[state.playerId], c = seerCell(state, lying);
  if (!c) { events.push({ type: 'log', words: SL.logs[1] }); return false; }
  f.chaosIncursion = true;
  f.items.splice(f.items.indexOf(lying), 1);
  const e = chaosBody('chaos-prism-seer', c.x, c.y, 'ritual-incursion', { asleep: false, wait: 0 });
  Object.assign(e, { hunting: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t + 100 });
  state.actors[e.id] = e; state.order.push(e.id);
  events.push({ type: 'spawned', id: e.id, at: { x: c.x, y: c.y } }, { type: 'log', words: SL.logs[0], sfx: SL.sound });
  return true;
});
