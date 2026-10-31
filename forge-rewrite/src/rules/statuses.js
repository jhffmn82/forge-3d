// Statuses on the global clock (spec/statuses.md S1-S21). Rows and their effects come from data/statuses.json.

import data from '../../data/statuses.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { amount } from './amount.js';
import { T } from '../data/tiles.js';
import { HOOKS, UP } from './set-pieces.js';

const ROWS = data.rows;
const TURN = tuning.rows.clock.unitsPerGameTurn;
const ORDER = tuning.rows.statuses.tickOrder;

/**
 * C7 (engine-rules-04): every status's `while` rows by verb, compiled once at load. A row marked `own` is read by the
 * code it names (Chill's stacked slow, Frozen's shatter) and is left out here, so no reader keeps an exclusion list.
 */
const WHILE = Object.fromEntries(Object.entries(ROWS).map(([id, r]) => { const by = {}; for (const w of r.while ?? []) if (!w.own) (by[w.verb] ??= []).push(w); return [id, by]; }));
/** A status's `while` rows of one verb (statuses.json), without the rows its own code reads. */
export const whileOf = (id, verb) => WHILE[id]?.[verb] ?? [];

/** Statuses whose rows change the hero's derived numbers while they last (derive.js statusMods: modify-stat, not the
 *  damage percents attack.js reads per blow or the hunger and regeneration terms). */
const STAT_ROWS = new Set(Object.keys(ROWS).filter(id => whileOf(id, 'modify-stat').some(w => w.stat !== 'damage-pct' && w.stat !== 'hp-regen')));
/** E2: re-derives the hero now (the heroChanged hooks: game.js applyHero; a rank's boons, faith.js). */
export function heroChangedNow(state) { for (const h of HOOKS.heroChanged) h(state); }
/** Re-derives the hero when this status on this bearer changes their numbers (add-stack calls it as stacks change). */
export function heroStatusChanged(state, bearer, id) {
  if (bearer?.side === 'player' && STAT_ROWS.has(id)) heroChangedNow(state);
}

/**
 * E24 (1.7 effect-adapter.js onApplied, onChill): passives.js listens for statuses the hero puts on a foe (Venom,
 * Petrify, Purging Flame, Radiant Roots, Chill Arc). info: {previous, turns, cause: {packet, hit} of the hit behind it}.
 */
/** Tells the listener a status (or one more stack of it) took on a foe from the hero. */
export function statusLanded(state, bearer, id, o, events, previous) {
  if (bearer?.side === 'foe' && bearer.hp > 0 && o?.source && o.source === state.playerId) for (const h of HOOKS.statusLanded) h(state, bearer, id, { previous, turns: bearer.statuses[id]?.n ?? 0, cause: o.cause ?? null }, events);
}

/**
 * E29 (1.7 effects.js:72-95 blocked): a row's cannotApplyIf. Flying or levitating bodies (the hero carried on the
 * wind too) are never rooted or webbed, a spider is never webbed, an entombed body takes no Chill, and Burning does
 * not take on a body standing in water unless it is airborne.
 */
const airborne = b => !!(b.flags?.includes('flying') || b.statuses?.levitate || (b.side === 'player' && b.windCarry));
const CANNOT = {
  airborne: (state, b) => airborne(b),
  'spider-vs-web': (state, b, id) => id === 'web' && !!b.flags?.includes('spider'),
  entombed: (state, b) => !!b.statuses?.tomb,
  'in-water-not-airborne': (state, b) => { const f = state.floor; return !!f?.tiles && !airborne(b) && f.tiles[b.y * f.w + b.x] === T.WATER; },
};
export const cannotApply = (state, bearer, id) => (ROWS[id]?.cannotApplyIf ?? []).some(k => CANNOT[k]?.(state, bearer, id));

export const statusRow = id => {
  const r = ROWS[id];
  if (!r) throw new Error('unknown status ' + id);
  return r;
};

/** CF18, F57: a buff of `turns` on the hero lasts this long under a worn Holy Symbol (cards read it too; C4, ui-10). */
export function buffTurns(hero, id, turns) {
  const hl = hero.defence?.buffLonger;
  return hl && !hl.except.includes(id) ? turns + Math.max(hl.min, Math.round(turns * hl.pct / 100)) : turns;
}

/** True when any status on the actor blocks this (act, move, melee, evasion, see-player, be-seen). */
export function blocks(actor, what) {
  for (const id of Object.keys(actor.statuses ?? {})) {
    const r = ROWS[id];
    if (!r) continue;
    const list = actor.side === 'player' && r.blocksPlayer ? r.blocksPlayer : r.blocks;
    if (list?.includes(what)) return true;
  }
  return false;
}

/**
 * Applies a status (S7-S13). Returns true when it took.
 * @param {{turns?:number, magnitude?:number, tickDamage?:number, scale?:number, source?:string, replace?:boolean}} o
 */
export function applyStatus(state, bearer, id, o, events) {
  // The Maw's extra hitboxes are not independent bodies or status bearers.
  if (bearer.kind === 'mawlimb') {
    const body = state.actors[bearer.limbOf];
    return body ? applyStatus(state, body, id, o, events) : false;
  }
  const r = statusRow(id);
  if (bearer.hp <= 0) return false;
  const perm = !!(r.permanent || o.permanent);
  let turns = o.turns ?? r.turns ?? 1;
  if (turns <= 0 && !perm) { removeStatus(state, bearer, id, events); return false; }
  // CD2 The Long Patience (gods.json modify-duration foe-statuses): what the hero puts on a foe lasts longer.
  if (bearer.side === 'foe' && o.source && o.source === state.playerId && !perm && !o.fixed) turns += state.actors?.[o.source]?.fx?.foeStatusTurns ?? 0;
  // CB09 Iron Constitution (1.7 effects.js:54): the hero's harmful statuses last half as long, at least 1 game turn.
  const ic = bearer.side === 'player' && !perm && r.tags?.includes('harmful') ? bearer.defence?.selfStatus : null;
  if (ic) turns = Math.max(ic.min, Math.round(turns * ic.mult));
  // CF18, F57 (1.7 holy.js turnPrepareHolyBuffs): a worn Holy Symbol lengthens each buff the hero gains, once.
  if (bearer.side === 'player' && !perm && !o.fixed && !r.tags?.includes('harmful')) turns = buffTurns(bearer, id, turns);
  if (bearer.boss && r.bossControl) turns = tuning.rows.statuses.bossControlDuration;
  if (r.on && !r.on.includes(bearer.side === 'player' ? 'player' : 'creature')) return false;
  if (bearer.immune?.includes(id) || bearer.statuses['imm-' + id]) return false;
  if (cannotApply(state, bearer, id)) return false;   // E29
  // E23 (1.7 effects.js:82, effect-adapter.js:55-60): Unstoppable turns away slows, roots, stuns and knockbacks, by name or tag.
  const res = bearer.side === 'player' ? bearer.defence?.resists : null;
  if (res?.length && (res.includes(id) || r.tags?.some(t => res.includes(t)))) { events.push({ type: 'log', words: `Resisted ${id === 'web' ? 'Web' : r.name}.`, cls: 'c-good' }); return false; }
  // A status that grants immunity while it lasts (Sapped: never stunned again).
  // ... or to every status of a tag (Resolve: all hard control, S14).
  if (Object.keys(bearer.statuses).some(k => ROWS[k]?.while?.some(w => w.verb === 'grant-immunity' && (w.status === id || (w.tag && r.tags?.includes(w.tag)))))) return false;
  const old = bearer.statuses[id];
  const keep = old && !o.replace && r.refresh !== 'replace' ? Math.max(old.n, turns) : turns;
  bearer.statuses[id] = { n: keep, born: state.now, magnitude: o.magnitude ?? old?.magnitude ?? (r.magnitude && typeof r.magnitude === 'object' ? amount(r.magnitude, { state, owner: state.actors?.[o.source] }) : r.magnitude) ?? null, scale: o.scale ?? old?.scale ?? 1, source: o.source ?? null, ...(o.tickDamage !== undefined ? { tickDamage: o.tickDamage } : {}), ...(perm ? { perm: true } : {}) };
  if (!old) events.push({ type: 'status', id: bearer.id, status: id, change: 'applied' });
  // Item 286 (1.7 sigil-adapter.js:73-77): a fresh status does its row's onApply (Stone Skin clears Poison and Stun, as
  // the sigil's own log says).
  if (!old) for (const e of r.onApply ?? []) UP.runEffect(e, { state, owner: bearer, target: bearer, statusId: id, events });
  // UD12 (1.7 deepmobs.js:164 inflictBleed, :169 inflictFear, sylla.js:83): a fresh Bleed floats 'bleeding' in blood red,
  // a fresh Fear put on by a creature (not the hero's own spells) 'afraid' in the dark colour.
  const word = !old && r.applyFloat;
  if (word && !(word.fromFoe && (!o.source || o.source === state.playerId))) events.push({ type: 'float', id: bearer.id, words: word.words, tone: word.tone });
  // S14: hard control on the hero leaves Resolve for the control's length + 2 game turns.
  if (bearer.side === 'player' && r.tags?.includes('hard-control')) grantResolve(state, bearer, keep + 2, events);
  heroStatusChanged(state, bearer, id);
  if (!o.quiet) statusLanded(state, bearer, id, o, events, !!old);
  return true;
}

/** S14: Resolve (immune to all hard control) for `turns` game turns; a moving knockback gives 2. */
export function grantResolve(state, hero, turns, events) {
  if (hero.side !== 'player' || !ROWS.resolve) return;
  const old = hero.statuses.resolve;
  hero.statuses.resolve = { n: Math.max(old?.n ?? 0, turns), born: state.now, magnitude: null, scale: 1, source: null };
  if (!old) events.push({ type: 'status', id: hero.id, status: 'resolve', change: 'applied' });
}

/** S14: is the hero shielded from a knockback by Resolve? */
export const resolveBlocks = a => a.side === 'player' && (!!a.statuses?.resolve || !!a.defence?.resists?.includes('knockback'));   // E23: Unstoppable too

export function removeStatus(state, bearer, id, events) {
  if (!bearer.statuses[id]) return;
  delete bearer.statuses[id];
  events.push({ type: 'status', id: bearer.id, status: id, change: 'ended' });
  heroStatusChanged(state, bearer, id);
}

/**
 * One world pulse for one bearer (S2-S6). The first tick comes at the first pulse at least one game turn
 * after the status was applied (statuses.md question 2, recommended rule, pending Justin).
 * @param {(effect:any, ctx:any)=>void} runEffect
 */
export function tickBearer(state, bearer, pulseAt, events, runEffect) {
  // Saves from before the hitbox fix may already have statuses on these limbs.
  if (bearer.kind === 'mawlimb') {
    const body = state.actors[bearer.limbOf];
    if (body?.hp > 0) for (const [id, st] of Object.entries(bearer.statuses)) body.statuses[id] ??= st;
    bearer.statuses = {};
    return;
  }
  const ids = Object.keys(bearer.statuses).sort((a, b) => rank(a) - rank(b));
  for (const id of ids) {
    const st = bearer.statuses[id];
    if (!st || pulseAt < st.born + TURN) continue;
    if (st.n <= 0 && !st.perm) { removeStatus(state, bearer, id, events); continue; }
    // E8: a timed immunity (effects.js grant-immunity) has no row; it only counts down, and goes without a word.
    if (id.startsWith('imm-') && !ROWS[id]) { if (--st.n <= 0) delete bearer.statuses[id]; continue; }
    const r = statusRow(id);
    if (r.counts === 'step') continue;
    if (bearer.statuses.tomb && id !== 'tomb') continue;   // the tomb pauses every other status (1.7 elements.js:398, effects.js:162)   // G19 Stillness counts the hero's steps (gear-use.js stillnessStep), not game turns
    for (const e of r.each ?? []) {
      runEffect(e, { state, owner: bearer, target: bearer, status: st, statusId: id, events });
      if (bearer.hp <= 0) return;
    }
    if (st.perm) continue;
    st.n -= 1;
    if (st.n <= 0) {
      removeStatus(state, bearer, id, events);
      // A status that runs out by time does what its row says on expiry (a web becomes Slow and Bleed).
      for (const e of r.onExpire ?? []) runEffect(e, { state, owner: bearer, target: bearer, status: st, statusId: id, events });
      // E42 (1.7 elements.js:402, turns.js:66): its expiry line, "Glacial Tomb ends." on the hero, "The ice around Rat shatters."
      const said = bearer.side === 'player' ? r.log?.expirePlayer : r.log?.expire;
      if (said) events.push({ type: 'log', words: said.replace('{name}', bearer.name ?? ''), cls: 'c-info', ...(r.sfx?.end ? { sfx: r.sfx.end } : {}) });
    }
  }
}

function rank(id) {
  const i = ORDER.indexOf(id);
  return i < 0 ? ORDER.length : i;
}
