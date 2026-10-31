// The before-world and after-world phases, in 1.7's order of play (spec/turns.md B1-B6, A1-A31).
// Each packet fills in its own phases. A phase with no handler yet is listed by `pendingPhases()`,
// so a missing phase is visible in checks rather than silently absent.

export const BEFORE = [
  ['B1', 'refresh-sight', 'B'], ['B2', 'enemy-hearing', 'F'], ['B3', 'identify-gear', 'C'],
  ['B4', 'underdark-lava-player', 'G'], ['B5', 'hunger', 'A'], ['B6', 'player-distance-field', 'F'],
];

export const AFTER = [
  ['A1', 'ghoul-emerge', 'F'], ['A2', 'fire', 'D'], ['A3', 'regeneration', 'A'], ['A4', 'explore', 'G'],
  ['A5', 'amulet-terrain', 'C'], ['A6', 'keen-eyes', 'C'], ['A7', 'smoke', 'D'], ['A8', 'item-expiry', 'C'],
  ['A9', 'tome-ward', 'D'], ['A10', 'class-recovery', 'A'], ['A11', 'element-after-action', 'D'],
  ['A12', 'combo-after-action', 'D'], ['A13', 'puzzle-hazards', 'G'], ['A14', 'melt-hoard', 'G'],
  ['A15', 'shade-hiding', 'G'], ['A16', 'crypt-corpses', 'F'], ['A17', 'morty-return', 'F'],
  ['A19', 'plane-hazards', 'G'], ['A20', 'plane-creatures', 'G'],   // A18 grave ooze is a field on the world clock (fields.js; C10f)
  ['A21', 'shock-clouds', 'F'], ['A22', 'cave-spores', 'G'], ['A24', 'maw', 'F'],   // A23 eel placement dropped: eels come with the floor (ruling 6, 2026-10-15)
  ['A25', 'vegetation-regrowth', 'G'], ['A26', 'food-recovery', 'C'], ['A27', 'underdark-lava-creatures', 'G'],
  ['A28', 'cocoon-hatch', 'F'], ['A29', 'matron-venom', 'F'], ['A30', 'fwa-planes', 'G'], ['A31', 'lich-return', 'E'],
];

/** name -> (state, ctx, events) => void. Filled by rules modules as they are built. */
const HANDLERS = {};

export function registerPhase(name, fn) {
  if (![...BEFORE, ...AFTER].some(p => p[1] === name)) throw new Error('unknown phase ' + name);
  HANDLERS[name] = fn;
}

export function runPhases(list, state, ctx, events) {
  for (const [, name] of list) {
    const fn = HANDLERS[name];
    if (fn) fn(state, ctx, events);
    if (state.actors[state.playerId].hp <= 0) return;
  }
}

export function pendingPhases() {
  return [...BEFORE, ...AFTER].filter(p => !HANDLERS[p[1]]).map(([id, name, owner]) => `${id} ${name} (${owner})`);
}
