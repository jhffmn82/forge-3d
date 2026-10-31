// Creature move cooldowns on the world clock (consolidation C5, engine-rules-01; spec/monsters.md M32, ruled
// 2026-10-16): a move waits game turns on the global clock, ticking whether or not its creature acts, is stunned or
// is slowed. Caverns' model, for every creature: a world-clock stamp per move under a.readyAt, which a stored floor's
// pauseClocks shifts like any other ...At stamp. The first wait (firstReady, a number or a [lo, hi] roll in game
// turns) is drawn the first time the move is asked about; cooldown is in game turns.

import tuning from '../../data/tuning.json' with { type: 'json' };
import { roll } from '../lib/rng.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;

/** Whether move m is ready for a now; draws its first wait on first asking. */
export function ready(state, a, m) {
  a.readyAt ??= {};
  if (a.readyAt[m.id] === undefined) {
    const first = Array.isArray(m.firstReady) ? roll(state.rng, m.firstReady[0], m.firstReady[1]) : (m.firstReady ?? 0);
    a.readyAt[m.id] = state.now + first * TURN;
  }
  return state.now >= a.readyAt[m.id];
}

/** Starts move m's cooldown from now (turns: a cooldown other than the row's). */
export function spend(state, a, m, turns = m.cooldown ?? 0) {
  (a.readyAt ??= {})[m.id] = state.now + turns * TURN;
}
