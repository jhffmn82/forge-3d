// Seeded random streams kept inside the game state, so a save carries them (spec/turns.md T31-T39).
// mulberry32, as 1.7 uses, so recorded 1.7 dice and these streams speak the same numbers.
// Streams (turns.md question 4, recommended): a run seed, a generation stream per floor, one play stream.
// Presentation never draws from here.

/** @param {number} seed @returns {{s:number}} */
export function stream(seed) {
  return { s: seed >>> 0 };
}

/** One draw in [0, 1). Advances the stream. */
export function next(st) {
  st.s = (st.s + 0x6d2b79f5) >>> 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A whole number from lo to hi inclusive (1.7 `roll`). */
export function roll(st, lo, hi) {
  return lo + Math.floor(next(st) * (hi - lo + 1));
}

/** The floor seed after the current one (turns.md T33). */
export function nextFloorSeed(seed) {
  return (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
}

// ---- shared draws (consolidation C5, world-11, world-12): one copy of each, drawing exactly as the local copies do.

/** Fisher-Yates in place, from the end; one draw per step (roll(st, 0, i) draws the same numbers). */
export function shuffle(st, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next(st) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** A shuffled copy. */
export const shuffled = (st, a) => shuffle(st, a.slice());

/** One element, one draw. */
export const pick = (st, a) => a[Math.floor(next(st) * a.length)];

/**
 * One row by weight, one draw: a draw over the total, each row's weight taken off in turn until it falls below zero
 * ('lt', loot.js and generate.js) or to zero or below ('le', the Caverns and Underdark scenery draws); the last row
 * when rounding leaves nothing chosen.
 */
export function weighted(st, rows, weightOf = r => r.weight, { edge = 'lt' } = {}) {
  let w = next(st) * rows.reduce((s, r) => s + weightOf(r), 0);
  for (const r of rows) { w -= weightOf(r); if (edge === 'le' ? w <= 0 : w < 0) return r; }
  return rows[rows.length - 1];
}
