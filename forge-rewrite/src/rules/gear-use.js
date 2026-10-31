// Gear that is learned by wearing and using it (spec/items.md I45-I52, I56; turns.md B3), the rules side of sandbox
// item 60: a ring names its kind when put on, a cursed piece reveals itself and binds, gear identifies by use, and the
// worn amulet spends charges that kills refill (1.7 gear.js, gear-adapter.js, amulets.js, death-adapter.js @3c8b312).

import tiers from '../../data/tiers.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import { itemRow } from './items.js';
import { theName } from './monsters.js';
import { enterTile } from './pickup.js'; import { itemName, trinketKnown, learnTrinket } from './item-names.js';
import { UP } from './set-pieces.js'; const runEffect = (...a) => UP.runEffect(...a);   // C17: the one verb path (set-pieces.js UP, from effects.js)
import { applyStatus, removeStatus, statusRow } from './statuses.js';
import { echoSigil, sigilMotes } from './sigils.js';
import { registerPhase } from './phases.js';
import { bodyAt, propAt } from './moves.js';
import { refreshSight } from './sight.js';
import { realmAllows } from './crucible.js';
import { T, tileAt, walkable, wallLike, G } from '../data/tiles.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { extinguish } from './fields.js';
import { springTrap } from './traps.js';

const TURN = tuning.rows.clock.unitsPerGameTurn;
const ID = tiers.rows.identification.usesToIdentify;
const CH = amulets.rows.charges;
const isCursed = it => !!it && (it.cursed || (it.plus ?? 0) < 0);
const kindOf = it => itemRow(it.id).kind;
const log = (events, words, sfx) => events.push({ type: 'log', words, ...(sfx ? { sfx } : {}) });

/** A piece becomes known without a word (sigils, the Forge, uncursing); a ring or amulet's kind is learned too (I52). */
export function learnItem(state, it) {
  if (!it || it.kind === 'sigil') return;
  it.known = true;
  const k = kindOf(it);
  if (k === 'ring' || k === 'amulet') learnTrinket(state, it.id);
}

/** I51: "You now know your <b>Name</b>." The ring or amulet kind is learned for the run too (I52). */
export function identify(state, it, events) {
  if (!it || it.known !== false) return;
  learnItem(state, it);
  log(events, `You now know your ${itemName(it, state)}${isCursed(it) ? ': it is cursed' : ''}.`, 'identify');
}

/** One use of a worn piece (I51); it identifies at its kind's count. */
export function noteUse(state, it, events) {
  if (!it || it.known !== false) return;
  it.uses = (it.uses ?? 0) + 1;
  const k = kindOf(it), need = ID[k === 'offhand' ? 'offhand' : k];
  if (need && it.uses >= need) identify(state, it, events);
}

/** What putting a piece on says and does: a ring names its kind (I52); a cursed piece reveals itself (I56). */
export function onEquip(state, it, events) {
  const k = kindOf(it);
  if (k === 'ring' && !trinketKnown(state, it.id)) {
    learnTrinket(state, it.id);
    log(events, `You recognize it: a ${itemRow(it.id).row.name}. How strong it is, time will tell.`);
  }
  if (isCursed(it) && !(k === 'amulet' && it.known === false)) {
    it.known = true;
    log(events, `The ${itemName(it, state)} tightens around you. It is cursed!`, 'wrath');
  }
}

/** B3: each paid action, each worn ring gains a use; the off-hand only while a hunting foe is in sight. */
registerPhase('identify-gear', (state, ctx, events) => {
  const h = state.hero;
  if (!h || ctx.kind === 'free') return;
  for (const s of ['ring1', 'ring2']) noteUse(state, h.worn[s], events);
  const off = h.worn.off;
  if (off && state.order.some(id => { const a = state.actors[id]; return a.hp > 0 && a.side === 'foe' && a.hunting && state.vis?.[a.y * state.floor.w + a.x]; })) noteUse(state, off, events);
});

/** The amulet's numbers at its level (values with byLevel), as effects read them through from-source. */
export function amuletValues(it) {
  const row = itemRow(it.id).row, lv = Math.min(3, Math.max(1, it.level ?? 1)), out = {};
  for (const [k, v] of Object.entries(row.values ?? {})) out[k] = v?.byLevel ? v.byLevel[lv - 1] : v;
  return out;
}

/** 1.7 boltPathRaw: the tiles from the hero to `t`, the hero's own left out. */
function line(a, t) {
  const out = [], dx = Math.abs(t.x - a.x), dy = Math.abs(t.y - a.y), sx = a.x < t.x ? 1 : -1, sy = a.y < t.y ? 1 : -1;
  let err = dx - dy, x = a.x, y = a.y;
  while (!(x === t.x && y === t.y)) { const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } out.push({ x, y }); }
  return out;
}
const solidProp = (f, x, y) => { const q = propAt(f, x, y); return !!q && (q.blocks || !!props.rows[q.id]?.blocks); };
const moveBody = (a, to, events) => { events.push({ type: 'moved', id: a.id, from: { x: a.x, y: a.y }, to: { x: to.x, y: to.y } }); a.x = to.x; a.y = to.y; };

/**
 * I47's amulets whose rules are code, not data (1.7 amulets.js:75-98, :125-193). Each answers a refusal (and logs it)
 * when `check` is set, and does the thing when it is not. The other amulets run their effects from amulets.json.
 */
const SPECIAL = {
  hook(state, v, tile, events, check) {
    const f = state.floor, p = state.actors[state.playerId], path = line(p, tile), foe = bodyAt(state, tile.x, tile.y);
    if (foe && foe !== p) {
      if (foe.boss) { log(events, `${foe.name} is far too heavy to drag.`); return 'too-heavy'; }
      const first = path.length > 1 ? path[0] : null;
      const land = first && walkable(f, first.x, first.y) && realmAllows(state, foe, first.x, first.y) && !bodyAt(state, first.x, first.y) ? first : null;   // CH28
      for (const t of path.slice(0, -1)) if (!(walkable(f, t.x, t.y) || [T.WATER, T.CHASM].includes(tileAt(f, t.x, t.y)))) { log(events, 'Something is in the way.'); return 'blocked'; }
      if (!land) { log(events, 'It is already next to you.'); return 'adjacent'; }
      if (check) return null;
      moveBody(foe, land, events);
      Object.assign(foe, { hunting: true, asleep: false });
      applyStatus(state, foe, 'stun', { turns: 1, source: p.id }, events);
      log(events, `Hook: ${foe.name} pulled.`, 'swing');
      return null;
    }
    const t0 = tileAt(f, tile.x, tile.y);
    if (!(wallLike(f, tile.x, tile.y) || [T.DOOR, T.LOCKED, T.SEALED, T.ICE_DOOR].includes(t0) || solidProp(f, tile.x, tile.y))) { log(events, 'Hook: target an enemy, wall, closed door or solid object.'); return 'no-anchor'; }
    let dest = null;
    for (const t of path.slice(0, -1)) {
      if (bodyAt(state, t.x, t.y) || wallLike(f, t.x, t.y) || solidProp(f, t.x, t.y)) break;
      if (walkable(f, t.x, t.y) && realmAllows(state, p, t.x, t.y)) dest = t;   // CH28
    }
    if (!dest) { log(events, 'There is no room to haul yourself there.'); return 'no-room'; }
    if (check) return null;
    moveBody(p, dest, events);
    log(events, 'Hook: pulled across.', 'swing');
    refreshSight(state, events); enterTile(state, events);
    return null;
  },
  swap(state, v, tile, events, check) {
    const p = state.actors[state.playerId], who = bodyAt(state, tile.x, tile.y);
    if (!who || who === p) { log(events, 'Aim at a creature.'); return 'no-target'; }
    if (who.boss) { log(events, `${who.name} will not be moved.`); return 'too-heavy'; }
    if (!realmAllows(state, p, who.x, who.y) || !realmAllows(state, who, p.x, p.y)) { log(events, 'The way is sealed.'); return 'sealed'; }   // CH28
    if (check) return null;
    const here = { x: p.x, y: p.y }, there = { x: who.x, y: who.y };
    moveBody(p, there, events); moveBody(who, here, events);
    log(events, `You trade places with ${theName(who.name)}.`, 'vanish');   // CD27 (1.7 amulets.js:190)
    refreshSight(state, events); enterTile(state, events);
    return null;
  },
  stillness(state, v, tile, events, check) {
    if (check) return null;
    // G19: Stillness is the hero's status (statuses.json), so its badge ring, HUD card and log rows all read it.
    applyStatus(state, state.actors[state.playerId], 'stillness', { turns: v.steps, fixed: true, replace: true }, events);
    log(events, 'Time stops. Move freely; any other action starts it again.');
    return null;
  },
  echo(state, v, tile, events, check, choice) {
    const last = state.run?.lastSigil, never = amulets.rows.echo.effects[0].never;
    if (!last) { log(events, 'The amulet has no sigil to echo yet. Read one first.'); return 'nothing-to-echo'; }
    const name = sigils.rows[last]?.name ?? last;
    if (never.includes(last.replace(/2$/, ''))) { log(events, `No amulet can echo the ${name}.`); return 'cannot-echo'; }
    if (sigilMotes(last) > v.maxMotes) { log(events, `The amulet cannot echo the ${name} yet. It needs to grow first.`); return 'cannot-echo-yet'; }
    if (check) return null;
    const r = echoSigil(state, last, choice, events);
    return r === 'act' ? null : r;
  },
  /**
   * EQ9 (1.7 amulets.js amuletTide): the 3 by 3 is washed (fires and webs out), its bare floor floods for 20 game
   * turns, whoever stands in it loses Burning and Webbed and is Wet 6; foes round the centre are shoved out (not a
   * boss or a big body); the wave trips every trap in the room. A tile with a prop on it stays dry.
   */
  tide(state, v, tile, events, check) {
    if (check) return null;
    const f = state.floor, cells = [], effects = amulets.rows.tide.effects;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tile.x + dx, y = tile.y + dy;
      if (x < 0 || y < 0 || x >= f.w || y >= f.h) continue;
      const k = y * f.w + x;
      extinguish(state, [{ x, y }]);
      if (f.tiles[k] === T.FLOOR && !propAt(f, x, y)) { cells.push([x, y, T.FLOOR, f.ground[k]]); f.tiles[k] = T.WATER; f.ground[k] = G.NONE; }
      const who = bodyAt(state, x, y);
      if (who && who.hp > 0) {
        for (const id of ['burn', 'web']) if (who.statuses?.[id]) removeStatus(state, who, id, events);
        applyStatus(state, who, 'wet', { turns: effects.find(e => e.verb === 'apply-status').turns }, events);
      }
    }
    (f.tides ??= []).push({ cells, until: state.now + effects.find(e => e.verb === 'terrain').turns * TURN });
    const push = effects.find(e => e.verb === 'knockback');
    if (v.push) for (const id of [...state.order]) {
      const a = state.actors[id];
      if (a.side !== 'foe' || a.hp <= 0 || a.boss || (a.size ?? 1) > 1 || Math.max(Math.abs(a.x - tile.x), Math.abs(a.y - tile.y)) > 1 || (a.x === tile.x && a.y === tile.y)) continue;
      runEffect({ ...push, target: undefined, if: undefined }, { state, owner: state.actors[state.playerId], target: a, tile, source: v, events });
    }
    const wave = { type: 'terrain', what: 'tide', at: { x: tile.x, y: tile.y }, tiles: cells.map(([x, y]) => ({ x, y })), tripped: [] };
    events.push({ type: 'ground', at: { x: tile.x, y: tile.y } }, wave);   // the splash is the amulet event's (audio.js AMULET_SFX)
    log(events, 'Tide: hazards cleared; ground flooded.');
    const room = (f.rooms ?? []).find(r => tile.x >= r.x && tile.x < r.x + r.w && tile.y >= r.y && tile.y < r.y + r.h);
    if (!room) return null;
    let tripped = 0;
    for (const t of [...(f.traps ?? [])]) {
      if (t.x < room.x || t.x >= room.x + room.w || t.y < room.y || t.y >= room.y + room.h) continue;
      const victim = bodyAt(state, t.x, t.y);
      if (victim && victim.hp > 0) springTrap(state, victim, t, events);
      else {
        if (t.kind === 'alarm') for (const id of state.order) { const a = state.actors[id]; if (a.side === 'foe' && a.asleep && Math.hypot(a.x - t.x, a.y - t.y) <= 10) { a.asleep = false; a.hunting = true; } }
        f.traps.splice(f.traps.indexOf(t), 1);
        wave.tripped.push({ x: t.x, y: t.y });
      }
      tripped++;
    }
    if (tripped) log(events, `Tide: ${tripped} trap${tripped === 1 ? '' : 's'} triggered.`);
    return null;
  },
  /** EQ9 (1.7 amulets.js amuletPillar): a stone pillar on an empty floor tile for the level's turns; it blocks the way and sight. */
  pillar(state, v, tile, events, check) {
    const f = state.floor, t0 = tileAt(f, tile.x, tile.y);
    if (!(t0 === T.FLOOR || t0 === T.OPEN_DOOR) || bodyAt(state, tile.x, tile.y) || propAt(f, tile.x, tile.y) || f.items?.some(i => i.x === tile.x && i.y === tile.y)) { log(events, 'The pillar needs an empty tile.'); return 'not-empty'; }
    if (check) return null;
    f.props.push({ id: 'pillar', x: tile.x, y: tile.y, keep: true, blocks: true, amuletPillar: true, until: state.now + (v.turns ?? 15) * TURN });
    (f.rocks ??= {})[tile.y * f.w + tile.x] = 1;
    events.push({ type: 'terrain', what: 'pillar', tiles: [{ x: tile.x, y: tile.y }], shake: 4 });   // the stone's crack is the amulet event's
    log(events, 'Pillar raised.');
    refreshSight(state, events);
    return null;
  },
};

/** EQ9 A5 (1.7 turnExpireAmuletTerrain): a Tide's flood drains (grass comes back bare, the rest a puddle); a Pillar crumbles. */
registerPhase('amulet-terrain', (state, ctx, events) => {
  const f = state.floor;
  if (!f) return;
  if (f.tides?.length) {
    f.tides = f.tides.filter(t => {
      if (state.now < t.until) return true;
      for (const [x, y, tile, ground] of t.cells) { const k = y * f.w + x; if (f.tiles[k] === T.WATER) { f.tiles[k] = tile; f.ground[k] = ground === G.GRASS ? G.NONE : G.PUDDLE; } }
      if (t.cells.length) events.push({ type: 'ground', at: { x: t.cells[0][0], y: t.cells[0][1] } });
      return false;
    });
  }
  const gone = (f.props ?? []).filter(p => p.amuletPillar && state.now >= p.until);
  if (!gone.length) return;
  f.props = f.props.filter(p => !gone.includes(p));
  for (const p of gone) delete f.rocks?.[p.y * f.w + p.x];
  events.push({ type: 'terrain', what: 'pillar-ends', tiles: gone.map(p => ({ x: p.x, y: p.y })) });
  refreshSight(state, events);
});

export const capacity = it => CH.capacityByLevel[Math.min(3, Math.max(1, it.level ?? 1)) - 1];
export const killsNeeded = it => Math.max(CH.killsMinimum, Math.round(itemRow(it.id).row.killsPerCharge * (isCursed(it) ? CH.killsCursedMult : 1)));

/** I45: a kill on the hero's side adds progress (elites and bosses 3); a charge needs the amulet's kills. */
export function amuletKill(state, victim, by, events) {
  const it = state.hero?.worn?.amulet;
  if (!it || by?.side !== 'player' || victim.side !== 'foe') return;
  const cap = capacity(it);
  if ((it.charges ?? 0) >= cap) { if (CH.fullDropsProgress) it.progress = 0; return; }
  it.progress = (it.progress ?? 0) + (victim.boss || victim.elite ? CH.eliteOrBossKillCounts : 1);
  const need = killsNeeded(it);
  let gained = 0;
  while (it.progress >= need && (it.charges ?? 0) < cap) { it.charges = (it.charges ?? 0) + 1; it.progress -= need; gained += 1; }
  if (it.charges >= cap && CH.fullDropsProgress) it.progress = 0;
  // E31 (1.7 death-adapter.js:98-109 rewardAmuletKill): a kill that fills a charge says so in green with the essence chime.
  if (gained) events.push({ type: 'log', words: `${itemName(it, state)}: ${it.charges}/${cap} charges.`, cls: 'c-good', sfx: 'pickup-essence' });
}

/**
 * I45-I49: the worn amulet's use at `tile`. Returns 'act', 'free' or a refusal. A cursed amulet with a charge fails
 * (I49); the first use names its kind (I52); three charges spent identify it (I51); 5 and 15 uses level it (I46).
 */
export function useAmulet(state, tile, events, choice = null) {
  const h = state.hero, p = state.actors[state.playerId], it = h?.worn?.amulet;
  if (!it) return 'no-amulet';
  if ((it.charges ?? 0) < 1) { log(events, `${itemName(it, state)}: no charges. Kills refill it.`); return 'no-charge'; }
  const row = itemRow(it.id).row, values = amuletValues(it), special = SPECIAL[it.id];
  if (row.aim) {
    if (!tile) return 'no-target';
    if (values.range && Math.max(Math.abs(tile.x - p.x), Math.abs(tile.y - p.y)) > values.range) return 'out-of-range';
  }
  if (isCursed(it)) {   // I49
    it.charges -= 1;
    identify(state, it, events);
    log(events, `Your ${itemName(it, state)} fails. A curse unleashes a trap instead!`, 'wrath');
    // EQ31: the hero still plays the cast before the trap springs (1.7 failCursedAmulet, amulets.js:51 setClip 'cast').
    events.push({ type: 'amulet', id: p.id, amulet: it.id, at: { x: p.x, y: p.y }, failed: true });
    for (const e of amulets.rows['cursed-use'].effects) runEffect(e, { state, owner: p, target: p, tile: { x: p.x, y: p.y }, source: values, events });
    return 'act';
  }
  if (special) { const why = special(state, values, tile, events, true, choice); if (why) return why; }
  if (!trinketKnown(state, it.id)) { learnTrinket(state, it.id); log(events, `It is an ${row.name}!`); }
  events.push({ type: 'amulet', id: p.id, amulet: it.id, at: tile ?? { x: p.x, y: p.y }, level: it.level ?? 1, radius: amulets.rows[it.id]?.values?.radius?.byLevel?.[(it.level ?? 1) - 1] ?? null });   // level: looks only (Seeking's ripple, EQ10); C8: its reach
  if (special) {
    const why = special(state, values, tile, events, false, choice);
    if (why === 'picker') return 'free';   // Echoes waits for the chosen piece; nothing is spent yet
    if (why) return why;
  } else {
    const ctx = { state, owner: p, target: (tile && bodyAt(state, tile.x, tile.y)) || p, tile: tile ?? { x: p.x, y: p.y }, source: values, events, range: values.range };
    for (const e of row.effects ?? []) runEffect(e, ctx);
  }
  it.charges -= 1;
  it.spent = (it.spent ?? 0) + 1;
  if (it.known === false && it.spent >= ID.amulet) identify(state, it, events);
  const lv = it.level ?? 1, next = CH.levelAtUses[lv - 1];
  if (next !== undefined && it.spent >= next) {
    it.level = lv + 1;
    log(events, `Your ${itemName(it, state)} has grown used to you: it now holds ${capacity(it)} charges, and its power grows.`, 'piety-rank');
  }
  return row.takesTime === false ? 'free' : 'act';
}

/** 1.7 turns.js:10-12: while Stillness lasts a step costs no time; any other paid action ends it. */
export function stillnessStep(state, kind, events) {
  const p = state.actors[state.playerId], st = p?.statuses?.stillness;
  if (!st || kind === 'refused' || kind === 'free') return kind;
  const words = statusRow('stillness').log;
  if (kind !== 'move') { removeStatus(state, p, 'stillness', events); log(events, words.broken); return kind; }
  st.n -= 1;
  refreshSight(state, events);
  if (st.n <= 0) { removeStatus(state, p, 'stillness', events); log(events, words.end); }
  return 'free';
}
