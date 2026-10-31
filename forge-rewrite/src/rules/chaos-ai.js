// Chaos creatures' turns (spec/chaos.md 53, 61-67; monsters.md, the Chaos roster), in 1.7's decision order
// (js/world/chaos/chaos-enemies.js act @3c8b312): a hunter that never leaves its island and never steps on a portal,
// one shared special cooldown on the world clock, and its special, melee, ranged blow, retreat or approach.
// Registered as the set piece 'chaos' (set-pieces.js): the whole turn is here, so no step (a wander included) ever
// leaves the island or lands on a portal (chaos-enemies.js cellAllowed). Noticing is the shared rule (ai.js noticeChance);
// drops are the ordinary kill drops (the death hook below). Poison patches and both trails are fields (fields.js; C10b).
// Numbers are 1.7's (sDMG = scaled by number-scale and lethality, as in tuning.json).

import { CREATURE_HOOKS, registerSetPiece } from './set-pieces.js';
import MON from '../../data/monsters.json' with { type: 'json' };
import FLOORS from '../../data/floors.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { noticeChance } from './ai-sense.js';
import { killDrops } from './pickup.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { applyStatus, blocks } from './statuses.js';
import { hitChance, accuracyOf, evasionOf, hostileSpellLands } from './hit.js';
import { amount } from './amount.js';
import { tryStep, bodyAt, shotBodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { cheb, D4, D8, lineCells, clearShot as libClearShot } from '../lib/geometry.js';
import { layField, makeField } from './fields.js';
import { ready, spend } from './cooldowns.js';
import { next } from '../lib/rng.js';
import { T, walkable, tileAt, opaque, G } from '../data/tiles.js';
import { chaosRegionAt } from './chaos-map.js';
import { chaosBody } from './monsters.js';

const PRISM_CYCLE = ['fire', 'ice', 'lightning'];   // the Prism Seer's elements in turn
const BROOD = { 'chaos-brood-carrier': 'chaos-rotling', 'chaos-silk-weaver': 'chaos-spiderling' };
const TURN = tuning.rows.clock.unitsPerGameTurn;
/** The one shared special cooldown (chaos-enemies.js e.specialCd) on the world clock (cooldowns.js; M32). */
const SPECIAL = { id: 'special' };
const rest = (state, e, units) => spend(state, e, SPECIAL, units / TURN);
/** Iron Brace's turns, from its monsters.json row. */
const BRACE = MON.rows['chaos-ironbound'].moves.find(m => m.id === 'iron-brace').effects.find(x => x.status === 'chaosbrace');
export const sDMG = (state, n) => amount({ scaled: { base: n, mult: ['number-scale', 'lethality'], round: true, min: 1 } }, { state });

const regionOf = (state, a) => chaosRegionAt(state.floor, a.x, a.y);
const sameRegion = (state, a, b) => !!regionOf(state, a) && regionOf(state, a) === regionOf(state, b);
/** Island ground a chaos creature may stand on (chaos 53). */
export const land = (state, x, y, region) => chaosRegionAt(state.floor, x, y) === region && walkable(state.floor, x, y) && tileAt(state.floor, x, y) !== T.CHASM && tileAt(state.floor, x, y) !== T.PORTAL;
/** Island ground a chaos blow, bile or brood landing may reach: any walkable tile of the island, portal and current tiles
 *  included (Justin, sandbox 2026-10-16, Chaos improvement 3: no hidden safe tiles). Creatures still never step there. */
export const ground = (state, x, y, region) => chaosRegionAt(state.floor, x, y) === region && walkable(state.floor, x, y);
const occupied = (state, x, y) => !!bodyAt(state, x, y);
const party = state => state.order.map(id => state.actors[id]).filter(b => b.hp > 0 && (b.side === 'player' || b.side === 'ally'));

/** The tiles a projectile from e toward target crosses on e's island, stopping at the first body (chaos-enemies line). */
function line(state, e, target, max) {
  if (!sameRegion(state, e, target) || cheb(e, target) > max) return [];
  const out = [], r = regionOf(state, e);
  for (const p of lineCells(e, target)) {
    if (!ground(state, p.x, p.y, r)) break;
    out.push(p);
    const b = bodyAt(state, p.x, p.y);
    if (b && b !== e && (b === target || shotBodyAt(state, p.x, p.y))) break;   // G43 (1.7 chaos-enemies.js:92): a Tiny body is shot past
  }
  return out;
}
const reaches = (tiles, t) => tiles.some(c => c.x === t.x && c.y === t.y);
const clearShot = (state, a, t) => libClearShot(a, t, { opaque: (x, y) => opaque(state.floor, x, y), body: (x, y) => !!shotBodyAt(state, x, y) });   // G43: a Tiny body is shot past
const sees = (state, a, t) => (t.side === 'player' ? !t.statuses?.hidden && !a.statuses?.blind && !!state.vis?.[a.y * state.floor.w + a.x] : cheb(a, t) <= 6 && clearShot(state, a, t));

function targetFor(state, e) {
  const c = party(state).filter(o => sameRegion(state, e, o) && sees(state, e, o));
  c.sort((a, b) => {
    const wound = e.kind === 'chaos-razor-dancer' ? (b.statuses.bleed ? 1 : 0) - (a.statuses.bleed ? 1 : 0) : 0;
    return wound || cheb(e, a) - cheb(e, b) || (a.side === 'player' ? -1 : 1);
  });
  return c[0] ?? null;
}

function spellLands(state, e, t, events) {
  const ch = hitChance(accuracyOf(state, e), evasionOf(t)) * (e.statuses.blind ? 0.6 : 1);
  return hostileSpellLands(state, e, t, ch, events);   // CH29: deflect, Blur and Lucky Streak as any foe's bolt
}
/** The miss float, unless the hero's deflect already showed it. */
const missed = (events, t) => { if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: t.id }); };
function direct(state, e, t, n, type, events, area = false) {
  return dealDamage(state, { target: t, source: e.hp > 0 ? e : { ...e, side: 'foe' }, amount: n, type, tags: area ? ['area'] : ['spell', 'ranged'] }, events);
}
function physical(state, e, t, mult, label, events) {
  const before = events.length;
  weaponAttack(state, e, t, events, { mult, label });
  return events.slice(before).some(ev => ev.type === 'attacked' && ev.id === e.id && ev.hit);
}
const say = (events, e, words) => events.push({ type: 'log', words });

/** A chaos creature's step; the Plague Bloat leaves its plague trail on the cell it leaves (X10). */
function chaosStep(state, e, dx, dy, events) {
  const from = { x: e.x, y: e.y };
  if (!tryStep(state, e, dx, dy, events)) return false;
  if (e.kind === 'chaos-plague-bloat') leaveTrail(state, e, from, events);
  return true;
}

/** The distance field to a goal over e's island (8-way, no corner cutting, portals and void shut). */
function stepToward(state, e, goal, events) {
  if (blocks(e, 'move')) return false;
  const f = state.floor, W = f.w, r = e.region ?? regionOf(state, e), d = new Int32Array(W * f.h).fill(-1);
  const ok = (x, y) => land(state, x, y, r) || (tileAt(f, x, y) === T.DOOR && chaosRegionAt(f, x, y) === r);   // a shut door is opened on the way (M28)
  const q = [goal.y * W + goal.x]; d[q[0]] = 0;
  for (let i = 0; i < q.length && i < 4000; i++) {
    const c = q[i], cx = c % W, cy = (c / W) | 0;
    for (const [dx, dy] of D8) {
      const nx = cx + dx, ny = cy + dy, n = ny * W + nx;
      if (!ok(nx, ny) || d[n] >= 0 || (dx && dy && !ok(cx + dx, cy) && !ok(cx, cy + dy))) continue;
      d[n] = d[c] + 1; q.push(n);
    }
  }
  const here = d[e.y * W + e.x];
  const opts = D8.map(([dx, dy]) => ({ dx, dy, v: d[(e.y + dy) * W + e.x + dx] })).filter(o => o.v >= 0 && (here < 0 || o.v < here)).sort((a, b) => a.v - b.v);
  for (const o of opts) {
    if (o.dx && o.dy && !ok(e.x + o.dx, e.y) && !ok(e.x, e.y + o.dy)) continue;
    if (f.tiles[(e.y + o.dy) * W + e.x + o.dx] === T.DOOR) { f.tiles[(e.y + o.dy) * W + e.x + o.dx] = T.OPEN_DOOR; events.push({ type: 'door', at: { x: e.x + o.dx, y: e.y + o.dy }, open: true, by: e.id }); return true; }
    if (chaosStep(state, e, o.dx, o.dy, events)) return true;
  }
  return false;
}
function fleeStep(state, e, t, events) {
  if (blocks(e, 'move')) return false;
  const r = e.region, opts = D8.map(([dx, dy]) => ({ dx, dy, g: cheb({ x: e.x + dx, y: e.y + dy }, t) - cheb(e, t) })).filter(o => o.g > 0 && land(state, e.x + o.dx, e.y + o.dy, r) && !occupied(state, e.x + o.dx, e.y + o.dy));
  for (const o of opts.sort((a, b) => b.g - a.g)) if (chaosStep(state, e, o.dx, o.dy, events)) return true;
  return false;
}
function area(state, cx, cy, rad, r, step = false) { const out = []; for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) if ((step ? land : ground)(state, x, y, r)) out.push({ x, y }); return out; }
function approach(state, e, t, events) {
  const c = area(state, t.x, t.y, 1, e.region, true).filter(p => !occupied(state, p.x, p.y)).sort((a, b) => cheb(e, a) - cheb(e, b));
  return (c.length && stepToward(state, e, c[0], events)) || stepToward(state, e, t, events);
}

/**
 * Chaos 61-64, answer 2 (2026-10-15): a poison patch is its floors.json row's field on the 3 by 3 of the island round
 * `at`: one a source, eight a floor, the strongest only, washed by water. As the rows' rules say: only the hero and his
 * allies, first on the pulse after it is laid, on exactly three pulses, "The poison cloud" once its source is gone.
 */
const PATCH = { side: 'party', lag: true, through: true, cause: 'poison-cloud' };
function poisonPatch(state, e, at, row, events) {
  makeField(state, FLOORS.rows[row].effects[0], area(state, at.x, at.y, 1, e.region), e, events, PATCH);
}

const living = (state, e) => state.order.filter(id => { const a = state.actors[id]; return a.hp > 0 && a.owner === e.id; }).length;

function releaseBrood(state, e, t, kind, count, element, cooldown, events) {
  const cells = area(state, t.x, t.y, 1, e.region, true).filter(c => !occupied(state, c.x, c.y) && reaches(line(state, e, c, 6), c))
    .sort((a, b) => cheb(e, a) - cheb(e, b) || a.y - b.y || a.x - b.x);
  const n = Math.min(count, 3 - living(state, e)), born = [];
  for (const c of cells) {
    if (born.length >= n) break;
    const child = chaosBody(kind, c.x, c.y, e.region, { asleep: false, offspring: true, owner: e.id });
    Object.assign(child, { hunting: true, t: Math.max(state.actors[state.playerId].t, state.now + 100), lastSeen: { x: t.x, y: t.y, at: state.now } });
    state.actors[child.id] = child; state.order.push(child.id); born.push(child);
    events.push({ type: 'spawned', id: child.id, at: { ...c } });
  }
  if (!born.length) return false;
  rest(state, e, cooldown);
  // CH8 (chaos-enemies.js:183): no shot flies at the hero; a bolt in the brood's element flies to each landing child
  // (fx-layer.js), as it is thrown.
  events.push({ type: 'move-used', id: e.id, move: 'brood', name: 'brood', target: t.id, element, from: { x: e.x, y: e.y }, children: born.map(c => ({ x: c.x, y: c.y })), sfx: kind === 'chaos-rotling' ? 'slime-split' : 'trap-web' });
  return true;
}

function lensBeam(state, e, t, events) {
  if (state.now < (e.beamAt ?? 0) || cheb(e, t) > 6 || !clearShot(state, e, t)) return false;
  const tiles = line(state, e, t, 6);
  if (!reaches(tiles, t)) return false;
  e.lensActive = true; e.beamAt = state.now + 600;
  events.push({ type: 'move-used', id: e.id, move: 'lens-beam', name: 'Lens Beam', target: t.id, ranged: true, element: 'light', sfx: 'light-cast' });
  if (spellLands(state, e, t, events)) { const n = direct(state, e, t, sDMG(state, 24), 'light', events); if (n > 0 && t.hp > 0) applyStatus(state, t, 'blind', { turns: 2, source: e.id }, events); }
  else missed(events, t);
  return true;
}
function lensShield(state, e, t, events) {
  const ally = state.order.map(id => state.actors[id]).filter(o => o !== e && o.side === 'foe' && o.hp > 0 && o.hunting && o.kind !== 'chaos-lens-bearer' && sameRegion(state, e, o) && cheb(e, o) <= 4 && !o.statuses.chaoslens && clearShot(state, e, o))
    .sort((a, b) => cheb(a, t) - cheb(b, t))[0];
  if (!ally) return false;
  applyStatus(state, ally, 'chaoslens', { turns: 4, magnitude: Math.round(35 * amount({ scaled: { base: 1, mult: ['number-scale'] } }, { state })), replace: true, source: e.id }, events);
  events.push({ type: 'move-used', id: e.id, move: 'lens-shield', name: 'Lens Shield', target: ally.id, ranged: true, element: 'light', sfx: 'light-cast' });
  rest(state, e, 500); e.lensActive = true;
  return true;
}

function blink(state, e, t, events) {
  if (blocks(e, 'move') || e.blinkNeedsAttack) return false;
  const W = state.floor.w, q = [{ x: e.x, y: e.y, n: 0 }], seen = new Set([e.y * W + e.x]), opts = [];
  for (let i = 0; i < q.length; i++) {
    const p = q[i]; if (p.n >= 3) continue;
    for (const [dx, dy] of D4) {
      const x = p.x + dx, y = p.y + dy, k = y * W + x;
      if (!land(state, x, y, e.region) || occupied(state, x, y) || seen.has(k)) continue;
      seen.add(k); const nx = { x, y, n: p.n + 1 }; q.push(nx);
      if (state.vis?.[k] && clearShot(state, e, nx) && cheb(nx, t) <= cheb(e, t) && cheb(nx, t) > 1) opts.push(nx);
    }
  }
  opts.sort((a, b) => Math.abs(cheb(a, t) - 2) - Math.abs(cheb(b, t) - 2) || b.n - a.n || a.y - b.y || a.x - b.x);
  if (!opts.length) return false;
  const from = { x: e.x, y: e.y };
  e.x = opts[0].x; e.y = opts[0].y;
  // CH6 (chaos-enemies.js:250-251): a blink, not a fade; light sparkles where it leaves and lands unless it is unseen.
  events.push({ type: 'teleported', id: e.id, from, to: { x: e.x, y: e.y }, sfx: 'vanish', blink: true, sparkle: e.unseen || e.hidden || e.statuses?.hidden ? 0 : 10 });
  e.blinkNeedsAttack = true; rest(state, e, 500);
  return true;
}
function leap(state, e, t, events) {
  if (blocks(e, 'move') || cheb(e, t) < 2 || cheb(e, t) > 5 || !sameRegion(state, e, t)) return false;
  const path = lineCells(e, t);
  if (path.length < 2) return false;
  let prev = { x: e.x, y: e.y };
  for (let n = 0; n < path.length; n++) {
    const p = path[n], dx = p.x - prev.x, dy = p.y - prev.y;
    const on = n === path.length - 1 ? ground : land;   // the pounce lands beside the hero, wherever the hero stands
    if (!on(state, p.x, p.y, e.region) || (dx && dy && !ground(state, prev.x + dx, prev.y, e.region) && !ground(state, prev.x, prev.y + dy, e.region))) return false;
    if (n < path.length - 1 && occupied(state, p.x, p.y)) return false;
    prev = p;
  }
  const to = path[path.length - 2], from = { x: e.x, y: e.y };
  e.x = to.x; e.y = to.y; rest(state, e, 400);
  events.push({ type: 'moved', id: e.id, from, to: { ...to }, dash: true, leap: true });
  physical(state, e, t, 1.2, 'Pounce', events);
  return true;
}
function pull(state, e, t, events) {
  if (t.immune?.includes('knockback') || blocks(t, 'move') && t.statuses?.rooted) return;
  for (let n = 0; n < 2 && cheb(e, t) > 1; n++) {
    const dx = Math.sign(e.x - t.x), dy = Math.sign(e.y - t.y), x = t.x + dx, y = t.y + dy;
    if (!land(state, x, y, chaosRegionAt(state.floor, t.x, t.y)) || occupied(state, x, y) || (dx && dy && !walkable(state.floor, t.x + dx, t.y) && !walkable(state.floor, t.x, t.y + dy))) break;
    const from = { x: t.x, y: t.y }; t.x = x; t.y = y;
    events.push({ type: 'moved', id: t.id, from, to: { x, y }, pulled: true });
  }
}

/** A projectile special (ray, harpoon, web): the first party member or ally on the line takes it. */
function projectileVictim(state, e, tiles) {
  for (let i = 0; i < tiles.length; i++) {
    const c = tiles[i]; if (!ground(state, c.x, c.y, e.region)) return null;
    const v = bodyAt(state, c.x, c.y);
    if (v && v !== e) return v.side === 'player' || v.side === 'ally' ? v : null;
  }
  return null;
}

const SHOTS = new Set(['prism-ray', 'harpoon', 'silver-web']);
function special(state, e, t, events) {
  // CH9 (1.7 chaos-enemies.js release, boltFx only for chaos-ray, chaos-harpoon, chaos-web): only the ray, the harpoon and
  // the web fly at the hero, even adjacent; a vent, a brace, a reach, a lash or a cleave plays its attack where it stands.
  const d = cheb(e, t), r = e.region, use = (move, name, extra = {}) => events.push({ type: 'move-used', id: e.id, move, name, target: t.id, ranged: SHOTS.has(move), ...extra });
  let tiles;
  switch (e.kind) {
    case 'chaos-prism-seer': {
      tiles = line(state, e, t, 6); if (!reaches(tiles, t)) return false;
      const el = e.chaosElement ?? 'fire'; use('prism-ray', 'Prism Ray', { element: el, sfx: el + '-cast' });
      const v = projectileVictim(state, e, tiles);
      if (v && spellLands(state, e, v, events)) { const n = direct(state, e, v, sDMG(state, 36), el, events); if (n > 0 && v.hp > 0 && el === 'ice') applyStatus(state, v, 'frozen', { turns: 1, source: e.id }, events); }
      else if (v) events.push({ type: 'miss', id: v.id });
      e.elIndex = ((e.elIndex ?? 0) + 1) % PRISM_CYCLE.length; e.chaosElement = PRISM_CYCLE[e.elIndex]; rest(state, e, 600);
      return true;
    }
    case 'chaos-folded-horror': case 'chaos-lash-dancer': {
      tiles = line(state, e, t, 2); if (!reaches(tiles, t)) return false;
      const lash = e.kind === 'chaos-lash-dancer';
      use(lash ? 'barbed-lash' : 'heavy-reach', lash ? 'Barbed Lash' : 'Heavy Reach');
      rest(state, e, 500);
      for (const v of party(state).filter(o => reaches(tiles, o))) {
        if (!reaches(line(state, e, v, 2), v)) continue;
        if (physical(state, e, v, lash ? 1.1 : 1.35, lash ? 'Barbed Lash' : 'Heavy Reach', events) && v.hp > 0) {
          if (lash) applyStatus(state, v, 'bleed', { turns: 3, magnitude: sDMG(state, 8), source: e.id }, events);
          else applyStatus(state, v, 'fear', { turns: 2, source: e.id }, events);
        }
      }
      return true;
    }
    case 'chaos-rift-skitter': return d >= 2 && d <= 5 ? blink(state, e, t, events) : false;
    case 'chaos-lens-bearer': return lensShield(state, e, t, events) || lensBeam(state, e, t, events);
    case 'chaos-plague-bloat':
      if (d > 2) return false;
      use('vent', 'Vent', { sfx: 'trap-gas' }); rest(state, e, 500);
      poisonPatch(state, e, e, 'chaos-poison-patch-vent', events);
      return true;
    case 'chaos-brood-carrier':
      if (d <= 6 && living(state, e) < 3 && releaseBrood(state, e, t, BROOD[e.kind], 1, 'poison', 200, events)) return true;
      if (d <= 5 && clearShot(state, e, t)) return bile(state, e, t, 4, events);
      return false;
    case 'chaos-bile-spitter': return d >= 2 && d <= 5 && clearShot(state, e, t) ? bile(state, e, t, 0, events) : false;
    case 'chaos-horned-reaver': {
      if (d > 1) return false;
      const dx = Math.sign(t.x - e.x), dy = Math.sign(t.y - e.y);
      tiles = area(state, e.x, e.y, 1, r).filter(c => (c.x - e.x) * dx + (c.y - e.y) * dy > 0);
      use('frontal-cleave', 'Frontal Cleave'); rest(state, e, 500);
      for (const v of party(state).filter(o => reaches(tiles, o))) if (physical(state, e, v, 1.35, 'Frontal Cleave', events) && v.hp > 0) applyStatus(state, v, 'stun', { turns: 1, source: e.id }, events);
      return true;
    }
    case 'chaos-gorehound': return leap(state, e, t, events);
    case 'chaos-ironbound':
      if (d > 4) return false;
      applyStatus(state, e, 'chaosbrace', { turns: BRACE.turns, replace: true }, events);
      rest(state, e, 700); use('iron-brace', 'Iron Brace', { sfx: 'hit-armor' });
      return true;
    case 'chaos-chain-reaver': {
      if (d < 2) return false;
      tiles = line(state, e, t, 6); if (!reaches(tiles, t)) return false;
      use('harpoon', 'Harpoon'); rest(state, e, 500);
      const v = projectileVictim(state, e, tiles);
      if (v && physical(state, e, v, 1.15, 'Harpoon', events) && v.hp > 0) pull(state, e, v, events);
      return true;
    }
    case 'chaos-silk-weaver': {
      if (d <= 6 && living(state, e) < 3 && releaseBrood(state, e, t, BROOD[e.kind], 3, 'web', 500, events)) return true;
      if (d < 2 || t.statuses.root || t.statuses.web || t.statuses.slow) return false;
      tiles = line(state, e, t, 5); if (!reaches(tiles, t)) return false;
      use('silver-web', 'Silver Web', { element: 'web', sfx: 'trap-web' }); rest(state, e, 500);
      const v = projectileVictim(state, e, tiles), end = v ?? tiles[tiles.length - 1], k = end.y * state.floor.w + end.x;
      if (state.floor.tiles[k] === T.FLOOR) { state.floor.ground[k] = G.WEB; events.push({ type: 'ground', at: { x: end.x, y: end.y }, ground: G.WEB }); }
      if (v && spellLands(state, e, v, events)) applyStatus(state, v, 'web', { turns: 1, source: e.id }, events);
      return true;
    }
  }
  return false;
}
function bile(state, e, t, poisonTurns, events) {
  const aim = { x: t.x, y: t.y };
  events.push({ type: 'move-used', id: e.id, move: poisonTurns ? 'infectious-bile' : 'bile-patch', name: poisonTurns ? 'Infectious Bile' : 'Bile', target: t.id, ranged: true, element: 'poison', sfx: 'trap-gas' });
  rest(state, e, 500);
  if (reaches(line(state, e, aim, 5), aim)) poisonPatch(state, e, aim, poisonTurns ? 'chaos-poison-patch-carrier-bile' : 'chaos-poison-patch-spitter-bile', events);
  return true;
}

function rangedAttack(state, e, t, events) {
  if (e.kind !== 'chaos-prism-seer' && e.kind !== 'chaos-bile-spitter') return false;
  const seer = e.kind === 'chaos-prism-seer', tiles = line(state, e, t, seer ? 6 : 5);
  if (!reaches(tiles, t)) return false;
  const type = seer ? (e.chaosElement ?? 'fire') : 'poison';
  events.push({ type: 'move-used', id: e.id, move: seer ? 'prism-bolt' : 'bile-spit', name: seer ? 'Prism Bolt' : 'Bile Spit', target: t.id, ranged: true, element: type });
  if (spellLands(state, e, t, events)) {
    const n = direct(state, e, t, sDMG(state, seer ? 24 : 15), type, events);
    if (n > 0 && t.hp > 0 && !seer && state.now >= (e.debuffAt ?? 0)) { applyStatus(state, t, 'blind', { turns: 2, source: e.id }, events); e.debuffAt = state.now + 300; }
  } else missed(events, t);
  return true;
}

/** M23 for Chaos: only the Lens Bearer calls, up to 2 sleeping or wandering islanders within 5 (one action). */
function alertPack(state, e, t, events) {
  if (e.kind !== 'chaos-lens-bearer' || e.alerted || !sameRegion(state, e, t)) return false;
  e.alerted = true;
  const near = state.order.map(id => state.actors[id]).filter(o => o !== e && o.side === 'foe' && o.hp > 0 && o.set === 'chaos' && !o.hunting && o.region === e.region && cheb(e, o) <= 5 && lineClear(state.floor, e, o))
    .sort((a, b) => cheb(e, a) - cheb(e, b)).slice(0, 2);
  for (const o of near) Object.assign(o, { hunting: true, asleep: false, alerted: true, lastSeen: { x: t.x, y: t.y, at: state.now } });
  if (near.length) events.push({ type: 'log', words: 'Lens Bearer: help called.' }, { type: 'float', id: e.id, words: 'Help!', tone: 'light' });
  return near.length > 0;
}

function chaosAct(state, e, events) {
  e.region ??= regionOf(state, e);
  e.chaosElement ??= PRISM_CYCLE[e.elIndex ?? 0];
  if (e.chaosWait !== undefined) { (e.readyAt ??= {}).special = state.now + e.chaosWait; delete e.chaosWait; }
  if (e.statuses.chaosbrace) return;
  const p = state.actors[state.playerId];
  if (p.hp <= 0) return;
  if (e.statuses.fear) { fleeStep(state, e, p, events); return; }
  if (!e.hunting) {
    // M11-M12: noticing; a sleeper stays put; an awake one wanders its own island.
    const d0 = cheb(e, p);
    if (next(state.rng) < noticeChance(state, e, p, d0)) {
      Object.assign(e, { hunting: true, asleep: false, caughtOff: state.actions, lastSeen: { x: p.x, y: p.y, at: state.now } });
      events.push({ type: 'noticed', id: e.id });
      return;
    }
    if (e.asleep || blocks(e, 'move')) return;
    if (e.goal && chaosRegionAt(state.floor, e.goal.x, e.goal.y) === e.region) {
      if (e.x === e.goal.x && e.y === e.goal.y) e.goal = null; else stepToward(state, e, e.goal, events);
      return;
    }
    const r = state.floor.chaos?.regions.find(q => q.id === e.region);
    if (r && (!e.wanderTo || next(state.rng) < 0.04 || (e.x === e.wanderTo.x && e.y === e.wanderTo.y))) {
      const b = r.bounds, x = b.x + Math.floor(next(state.rng) * b.w), y = b.y + Math.floor(next(state.rng) * b.h);
      e.wanderTo = land(state, x, y, e.region) ? { x, y } : e.wanderTo;
    }
    if (e.wanderTo) stepToward(state, e, e.wanderTo, events);
    return;
  }
  if (e.lastSeen && state.now - (e.lastSeen.at ?? 0) > 1200 && !sees(state, e, p)) { e.hunting = false; e.lastSeen = null; return; }
  const t = targetFor(state, e);
  if (!t) {
    if (e.lastSeen && chaosRegionAt(state.floor, e.lastSeen.x, e.lastSeen.y) === e.region && state.now - (e.lastSeen.at ?? 0) <= 1200) stepToward(state, e, e.lastSeen, events);
    else { e.hunting = false; e.lastSeen = null; }
    return;
  }
  if (!e.alerted && alertPack(state, e, t, events)) return;
  e.lastSeen = { x: t.x, y: t.y, at: state.now };
  const d = cheb(e, t);
  if (e.kind === 'chaos-lens-bearer' && d < 3 && fleeStep(state, e, t, events)) return;
  if (e.kind === 'chaos-lens-bearer' && e.lensActive && lensBeam(state, e, t, events)) return;
  if (ready(state, e, SPECIAL) && special(state, e, t, events)) return;
  if (e.kind === 'chaos-lens-bearer') {
    if (d > 5 && stepToward(state, e, t, events)) return;
    const escort = state.order.map(id => state.actors[id]).filter(o => o !== e && o.side === 'foe' && o.hp > 0 && o.hunting && o.kind !== 'chaos-lens-bearer' && sameRegion(state, e, o) && cheb(e, o) <= 6 && clearShot(state, e, o)).sort((a, b) => cheb(e, a) - cheb(e, b))[0];
    if (escort && cheb(e, escort) > 3) {
      const safe = area(state, e.x, e.y, 1, e.region, true).filter(c => !occupied(state, c.x, c.y) && cheb(c, t) >= 3 && cheb(c, escort) < cheb(e, escort)).sort((a, b) => cheb(a, escort) - cheb(b, escort));
      if (safe.length && stepToward(state, e, safe[0], events)) return;
    }
    lensShield(state, e, t, events);
    return;
  }
  const reach = e.kind === 'chaos-lash-dancer' || e.kind === 'chaos-folded-horror' ? 2 : 1;
  if (d <= reach && reaches(line(state, e, t, reach), t) && !blocks(e, 'melee')) {
    const hit = physical(state, e, t, e.kind === 'chaos-razor-dancer' && t.statuses.bleed ? 1.3 : 1, null, events);
    if (hit && t.hp > 0 && e.kind === 'chaos-rift-skitter' && state.now >= (e.debuffAt ?? 0)) { applyStatus(state, t, 'slow', { turns: 2, source: e.id }, events); e.debuffAt = state.now + 300; }
    e.blinkNeedsAttack = false;
    return;
  }
  if (rangedAttack(state, e, t, events)) return;
  if (['chaos-prism-seer', 'chaos-bile-spitter', 'chaos-silk-weaver'].includes(e.kind) && d < 3 && fleeStep(state, e, t, events)) return;
  if (d > 1) approach(state, e, t, events);
}
registerSetPiece('chaos', chaosAct);
// A chaos body is a set piece only for its turns: its death drops as any creature's (chaos 84; offspring drop nothing).
CREATURE_HOOKS.death.push((state, a, by, events) => { if (a.set === 'chaos' && by?.side === 'player' && !a.offspring && state.floor?.items) killDrops(state, a, events); });

// X10 (Justin's pick, sandbox 2026-10-16): 1.7's plague trail (js/enemies/green-slime.js @3c8b312, trails.plague):
// the Plague Bloat leaves 6 poison damage per world pulse on every cell it leaves, for 10 game turns; it hurts the hero
// and allies (never creatures), strongest only, not on the pulse it was laid, never the airborne or poison-immune.
// A field (C10b, engine-rules-09): one cell a row, a new one taking the cell from the old.
const PLAGUE_TRAIL = { field: 'plague-trail', turns: 10, side: 'party', each: [{ verb: 'damage', amount: 6, type: 'poison', tags: ['periodic', 'environment', 'poison-trail', 'area'] }],
  perCell: true, overlap: 'strongest', lag: true, spare: ['poison-immune'], cause: 'plague-trail', tell: 'Plague trail', known: true, quiet: true };
function leaveTrail(state, e, at, events) {
  const f = state.floor, k = at.y * f.w + at.x;
  if (!f.chaos || !walkable(f, at.x, at.y)) return;
  layField(state, PLAGUE_TRAIL, [at], e, events);
  if (!e.trailWarned && state.vis?.[k]) { e.trailWarned = true; events.push({ type: 'log', words: `${e.name} leaves ${PLAGUE_TRAIL.each[0].amount} poison damage per turn.` }); }
  events.push({ type: 'trail', at: { ...at } });
}

// EP1 (1.7 js/enemies/green-slime.js:47-56, :83-105, trails.slime; spec M43): a Green Slime (any monsters.json row with
// trail 'slime', its splits too) leaves 1 poison damage a world pulse on every cell it leaves, for 10 game turns.
// Neutral ground: it hurts the hero, allies and creatures alike, not on the pulse it was laid, never the airborne, the
// sporeproof or the poison-immune. Drawn as 1.7's poison pool (realm-view.js slimeTrailLayer). A field (C10b).
const SLIME_TRAIL = { field: 'slime-trail', turns: 10, side: 'all', each: [{ verb: 'damage', amount: 1, type: 'poison', tags: ['periodic', 'environment', 'poison-trail'] }],
  perCell: true, overlap: 'strongest', lag: true, spare: ['sporeproof', 'poison-immune', 'poison-blocked'], cause: 'slime-trail', tell: 'Slime trail', known: true, quiet: true };
/** The trail a slime leaves on the cell it left (the tests lay one by hand through this). */
export function slimeTrail(state, a, events, from) {
  const f = state.floor;
  if (!from || a.hp <= 0 || MON.rows[a.kind]?.trail !== 'slime' || !walkable(f, from.x, from.y)) return;
  layField(state, SLIME_TRAIL, [from], null, events);
  events.push({ type: 'trail', at: { x: from.x, y: from.y } });
}
CREATURE_HOOKS.moved.push(slimeTrail);

// CH30 (1.7 chaos-enemies.js:119-124 onDamaged): a chaos creature hurt by the hero or his ally, not by a tick, hunts
// toward where the blow came from, so a shot from out of its sight does not wake it only to forget him the next turn.
CREATURE_HOOKS.damaged.push((state, t, packet, dealt) => {
  const src = packet.source;
  if (!(dealt > 0) || t.set !== 'chaos' || t.hp <= 0 || !src || (src.side !== 'player' && src.side !== 'ally') || packet.tags?.includes('periodic')) return;
  Object.assign(t, { hunting: true, asleep: false, lastSeen: { x: src.x, y: src.y, at: state.now } });
});
