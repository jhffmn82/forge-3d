// The Underdark's creatures and ground (spec/monsters.md M8, M42, M59, the Underdark rows of "Special moves", A28;
// spec/world.md 125, 150-152; 1.7 deepmobs.js DEEP_AI, webShot, throwDarkness, deepHatchTick and deep.js deepLavaBurn,
// deepLavaIgnite, cutWebCurtain @3c8b312). The hunting turn of every Underdark creature with a special passes through
// the shared hunt hook (set-pieces.js CREATURE_HOOKS.hunt): when it sees the hero its special goes first (1.7
// deepCreatureBehavior), else the generic hunter runs; their data moves are taken over here with 1.7's gates (straight
// lane, cooldowns on the world clock (M32), misses), so the generic move list is cleared on them. Drow see through darkness.
// On the world pulse: cocoons hatch, lava burns whoever stands beside it, and webs and grass beside lava catch.
// Damage and status strengths are fixed in monsters.json and biomes.json, independently of physical attacks.

import monsters from '../../data/monsters.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import biomes from '../../data/biomes.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import { CREATURE_HOOKS, PROP_BREAKS, PROP_USES } from './set-pieces.js';
import { makeItem } from './items.js';
import { prisonExit } from './prison.js';
import { chaosBody } from './monsters.js';
import { onPulse } from './pulse-hooks.js';
import { stepToward } from './ai-step.js';
import { dealDamage, heal as healBody } from './damage.js';
import { applyStatus, removeStatus, blocks } from './statuses.js';
import { creatureMoveLands } from './hit.js';
import { creatureSees } from './perception.js';
import { ready, spend } from './cooldowns.js';
import { stepAway as pathStepAway } from './path.js';
import { amount } from './amount.js';
import { makeCreature } from './monsters.js';
import { layField, fieldAt, ignite } from './fields.js';
import { tryStep, bodyAt, isWall } from './moves.js';
import { lineClear, refreshSight } from './sight.js';
import { next, roll } from '../lib/rng.js';
import { T, walkable, tileAt, G } from '../data/tiles.js';
import { cheb, D4, D8, lineCells } from '../lib/geometry.js';

const M = monsters.rows, P = props.rows, LAVA = biomes.rows['hazard-underdark-lava'];
const moveOf = (a, id) => M[a.kind]?.moves?.find(m => m.id === id);
const bodies = state => state.order.map(id => state.actors[id]).filter(b => b.hp > 0);
const log = (events, words, extra = {}) => events.push({ type: 'log', words, ...extra });
const isSpider = b => !!b.flags?.includes('spider');
const airborne = b => !!(b.flags?.includes('flying') || b.statuses?.levitate);


/** 1.7 boltPath / deepShot: the straight line to the hero (lib/geometry's round line) ends on the hero (no wall or body before). */
export const straightLane = (state, a, t) => cheb(a, t) > 0 && lineCells(a, t).slice(0, -1).every(c => !isWall(state.floor, c.x, c.y) && !bodyAt(state, c.x, c.y));

/** M6 (C10d): a special's hit roll at accuracy + bonus; at the hero his deflect, Blur and Lucky Streak answer it. */
const lands = (state, a, t, bonus, events, label) => creatureMoveLands(state, a, t, events, { accBonus: bonus, label });
/** The miss float, unless the hero's deflect already showed it. */
const missed = (events, t) => { if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: t.id }); };

/** A free walkable tile within r of (x, y) with no body or blocking prop, picked at random. */
function nearFree(state, x, y, r) {
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && !isWall(state.floor, nx, ny) && !bodyAt(state, nx, ny) && tileAt(state.floor, nx, ny) !== T.LAVA) out.push({ x: nx, y: ny });
  }
  return out.length ? out[Math.floor(next(state.rng) * out.length)] : null;
}

/** A step that takes it further from `from` (1.7 fleeStep, path.js); false when none does. */
const stepAway = (state, a, from, events) => pathStepAway(a, from, (dx, dy) => tryStep(state, a, dx, dy, events));

/** M11: darksight sees the hero inside darkness: within sight range and an open line (perception.js). */
const sees = (state, a, p) => creatureSees(state, a, p, { near: a.flags?.includes('darksight') ? 9 : 0 });

/** Webbed, then the web ground (M42); a miss webs a tile beside the hero (Web Spitter, Drider, the Matron). */
export function webShot(state, a, p, who, events) {
  const hit = lands(state, a, p, 8, events, 'Web');
  // hit: the web lands on the hero in a puff of silk (1.7 deepmobs.js:239 burst 'web' 22).
  events.push({ type: 'move-used', id: a.id, move: 'web-shot', name: 'Web', target: p.id, ranged: true, sfx: 'trap-web', hit });
  if (hit) {
    const held = !airborne(p) && !(isSpider(p)) && applyStatus(state, p, 'web', { turns: 1, source: a.id }, events);
    if (held) events.push({ type: 'float', id: p.id, words: 'webbed', tone: 'phys' });   // UD12 (deepmobs.js:239)
    webGround(state, a, p.x, p.y, events);
    log(events, `${who}: ${held ? 'Root 1 turn, Slow 3.' : 'web resisted.'}`);
  } else {
    const c = nearFree(state, p.x, p.y, 1);
    if (c) webGround(state, a, c.x, c.y, events);
    log(events, `${who}: web misses.`); missed(events, p);
  }
}

/**
 * M42: a 3x3 of web ground (open line from the centre; not water, chasm or lava) for 10 game turns. It lives in the
 * field row only (1.7 enemy-fields.js webGround), never in floor.ground: it fades over its last turn and is gone, fire
 * or water on a tile clears it (fields.js ignite, extinguish), and like 1.7's it does not itself catch fire.
 */
function webGround(state, a, x, y, events) {
  const f = state.floor, tiles = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, ny = y + dy, t = tileAt(f, nx, ny);
    if (!walkable(f, nx, ny) || t === T.WATER || t === T.CHASM || t === T.LAVA || !lineClear(f, { x, y }, { x: nx, y: ny })) continue;
    tiles.push({ x: nx, y: ny });
  }
  layField(state, { field: 'web', turns: 10, side: 'all' }, tiles, a, events);   // EP27: fieldEntered webs who walks in
}

/** Globe of Darkness: a 3x3 on the hero for 5 game turns; the hero sees one tile inside, drow see through (V8). */
function darkness(state, a, p, events) {
  const f = state.floor, tiles = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (tileAt(f, p.x + dx, p.y + dy) !== T.WALL) tiles.push({ x: p.x + dx, y: p.y + dy });
  const m = moveOf(a, 'darkness');
  layField(state, { field: 'darkness', turns: m?.effects?.[0]?.turns ?? 5, side: 'all' }, tiles, a, events);
  refreshSight(state, events);
  a.revealed = true;
  events.push({ type: 'move-used', id: a.id, move: 'darkness', name: 'Globe of Darkness', target: p.id, ranged: true, sfx: 'shaman-cast' });
  log(events, 'Darkness: your sight shrinks; drow see through it.');
}

/**
 * M32 (ruled 2026-10-16; C10d): a special waits game turns on the world clock (cooldowns.js), stunned or slowed or not.
 * 1.7 counted the creature's own special actions, its first wait a count down to zero: that wait less one is the first
 * wait in game turns here. The row's numbers when it has them, else 1.7's.
 */
const special = (state, a, id, first, cd) => {
  const m = moveOf(a, id), f = Array.isArray(m?.firstReady) ? roll(state.rng, m.firstReady[0], m.firstReady[1]) : m?.firstReady ?? first;
  return { id, firstReady: Math.max(0, f - 1), cooldown: m?.cooldown ?? cd };
};
const cdOf = (state, m) => (Array.isArray(m.cooldown) ? roll(state.rng, m.cooldown[0], m.cooldown[1]) : m.cooldown);
const rest = (state, a, m) => spend(state, a, m, cdOf(state, m));

/** The kinds whose turn this file takes, by kind (the rest of the roster are plain hunters with data passives). */
export const SPECIAL = {
  /** Drow Blade: now and then a globe of darkness on the hero (range 2-5, straight lane, not already dark). */
  drowblade(state, a, p, d, events) {
    const m = special(state, a, 'darkness', 2, 12);
    if (!ready(state, a, m) || d < 2 || d > 5 || fieldAt(state, p.x, p.y, 'darkness') || !straightLane(state, a, p)) return false;
    rest(state, a, m);
    darkness(state, a, p, events);
    return true;
  },
  /** Web Spitter: a web every 4 (range 2-5, straight lane, the hero not Rooted), then it comes in to bite. */
  webspitter(state, a, p, d, events) { return webber(state, a, p, d, events, 1, 4); },
  /** Drider: a web every 6 (first at 3); its bow is its ordinary ranged blow. */
  drider(state, a, p, d, events) { return webber(state, a, p, d, events, 3, 6); },
  /** Fire Imp: a fire bolt every action (range 2-6, straight lane) that Burns and lights the hero's tile; it backs off from melee. */
  fireimp(state, a, p, d, events) {
    const m = special(state, a, 'imp-bolt', 1, 1);
    if (ready(state, a, m) && d >= 2 && d <= 6 && straightLane(state, a, p)) {
      rest(state, a, m);
      events.push({ type: 'move-used', id: a.id, move: 'imp-bolt', name: 'Fire Bolt', target: p.id, ranged: true, sfx: 'shaman-cast' });
      if (lands(state, a, p, 6, events, 'Fire Bolt')) {
        const hit = moveOf(a, 'imp-bolt').effects[0], burn = hit.then[0];
        dealDamage(state, { target: p, source: a, amount: amount(hit.amount, { state, owner: a, source: a }), type: 'fire', tags: ['attack', 'spell', 'ranged'] }, events);
        if (p.hp > 0) applyStatus(state, p, 'burn', { turns: burn.turns, magnitude: amount(burn.magnitude, { state, owner: a, source: a }), source: a.id }, events);
        ignite(state, p.x, p.y, false, 3);
      } else {
        log(events, 'Fire Imp misses; ground ignited.'); missed(events, p);
        const c = nearFree(state, p.x, p.y, 1);
        if (c) ignite(state, c.x, c.y, false, 3);
      }
      return true;
    }
    return d <= 1 && !blocks(a, 'move') && stepAway(state, a, p, events);
  },
  /** Thought Eater: backs off within 2; from 2-6 on a straight lane a Mana Sap every 3 (else Mind Lash). */
  thoughteater(state, a, p, d, events) {
    const m = special(state, a, 'mind-sap', 1, 3);
    if (d <= 2 && !blocks(a, 'move') && stepAway(state, a, p, events)) return true;
    if (d < 2 || d > 6 || !straightLane(state, a, p)) return false;
    const sap = ready(state, a, m);   // a missed sap is tried again on its next action
    events.push({ type: 'move-used', id: a.id, move: sap ? 'mind-sap' : 'mind-lash', name: sap ? 'Mana Sap' : 'Mind Lash', target: p.id, ranged: true, sfx: 'shaman-cast' });
    if (!lands(state, a, p, 10, events, sap ? 'Mana Sap' : 'Mind Lash')) { log(events, `Thought Eater ${sap ? 'mana sap' : 'lash'} misses.`); missed(events, p); return true; }
    if (!sap) { dealDamage(state, { target: p, source: a, amount: amount(moveOf(a, 'mind-lash').effects[0].amount, { state, owner: a, source: a }), type: 'magic', tags: ['attack', 'spell', 'ranged'] }, events); return true; }
    rest(state, a, m);
    if ((p.mana ?? 0) >= 1) {
      const sapEffect = moveOf(a, 'mind-sap').effects[0].options[0].effects[0];
      const n = Math.min(Math.floor(p.mana), -amount(sapEffect.amount, { state, owner: a, source: a }));
      p.mana -= n;
      const h = Math.min(a.maxhp - a.hp, Math.round(n * sapEffect.ratio));
      if (h > 0) { a.hp += h; events.push({ type: 'healed', id: a.id, amount: h }); }
      log(events, `Thought Eater: -${n} Mana${h > 0 ? `; +${h} HP` : ''}.`);
      events.push({ type: 'mana', id: p.id, amount: -n }, { type: 'float', id: p.id, words: `-${n} mp`, tone: 'magic' });   // UD12 (deepmobs.js:327)
      if (n > 0) dealDamage(state, { target: p, source: a, amount: Math.max(1, Math.round(n * sapEffect.damageRatio)), type: 'magic', tags: ['spell', 'ranged'] }, events);
    } else {
      if (applyStatus(state, p, 'stun', { turns: 1, source: a.id }, events)) events.push({ type: 'float', id: p.id, words: 'dazed', tone: 'magic' });   // UD12 (deepmobs.js:333)
      log(events, 'Thought Eater: you Stunned (1 turn).');
    }
    return true;
  },
  /** Drow Priestess (1.7 DEEP_AI.priestess): keeps her distance, heals, calls spiderlings, wards, then blood bolts. */
  drowpriestess(state, a, p, d, events) {
    const P_ = a.params ?? {}, range = 6, HEAL = special(state, a, 'blood-heal', 0, 4), WARD = special(state, a, 'blood-ward', 2, 7), CALL = special(state, a, 'call-spiderlings', 1, 9);
    for (const m of [HEAL, WARD, CALL]) ready(state, a, m);   // their first waits start at her first action
    if (d <= (P_.retreatWithin ?? 3) && !blocks(a, 'move') && stepAway(state, a, p, events)) return true;
    const near = o => o !== a && o.side === a.side && o.hp > 0 && !o.owner && o.hunting && o.family === 'underdark' && cheb(o, a) <= range && lineClear(state.floor, a, o);
    const heal = idle => {
      if (!idle && !ready(state, a, HEAL)) return false;
      const hurt = bodies(state).filter(o => near(o) && o.hp < o.maxhp * (idle ? 1 : 0.65) && !o.flags?.includes('object')).sort((x, y) => x.hp / x.maxhp - y.hp / y.maxhp)[0];
      if (!hurt) return false;
      rest(state, a, HEAL);
      let h = Math.round(hurt.maxhp * 0.5);
      if (hurt.statuses.rot) h = Math.floor(h * 0.5);
      h = Math.min(h, hurt.maxhp - hurt.hp);
      hurt.hp += h;
      if (hurt.statuses.bleed) removeStatus(state, hurt, 'bleed', events);
      events.push({ type: 'move-used', id: a.id, move: 'blood-heal', name: 'Heal', target: hurt.id, sfx: 'shaman-cast' }, { type: 'healed', id: hurt.id, amount: h });
      log(events, `Priestess heals ${hurt.name}: +${h} HP.`);
      return true;
    };
    const ward = idle => {
      if (!idle && !ready(state, a, WARD)) return false;
      const front = bodies(state).filter(o => near(o) && !o.statuses.wardshield && !o.flags?.includes('object')).sort((x, y) => cheb(x, p) - cheb(y, p))[0];
      if (!front) return false;
      rest(state, a, WARD);
      const effect = moveOf(a, 'blood-ward').effects[0];
      applyStatus(state, front, 'wardshield', { turns: effect.turns, magnitude: amount(effect.magnitude, { state, owner: a, source: a }), source: a.id }, events);
      events.push({ type: 'move-used', id: a.id, move: 'blood-ward', name: 'Blood Ward', target: front.id, sfx: 'shaman-cast' });
      log(events, `${front.name}: Blood Ward.`);
      return true;
    };
    if (heal(false)) return true;
    if (ready(state, a, CALL)) {
      const mine = bodies(state).filter(o => o.kind === 'spiderling' && o.side === 'foe' && o.owner === a.id).length;
      const all = bodies(state).filter(o => o.kind === 'spiderling' && o.side === 'foe').length;
      if (mine < 2 && all < 8) {
        const n = Math.min(roll(state.rng, 1, 2), 2 - mine, 8 - all);
        let got = 0;
        for (let k = 0; k < n; k++) {
          const c = nearFree(state, a.x, a.y, 1) ?? nearFree(state, a.x, a.y, 2);
          if (!c) break;
          spawn(state, 'spiderling', c, { owner: a.id, noLoot: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: a.t }, events);
          got++;
        }
        if (got) {
          rest(state, a, CALL);
          events.push({ type: 'move-used', id: a.id, move: 'call-spiderlings', name: 'Call Spiderlings', sfx: 'shaman-cast' });
          log(events, `Priestess: ${got} Spiderling${got === 1 ? '' : 's'} summoned.`);
          return true;
        }
      }
    }
    if (ward(false)) return true;
    if (d <= range && lineClear(state.floor, a, p) && straightLane(state, a, p)) {
      events.push({ type: 'move-used', id: a.id, move: 'blood-bolt', name: 'Blood Bolt', target: p.id, ranged: true, sfx: 'shaman-cast' });
      if (lands(state, a, p, 6, events, 'Blood Bolt')) {
        const dealt = dealDamage(state, { target: p, source: a, amount: amount(moveOf(a, 'blood-bolt').effects[0].amount, { state, owner: a, source: a }), type: 'dark', tags: ['attack', 'spell', 'ranged'] }, events);
        healBody(state, a, a.statuses.rot ? Math.floor(dealt * 0.5) : dealt, events);   // none once the answer to it killed her (item 174)
      } else { log(events, 'Priestess blood bolt misses.'); missed(events, p); }
      return true;
    }
    if (d > range && !blocks(a, 'move') && stepToward(state, a, p, events)) return true;
    if (!heal(true)) ward(true);
    return true;
  },
};

function webber(state, a, p, d, events, first, cd) {
  const m = special(state, a, 'web-shot', first, cd);
  if (!ready(state, a, m) || d < 2 || d > 5 || p.statuses.root || p.statuses.web || !straightLane(state, a, p)) return false;
  rest(state, a, m);
  webShot(state, a, p, a.name, events);
  return true;
}

/** A creature placed by a rule (summons, hatchlings): hunting, on the hero's clock. */
export function spawn(state, kind, at, extra, events) {
  const m = makeCreature(kind, at.x, at.y);
  Object.assign(m, { hunting: true, asleep: false, caughtOff: state.actions, summon: !!extra.owner, ...extra });
  if (extra.noLoot) m.drops = 'kill-none';
  prepare(m);
  state.actors[m.id] = m; state.order.push(m.id);
  events.push({ type: 'spawned', id: m.id, at: { x: at.x, y: at.y }, summon: !!extra.owner });
  return m;
}

/** Takes over a special creature's moves (its gates live here) and its keep-away (in its special). */
export function prepare(a) {
  // Sandbox U9: the Fire plane's Magma Crawler in the volcanic caves; its passives are planes.js's own code, which
  // runs for it here too, and its kin are spared its burst (plane-native).
  if (a.kind === 'magmacrawler' && !a.udReady) { a.udReady = true; a.passives = []; a.flags = [...new Set([...(a.flags ?? []), 'plane-native'])]; return; }
  if (a.udReady || !SPECIAL[a.kind]) return;
  a.udReady = true; a.moves = null;
  if (a.behaviour === 'caster' || a.behaviour === 'support-caster') a.behaviour = 'hunter';
}

/** M24: the Underdark specials, after perception and before the basic hunter. */
CREATURE_HOOKS.hunt.push((state, a, p, ctx, events) => {
  if (!SPECIAL[a.kind]) return false;
  prepare(a);
  if (a.statuses.fear || !(ctx.sees || sees(state, a, p))) return false;
  a.lastSeen = { x: p.x, y: p.y, at: state.now };
  return !!SPECIAL[a.kind]?.(state, a, p, cheb(a, p), events);
});

/** A28 (answer 7): a marked cocoon the hero can see within 2 bursts into Spiderlings (3-5 large, 2-3 small). */
export function hatchCocoons(state, events) {
  const f = state.floor, p = state.actors[state.playerId];
  if (!f?.props?.length || p.hp <= 0) return;
  for (const c of f.props.filter(q => q.hatch && !q.hatched && !q.part)) {
    const w = c.w ?? 1, h = c.h ?? 1;
    let near = false, seen = false, close = false;
    for (let y = c.y; y < c.y + h; y++) for (let x = c.x; x < c.x + w; x++) { if (state.vis?.[y * f.w + x]) seen = true; if (cheb(p, { x, y }) <= 2) near = true; if (cheb(p, { x, y }) <= 3) close = true; }
    // Sandbox U2 (Justin, 2026-10-16): a cocoon the hero sees within 3 stirs before it bursts, so a hatch is a warning.
    const stir = seen && close;
    if (!!c.stirring !== stir) { c.stirring = stir; events.push({ type: 'cocoon-stir', at: { x: c.x, y: c.y }, on: stir }); }
    if (!near || !seen) continue;
    c.hatched = true;
    f.props = f.props.filter(q => q !== c && !(q.part && q.part.x === c.x && q.part.y === c.y && q.id === c.id));
    const tiles = [];
    for (let y = c.y; y < c.y + h; y++) for (let x = c.x; x < c.x + w; x++) { tiles.push({ x, y }); if (walkable(f, x, y) && !f.ground[y * f.w + x]) f.ground[y * f.w + x] = G.WEB; }
    const big = /large|sac/.test(c.id), hc = P[c.id]?.hatchCount ?? (big ? [3, 5] : [2, 3]), n = roll(state.rng, hc[0], hc[1]);
    let got = 0;
    for (let k = 0; k < n; k++) {
      const at = k === 0 && walkable(f, c.x, c.y) && !bodyAt(state, c.x, c.y) ? { x: c.x, y: c.y } : nearFree(state, c.x, c.y, 1) ?? nearFree(state, c.x, c.y, 2);
      if (!at) continue;
      spawn(state, 'spiderling', at, { lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t }, events);
      got++;
    }
    // UD4 (1.7 deepHatchTick): silk bursts off every tile it covered, the web sound, a small shake; the ground event
    // redraws the webbing left on its tiles.
    events.push({ type: 'hatched', at: { x: c.x, y: c.y }, tiles, n: got, sfx: 'trap-web', shake: 3 }, { type: 'ground', at: { x: c.x, y: c.y } });
    log(events, `Cocoon: ${got}${got === 1 ? ' Spiderling hatches.' : ' Spiderlings hatch.'}`);
  }
}

/** B4, A27 on the world pulse (ruled on, answer 4): beside lava burns; grass, web ground and webs beside lava catch. */
export function lavaPulse(state, events) {
  const f = state.floor;
  if (!f?.lava) return;
  const beside = (x, y) => D4.some(([dx, dy]) => tileAt(f, x + dx, y + dy) === T.LAVA);
  const dmgOf = () => amount(LAVA.effects[0].effects[0].amount, { state });
  for (const b of bodies(state)) {
    if (!beside(b.x, b.y) || (b.side === 'player' && b.statuses.levitate)) continue;
    const dealt = dealDamage(state, { target: b, source: null, amount: dmgOf(), type: 'fire', tags: ['environment'], cause: 'lava' }, events);
    if (b.side === 'player' && !f.lavaWarned) { f.lavaWarned = true; log(events, `Lava: ${dealt}. Move away!`); }
  }
  for (let i = 0; i < f.tiles.length; i++) {
    if (f.tiles[i] !== T.LAVA) continue;
    const x = i % f.w, y = (i / f.w) | 0;
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h || f.burning?.[ny * f.w + nx]) continue;
      const g = f.ground[ny * f.w + nx], pr = f.props.find(q => q.x === nx && q.y === ny);
      if (g === G.GRASS || g === G.SHORT || g === G.WEB || (pr && ((pr.burnable ?? P[pr.id]?.burnable) || P[pr.id]?.web))) ignite(state, nx, ny, false);
    }
  }
}


/** Sandbox U3 (Justin, 2026-10-16): the first web curtain the hero sees on a floor says how it goes. */
export function curtainHint(state, events) {
  const f = state.floor;
  if (f.curtainHinted || !state.vis) return;
  if (!f.props.some(p => P[p.id]?.curtain && state.vis[p.y * f.w + p.x])) return;
  f.curtainHinted = true;
  log(events, 'A web curtain blocks the tunnel. One blow cuts it; fire burns it away.');
}

/**
 * Sandbox U12 (Justin, 2026-10-16): fire through the webs pays off. A cocoon that burning ground reaches (its tiles
 * or beside them) burns with its brood inside: it never hatches, and leaves a little essence (5-10 + floor/2) where it hung.
 */
export function burnCocoons(state, events) {
  const f = state.floor;
  if (!f.burning || !Object.keys(f.burning).length) return;
  for (const c of f.props.filter(q => q.hatch && !q.hatched && !q.part)) {
    const w = c.w ?? 1, h = c.h ?? 1;
    let hot = false;
    for (let y = c.y - 1; y <= c.y + h && !hot; y++) for (let x = c.x - 1; x <= c.x + w; x++) if (f.burning[y * f.w + x]) { hot = true; break; }
    if (!hot) continue;
    c.hatched = true;
    f.props = f.props.filter(q => q !== c && !(q.part && q.part.x === c.x && q.part.y === c.y && q.id === c.id));
    const n = roll(state.rng, 5, 10) + Math.floor(state.floorNo / 2);
    f.items.push({ x: c.x, y: c.y, item: { kind: 'essence', n } });
    events.push({ type: 'cocoon-burned', at: { x: c.x, y: c.y }, sfx: 'fire-ignite' }, { type: 'drops', at: { x: c.x, y: c.y } });
    if (state.vis?.[c.y * f.w + c.x]) log(events, 'A cocoon burns; the brood inside dies.');
  }
}

/**
 * UD17, 1.7 deep.js cutWebCurtain: a web curtain cut with a blow rustles at half volume (step-grass at 0.5), throws a
 * puff of white strands (burst 'ice' 12 at 0.04) and says so.
 */
PROP_BREAKS.push((state, p, events) => {
  if (!P[p.id]?.curtain) return;
  const ev = events.findLast(e => e.type === 'prop-broken' && e.at?.x === p.x && e.at?.y === p.y);
  if (ev) { ev.volume = 0.5; ev.burst = { type: 'ice', n: 12, spread: 0.04 }; }
  log(events, 'You cut through the web.');
});

// ---------------------------------------------------------------- the silk survivor (rooms.json silk-survivor)
const shuffled = (state, list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next(state.rng) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const DOORISH = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.ICE_DOOR, T.THORNS, T.TOLL, T.SEALED, T.SECRET]);
const openFloor = (state, c) => walkable(state.floor, c.x, c.y) && !state.floor.props.some(q => q.x === c.x && q.y === c.y && P[q.id]?.blocks) && !bodyAt(state, c.x, c.y);
/** A creature the event calls up: hunting the hero, its first turn a game turn after the hero's (1.7 summon). */
function summon(state, kind, c, events) {
  const p = state.actors[state.playerId];
  return spawn(state, kind, c, { lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t + 100 }, events);
}

/**
 * WC12, G45 (1.7 world.js interactUncommonEvent silk-survivor, sigil-adapter.js resolveUncommonRewards): cutting the
 * silk-wrapped traveler free. He steps out as an ally to escort to the upstairs (prison.js: the escort reward, a ring
 * or amulet); up to 12 spiderlings flood the room and a drider waits just outside a mouth; he leaves two special foods
 * and a mapping sigil near where he hung.
 */
PROP_USES['silk-wrapped-traveler'] = (state, prop, events) => {
  const f = state.floor, p = state.actors[state.playerId], ev = prop.silk ?? { cells: [], mouths: [], area: [] };
  const cells = shuffled(state, ev.cells).filter(c => openFloor(state, c) && !(c.x === p.x && c.y === p.y) && !(c.x === prop.x && c.y === prop.y));
  f.props = f.props.filter(q => q !== prop);
  const exit = prisonExit(f);
  const m = makeCreature('silk-survivor-human', prop.x, prop.y);
  Object.assign(m, { side: 'ally', asleep: false, hunting: false, t: p.t + 100, escapee: true, silkEscort: { state: 'active' }, escapeExit: exit ? { x: exit.x, y: exit.y } : null, noXp: true, noLoot: true, drops: 'kill-none' });
  state.actors[m.id] = m; state.order.push(m.id);
  events.push({ type: 'spawned', id: m.id, at: { x: m.x, y: m.y } });
  for (const c of cells.filter(q => !bodyAt(state, q.x, q.y)).slice(0, 12)) summon(state, 'spiderling', c, events);
  // The drider: on the first open cell just outside a mouth (through a doorway when the mouth opens on a door).
  const inside = new Set(ev.area), outside = [];
  for (const mo of ev.mouths) for (const [dx, dy] of D4) {
    let x = mo.x + dx, y = mo.y + dy;
    if (inside.has(y * f.w + x)) continue;
    if (DOORISH.has(tileAt(f, x, y))) { x += dx; y += dy; }
    if (x >= 0 && y >= 0 && x < f.w && y < f.h && !inside.has(y * f.w + x) && tileAt(f, x, y) === T.FLOOR && openFloor(state, { x, y }) && !f.props.some(q => q.x === x && q.y === y) && !(p.x === x && p.y === y)) outside.push({ x, y });
  }
  if (outside.length) summon(state, 'drider', outside[0], events);
  // Two different special foods (any biome's, or the Underdark's) and a mapping sigil, near the traveler.
  const pool = Object.entries(foods.rows).filter(([, r]) => r.kind === 'food' && r.special && (!r.biome || r.biome === 4)).map(([id]) => id);
  const first = pool[Math.floor(next(state.rng) * pool.length)], rest = pool.filter(id => id !== first), second = rest[Math.floor(next(state.rng) * rest.length)];
  for (const it of [{ ...makeItem(first), count: 1 }, { ...makeItem(second), count: 1 }, { kind: 'sigil', id: 'mapping', count: 1 }]) {
    const at = nearFree(state, prop.x, prop.y, 2) ?? { x: p.x, y: p.y };
    f.items.push({ x: at.x, y: at.y, item: it });
    events.push({ type: 'drops', at });
  }
  events.push({ type: 'log', words: 'The traveler leaves two special foods and a mapping sigil. Spiderlings flood the room! Escort him to the upstairs for a ring or amulet.', sfx: 'pickup-item' });
  refreshSight(state, events);
  return 'act';
};

/** WC12 (1.7 death-adapter.js prepareCreatureDeath): the traveler falls; the escort is lost and says so. */
CREATURE_HOOKS.death.push((state, a, by, events) => {
  if (!a.silkEscort) return;
  a.silkEscort.state = 'failed';
  log(events, 'The rescued traveler falls. The escort is lost.', { cls: 'c-you' });
});

// ---------------------------------------------------------------- the ritual (rooms.json ritual; S29)
const RITUAL_LOGS = ['A priestess draws blood from a captive. The ritual has begun.', 'The ritual breaks. The captive is still alive.', 'The captive falls. A Horned Reaver and Gorehound tear through the ritual!'];
/** 1.7 ritualPriestAvailable: alive, not won over, not stunned, frozen, turned to stone, afraid or silenced. */
const priestFree = a => !!(a && a.hp > 0 && a.side !== 'ally' && !['stun', 'frozen', 'stone', 'fear', 'silence'].some(s => a.statuses?.[s]));
const ritualOf = (state, a) => (state.floor?.rooms ?? []).find(r => r.ritual && r.ritual.priestId === a.id && !r.ritual.finished);

/** WC13, 1.7 ritualChannel: while her ritual runs the priestess keeps to her post, channelling, and does nothing else. */
CREATURE_HOOKS.act.push((state, a, events) => {
  if (a.kind !== 'drowpriestess' || !a.ritualPriest) return false;
  const r = ritualOf(state, a);
  if (!r || !priestFree(a)) return false;
  const post = r.ritual.post;
  if (post && cheb(a, post) > 0 && !blocks(a, 'move')) stepToward(state, a, post, events);
  return true;
});

/**
 * WC13, 1.7 turnRitualRooms (each world pulse): the ritual starts when the cage or the priestess comes into sight;
 * while she stands free on her post the captive loses 2 a turn ('-2' over the cage). Freed, it ends; she dead or won
 * over, it breaks; at 0 the captive dies and a Horned Reaver and a Gorehound tear through, hunting the hero.
 */
export function ritualPulse(state, events) {
  const f = state.floor, p = state.actors[state.playerId];
  for (const r of f.rooms ?? []) {
    const z = r.ritual;
    if (!z || z.finished) continue;
    const cage = f.props.find(q => q.x === z.cage.x && q.y === z.cage.y && q.ritual), priest = state.actors[z.priestId];
    if (!cage || !cage.prisoner) { z.finished = true; z.outcome = 'rescued'; continue; }
    if (!priest || priest.hp <= 0 || priest.side === 'ally') { z.finished = true; z.outcome = 'interrupted'; if (z.active) log(events, RITUAL_LOGS[1]); continue; }
    if (!z.active) {
      if (state.vis?.[cage.y * f.w + cage.x] || state.vis?.[priest.y * f.w + priest.x]) { z.active = true; priest.hunting = true; priest.asleep = false; log(events, RITUAL_LOGS[0]); }
      continue;
    }
    if (!priestFree(priest) || (z.post && cheb(priest, z.post) > 0)) continue;
    z.hp = Math.max(0, z.hp - 2); cage.captiveHp = z.hp;
    events.push({ type: 'float', at: { x: cage.x, y: cage.y }, words: '-2', tone: 'blood' });
    if (z.hp > 0) continue;
    cage.prisoner = null; z.finished = true; z.outcome = 'summoned'; f.ritualChaos = true;
    const spots = shuffled(state, z.cells ?? []).filter(c => openFloor(state, c) && cheb(c, p) > 1 && !D8.some(([dx, dy]) => DOORISH.has(tileAt(f, c.x + dx, c.y + dy))) && !(z.mouths ?? []).some(m => cheb(c, m) <= 1));
    for (const kind of ['chaos-horned-reaver', 'chaos-gorehound']) {
      const c = spots.shift();
      if (!c) continue;
      const e = chaosBody(kind, c.x, c.y, 'ritual-incursion', { asleep: false, wait: 0 });
      Object.assign(e, { hunting: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t + 100 });
      state.actors[e.id] = e; state.order.push(e.id);
      events.push({ type: 'spawned', id: e.id, at: { x: e.x, y: e.y } });
    }
    events.push({ type: 'log', words: RITUAL_LOGS[2], sfx: 'portal' });
  }
}

onPulse('underdark', (state, events) => {
  if (state.floor?.biome !== 'underdark') return;
  for (const id of state.order) prepare(state.actors[id]);
  curtainHint(state, events);
  burnCocoons(state, events);
  hatchCocoons(state, events);
  lavaPulse(state, events);
  ritualPulse(state, events);
});
