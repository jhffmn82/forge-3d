// The one condition interpreter (spec/effects.md conditions; consolidation C8, engine-rules-10): every rule that asks
// "does this hold" asks here. An unbuilt condition counts as not holding and is recorded.

import races from '../../../data/races.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import { randomSafeCells } from './cells.js';

/** Conditions built so far; an unbuilt condition counts as not holding and is recorded. */
export function holds(cond, c) { return conditionHolds(cond, c); }

export function conditionHolds(cond, c) {
  if ('safe-landing' in cond) return randomSafeCells(c.state, true).length > 0 === !!cond['safe-landing'];   // RB46 Last Laugh
  if ('standing-on' in cond) return c.state.floor.ground?.[c.target.y * c.state.floor.w + c.target.x] === cond['standing-on'];
  if ('has-status' in cond) {
    const want = cond['has-status'];
    // {any: true, beforeThisHit}: the target had some status before the blow that set this off (Venomtouch).
    if (want.any === true) return want.beforeThisHit && c.hit?.hadStatus !== undefined ? c.hit.hadStatus : Object.keys(c.target?.statuses ?? {}).length > 0;
    // E24, E30: {status, body: source | target, beforeThisHit} (Petrify: Rooted before this Root took; Blight: the
    // attacker Poisoned); {immuneTo}: a timed or lasting immunity to that status (Petrify's 4 turns).
    if (want.status || want.immuneTo) {
      const b = want.body === 'source' ? c.source : c.target;
      if (!b) return false;
      if (want.immuneTo) return !!b.statuses?.['imm-' + want.immuneTo] || !!b.immune?.includes(want.immuneTo);
      if (want.beforeThisHit && c.applied) return c.applied.status === want.status ? !!c.applied.previous : !!b.statuses?.[want.status];
      if (want.beforeThisHit && b === c.target && c.hit?.statusesBefore) return c.hit.statusesBefore.includes(want.status);   // E16 Clear Waters: Frozen before the blow shattered it
      return !!b.statuses?.[want.status];
    }
    if (typeof want === 'string') {
      // CF08 (1.7 sylla.js syllaHitReactions): 'hidden' on a hit reads whether it was struck from hiding.
      if (want === 'hidden' && c.hit?.fromHiding !== undefined) return !!c.hit.fromHiding;
      // byTag (a god's kill awards): a status of that id, or any status tagged with it (Sylla's webbed, rooted, slowed).
      return !!c.target?.statuses?.[want] || (!!c.byTag && Object.keys(c.target?.statuses ?? {}).some(k => (statuses.rows[k]?.tags ?? []).includes(want)));
    }
    return (want.any ?? []).some(id => c.target.statuses[id]);
  }
  if ('not' in cond) return !conditionHolds(cond.not, c);
  if ('any' in cond) return cond.any.some(x => conditionHolds(x, c));
  if ('kill-side' in cond) {   // a death's own rows (death.js) and a god's kill awards (faith.js): who made the kill
    const k = cond['kill-side'], by = c.by, hero = c.state.playerId;
    if (k === 'self') return by?.id === hero;
    if (k === 'own-summon') return !!by?.servant && by.owner === hero;
    return k === 'player' ? (c.playerKill !== undefined ? !!c.playerKill : by?.side === 'player' || by?.side === 'ally') : by?.side === k;
  }
  if ('all' in cond) return cond.all.every(x => conditionHolds(x, c));
  // Asleep and off guard are read as they were before the ability's own strike landed (Sap's 6-turn stun).
  if ('in-state' in cond) return cond['in-state'].state === 'asleep' ? !!(c.before?.[c.target.id]?.asleep ?? c.target.asleep) : false;
  if ('off-guard' in cond) return !!(c.before?.[c.target.id]?.offGuard ?? (c.target.side === 'foe' && !c.target.throne && !c.target.hunting)) === cond['off-guard'];
  if ('creature-flag' in cond) {
    const want = [].concat(cond['creature-flag']), t = c.target;
    // {source: 'foe'}: the body the packet came from (Magic Barrier).
    // E48 Beacon Root (1.7 combos.js:67 def.base.range > 1): 'ranged' is any body that strikes from more than 1 away.
    return want.some(f => typeof f === 'object' ? (f.source === 'foe' ? c.source?.side === 'foe' : !!c.source?.[f.source]) : f === 'foe' ? t?.side === 'foe' : f === 'hunting' ? !!t?.hunting : f === 'awake' ? !t?.asleep
      : (f === 'ranged' && (t?.range ?? 1) > 1) || !!t?.[f] || !!t?.flags?.includes(f) || t?.behaviour === f);
  }
  // Passive triggers (passives.js): the packet's tags and type, what the hit was, a held combo, a god rank.
  if ('race-flag' in cond) return !!races.rows[c.state.hero?.race]?.[cond['race-flag']];   // CF19: the Gloomling's noHolyRadiance
  if ('has-tag' in cond) { const want = [].concat(cond['has-tag']); return want.some(x => (c.tags ?? c.packet?.tags ?? []).includes(x)); }
  if ('damage-type' in cond) return [].concat(cond['damage-type']).includes(c.packet?.type);
  if ('hit-was' in cond) {
    // A creature's own riders (crypt.js) have the packet but no hit: melee is a blow without the ranged tag.
    if (!c.hit && c.packet) { const tags = c.packet.tags ?? []; return [].concat(cond['hit-was']).some(k => (k === 'melee' ? !tags.includes('ranged') : tags.includes(k))); }
    const h = c.hit ?? {}; return [].concat(cond['hit-was']).some(k => k === 'single-target' ? !!h.single : !!h[k]);
  }
  if ('combo' in cond) return true;   // a combo's rows are collected only while it is held
  if ('rank-at-least' in cond) { const f = c.state.hero?.faith; return f?.god === cond['rank-at-least'].god && (f.rank ?? 0) >= cond['rank-at-least'].n; }
  // A body's HP (or MP) below a percent of its max (effects.json hp-below-pct): body self (default), target or source.
  if ('hp-below-pct' in cond) {
    const v = cond['hp-below-pct'], o = typeof v === 'number' ? { pct: v } : v;
    const b = o.body === 'target' ? c.target : o.body === 'source' ? c.source : c.owner ?? c.target;
    if (!b) return false;
    const [cur, max] = o.stat === 'mp' ? [b.mana, b.maxmana] : [b.hp, b.maxhp];
    return max > 0 && cur < max * o.pct / 100;
  }
  // CF06: how many foes the hero sees (Roll the Dice's sheep needs one that is not a boss, the escape two).
  if ('foes-in-sight' in cond) {
    const v = cond['foes-in-sight'], s = c.state;
    const n = s.order.map(id => s.actors[id]).filter(a => a.hp > 0 && a.side === 'foe' && !!s.vis?.[a.y * s.floor.w + a.x] && !(v.notBoss && (a.boss || a.set))).length;
    return n >= (v.min ?? 1);
  }
  if ('target-is' in cond) return cond['target-is'] === 'creature' ? c.target?.side === 'foe' : c.target?.side === cond['target-is'];
  // CD2 boons: the hero's bare hands (Chad), how far the target stands (Coward's Mark), what the Forge made (Second Heat).
  // wielding: one weapon id or 'unarmed' (a god's fists count as bare hands), a list of them, or {is, by: 'source'}: the
  // blow is the hero's own (a crypt creature's weakness to his mace).
  if ('wielding' in cond) {
    const h = c.state.hero, v = cond.wielding, w = v && typeof v === 'object' && !Array.isArray(v) ? v : { is: v };
    if (!h || (w.by === 'source' && c.source?.side !== 'player')) return false;
    const id = h.worn?.main?.id, held = !id || /^fists/.test(id) ? 'unarmed' : id;
    return [].concat(w.is).includes(held);
  }
  // A Crypt rule's affinity floor (the hero at Earth 6 is not poisoned by the ooze): {element: n}, the hero as target.
  if ('affinity-at-least' in cond) { const [el, n] = Object.entries(cond['affinity-at-least'])[0]; return c.target?.side === 'player' && (c.state.hero?.affinity?.[el] ?? 0) >= n; }
  if ('distance' in cond) { const d = c.target && c.owner ? Math.max(Math.abs(c.target.x - c.owner.x), Math.abs(c.target.y - c.owner.y)) : 0; return d >= (cond.distance.min ?? 0) && d <= (cond.distance.max ?? Infinity); }
  if ('craft-was' in cond) return c.craft === cond['craft-was'];
  const key = Object.keys(cond)[0];
  c.state.unbuilt['if:' + key] = (c.state.unbuilt['if:' + key] ?? 0) + 1;
  return false;
}
