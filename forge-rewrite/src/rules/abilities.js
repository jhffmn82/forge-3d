// Using an ability from the bar (spec/magic.md D1-D19, D12-D14): refusals, mana cost, range and aim, paying,
// cooldowns on the game clock, and running the ability's effect list. Rows: abilities.json; a Cleric's invoke is a
// prayers.json row (D13). Element spells (D20-D32) run through the same path as their rows land.

import { heroEvent } from './passives.js';
import { manaPiety } from './faith.js';
import abilities from '../../data/abilities.json' with { type: 'json' };
import prayers from '../../data/prayers.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import races from '../../data/races.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { UP } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { lanePath, ridgeTiles, selectorTiles, struckShape } from './effects/select.js';
import { walkable, opaque, tileAt, T, G } from '../data/tiles.js';
import { lineClear, refreshSight } from './sight.js';
import { ignite } from './fields.js';
import { spellGround } from './spell-ground.js';
import { breakProp } from './props.js';
import propData from '../../data/props.json' with { type: 'json' };
import { blocks, removeStatus, whileOf } from './statuses.js';
import { itemName } from './item-names.js';
import { recycleValue } from './sigils.js'; import { nearFree, free } from './space.js';
import { next } from '../lib/rng.js';
import { realmAllows } from './crucible.js';
import { itemRow, value } from './items.js';

const A = abilities.rows, SCALE = tuning.rows['number-scale'];

/**
 * E7 (1.7 casting-adapter.js:20, :33, :35, :66-67): an invoke's log line with its numbers filled in: {n} the HP the
 * hero got back (Bellow, Heal) or the turns Hidden (Into the Dark), {pct} the next hit's bonus (left out at 0, as
 * 1.7 leaves it out at rank 0), {weapon} the weapon in the main hand; a prayer's {n} is its pool (Mana Ward) or its
 * summons (The Brood), {form} the servant risen (Raise Dead).
 */
function fillLog(words, state, p, row, healed, shared = {}) {
  const h = state.hero, hid = (row.effects ?? []).some(e => e.verb === 'hide');
  const pct = Math.round(p.statuses['into-the-dark']?.magnitude ?? 0);
  if (!pct) words = words.replace(/; next hit \+\{pct\}%/, '');
  const n = hid ? p.statuses.hidden?.n ?? 0 : shared.shield ?? shared.summoned ?? healed;
  if (n === 1) words = words.replace('{n} spiderlings scuttle', 'A spiderling scuttles');   // 1.7 sylla.js prayTheBrood
  return words.replace(/<\/?b>/g, '')
    .replace('{form}', shared.form ?? '')
    .replace('{n}', String(n)).replace('{pct}', String(pct))
    .replace('{weapon}', h.worn?.main ? itemName(h.worn.main, state) : 'Fists');
}
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** The row for an ability id: abilities.json, else the god's invoke in prayers.json. */
export function abilityRow(id) {
  return A[id] && A[id].kind !== 'rule' ? A[id] : prayers.rows[id] ?? Object.values(prayers.rows).find(p => p.ability === id) ?? null;
}

const isSpell = row => row.kind === 'spell';
/** C13: what a cast tells the scheduler: a spell's own time (G4) and, aimed off the hero, a noisy act (E31 Lightning Reflexes). */
export const abilityTurn = row => ({ attack: isSpell(row) && !row.tech ? { cast: true } : null, loud: (row.aim?.kind ?? 'self') !== 'self' });
/** 1.7 entityOccupies: (x, y) lies in a body's footprint (a big body is size by size from its corner). */
const occupies = (a, x, y) => { const n = a.size ?? 1; return x >= a.x && y >= a.y && x < a.x + n && y < a.y + n; };
/** The cells a cone or beam ability covers from the hero toward the aim (the effects' own selectors), else null. */
const areaOf = (state, p, row, tile, range) => {
  const sel = (row.effects ?? []).map(e => e.target).find(t => t?.selector === 'cone' || t?.selector === 'beam');
  return sel && tile ? selectorTiles(state, sel, { owner: p, at: tile, len: range }) : null;
};
const swings = effects => (effects ?? []).some(e => e.verb === 'weapon-attack' || swings(e.then) || (e.options ?? []).some(o => swings(o.effects)));
/**
 * D11, E34: the clip the hero plays as he uses it (1.7 setClip: elements.js:178, casting-adapter.js:73, :207,
 * combat.js:594, gods.js:552). A row's own heroClip says (the Bellow's swing that names no weapon); one that swings
 * the weapon plays nothing here, since its blows play their own swings; anything else plays the cast.
 */
const heroClip = row => row.heroClip ? { clip: row.heroClip.name, straight: !!row.heroClip.straight } : swings(row.effects) ? { clip: null } : { clip: 'cast' };
const staffHeld = hero => hero.worn?.main?.id === 'staff';

/** D2: mana cost; the Elf's 0.85 and a wand's thrift only for spells. */
export function manaCost(hero, row) {
  let c = row.mana ?? 0;
  if (isSpell(row)) {
    for (const e of races.rows[hero.race]?.passive ?? []) if (e.verb === 'cost-mod' && e.cost === 'mana' && e.for === 'spells') c *= e.mult;   // C16: the race's row (an Elf's 0.85)
    // CB12 (1.7 combat.js:65 wandThrift): a wand in the main hand takes 15% off (20% at the top tier), + 3% a plus;
    // a cursed one adds its tier number + 3% x the size of the curse instead (I15, value's penalty shape).
    const w = hero.worn?.main;
    if (w?.id === 'wand') c *= 1 - value(itemRow('wand').row.values.manaCostMult, w, hero) / 100;
  }
  return c > 0 ? Math.max(A['cost-rule'].min, Math.round(c * (SCALE.numberScale ?? 1))) : 0;
}

/** The race's range bonus (races.json passive: an Elf's +1); the bow card reads it too (C4, ui-11). */
export const raceRangeBonus = hero => (races.rows[hero?.race]?.passive ?? []).filter(e => e.stat === 'range' || e.verb === 'range-bonus').reduce((s, e) => s + (e.add ?? 0), 0);
/** D3: the aim range: spells add the race bonus and +1 with a staff; techniques the race bonus; fixed as written. */
export function aimRange(hero, row) {
  const aim = row.aim ?? {}, base = aim.range ?? 0, raceBonus = raceRangeBonus(hero);
  if (aim.rangeRule === 'fixed') return base;
  if (aim.rangeRule === 'spell') return base + raceBonus + (staffHeld(hero) ? 1 : 0);
  return base + raceBonus;
}

/** A bolt ability: its strike is a spell-strike with bolt (Magic Missile, Sap, the rank 2 bolts). */
const isBolt = row => (row.effects ?? []).some(e => e.verb === 'spell-strike' && e.bolt);
const PROPS = propData.rows;
/**
 * CB25 (1.7 combat.js:587-604 castBoltTarget; magic.md D5): a bolt aimed at a tile with no foe flies along its line and
 * stops at the first body, wall, tall grass or blocking prop. With no foe there it may still act on the world: fire
 * lights what burns (and melts an ice door, burns thorns away), ice freezes water, any bolt breaks a breakable prop.
 * Returns {end, foe} for a foe it meets, {end, world} when the world takes it, else {words} and nothing is spent.
 */
function boltAtWorld(state, p, row, tile) {
  const f = state.floor, dx = Math.abs(tile.x - p.x), dy = Math.abs(tile.y - p.y), sx = p.x < tile.x ? 1 : -1, sy = p.y < tile.y ? 1 : -1;
  let x = p.x, y = p.y, err = dx - dy, end = null, body = null;
  const propAt = (x, y) => f.props?.find(q => q.x === x && q.y === y) ?? null;
  for (let guard = 0; guard < 64 && (x !== tile.x || y !== tile.y); guard++) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
    end = { x, y };
    // G43: a Tiny body short of the aimed tile is flown past (1.7 projectileBlocker).
    body = state.order.map(i => state.actors[i]).find(a => a.hp > 0 && a !== p && x >= a.x && y >= a.y && x < a.x + (a.size ?? 1) && y < a.y + (a.size ?? 1) && (x === tile.x && y === tile.y || !(a.flags ?? []).includes('tiny'))) ?? null;
    const q = propAt(x, y);
    if (body || opaque(f, x, y) || (q && (q.blocks || PROPS[q.id]?.blocks))) break;
  }
  if (!end) return { words: 'Nothing to hit there.' };
  if (body?.side === 'foe') return { end, foe: body };
  const far = end.x !== tile.x || end.y !== tile.y;
  if (body) return { words: 'Something is in the way.' };
  const t0 = tileAt(f, end.x, end.y), q = propAt(end.x, end.y), g = f.ground?.[end.y * f.w + end.x], type = row.type ?? 'magic';
  const breaks = !!q && !!PROPS[q.id]?.breakable && !q.hoard;
  const burns = type === 'fire' && (t0 === T.ICE_DOOR || t0 === T.THORNS || g === G.GRASS || g === G.SHORT || g === G.WEB || (!!q && (!!(q.burnable ?? PROPS[q.id]?.burnable) || /web/.test(q.id))));
  const freezes = type === 'ice' && t0 === T.WATER && g !== G.ICE;
  if (!breaks && !burns && !freezes) return { words: far ? 'Something is in the way.' : 'Nothing to hit there.' };
  return { end, world: { breaks, burns, freezes } };
}

/** CB25: the bolt's work on the world where it stopped (1.7 combat.js:600-604, systems.js burnWorld). */
function strikeWorld(state, p, row, hit, events) {
  const f = state.floor, { x, y } = hit.end, k = y * f.w + x, t0 = tileAt(f, x, y);
  const type = row.type ?? 'magic';
  events.push({ type: 'bolt', from: { x: p.x, y: p.y }, to: { x, y }, kind: type === 'phys' && row.element === 'earth' ? 'earth' : type });
  if (hit.world.burns) {
    ignite(state, x, y, true, t0 === T.THORNS ? 3 : 0, events);   // CF16: Sylla refuses it
    if (t0 === T.ICE_DOOR) { f.tiles[k] = T.OPEN_DOOR; events.push({ type: 'log', words: 'The ice sealing the door melts away in a cloud of steam.', sfx: 'ice-melt' }); }
    if (t0 === T.THORNS) { f.tiles[k] = T.OPEN_DOOR; events.push({ type: 'log', words: 'The thorns catch and burn away.', sfx: 'thorns-burn' }); }
    if (t0 === T.ICE_DOOR || t0 === T.THORNS) refreshSight(state, events);
  }
  if (hit.world.freezes) { f.ground[k] = G.ICE; events.push({ type: 'ground', at: { x, y }, ground: G.ICE }); }
  if (hit.world.breaks) breakProp(state, x, y, events, { byFire: type === 'fire' });
}

function spellProps(state, row, tiles, events) {
  const f = state.floor, done = new Set();
  for (const { x, y } of tiles) {
    const k = y * f.w + x;
    if (done.has(k)) continue;
    done.add(k);
    const q = f.props?.find(o => o.x === x && o.y === y);
    if (q && PROPS[q.id]?.breakable && !q.hoard) breakProp(state, x, y, events, { byFire: (row.type ?? 'magic') === 'fire' });
  }
}

const foesInSight = (state, p, range) => state.order.map(id => state.actors[id])
  .filter(a => a.hp > 0 && a.side === 'foe' && cheb(a, p) <= range && state.vis?.[a.y * state.floor.w + a.x] && lineClear(state.floor, p, a))
  .sort((a, b) => cheb(a, p) - cheb(b, p));

/**
 * D1: uses an ability. `at` is the aimed tile; with none, a foe-aimed ability auto-aims at the nearest foe in range.
 * Returns 'act', 'free' (instant: no time) or a refusal string.
 */
export function useAbility(state, id, at, events, opts = {}) {
  const h = state.hero, p = state.actors[state.playerId];
  // D13: the Cleric's first slot is the god's invoke; with no god the slot is empty.
  const invoke = id === 'invoke';
  if (invoke) id = gods.rows[h.faith?.god]?.invoke ?? null;
  const row = opts.prayer ?? (id && abilityRow(id));
  const say = w => events.push({ type: 'log', words: w });
  if (!row) return invoke ? 'no-god' : 'unknown-ability';
  const known = opts.prayer ? true : invoke ? h.abilities.includes('invoke') : h.abilities.includes(id);
  if (!known) return 'not-known';
  if (p.statuses.fear) { say('You are too afraid.'); return 'feared'; }
  // F17: a god forbids spells of its forbidden element; Grumbok any spell that is not a technique or an invoke.
  const god = h.faith?.god && gods.rows[h.faith.god];
  if (god && isSpell(row) && (god.forbiddenElements?.includes(row.element) || (god.conduct?.noSpells && !row.tech))) { say(`${god.name.split(',')[0]} will not allow that.`); return 'forbidden'; }
  const cds = opts.prayer ? (h.faith.cooldowns ??= {}) : (h.cooldowns ??= {});   // a prayer's wait is kept with the faith
  if ((cds[id] ?? 0) > 0) { say(`${row.name} is not ready (${Math.ceil(cds[id])}).`); return 'cooldown'; }
  const cost = manaCost(h, row);
  if (p.mana < cost) { say(`Not enough mana for ${row.name}.`); return 'no-mana'; }
  // Aim (D3): a foe within range and in sight, or the hero's own tile for self abilities.
  const aim = row.aim ?? { kind: 'self' }, range = aimRange(h, row);
  let target = null, tile = at ?? null, world = null;
  const W = state.floor.w, seenTile = t => !!state.vis?.[t.y * W + t.x];
  const bodyAt = t => state.order.map(i => state.actors[i]).find(a => a.hp > 0 && a.x === t.x && a.y === t.y) ?? null;
  // Item 287: Lance and Bone Spear aimed at a tile out of sight are refused here, not only by the HUD (prayers.json aim needsSight).
  if (aim.needsSight && tile && !seenTile(tile)) { say('You cannot see that tile.'); return 'unseen'; }
  if (aim.kind === 'foe-or-self' && tile && tile.x === p.x && tile.y === p.y) target = p;   // Glacial Tomb on the hero
  else if (['visible-tile', 'direction', 'empty-tile', 'tile'].includes(aim.kind)) {
    // A tile aim: given, or the nearest foe's tile in range when none is (1.7's aim mode picks it first).
    if (!tile) { const f = foesInSight(state, p, range)[0]; if (!f) { say('No target in range.'); return 'no-target'; } tile = { x: f.x, y: f.y }; }
    if (aim.kind === 'direction' && tile.x === p.x && tile.y === p.y) { say('Aim away from yourself.'); return 'no-target'; }
    if (aim.kind !== 'direction' && cheb(tile, p) > range) { say('Out of range.'); return 'out-of-range'; }
    if (aim.kind !== 'direction' && !seenTile(tile)) { say('You cannot see that tile.'); return 'unseen'; }
    if (aim.kind === 'empty-tile' && (!walkable(state.floor, tile.x, tile.y) || bodyAt(tile))) { say('That tile is not empty.'); return 'not-empty'; }
    if (aim.kind === 'empty-tile' && !realmAllows(state, p, tile.x, tile.y)) { say('The way is sealed.'); return 'sealed'; }   // CH28 (1.7 unmaker-preview.js destinationAllowed)
    const b = bodyAt(tile);
    target = b && b.side === 'foe' ? b : null;
  } else if (aim.kind === 'explored-tile') {
    if (!tile) { say('Choose an explored tile.'); return 'no-target'; }
    if (!state.seen?.[tile.y * W + tile.x] && !seenTile(tile)) { say('You have not explored there.'); return 'unexplored'; }
    if (!walkable(state.floor, tile.x, tile.y) || bodyAt(tile)) { say('That tile is not empty.'); return 'not-empty'; }
    if (!realmAllows(state, p, tile.x, tile.y)) { say('The way is sealed.'); return 'sealed'; }   // CH28
    if (state.order.some(i => { const a = state.actors[i]; return a.hp > 0 && a.side === 'foe' && cheb(a, tile) <= 1; })) { say('A foe stands beside that tile.'); return 'foe-beside'; }
  } else if (aim.kind === 'foe' || aim.kind === 'foe-or-empty-tile' || aim.kind === 'foe-or-self' || aim.kind === 'foe-or-breakable-prop') {
    // AA1: any cell of a big body's footprint aims at it (1.7 entityOccupies; the HUD's auto-aim takes its nearest cell).
    if (tile) {
      target = state.order.map(i => state.actors[i]).find(a => a.hp > 0 && a.side === 'foe' && occupies(a, tile.x, tile.y)) ?? null;
      // CB25: a bolt at a tile with no foe: what its line meets (1.7 inRange first: distance, then sight).
      if (!target && aim.kind === 'foe' && isBolt(row)) {
        if (cheb(tile, p) > range) { say('Out of range.'); return 'out-of-range'; }
        if (!seenTile(tile)) { say('You cannot see that tile.'); return 'unseen'; }
        const hit = boltAtWorld(state, p, row, tile);
        if (hit.words) { say(hit.words); return 'no-target'; }
        if (hit.foe) target = hit.foe; else { world = hit; tile = hit.end; }
      }
      // E49 (1.7 elements.js:333-337): Chain Lightning aimed where no foe stands strikes a breakable prop its line ends on.
      if (!target && aim.kind === 'foe-or-breakable-prop') {
        if (cheb(tile, p) > range) { say('Out of range.'); return 'out-of-range'; }
        if (!seenTile(tile)) { say('You cannot see that tile.'); return 'unseen'; }
        const hit = boltAtWorld(state, p, row, tile);
        if (hit.foe) target = hit.foe;
        else if (hit.world?.breaks) { world = { end: hit.end, world: { breaks: true } }; tile = hit.end; }
        else { say('Nothing to hit there.'); return 'no-target'; }
      }
    } else {
      // Double Strike follows the foe last attacked (charged foes included), else the nearest.
      const seen = foesInSight(state, p, range), last = seen.find(a => a.id === h.lastAttacked);
      target = last ?? seen[0] ?? null;
    }
    if (!target && !world && aim.kind !== 'foe-or-empty-tile') { say(row.noTargetWords ?? 'No target in range.'); return 'no-target'; }
    const cell = target && tile && occupies(target, tile.x, tile.y) ? tile : target;   // the aimed cell of its body
    if (target && cheb(cell, p) > range) { say('Out of range.'); return 'out-of-range'; }
    if (target && !state.vis?.[cell.y * state.floor.w + cell.x]) { say('You cannot see that tile.'); return 'unseen'; }
    tile = target ? { x: target.x, y: target.y } : tile;
    if (!tile) { say('No target in range.'); return 'no-target'; }
  }
  // D16: Charge runs a clear straight lane, to a foe within 6 or onto empty ground within 5.
  if (aim.lane) {
    const ground = !target;
    if (ground && (!walkable(state.floor, tile.x, tile.y) || state.order.some(i => { const a = state.actors[i]; return a.hp > 0 && a.x === tile.x && a.y === tile.y; }) || (tile.x === p.x && tile.y === p.y))) { say('Charge at an enemy or onto open ground.'); return 'no-target'; }
    if (ground && cheb(tile, p) > (aim.emptyTileMax ?? range)) { say('Too far to charge.'); return 'out-of-range'; }
    if (!lanePath(state, p, tile, ground, range)) { say(ground ? 'No clear straight run to that tile.' : 'No clear straight run.'); return 'no-lane'; }
  }
  // D30: Upheaval needs open floor to raise.
  if ((row.effects ?? []).some(e => e.verb === 'terrain' && e.where?.selector === 'wall-across') && !ridgeTiles(state, p, tile ?? p).length) { say('There is no open floor to raise.'); return 'no-room'; }
  // D26-D27: a summon needs a free tile at the aim, and Living Flame refuses past its cap of summons.
  const sum = (row.effects ?? []).find(e => e.verb === 'summon');
  if (sum) {
    const r = sum.within ?? 1, at = tile ?? p;
    // The swarm this cast dismisses first does not hold its tiles.
    const goes = (row.effects ?? []).filter(e => e.verb === 'dismiss').map(e => e.who?.kind);
    const holds = c => { const b = bodyAt(c); return b && !(b.summon && b.owner === p.id && goes.includes(b.kind)); };
    let free = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (walkable(state.floor, at.x + dx, at.y + dy) && !holds({ x: at.x + dx, y: at.y + dy })) free++;
    if (!free) { say('There is no room there.'); return 'no-room'; }
    const kinds = sum.capCounts ?? [sum.creature];
    if (sum.cap && state.order.filter(i => { const a = state.actors[i]; return a.hp > 0 && a.summon && a.owner === p.id && kinds.includes(a.kind); }).length >= sum.cap) { say('You already have two summons.'); return 'too-many-summons'; }
  }
  for (const why of row.refusedWhen ?? []) {
    if (why === 'a foe adjacent' && foesInSight(state, p, 1).length) { say('Enemy adjacent.'); return 'foe-adjacent'; }   // 1.7 casting-adapter.js:203
    if ((why === 'rooted' || why === 'frozen') && (p.statuses.root || p.statuses.frozen)) { say('You cannot move.'); return 'rooted'; }
  }
  if (aim.kind !== 'self' && blocks(p, 'melee') && !isSpell(row)) return 'cannot-attack';
  // D4: pay, then the cooldown starts; the effects run on the target.
  p.mana -= cost;
  if (opts.prayer) h.faith.favor -= row.favor ?? 0;   // RB41: a prayer is paid in favor
  if (row.cooldown) cds[id] = row.cooldown;
  if (target && row.turnsToFoe !== false) events.push({ type: 'face', id: p.id, dx: Math.sign(target.x - p.x) });
  events.push({ type: 'ability', id: p.id, ability: id, name: row.name, at: tile, target: target?.id ?? null, sfx: typeof row.sfx === 'string' ? [row.sfx] : [row.sfx?.cast, row.sfx?.castFallback].filter(Boolean), kind: row.kind, ...heroClip(row) });
  // For the cast's picture (src/render/spell-fx.js): where the hero stood, and the cells a cone or a beam covers.
  Object.assign(events.at(-1), { from: { x: p.x, y: p.y }, area: areaOf(state, p, row, tile, range), ...struckShape(state, p, id, row, tile) });
  if (opts.prayer && !events.at(-1).sfx?.length) events.at(-1).sfx = ['pray'];   // 1.7 spendPrayer: sfx('pray')
  if (world) { strikeWorld(state, p, row, world, events); return 'act'; }   // CB25: no foe, no riders
  // Asleep and off guard as they stood before the strike (Sap's 6-turn stun reads them after its own hit).
  const before = target ? { [target.id]: { asleep: !!target.asleep, offGuard: !target.throne && (!target.hunting || !!target.statuses.blind || target.caughtOff === state.actions) } } : {};
  const fromHiding = !!p.statuses.hidden;   // E6 Into the Dark: a single-target spell cast from hiding is stronger
  if (isSpell(row) && p.statuses.hidden) removeStatus(state, p, 'hidden', events);   // D4: a cast ends Hidden (before its own effects: Umbral hides anew)
  // on-cast: a spell, an invoke or a prayer, tagged with its kind (CF19: the Holy Symbol's Light heals on the divine ones).
  heroEvent(state, 'on-cast', { target: p, packet: { tags: [row.kind] } }, events);
  // E35 (1.7 costs-adapter.js spellConduct): a spell paid in mana, not a technique, an invoke or a prayer, fires on-pay-mana (the Light tome).
  if (isSpell(row) && !row.tech && !invoke && !opts.prayer && cost > 0) heroEvent(state, 'on-pay-mana', { target: p, packet: { manaPaid: cost, tags: ['spell'] } }, events);
  // G45 (1.7 spendSpellMana, spellConduct): Vellum's piety for the mana a spell or an invoke cost.
  if (!opts.prayer && cost > 0 && (invoke || (isSpell(row) && !row.tech))) manaPiety(state, cost, events);
  const shared = {};
  // E6: an invoke's per-rank numbers read the hero's piety rank (Unholy Aura's 4 a rank, Bellow's and Heal's 2%).
  const ctx = { state, owner: p, target: target ?? p, tile, source: p, events, ability: row, before, shared, range, rank: h.faith?.rank ?? 0, fromHiding, choice: opts.choice ?? null };
  const from = events.length;
  if (opts.prayer) ctx.rank = h.faith.rank ?? 0;   // a prayer's per-rank numbers
  for (const e of row.effects ?? []) {
    runEffect(e, ctx);
    if (shared.missed) break;                              // D6: a missed bolt carries no riders
    if (shared.struck) ctx.target = shared.struck;        // D5: they land on the body it struck
  }
  // E13 (1.7 elements.js markGround): at rank 6 of Fire, Water, Earth or Light the spell marks the tiles it struck.
  if (isSpell(row) && shared.ground?.length) spellGround(state, p, row.element, shared.ground, events);
  // E49 (1.7 elements.js:69 markGround, systems.js:455 spellPropHit): a damaging spell strikes the breakable props on
  // the tiles it hit (a frozen hoard is the puzzle's, thawed by fire there).
  if (isSpell(row) && shared.ground?.length) spellProps(state, row, shared.ground, events);
  const healed = events.slice(from).filter(e => e.type === 'healed' && e.id === p.id).reduce((a, e) => a + e.amount, 0);
  if (isSpell(row) && fromHiding) removeStatus(state, p, 'into-the-dark', events);   // statuses.json endsOn cast
  // E51 (1.7 casting-adapter.js:180, :198, :210): Storm Form, Dawn and Shadowstep say what they did, in moss (logCls).
  if (row.log) events.push({ type: 'log', words: fillLog(row.log, state, p, row, healed, shared), ...(row.logCls ? { cls: row.logCls } : {}) });
  // RB54 (1.7 recovery.js:58 castReginaldLance, gods.js prayAnvilToll): a prayer that struck no one says so.
  if (row.noHitLog && !events.slice(from).some(e => (e.type === 'attacked' && e.id === p.id) || (e.type === 'damaged' && e.id !== p.id))) events.push({ type: 'log', words: row.noHitLog, cls: 'c-info' });
  // E34 (1.7 gods.js:577 anviltoll, recovery.js:55 lance: setClip(player,'melee')): a prayer that swings and struck no
  // one still swings; its blows would have played their own.
  const used = events.slice(0, from).findLast(e => e.type === 'ability' && e.id === p.id);
  if (row.noHitLog && used && used.clip === null && !events.slice(from).some(e => e.type === 'attacked' && e.id === p.id)) used.clip = 'melee';
  // CF22 (1.7 classes.js:192): Charge says how many it staggered, when it staggered any.
  if (row.stunLog) {
    const n = events.slice(from).filter(e => e.type === 'status' && e.status === 'stun' && e.change === 'applied' && e.id !== p.id).length;
    if (n) events.push({ type: 'log', words: row.stunLog.replace('{n}', String(n)), cls: 'c-good' });
  }
  // Storm Form (statuses.json while action-economy): spells take no time while it lasts.
  const quick = isSpell(row) && Object.keys(p.statuses).some(k => whileOf(k, 'action-economy').some(w => w.instant === 'spells'));
  return row.instant || quick ? 'free' : 'act';
}

/** D4: cooldowns count game turns on the world pulse (turns.md TO1, ruled 2026-10-15). */
export function tickCooldowns(state) {
  for (const cd of [state.hero?.cooldowns, state.hero?.faith?.cooldowns]) if (cd) for (const k in cd) if (cd[k] > 0) cd[k] -= 1;
}

/**
 * RB41 (1.7 gods.js canPray, spendPrayer, performPrayer; spec/faith.md "Prayers"): a prayer from the hotbar or the
 * Faith window ({type:'pray', prayer, at}). Refused unless it is the sworn god's and the rank has it, and while on
 * cooldown, short of favor or HP, (Field Smelt) with a hunting foe in sight, (Last Stand) while it runs, (Raise Dead)
 * while the servant stands. Then it runs as an ability does (aim, effects); the favor is paid and the cooldown starts.
 * An instant prayer takes no time.
 */
export function usePrayer(state, id, at, events, choice = null) {
  const h = state.hero, p = state.actors[state.playerId], f = h.faith, row = prayers.rows[id];
  const say = w => events.push({ type: 'log', words: w });
  if (!row || row.kind !== 'prayer') return 'unknown-prayer';
  const raise = row.notWhile === 'servant-alive-or-lich-returning';
  if (raise && state.floor?.pendingLich) { say('Your Lich is returning.'); return 'servant'; }   // RB45 (1.7 progression-adapter.js:176, first)
  const no = why => { say(`${row.name}: unavailable.`); return why; };
  if (!f?.god || !(gods.rows[f.god]?.prayers ?? []).includes(id) || (f.rank ?? 0) < (row.rank ?? 1)) return no('not-known');
  if ((f.cooldowns?.[id] ?? 0) > 0) { say(`${row.name} is not ready (${Math.ceil(f.cooldowns[id])}).`); return 'cooldown'; }
  if (row.health && p.hp < row.health + 1) { say(`${row.name}: needs ${row.health + 1} HP; costs ${row.health}.`); return 'no-hp'; }
  if ((f.favor ?? 0) < (row.favor ?? 0)) return no('no-favor');
  if (row.notWhile === 'laststand' && p.statuses.laststand) return no('running');
  if (row.notWhile === 'in-combat' && foesInSight(state, p, 99).some(a => a.hunting)) return no('in-combat');
  // G42 (1.7 progression-adapter.js prayRaiseDead, castRaiseDead): one servant at a time, and the dead rise on a free cell
  // beside the hero (within 1, else within 2); an aimed cell must itself be empty floor.
  if (raise) {
    const kinds = (row.effects ?? []).filter(e => e.verb === 'summon').map(e => e.creature);
    if (state.order.some(i => { const a = state.actors[i]; return a.hp > 0 && a.summon && a.owner === p.id && kinds.includes(a.kind); })) { say('Your servant still stands.'); return 'servant'; }
    if (at && (at.x !== p.x || at.y !== p.y)) {
      if (!free(state, at.x, at.y)) { say('The dead need an empty patch of floor.'); return 'no-room'; }
    } else {
      const near = nearFree(state, p, 1), cells = near.length ? near : nearFree(state, p, 2);
      if (!cells.length) { say('There is no room for the dead to rise.'); return 'no-room'; }
      at = cells[Math.floor(next(state.rng) * cells.length)];   // 1.7 nearFree picks at random
    }
  }
  // Lance and Bone Spear from the Faith window, with no aim given: at the nearest foe in sight and range.
  if (!at && ['beam', 'line'].includes(row.aim?.kind)) {
    const t = foesInSight(state, p, row.aim.range ?? 6)[0];
    if (!t) { say('No target in range.'); return 'no-target'; }
    at = { x: t.x, y: t.y };
  }
  // CD1 Field Smelt (1.7 gods.js prayFieldSmelt): which carried item goes is asked first, as a picker sigil asks.
  if ((row.effects ?? []).some(e => e.verb === 'item-change' && e.which === 'chosen') && !choice) {
    if (!h.bag.some(it => recycleValue(state, it) > 0)) { say('No recyclable items in your bag.'); return 'no-item'; }
    events.push({ type: 'picker', prayer: id });
    return 'free';
  }
  return useAbility(state, id, at, events, { prayer: row, choice });
}
