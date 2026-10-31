// Props in play (spec/world.md props 104-106, 115): breaking a breakable prop by walking into it, its loot, the bush,
// the powder barrel's blast (by a blow or by fire reaching it) and the fluid barrels' spills; the cleansing shrine.

import props from '../../data/props.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { next, roll } from '../lib/rng.js';
import { dealDamage, heal } from './damage.js';
import { applyStatus } from './statuses.js';
import weapons from '../../data/weapons.json' with { type: 'json' };
import { ELEMENTS, randomGear } from './loot.js';
import { spawnAround } from './pickup.js';
import { T, G } from '../data/tiles.js';
import { ignite } from './fields.js';
import { PROP_BREAKS, TILE_USES, provide, UP } from './set-pieces.js';
import { itemRow } from './items.js';
import { itemName } from './item-names.js';
import { learnItem } from './gear-use.js';
import { heroChangedNow } from './statuses.js';
import { registerPhase } from './phases.js';

const P = props.rows, REGROW = P['rule-regrowth'].timers;
// C7 (engine-rules-20): the break rules' numbers, from their props.json rows; a dropped heart or globe lasts tuning's globeLifeTurns.
const BL = P['rule-break-loot'], BUSH = P['rule-bush'], DB = P['rule-dungeon-break'];
const GLOBE_LIFE = tuning.rows['rewards-on-kill'].globeLifeTurns * tuning.rows.clock.unitsPerGameTurn;
/** Rule 104 essence: round((4-10 + floor) x 1.5). */
const breakEssence = state => Math.round((roll(state.rng, BL.essence.roll[0], BL.essence.roll[1]) + state.floorNo) * BL.essence.mult);
const at = (f, x, y) => f.props.find(p => p.x === x && p.y === y);

/** Rule 104: a breakable prop is removed with its sound, then may drop loot. Returns true when one broke. */
export function breakProp(state, x, y, events, { byFire = false, by = null } = {}) {
  const f = state.floor, p = at(f, x, y), row = p && P[p.id];
  if (!row?.breakable) return false;
  // A body that breaks it with a blow swings at it first (1.7 systems.js:191 setClip melee and a lunge; sandbox 56).
  if (by) events.push({ type: 'swung', id: by, at: { x, y } });
  f.props.splice(f.props.indexOf(p), 1);
  // RB26, RC52 (1.7 vegart.js:243 cutBushProp, systems.js:467 damageProp): a cut bush bursts in leaves (heal 14 at
  // 0.05), any other broken piece in splinters and dust (earth 12 at 0.05); a powder or fluid barrel has its own.
  const burst = row.explodes || row.fluid ? null : p.id === 'bush' ? { type: 'heal', n: 14, spread: 0.05 } : { type: 'earth', n: 12, spread: 0.05 };
  events.push({ type: 'prop-broken', at: { x, y }, id: p.id, sfx: p.breakSfx ?? row.breakSfx ?? row.sfx ?? 'crate-break', volume: p.id === 'bush' ? 0.5 : 1, ...(burst ? { burst } : {}) });
  // Sandbox 101 (Justin 2026-10-17): the broken piece leaves its debris on the tile for the rest of the floor, saved
  // with it. No dice: which pieces and where is drawn from the tile and the prop (render/debris-view.js).
  (f.debris ??= []).push({ x, y, id: p.id, ...(p.family ? { family: p.family } : {}) });   // a stack: what it was a stack of
  for (const h of PROP_BREAKS) h(state, p, events);   // biome riders (the Crypt: an urn group may let a Shade out)
  // S23: a prop holding a fixed reward (the sword in the stone) leaves it where it stood.
  if (p.breakReward) { f.items.push({ x, y, item: p.breakReward }); events.push({ type: 'drops', at: { x, y } }); }
  if (row.explodes) { explode(state, x, y, events); return true; }
  if (row.fluid) { spill(state, x, y, row.fluid, events); return true; }
  if (p.id === 'bush') {
    // RB25 (1.7 vegart.js:246 cutBushProp): a bush cut or burned grows back 150 actions later, out of sight (A25).
    (f.cutBushes ??= []).push({ x, y, at: state.actions + REGROW.bushActions });
    // Rule 115: a cut bush hides a heart or a little essence 25% of the time (fire leaves ash and nothing).
    if (byFire) { f.ground[y * f.w + x] = G.ASH; return true; }
    if (next(state.rng) < (row.lootPct ?? 0) / 100) {
      if (next(state.rng) < BUSH.heartPct / 100) { f.items.push({ x, y, item: { kind: 'heart' }, until: state.now + GLOBE_LIFE }); events.push({ type: 'log', words: 'A heart was tucked under the bush.' }); }
      else { f.items.push({ x, y, item: { kind: 'essence', n: roll(state.rng, BUSH.essence[0], BUSH.essence[1]) + state.floorNo } }); events.push({ type: 'log', words: 'Something glints among the cut leaves.' }); }
      events.push({ type: 'drops', at: { x, y } });
    }
    return true;
  }
  // Generated crates use the stack picture; their family still gets the one canonical crate loot roll (item 338).
  const lootId = p.id === 'stack-group' ? p.family ?? 'crate' : p.id;
  if (state.floorNo <= DB.lastFloor && !f.plane && (lootId === 'crate' || lootId === 'weapon-rack')) { dungeonBreak(state, lootId, x, y, events); return true; }
  // Rule 104: loot chance; r < 0.74 a further 50% nothing else essence; r < 0.78 food; else a mote.
  if (row.lootPct && next(state.rng) < row.lootPct / 100) {
    const r = next(state.rng);
    let item = null;
    if (r < BL.nothingBelow) { if (next(state.rng) < BL.nothingPct / 100) item = { kind: 'essence', n: breakEssence(state) }; }
    else if (r < BL.foodBelow) item = { id: BL.food, kind: 'food', tier: 0, plus: 0, count: 1 };
    else item = { kind: 'mote', el: ELEMENTS[Math.floor(next(state.rng) * ELEMENTS.length)] };
    if (item) { f.items.push({ x, y, item }); events.push({ type: 'log', words: 'Something rolls out of the pieces.' }, { type: 'drops', at: { x, y } }); }
  }
  return true;
}

/**
 * Dungeon crates and weapon racks (Justin 2026-10-16, sandbox item 9: "breaking creates in the first biome give a
 * change to drop a heart, mana orb, essence crystal or slime", racks the same "and a small chance 10% of dropping a
 * weapon"). Crate: lootPct, then heart 30 / globe 30 / essence 30 / slime 10. Rack: weapon 10%, else lootPct split
 * evenly among heart, globe and essence.
 */
function dungeonBreak(state, id, x, y, events) {
  const f = state.floor, rng = state.rng, drop = item => { f.items.push({ x, y, ...item }); events.push({ type: 'drops', at: { x, y } }); };
  if (id === 'weapon-rack' && next(rng) < DB.rackWeaponPct / 100) {
    const kinds = Object.keys(weapons.rows).filter(k => weapons.rows[k].kind === 'weapon' && weapons.rows[k].drops !== false && !/^fists/.test(k));   // never a god's bare fists
    drop({ item: randomGear(state, state.floorNo, { item: kinds[Math.floor(next(rng) * kinds.length)] }) });
    events.push({ type: 'log', words: 'A weapon clatters out of the broken rack.' });
    return;
  }
  if (next(rng) < (P[id].lootPct ?? 0) / 100) {
    const r = next(rng) * (id === 'crate' ? 1 : DB.rackScale);
    if (r < DB.heartBelow) drop({ item: { kind: 'heart' }, until: state.now + GLOBE_LIFE });
    else if (r < DB.globeBelow) drop({ item: { kind: 'globe' }, until: state.now + GLOBE_LIFE });
    else if (r < DB.essenceBelow) drop({ item: { kind: 'essence', n: breakEssence(state) } });
    else { spawnAround(state, ['slime'], { x, y }, events); events.push({ type: 'log', words: 'A slime oozes out of the broken crate!' }); return; }
    events.push({ type: 'log', words: 'Something rolls out of the pieces.' });
  }
}

/** Rule 105: the powder barrel: fire 8-14 + floor and Burn 3 on every body in the 3 by 3; neighbouring barrels go too. */
function explode(state, x, y, events) {
  const f = state.floor;
  events.push({ type: 'log', words: 'BOOM! The powder barrel explodes.' }, { type: 'explosion', at: { x, y }, sfx: 'explosion' });
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = x + dx, cy = y + dy;
    for (const id of state.order) {
      const b = state.actors[id];
      if (b.hp <= 0 || b.x !== cx || b.y !== cy) continue;
      dealDamage(state, { target: b, source: null, amount: roll(state.rng, 8, 14) + state.floorNo, type: 'fire', cause: 'explosion' }, events);
      if (b.hp > 0) applyStatus(state, b, 'burn', { turns: 3, magnitude: 2 }, events);
    }
    const q = at(f, cx, cy);
    if (q && P[q.id]?.explodes) breakProp(state, cx, cy, events);
    else if (q && (P[q.id]?.breakable || P[q.id]?.burnable)) {
      f.props.splice(f.props.indexOf(q), 1); f.ground[cy * f.w + cx] = G.ASH;
      (f.debris ??= []).push({ x: cx, y: cy, id: q.id, ...(q.family ? { family: q.family } : {}), burnt: true });   // sandbox 101: a blown pot leaves shards (burnt wood leaves only the ash)
      if (q.breakReward) { f.items.push({ x: cx, y: cy, item: q.breakReward }); events.push({ type: 'drops', at: { x: cx, y: cy } }); }   // 1.7 removeProp
    }
    else if (f.tiles[cy * f.w + cx] === T.FLOOR && !f.ground[cy * f.w + cx]) f.ground[cy * f.w + cx] = G.SCORCH;
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ignite(state, x + dx, y + dy, false);   // rule 105: every tile in the 3 by 3 tries to catch (fields.js)
  blowLitBarrels(state, events);
}

/**
 * CB46 (1.7 systems.js burnWorld: `if(p && p.ex) deferScene(... explode ...)`): fire reaching a powder barrel blows it.
 * ignite (fields.js) marks the barrel; the blast goes off here, from whichever rule with events lit it (a fire field,
 * the spread, a blast's own 3 by 3, the world pulse for the rest), as long as the barrel is still standing.
 */
export function blowLitBarrels(state, events) {
  const f = state.floor;
  for (let guard = 0; f?.lit?.length && guard < 64; guard++) {
    const { x, y } = f.lit.shift(), q = at(f, x, y);
    if (q && P[q.id]?.explodes) breakProp(state, x, y, events, { byFire: true });
  }
  if (f?.lit && !f.lit.length) delete f.lit;
}

/**
 * CB38 (1.7 systems.js:318 bumpProp cleansingShrine, inventory-adapter.js cleanseCarriedCurses, inventory.js cleanse):
 * walking into the cleansing shrine breaks the curse on every carried and worn item, once: each is uncursed and
 * identified, its plus no lower than 0 (a ring's back to 0). It costs the action; spent, it only says so.
 */
TILE_USES.push((state, x, y, events) => {
  const shrine = state.floor.props.find(q => q.x === x && q.y === y && q.cleansingShrine);
  if (!shrine) return undefined;
  if (shrine.used) { events.push({ type: 'log', words: 'The cleansing shrine has spent its blessing.' }); return 'refused'; }
  const h = state.hero, gear = new Set([...Object.values(h?.worn ?? {}), ...(h?.bag ?? [])].filter(Boolean));
  let count = 0;
  for (const it of gear) {
    if (it.kind === 'sigil' || !(it.cursed || (it.plus ?? 0) < 0)) continue;
    const ring = itemRow(it.id)?.kind === 'ring';
    it.cursed = false; it.plus = ring ? 0 : Math.max(0, it.plus ?? 0); learnItem(state, it);
    events.push({ type: 'log', words: `The curse on your ${itemName(it, state)} breaks.`, sfx: 'puzzle-solved' });
    count++;
  }
  if (count) {
    shrine.used = true;
    heroChangedNow(state);
    events.push({ type: 'log', words: `The shrine removes all ${count} item curse${count === 1 ? '' : 's'}.` }, { type: 'hero', change: 'cleanse' });
  } else events.push({ type: 'log', words: 'None of your carried or equipped items are cursed.' });
  return 'act';
});

/**
 * CB37 (1.7 systems.js:362 bumpProp p.drink): walking into a fountain drinks from it once, +10% of max HP (the hero's
 * heal multipliers apply), 'Fountain: +N HP.' and the water sound; an action. Drunk dry, it is only in the way.
 */
TILE_USES.push((state, x, y, events) => {
  const q = at(state.floor, x, y);
  if (!q || !P[q.id]?.drinkable || q.drunk) return undefined;
  const p = state.actors[state.playerId];
  q.drunk = true;
  // E11: the fountain stanches a bleed. E14 (1.7 systems.js:362 healPlayer): what does not fit is overheal (Holy Water).
  const n = heal(state, p, Math.round(p.maxhp * P[q.id].healPct / 100), events);
  events.push({ type: 'log', words: `Fountain: +${n} HP.`, cls: 'c-good', sfx: 'step-water' });
  return 'act';
});

/** Rule 106: a water barrel floods its 3 by 3; poison uses its declared room-pool effect. */
function spill(state, x, y, fluid, events) {
  const f = state.floor;
  if (fluid === 'water') {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (f.tiles[(y + dy) * f.w + x + dx] === T.FLOOR && !at(f, x + dx, y + dy)) { f.tiles[(y + dy) * f.w + x + dx] = T.WATER; f.ground[(y + dy) * f.w + x + dx] = 0; }
    events.push({ type: 'log', words: 'The barrel spills a water pool.' }, { type: 'ground', at: { x, y } });
  } else {
    const owner = state.actors[state.playerId], target = { x, y };
    for (const e of P['barrel-poison'].onBreak ?? []) UP.runEffect(e, { state, owner, target, tile: target, events });
    events.push({ type: 'log', words: 'The barrel spills a poison pool.' }, { type: 'ground', at: target });
  }
}

/**
 * RB25, A25 (1.7 vegart.js:258-292 vegRegrowTick; Justin 2026-09-19: the food clock stops anyone farming it forever):
 * cut bushes grow back, trampled tall grass stands up again and burned ground greens over, only where the hero cannot
 * see it happen and never under a body or an item. Bushes come back when due; grass is looked at every 10 actions,
 * each tile that was grass when the floor was first played noting when it changed: trampled grass stands after 100
 * actions, burned ground comes back short after 200 (and tall after 100 more).
 */
const vegFloor = f => (f.plane ? f.plane === 'earth' : f.biome !== 'chaos');
registerPhase('vegetation-regrowth', (state, ctx, events) => {
  const f = state.floor, p = state.actors[state.playerId];
  if (!f?.ground || !p || !vegFloor(f)) return;
  if (!f.vegOrig) {
    const o = {};
    for (let i = 0; i < f.ground.length; i++) if (f.ground[i] === G.GRASS) o[i] = 'G'; else if (f.ground[i] === G.SHORT) o[i] = 's';
    f.vegOrig = o; f.vegSeen = {};
  }
  const hidden = (x, y) => !state.vis?.[y * f.w + x] && !(p.x === x && p.y === y) && !f.items?.some(i => i.x === x && i.y === y)
    && !state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && a.x === x && a.y === y; });
  let grew = null;
  if (f.cutBushes?.length) {
    f.cutBushes = f.cutBushes.filter(r => {
      if (state.actions < r.at || !hidden(r.x, r.y) || at(f, r.x, r.y) || f.tiles[r.y * f.w + r.x] !== T.FLOOR) return true;   // try again later
      f.props.push({ id: 'bush', x: r.x, y: r.y });
      grew ??= { x: r.x, y: r.y };
      return false;
    });
    if (grew) events.push({ type: 'terrain', what: 'regrowth', at: grew });   // the bush is drawn again (map.setStructures)
  }
  if (state.actions % 10) return;
  const O = f.vegOrig, S = (f.vegSeen ??= {});
  let green = null;
  for (const k in O) {
    const i = +k, g = f.ground[i], want = O[k], x = i % f.w, y = (i / f.w) | 0;
    const ok = (want === 'G' && g === G.SHORT) || (g === G.ASH || g === G.SCORCH || !g);
    if (!ok || f.tiles[i] !== T.FLOOR || at(f, x, y)) { delete S[k]; continue; }
    if (S[k] === undefined) { S[k] = state.actions; continue; }
    const wait = g === G.ASH || g === G.SCORCH ? REGROW.burntActions : REGROW.trampledTallActions;
    if (state.actions - S[k] < wait || !hidden(x, y)) continue;
    f.ground[i] = g === G.SHORT || want === 's' ? (want === 'G' ? G.GRASS : G.SHORT) : G.SHORT;   // burned ground comes back short first
    S[k] = state.actions;
    green ??= { x, y };
  }
  if (green) events.push({ type: 'ground', at: green });
});
provide('breakProp', breakProp); provide('blowLitBarrels', blowLitBarrels);   // C17: what the rules below this module call up to it (set-pieces.js UP)
