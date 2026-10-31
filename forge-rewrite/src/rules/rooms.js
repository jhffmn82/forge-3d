// The rooms that charge for a way in or a gift (consolidation C13, engine-rules-31; rooms.json toll-room, sacrifice):
// the spiked door (W28) and the sacrifice altar (S10). Each asks first on a bump (a confirm, no time) and is paid by its
// command (an action). Costs and words are the rows'.

import rooms from '../../data/rooms.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import { T, tileAt } from '../data/tiles.js';
import { dealDamage } from './damage.js';
import { giveOf } from './loot.js';
import { nearFree } from './space.js';
import { refreshSight } from './sight.js';

const TOLL = rooms.rows['toll-room'].bump, ALTAR = rooms.rows.sacrifice.interaction;
const PAY = ALTAR.effects[0].amount['pct-of'], GIFTS = ALTAR.rewardsAt.passes, SATED = Math.max(...GIFTS), [PLEASED, DRINKS, FULL] = ALTAR.logs;
const beside = (p, c) => Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y)) === 1;
/** W28: half the hero's current HP, at least 1 (the row's pay-hp). */
const tollCost = p => Math.max(TOLL.effects[0].amount['pct-of'].min ?? 1, Math.floor(p.hp * TOLL.effects[0].amount['pct-of'].pct / 100));
/** S10: 15% of max HP, rounded, at least 1 (the row's pay-hp). */
const altarCost = p => Math.max(PAY.min ?? 1, Math.round(p.maxhp * PAY.pct / 100));
const altarAt = (f, x, y) => f.props.find(q => q.x === x && q.y === y && q.id === 'altar-spikes');

/** The bump: the spiked door asks first (CB41: it says plainly what it costs and what is behind it). */
export function tollBump(state, p, x, y, events) {
  if (tileAt(state.floor, x, y) !== T.TOLL) return null;
  const cost = tollCost(p);
  events.push({ type: 'confirm', id: 'toll', title: TOLL.title, text: `The spikes take their due: ${cost} HP (half your current health) to squeeze through. The room behind holds a real reward.`, yes: `Pay ${cost} HP`, cost, command: { type: 'force', x, y } });
  return 'refused';
}

/** W28: paying the spiked door: direct damage, then it opens (an action). */
export function forceToll(state, c, events) {
  const f = state.floor, p = state.actors[state.playerId];
  if (tileAt(f, c.x, c.y) !== T.TOLL || !beside(p, c)) { events.push({ type: 'refused', id: p.id, why: 'no-toll' }); return 'refused'; }
  dealDamage(state, { target: p, source: null, amount: tollCost(p), type: 'phys', premitigated: true, bypassShields: true, tags: TOLL.tags }, events);
  f.tiles[c.y * f.w + c.x] = T.OPEN_DOOR;
  events.push({ type: 'door', at: { x: c.x, y: c.y }, open: true }, { type: 'log', words: TOLL.log });
  refreshSight(state, events);
  return 'act';
}

/** The bump: the altar asks first (CB42, 1.7 systems.js:499-500: a red warning when the pass would kill), or is sated. */
export function altarBump(state, p, x, y, events) {
  const altar = altarAt(state.floor, x, y);
  if (!altar) return null;
  if (altar.passes >= SATED) { events.push({ type: 'log', words: FULL }); return 'refused'; }
  const cost = altarCost(p), lethal = p.hp <= cost;
  events.push({ type: 'confirm', id: 'sacrifice', title: 'Sacrifice altar', text: `Press your hand onto the spikes for ${cost} HP. What it gives, and when, is its own business.`,
    warn: lethal ? 'This would kill you.' : null, yes: lethal ? 'Offer anyway' : 'Offer blood', cost, command: { type: 'sacrifice', x, y } });
  return 'refused';
}

/** S10: one pass at the sacrifice altar (an action), which may kill; gifts at its rewarding passes (3, 5 and 7). */
export function sacrifice(state, c, events) {
  const f = state.floor, p = state.actors[state.playerId], altar = altarAt(f, c.x, c.y);
  if (!altar || !beside(p, c) || altar.passes >= SATED) { events.push({ type: 'refused', id: p.id, why: 'no-altar' }); return 'refused'; }
  dealDamage(state, { target: p, source: null, amount: altarCost(p), type: 'phys', premitigated: true, bypassShields: true, cause: 'sacrifice' }, events);
  altar.passes += 1;
  if (GIFTS.includes(altar.passes)) {
    // loot.json sacrifice-altar: pass 3 essence, 5 a sigil, 7 the seventh gift. CB42 (1.7 systems.js:504-509): the gift
    // lies on free ground beside the altar (else at the hero's feet), and the altar sparkles dark.
    const at = nearFree(state, altar, 1)[0] ?? { x: p.x, y: p.y };
    for (const it of giveOf(state, loot.rows['sacrifice-altar'].passes[altar.passes], state.floorNo)) f.items.push({ x: at.x, y: at.y, item: it });
    events.push({ type: 'log', words: PLEASED, sfx: 'shrine-convert' }, { type: 'drops', at: { x: at.x, y: at.y } }, { type: 'sparkle', at: { x: altar.x, y: altar.y }, kind: 'dark', n: 30 });
  } else events.push({ type: 'log', words: altar.passes >= SATED ? FULL : DRINKS });
  return 'act';
}
