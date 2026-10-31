// World-pulse hooks for the Realm of Chaos and the planes (spec/chaos.md 63, 78; spec/planes.md A19, A20, A30, ruled
// onto the world pulse 2026-10-15), so the scheduler carries one call and no biome code. No imports: the registry
// exists before any rules module loads. Creature hooks (damage taken, death, hunting) are set-pieces.js CREATURE_HOOKS.

const PULSE = new Map();

/** fn(state, events) runs once on every world pulse, after the statuses and the set pieces' marks. */
export function onPulse(name, fn) { PULSE.set(name, fn); }
export function runPulseHooks(state, events) {
  if (!state.floor) return;
  for (const fn of PULSE.values()) { fn(state, events); if (state.actors[state.playerId].hp <= 0) return; }
}

const SIGHT = new Map();
/** fn(state) -> a sight radius or null: the planes' darkness and Snuffed (planes.md 121). sight.js asks before its own. */
export function onSightRadius(name, fn) { SIGHT.set(name, fn); }
export function sightRadiusHook(state) {
  for (const fn of SIGHT.values()) { const r = fn(state); if (r != null) return r; }
  return null;
}
