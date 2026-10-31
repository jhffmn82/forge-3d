// The effect verbs that change the world: dashes, pushes, summons, fields, terrain, items and knowledge (spec/effects.md;
// consolidation C8: effects.js split). runEffect (effects.js) runs them; verbs.js holds the rest.

import { layField, extinguish } from '../fields.js';
import { shoveIntoLava } from '../lava.js';
import { amount } from '../amount.js';
import { applyStatus, grantResolve, resolveBlocks } from '../statuses.js';
import { makeCreature } from '../monsters.js';
import { floorRosterKind } from '../spawns.js';
import { itemRow as itemRowOf } from '../items.js';
import statuses from '../../../data/statuses.json' with { type: 'json' };
import { walkable, G } from '../../data/tiles.js';
import { next } from '../../lib/rng.js';
import { tryStep } from '../moves.js';
import { refreshSight } from '../sight.js';
import { CREATURE_HOOKS, UP } from '../set-pieces.js';
import { blocks } from '../statuses.js';
import { heroStats } from '../derive.js';
import { weaponDamage } from '../items.js';
import { lanePath, isBlocking, shapeTiles, ridgeTiles, bodyOn } from './select.js';
import { echoRegen, graveStrength, raiseCopy } from '../god-powers.js';
const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import tuning from '../../../data/tuning.json' with { type: 'json' };
import { moveBody } from '../moves.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;

/** Effects with each scaled amount worked out now, for the caller in c (a summons' bite keeps its caller's numbers). */
const atCall = (x, c) => Array.isArray(x) ? x.map(y => atCall(y, c))
  : x && typeof x === 'object' ? ('scaled' in x ? amount(x, c) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, atCall(v, c)]))) : x;

/** Each absorb pool and the status that keeps it (statuses.json while shield). */
export const POOL_STATUS = Object.fromEntries(Object.entries(statuses.rows).flatMap(([id, r]) => (r.while ?? []).filter(w => w.verb === 'shield' && w.pool).map(w => [w.pool, id])));

/**
 * EP26 (1.7 skeleton-charge.js:16-23): a creature's rush (the Skeleton's Bone Rush): "The Skeleton charges!" when seen
 * (an ally's always), then a step at a time along the lane, meeting the ground on the way (a web holds it there; spores
 * and trails as any step), and the `then` blow when it ends beside the target.
 */
export function creatureRush(e, c, foe) {
  const s = c.state, o = c.owner, f = s.floor, run = lanePath(s, o, foe, false, e.range ?? 6);
  if (!run?.length) return;
  const name = `${/^The | the /.test(o.name ?? '') ? '' : 'The '}<b>${o.name}</b>`;
  if (o.side === 'ally') c.events.push({ type: 'log', words: `Your ${o.name} charges!` });
  else if (s.vis?.[o.y * f.w + o.x]) c.events.push({ type: 'log', words: `${name} charges!` });
  for (const t of run) {
    if (o.hp <= 0 || blocks(o, 'move')) break;
    const from = { x: o.x, y: o.y };
    if (!tryStep(s, o, t.x - o.x, t.y - o.y, c.events)) break;
    for (const h of CREATURE_HOOKS.moved) h(s, o, c.events, from);
    const k = o.y * f.w + o.x;
    for (const r of f.fields ?? []) {
      if (r.kind !== 'web' || !r.cells.includes(k) || r.seen.includes(o.id)) continue;
      r.seen.push(o.id);
      const owner = s.actors[r.owner] ?? null;
      for (const x of r.eachOnce) runEffect(x, { state: s, owner: owner ?? o, target: o, source: owner, events: c.events, field: r });
    }
  }
  const reached = o.hp > 0 && foe.hp > 0 && Math.max(Math.abs(foe.x - o.x), Math.abs(foe.y - o.y)) <= 1 && !blocks(o, 'melee');
  if (reached) for (const th of e.then ?? []) runEffect(th, { ...c, target: foe });
}

export const WORLD_VERBS = {
  dash(e, c) {
    const s = c.state, o = c.owner, foe = c.target && c.target !== o ? c.target : null, goal = foe ?? c.tile;
    if (!goal) return;
    if (o.side !== 'player' && foe) return creatureRush(e, c, foe);   // EP26
    const run = lanePath(s, o, goal, !foe, e.range ?? 6), from = { x: o.x, y: o.y };
    if (run?.length) { const end = run.at(-1); o.x = end.x; o.y = end.y; c.events.push({ type: 'moved', id: o.id, from, to: { x: o.x, y: o.y }, dash: true }); }
    const reached = foe && Math.max(Math.abs(foe.x - o.x), Math.abs(foe.y - o.y)) <= 1;
    for (const th of e.then ?? []) runEffect(th, { ...c, target: reached ? foe : o });
  },
  /** Pushes the target `tiles` away from the owner (or the aimed point), only onto free walkable tiles. */
  knockback(e, c) {
    const s = c.state, t = c.target, from = e.from === 'point' ? c.tile : c.owner;
    if (!t || t.hp <= 0 || !from || t === c.owner || resolveBlocks(t)) return;   // S14: Resolve stops a knockback
    const dx = Math.sign(t.x - from.x), dy = Math.sign(t.y - from.y), start = { x: t.x, y: t.y };
    for (let i = 0; i < (e.tiles ?? 1); i++) {
      const nx = t.x + dx, ny = t.y + dy;
      if ((dx || dy) && shoveIntoLava(s, t, c.owner, nx, ny, c.events)) break;   // sandbox U5: into the lava (lava.js)
      if ((!dx && !dy) || !walkable(s.floor, nx, ny) || bodyOn(s, nx, ny) || s.floor.props?.some(p => p.x === nx && p.y === ny && isBlocking(p))) {
        // RB51 (1.7 world-time.js knockback): a push stopped by a wall or a body thuds where it stopped.
        if (dx || dy) c.events.push({ type: 'knock-blocked', id: t.id, at: { x: t.x, y: t.y }, sfx: 'knock-thud' });
        break;
      }
      moveBody(s, t, { x: nx, y: ny }, c.events, { mode: 'push' });   // C10a (engine-rules-16): a push walks onto the tile: a trap springs, grass tramples, a field takes it
      c.events.push({ type: 'knocked', id: t.id });
      if (t.hp <= 0) break;
    }
    if (t.x !== start.x || t.y !== start.y) grantResolve(s, t, 2, c.events);   // S14: a knockback that moved the hero gives 2 turns
    if (t.side === 'player' && (t.x !== start.x || t.y !== start.y)) refreshSight(s, c.events);   // RB52 (1.7 world-time.js:60 computeFOV)
  },
  /** D26-D27: the hero's allies rise on free tiles around the aimed tile; HP, damage and life from the spell. */
  summon(e, c) {
    if (e.copyOf === 'victim') { raiseCopy(e, c); return; }   // CB14 Corrupted's Shade
    const s = c.state, at = c.tile ?? c.target, r = e.within ?? 1, cells = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = at.x + dx, y = at.y + dy;
      if (walkable(s.floor, x, y) && !bodyOn(s, x, y) && !s.floor.props?.some(p => p.x === x && p.y === y && isBlocking(p))) cells.push({ x, y });
    }
    cells.sort((a, b) => Math.max(Math.abs(a.x - at.x), Math.abs(a.y - at.y)) - Math.max(Math.abs(b.x - at.x), Math.abs(b.y - at.y)));
    // The Brood calls her children afresh: the earlier brood goes back into the dark (1.7 sylla.js prayTheBrood).
    if (c.ability?.replacesOwnBrood) for (const id of s.order) { const a = s.actors[id]; if (a.hp > 0 && a.summon && a.owner === c.owner?.id && a.kind === e.creature) { a.hp = 0; c.events.push({ type: 'died', id: a.id, dismissed: true }); } }
    const n = Math.min(cells.length, Math.round(amount(e.count ?? 1, c)));
    const stat = k => e.stats?.[k] !== undefined && !Array.isArray(e.stats[k]) ? Math.max(1, Math.round(amount(e.stats[k], c))) : undefined;
    // CD1 Raise Dead (1.7 progression-adapter.js castRaiseDead): the rank's form; HP + 2 a level, damage + 1 a 3 levels, x boost.
    const form = (e.stats?.formByRank ?? []).filter(r => r.rank <= (c.rank ?? 0)).pop() ?? e.stats?.formByRank?.[0] ?? null;
    if (c.shared) c.shared.summoned = 0;
    for (const cell of cells.slice(0, n)) {
      const kind = e.creature === 'floor-roster' ? floorRosterKind(s) : e.creature;   // Wobbles' prank: the floor's own creatures
      if (!kind) break;
      const m = makeCreature(kind, cell.x, cell.y);
      const hp = stat('hp'), dmg = stat('damage'), lo = stat('damageMin'), hi = stat('damageMax');
      Object.assign(m, { side: e.side === 'hostile' ? 'foe' : 'ally', owner: c.owner?.id ?? null, noXp: !!e.noXp, summon: true, t: c.owner?.t ?? 0, hunting: true });
      if (hp) { m.hp = m.maxhp = hp; }
      if (dmg) m.dmg = [dmg, dmg];
      if (lo && hi) m.dmg = [lo, hi];
      if (Array.isArray(e.stats?.dmg)) m.dmg = e.stats.dmg.map(v => Math.max(1, Math.round(amount(v, c))));
      if (e.stats?.armour !== undefined) m.armour = Math.round(amount(e.stats.armour, c));
      if (e.stats?.resistPct !== undefined) m.resistAll = amount(e.stats.resistPct, c);   // damage.js: every type but phys
      if (form) {
        const lv = c.state.hero?.level ?? 1, boost = e.stats.boost ? amount(e.stats.boost, c) : 1, more = Math.floor(lv / 3) * (e.stats.damagePerThreeLevels ?? 0);
        m.hp = m.maxhp = Math.max(1, Math.round((form.hp + (e.stats.hpPerLevel ?? 0) * lv) * boost));
        m.dmg = form.dmg.map(d => Math.max(1, Math.round((d + more) * boost)));
        m.name = form.name;
        // The Lich in its own art (1.7 UNDEAD_FORMS sprite m-lich at 1.22); the skeleton's otherwise.
        if (form.sprite) m.look = { ...(m.look ?? {}), sheet: 'mob-' + form.sprite, art: form.art ?? m.look?.art };
        if (form.moves) m.moves = form.moves;   // the Lich throws shadow bolts (1.7 combat.js:510-523)
        if (c.shared) c.shared.form = form.name;
        m.servant = true;   // RB45: Raise Dead's servant (death.js lich-return)
      }
      // A summons' own bite (the brood's web or venom) in place of the kind's riders; its scaled numbers are its
      // caller's, worked out at the call as its HP and damage are (item 167: the web bite's Bleed, 2 + rank x divine).
      if (c.ability?.bite) m.passives = [{ verb: 'on-event', trigger: 'on-hit', effects: atCall(c.ability.bite, c) }];
      if (e.life !== undefined) m.life = Math.max(1, Math.round(amount(e.life, c)));
      if (e.noLoot) m.drops = 'kill-none';
      s.actors[m.id] = m; s.order.push(m.id);
      graveStrength(s, m);   // CF09
      c.events.push({ type: 'spawned', id: m.id, at: cell, summon: true });
      if (c.shared) c.shared.summoned += 1;
    }
  },
  /** A ground or air field on the shape's tiles (fields.js): fire ignites, the rest tick on whoever stands inside. */
  field(e, c) {
    const turns = e.turns === undefined || typeof e.turns === 'number' ? e.turns : amount(e.turns, c);
    layField(c.state, { ...e, turns, ...(c.status ? { fromStatus: true } : {}) }, shapeTiles(e.shape ?? { selector: 'tile' }, c), c.owner, c.events);   // CF16: a status's fire is not the hero's act
  },
  /** Changes tiles; built: Upheaval's rock ridge (set pillar, where wall-across) and putting fires out. */
  terrain(e, c) {
    const s = c.state, f = s.floor;
    if (e.set === 'extinguish') { extinguish(s, shapeTiles(e.where ?? { selector: 'tile' }, c)); return; }
    // Item 287 (1.7 effect-adapter.js:130): a Bleed tick stains bare ground under the bearer, pct of the time.
    if (e.set === 'blood') {
      const t = c.target, k = t.y * f.w + t.x;
      if (f.ground && !f.ground[k] && next(s.rng) < (e.pct ?? 100) / 100) { f.ground[k] = G.BLOOD; c.events.push({ type: 'ground', at: { x: t.x, y: t.y } }); }
      return;
    }
    if (e.set !== 'pillar' || e.where?.selector !== 'wall-across') { s.unbuilt['terrain:' + e.set] = (s.unbuilt['terrain:' + e.set] ?? 0) + 1; return; }
    const tiles = ridgeTiles(s, c.owner, c.tile ?? c.target, e.where.length ?? 7);
    f.rocks ??= {};
    for (const t of tiles) {
      f.props.push({ id: 'mossy-boulder', x: t.x, y: t.y, keep: true, blocks: true, upheaval: true, until: s.now + (e.turns ?? 20) * TURN });
      f.rocks[t.y * f.w + t.x] = 1;
    }
    if (c.shared) c.shared.raised = tiles;
    c.events.push({ type: 'terrain', what: 'upheaval', tiles }, { type: 'log', words: `Upheaval: a ridge of ${tiles.length} rock${tiles.length === 1 ? '' : 's'}.` });
  },
  /**
   * D32, CB49 (1.7 shadow-clone.js snapshot, create): the hero's echo, '<Name>'s Shadow', rises where he stood with his
   * numbers as they are: HP and mana, accuracy, evasion, armour, resistances, crit and its multiplier, his melee blow
   * (the sheet's, Might and damage passives in), the off-hand weapon, his enchants' and elements' hit and crit riders,
   * his buffs, his shields (Ward, Ice Armor, Guard) and his regeneration. It fights as an ally (ai.js allyAct).
   */
  'clone-self'(e, c) {
    const s = c.state, o = c.owner, r = e.ratio ?? 1, h = s.hero;
    s.echoes = (s.echoes ?? 0) + 1;
    const st = h ? heroStats(h, o) : null, blow = st && st.dmg[1] ? st.damageShown[1] / st.dmg[1] : 1;
    const off = h?.worn?.off, main = h?.worn?.main, offSwing = off && itemRowOf(off.id).kind === 'weapon' && !(main && itemRowOf(main.id).row.hands === 2);
    const buffs = Object.fromEntries(Object.entries(o.statuses ?? {}).filter(([id]) => statuses.rows[id]?.family === 'buff').map(([id, v]) => [id, { ...v }]));
    const m = {
      id: `echo-${s.echoes}`, kind: 'echo', name: `${h?.name ?? 'Your'}'s Shadow`, side: 'ally', x: o.x, y: o.y, t: o.t,
      hp: Math.max(1, Math.round(o.hp * r)), maxhp: Math.max(1, Math.round(o.maxhp * r)), mana: o.mana ?? 0, maxmana: o.maxmana ?? 0,
      dmg: o.dmg.map(d => Math.max(1, Math.round(d * blow * r))), offDmg: offSwing ? weaponDamage(off, h).map(d => Math.max(1, Math.round(d * blow * r))) : null,
      acc: o.acc, eva: o.eva, armour: o.armour, speed: o.speed, crit: o.crit ?? 0, critMult: o.critMult, luck: o.luck ?? 0,
      resist: { ...(o.resist ?? {}) }, bulwark: !!o.defence?.critImmune, affinity: { ...(o.affinity ?? {}) }, attr: { ...(o.attr ?? {}) }, divine: o.divine,
      fx: { triggers: (o.fx?.triggers ?? []).filter(t => t.trigger === 'on-hit' || t.trigger === 'on-crit'), critForce: [...(o.fx?.critForce ?? [])], critIf: [...(o.fx?.critIf ?? [])] },
      iceArmor: o.iceArmor ?? 0, maxIceArmor: o.maxIceArmor ?? 0, guard: o.guard ?? 0, maxguard: o.maxguard ?? 0,
      regen: echoRegen(h, o), regenAt: s.now,
      statuses: buffs, look: { ...o.look }, sfx: o.sfx, echo: true,
      summon: true, owner: o.id, noXp: true, drops: 'kill-none', hunting: true, caughtOff: -1,
      ...(e.life ? { life: e.life } : {}),
    };
    s.actors[m.id] = m; s.order.push(m.id);
    graveStrength(s, m);   // CF09
    c.events.push({ type: 'spawned', id: m.id, at: { x: m.x, y: m.y }, summon: true });
  },
  /** A damage-soaking pool kept by its status (the sigils' Ward): the status's magnitude is what is left of the pool. */
  shield(e, c) {
    // CD1: the pool is kept by the status whose row holds it (statuses.json while shield): Ward, Iron Hide, Mana Ward.
    // E27, E28 (1.7 combos.js Silt Shield, Holy Water; infusions.js:47): Ice Armor is the body's own pool, up to its max.
    if (e.pool === 'ice-armor') {
      const t = c.target, n = Math.max(0, amount(e.amount, c)), was = t.iceArmor ?? 0;
      t.iceArmor = Math.min(t.maxIceArmor ?? 0, was + n);
      if (t.iceArmor > was) c.events.push({ type: 'shielded', id: t.id, pool: 'ice-armor', amount: t.iceArmor - was });
      return;
    }
    // E35 (1.7 costs-adapter.js:63-66 spellConduct): the Light tome's ward is the body's own pool, up to its cap.
    if (e.pool === 'tome-ward') {
      const t = c.target, n = Math.max(0, amount(e.amount, c)), was = t.tomeWard ?? 0;
      t.tomeWard = Math.min(Math.round(amount(e.cap, c)), was + n);
      if (t.tomeWard > was) c.events.push({ type: 'shielded', id: t.id, pool: 'tome-ward', amount: t.tomeWard - was });
      return;
    }
    const id = POOL_STATUS[e.pool];
    if (!id) { c.state.unbuilt['shield:' + e.pool] = (c.state.unbuilt['shield:' + e.pool] ?? 0) + 1; return; }
    // I47/IO14: Thorns raises the ward to a floor, preserving a stronger pool rather than adding to it.
    const n = Math.max(0, Math.round(amount(e.atLeast ?? e.amount, c)), e.atLeast === undefined ? 0 : (c.target.statuses[id]?.magnitude ?? 0));
    applyStatus(c.state, c.target, id, { turns: e.turns ?? c.target.statuses[id]?.n, magnitude: n, replace: true }, c.events);
    if (c.shared) c.shared.shield = n;   // the prayer's log says it ("Mana Ward: {n} HP.")
  },
  /** Bone Spear's price (effects.json pay-hp): the caster's HP as direct damage; nonLethal leaves at least 1. */
  'pay-hp'(e, c) {
    const o = c.owner, n = Math.round(amount(e.amount, c)), cost = e.nonLethal ? Math.min(n, o.hp - 1) : n;
    if (cost <= 0) return;
    o.hp -= cost;   // a cost, never a damage packet: no shields, no reactions
    c.events.push({ type: 'damaged', id: o.id, by: null, amount: cost, dtype: 'phys', cause: 'cost' }, { type: 'log', words: `${c.ability?.name ?? 'Prayer'}: ${cost} HP spent.` });
  },
  /** Mana gained (or drained) by the target, within its pool. */
  mana(e, c) {
    const t = c.target, n = Math.round(amount(e.amount, c)), was = t.mana ?? 0;
    t.mana = Math.max(0, Math.min(t.maxmana ?? 0, was + n));
    if (t.mana !== was) c.events.push({ type: 'mana', id: t.id, amount: t.mana - was });
  },
  /** Hunters not beside the hero lose the trail (Smoke). */
  'lose-track'(e, c) {
    const s = c.state, p = c.owner;
    let lost = 0;
    for (const id of s.order) {
      const a = s.actors[id];
      if (a.hp > 0 && a.side === 'foe' && a.hunting && Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) > 1) { a.hunting = false; a.lastSeen = null; a.goal = null; lost++; }
    }
    // E42 (1.7 sigils.js:273): "Smoke deployed." and " Pursuit lost." when a hunter lost him.
    if (e.log) c.events.push({ type: 'log', words: e.log + (lost && e.logLost ? e.logLost : ''), ...(e.logCls ? { cls: e.logCls } : {}) });
  },
  /** Items: identify the carried sigils, every sigil kind, everything, or the one chosen. */
};
