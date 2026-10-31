// Telegraphed blows (consolidation C5, engine-rules-02; spec/monsters.md M37): a creature marks the tiles a blow will
// land on, and the blow lands at the first world pulse at or after now + delay game turns, never inside the action
// that showed it (ruled 2026-10-16). One mark shape and one lander for every creature and boss: the owner keeps its
// pending blow in owner.telegraph, the map draws state.floor.marks, and each kind's landing is registered once.
// Words come from strings.json and colours from ui.json warningColours, by warning id.

import tuning from '../../data/tuning.json' with { type: 'json' };
import strings from '../../data/strings.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { onPulse } from './pulse-hooks.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;
const LANDERS = new Map();
const seen = (state, x, y) => !!state.vis?.[y * state.floor.w + x];

/** The log words for a warning id, with the owner's name in place of {name}. */
export const warningWords = (warning, owner) => strings.rows[warning]?.replace('{name}', owner?.name ?? '') ?? null;

/**
 * Registers how a kind lands: land(state, owner, pending, events) runs when its time comes and the owner lives.
 * Each module registers its own kinds at load.
 */
export function registerLander(kind, land) { LANDERS.set(kind, land); }

/**
 * Marks tiles for owner's blow of `kind`, landing after delayTurns game turns. say: 'always' logs the warning,
 * 'seen' only when the owner or a marked tile is in sight, false never. data rides along to the lander.
 */
export function mark(state, owner, { kind, tiles, delayTurns, warning, colour = ui.warningColours?.[warning], say = 'always', sfx = null, data = {} }, events) {
  (state.floor.marks ??= []).push({ owner: owner.id, kind, tiles, warning, ...(colour ? { colour } : {}) });
  owner.telegraph = { kind, tiles, landAt: state.now + delayTurns * TURN, shownIn: state.actions, ...data };
  const words = warningWords(warning, owner);
  if (words && (say === 'always' || (say === 'seen' && (seen(state, owner.x, owner.y) || tiles.some(t => seen(state, t.x, t.y)))))) {
    events.push({ type: 'log', words, warning: true });
  }
  events.push({ type: 'telegraph', id: owner.id, tiles, warning, ...(sfx ? { sfx } : {}) });
}

/** Takes owner's mark off the map (only its pending blow's kind when it has one: Morty's Nova ring stays) and drops the blow. */
export function clear(state, owner, events) {
  const kind = owner.telegraph?.kind;
  state.floor.marks = (state.floor.marks ?? []).filter(m => m.owner !== owner.id || (kind !== undefined && m.kind !== kind));
  owner.telegraph = null;
  events.push({ type: 'telegraph-end', id: owner.id });
}

/** The world pulse: every pending blow whose time has come lands; a dead owner's mark goes without landing. */
export function landTelegraphs(state, events) {
  for (const id of state.order.slice()) {
    const a = state.actors[id], t = a?.telegraph;
    if (!t) continue;
    if (a.hp <= 0) { clear(state, a, events); continue; }
    if (state.now < t.landAt || state.actions <= t.shownIn) continue;
    clear(state, a, events);
    LANDERS.get(t.kind)?.(state, a, t, events);
  }
}
onPulse('telegraphs', landTelegraphs);
