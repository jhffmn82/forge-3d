// A field row's own limits and the strongest-only tick (consolidation C10b, chaos answer 2, effects.json field options);
// fields.js lays and pulses the rows.

import { blocks } from './statuses.js';
import { UP } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { amount } from './amount.js';

/** Off the ground: flying or levitating (moved from fields.js, C17). */
export const airborne = a => !!(a.flags?.includes('flying') || a.statuses?.levitate);

/** Still live: a row that lasts `through` its last pulse ticks on it too (a chaos patch's three pulses). */
export const alive = (r, now) => r.until === null || (r.through ? now <= r.until : now < r.until);

/** C10b: whom a row spares besides the airborne (the sporeproof, the poison-proof: the trails). */
const SPARE = { sporeproof: a => !!a.flags?.includes('sporeproof'), 'poison-immune': a => !!a.immune?.includes('poison'), 'poison-blocked': a => blocks(a, 'poison') };

/**
 * C10b (chaos answer 2, 2026-10-15; effects.json field options): perSource, at most this many live fields of the kind
 * from one source (a new one replaces the oldest); perCell, a new one takes its cells from the older ones (a trail);
 * overlap 'strongest', one tick a pulse from the strongest field covering a body; lag, no tick on the pulse it was laid;
 * through, a tick on its last pulse too; clearedBy, what washes it (chaos 64); spare, whom it leaves alone; known, its
 * cells seen once (a trail drawn and warned of); cause, the death's name once its source is gone; tell, the hero's line.
 */
export function fieldLimits(state, e, row, owner) {
  const f = state.floor;
  if (e.perSource && row.owner) { const mine = f.fields.filter(x => x.kind === e.field && x.owner === row.owner); while (mine.length >= e.perSource) f.fields.splice(f.fields.indexOf(mine.shift()), 1); }
  if (e.perCell) {
    for (const x of f.fields) if (x.kind === e.field) x.cells = x.cells.filter(k => !row.cells.includes(k));
    f.fields = f.fields.filter(x => x.kind !== e.field || x.cells.length);
  }
  if (e.overlap === 'strongest') {
    row.overlap = 'strongest';
    const hit = row.each.find(x => x.verb === 'damage');
    row.strength = hit ? amount(hit.amount, { state, owner, target: null }) : 0;
  }
  if (e.lag) row.born = state.now;
  if (e.through) row.through = true;
  if (e.clearedBy) row.clearedBy = e.clearedBy;
  if (e.spare) row.spare = e.spare;
  if (e.cause) row.cause = e.cause;
  if (e.tell) row.tell = e.tell;
  if (e.known) { row.known = row.cells.some(k => !!state.vis?.[k]); f.fieldNow = state.now; }
}

/** Does row r reach body a this pulse (airborne over the ground, its side, its lag, whom it spares)? */
export function reaches(state, r, a) {
  if (r.grounded && airborne(a)) return false;
  if (r.side === 'foes' && a.side !== 'foe') return false;
  if (r.side === 'party' && a.side !== 'player' && a.side !== 'ally') return false;   // C10b: the chaos patches and plague trail
  if ((r.side === 'allies' || r.side === 'player-and-allies') && a.side === 'foe') return false;
  if (r.born !== undefined && r.born >= state.now) return false;
  return !(r.spare ?? []).some(x => SPARE[x]?.(a));
}

/**
 * C10b, chaos 63 (chaos answer 2): the fields that tick only their strongest. Per body and kind, the strongest covering
 * row's damage lands (its source, or none and its cause once the source is gone); a status any covering row gives after
 * its blow lands at the longest turns among them, only if the blow took HP.
 */
export function strongestPulse(state, rows, bodies, events) {
  const f = state.floor;
  for (const a of bodies) {
    const kinds = new Map();
    for (const r of rows) if (a.hp > 0 && r.cells.includes(a.y * f.w + a.x) && reaches(state, r, a)) kinds.set(r.kind, [...(kinds.get(r.kind) ?? []), r]);
    for (const on of kinds.values()) {
      const best = on.reduce((m, r) => (r.strength > m.strength ? r : m)), owner = state.actors[best.owner] ?? null, gone = !(owner?.hp > 0);
      const c = { state, owner: owner ?? a, target: a, source: gone && best.cause ? null : owner, events, field: best };
      const longest = {};
      for (const r of on) for (const e of r.each) for (const s of e.then ?? []) if (s.verb === 'apply-status' && !(longest[s.status]?.turns >= s.turns)) longest[s.status] = s;
      const hp = a.hp;
      for (const e of best.each) { if (a.hp <= 0) break; runEffect({ ...e, then: undefined, cause: gone ? best.cause : undefined }, c); }
      const dealt = hp - Math.max(0, a.hp);
      if (dealt > 0 && a.hp > 0) for (const s of Object.values(longest)) runEffect(s, { ...c, owner: null });
      if (dealt > 0 && best.tell && a.side === 'player') events.push({ type: 'log', words: `${best.tell}: ${dealt} poison damage.` });
    }
  }
}
