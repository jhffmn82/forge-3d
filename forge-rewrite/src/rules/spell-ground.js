// Ground a spell or a prayer marks (E13, E10; moved from fields.js, consolidation C10b): the rank 6 grounds by element
// and holy ground's heal, burn and heal bonus. The fields themselves are fields.js's.

import prayers from '../../data/prayers.json' with { type: 'json' };
import { walkable } from '../data/tiles.js';
import elements from '../../data/elements.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { UP, provide } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { layField, HOLY } from './fields.js';
import { alive } from './field-options.js';

const elementRows = elements.rows, SCALE = tuning.rows['number-scale'];

/** The rank 6 grounds by element (elements.json spell-ground): fire burns, water ices, earth roots, light blesses. */
const SPELL_GROUND = { fire: 'fire', water: 'ice', earth: 'roots', light: 'holy' };

/**
 * E13 (1.7 elements.js markGround, balance-rulings.js markHolyGround): at rank 6 of its element a spell marks every
 * walkable tile it struck for 3 game turns. Fire on what is not water; holy ground keeps the spell's power.
 */
export function spellGround(state, owner, element, tiles, events, power = owner?.spellPower ?? 1) {
  const f = state.floor, kind = SPELL_GROUND[element], row = elementRows['spell-ground'];
  if (!f || !kind || !tiles?.length || (state.hero?.affinity?.[element] ?? 0) < 6) return;
  const seen = new Set(), cells = [];
  for (const t of tiles) {
    const k = t.y * f.w + t.x;
    if (t.x < 0 || t.y < 0 || t.x >= f.w || t.y >= f.h || seen.has(k) || !walkable(f, t.x, t.y)) continue;
    seen.add(k); cells.push({ x: t.x, y: t.y });
  }
  if (cells.length) layField(state, { field: kind, turns: row?.turns ?? 3, power, spellGround: true }, cells, owner, events);
}

/**
 * E13 (1.7 balance-rulings.js:47-74 holyGroundAt, holyGroundPulse): the strongest holy ground under each body, once a
 * game turn: the hero and his allies heal 2% of max HP x its power; a foe takes light, 3 + Light x power (x2 undead
 * and shadowy). Power: the spell's when a Light 6 spell laid it, the god's divine for the prayer.
 */
export function holyPulse(state, bodies, events) {
  const f = state.floor, live = f.fields.filter(r => HOLY.test(r.kind) && alive(r, state.now));
  if (!live.length) return;
  const hero = state.actors[state.playerId], light = state.hero?.affinity?.light ?? 0;
  for (const a of bodies) {
    if (a.hp <= 0) continue;
    const k = a.y * f.w + a.x;
    let best = null, power = 0;
    for (const r of live) { if (!r.cells.includes(k)) continue; const pw = r.power ?? state.actors[r.owner]?.divine ?? 1; if (pw > power) { best = r; power = pw; } }
    if (!best) continue;
    if (a.side === 'player' || a.side === 'ally') runEffect({ verb: 'heal', amount: a.maxhp * 0.02 * power, natural: true, holyGround: true }, { state, owner: a, target: a, source: a, events });
    else if (a.side === 'foe') {
      const base = Math.max(1, Math.round((3 + light) * (SCALE.numberScale ?? 1) * (SCALE.lethality ?? 1)));
      const n = Math.max(1, Math.round(base * power)) * (a.undead || a.shadowy || a.flags?.includes('undead') ? 2 : 1);
      runEffect({ verb: 'damage', type: 'light', amount: n, tags: ['periodic', 'holy-ground'] }, { state, owner: hero, target: a, source: hero, events });
    }
  }
}

/**
 * E10 (1.7 balance-rulings.js:59 holyGroundStrength, damage.js:45): the power of the strongest live holy ground under the
 * hero or an ally, 0 off it. Every heal he gets there but the ground's own is 25% more a point of power.
 */
export function holyGroundPower(state, a) {
  const f = state?.floor;
  if (!a || (a.side !== 'player' && a.side !== 'ally') || !f?.fields?.length) return 0;
  const k = a.y * f.w + a.x;
  let power = 0;
  for (const r of f.fields) if (HOLY.test(r.kind) && alive(r, state.now) && r.cells.includes(k)) power = Math.max(power, r.power ?? state.actors[r.owner]?.divine ?? 1);
  return power;
}

export const HOLY_HEAL_PCT = prayers.rows.sanctuary?.holyGround?.allyHealBonusPerPowerPct ?? 25;
provide('holyPulse', holyPulse);   // C17: what the rules below this module call up to it (set-pieces.js UP)
