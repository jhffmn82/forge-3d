// The cavern merchant (spec/world.md S24, loot.json merchant; 1.7 merchantStock, buyMerchantItem): its stock, its
// stall and vendor, and buying (moved from caverns.js, consolidation C10e).

import loot from '../../data/loot.json' with { type: 'json' };
import sigilRows from '../../data/sigils.json' with { type: 'json' };
import { next, stream } from '../lib/rng.js';
import { cheb } from '../lib/geometry.js';
import { CREATURE_HOOKS, PROP_USES, BODY_USES } from './set-pieces.js';
import { giveOf, randomGear, ELEMENTS } from './loot.js';
import { itemRow } from './items.js';
import { carveCost } from './sigils.js';

// ---------------------------------------------------------------- the cavern merchant (spec/world.md S24, loot.json merchant)
const MERCHANT = loot.rows.merchant, SG = sigilRows.rows;
const vendorOf = state => state.order.map(id => state.actors[id]).find(a => a.merchant && a.hp > 0) ?? null;
/**
 * 1.7 merchantStock, from loot.json merchant: a ring and an amulet (never cursed), a Masterwork weapon, armour and
 * off-hand (identified, uncursed; the first candidate of that slot in up to 100 tries), one mote of each element,
 * and six sigils, one from each named group with no repeats, at twice their essence. Rolled from its own stream of
 * the run seed and the floor, so visiting the stall never shifts the floor's other rolls.
 */
export function merchantStock(state) {
  state.run ??= {};
  const s = { ...state, rng: stream(((state.seed ?? 0) ^ 0x4d455243 ^ Math.imul(state.floorNo ?? 0, 0x9e3779b9)) >>> 0) }, fl = state.floorNo, out = [], seen = new Set();
  const put = (item, price) => { if (item) out.push({ id: 'm' + out.length, item, price, sold: false }); };
  for (const g of MERCHANT.gives) {
    if ('ring' in g || 'amulet' in g) put(giveOf(s, g, fl)[0], g.price);
    else if (g.gear === 'candidate') {
      let gear = null;
      for (let n = 0; n < 100; n++) { gear = randomGear(s, fl, { tier: 3, uncursed: true, identified: true }); if (itemRow(gear.id).kind === g.slot) break; }
      gear.known = true; gear.cursed = false;
      put(gear, g.price);
    } else if (g.mote === 'each element') for (const el of ELEMENTS) put({ kind: 'mote', el }, g.price);
    else if ('sigil' in g) {
      let pool = (SG.groups[g.sigil.slice(6)] ?? []).filter(k => SG[k] && !seen.has(k));
      if (!pool.length) pool = Object.keys(SG).filter(k => SG[k]?.kind === 'sigil' && !seen.has(k));
      const id = pool[Math.floor(next(s.rng) * pool.length)];
      seen.add(id);
      put({ kind: 'sigil', id, count: 1 }, 2 * carveCost(id));
    }
  }
  return out;
}
/** The stall or the vendor, bumped: the merchant's window opens (its stock rolled the first time); no time passes. */
function openMerchant(state, events) {
  const m = state.floor.merchant;
  if (!m || !vendorOf(state)) return false;
  m.stock ??= merchantStock(state);
  events.push({ type: 'merchant' });
  return true;
}
// The vendor stands at its stall and never hunts, wanders or notices.
CREATURE_HOOKS.act.push((state, a) => !!(a.merchant && a.side === 'neutral'));
BODY_USES.push((state, b, events) => (b.merchant && b.hp > 0 ? (openMerchant(state, events), 'refused') : undefined));
PROP_USES['table-candle'] = (state, prop, events) => {
  if (prop.merchant && openMerchant(state, events)) return 'refused';
  events.push({ type: 'blocked', id: state.playerId, at: { x: prop.x, y: prop.y } });
  return 'refused';
};
/**
 * 1.7 buyMerchantItem: the vendor alive and the hero within 1 of it or the stall; each offer sells once; short of
 * essence says so; a mote goes to the pool, anything else to the bag (a sigil bought is known); sound pickup-item.
 * Returns why it was refused, or null. No time passes.
 */
export function buyFromMerchant(state, id, events) {
  const m = state.floor?.merchant, v = vendorOf(state), p = state.actors[state.playerId], h = state.hero;
  if (!m?.stock || !v || (cheb(p, v) > 1 && cheb(p, m.stall) > 1)) return 'no-merchant';
  const offer = m.stock.find(o => o.id === id);
  if (!offer || offer.sold) return 'sold';
  if ((h.essence ?? 0) < offer.price) { events.push({ type: 'log', words: `You need ${offer.price} essence.` }); return 'short'; }
  const it = { ...offer.item };
  if (it.kind === 'mote') h.motes[it.el] = (h.motes[it.el] ?? 0) + 1;
  else {
    const stack = it.kind === 'sigil' ? h.bag.find(b => b.kind === 'sigil' && b.id === it.id) : null;
    if (stack) stack.count = (stack.count ?? 1) + 1;
    else if (h.bag.length >= loot.rows.bag.slots) { events.push({ type: 'log', words: 'Your bag is full.' }); return 'bag-full'; }
    else h.bag.push(it);
    if (it.kind === 'sigil') { const k = (state.run ??= {}).knownSigils ??= []; if (!k.includes(it.id)) k.push(it.id); }
    if (it.tier === 3 && it.mwFound !== it.id) { it.mwFound = it.id; (state.masterworks ??= {})[it.id] = (state.masterworks[it.id] ?? 0) + 1; }   // G27: once a piece
  }
  h.essence -= offer.price; offer.sold = true;
  events.push({ type: 'pickup', what: it.kind, sfx: 'pickup-item', at: { x: p.x, y: p.y } }, { type: 'merchant', bought: id }, { type: 'essence-spent', amount: offer.price });
  return null;
}
