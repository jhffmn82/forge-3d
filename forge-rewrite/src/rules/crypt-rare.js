// The hungry spider in play (spec/world.md rule 72; rooms.json hungry-spider; 1.7 rare-rooms.js:98-123): a neutral
// Hungry Web Spitter that waits in its web, speaks when first seen, eats a ration dropped in its room and then follows
// the hero, and turns hostile when the hero or an ally harms it. Built by src/world/biomes/crypt/rare.js.

import rooms from '../../data/rooms.json' with { type: 'json' };
import { CREATURE_HOOKS, ITEM_DROPPED, BODY_USES } from './set-pieces.js';

const HS = rooms.rows['hungry-spider'].interaction;
const inRoom = (r, c) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;
const spiders = state => state.order.map(id => state.actors[id]).filter(a => a.hungrySpider && a.hp > 0);

/** While neutral it stays in its web and does nothing; the first time the hero sees it, it speaks. */
CREATURE_HOOKS.act.push((state, a, events) => {
  if (!a.hungrySpider || a.side !== 'neutral') return false;
  if (!a.hungrySpider.spoke && state.vis?.[a.y * state.floor.w + a.x]) { a.hungrySpider.spoke = true; events.push({ type: 'log', words: HS.onSight.log }); }
  return true;
});

/** Bumping it: it speaks, and a confirm box offers Attack (the 'provoke' command); no time passes. */
BODY_USES.push((state, b, events) => {
  if (!b.hungrySpider || b.hp <= 0) return undefined;
  b.hungrySpider.spoke = true;
  events.push({ type: 'log', words: HS.onSight.log }, { type: 'confirm', id: 'hungry-spider', title: 'Hungry Web Spitter', text: 'The spider watches you without attacking.', yes: 'Attack', command: { type: 'provoke', id: b.id } });
  return 'refused';
});

/** A ration dropped in its room while it is neutral: it eats it and becomes the hero's pet, following between floors. */
ITEM_DROPPED.push((state, lying, events) => {
  const it = lying?.item;
  if (it?.kind !== 'food' || it.id !== 'ration') return;
  const s = spiders(state).find(a => a.side === 'neutral' && !a.hungrySpider.provoked && inRoom(a.hungrySpider.room, lying));
  if (!s) return;
  const f = state.floor;
  if ((it.count ?? 1) > 1) it.count -= 1; else f.items.splice(f.items.indexOf(lying), 1);
  Object.assign(s, { side: 'ally', hunting: false, asleep: false, follows: true, t: state.actors[state.playerId].t });
  s.hungrySpider.fed = true;
  events.push({ type: 'drops', at: { x: lying.x, y: lying.y } }, { type: 'log', words: HS.onRationDropped.log, sfx: HS.onRationDropped.sound });
});

/** Harm from the hero or an ally turns a neutral spider hostile, for good. */
CREATURE_HOOKS.damaged.push((state, t, pk, dealt) => {
  if (!t.hungrySpider || t.side !== 'neutral' || dealt <= 0) return;
  const s = pk.source;
  if (!s || (s.side !== 'player' && s.side !== 'ally')) return;
  provoke(state, t);
});

/** The spider turns on the hero (an attack, or the confirm box's Attack). */
export function provoke(state, t) {
  const p = state.actors[state.playerId];
  Object.assign(t, { side: 'foe', hunting: true, asleep: false, lastSeen: { x: p.x, y: p.y, at: state.now } });
  t.hungrySpider.provoked = true;
}
