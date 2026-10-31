// The effect verbs that strike, heal, lay statuses, move and choose (spec/effects.md; consolidation C8: effects.js
// split, engine-rules-27). runEffect (effects.js) runs them; verbs-world.js holds the rest.

import { spellGround } from '../spell-ground.js';
import { amount } from '../amount.js';
import { dealDamage } from '../damage.js';
import { applyStatus, removeStatus, heroStatusChanged, statusLanded } from '../statuses.js';
import { next } from '../../lib/rng.js';
import { weaponAttack } from '../attack.js';
import { heroEvent } from '../passives.js';
import { itemRow as itemRowOf } from '../items.js';
import piety from '../../../data/piety.json' with { type: 'json' };
import { blinkTiles } from '../sigils.js'; import { nearFree } from '../space.js';
import { hitChance, accuracyOf, evasionOf, isSurprise, deflects, hostileChance } from '../hit.js';
import tuning from '../../../data/tuning.json' with { type: 'json' };
import statuses from '../../../data/statuses.json' with { type: 'json' };
import { T } from '../../data/tiles.js';
import { realmAllows } from '../crucible.js';
import { firstBodyOnLine, bodyOn, select, randomSafeCells } from './select.js';
import { conditionHolds } from './conditions.js';
import { weightOf, favoriteToy } from '../god-powers.js';
import { UP } from '../set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { forcedCrit, critBonus } from './crit.js';
import { heroHealMult, heal } from '../damage.js';

/** E34: a weapon that is a spell focus (staff, wand: its row adds spell power), whose enchant rides area spells too. */
export const focusWeapon = w => (itemRowOf(w.id)?.row?.effects ?? []).some(x => x.verb === 'modify-stat' && x.stat === 'spell-power');

/** E24: the hit behind a status a rider puts on (a trigger's own packet, else the spell bolt that just struck), for Chill Arc. */
export const hitCause = c => (c.packet ? { packet: c.packet, hit: c.hit } : c.shared?.lastHit ?? null);

export const TO_HIT = tuning.rows['to-hit'], SUR = tuning.rows.surprise, CRIT = tuning.rows.critical;

export let lastDealt = 0;   // the HP the last damage verb took (drain reads it)

export const VERBS = {
  damage(e, c) {
    // D8: the hero's spell damage goes through the spell strike (crit, surprise), one roll shared by every body (D7).
    if (e.tags?.includes('spell') && c.owner?.side === 'player') return VERBS['spell-strike']({ type: e.type, amount: e.amount, sureHit: true }, c);
    let n = amount(e.amount, c);
    // Traps 89: some trap damage to the player is at least minOnPlayer and at most capPctMaxHp of max HP.
    if (c.target?.side === 'player') {
      if (e.minOnPlayer !== undefined) n = Math.max(e.minOnPlayer, n);
      if (e.capPctMaxHp !== undefined) n = Math.min(Math.round(c.target.maxhp * e.capPctMaxHp / 100), n);
    }
    lastDealt = dealDamage(c.state, { target: c.target, source: c.source ?? null, amount: n, type: e.type, premitigated: e.premitigated, bypassShields: e.bypassShields, resist: e.resist, cause: e.cause ?? c.statusId ?? (c.trap ? 'trap:' + c.trap.kind : null), tags: e.tags }, c.events);   // item 90: a trap names itself; C10b: a field whose source is gone names itself
    // E13 (1.7 actions-adapter.js:230): at Light 6 a Smite blesses the ground under the foe it struck.
    if (e.tags?.includes('smite') && c.owner?.side === 'player' && c.target) spellGround(c.state, c.owner, 'light', [{ x: c.target.x, y: c.target.y }], c.events);
  },
  /** Life drain: the owner heals what the damage just before it took, x ratio (Shadow, D35). */
  drain(e, c) {
    const o = c.owner;   // E10: the hero's drain takes his heal multipliers; E27: what does not fit is overheal
    heal(c.state, o, lastDealt * (e.ratio ?? 1) * (o.side === 'player' ? heroHealMult(c.state, o) : 1), c.events, { raw: true, mark: { drain: true } });
  },
  /** A share of the hit that set it off (raw roll, damage dealt, or the blocked part), as its own packet. */
  'damage-from-packet'(e, c) {
    const base = c.packet?.[e.packet ?? 'raw'] ?? 0, n = Math.round(base * (typeof e.ratio === 'number' ? e.ratio : amount(e.ratio, c)));
    if (n <= 0) return;
    const to = e.to ? select(typeof e.to === 'string' ? { selector: e.to } : e.to, c) : [c.target];   // Thorns: "to": "source"
    for (const t of to) {
      if (!t || t.hp <= 0 || t === c.owner) continue;
      if (e.tags?.includes('arc') && c.target && c.target !== t) c.events.push({ type: 'bolt', from: { x: c.target.x, y: c.target.y }, to: { x: t.x, y: t.y }, kind: 'lightning', arc: true });
      dealDamage(c.state, { target: t, source: c.owner, amount: n, type: e.type, tags: ['proc', ...(e.tags ?? [])] }, c.events);
    }
  },
  heal(e, c) {
    const t = c.target, full = e.amount === 'full';
    // CD2 Mending Light, E10 Rot and holy ground (heroHealMult in heal()); F43: Heal never gives more than 40% of max HP
    // once her bonus is in (1.7 casting-adapter.js:24); E27, E11: overheal, and a full heal stanches a bleed.
    const cap = t === c.owner ? c.ability?.capPctMaxHpAfterBonuses : undefined;
    heal(c.state, t, full ? 0 : amount(e.amount, c), c.events, { full, holyGround: !!e.holyGround, natural: !!e.natural, capMaxHpPct: cap });
    if (e.sparkle) c.events.push({ type: 'sparkle', at: { x: t.x, y: t.y }, kind: e.sparkle.kind, n: e.sparkle.n });   // CF27 Wobbles' full healing (1.7 gods.js:149)
  },
  'apply-status'(e, c) {
    const num = v => (v === undefined ? undefined : amount(v, c));
    if (e.bolt && c.victim && c.target && c.target !== c.victim) c.events.push({ type: 'bolt', from: { x: c.victim.x, y: c.victim.y }, to: { x: c.target.x, y: c.target.y }, kind: e.bolt });   // looks only
    const on = applyStatus(c.state, c.target, e.status, { turns: num(e.turns), magnitude: num(e.magnitude), tickDamage: num(e.tickDamage), scale: num(e.scale), source: c.owner?.id, replace: e.replace || e.refresh === 'replace', permanent: e.permanent, fixed: e.durationModifiers === false, cause: hitCause(c) }, c.events);
    // CF08 (1.7 sylla.js:73, :81-83): words over the bearer when it takes (Sylla's 'webbed', 'bleeding', 'poisoned').
    if (on && c.target) for (const f of e.floats ?? []) c.events.push({ type: 'float', id: c.target.id, words: f.words, tone: f.tone, ...(f.sparkle ? { sparkle: f.sparkle } : {}) });
  },
  'remove-status'(e, c) {
    for (const id of [].concat(e.status ?? e.statuses ?? [])) removeStatus(c.state, c.target, id, c.events);
    // By tag (Last Laugh's Second Wind clears every harmful status).
    if (e.tag) for (const id of Object.keys(c.target?.statuses ?? {})) if (statuses.rows[id]?.tags?.includes(e.tag)) removeStatus(c.state, c.target, id, c.events);
  },
  /** Stacks on a stacking status (Chill); at its threshold it becomes the next status (Frozen). */
  'add-stack'(e, c) {
    const t = c.target, row = statuses.rows[e.status], st = row.stacks;
    const had = t.statuses[e.status];
    if (!had && e.n === 0) return;   // n 0 only refreshes a stack already there (Shadow's hits keep Hollow up)
    if (!had && !applyStatus(c.state, t, e.status, { turns: e.turns !== undefined ? amount(e.turns, c) : undefined, source: c.owner?.id, cause: hitCause(c) }, c.events)) return;
    const s = t.statuses[e.status];
    if (!s) return;
    // E32 (1.7 effects.js:141 addChill): a Chill keeps its chiller's Water rank: the hero's, unless a foe chilled it.
    const water = t.side === 'player' || c.owner?.side === 'foe' ? 0 : c.state.hero?.affinity?.water ?? 0;
    if (st?.thresholdSourceWater6 !== undefined) s.waterRank = water;
    // A stack that refreshes (Living Mountain, Warrior's Discipline: refresh 'replace') starts its count again; Iron
    // Constitution keeps the hero's Chill at 2 (item 287, Justin 2026-10-20: "Iron Constitution halves Chill to 2").
    const ic = t.side === 'player' && t.defence?.selfStatus && st?.ironConstitutionTurns;
    if (had && row.refresh === 'replace') s.n = Math.max(s.n ?? 0, ic || (e.turns !== undefined ? amount(e.turns, c) : row.turns ?? 0));
    const was = had ? s.stacks ?? 1 : 0;
    s.stacks = was + (e.n ?? 1);
    if (e.cap) s.stacks = Math.min(e.cap, s.stacks);
    // E33 (1.7 combos.js:90-91 stokeForgeHeat): the stack that reaches the cap says so (statuses.json maxLog).
    if (row.maxLog && e.cap && s.stacks === e.cap && was < e.cap) c.events.push({ type: 'log', words: row.maxLog, cls: 'c-good' });
    // 1.7 stackDiscipline: "Warrior's Discipline: N stacks." (statuses.json log.apply, on the hero).
    if (t.side === 'player' && row.log?.apply?.includes('{n}')) c.events.push({ type: 'log', words: row.log.apply.replace('{n}', s.stacks).replace(/ 1 stacks/, ' 1 stack') });
    heroStatusChanged(c.state, t, e.status);
    // EQ17: a stack on a status already there says so (looks only): 1.7 shieldench.js:27 flourishes every Water block's
    // chill, even on a body already chilled, and a fresh apply's 'applied' event is the only other word of it.
    if (had) c.events.push({ type: 'status', id: t.id, status: e.status, change: 'stacked', stacks: s.stacks });
    if (had) statusLanded(c.state, t, e.status, { source: c.owner?.id, cause: hitCause(c) }, c.events, true);   // E24: each stack lands (Chill Arc, 1.7 onChill)
    if (t.hp <= 0 || !t.statuses[e.status]) return;
    // E32 Deep Freeze (1.7 effects.js:141): from a Water 6 chiller three Chills freeze instead of four.
    const at = t.side === 'player' ? st?.thresholdPlayer : water >= 6 && st?.thresholdSourceWater6 ? st.thresholdSourceWater6 : st?.thresholdOther;
    // E8 (1.7 effects.js:143-146 addChill): a body still immune to Frozen keeps Chill one stack short of it.
    if (st && at && s.stacks >= at && t.statuses['imm-' + st.becomes]) s.stacks = at - 1;
    else if (st && at && s.stacks >= at) {
      removeStatus(c.state, t, e.status, c.events);
      if (applyStatus(c.state, t, st.becomes, { turns: st.becomesTurns, source: c.owner?.id }, c.events)) for (const then of st.then ?? []) runEffect(then, c);
    }
  },
  /**
   * E8 (1.7 effects.js:105, :145 imm_fear, imm_frozen): a timed immunity to one status, kept as the 'imm-<status>'
   * entry that applyStatus refuses on and tickBearer counts down; an untimed one is a passive (passives.js fx.immune).
   */
  'grant-immunity'(e, c) {
    const t = c.target;
    if (!e.turns || !e.status || !t || t.hp <= 0) return;
    const key = 'imm-' + e.status, old = t.statuses[key], n = amount(e.turns, c);
    t.statuses[key] = { n: Math.max(old?.n ?? 0, n), born: c.state.now, magnitude: null, scale: 1, source: null };
  },
  /** Wakes creatures and points them at a place; ones already hunting keep their hunt when skipHunting. */
  alert(e, c) {
    const at = e.toward === 'player' ? c.state.actors[c.state.playerId] : (c.trap ?? c.owner);
    for (const a of select(e.who, c)) {
      if (a.side === 'player' || (e.skipHunting && a.hunting)) continue;
      a.asleep = false; a.goal = { x: at.x, y: at.y };
      c.events.push({ type: 'alerted', id: a.id, toward: a.goal });
    }
  },
  /** random-safe: a uniformly random walkable, empty tile in an ordinary room (traps 86). */
  teleport(e, c) {
    const f = c.state.floor, who = e.who?.selector === 'self' ? c.owner : c.target;
    // D32: to the aimed tile (checked by the ability's aim).
    if (e.to === 'target-tile' && c.tile) {
      if (!realmAllows(c.state, who, c.tile.x, c.tile.y)) return;   // CH28: never past the Crucible's gates
      const from = { x: who.x, y: who.y };
      who.x = c.tile.x; who.y = c.tile.y;
      c.events.push({ type: 'teleported', id: who.id, from, to: { ...c.tile } });
      return;
    }
    if (e.to === 'distance-band') {
      const opts = blinkTiles(c.state);
      if (!opts.length) return;
      const to = opts[Math.floor(next(c.state.rng) * opts.length)], from = { x: who.x, y: who.y };
      who.x = to.x; who.y = to.y;
      c.events.push({ type: 'teleported', id: who.id, from, to });
      return;
    }
    if (e.to === 'landmark') {
      // Recall: to the stairs down, else the open exit; a body there puts the hero beside it.
      const k = f.tiles.indexOf(T.STAIRS), goal = k >= 0 ? { x: k % f.w, y: (k / f.w) | 0 } : f.exitOpen && f.exit ? f.exit : null;
      if (!goal) return;
      const to = !bodyOn(c.state, goal.x, goal.y) ? goal : nearFree(c.state, goal, e.max ?? 2)[0];
      if (!to) return;
      const from = { x: who.x, y: who.y };
      who.x = to.x; who.y = to.y;
      c.events.push({ type: 'teleported', id: who.id, from, to: { x: to.x, y: to.y } });
      return;
    }
    if (e.to !== 'random-safe') { c.state.unbuilt['teleport:' + e.to] = (c.state.unbuilt['teleport:' + e.to] ?? 0) + 1; return; }
    const cells = randomSafeCells(c.state, !!e.safe);
    // CF06 (1.7 gods.js:157-159): Wobbles' escape lands only further than `beyond` tiles, else its `orElse` runs.
    const pool = e.beyond ? cells.filter(t => Math.max(Math.abs(t.x - who.x), Math.abs(t.y - who.y)) > e.beyond) : cells;
    if (!pool.length) { for (const x of e.orElse ?? []) runEffect(x, c); return; }
    const to = pool[Math.floor(next(c.state.rng) * pool.length)], from = { x: who.x, y: who.y };
    who.x = to.x; who.y = to.y;
    c.events.push({ type: 'teleported', id: who.id, from, to });
    if (e.log) c.events.push({ type: 'log', words: e.log });
  },
  /** Sets HP outright; `atLeast` is a non-lethal floor (wrath cannot kill). */
  'set-hp'(e, c) {
    const t = c.target;
    if (e.atLeast !== undefined && t.hp < e.atLeast && t.hp >= 0) t.hp = e.atLeast;
    if (e.value !== undefined) t.hp = Math.min(t.maxhp, e.value);
    if (e.pctMaxHp !== undefined) t.hp = Math.min(t.maxhp, Math.round(t.maxhp * e.pctMaxHp / 100));
  },
  /** One draw by weight among option lists (a picker choice comes with the windows). */
  choose(e, c) {
    if (e.by !== 'weight') { c.state.unbuilt['choose:' + e.by] = (c.state.unbuilt['choose:' + e.by] ?? 0) + 1; return; }
    const ws = e.options.map(o => weightOf(o.weight, c));
    let w = next(c.state.rng) * ws.reduce((a, b) => a + b, 0);
    let pick = e.options.find((o, k) => (w -= ws[k]) < 0) ?? e.options.at(-1);
    // CF06 Favorite Toy (1.7 gods.js wobblesConvertPrank): from rank 3 a prank turns into a reward 5% a rank.
    const conv = favoriteToy(c);
    if (pick.weight?.['from-source'] === 'prankWeight' && conv > 0 && next(c.state.rng) < conv) {
      pick = e.options.find(o => o.weight?.['from-source'] === 'rewardWeight') ?? pick;
      c.events.push({ type: 'log', words: piety.rows['wobbles-outcome'].favoriteToyLog });
    }
    // An option's `if`: when it fails, its `else` effects run instead.
    const ok = !pick.if || conditionHolds(pick.if, c);
    const list = ok ? pick.effects : pick.else ?? [];
    for (const x of list) runEffect(x, c);
    const said = ok ? pick.log : pick.elseLog;   // RB46: an option that falls back says what it became
    // E42 Glacial Tomb (1.7 elements.js:395, :430): "You: Glacial Tomb." or "Rat: entombed 10 turns." ({name}, {tomb}).
    const cls = ok ? pick.logCls : pick.elseLogCls;
    const fill = w => w.replace('{name}', c.target?.name ?? '').replace('{tomb}', String(c.target?.statuses?.tomb?.n ?? ''));
    if (said) c.events.push({ type: 'log', words: fill(said), ...(cls ? { cls } : {}), ...(e.sfx ? { sfx: e.sfx } : {}) });
  },
  /** Drops a body to the next floor: the player takes direct damage then falls; a carried creature waits below. */
  fall(e, c) {
    const s = c.state, t = c.target;
    if (s.floor.boss || s.floorNo % 5 === 0) return;
    if (t.side === 'player') {
      const n = Math.max(1, Math.round(t.maxhp * (e.pctMaxHp ?? 0) / 100));
      dealDamage(s, { target: t, source: null, amount: n, type: 'phys', premitigated: true, bypassShields: true }, c.events);
      if (t.hp > 0) s.pendingFall = true;
      return;
    }
    // W26: a key holder that falls drops the key first.
    if (t.key) { s.floor.items?.push({ x: t.x, y: t.y, item: { kind: 'key' } }); c.events.push({ type: 'drops', at: { x: t.x, y: t.y } }); t.key = false; }
    s.order = s.order.filter(id => id !== t.id);
    delete s.actors[t.id];
    if (e.carry) (s.fallen ??= {})[s.floorNo + 1] = [...(s.fallen?.[s.floorNo + 1] ?? []), t];
    c.events.push({ type: 'fell', id: t.id, carried: !!e.carry });
  },
  /** A full weapon strike by the owner on the target (combat.md order of rolls); a dead target is skipped. */
  'weapon-attack'(e, c) {
    const t = c.target;
    if (!t || t.hp <= 0 || t === c.owner) return;
    // projected 'if-apart': a shot when the target is not beside the owner (Perfect Counter, 1.7 actions-adapter.js:23).
    const apart = Math.max(Math.abs(t.x - c.owner.x), Math.abs(t.y - c.owner.y)) > 1;
    weaponAttack(c.state, c.owner, t, c.events, { mult: typeof e.multiplier === 'object' ? amount(e.multiplier, c) : e.multiplier ?? 1, label: e.label, sureHit: e.sureHit, ranged: e.projected === 'if-apart' ? apart : !!e.projected, proc: !!c.packet, counter: !!e.counter });
    if (c.owner.side === 'player') c.state.hero.lastAttacked = t.id;
  },
  /** D5-D9: a spell hit on one body. A bolt stops at the first body on its line, rolls at accuracy + 10 unless sure. */
  'spell-strike'(e, c) {
    const s = c.state, o = c.owner;
    let t = c.target;
    if (e.bolt && t && t !== o) t = firstBodyOnLine(s, o, t) ?? t;
    if (!t || t.hp <= 0 || t === o) return;
    const surprise = isSurprise(s, o, t);
    // CB11 (1.7 combat.js:152 hostileHitChance): a foe's bolt at the hero may be deflected, and Blur lowers its chance.
    if (e.bolt && deflects(s, o, t, c.events, { spell: true, bolt: true, label: c.ability?.name ?? null })) { if (c.shared) c.shared.missed = true; return; }
    if (e.bolt && !e.sureHit && !surprise) {
      const ch = hostileChance(o, t, hitChance(accuracyOf(s, o) + TO_HIT.spellBoltAccuracyBonus, evasionOf(t)));   // 1.7 accOf(e) + 10: the floor's bonus too (C8)
      if (!(next(s.rng) < ch)) {
        if (c.shared) c.shared.missed = true;   // a missed bolt carries no riders
        c.events.push({ type: 'attacked', id: o.id, target: t.id, hit: false, ranged: true, spell: true, bolt: true, label: c.ability?.name ?? null });
        if (t.side === 'foe') { t.hunting = true; t.lastSeen = { x: o.x, y: o.y, at: s.now }; }
        return;
      }
    }
    if (e.bolt && c.shared) c.shared.struck = t;   // the riders follow the body the bolt struck
    let dmg = typeof e.amount === 'number' ? e.amount : amount(e.amount, { ...c, target: t });
    if (surprise) dmg *= SUR.spellMult;
    if (e.bolt && c.fromHiding && o.statuses?.['into-the-dark']) dmg *= 1 + (o.statuses['into-the-dark'].magnitude ?? 0) / 100;   // E6 Into the Dark
    const crit = o.side === 'player' && (!!t.statuses.sapped || forcedCrit(o, t, c, !!e.bolt) || next(s.rng) < ((o.crit ?? 0) + critBonus(o, t, c)) / 100);
    if (crit) dmg *= o.critMult ?? CRIT.playerMultBase;
    const ev = { type: 'attacked', id: o.id, target: t.id, hit: true, crit, surprise, ranged: true, spell: true, bolt: !!e.bolt, label: c.ability?.name ?? null, damage: 0 };   // bolt: flies to its body (an area's hits are drawn by the cast, spell-fx.js)
    c.events.push(ev);
    const statusesBefore = Object.keys(t.statuses ?? {});   // E16 Clear Waters reads Frozen as it was before the bolt thawed it
    ev.damage = dealDamage(s, { target: t, source: o, amount: dmg, type: e.type ?? 'magic', tags: ['spell', e.bolt ? 'single-target' : 'area'] }, c.events);
    if (o.side === 'player') {
      const info = { target: t, packet: { raw: dmg, dealt: ev.damage, type: e.type ?? 'magic', tags: ['spell'] }, hit: { crit, surprise, spell: true, ranged: true, single: !!e.bolt, primary: !!e.bolt, fromHiding: !!c.fromHiding, statusesBefore } };
      if (c.shared) {
        c.shared.lastHit = { packet: info.packet, hit: info.hit };   // E24: the bolt's riders (Frost Shard's Chill) arc from it
        if (e.bolt && ev.damage > 0) (c.shared.ground ??= []).push({ x: t.x, y: t.y });   // E13: a bolt marks where it struck
      }
      if (e.bolt) heroEvent(s, 'on-hit', info, c.events);
      if (crit) heroEvent(s, 'on-crit', info, c.events);
      if (surprise) heroEvent(s, 'on-surprise-hit', info, c.events);
      // E34 (1.7 spellench.js applySpellWeaponEnchant, magic.md D8): the main hand's enchant rides a single-target spell
      // that hurt a foe, and an area spell's hits from a staff or wand; Hallowed Edge heals on each.
      const w = s.hero?.worn?.main;
      if (w?.enchant && ev.damage > 0 && t.side === 'foe' && (e.bolt || focusWeapon(w))) heroEvent(s, 'on-hit', { ...info, weapon: 'main', weaponOnly: true }, c.events);
    }
    if (t.side === 'foe' && t.hp > 0) { t.hunting = true; t.lastSeen = { x: o.x, y: o.y, at: s.now }; if (c.ability?.name !== 'Sap') t.asleep = false; }   // D9
  },
  /** A run along the straight lane to the target (D16): every tile short of a foe, or onto the aimed ground; `then` at the end. */
};
