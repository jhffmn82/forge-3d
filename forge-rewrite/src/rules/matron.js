// The Matron of the Web, floor 20 (spec/bosses.md MA1-MA10; bosses.json matron; 1.7 deepmobs.js matronAct,
// matronStartRitual, matronFinish, matronBrood, matronVenomTick, deepEnsureExit @3c8b312). She waits on her throne;
// awake she channels rituals on the hall's circles (Blood Tithe or Brood Call, broken by enough damage or by Stun,
// Freeze or Fear), rains venom on a marked 3x3, webs from range, bites, and shrieks for reinforcements at 66% and 33%.
// Her timers count game turns on the world clock (rulings 2026-10-16); her venom lands on that clock even while she
// is stunned (A29), and a ritual is checked for breaking on every pulse, since a stunned body gets no action.

import bosses from '../../data/bosses.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import { warningWords } from './telegraph.js';
import { roll, next } from '../lib/rng.js';
import { weaponAttack } from './attack.js';
import { dealDamage, heal } from './damage.js';
import { applyStatus } from './statuses.js';
import { amount } from './amount.js';
import { ready, spend } from './cooldowns.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { cheb } from '../lib/geometry.js';
import { stepToward } from './ai-step.js';
import { registerSetPiece, CREATURE_HOOKS } from './set-pieces.js';
import { onPulse } from './pulse-hooks.js';
import { bodyAt, isWall } from './moves.js';
import { lineClear } from './sight.js';
import { T, walkable, tileAt } from '../data/tiles.js';
import { webShot, straightLane, spawn } from './underdark.js';

const B = bosses.rows.matron, TURN = tuning.rows.clock.unitsPerGameTurn;
const MOVES = Object.fromEntries(B.actions[0].moves.map(m => [m.id, m]));
const TITHE_HIT = MOVES.ritual.effects[1].then[0].options.find(o => o.label === 'tithe').effects[0];
const VENOM_HIT = MOVES['venom-rain'].effects[0].then[0];
const RIT_TURNS = 3, RIT_BREAK = 0.08, RIT_EVERY = [8, 6, 5], PHASES = [0.66, 0.33];
/** M32 (C10d): her venom and web wait game turns on the world clock; 1.7 counted her actions (first at 3 and 2, then 5). */
const VENOM = { id: 'venom-rain', firstReady: 2, cooldown: 5 }, WEB = { id: 'web-shot', firstReady: 1, cooldown: 5 };
/**
 * The world-clock time n game turns past the start of this one (C10d: her stamps are units, not game-turn numbers, so
 * a stored floor's pause moves them as it moves every other stamp; before, it shifted them 100 times too far).
 */
const turnsOn = (state, n) => (Math.floor(state.now / TURN) + n) * TURN;
const log = (events, words, extra = {}) => events.push({ type: 'log', words, ...extra });
const inArena = (A, p) => !!A && p.x >= A.x && p.y >= A.y && p.x < A.x + A.w && p.y < A.y + A.h;
const reeled = a => !!(a.statuses.stun || a.statuses.frozen || a.statuses.fear);
const seesHero = (state, a, p) => !p.statuses?.hidden && !a.statuses?.blind && (!!state.vis?.[a.y * state.floor.w + a.x] || (cheb(a, p) <= 9 && lineClear(state.floor, a, p)));

function nearFree(state, x, y, r) {
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if ((dx || dy) && !isWall(state.floor, nx, ny) && !bodyAt(state, nx, ny) && tileAt(state.floor, nx, ny) !== T.LAVA) out.push({ x: nx, y: ny });
  }
  return out.length ? out[Math.floor(next(state.rng) * out.length)] : null;
}

/** Her state, kept on her body as plain data. */
const mt = a => (a.mt ??= { phase: 0, rit: null, nextRitAt: 0, venom: null, n: 0 });

/** The ritual circle's prop (head and parts) lit or dark. */
function lightCircle(state, circle, on) {
  if (!circle) return;
  for (const p of state.floor.props) if (/^ritual-circle/.test(p.id) && ((p.x === circle.x && p.y === circle.y) || (p.part && p.part.x === circle.x && p.part.y === circle.y))) p.id = on ? 'ritual-circle-active' : 'ritual-circle';
}
const clearMarks = (state, a, kind) => { state.floor.marks = (state.floor.marks ?? []).filter(m => !(m.owner === a.id && (!kind || m.kind === kind))); };

/** MA2: she wakes when the hero enters the hall or she sees the hero within 7. */
function wake(state, a, p, events) {
  const M = mt(a);
  a.throne = false; a.hunting = true; a.asleep = false; a.caughtOff = -1; a.lastSeen = { x: p.x, y: p.y, at: state.now };
  M.nextRitAt = turnsOn(state, 4);
  log(events, 'The Matron awakens!');
  events.push({ type: 'boss', id: a.id, name: a.name, state: 'awake', music: B.music, sfx: B.wake.sfx, shake: B.wake.shake });
  for (const id of state.order) { const g = state.actors[id]; if (g.guardOf === a.id && g.hp > 0) { g.hunting = true; g.asleep = false; g.lastSeen = { x: p.x, y: p.y, at: state.now }; } }
}

/** MA4, MA7: a Drider (2 alive at most) and Spiderlings (8 alive on the floor at most), no loot. */
function brood(state, a, driders, spiders, why, events) {
  const p = state.actors[state.playerId], live = k => state.order.map(id => state.actors[id]).filter(o => o.hp > 0 && o.kind === k && o.side === 'foe').length;
  const got = [];
  for (let i = 0; i < driders && live('drider') < 2; i++) {
    const c = nearFree(state, a.x, a.y, 2) ?? nearFree(state, a.x, a.y, 3);
    if (!c) break;
    spawn(state, 'drider', c, { owner: a.id, noLoot: true, matronBrood: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t }, events);
    got.push('a Drider');
  }
  let n = 0;
  for (let k = 0; k < spiders && live('spiderling') < 8; k++) {
    const c = nearFree(state, a.x, a.y, 2);
    if (!c) break;
    spawn(state, 'spiderling', c, { owner: a.id, noLoot: true, matronBrood: true, lastSeen: { x: p.x, y: p.y, at: state.now }, t: p.t }, events);
    n++;
  }
  if (n) got.push(`${n > 1 ? n : 'a'} Spiderling${n > 1 ? 's' : ''}`);
  log(events, `${why}: ${got.length ? got.join(' and ') + ' summoned.' : 'no summons.'}`);
}

/** MA5: a ritual on the circle farthest from the hero with a free tile; she drops onto it and channels 3 game turns. */
function startRitual(state, a, p, events) {
  const M = mt(a), A = state.floor.bossArena;
  const kinds = M.phase >= 2 ? ['tithe', 'brood', 'tithe'] : ['tithe', 'brood'], kind = kinds[M.n % kinds.length];
  let circle = null, spot = null;
  if (A?.circles?.length && !a.statuses.root && !a.statuses.web) {
    for (const c of A.circles.slice().sort((u, v) => cheb(v, p) - cheb(u, p))) {
      const free = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).filter(q => (q.x === a.x && q.y === a.y) || (walkable(state.floor, q.x, q.y) && !bodyAt(state, q.x, q.y)));
      if (free.length) { circle = c; spot = free[0]; break; }
    }
  }
  if (spot && !(spot.x === a.x && spot.y === a.y)) { const from = { x: a.x, y: a.y }; a.x = spot.x; a.y = spot.y; events.push({ type: 'teleported', id: a.id, from, to: { ...spot } }); }
  const tiles = circle ? [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => ({ x: circle.x + dx, y: circle.y + dy }))
    : [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ x: a.x + dx, y: a.y + dy }))).filter(q => walkable(state.floor, q.x, q.y));
  M.rit = { kind, at: turnsOn(state, RIT_TURNS), hp0: a.hp, need: Math.max(1, Math.round(a.maxhp * RIT_BREAK)), circle, tiles };
  lightCircle(state, circle, true);
  clearMarks(state, a, 'matron-rit');
  (state.floor.marks ??= []).push({ owner: a.id, kind: 'matron-rit', tiles, warning: 'warn.matron.ritual', colour: ui.warningColours['warn.matron.ritual'] });
  events.push({ type: 'telegraph', id: a.id, tiles, warning: 'warn.matron.ritual' });   // UD1 (deepmobs.js:485): the circle lights and its tiles show now
  M.n++; M.nextRitAt = turnsOn(state, RIT_TURNS + RIT_EVERY[Math.min(2, M.phase)]);
  const name = kind === 'tithe' ? 'Blood Tithe' : 'Brood Call';
  events.push({ type: 'move-used', id: a.id, move: 'ritual', name, sfx: 'shaman-cast', shake: 4 });
  log(events, `${name}: deal ${M.rit.need} damage in ${RIT_TURNS} turns, or Stun.`, { warning: true });
}

function endRitual(state, a, events) {
  const M = mt(a);
  lightCircle(state, M.rit?.circle, false);
  clearMarks(state, a, 'matron-rit');
  M.rit = null;
  events?.push({ type: 'telegraph-end', id: a.id });   // UD2: the circle and its tiles clear at once
}

/** MA6: broken by its damage, or by Stun, Freeze or Fear: it ends and she is Stunned 1. */
function breakCheck(state, a, events) {
  const M = mt(a);
  if (!M.rit || !(reeled(a) || M.rit.hp0 - a.hp >= M.rit.need)) return false;
  endRitual(state, a, events);
  applyStatus(state, a, 'stun', { turns: 1, source: state.playerId }, events);
  events.push({ type: 'float', id: a.id, words: 'broken!', tone: 'magic', big: true, sfx: 'parry' });   // UD16 (deepmobs.js:500-501)
  log(events, 'Ritual broken. Matron Stunned.');
  return true;
}

/** MA7: a finished ritual. */
function finishRitual(state, a, events) {
  const M = mt(a), R = M.rit, p = state.actors[state.playerId];
  endRitual(state, a, events);
  events.push({ type: 'boss-move', id: a.id, move: R.kind, shake: 10, sfx: 'explosion' });
  if (R.kind === 'tithe') {
    const raw = Math.min(amount(TITHE_HIT.amount, { state, owner: a, source: a }), Math.round(p.maxhp * TITHE_HIT.capPctMaxHp / 100));
    const dealt = dealDamage(state, { target: p, source: a, amount: raw, type: 'dark', tags: ['spell'] }, events);
    log(events, `Blood Tithe: ${dealt}.`);
    const bleed = TITHE_HIT.then.find(e => e.verb === 'apply-status');
    if (p.hp > 0) applyStatus(state, p, 'bleed', { turns: bleed.turns, magnitude: amount(bleed.magnitude, { state, owner: a, source: a }), source: a.id }, events);
    const h = heal(state, a, dealt * 2, events);   // item 174: none if the hero's answer to the tithe killed her
    if (h > 0) log(events, `Matron: +${h} HP.`);
  } else brood(state, a, 1, roll(state.rng, 2, 3), 'Brood Call', events);
}

/** MA8, A29: venom lands on its own clock (even while she is stunned): the hero and allies on the marks. */
function venomLand(state, a, events) {
  const M = mt(a), V = M.venom;
  if (!V || state.now < V.at || state.actions <= V.shownIn) return;
  M.venom = null;
  clearMarks(state, a, 'matron-venom');
  events.push({ type: 'telegraph-end', id: a.id });   // UD2: the venom's red tiles go as it lands
  events.push({ type: 'boss-move', id: a.id, move: 'venom-rain', sfx: 'trap-gas', tiles: V.tiles });
  for (const t of state.order.map(id => state.actors[id])) {
    if (t.hp <= 0 || (t.side !== 'player' && t.side !== 'ally') || !V.tiles.some(c => c.x === t.x && c.y === t.y)) continue;
    let raw = amount(VENOM_HIT.amount, { state, owner: a, source: a });
    if (t.side === 'player') raw = Math.min(raw, Math.round(t.maxhp * VENOM_HIT.capPctMaxHp / 100));
    const dealt = dealDamage(state, { target: t, source: a, amount: raw, type: 'poison', tags: ['spell', 'area'] }, events);
    if (t.side === 'player') log(events, `Venom Rain: ${dealt}.`);
    const poison = VENOM_HIT.then[0];
    if (t.hp > 0) applyStatus(state, t, 'poison', { turns: poison.turns, tickDamage: amount(poison.tickDamage, { state, owner: a, source: a }), source: a.id }, events);
  }
}

/** MA3: her action. */
function matron(state, a, events) {
  const p = state.actors[state.playerId], M = mt(a), A = state.floor.bossArena;
  if (a.hp <= 0 || p.hp <= 0) return;
  const see = seesHero(state, a, p), d = cheb(a, p);
  if (a.throne || !a.hunting) { if (inArena(A, p) || (see && d <= 7)) wake(state, a, p, events); return; }
  if (breakCheck(state, a, events)) return;
  if (a.statuses.stun || a.statuses.frozen) return;
  if (see) a.lastSeen = { x: p.x, y: p.y, at: state.now };
  // MA4: the phase shrieks (cost her action).
  if (M.phase < 2 && a.hp / a.maxhp < PHASES[M.phase]) {
    M.phase++;
    events.push({ type: 'boss-move', id: a.id, move: 'shriek', sfx: B.wake.sfx, shake: 10 });
    brood(state, a, 1, M.phase === 1 ? 2 : 3, 'Matron reinforcements', events);
    return;
  }
  if (M.rit) {
    const left = Math.ceil((M.rit.at - state.now) / TURN);
    if (left <= 0) finishRitual(state, a, events);
    else {
      // UD7: blood wisps rise off her while she channels (1.7 deepmobs.js:570 burst 'blood' 12).
      events.push({ type: 'boss-move', id: a.id, move: 'channel' });
      if (state.vis?.[a.y * state.floor.w + a.x]) log(events, `Ritual: ${left} turn${left === 1 ? '' : 's'}; ${Math.max(0, M.rit.hp0 - a.hp)}/${M.rit.need} damage.`);
    }
    return;
  }
  if (state.now >= M.nextRitAt) { startRitual(state, a, p, events); return; }
  if (!M.venom && ready(state, a, VENOM) && see && d >= 2) {
    const tiles = [-1, 0, 1].flatMap(dy => [-1, 0, 1].map(dx => ({ x: p.x + dx, y: p.y + dy }))).filter(q => walkable(state.floor, q.x, q.y));
    M.venom = { tiles, at: turnsOn(state, 2), shownIn: state.actions };
    spend(state, a, VENOM);
    clearMarks(state, a, 'matron-venom');
    (state.floor.marks ??= []).push({ owner: a.id, kind: 'matron-venom', tiles, warning: 'warn.matron.venom', colour: ui.warningColours['warn.matron.venom'] });
    events.push({ type: 'telegraph', id: a.id, tiles, warning: 'warn.matron.venom', sfx: 'trap-gas' });
    log(events, warningWords('warn.matron.venom', a), { warning: true });
    return;
  }
  if (ready(state, a, WEB) && see && d >= 2 && d <= 6 && !p.statuses.root && !p.statuses.web && straightLane(state, a, p)) { spend(state, a, WEB); webShot(state, a, p, 'Matron', events); return; }
  if (see && d <= 1) { weaponAttack(state, a, p, events); return; }
  const ally = state.order.map(id => state.actors[id]).find(o => o.hp > 0 && o.side === 'ally' && cheb(o, a) <= 1);
  if (ally) { weaponAttack(state, a, ally, events); return; }
  if (!a.statuses.root && !a.statuses.web) stepToward(state, a, see ? p : (a.lastSeen ?? p), events);
}
registerSetPiece('matron', matron);

/** Every pulse: a ritual breaks the moment she reels (a stunned body gets no action); falling venom lands. */
onPulse('matron', (state, events) => {
  if (state.floorNo !== 20 && state.floor?.biome !== 'underdark') return;
  for (const id of state.order) {
    const a = state.actors[id];
    if (a.set !== 'matron' || a.hp <= 0) continue;
    breakCheck(state, a, events);
    venomLand(state, a, events);
  }
});

/** MA10: her death: rituals and venom end, her guards, every spider and her brood Fear 6; a gate if the hall has none. */
CREATURE_HOOKS.death.push((state, a, by, events) => {
  if (a.set !== 'matron') return;
  const M = mt(a);
  endRitual(state, a, events);
  M.venom = null;
  clearMarks(state, a);
  for (const id of state.order) {
    const o = state.actors[id];
    if (o === a || o.hp <= 0 || o.side !== 'foe') continue;
    if (o.guardOf === a.id || o.owner === a.id || o.flags?.includes('spider')) applyStatus(state, o, 'fear', { turns: 6, source: a.id }, events);
  }
  events.push({ type: 'shake', amount: 12 });
  const f = state.floor;
  if (!f.tiles.some(t => t === T.EXIT)) {
    const th = f.bossArena?.throne ?? { x: a.x, y: a.y }, c = nearFree(state, th.x, th.y, 2) ?? nearFree(state, a.x, a.y, 3);
    if (c) { f.tiles[c.y * f.w + c.x] = T.EXIT; f.exit = { x: c.x, y: c.y }; log(events, 'Behind the throne, the webs fall away from a hidden gate.'); }
  }
});
