// The engine's events as 1.7's cues (consolidation S1, render-32): a table keyed by event type. The names, levels,
// bands and volumes are data/audio.json's; the handlers below are only the events whose cue depends on more than one
// field. Everything else plays its own `sfx` (events.plain, events.ownSfx).

import data from '../../data/audio.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import abilities from '../../data/abilities.json' with { type: 'json' };
import statuses from '../../data/statuses.json' with { type: 'json' };
import { T } from '../data/tiles.js';

const E = data.events, LEVEL = data.levels.cues, ALIAS = data.aliases.cues;
const UP_SFX = progression.rows['level-up'].sfx;
const OWN = new Set(E.ownSfx), UNPLACED = new Set(E.unplaced);

/** A cue's own level (0-1): its own, else the level of the file 1.7 played it through, else 1. */
export const sfxLevel = name => LEVEL[name] ?? LEVEL[ALIAS[name]] ?? 1;

/** A2: the gain of a sound at `from` (a tile, or tiles of which the nearest counts; none is full volume) for a hero at
 *  `here`, by spaces as movement counts them; walls and sight do not matter. */
export function distanceGain(from, here) {
  if (Array.isArray(from)) return from.length ? Math.max(...from.map(f => distanceGain(f, here))) : 1;
  if (!from || !here || typeof from.x !== 'number' || typeof here.x !== 'number') return 1;
  const d = Math.max(Math.abs(from.x - here.x), Math.abs(from.y - here.y));
  for (const [upTo, gain] of data.distanceBands.bands) if (d <= upTo) return gain;
  return 0;
}

/** FX5: the sound a landing bolt or arrow of a damage type makes. */
export const hitSfxFor = type => E.hitByType.types[type] ?? 'hit-flesh';
/** A spell's bolt as 1.7 combat.js:594 drew it: its damage type, an Earth spell's physical blow as earth. */
const boltTypeOf = row => (row?.type === 'phys' && row?.element === 'earth' ? 'earth' : row?.type ?? 'magic');

/* The events whose cue reads more than the event's own sfx. A handler returning false hands the event on to the plain
   and own-sfx tables. `x` holds the audio, the state, the cue at the event's place, and the first recorded name. */
const HANDLERS = {
  // CB31 (1.7 systems.js:64-65): a step into tall grass is the grass rustle alone (its 'ground' event); into water a
  // splash, else the stone click.
  moved(ev, x) {
    if (ev.id !== x.state.playerId || ev.trampled) return;
    const f = x.state.floor, k = ev.to && f?.w ? ev.to.y * f.w + ev.to.x : -1;
    x.audio.cue(f?.tiles?.[k] === T.WATER ? 'step-water' : 'step-stone', data.steps.stone);
  },
  attacked(ev, x) {
    const a = x.who(ev.id), t = x.who(ev.target), from = x.spot(a), at = x.spot(t);
    if (ev.spell) {
      // FX5: a spell's bolt lands in its element's sound, struck or not (1.7 boltFx); a spell makes no blow sound.
      const cast = x.casts.get(ev.id);
      if (ev.bolt || cast?.id === 'chainbolt') x.cue(hitSfxFor(boltTypeOf(cast?.row)), 1, at);
      return;
    }
    // G32 (1.7 actions-adapter.js:271-273): a shot is a bow-shot; a blow is a swing, or the creature's own -attack.
    if (ev.ranged) x.cue('bow-shot', 1, from);
    else if (a && a.side !== 'player' && a.sfx) x.cue(`${a.sfx}-attack`, 1, from);
    else x.cue('swing', 1, from);
    if (ev.parried) x.cue('parry', 1, at);
    else if (!ev.hit) x.cue('miss', 1, at);
    else if (ev.blocked) x.cue('block', 1, at);
    else if (ev.crit) x.cue('hit-crit', 1, at);
    else x.cue((t?.armour ?? 0) >= 3 ? 'hit-armor' : 'hit-flesh', 1, at);
  },
  damaged(ev, x) { if (ev.id === x.state.playerId) x.audio.cue('player-hurt'); },
  miss(ev, x) { x.cue('miss'); },   // CH12: a creature's spell or shot misses (1.7 floatText 'miss' sounds the miss)
  // RB9 (1.7 run-events.js death): the hero's death plays its cue and the music stops at once (C81).
  died(ev, x) {
    if (ev.player) { x.audio.cue('player-death'); x.audio.stopMusic(); }
    else if (!ev.quiet) x.cue(`${x.who(ev.id)?.sfx ?? 'ally'}-death`);
  },
  level(ev, x) { x.audio.cue(UP_SFX); },
  ability(ev, x) {
    x.casts.set(ev.id, { id: ev.ability, row: abilities.rows[ev.ability] });
    const name = x.first(ev.sfx ?? []); if (name) x.audio.cue(name);   // D11: the first of the row's sounds that exists
  },
  // A9, PL15: a boss's fall brings back the floor's own tune (a plane's guardian, the plane's) and its ambience.
  boss(ev, x) {
    if (ev.sfx) x.audio.cue(ev.sfx);
    if (ev.state === 'awake') { x.audio.boss = true; if (ev.music) x.audio.playMusic(ev.music); x.audio.playAmbience(null); }
    if (ev.state === 'dead') x.audio.setScene(x.state);
  },
  // FX5: a creature's bolt with no voice of its own lands in its element (1.7 boltFx); CB02: the bow at a crate, the shot
  // alone (1.7 silentHit). A bolt with its own voice plays it (events.ownSfx).
  bolt(ev, x) {
    if (!ev.sfx) { x.cue(hitSfxFor(ev.kind ?? ev.element ?? 'magic')); return; }
    if (ev.arrow) { x.cue(ev.sfx, 1, ev.from); return; }
    return false;
  },
  // A seen body crushing mushrooms has its own sound (events.plain); the hero's step through tall grass rustles.
  ground(ev, x) {
    if (ev.sfx) return false;
    if (ev.by === x.state.playerId) x.audio.cue('step-grass', data.steps.trample);
  },
  noticed(ev, x) { const a = x.who(ev.id); if (a?.sfx) x.cue(`${a.sfx}-alert`); },
  // The status row's own apply sound (Frozen plays status-freeze, Petrified earth-cast), else status-<id> (1.7 effect-adapter.js).
  status(ev, x) { if (ev.change === 'applied') x.cue(statuses.rows[ev.status]?.sfx?.apply ?? 'status-' + ev.status); },
  // A refusal with its own sound plays it (events.plain); a use refused for a reason 1.7 voiced, that reason's.
  refused(ev, x) {
    if (ev.sfx) return false;
    const name = ev.command === 'use' ? E.refusals.reasons[ev.why] : null;
    if (name) x.audio.cue(name);
  },
  // EQ11 (1.7 amulets.js:85, :275): an amulet's use sounds the sigil cue, then its own where it lands; a cursed one's
  // failure is its wrath alone (the log's sound).
  amulet(ev, x) {
    if (ev.failed) return;
    x.audio.cue('sigil-use');
    const own = E.amulets.kinds[ev.amulet];
    if (own) x.cue(own, 1, ev.at);
  },
};

/**
 * The event player for one audio: `onEvent(ev, state)` plays the event's cues; `clear()` forgets the casters' last
 * spells (a new run). `setHere` tells the audio where the hero stands, for distance.
 */
export function createEvents(audio, { soundFiles, setHere }) {
  const casts = new Map();   // FX5: each caster's last spell row, the type its bolts land in
  const spot = a => (a && typeof a.x === 'number' ? { x: a.x, y: a.y } : null);
  const first = sfx => (Array.isArray(sfx) ? (sfx.find(n => n && soundFiles(n)) ?? sfx.find(Boolean)) : sfx);
  function onEvent(ev, state) {
    const who = id => state.actors[id];
    setHere(spot(who(state.playerId)));
    const place = UNPLACED.has(ev.type) ? null : (ev.at ?? ev.to ?? spot(who(ev.id)));
    const cue = (name, volume = 1, from = place) => audio.cue(name, volume, from);
    const h = HANDLERS[ev.type];
    if (h && h(ev, { audio, state, cue, who, spot, first, casts }) !== false) return;
    const p = E.plain[ev.type];
    if (p) {
      if ((p.unless && ev[p.unless]) || (p.needsSfx && !ev.sfx)) return;
      cue(ev.sfx, p.volume ? ev.volume ?? 1 : 1);
      return;
    }
    if (OWN.has(ev.type) && ev.sfx) { const name = first(ev.sfx); if (name) cue(name, ev.volume ?? 1); }
  }
  return { onEvent, clear: () => casts.clear() };
}
