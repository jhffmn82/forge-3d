// A creature's moves and how it fights (spec/monsters.md M4, M24-M35, M38, Behaviours: support-caster): its moves in
// written order, the support caster's step back, position and retreat, its on-hit riders and a slime's split
// (consolidation C10a: split from ai.js).

import { blocks } from './statuses.js';
import { heroEvent } from './passives.js';
import { UP, provide } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { holds } from './effects/conditions.js';
import { lanePath } from './effects/select.js';
import { tryStep, isWall, bodyAt, shotBodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { next } from '../lib/rng.js';
import { cheb, D8, clearShot as libClearShot } from '../lib/geometry.js';
import { ready as moveReady, spend } from './cooldowns.js';
import { creatureMoveLands } from './hit.js';
import { opaque } from '../data/tiles.js';
import { amount } from './amount.js';
import { remember } from './ai-sense.js';
import { stepToward, stepAway } from './ai-step.js';
import { monsterRow } from './monsters.js';

const CALL_RANGE = 5;   // M23

/** M31: a projectile path is clear when no wall or other body (but a Tiny one, G43) stands between. */
export const clearShot = (state, a, t) => libClearShot(a, t, { opaque: (x, y) => opaque(state.floor, x, y), body: (x, y) => !!shotBodyAt(state, x, y) });   // G43: a Tiny body does not block

/**
 * EP26 (1.7 skeleton-charge.js:7-15): a rush needs the straight lane to the target open: no wall, body or blocking
 * prop, no burning tile, no diagonal squeezed between two walls, and it ends beside the target.
 */
export function clearPath(state, a, t, reach) {
  const f = state.floor, run = lanePath(state, a, t, false, reach);
  if (!run?.length) return false;
  let prev = a;
  for (const c of run) {
    if (f.burning?.[c.y * f.w + c.x]) return false;
    if (c.x !== prev.x && c.y !== prev.y && isWall(f, c.x, prev.y) && isWall(f, prev.x, c.y)) return false;
    prev = c;
  }
  return true;
}

/** M30-M35: a creature's moves in written order; the first that passes its gates acts. */
export function tryMoves(state, a, p, events, { idle = false } = {}) {
  for (const m of a.moves ?? []) {
    // M32 (ruled 2026-10-16): a move waits game turns on the world clock, stunned or slowed or not (cooldowns.js).
    if (!moveReady(state, a, m) && !(idle && m.idleFallback)) continue;
    let target = p;
    if (m.target?.selector === 'nearest') target = supportTarget(state, a, m.target);
    if (!target) continue;
    const d = cheb(a, target);
    if (m.range && (d < m.range[0] || d > m.range[1])) continue;
    if (m.needs === 'clear-shot' && !clearShot(state, a, target)) continue;
    if (m.needs === 'clear-path' && !clearPath(state, a, target, m.range?.[1] ?? 3)) continue;   // EP26: a blocked rush keeps its cooldown
    if ((m.needs === 'open-line' || m.needs === 'sight') && !lineClear(state.floor, a, target)) continue;
    spend(state, a, m);
    // A shot (its damage tagged ranged: the Living Flame's) flies even at one tile, as 1.7's boltFx did.
    const shot = d > 1 || !!m.bolt || m.effects.some(e => e.tags?.includes('ranged'));   // EP19: a support bolt flies even to a body beside it
    events.push({ type: 'move-used', id: a.id, move: m.id, name: m.name, target: target.id, ranged: shot, ...(m.sfx ? { sfx: m.sfx } : {}) });   // the move's own cast sound (monsters.json)
    // M6: a move's own roll; at the hero his deflect, Blur and Lucky Streak answer it (hit.js creatureMoveLands).
    if (m.hit && !creatureMoveLands(state, a, target, events, { accBonus: m.hit.accBonus ?? 0, label: m.name })) {
      events.push({ type: 'log', words: `${a.name}'s ${m.name} misses.` });
      if (!events.at(-2)?.deflected) events.push({ type: 'miss', id: target.id });
      answered(state, a, target, events); return true;
    }
    // M34 alsoEveryNth (1.7 elements.js:197-199): every Nth use also runs its effects on the same roll (the Living
    // Flame's every third shot rings orange and splashes half its damage onto the foes beside its target).
    const nth = m.alsoEveryNth;
    if (!nth) { const from = events.length; for (const e of m.effects) runEffect(e, { state, owner: a, target, source: a, events }); moveWords(state, a, target, m, events, from); answered(state, a, target, events); return true; }
    a.moveUses ??= {};
    const uses = a.moveUses[m.id] = (a.moveUses[m.id] ?? 0) + 1, extra = uses % nth.n === 0;
    const main = m.effects.find(e => e.verb === 'damage');
    const raw = extra && main ? amount(main.amount, { state, owner: a, target, source: a }) : 0;
    if (extra) events.push({ type: 'ring', at: { x: target.x, y: target.y }, colour: '#FF943F', size: 1.5 });
    for (const e of m.effects) runEffect(extra && e === main ? { ...e, amount: raw } : e, { state, owner: a, target, source: a, events });
    if (extra) for (const e of nth.effects) runEffect(e, { state, owner: a, target, source: a, events, packet: { raw } });
    answered(state, a, target, events);
    return true;
  }
  return false;
}

/**
 * EP19 (1.7 enemy-teamwork.js:54-55 rally): a move's float over its target ('Rage' in fire) and its log line when the
 * caster or the target is in sight; {healed} is '; +N HP' for what the move healed the target, or nothing.
 */
export function moveWords(state, a, target, m, events, from) {
  if (m.useFloat) events.push({ type: 'float', id: target.id, words: m.useFloat.words, tone: m.useFloat.tone });
  if (!m.useLog) return;
  const W = state.floor.w;
  if (!state.vis?.[a.y * W + a.x] && !state.vis?.[target.y * W + target.x]) return;
  const healed = events.slice(from).filter(e => e.type === 'healed' && e.id === target.id).reduce((n, e) => n + e.amount, 0);
  events.push({ type: 'log', words: m.useLog.words.replace('{name}', a.name).replace('{target}', target.name).replace('{move}', m.name).replace('{healed}', healed ? `; +${healed} HP` : ''), cls: m.useLog.cls ?? 'c-you' });
}

/**
 * G10 (1.7 actions-adapter.js:5-26 recordHostileAttack): a foe's spell or ability at the hero, landed or missed, is an
 * attack on him as a weapon blow is (attack.js weaponAttack): Reginald's Perfect Counter answers it.
 */
export function answered(state, a, target, events) {
  if (target?.side === 'player' && a.side === 'foe' && a.hp > 0 && target.hp > 0) heroEvent(state, 'on-attacked', { target: a, attacker: a }, events);
}

/** M35: a support move's target: the nearest of its family in range with an open line, most hurt first. */
export function supportTarget(state, a, sel) {
  const list = state.order.map(id => state.actors[id]).filter(b => b.hp > 0 && b.side === a.side && (!sel.family || b.family === sel.family) && cheb(a, b) <= (sel.range ?? 99) && lineClear(state.floor, a, b));
  const wants = sel.need === 'hurt-or-unraged' ? list.filter(b => b.hp < b.maxhp || !b.statuses.goblinrage) : list;
  wants.sort((p, q) => p.hp / p.maxhp - q.hp / q.maxhp || cheb(a, p) - cheb(a, q));
  return wants[0] ?? null;
}

/**
 * M23, EP17 (1.7 enemy-teamwork.js alert, takeTurn): a caller (shaman, acolyte, sporecaller, priestess) that is hunting
 * and has not called on this hunt calls up to 2 of its family who are asleep or wandering within 5 with an open line;
 * they hunt toward its last-seen tile and do not relay. The call is spent even if nobody answers, and a fresh hunt
 * (after the trail went cold) calls again (act resets `called` on any action not hunting). Heard always, logged and
 * floated (a row's callFloat: 'Spore call' for the sporecaller) only when the caller is in sight.
 */
export function callForHelp(state, a, events) {
  if (!a.caller || a.called || !a.hunting || !a.lastSeen || state.floorNo <= 1) return false;
  a.called = true;
  const near = state.order.map(id => state.actors[id])
    .filter(b => b !== a && b.hp > 0 && b.side === a.side && b.family === a.family && !b.hunting && cheb(a, b) <= CALL_RANGE && lineClear(state.floor, a, b))
    .sort((p, q) => cheb(a, p) - cheb(a, q)).slice(0, 2);
  if (!near.length) return false;
  for (const b of near) { b.called = true; b.lostFor = 0; remember(state, b, a.lastSeen); }
  if (state.vis?.[a.y * state.floor.w + a.x]) events.push({ type: 'log', words: `<b>${a.name}</b> calls for help.`, cls: 'c-you' }, { type: 'float', id: a.id, words: monsterRow(a.kind)?.callFloat ?? 'Help!', tone: 'miss' });
  events.push({ type: 'alert', id: a.id, sfx: a.sfx ? a.sfx + '-alert' : null });
  return true;
}

/** spec/monsters.md support-caster: retreat inside 3, try its moves, hold 3..holdRange, else its idle move. */
export function supportCaster(state, a, p, dist, events) {
  const P = a.params ?? {};
  if (retreat(state, a, p, events, P.retreatWithin ?? 3)) return true;
  if (tryMoves(state, a, p, events)) return true;
  if (position(state, a, p, P.holdRange ?? 6, !!P.tactical, events)) return true;
  return tryMoves(state, a, p, events, { idle: true }) || true;
}

/**
 * EP22 (1.7 enemy-teamwork.js retreat): a support caster steps away from the nearest threat closer than 3: its target,
 * or one of the hero's allies with an open line (his pets too, not the hero alone).
 */
export function retreat(state, a, target, events, within = 3) {
  if (blocks(a, 'move')) return false;
  const threats = state.order.map(id => state.actors[id]).filter(o => o.hp > 0 && o.side === 'ally' && cheb(a, o) < within && lineClear(state.floor, a, o));
  threats.push(target);
  threats.sort((x, y) => cheb(a, x) - cheb(a, y));
  return cheb(a, threats[0]) < within && stepAway(state, a, threats[0], events);
}

/**
 * EP21 (1.7 enemy-teamwork.js position): a support caster beyond `range` closes in; inside it, it takes the one step
 * (staying 3 to `range` from the target, never into fire) that best improves its place. Tactical (Shaman, Priestess):
 * a distance near min(4, range), a clear shot (12 against a blocked one) and cover about 2 tiles from its nearest
 * hunting escort of the family within 6 (3 a tile the escort stands nearer the target than it would). Not tactical
 * (Sporecaller, Acolyte): it keeps to that escort, and holds when the escort is within 3 or there is none. A step must
 * beat where it stands, so a well-placed caster holds its ground.
 */
export function position(state, a, target, range, tactical, events) {
  if (blocks(a, 'move')) return false;
  if (cheb(a, target) > range) return stepToward(state, a, target, events);
  const escort = state.order.map(id => state.actors[id])
    .filter(o => o !== a && o.hp > 0 && o.side === a.side && o.family && o.family === a.family && o.hunting && !o.caller && cheb(a, o) <= 6 && lineClear(state.floor, a, o))
    .sort((x, y) => cheb(a, x) - cheb(a, y))[0] ?? null;
  if (!tactical && (!escort || cheb(a, escort) <= 3)) return false;
  const score = c => {
    if (!tactical) return cheb(c, escort);
    const d = cheb(c, target);
    return Math.abs(d - Math.min(4, range)) * 2 + (clearShot(state, c, target) ? 0 : 12)
      + (escort ? Math.abs(cheb(c, escort) - 2) + Math.max(0, cheb(escort, target) + 1 - d) * 3 : 0);
  };
  const f = state.floor, here = score(a);
  const steps = D8.map(([dx, dy]) => ({ dx, dy, c: { x: a.x + dx, y: a.y + dy } }))
    .filter(o => { const d = cheb(o.c, target); return d >= 3 && d <= range && !(f.burning?.[o.c.y * f.w + o.c.x] && a.element !== 'fire') && !(o.dx && o.dy && isWall(f, a.x + o.dx, a.y) && isWall(f, a.x, a.y + o.dy)); })
    .map(o => ({ ...o, v: score(o.c) })).filter(o => o.v < here).sort((x, y) => x.v - y.v);
  for (const o of steps) if (tryStep(state, a, o.dx, o.dy, events)) return true;
  return false;
}

/** M39: splitting slimes regenerate 2 HP each world pulse while hunting, unless Poisoned or Rotting. */
export function pulsePassives(state, a, events) {
  for (const ps of a.passives ?? []) {
    if (ps.verb !== 'on-event' || ps.trigger !== 'on-world-pulse') continue;
    if (ps.while === 'hunting' && !a.hunting) continue;
    if (a.statuses.poison || a.statuses.rot) continue;
    for (const e of ps.effects) runEffect(e, { state, owner: a, target: a, source: a, events });
  }
}

/** A creature's landed blow and its riders (G13, 1.7 finishAttackReactions, actions-adapter.js:156-163): each rolls
 *  its chance and checks its condition (bleed only on the living, the hero counted living; Fangs melee only; Ember
 *  Bite not on a burning target; the Bone Archer's root on a ranged hit only); the Brute's knockback every 4 actions. */
export function onHitPassives(state, a, target, events, { melee }) {
  for (const ps of a.passives ?? []) {
    if (ps.verb !== 'on-event' || ps.trigger !== 'on-hit' || target.hp <= 0) continue;
    a.cd ??= {};
    if ((a.cd['passive:on-hit'] ?? 0) > 0) continue;
    const seen = target.side === 'player' ? { ...target, flags: [...(target.flags ?? []), 'living'] } : target;
    if (ps.if && !holds(ps.if, { state, owner: a, target: seen, hit: { melee, ranged: !melee, single: true } })) continue;
    if (ps.chance != null && next(state.rng) >= ps.chance / 100) continue;
    a.cd['passive:on-hit'] = ps.cooldown ?? 0;
    for (const e of ps.effects) {
      const was = { x: target.x, y: target.y };
      runEffect(e, { state, owner: a, target, source: a, events });   // C10a: the Brute's push is the knockback verb (lava, Resolve, the thud)
      // EP23 (1.7 enemy-teamwork.js:118-119 shoulderCheck): "Goblin Brute: you pushed back."; an ally's push is told when the brute is seen.
      if (e.verb !== 'knockback' || target.hp <= 0 || (target.x === was.x && target.y === was.y)) continue;
      if (target.side === 'player') events.push({ type: 'log', words: `${a.name}: you pushed back.`, cls: 'c-you' });
      else if (state.vis?.[a.y * state.floor.w + a.x]) events.push({ type: 'log', words: `${a.name}: ${target.name} pushed back.`, cls: 'c-info' });
    }
  }
}

/** M38: a direct hit with a source on a splitting slime at full HP that leaves it 2+ HP splits it in two. */
export function splitOnHit(state, t, hpBefore, source, events) {
  const sp = (t.passives ?? []).find(ps => ps.verb === 'split');
  if (!sp || !source || hpBefore !== t.maxhp || t.hp < (sp.minHp ?? 2)) return;
  const free = D8.map(([dx, dy]) => ({ x: t.x + dx, y: t.y + dy })).filter(c => !isWall(state.floor, c.x, c.y) && !bodyAt(state, c.x, c.y));
  if (!free.length) return;
  const at = free[Math.floor(next(state.rng) * free.length)], half = Math.floor(t.hp / 2);
  t.hp -= half;
  const copy = { ...structuredClone({ ...t, setPiece: undefined }), id: `${t.kind}-split-${state.actions}-${Math.floor(next(state.rng) * 1e6)}`, x: at.x, y: at.y, hp: half, noXp: !!sp.noXp, drops: sp.noLoot ? null : t.drops, hunting: true, asleep: false, t: t.t + 100, statuses: {} };
  state.actors[copy.id] = copy; state.order.push(copy.id);
  events.push({ type: 'spawned', id: copy.id, at }, { type: 'log', words: `${t.name} splits.`, sfx: 'slime-split' });
}
provide('splitOnHit', splitOnHit);   // C17: what the rules below this module call up to it (set-pieces.js UP)
