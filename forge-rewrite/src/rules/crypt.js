// The Crypt's creatures (spec/monsters.md M40, M47, M49, the Crypt rows of "Special moves"; turn phases A1, A16;
// spec/world.md A15, A18; monsters.json rows skeleton .. acolyte). Registered on the shared creature hooks
// (set-pieces.js CREATURE_HOOKS) and the turn phases; the generic hunter does everything else.
//   taken:   Bone Ward cancels a whole hit; the creature's own damage-mod rows (skeleton by weapon, shade, phylactery)
//   damaged: on-hit-by riders of the striker (rot, grave-tipped poison, mana drain); the beetle's fumes when struck
//   death:   a Shambler leaves a corpse that rises; a Grave Bloat bursts into gas; living deaths mark the floor
//   hunt:    Bone Archer reload, Shade phasing, the Necro-Acolyte's turn
//   phases:  A1 a Buried Ghoul emerges behind the hero; A16 corpses rise or are destroyed
// Ground: grave ooze and gas clouds are fields (src/rules/fields.js) on the world clock (ruled 2026-10-16).

import monsters from '../../data/monsters.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { CREATURE_HOOKS, PROP_USES, TILE_USES, PROP_BREAKS, UP } from './set-pieces.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { holds } from './effects/conditions.js';
import { applyStatus, blocks } from './statuses.js';
import { weaponAttack } from './attack.js';
import { makeCreature } from './monsters.js';
import { stepToward } from './ai-step.js';
import { creatureMoveLands } from './hit.js';
import { ready, spend } from './cooldowns.js';
import { stepAway } from './path.js';
import { giveOf } from './loot.js';
import { registerPhase } from './phases.js';
import { tryStep, isWall, bodyAt, shotBodyAt } from './moves.js';
import { lineClear } from './sight.js';
import { next } from '../lib/rng.js';
import { T, tileAt, walkable, opaque } from '../data/tiles.js';

const M = monsters.rows, TURN = tuning.rows.clock.unitsPerGameTurn;
import { cheb, D8, clearShot as libClearShot } from '../lib/geometry.js';
const bodies = state => state.order.map(id => state.actors[id]).filter(a => a.hp > 0);
const say = (events, words, o = {}) => events.push({ type: 'log', words, ...o });

// ---------------------------------------------------------------- passives read from the creature's row
const passives = (a, verb, trigger) => (a.passives ?? []).filter(p => p.verb === verb && (!trigger || p.trigger === trigger));

/** The weapon class the hero strikes with (skeleton damage-mods): unarmed, or the main weapon's id. */
/** The Crypt rows' conditions, read by the one interpreter (C8, engine-rules-10); a row with none always holds. */
const cond = (c, x) => !c || holds(c, { events: [], ...x });

// ---------------------------------------------------------------- taken
CREATURE_HOOKS.taken.push((state, t, p, events) => {
  t.lastDtype = p.type ?? 'phys';
  // Bone Ward (teamwork.js:58-66): one whole hit cancelled, then the ward is gone. Periodic ticks pass through it.
  if (t.statuses.boneward && !p.tags?.includes('periodic') && p.amount > 0) {
    delete t.statuses.boneward;
    events?.push({ type: 'status', id: t.id, status: 'boneward', change: 'ended' }, { type: 'log', words: `${t.name}: Bone Ward broken.` }, { type: 'float', id: t.id, words: 'ward' });
    return 0;
  }
  let m = 1;
  for (const d of passives(t, 'damage-mod')) if (d.direction === 'taken' && cond(d.if, { state, owner: t, target: t, source: p.source, packet: { type: p.type ?? 'phys', tags: p.tags } })) m *= d.mult;
  return m;
});

// ---------------------------------------------------------------- damaged
const meleeOf = (p, src, t) => !!src && cheb(src, t) <= 1 && !p.tags?.includes('ranged') && !p.cause && !p.tags?.includes('periodic');
CREATURE_HOOKS.damaged.push((state, t, p, dealt, events) => {
  const src = p.source;
  // on-hit-by (effects.md): the striker's riders on what its attack hit, when it did damage.
  if (src?.side === 'foe' && src.passives && dealt > 0 && p.tags?.includes('attack') && !p.cause) {
    for (const ps of passives(src, 'on-event', 'on-hit-by')) {
      const x = { state, owner: src, target: t, source: src, packet: { type: p.type, tags: p.tags }, events };
      if (!cond(ps.if, x) || (ps.chance !== undefined && !(next(state.rng) < ps.chance / 100))) continue;
      for (const e of ps.effects) runEffect(e, { state, owner: src, target: t, source: src, events });
    }
  }
  // on-melee-hit-taken (Grave Beetle fumes): the player's adjacent blow, at most every `cooldown` actions.
  if (t.side === 'foe' && t.passives && src && meleeOf(p, src, t)) {
    for (const ps of passives(t, 'on-event', 'on-melee-hit-taken')) {
      if (!cond(ps.if, { state, owner: t, target: src, source: src, events, packet: { type: 'phys' } }) || (t.fumesAt !== undefined && state.actions - t.fumesAt < (ps.cooldown ?? 0))) continue;
      t.fumesAt = state.actions;
      for (const e of ps.effects) runEffect(gasCloud(e), { state, owner: t, target: t, source: t, events });
      events.push({ type: 'log', words: `${t.name}: poison cloud!`, sfx: 'trap-gas' });
    }
  }
});

/** A15: gas clouds spare the undead, objects and gas-immune creatures (beetles live in it). */
const SPARED = { not: { any: [{ 'creature-flag': 'undead' }, { 'creature-flag': 'object' }, { 'creature-flag': 'gas-immune' }] } };
export const gasCloud = e => (e.verb !== 'field' ? e : { ...e, shape: { ...e.shape, walkable: true }, each: (e.each ?? []).map(x => ({ ...x, if: x.if ?? SPARED })) });

// ---------------------------------------------------------------- death
CREATURE_HOOKS.death.push((state, a, by, events, tags, after = events) => {
  const f = state.floor;
  if (!f) return;
  // Morty's reinforcements rise where living creatures fell (death-adapter.js:50).
  if (a.flags?.includes('living')) (f.deathSpots ??= []).push({ x: a.x, y: a.y });
  for (const ps of passives(a, 'on-event', 'on-death')) {
    if (!cond(ps.if, { state, owner: a, target: a, packet: { type: a.lastDtype ?? 'phys' } }) || (ps.if && a.statuses.burn)) continue;
    for (const e of ps.effects) {
      if (e.verb === 'revive') {
        // M40: a Shambler that is not finished leaves a corpse that rises 3 turns later at half its max HP.
        if (a.risen || a.statuses.burn || ['fire', 'light'].includes(a.lastDtype)) continue;
        (f.corpses ??= []).push({ id: a.id, kind: a.kind, x: a.x, y: a.y, maxhp: a.maxhp, at: state.now + (e.delay ?? 3) * TURN, flip: !!a.flip });
        say(events, `${a.name} reviving: smash or burn its corpse!`, { warning: true });
        // The map draws the body lying there once its death clip has played (CR13; 1.7 crypt.js:384 skips the corpse
        // while the death plays), so the corpse and ground events follow the 'died' event.
        after.push({ type: 'corpse', id: a.id, at: { x: a.x, y: a.y } }, { type: 'ground', at: { x: a.x, y: a.y } });
      } else if (e.verb === 'field') {
        runEffect(gasCloud(e), { state, owner: a, target: a, source: a, events });
        events.push({ type: 'log', words: `${a.name}: Poison cloud!`, sfx: 'trap-gas' });
      } else runEffect(e, { state, owner: a, target: a, source: a, events });
    }
  }
});

// ---------------------------------------------------------------- hunt
/** M31: a clear shot: open line, no other body between (lib/geometry; G43: not a Tiny body). */
const clearShot = (state, a, t) => libClearShot(a, t, { opaque: (x, y) => opaque(state.floor, x, y), body: (x, y) => !!shotBodyAt(state, x, y) });

/** Bone Archer: a turn to nock after every shot (crypt.js:189). */
function archer(state, a, p, { sees, dist }, events) {
  if (a.reloading) { a.reloading = false; if (state.vis?.[a.y * state.floor.w + a.x]) say(events, `${a.name} reloads.`); events.push({ type: 'reload', id: a.id }); return true; }
  if (sees && dist >= 2 && dist <= (a.range ?? 1) && clearShot(state, a, p) && !blocks(a, 'melee')) {
    weaponAttack(state, a, p, events, { ranged: true });
    a.reloading = true;
    return true;
  }
  return false;
}

/** A tile a Shade may drift into: open floor, a door, an Upheaval ridge, or a wall one step from open floor. */
function thin(state, x, y) {
  const f = state.floor;
  if (x < 1 || y < 1 || x >= f.w - 1 || y >= f.h - 1 || tileAt(f, x, y) === T.CHASM || bodyAt(state, x, y)) return false;
  const t = tileAt(f, x, y);
  if (walkable(f, x, y) || t === T.DOOR || f.rocks?.[y * f.w + x]) return true;
  return t === T.WALL && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkable(f, x + dx, y + dy));
}

/** Shade (crypt.js:220-235): drifts through doors and thin walls straight at the hero, or where it last saw them. */
function shade(state, a, p, { sees, dist }, events) {
  if (blocks(a, 'move')) return false;
  const goal = sees ? p : a.lastSeen;
  if (!goal || (sees && dist <= 1)) return false;
  let best = null, bd = cheb(a, goal);
  for (const [dx, dy] of D8) {
    const x = a.x + dx, y = a.y + dy;
    if (!thin(state, x, y)) continue;
    const d = cheb({ x, y }, goal);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  if (!best) return false;
  const from = { x: a.x, y: a.y };
  a.x = best.x; a.y = best.y;
  events.push({ type: 'moved', id: a.id, from, to: best, phase: true });
  return true;
}

/** A free tile within r of a point, for a summoned or risen body (nearest rings first, random within a ring). */
export function freeNear(state, at, r = 2) {
  for (let d = 0; d <= r; d++) {
    const ring = [];
    for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
      const x = at.x + dx, y = at.y + dy;
      if (!isWall(state.floor, x, y) && !bodyAt(state, x, y)) ring.push({ x, y });
    }
    if (ring.length) return ring[Math.floor(next(state.rng) * ring.length)];
  }
  return null;
}

/** A body of `kind` raised on the floor, hunting the hero; summonHp when asked; no loot when asked. */
export function raise(state, kind, at, events, { summonHp = false, noLoot = false, risen = false, hp } = {}) {
  const m = makeCreature(kind, at.x, at.y), p = state.actors[state.playerId];
  if (summonHp && M[kind].summonHp) m.hp = m.maxhp = M[kind].summonHp;
  if (hp !== undefined) m.hp = hp;
  Object.assign(m, { hunting: true, asleep: false, t: p.t + 1, lastSeen: { x: p.x, y: p.y, at: state.now }, ...(noLoot ? { drops: 'kill-none', noLoot: true } : {}), ...(risen ? { risen: true } : {}) });
  state.actors[m.id] = m; state.order.push(m.id);
  events.push({ type: 'spawned', id: m.id, at: { x: at.x, y: at.y } });
  return m;
}

/** Necro-Acolyte (crypt.js:191-218, teamwork.js retreat / boneWard / position): keep away, raise, ward, bolt. */
function acolyte(state, a, p, { sees, dist }, events) {
  if (!sees) return false;
  // M32 (C10f): its moves wait game turns on the world clock (cooldowns.js), stunned or slowed or not; it counted its own actions.
  const mv = id => a.moves.find(m => m.id === id);
  // Retreat when the hero is closer than 3 (teamwork.js retreat: dist < 3; spec/monsters.md support-caster).
  if (dist < (a.params?.retreatWithin ?? 3) && !blocks(a, 'move') && stepAway(a, p, (dx, dy) => tryStep(state, a, dx, dy, events))) return true;
  // Raise Skeleton: keeps one.
  const minion = a.minion && state.actors[a.minion]?.hp > 0;
  if (!minion && ready(state, a, mv('raise-skeleton'))) {
    const c = freeNear(state, a, 2);
    if (c) {
      const sk = raise(state, 'skeleton', c, events, { summonHp: true, noLoot: true });
      sk.summonedBy = a.id; a.minion = sk.id; spend(state, a, mv('raise-skeleton'));
      events.push({ type: 'move-used', id: a.id, move: 'raise-skeleton', name: 'Raise Skeleton', sfx: 'shaman-cast' }, { type: 'log', words: `${a.name} summons Skeleton.` });
      return true;
    }
  }
  if (boneWard(state, a, events)) return true;
  // Grave Bolt: range 1-5, a clear shot (not through its own skeletons), to-hit +8, dark, Fear 1.
  const bolt = mv('grave-bolt');
  if (dist >= bolt.range[0] && dist <= bolt.range[1] && ready(state, a, bolt) && clearShot(state, a, p)) {
    spend(state, a, bolt);
    events.push({ type: 'move-used', id: a.id, move: 'grave-bolt', name: bolt.name, target: p.id, ranged: true, sfx: 'shaman-cast' });
    // M6: the roll (its blind penalty too) goes through creatureMoveLands; the hero's deflect, Blur and Lucky Streak answer it.
    if (creatureMoveLands(state, a, p, events, { accBonus: bolt.hit?.accBonus ?? 0, label: bolt.name })) for (const e of bolt.effects) runEffect(e, { state, owner: a, target: p, source: a, events });
    else { if (!events.at(-1)?.deflected) events.push({ type: 'miss', id: p.id }); events.push({ type: 'log', words: 'A grave bolt misses.' }); }
    return true;
  }
  // Hold at range 5 (position), else ward or wait.
  if (dist > (a.params?.holdRange ?? 5) && !blocks(a, 'move') && stepToward(state, a, p, events)) return true;
  if (dist === 1 && !blocks(a, 'melee')) { weaponAttack(state, a, p, events); return true; }
  boneWard(state, a, events);
  return true;
}

/** Bone Ward: every hunting undead crypt creature within 4 with an open line and no ward gets one (5-action cooldown). */
function boneWard(state, a, events) {
  const m = a.moves.find(x => x.id === 'bone-ward');
  if (!ready(state, a, m)) return false;
  const want = bodies(state).filter(b => b !== a && b.side === a.side && b.family === 'crypt' && b.undead && b.hunting && !b.statuses.boneward && cheb(a, b) <= m.target.n && lineClear(state.floor, a, b));
  if (!want.length) return false;
  spend(state, a, m);
  events.push({ type: 'move-used', id: a.id, move: 'bone-ward', name: m.name, sfx: 'shaman-cast' });
  // EP24 (1.7 enemy-teamwork.js:58-66): a dark sparkle (12) on each warded body, and 'Necro-Acolyte: Bone Ward.' when the caster is in sight.
  for (const b of want) { applyStatus(state, b, 'boneward', { turns: 1, permanent: true, source: a.id }, events); events.push({ type: 'sparkle', at: { x: b.x, y: b.y }, kind: 'dark', n: 12 }); }
  if (state.vis?.[a.y * state.floor.w + a.x]) events.push({ type: 'log', words: `${a.name}: ${m.name}.`, cls: 'c-info' });
  return true;
}

const HUNT = { bonearcher: archer, shade, acolyte };
CREATURE_HOOKS.hunt.push((state, a, p, ctx, events) => HUNT[a.kind]?.(state, a, p, ctx, events) ?? false);

// ---------------------------------------------------------------- C10: a Shade in the urns
/** C10 (Justin 2026-10-16: "make it a shade"): breaking an urn group on a Crypt floor lets a Shade out 8% of the time,
 *  hunting at once beside the shards. (state.forceUrnShade makes it certain, for staged pictures.) */
export const URN_SHADE_PCT = 8;
PROP_BREAKS.push((state, p, events) => {
  if (p.id !== 'urn-group' || state.floor?.biome !== 'crypt') return;
  if (!state.forceUrnShade && !(next(state.rng) < URN_SHADE_PCT / 100)) return;
  const at = freeNear(state, p, 1);
  if (!at) return;
  const sh = raise(state, 'shade', at, events, { noLoot: true });
  sh.fromUrn = true;
  events.push({ type: 'log', words: 'A Shade rises from the shattered urn!', warning: true, sfx: 'wisp-alert' });
});

// ---------------------------------------------------------------- S34: the funeral bell
/** Rung once: three Necro-Acolytes answer in its room, a Transmutation sigil and 50 essence appear beside it. */
PROP_USES['crypt-funeral-bell'] = (state, bell, events) => {
  if (bell.bell?.rung) { events.push({ type: 'log', words: 'The bell is silent now.' }); return 'refused'; }
  const f = state.floor, r = bell.bell?.room;
  bell.bell = { ...(bell.bell ?? {}), rung: true };
  const cells = [];
  if (r) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!isWall(f, x, y) && !bodyAt(state, x, y)) cells.push({ x, y });
  for (let i = 0; i < 3 && cells.length; i++) raise(state, 'acolyte', cells.splice(Math.floor(next(state.rng) * cells.length), 1)[0], events);
  for (const g of [{ sigil: 'group:none', id: 'transmutation' }, { essence: 50 }]) {
    const at = freeNear(state, bell, 2) ?? bell;
    const items = g.id ? [{ kind: 'sigil', id: g.id, count: 1 }] : giveOf(state, g, state.floorNo);
    for (const it of items) f.items.push({ x: at.x, y: at.y, item: it });
  }
  events.push({ type: 'log', words: 'The funeral bell rings. Three acolytes answer; an offering appears.', sfx: 'crypt-bell' }, { type: 'drops', at: { x: bell.x, y: bell.y } });
  return 'act';
};

// ---------------------------------------------------------------- A16: corpses
/** M40, 1.7 moveCorpse: walking into a corpse smashes it; the step is spent on it and the hero stays where they are
 *  (Justin 2026-10-16: "A"). */
TILE_USES.push((state, x, y, events) => {
  const f = state.floor, i = (f.corpses ?? []).findIndex(c => c.x === x && c.y === y);
  if (i < 0) return undefined;
  f.corpses.splice(i, 1);
  // CR14: the hero swings at it and lunges toward its tile first (1.7 crypt.js:409 setClip melee, lungeFx).
  events.push({ type: 'swung', id: state.playerId, at: { x, y } }, { type: 'corpse-destroyed', at: { x, y }, sfx: 'skeleton-death' }, { type: 'ground', at: { x, y } }, { type: 'log', words: 'Corpse destroyed.' });
  return 'act';
});

registerPhase('crypt-corpses', (state, ctx, events) => {
  const f = state.floor;
  if (!f?.corpses?.length) return;
  f.corpses = f.corpses.filter(c => {
    const k = c.y * f.w + c.x, holy = (f.fields ?? []).some(r => /holy/.test(r.kind) && r.cells.includes(k));
    // Item 241 (Justin 2026-10-20: "there is no sound effect when destroying a shamblers corpse"): burnt or on holy ground, as a smash sounds.
    if (f.burning?.[k] || holy) { events.push({ type: 'corpse-destroyed', at: { x: c.x, y: c.y }, sfx: 'skeleton-death' }, { type: 'ground', at: { x: c.x, y: c.y } }, { type: 'log', words: 'Corpse destroyed.' }); return false; }
    // The turn before it rises the body twitches, with a mark over it (1.7 drawLyingCorpse; Justin 2026-10-16: "sure").
    if (!c.twitch && state.now >= c.at - TURN) { c.twitch = true; events.push({ type: 'ground', at: { x: c.x, y: c.y } }, { type: 'corpse-twitch', at: { x: c.x, y: c.y } }); }
    if (state.now < c.at) return true;
    const spot = bodyAt(state, c.x, c.y) ? freeNear(state, c, 2) : { x: c.x, y: c.y };
    if (!spot) return true;
    raise(state, c.kind, spot, events, { risen: true, hp: Math.max(1, Math.round(c.maxhp / 2)) });
    events.push({ type: 'ground', at: { x: c.x, y: c.y } });
    if (state.vis?.[spot.y * f.w + spot.x]) say(events, `${M[c.kind].name} revives!`, { warning: true });
    return false;
  });
});

// ---------------------------------------------------------------- A1: Buried Ghouls
registerPhase('ghoul-emerge', (state, ctx, events) => {
  const f = state.floor, p = state.actors[state.playerId];
  if (ctx.kind !== 'move' || !f?.buried?.length) return;
  const mv = events.findLast(e => e.type === 'moved' && e.id === p.id && !e.dash);
  if (!mv || mv.to.x !== p.x || mv.to.y !== p.y) return;
  const step = { x: mv.from.x, y: mv.from.y, dx: Math.sign(mv.to.x - mv.from.x), dy: Math.sign(mv.to.y - mv.from.y) };
  const cand = f.buried.filter(e => e.hp > 0 && cheb(e, step) <= 2 && cheb(e, p) <= 3 && (e.x - p.x) * step.dx + (e.y - p.y) * step.dy <= 0 && lineClear(f, e, p))
    .sort((a, b) => cheb(a, p) - cheb(b, p));
  if (!cand.length) return;
  const ideal = { x: p.x - step.dx, y: p.y - step.dy };
  const cells = D8.filter(([dx, dy]) => dx * step.dx + dy * step.dy < 0).map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
    .filter(c => walkable(f, c.x, c.y) && !isWall(f, c.x, c.y) && !bodyAt(state, c.x, c.y) && lineClear(f, p, c)).sort((a, b) => cheb(a, ideal) - cheb(b, ideal));
  if (!cells.length) return;
  const e = cand[0], c = cells[0];
  f.buried = f.buried.filter(o => o !== e);
  Object.assign(e, { x: c.x, y: c.y, hunting: true, asleep: false, t: p.t, lastSeen: { x: p.x, y: p.y, at: state.now }, emerged: true });
  state.actors[e.id] = e; state.order.push(e.id);
  events.push({ type: 'spawned', id: e.id, at: c, emerge: true, sfx: 'zombie-alert' }, { type: 'log', words: 'A Buried Ghoul emerges behind you.', warning: true }, { type: 'stop-travel' });
});

// The crypt's clouds and grave ooze are fields on the world clock (fields.js fieldPulse). The A15 slot, after the
// creatures, settles M49: a Shade inside a wall, an Upheaval ridge or a dark room and more than 2 tiles from the hero is
// not drawn (a.hidden; the map hides it and shows a shimmer on the wall instead, C11).
registerPhase('shade-hiding', state => {
  const f = state.floor, p = state.actors[state.playerId];
  if (!f) return;
  for (const id of state.order) {
    const a = state.actors[id];
    if (a.kind !== 'shade' || a.hp <= 0) continue;
    const t = tileAt(f, a.x, a.y), inWall = t === T.WALL || !!f.rocks?.[a.y * f.w + a.x];
    const dark = (f.rooms ?? []).some(r => r.dark && a.x >= r.x && a.x < r.x + r.w && a.y >= r.y && a.y < r.y + r.h);
    a.hidden = (inWall || dark) && cheb(a, p) > 2;
    a.inWall = inWall;
  }
});
