// The commands besides a move (consolidation C13, engine-rules-21): the windows', the Forge's and shrine's, the hotbar's
// and the confirms'. Each returns a result for the scheduler: a kind, or { kind, attack, loud } (one result shape).
// Moved from game.js.

import loot from '../../data/loot.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import strings from '../../data/strings.json' with { type: 'json' };
import { realmCommand } from './realm.js';
import { useAbility, usePrayer, abilityRow, abilityTurn } from '../rules/abilities.js';
import { fuse } from '../rules/magic.js';
import { useSigil, carve, enchant, recycle } from '../rules/sigils.js';
import { weaponAttack } from '../rules/attack.js';
import { blocks } from '../rules/statuses.js';
import { spendPoint, equip, equipRefusal, unequip, drop, setHotbar, setClickSpell, divineRefusal, requirementRefusal, twoHandNote } from '../rules/hero.js';
import { puzzleCommand } from '../rules/puzzles.js';
import { eat } from '../rules/upkeep.js';
import { upgrade } from '../rules/forge.js';
import { swear, prayAtShrine, tithe } from '../rules/faith.js';
import { buyFromMerchant } from '../rules/merchant.js';
import { closeDoorAt, closeAdjacentDoors } from '../rules/doors.js';
import { search } from '../rules/traps.js';
import { shoot } from '../rules/shoot.js';
import { pickUp, dropOnFloor } from '../rules/pickup.js'; import { itemName } from '../rules/item-names.js';
import { onEquip, useAmulet } from '../rules/gear-use.js';
import { forceToll, sacrifice } from '../rules/rooms.js';
import { resolveMove, reachFoe, melee } from './bump.js';

const BAG_MAX = loot.rows.bag.slots;

/** A neutral body beside the hero turns foe and the hero strikes it (the hungry spider's Attack): one action. */
function provoke(state, c, events) {
  const p = state.actors[state.playerId], t = state.actors[c.id];
  if (!t || t.hp <= 0 || t.side !== 'neutral' || Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) !== 1) { events.push({ type: 'refused', id: p.id, why: 'no-target', command: 'provoke' }); return 'refused'; }
  if (blocks(p, 'melee')) { events.push({ type: 'refused', id: p.id, why: 'cannot-attack', command: 'provoke' }); return 'refused'; }
  Object.assign(t, { side: 'foe', hunting: true, asleep: false, provoked: true, lastSeen: { x: p.x, y: p.y, at: state.now } });
  weaponAttack(state, p, t, events);
  if (state.hero) state.hero.lastAttacked = t.id;
  return melee(state);
}

/** G13 (1.7 inventory-adapter.js inventoryFailure): what an equip refusal says. */
const EQUIP_REFUSAL = {
  'no-item': 'That item is no longer in your bag.', 'bag-full': 'Your bag is full.', 'not-wearable': 'That item does not fit there.',
  'not-off-hand': 'Only a light weapon, shield or focus fits your off hand.', 'bow-off-hand': 'A bow needs both hands. It goes in your ranged slot.',
};
/** G11 (1.7 commitEquipment): the line for a piece put on, by the slot it went to. */
const EQUIP_WORDS = (slot, name) => slot === 'ranged' ? `You sling the <b>${name}</b> across your back. It answers anything out of reach.`
  : slot === 'ring1' || slot === 'ring2' ? `You slip on the <b>${name}</b>.` : slot === 'amulet' ? `You fasten the <b>${name}</b>. Use it from the hotbar.`
  : slot === 'armour' ? `You put on the <b>${name}</b>.` : `You take up the <b>${name}</b>.`;
/** The cursed piece that would keep an equip from happening: the one in the slot it goes to, else the off hand's. */
/** Window and hero commands (spec/items.md I63: equipping and taking off cost an action; dropping and spending points do not). */
export function resolveHeroCommand(state, c, events, { applyHero, travel, FLOORS }) {   // C17: game.js hands its own three in
  const h = state.hero;
  const refuse = why => { events.push({ type: 'refused', id: state.playerId, why, command: c.type }); return 'refused'; };
  const changed = kind => { applyHero(state); events.push({ type: 'hero', change: c.type }); return kind; };
  if (c.type === 'spend-point') {
    // H31 (1.7 ui.js:583-592 spendPoint): "You train Might." with the stat-point chime; a passive the point opens is
    // named with what it does and the new-ability chime; a maxed attribute says so.
    const before = h.attr?.[c.attr] ?? 0, why = spendPoint(h, c.attr);
    if (why === 'at-max') events.push({ type: 'log', words: progression.rows.attributes.atMaxLog });
    if (why) return refuse(why);
    events.push({ type: 'log', words: progression.rows.attributes.spendLog.replace('{name}', progression.rows.attributes.names?.[c.attr] ?? c.attr), cls: 'c-good', sfx: 'stat-point' });
    const SP = progression.rows['stat-passives'];
    for (const p of SP[c.attr] ?? []) if (p.at > before && p.at <= h.attr[c.attr]) events.push({ type: 'log', words: SP.learnLog.replace('{name}', p.name).replace('{text}', strings.rows['stat-passive.' + p.name] ?? ''), cls: 'c-kill', sfx: 'new-ability' });
    return changed('free');
  }
  // CD5: a two-hander puts the off hand's piece in the bag, and holds the off hand back (1.7 inventory-adapter.js:10, :70).
  // G11, G13 (1.7 inventory-adapter.js inventoryFailure, commitEquipment, removeEquipment): putting a piece on says so
  // with the weapon or armour sound; a refusal says why with the error buzz (a full bag its own); taking off says so.
  if (c.type === 'equip') {
    const it = h.bag[c.bag], note = twoHandNote(h, c.bag, c.to ?? null), binder = equipRefusal(h, c.bag, c.to ?? null).binder ?? null;
    const why = equip(h, c.bag, c.to ?? null);
    if (why) {
      const words = why === 'requirements' ? requirementRefusal(h, it, itemName(it, state)) : why === 'forbidden' ? divineRefusal(h)
        : why === 'cursed' ? (binder ? `Your <b>${itemName(binder, state)}</b> is cursed. It will not come off.` : 'It is cursed. It will not come off.')
        : why === 'both-hands' && note ? note : EQUIP_REFUSAL[why] ?? 'That action cannot be completed.';
      events.push({ type: 'log', words, cls: why === 'cursed' ? 'c-you' : 'c-info', sfx: why === 'bag-full' ? 'inventory-full' : 'ui-error' });
      return refuse(why);
    }
    onEquip(state, it, events);
    const slot = Object.keys(h.worn).find(k => h.worn[k] === it) ?? 'main', name = itemName(it, state);
    events.push({ type: 'log', words: EQUIP_WORDS(slot, name), cls: 'c-good', sfx: ['main', 'off', 'ranged'].includes(slot) ? 'equip-weapon' : 'equip-armor' });
    if (note) events.push({ type: 'log', words: note, cls: 'c-info' });
    return changed('act');
  }
  if (c.type === 'unequip') {
    const was = h.worn[c.slot], why = unequip(h, c.slot, BAG_MAX);
    if (why === 'cursed') events.push({ type: 'log', words: `Your <b>${itemName(was, state)}</b> is cursed. It will not come off.`, cls: 'c-you', sfx: 'ui-error' });
    if (why === 'bag-full') events.push({ type: 'log', words: EQUIP_REFUSAL['bag-full'], cls: 'c-info', sfx: 'inventory-full' });
    if (!why) events.push({ type: 'log', words: `You ${c.slot === 'ranged' ? 'unsling' : 'take off'} the ${itemName(was, state)}.`, cls: 'c-info' });
    return why ? refuse(why) : changed('act');
  }
  if (c.type === 'drop') { const r = drop(h, c.bag); if (typeof r === 'string') return refuse(r); dropOnFloor(state, r.item, events); return changed('free'); }
  if (c.type === 'hotbar') { const why = setHotbar(h, c.slots); return why ? refuse(why) : changed('free'); }
  if (c.type === 'click-spell') {   // T7: the spell a tap on a foe casts (1.7 toggleClickSpell)
    const why = setClickSpell(h, c.id ?? null);
    if (!why) events.push({ type: 'log', words: h.clickSpell ? `Clicking an enemy now casts <b>${abilityRow(h.clickSpell)?.name ?? h.clickSpell}</b>.` : 'Clicking an enemy no longer uses an ability.' });
    return why ? refuse(why) : changed('free');
  }
  if (c.type === 'descend' || c.type === 'ascend') return travel(state, c.type === 'descend' ? 1 : -1, events) === 'free' ? 'free' : refuse('no-stairs');
  if (c.type === 'search') { search(state, events, { resting: !!c.rest, quiet: !!c.quiet }); return 'act'; }   // K1: a rest turn searches at half chance (main.js's rest loop); P3: the pad's wait is quiet
  if (c.type === 'close-doors') return closeAdjacentDoors(state, events);   // CB29: Shift+C
  if (c.type === 'close-door') return closeDoorAt(state, c.x, c.y, events) ?? refuse('no-door');   // CB29: a click on one
  // C71: a click on a foe across the room shoots the bow (rules/shoot.js); beside the hero it is a bump.
  if (c.type === 'shoot') {
    const p = state.actors[state.playerId], t = state.actors[c.id];
    if (t && t.hp > 0 && Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y)) <= 1) return resolveMove(state, p, Math.sign(t.x - p.x), Math.sign(t.y - p.y), events);
    // CB03 (1.7 shootAt): a foe in the spear's reach is struck with it, not shot.
    const d = t && [Math.sign(t.x - p.x), Math.sign(t.y - p.y)];
    if (d && reachFoe(state, p, d[0], d[1]) === t) return resolveMove(state, p, d[0], d[1], events);
    const r = shoot(state, c, events);
    return r === 'act' ? { kind: 'act', loud: true } : r;   // E31: a shot, for Lightning Reflexes
  }
  if (c.type === 'force') return forceToll(state, c, events);   // rules/rooms.js
  if (c.type === 'sacrifice') return sacrifice(state, c, events);
  if (c.type === 'provoke') return provoke(state, c, events);
  // The Forge and the shrine act between turns (their windows): no game time passes.
  if (c.type === 'upgrade') { const why = upgrade(state, c.slot, events); if (!why) applyHero(state); return why ? refuse(why) : 'free'; }
  if (c.type === 'swear') { const why = swear(state, events); if (!why) applyHero(state); return why ? refuse(why) : 'free'; }
  if (c.type === 'pray-shrine') { const why = prayAtShrine(state, events); return why ? refuse(why) : 'free'; }
  if (c.type === 'tithe') { const why = tithe(state, events); return why ? refuse(why) : 'free'; }
  if (c.type === 'buy') { const why = buyFromMerchant(state, c.item, events); return why ? refuse(why) : 'free'; }   // S24: the cavern merchant (rules/caverns.js)
  if (c.type === 'puzzle') return puzzleCommand(state, c, events);   // a puzzle's confirmed choice (the elemental lock's offer)
  if (c.type === 'realm') { const r = realmCommand(state, c, events, FLOORS); return r === 'refused' ? refuse('no-realm') : r; }
  if (c.type === 'fuse') { const why = fuse(state, c.element, events); if (!why) { state.coreInfusion = false; applyHero(state); const p = state.actors[state.playerId]; p.iceArmor = p.maxIceArmor; } return why ? refuse(why) : 'free'; }   // D50: Ice Armor refills
  if (c.type === 'end-infusion') { state.coreInfusion = false; return 'free'; }
  // D52-D54: the Forge's mote and essence work, between turns.
  if (c.type === 'craft' || c.type === 'carve') { const why = carve(state, c.sigil, events); return why ? refuse(why) : 'free'; }
  if (c.type === 'enchant') { const why = enchant(state, c.slot, c.element, events); if (!why) applyHero(state); return why ? refuse(why) : 'free'; }
  if (c.type === 'recycle' || c.type === 'recycle-all') { const why = recycle(state, c.bag, events, c.type === 'recycle-all'); return why ? refuse(why) : 'free'; }   // packet D
  if (c.type === 'pickup') return pickUp(state, events, c.at ?? null) ? 'act' : 'free';   // CB36 (1.7 game.js:536): taking something spends the turn
  // I60: Use on a bag item: food is eaten (an action); sigils come with packet D.
  // The hotbar names an item by id ({type:'use', item}); the bag by index ({type:'use', bag}).
  if (c.type === 'use' && c.amulet) { const r = useAmulet(state, c.at ?? null, events, c.choice ?? null); if (r === 'act' || r === 'free') applyHero(state); return r === 'act' || r === 'free' ? r : refuse(r); }   // I45
  if (c.type === 'use' && !c.ability) {
    const i = c.bag ?? h.bag.findIndex(b => b.id === c.item), it = h.bag[i];
    if (it?.kind === 'sigil') { const r = useSigil(state, i, c.choice ?? null, events); return r === 'act' || r === 'free' ? r : refuse(r); }
    if (it?.kind !== 'food') return refuse(it ? 'not-built-yet' : 'no-item');
    const why = eat(state, i, events);
    return why ? refuse(why) : 'act';
  }
  if (c.type === 'use' && c.ability) { const r = useAbility(state, c.ability, c.at ?? null, events); return r === 'act' || r === 'free' ? { kind: r, ...abilityTurn(abilityRow(c.ability)) } : refuse(r); }
  // RB41: a prayer from the hotbar or the Faith window (rules/abilities.js usePrayer), paid in favor.
  if (c.type === 'pray') { const r = usePrayer(state, c.prayer, c.at ?? null, events, c.choice ?? null); return r === 'act' || r === 'free' ? r : refuse(r); }
  if (['use', 'pray', 'explore'].includes(c.type)) return refuse('not-built-yet');   // abilities (packet D), prayers (E), auto-explore
  return null;
}
