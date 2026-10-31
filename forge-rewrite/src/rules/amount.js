// Amount forms (spec/effects.md "Amount forms"): a number, or one keyed object. Unknown forms are errors.

import { roll } from '../lib/rng.js';
import tuning from '../../data/tuning.json' with { type: 'json' };

const SCALE = tuning.rows['number-scale'];

/** Value of one scaling key for the effect's owner (closed list in effects.md). */
function scaleKey(key, ctx) {
  const o = ctx.owner ?? {};
  if (key.startsWith('affinity:')) return o.affinity?.[key.slice(9)] ?? 0;
  if (key.startsWith('attribute:')) return (o.attr?.[key.slice(10)] ?? 10) - 10;
  switch (key) {
    case 'floor': return ctx.state?.floorNo ?? 1;
    case 'level': return o.level ?? 1;
    case 'rank': return ctx.rank ?? 0;
    case 'divine': return o.divine ?? 1;
    case 'spell-power': return o.spellPower ?? 1;
    case 'stacks': return ctx.status?.stacks ?? 1;
    case 'weapon-damage-sum': return (o.dmg?.[0] ?? 0) + (o.dmg?.[1] ?? 0);
    case 'total-affinity': return Object.values(o.affinity ?? {}).reduce((a, b) => a + b, 0);
    case 'number-scale': return SCALE.numberScale ?? 1;
    case 'lethality': return SCALE.lethality ?? 1;
    case 'status-scale': return ctx.status?.scale ?? 1;
    case 'ability-scale': return o.abilityScale ?? 1;   // M8: a creature's special moves (Underdark 1.25)
    default: throw new Error(`unknown scaling key ${key}`);
  }
}

/**
 * @param {any} a the amount
 * @param {{state:any, owner?:any, target?:any, status?:any, rank?:number, source?:any}} ctx
 */
export function amount(a, ctx) {
  if (typeof a === 'number') return a;
  if (!a || typeof a !== 'object') throw new Error('bad amount ' + JSON.stringify(a));
  if ('roll' in a) return roll(ctx.state.rng, a.roll[0], a.roll[1]);
  if ('from-status' in a) return ctx.status?.[a['from-status']] ?? (a.fallback === undefined ? 0 : amount(a.fallback, ctx));
  if ('from-source' in a) {
    const v = ctx.source?.[a['from-source']] ?? 0;
    return Array.isArray(v) ? roll(ctx.state.rng, v[0], v[1]) : v;   // a damage pair is rolled (Root Spit uses the slime's dmg)
  }
  if ('tuning' in a) return tuning.rows[a.tuning];
  if ('pct-of' in a) {
    const p = a['pct-of'], who = ctx.target ?? ctx.owner;
    const base = { 'max-hp': who.maxhp, hp: who.hp, 'max-mp': who.maxmana, mp: who.mana, essence: who.essence, overheal: ctx.packet?.overheal ?? 0, 'mana-paid': ctx.packet?.manaPaid ?? 0 }[p.stat];   // overheal: E27 Holy Water; mana-paid: E35 the Light tome
    if (base === undefined) throw new Error('pct-of stat not built: ' + p.stat);
    const pct = amount(who.boss && p.bossPct !== undefined ? p.bossPct : p.pct, ctx);
    return Math.max(p.min ?? 0, base * pct / 100);
  }
  if ('scaled' in a) {
    const s = a.scaled;
    let v = amount(s.base ?? 0, ctx);
    // effects.md "Amounts": a stepped term {"every": N, "add": A} adds A per whole N of the key (Morty's floor/2).
    for (const [k, per] of Object.entries(s.per ?? {})) v += typeof per === 'number' ? per * scaleKey(k, ctx) : per.add * Math.floor(scaleKey(k, ctx) / per.every);
    for (const k of s.mult ?? []) v *= scaleKey(k, ctx);
    if (s.round === 'down') v = Math.floor(v);
    else if (s.round) v = Math.round(v);
    if (s.min !== undefined) v = Math.max(s.min, v);
    if (s.max !== undefined) v = Math.min(s.max, v);
    return v;
  }
  throw new Error('unknown amount form ' + Object.keys(a)[0]);
}

/**
 * C5 (engine-rules-19): a creature move's number, scaled as every creature number is: base (a number or a roll pair)
 * times each mult key in order (number-scale and lethality; add 'ability-scale' for an Underdark special), rounded,
 * at least 1.
 */
export function amountScaled(state, base, { owner = null, mult = ['number-scale', 'lethality'] } = {}) {
  return amount({ scaled: { base: Array.isArray(base) ? { roll: base } : base, mult, round: true, min: 1 } }, { state, owner, source: owner });
}
