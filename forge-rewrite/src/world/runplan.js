// The run plan (spec/world.md W4-W7, spec/faith.md F10, F16): made once per run from the run seed, on its own
// streams, so it never moves when a floor is generated again. Biomes 1-3 (W5) and the second-biome god
// preference (F16) join with the later biomes.

import gods from '../../data/gods.json' with { type: 'json' };
import { stream, next } from '../lib/rng.js';
import { ELEMENTS } from '../rules/loot.js';
import { godRefuses } from '../rules/god-refusal.js';

const GODS = Object.keys(gods.rows).filter(id => gods.rows[id].name);

const shuffle = (rng, a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next(rng) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/**
 * W4, W7, F16: the forge floor (3 or 4), the shrine floor (1-4, moved off the forge floor half the time), the god of
 * each biome's shrine from the four-card deal, and the mote plan (floor 1 one element, 2 two, 3 one, 4 two).
 * @param {number} seed the run seed
 * @param {{race:string, cls:string, court?:string|null, affinity?:object}} hero
 */
export function makeRunPlan(seed, hero) {
  const r = stream((seed ^ 0x5bd1e995) >>> 0);
  const els = shuffle(r, ELEMENTS.slice());
  const forgeFloor = next(r) < 0.5 ? 3 : 4;
  let shrineFloor = 1 + Math.floor(next(r) * 4);
  // F16: one shuffle of the nine gods; the ones this character could swear to go first; four cards kept.
  const d = stream((seed ^ 0x6f5a1c3d) >>> 0), ids = shuffle(d, GODS.slice());
  const ok = ids.filter(id => !godRefuses(id, hero));
  const deal = [...ok, ...ids.filter(id => !ok.includes(id))].slice(0, 4);
  if (shrineFloor === forgeFloor && next(r) < 0.5) shrineFloor = forgeFloor === 3 ? 2 : 1;
  // W7: a non-Cleric Gloomling meets Murk and a Dwarf meets Anvil in biome 0.
  const first = hero.cls !== 'cleric' && { gloomling: 'murk', dwarf: 'anvil' }[hero.race];
  if (first) { const i = deal.indexOf(first); if (i > 0) deal[i] = deal[0]; deal[0] = first; }
  return {
    seed,
    cls: hero.cls,   // the elemental treasury's class weapon (world.md 58)
    deal,
    biomes: { 0: { forge: forgeFloor, shrine: shrineFloor, god: deal[0], motes: { 1: [els[0]], 2: [els[1], els[2]], 3: [els[3]], 4: [els[4], els[5]], 5: [] } } },
  };
}

/**
 * W5: a later biome's plan (1.7 world.js biomePlan, b > 0), from its own stream (run seed ^ 0x51ed27 x (b + 1)): the
 * forge on the biome's floor 3 or 4, the shrine on 1-4 (redrawn 70% of the time when it lands on the forge floor;
 * biomes 1-3 only, so four shrines a run), then the six elements shuffled for the mote plan. The god is the deal's
 * card for that biome. Worked out when asked, so a save made before the later biomes were planned gets them too.
 */
function laterBiome(plan, bi) {
  const r = stream(((plan.seed || 1) ^ Math.imul(0x51ed27, bi + 1)) >>> 0);
  const forge = next(r) < 0.5 ? 3 : 4;
  let shrine;
  do { shrine = 1 + Math.floor(next(r) * 4); } while (shrine === forge && next(r) < 0.7);
  const els = shuffle(r, ELEMENTS.slice());
  return { forge, shrine: bi <= 3 ? shrine : null, god: plan.deal?.[bi] ?? null, motes: { 1: [els[0]], 2: [els[1], els[2]], 3: [els[3]], 4: [els[4], els[5]], 5: [] } };
}

/**
 * WC7, F16, FO14 (1.7 world.js generatedShrineGod, secondBiomeShrinePriority, shrineGodAvailable): run just before a
 * new floor is built. On a biome's shrine floor (biomes 0-3) whose shrine is not built yet, the god is settled against
 * the hero as he is now: the second biome prefers a god that suits him, a dealt god who would refuse him now (or was
 * already offered) is replaced, a later unbuilt card may swap places, and the offer is then fixed (plan.offers).
 * A bound Cleric keeps the dealt card. Returns the god, or null when this floor holds no unsettled shrine.
 */
export function settleShrine(plan, floorNo, hero) {
  const bi = Math.floor((floorNo - 1) / 5), bf = ((floorNo - 1) % 5) + 1;
  if (!plan?.deal || bi < 0 || bi > 3) return null;
  if (!plan.biomes[bi]) { if (plan.seed == null) return null; plan.biomes[bi] = laterBiome(plan, bi); }
  const b = plan.biomes[bi], offers = plan.offers ??= {}, deal = plan.deal;
  if (b.shrine !== bf || offers[bi]) return null;
  const original = b.god ?? deal[bi];
  if (hero.cls === 'cleric') return (offers[bi] = original);
  const offered = id => Object.values(offers).includes(id);
  const available = id => {
    if (!gods.rows[id]?.name || godRefuses(id, hero) || offered(id)) return false;
    const i = deal.indexOf(id);
    return i < 0 || (i >= bi && !offers[i]);
  };
  const pick = ids => { const r = stream(((plan.seed || 0) ^ 0x73a9d641 ^ Math.imul(bi + 1, 0x51ed27)) >>> 0); return ids[Math.floor(next(r) * ids.length)]; };
  let wanted = null;
  if (bi === 1) {
    const aff = hero.affinity ?? {}, pri = [];
    if ((aff.light ?? 0) > 0) pri.push(['glimmer']);
    if ((aff.shadow ?? 0) > 0) pri.push(['murk']);
    if (hero.race === 'dwarf') pri.push(['anvil']);
    if (hero.cls === 'mage') pri.push(['vellum']);
    if (hero.cls === 'scoundrel') pri.push(['sylla', 'wobbles']);
    if (hero.cls === 'fighter') pri.push(['reginald', 'grumbok']);
    for (const ids of pri) {
      const c = ids.filter(id => hero.faith?.god !== id && available(id));
      if (c.length) { wanted = pick(c); break; }
    }
  }
  if (!wanted && original && available(original)) wanted = original;
  if (!wanted) {
    const future = deal.slice(bi).filter(available);
    const c = future.length ? future : GODS.filter(available);
    wanted = c.length ? pick(c) : original;   // 1.7 threw here; keep the dealt card rather than lose the floor
  }
  const i = deal.indexOf(wanted);
  if (i > bi) deal[i] = deal[bi];
  deal[bi] = wanted; b.god = wanted;
  for (let k = bi + 1; k < 4; k++) if (plan.biomes[k] && !offers[k]) plan.biomes[k].god = deal[k];
  offers[bi] = wanted;
  return wanted;
}

/** What the plan puts on one floor: {forge, shrine: god id or null, motes: [element]}. */
export function planFor(plan, floorNo) {
  const bi = Math.floor((floorNo - 1) / 5), bf = ((floorNo - 1) % 5) + 1;
  // Biomes 1-4 only: the Realm of Chaos gets no planned Forge or shrine (Justin, 2026-10-16, as 1.7); its final forge on
  // floor 25 belongs to the Unmaker's encounter, not to the run plan.
  const b = plan?.biomes?.[bi] ?? (bi > 0 && bi < 4 && plan?.seed != null ? laterBiome(plan, bi) : null);
  if (!b) return { forge: false, shrine: null, motes: [] };
  return { forge: b.forge === bf, shrine: b.shrine === bf ? b.god : null, motes: b.motes[bf] ?? [] };
}
