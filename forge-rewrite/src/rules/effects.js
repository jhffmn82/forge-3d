// Runs one effect from data (spec/effects.md). Verbs are built as the packets that need them land.
// A verb that exists in data/effects.json but is not built yet is never skipped silently:
// it is recorded in state.unbuilt and raised as an 'unbuilt' event, so checks and the log can see it.

import verbs from '../../data/effects.json' with { type: 'json' };
import { amount } from './amount.js';
import { next } from '../lib/rng.js';
import { heroRoll } from './hit.js';
import { VERBS } from './effects/verbs.js';
import { WORLD_VERBS } from './effects/verbs-world.js';
import { ITEM_VERBS } from './effects/verbs-items.js';
import { select, areaTiles } from './effects/select.js';
import { conditionHolds } from './effects/conditions.js';

const BUILT = { ...VERBS, ...WORLD_VERBS, ...ITEM_VERBS };


const KNOWN = new Set(Object.keys(verbs.rows ?? verbs));

/** True when every verb in a row is a known verb (load-time check). */
export function isKnownVerb(v) { return KNOWN.has(v); }

/** The verbs runEffect runs (C1 guard: every creature verb is built here or listed codeOwned in effects.json). */
export const builtVerbs = () => Object.keys(BUILT);

/** @param {any} e @param {{state:any, owner:any, target:any, status?:any, statusId?:string, events:any[], source?:any}} c */
// E17 (1.7 combos.js:53, :66-68, :89, :104, infusions.js:21, :47-53 hitProc): an effect's `proc` names the small
// flourish its moment shows on the body it lands on (fx-kit.js proc), looks only: Frostshade's and Permafrost's rime,
// Forge Heat's lick of flame on the hero for each new stack, an orb's crit mark, the Shadow tome's wisp off the fallen.
// A status, a stack, healing, mana or a shield marks only when it took or changed; any other verb marks each time it
// runs. procOn: 'victim' puts it on the body an on-kill names. The 'proc' event goes before what the effect said, so a
// status it laid is not marked a second time (playback.js watchProcs).
const procSig = (e, t) => (t ? JSON.stringify([t.hp, t.mana, t.shields ?? null, t.iceArmor ?? null, e.status ? t.statuses?.[e.status]?.stacks ?? !!t.statuses?.[e.status] : null]) : '');

function procBefore(e, t, c) { return { at: c.events.length, sig: procSig(e, t), had: !!(e.status && t?.statuses?.[e.status]) }; }

function procAfter(e, t, c, m) {
  const changed = procSig(e, t) !== m.sig;
  const took = e.verb === 'apply-status' ? !m.had && !!t?.statuses?.[e.status] : ['add-stack', 'heal', 'mana', 'shield', 'damage'].includes(e.verb) ? changed : true;
  const on = e.procOn === 'victim' ? c.victim : t;
  if (!took || !on?.id) return;
  const ev = { type: 'proc', id: on.id, kind: e.proc };
  const gained = c.events.slice(m.at).find(x => x.type === 'mana' && x.id === t.id)?.amount;
  if (e.verb === 'mana' && gained > 0) Object.assign(ev, { words: `+${gained} mp`, tone: 'ice' });   // 1.7 orbOnCritical floatText
  c.events.splice(m.at, 0, ev);
}

export function runEffect(e, c) {
  if (!KNOWN.has(e.verb)) throw new Error('unknown verb ' + e.verb);
  if (e.only === 'player' && c.target?.side !== 'player') return;
  if (e.only === 'creatures' && c.target?.side === 'player') return;
  // An effect that names several bodies reads its condition on each of them (Consecrate: only the undead and shadowy).
  const each = !!e.target && !['self', 'target'].includes(e.target.selector) && e.verb !== 'alert';
  if (e.if && !each && !conditionHolds(e.if, c)) return;
  // CB05: a chance the hero owns rolls with Lady Luck's points (effects.json field-chance, ruled 2026-10-15).
  if (e.chance !== undefined && !(c.owner?.side === 'player' ? heroRoll(c.state, c.owner, (amount(e.chance, c) + (c.owner.luck ?? 0)) / 100, c.events) : next(c.state.rng) < amount(e.chance, c) / 100)) return;   // RB47 Lucky Streak
  const fn = BUILT[e.verb];
  if (!fn) {
    c.state.unbuilt[e.verb] = (c.state.unbuilt[e.verb] ?? 0) + 1;
    c.events.push({ type: 'unbuilt', verb: e.verb, from: c.statusId ?? null });
    return;
  }
  // A `target` selector runs the verb once for each body it names (alert reads its own `who`).
  const targets = e.target && e.verb !== 'alert' ? select(e.target, c) : [c.target];
  if (e.verb === 'damage' && e.tags?.includes('spell') && typeof e.amount !== 'number') e = { ...e, amount: amount(e.amount, c) };
  // E13: every tile a hero's area spell strikes, for its rank 6 ground (abilities.js lays it after the cast).
  if (e.verb === 'damage' && e.tags?.includes('spell') && e.target && c.shared && c.owner?.side === 'player') (c.shared.ground ??= []).push(...areaTiles(e.target, c, targets));
  for (const t of targets) {
    if (each && e.if && !conditionHolds(e.if, { ...c, target: t })) continue;
    const mark = e.proc ? procBefore(e, t, c) : null, from = c.events.length;
    fn(e, { ...c, target: t });
    if (mark) procAfter(e, t, c, mark);
    // `then`: effects that follow on the same target once this one has run; a weapon attack's only on a damaging hit
    // (CF20: Lunge's stun, Anvil's Toll's push and stun; 1.7 classes.js:123, gods.js:581).
    if (e.then && e.verb !== 'dash' && t?.hp > 0 && (e.verb !== 'weapon-attack' || c.events.slice(from).some(v => v.type === 'attacked' && v.id === c.owner?.id && v.target === t.id && v.hit && v.damage > 0))) for (const th of e.then) runEffect(th, { ...c, target: t });
  }
}
import { provide } from './set-pieces.js'; provide('runEffect', runEffect);   // C17: what the rules below this module call up to it (set-pieces.js UP)
