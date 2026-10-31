// Set pieces register their turn here by name (rules/boss.js); the AI asks for a creature's `set`.
// A module of its own, with no imports, so the registry exists before any set piece loads.

export const SET_PIECES = {};
export function registerSetPiece(name, fn) { SET_PIECES[name] = fn; }

// Creature hooks for the biome rules (src/rules/crypt.js and siblings), called from the shared pipeline. Each list
// holds functions; a hook that has nothing to say returns undefined.
//   taken(state, target, packet, events)              -> a multiplier on a packet landing on a creature (before shields)
//   damaged(state, target, packet, dealt, events)     after a packet is committed (riders, reactions)
//   death(state, actor, by, events, tags)             -> 'spared' to stop the death there (no XP, drops or boss rewards)
//   hunt(state, a, p, {sees, dist}, events)           -> true when it took the hunting creature's action
//   act(state, a, events)                             -> true when it took the creature's whole action, awake or not (caverns.js)
//   moved(state, a, events)                           after a creature's action that left it on another tile (caverns.js: mushrooms trampled)
export const CREATURE_HOOKS = { taken: [], damaged: [], death: [], hunt: [], act: [], moved: [] };
// PROP_USES[id](state, prop, events) -> 'act' | 'refused': walking into a prop of this id uses it (game.js resolveMove).
export const PROP_USES = {};
// TILE_USES: (state, x, y, events) -> 'act' | 'refused' | undefined: walking into a tile with something lying on it
// (the Crypt's corpses) answers the bump before the step is taken; undefined lets the step go on.
export const TILE_USES = [];
// ITEM_TAKEN: (state, floorItem, events): a floor item was taken (picked up or auto-collected; pickup.js take()).
// ITEM_DROPPED: (state, floorItem, events): the hero dropped an item and it now lies on their tile (game.js 'drop').
export const ITEM_TAKEN = [];
export const ITEM_DROPPED = [];
// ITEM_PICKED: (state, floorItem, events) -> true | false | undefined: Pick up reached a floor item that is not bag loot
// (the Caverns' Sealed Lamp, caverns-rare.js): true when it did something, false when it refused; undefined lets it go in the bag.
export const ITEM_PICKED = [];
// BODY_USES: (state, body, events) -> 'act' | 'refused' | undefined: the hero bumped a neutral body (game.js resolveMove).
export const BODY_USES = [];
// PROP_BREAKS: (state, prop, events): a breakable prop was just broken (props.js breakProp), before its own loot.
export const PROP_BREAKS = [];

// C17 (engine-rules-24, 25): the hooks that were single slots or direct imports, as lists in a pinned order, so the
// low modules (moves, statuses) call up without importing the rules above them.
//   stepped(state, body, events)                       a body walked or was pushed onto its tile (moves.js moveBody): a
//                                                      trap springs (traps.js, order 10), a field takes it (fields.js, 20)
//   heroChanged(state)                                 a status that changes the hero's numbers came or went (game.js applyHero)
//   statusLanded(state, bearer, id, info, events)      a status the hero put on a foe took (passives.js)
export const HOOKS = { stepped: [], heroChanged: [], statusLanded: [] };
/** Adds fn to a hook list at its pinned order (lower first; equal orders keep the order they were added in). */
/**
 * C17: the calls a rule makes up the layers, each provided at load by the one module that owns it (effects.js runEffect,
 * death.js kill, ...), so the rules below it need not import it. A call nobody provided fails loudly. The engine loads
 * every provider (engine/game.js).
 */
export const UP = {};
export function provide(name, fn) { UP[name] = fn; }
export function hook(name, fn, order = 50) {
  const list = HOOKS[name];
  fn.order = order;
  list.splice(list.findIndex(f => f.order > order) >>> 0, 0, fn);
}
