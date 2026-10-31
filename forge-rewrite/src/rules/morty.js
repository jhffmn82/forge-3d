// Morty the Mostly-Dead and his phylactery (spec/bosses.md MT1-MT9; bosses.json morty; turn phase A17), floor 10.
// His counters count his own actions (bosses.md answer 1); Grave Hands lands on the world clock and never in the
// action that showed it (M37); the Bone Nova channel resolves on his own actions and breaks on 20 damage.
// Registered as the set pieces 'morty' and 'phylactery' (set-pieces.js), on the death hook and on phase A17.

import bosses from '../../data/bosses.json' with { type: 'json' };
import ui from '../../data/ui.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { registerSetPiece, CREATURE_HOOKS } from './set-pieces.js';
import { mark, registerLander } from './telegraph.js';
import { ready, spend } from './cooldowns.js';
import { stepToward } from './ai-step.js';
import { weaponAttack } from './attack.js';
import { dealDamage } from './damage.js';
import { applyStatus, blocks } from './statuses.js';
import { amount } from './amount.js';
import { creatureMoveLands } from './hit.js';
import { bossDied } from './boss.js';
import { rollTable } from './loot.js';
import { freeNear, raise } from './crypt.js';
import { registerPhase } from './phases.js';
import { isWall, bodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { next, roll } from '../lib/rng.js';
import { walkable } from '../data/tiles.js';

const B = bosses.rows.morty, TURN = tuning.rows.clock.unitsPerGameTurn;
const MOVE = Object.fromEntries(B.actions[0].moves.map(m => [m.id, m]));
const WORDS = {
  wake: 'Morty awakens!', nova: 'Bone Nova: break sight or deal 20 damage!', novaNext: 'Bone Nova next turn!', novaBroken: 'Bone Nova interrupted.',
  novaMiss: 'Bone Nova misses.', grasp: 'Grave Hands: leave marked tiles!', blink: 'Morty teleports.', reviving: 'Morty reviving: break the phylactery!',
  revives: 'Morty revives; 2 Skeletons summoned!', broken: 'Phylactery destroyed. Morty cannot revive.', reinforce: 'Morty calls reinforcements!',
};
import { cheb } from '../lib/geometry.js';
const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const inside = (r, p) => !!r && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const say = (events, words, warning = false) => events.push({ type: 'log', words, warning });
/** Each spell has its own fixed damage in the set-piece data. */
const novaHit = MOVE['bone-nova'].effects[0].then[0];
const graspHit = MOVE['grave-grasp'].effects[0].then[0];
const boltHit = MOVE['soul-bolt'].effects[0];

/**
 * C19 (Justin 2026-10-16): the hall's pillars, posts and tombs stand between Morty and the Nova: a line from him to a
 * tile is blocked by any blocking piece on the cells between (as well as by walls). The ring marks only the tiles
 * the Nova can reach, so the shadow behind each pillar shows as safe ground.
 */
function novaReaches(f, a, t) {
  if (!lineClear(f, a, t)) return false;
  const blocks = f.novaBlocks ?? new Set(f.props.filter(q => q.blocks || props.rows[q.id]?.blocks).map(q => q.y * f.w + q.x));
  const steps = cheb(a, t);
  for (let i = 1; i < steps; i++) {
    const x = Math.round(a.x + (t.x - a.x) * i / steps), y = Math.round(a.y + (t.y - a.y) * i / steps);
    if (blocks.has(y * f.w + x)) return false;
  }
  return true;
}

/** MT1: wake: seen within 8 while the hero is in his hall, or hurt. */
function wake(state, a, p, events) {
  a.throne = false; a.hunting = true; a.turnN = 0; a.lastSeen = { x: p.x, y: p.y, at: state.now };
  say(events, WORDS.wake);
  events.push({ type: 'boss', id: a.id, name: a.name, state: 'awake', music: B.music, sfx: B.wake.sfx });
  for (const id of state.order) { const g = state.actors[id]; if (g.guardOf === a.id && g.hp > 0 && !g.object) { g.hunting = true; g.asleep = false; g.lastSeen = { x: p.x, y: p.y, at: state.now }; } }
}

// The Nova's ring glows green and Grave Hands violet (1.7 crypt.js:322, :331; ui.json warningColours).
const marks = (state, a, kind, tiles) => { (state.floor.marks ??= []).push({ owner: a.id, kind, tiles, warning: 'warn.morty.' + kind, colour: ui.warningColours['warn.morty.' + kind] }); };
const unmark = (state, a, kind) => { state.floor.marks = (state.floor.marks ?? []).filter(m => !(m.owner === a.id && m.kind === kind)); };

function morty(state, a, events) {
  const p = state.actors[state.playerId], f = state.floor, hall = f.bossRoom;
  const sees = !!state.vis?.[a.y * f.w + a.x] && lineClear(f, a, p) && !p.statuses?.hidden, d = cheb(a, p);
  if (a.throne) {
    if ((sees && d <= 8 && inside(hall, p)) || a.hp < a.maxhp) wake(state, a, p, events);
    return;
  }
  a.turnN = (a.turnN ?? 0) + 1;
  if (sees) a.lastSeen = { x: p.x, y: p.y, at: state.now };
  // MT4: a channelled Bone Nova breaks on 20 damage, builds, or strikes.
  if (a.channel) {
    if (a.channelHp - a.hp >= 20) { a.channel = 0; unmark(state, a, 'nova'); events.push({ type: 'telegraph-end', id: a.id }); say(events, WORDS.novaBroken); return; }
    if (--a.channel > 0) { say(events, WORDS.novaNext, true); return; }
    unmark(state, a, 'nova'); events.push({ type: 'telegraph-end', id: a.id });
    events.push({ type: 'boss-move', id: a.id, move: 'bone-nova', sfx: 'shaman-cast', shake: 10 });
    // Every non-foe Morty can see (ruled 2026-10-16), the hero at most 35% of max HP.
    const targets = state.order.map(id => state.actors[id]).filter(t => t.hp > 0 && t.side !== 'foe' && novaReaches(f, a, t) && cheb(a, t) <= 12);
    let hitHero = false;
    for (const t of targets) {
      let n = amount(novaHit.amount, { state, owner: a });
      if (t.side === 'player') { n = Math.min(n, Math.round(t.maxhp * novaHit.capPctMaxHp / 100)); hitHero = true; }
      const dealt = dealDamage(state, { target: t, source: a, amount: n, type: 'dark', tags: ['spell', 'area'] }, events);
      if (t.side === 'player') say(events, `Bone Nova: ${dealt}.`);
    }
    if (!hitHero) say(events, WORDS.novaMiss);
    return;
  }
  // MT3: blink away from melee when ready (its cooldown on the world clock, M32; C10f), or on every 6th action (decided 1).
  if (sees && !blocks(a, 'move') && ((d <= 1 && ready(state, a, MOVE.blink)) || a.turnN % 6 === 0)) {
    const spots = [];
    if (hall) for (let y = hall.y + 1; y < hall.y + hall.h - 1; y++) for (let x = hall.x + 1; x < hall.x + hall.w - 1; x++) if (!isWall(f, x, y) && !bodyAt(state, x, y) && cheb({ x, y }, p) >= 4) spots.push({ x, y });
    if (spots.length) {
      const s = spots[Math.floor(next(state.rng) * spots.length)], from = { x: a.x, y: a.y };
      a.x = s.x; a.y = s.y; spend(state, a, MOVE.blink);
      events.push({ type: 'teleported', id: a.id, from, to: { ...s } });
      say(events, WORDS.blink);
      return;
    }
  }
  if (!sees) { if (!blocks(a, 'move') && a.lastSeen) stepToward(state, a, a.lastSeen, events); return; }
  // MT4: Bone Nova every 9th action: the tiles the hero can see 5-6 steps from him.
  if (a.turnN % 9 === 0) {
    const ring = [];
    for (let y = a.y - 6; y <= a.y + 6; y++) for (let x = a.x - 6; x <= a.x + 6; x++) {
      const m = manh(a, { x, y });
      if (m >= 5 && m <= 6 && walkable(f, x, y) && state.vis?.[y * f.w + x] && novaReaches(f, a, { x, y })) ring.push({ x, y });
    }
    a.channel = 2; a.channelHp = a.hp;
    marks(state, a, 'nova', ring);
    events.push({ type: 'telegraph', id: a.id, tiles: ring, warning: 'warn.morty.nova', sfx: 'shaman-cast' });
    say(events, WORDS.nova, true);
    return;
  }
  // MT5: Grave Hands on actions 1, 5, 9 ...: the hero's tile and 5 tries within 2 of it, landing 2 game turns later.
  if (a.turnN % 4 === 1 && !a.telegraph) {
    const tiles = [{ x: p.x, y: p.y }];
    for (let k = 0; k < 5; k++) { const x = p.x + roll(state.rng, -2, 2), y = p.y + roll(state.rng, -2, 2); if (walkable(f, x, y) && !tiles.some(t => t.x === x && t.y === y)) tiles.push({ x, y }); }
    mark(state, a, { kind: 'grave-grasp', tiles, delayTurns: 2, warning: 'warn.morty.grasp' }, events);   // telegraph.js (C10f)
    return;
  }
  // MT6: Soul Bolt at 2-7 (he may cast over his skeletons).
  if (d >= 2 && d <= 7) {
    events.push({ type: 'move-used', id: a.id, move: 'soul-bolt', name: 'Soul Bolt', target: p.id, ranged: true, sfx: 'shaman-cast' });
    if (creatureMoveLands(state, a, p, events, { label: 'Soul Bolt' })) {   // M6 (C10f): the hero's deflect, Blur and Lucky Streak answer it
      const n = dealDamage(state, { target: p, source: a, amount: amount(boltHit.amount, { state, owner: a }), type: 'dark', tags: boltHit.tags }, events);
      say(events, `Morty soul bolt: ${n}.`);
    } else { if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: p.id }); say(events, "Morty's soul bolt misses."); }
    return;
  }
  if (d <= 1) { if (!blocks(a, 'melee')) weaponAttack(state, a, p, events); return; }
  if (!blocks(a, 'move')) stepToward(state, a, p, events);
}

/** MT5: Grave Hands lands: every non-foe on a marked tile takes the blow and is Rooted 1. */
registerLander('grave-grasp', (state, a, t, events) => {
  events.push({ type: 'boss-move', id: a.id, move: 'grave-grasp', tiles: t.tiles });   // the hands burst from each tile (crypt.js:309)
  for (const b of state.order.map(id => state.actors[id])) {
    if (b.hp <= 0 || b.side === 'foe' || !t.tiles.some(c => c.x === b.x && c.y === b.y)) continue;
    const n = dealDamage(state, { target: b, source: a, amount: amount(graspHit.amount, { state, owner: a }), type: 'dark', tags: ['spell', 'area'] }, events);
    if (b.hp > 0) applyStatus(state, b, 'root', { turns: 1, source: a.id }, events);
    if (b.side === 'player') say(events, `Grave Hands: ${n}${b.statuses.root ? '; Rooted' : ''}.`);
  }
});

registerSetPiece('morty', morty);

const phylOf = (state, m) => state.actors[m.phylactery] ?? state.order.map(id => state.actors[id]).find(x => x.set === 'phylactery');

// MT7, MT8: Morty's death while his phylactery stands; the phylactery's own death.
CREATURE_HOOKS.death.push((state, a, by, events) => {
  const f = state.floor;
  if (a.set === 'morty') {
    const ph = phylOf(state, a);
    if (!ph || ph.hp <= 0) return;
    f.mortyReturn = { at: state.now + B.revival.delay * TURN, maxhp: a.maxhp, id: a.id, ph: ph.id, x: a.x, y: a.y };
    state.floor.marks = (f.marks ?? []).filter(m => m.owner !== a.id);
    a.telegraph = null; a.channel = 0;
    events.push({ type: 'died', id: a.id, reviving: true }, { type: 'telegraph-end', id: a.id });
    say(events, WORDS.reviving, true);
    return 'spared';
  }
  if (a.set === 'phylactery') {
    events.push({ type: 'boss-move', id: a.id, move: 'phylactery-broken', sfx: 'puzzle-solved', shake: 8 });
    say(events, WORDS.broken);
    const live = state.order.map(id => state.actors[id]).find(x => x.set === 'morty' && x.hp > 0);
    if (live || f.mortyReturn) {
      say(events, WORDS.reinforce, true);
      for (const s of (f.deathSpots ?? []).slice(-4)) { const c = bodyAt(state, s.x, s.y) || isWall(f, s.x, s.y) ? freeNear(state, s, 2) : s; if (c) raise(state, 'shambler', c, events, { risen: true, noLoot: true }); }
    }
    // He was waiting to return: his death now counts (rewards and the core, bosses.json rewards when dead-for-good).
    if (f.mortyReturn) {
      const R = f.mortyReturn; f.mortyReturn = null;
      const body = state.actors[R.id] ?? { id: R.id, x: R.x, y: R.y, name: 'Morty the Mostly-Dead', set: 'morty' };
      bossDied(state, body, events, rollTable);
    }
  }
});

// A17: 3 game turns after he fell, he returns beside the phylactery at 60% with two skeletons.
registerPhase('morty-return', (state, ctx, events) => {
  const f = state.floor, R = f?.mortyReturn;
  if (!R || state.now < R.at) return;
  const ph = state.actors[R.ph];
  if (!ph || ph.hp <= 0) { f.mortyReturn = null; return; }
  const c = freeNear(state, { x: ph.x, y: ph.y + 1 }, 3);
  if (!c) return;
  f.mortyReturn = null;
  const m = raise(state, 'morty', c, events);
  Object.assign(m, { set: 'morty', throne: false, hp: Math.round(R.maxhp * B.revival.pctMaxHp / 100), maxhp: R.maxhp, turnN: 1, phylactery: ph.id, rot: 0, phase: 0 });
  ph.guardOf = m.id;
  for (let i = 0; i < 2; i++) { const s = freeNear(state, c, 2); if (s) { const sk = raise(state, 'skeleton', s, events, { summonHp: true, noLoot: true }); sk.guardOf = m.id; } }
  events.push({ type: 'boss', id: m.id, name: m.name, state: 'awake', music: B.music, revived: true });
  say(events, WORDS.revives, true);
});
