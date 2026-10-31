// Items in play (spec/items.md I62, I67, I69, I73; 1.7 systems.js entryItemsAndTerrain and grab): what stepping onto
// a tile collects, the Pick up command, chests, kill drops, hearts and mana globes.

import sigils from '../../data/sigils.json' with { type: 'json' };
import { itemName, trinketKnown, learnTrinket } from './item-names.js';
import { nearFree } from './space.js';
import { propBlocks } from '../data/props.js';
import loot from '../../data/loot.json' with { type: 'json' };
import tuning from '../../data/tuning.json' with { type: 'json' };
import { rollTable, essenceMult, trinketLook } from './loot.js';
import { itemRow, value } from './items.js';
import rings from '../../data/rings.json' with { type: 'json' };
import { makeCreature, theName, capFirst } from './monsters.js';
import monsters from '../../data/monsters.json' with { type: 'json' };
import { next } from '../lib/rng.js';
import { registerPhase } from './phases.js';
import { T, tileAt, walkable } from '../data/tiles.js';
import { dealDamage, heal } from './damage.js';
import { openPlaneChest } from './plane-chest.js';
import { ITEM_TAKEN, ITEM_DROPPED, ITEM_PICKED } from './set-pieces.js';
import { tally } from './run-record.js';
import { affinityCap } from './magic.js';
import { award } from './faith.js';
import gods from '../../data/gods.json' with { type: 'json' };
import rooms from '../../data/rooms.json' with { type: 'json' };
import { biomeIndex } from '../data/schedule.js';

const L = loot.rows, REWARDS = tuning.rows['rewards-on-kill'], BAG = L.bag.slots;
const TURN = 100;   // one game turn on the global clock

/** A floor item's name for the log. */



const here = (state, x, y) => state.floor.items?.filter(i => i.x === x && i.y === y) ?? [];
/** Takes a floor item off the floor and tells the hooks (rules/set-pieces.js ITEM_TAKEN: the crystal vault). */
const take = (state, i, events) => { state.floor.items.splice(state.floor.items.indexOf(i), 1); for (const fn of ITEM_TAKEN) fn(state, i, events); };

/** Stepping onto a tile: essence and motes are collected; hearts and globes are used when the bar needs them. */
export function enterTile(state, events) {
  const p = state.actors[state.playerId], h = state.hero;
  for (const i of here(state, p.x, p.y)) {
    const it = i.item;
    if (it.kind === 'essence') {
      const n = Math.round(it.n * essenceMult(state.floorNo));
      take(state, i, events); h.essence += n; tally(state, 'essence', n);   // the score counts essence earned
      events.push({ type: 'pickup', what: 'essence', n, sfx: 'pickup-essence', at: { x: p.x, y: p.y } }, { type: 'log', words: `Picked up ${n} essence.` });
    } else if (it.kind === 'mote') {
      take(state, i, events); h.motes[it.el] = (h.motes[it.el] ?? 0) + 1;
      events.push({ type: 'pickup', what: 'mote', el: it.el, sfx: 'pickup-mote', at: { x: p.x, y: p.y } }, { type: 'log', words: `Picked up ${it.el} mote.` });
    } else if (it.kind === 'core') {
      take(state, i, events); h.core = it.name;
      // D51: claiming a core (once per core name) raises the affinity cap and opens the Fuse tab alone.
      const claimed = !!state.run && !(state.run.coreNames ??= []).includes(it.name);
      if (claimed) { state.run.coreNames.push(it.name); state.run.cores = (state.run.cores ?? 0) + 1; state.coreInfusion = true; }
      events.push({ type: 'pickup', what: 'core', sfx: 'pickup-mote', at: { x: p.x, y: p.y } }, { type: 'core-claimed', name: it.name }, { type: 'log', words: `You take up the ${it.name}. It hums against your ribs. Bring it to the exit gate.` });
      // RB16 (1.7 cores.js claimCore announce): the first time a core is claimed, the new cap.
      if (claimed) events.push({ type: 'log', words: `Your affinity cap rises to ${affinityCap(state)}. One more mote can take root in you.`, kill: true });
    } else if (it.kind === 'key' && it.key === 'crystal') {
      // World 55-56: the crystal key opens only the crystal door (rules/puzzles.js counts it), never an iron door.
      take(state, i, events);
      events.push({ type: 'pickup', what: 'key', sfx: 'pickup-key', at: { x: p.x, y: p.y } }, { type: 'log', words: 'Picked up crystal key.' });
    } else if (it.kind === 'key') {
      take(state, i, events); h.keys = (h.keys ?? 0) + 1;
      events.push({ type: 'pickup', what: 'key', sfx: 'pickup-key', at: { x: p.x, y: p.y } }, { type: 'log', words: 'Picked up iron key.' });
    } else if (it.kind === 'heart' && p.hp < p.maxhp) {
      // E47 (1.7 capstones.js:32 rotHealing): Rot halves a heart's heal; it still stanches a bleed (on-heal, E11).
      // C7: 1.7's heart heals plainly (capstones.js:122: no Mending Light, no holy ground), so it is a raw heal.
      const base = Math.max(4, Math.round(p.maxhp * L.globes.heartHealPct / 100));
      take(state, i, events); heal(state, p, Math.round(p.statuses?.rot ? base * 0.5 : base), events, { raw: true, overheal: false });
      events.push({ type: 'pickup', what: 'heart', sfx: 'heal', at: { x: p.x, y: p.y } });
    } else if (it.kind === 'globe' && p.mana < p.maxmana) {
      const n = Math.min(p.maxmana - p.mana, Math.max(5, Math.round(p.maxmana * L.globes.globeManaPct / 100)));
      take(state, i, events); p.mana += n;
      events.push({ type: 'pickup', what: 'globe', n, sfx: 'pickup-essence', at: { x: p.x, y: p.y } });
      // E46 (1.7 capstones.js:33): a mana globe gives Vellum's follower 5 piety, no favor.
      const gp = gods.rows[h.faith?.god]?.manaGlobePiety;
      if (gp) award(state, gp, events, { pietyOnly: true });
    } else if (it.kind === 'heart' || it.kind === 'globe') {
      // CB34 (1.7 systems.js:133-134): a heart or globe left lying because its bar is full says what it does.
      const heart = it.kind === 'heart';
      events.push({ type: 'log', words: heart ? `Heart: +${L.globes.heartHealPct}% max HP when needed.` : `Mana globe: +${L.globes.globeManaPct}% max Mana when needed.`, cls: 'c-info', cue: `${p.x},${p.y}:${it.kind}` });
    } else if (!['key', 'core'].includes(it.kind)) {
      // CB34 (1.7 systems.js:125-135): the hint names the bound Pick up key ('Pick up' on touch), and shows on the map
      // once per item and control; a step back onto it still writes it in the log (screens/log-text.js cued).
      const name = itemName(it, state);
      events.push({ type: 'log', words: `${name} · G to pick up.`, hint: 'pickup', item: name, gear: it, cls: 'c-info', cue: `${p.x},${p.y}:${name}` });
    }
  }
}

/**
 * I63: a dropped item lies on the hero's tile (no game time); food and sigils stack with the same item there, as in the
 * bag. The hooks hear of it (set-pieces.js ITEM_DROPPED: the offering bowl).
 */
export function dropOnFloor(state, it, events) {
  const p = state.actors[state.playerId], f = state.floor;
  const stack = (it.kind === 'food' || it.kind === 'sigil') ? f.items.find(i => i.x === p.x && i.y === p.y && i.item.kind === it.kind && i.item.id === it.id) : null;
  let lying = stack;
  if (stack) stack.item.count = (stack.item.count ?? 1) + (it.count ?? 1);
  else { lying = { x: p.x, y: p.y, item: it }; f.items.push(lying); }
  events.push({ type: 'drops', at: { x: p.x, y: p.y } }, { type: 'log', words: `You drop ${itemName(it, state)}.` });
  for (const fn of ITEM_DROPPED) fn(state, lying, events);
}

/** The kinds a step takes (enterTile), never the bag's: the HUD's Pick up button, map clicks and tips read this list. */
export const AUTO = ['essence', 'mote', 'heart', 'globe', 'key', 'core'];

/** I62: Pick up (free): every item here goes in the bag; food of one kind stacks; a full bag refuses. */
export function pickUp(state, events, at = null) {
  const p = state.actors[state.playerId], bag = state.hero.bag;
  // Item 307 (Justin 2026-10-21: "you should be able to pick up an item you are next to with a click without having to be
  // on top of it"): `at`, a tile beside the hero, is taken from where it lies, no step, at the same cost.
  const t = at && Math.max(Math.abs(at.x - p.x), Math.abs(at.y - p.y)) === 1 ? at : { x: p.x, y: p.y }, beside = t.x !== p.x || t.y !== p.y;
  // Item 96 (Justin 2026-10-17: "i can't pick up essence crystals etc."): a hero who came to stand on essence without
  // stepping onto it (a sandbox teleport, a drop under his feet) takes it with Pick up, as a step would have.
  const lying = here(state, t.x, t.y).length;
  if (!beside && here(state, t.x, t.y).some(i => AUTO.includes(i.item.kind))) enterTile(state, events);
  const took = lying - here(state, t.x, t.y).length;
  const items = here(state, t.x, t.y).filter(i => !AUTO.includes(i.item.kind));
  if (!items.length) { if (!took) events.push({ type: 'log', words: 'Nothing here to pick up.' }); return took > 0; }
  let got = 0;
  for (const i of items) {
    // A relic is not bag loot: its hook answers (1.7 grab: the Sealed Lamp shatters, or its seal holds).
    let used;
    for (const fn of ITEM_PICKED) { used = fn(state, i, events); if (used !== undefined) break; }
    if (used !== undefined) { if (used) got++; continue; }
    const it = i.item, stack = it.kind === 'food' || it.kind === 'sigil' ? bag.find(b => b.kind === it.kind && b.id === it.id) : null;
    if (stack) stack.count = (stack.count ?? 1) + (it.count ?? 1);
    else if (bag.length >= BAG) { events.push({ type: 'log', words: 'Your bag is full.' }, { type: 'refused', id: p.id, why: 'bag-full', sfx: 'inventory-full' }); break; }
    // G27 (1.7 noteMasterwork, gear-adapter.js:95-102): a Masterwork counts once, the first time it is taken; the stamp
    // rides on the piece, so a drop and re-pick or a swap through the bag does not count it again.
    if (it.tier === 3 && it.mwFound !== it.id) { it.mwFound = it.id; (state.masterworks ??= {})[it.id] = (state.masterworks[it.id] ?? 0) + 1; }
    if (!stack) bag.push({ ...it });
    take(state, i, events); got++;
    events.push({ type: 'pickup', what: it.kind, sfx: 'pickup-item', at: { x: t.x, y: t.y } }, { type: 'log', words: `You pick up ${itemName(it, state)}.`, gear: it });   // gear: the log names it in its quality colour (item 145)
  }
  if (got) events.push({ type: 'hero', change: 'pickup' });
  return got > 0;
}

/** Puts drops on the floor: the first on (x0, y0), the rest on open tiles within 1 of (x1, y1). */
function spill(state, drops, x0, y0, x1, y1) {
  const f = state.floor, open = (x, y) => [T.FLOOR, T.OPEN_DOOR, T.WATER].includes(tileAt(f, x, y)) &&
    !(f.props ?? []).some(p => p.x === x && p.y === y && !p.broken && propBlocks(p));
  drops.forEach((it, k) => {
    if (k === 0) { f.items.push({ x: x0, y: y0, item: it }); return; }
    const near = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (open(x1 + dx, y1 + dy)) near.push({ x: x1 + dx, y: y1 + dy });
    const c = near.length ? near[Math.floor(next(state.rng) * near.length)] : { x: x0, y: y0 };
    f.items.push({ x: c.x, y: c.y, item: it });
  });
}

/** I69: bumping a chest opens it (an action): its table's items, the first under the hero. A mimic bites back. */
export function openChest(state, x, y, events) {
  const f = state.floor, chest = f.chests?.find(c => c.x === x && c.y === y);
  if (!chest || chest.open) return false;
  if (chest.kind === 'chest-plane') { openPlaneChest(state, chest, events); return true; }   // planes.md 110-111
  const p = state.actors[state.playerId];
  if (chest.mimic) {
    f.tiles[y * f.w + x] = T.FLOOR; f.chests.splice(f.chests.indexOf(chest), 1);
    // Item 286, M66: the biome's own Mimic (mimic, mimic-crypt, mimic-caverns, mimic-underdark).
    const m = makeCreature(monsters.rows['mimic-' + f.biome] ? 'mimic-' + f.biome : 'mimic', x, y); m.hunting = true; m.t = p.t;
    state.actors[m.id] = m; state.order.push(m.id);
    events.push({ type: 'spawned', id: m.id, at: { x, y } }, { type: 'log', words: 'The chest has teeth! A mimic lunges.', sfx: 'mimic-reveal', shake: 6 });   // CB19: 1.7 systems.js:685 SHAKE 6
    return true;
  }
  // S19: the greedy vault. The first chest opens; reaching for the second drops every inner floor cell into a chasm,
  // and a hero standing on the new chasm falls (and that chest stays shut).
  if (chest.greedy) {
    const gv = f.greedy[chest.greedy];
    gv.opened += 1;
    if (gv.opened === 1) events.push({ type: 'log', words: 'The vault trembles. The other chest remains.' });
    else {
      const r = gv.room, fallen = new Set();
      for (let yy = r.y + 1; yy < r.y + r.h - 1; yy++) for (let xx = r.x + 1; xx < r.x + r.w - 1; xx++) {
        const k = yy * f.w + xx, t = f.tiles[k];
        if ((t === T.FLOOR || t === T.WATER) && !f.props.some(q => q.x === xx && q.y === yy) && !f.chests.some(q => q.x === xx && q.y === yy)) {
          f.tiles[k] = T.CHASM; f.ground[k] = 0; fallen.add(k);
        }
      }
      if (f.spots) f.spots = f.spots.filter(s => !fallen.has(s.y * f.w + s.x));
      events.push({ type: 'log', words: 'You reach for the second chest. The floor around the chest platforms collapses!', sfx: 'crate-break' }, { type: 'collapse', room: r });
      if (f.tiles[p.y * f.w + p.x] === T.CHASM && !p.statuses.levitate) {
        dealDamage(state, { target: p, source: null, amount: Math.max(1, Math.round(p.maxhp * 0.15)), type: 'phys', premitigated: true, bypassShields: true, cause: 'fall' }, events);
        events.push({ type: 'log', words: 'You fall!', sfx: 'trap-pit' });
        if (p.hp > 0) state.pendingFall = true;
        return true;
      }
    }
  }
  chest.open = true;
  f.tiles[y * f.w + x] = T.FLOOR;
  const drops = rollTable(state, chest.table ?? 'chest-' + chest.kind, state.floorNo);
  spill(state, drops, p.x, p.y, x, y);
  events.push({ type: 'chest', at: { x, y }, n: drops.length, sfx: 'chest-open' }, { type: 'log', words: drops.length === 1 ? 'The chest holds 1 thing.' : `The chest holds ${drops.length} things.` });
  // S20, S21: a bone vault's or goblin mine's chest wakes its guardians, hunting.
  if (chest.ambush?.posts) postAmbush(state, chest.ambush, events);   // rule 69: the bone gauntlet's four posts
  else if (chest.ambush) {
    let kinds = chest.ambush.kinds;
    const boneVault = chest.table === 'chest-enhanced' && chest.ambush.planeBehaviour;
    // Unopened saved Bone Vaults use the same count as newly generated vaults in their biome.
    if (boneVault) {
      const roster = rooms.rows['bone-vault'].ambush.rosterByBiome[String(Math.min(4, biomeIndex(state.floorNo) + 1))];
      const limit = roster.picks ?? Math.max(...roster.group.map(group => group.length));
      if (kinds.length > limit) {
        kinds = kinds.slice();
        while (kinds.length > limit) {
          const duplicate = kinds.findIndex((kind, i) => kinds.indexOf(kind) !== i);
          kinds.splice(duplicate >= 0 ? duplicate : Math.floor(next(state.rng) * kinds.length), 1);
        }
      }
    }
    spawnAround(state, kinds, chest.ambush.at ?? { x, y }, events, chest.ambush.planeBehaviour ? { planeEncounter: true } : {});
    events.push({ type: 'log', words: boneVault ? rooms.rows['bone-vault'].ambush.log : chest.ambush.log });
  }
  return true;
}

/** Rule 69 (1.7 releaseChestAmbush with posts): each member on the free room cell nearest its post, hunting 100 later. */
function postAmbush(state, a, events) {
  const f = state.floor, r = a.room, taken = [];
  const free = (x, y) => f.tiles[y * f.w + x] === T.FLOOR && !f.props.some(q => q.x === x && q.y === y) && !state.order.some(id => state.actors[id].hp > 0 && state.actors[id].x === x && state.actors[id].y === y) && !taken.some(c => c.x === x && c.y === y);
  a.posts.forEach((post, i) => {
    let best = null;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (free(x, y) && (!best || Math.max(Math.abs(x - post.x), Math.abs(y - post.y)) < Math.max(Math.abs(best.x - post.x), Math.abs(best.y - post.y)))) best = { x, y };
    if (best) { taken.push(best); spawnAround(state, [a.kinds[i]], best, events); }
  });
  events.push({ type: 'log', words: a.log });
}

/** Hunting bodies on free tiles around a spot (nearest first, never the hero's tile), acting 100 after the hero. */
export function spawnAround(state, kinds, at, events, extra = {}) {
  const f = state.floor, p = state.actors[state.playerId], cells = [];
  for (let r = 0; r <= 4 && cells.length < kinds.length; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const c = { x: at.x + dx, y: at.y + dy };
    if (f.tiles[c.y * f.w + c.x] !== T.FLOOR || f.props.some(q => q.x === c.x && q.y === c.y && q.id !== 'kobold-pickaxe') || state.order.some(id => state.actors[id].hp > 0 && state.actors[id].x === c.x && state.actors[id].y === c.y) || cells.some(o => o.x === c.x && o.y === c.y)) continue;
    cells.push(c);
  }
  kinds.forEach((k, i) => {
    const c = cells[i]; if (!c) return;
    const m = makeCreature(k, c.x, c.y);
    Object.assign(m, { hunting: true, asleep: false, t: p.t + 100, lastSeen: { x: p.x, y: p.y, at: state.now }, ...extra });
    state.actors[m.id] = m; state.order.push(m.id);
    events.push({ type: 'spawned', id: m.id, at: c });
  });
}

/**
 * EQ30 (1.7 gear.js:206): kill loot lands on the body's tile when nothing lies there, else on a free tile beside it
 * (1.7 nearFree, a random one), else on the body after all.
 */
function lootSpot(state, a) {
  const f = state.floor, bare = (x, y) => !f.items.some(i => i.x === x && i.y === y);
  if (bare(a.x, a.y) && walkable(f, a.x, a.y)) return { x: a.x, y: a.y };
  const near = nearFree(state, a, 1).filter(c => bare(c.x, c.y));
  return near.length ? near[Math.floor(next(state.rng) * near.length)] : { x: a.x, y: a.y };
}

/** I67, I73: a kill on the hero's side may drop loot from the creature's table, and a heart and a mana globe. */
export function killDrops(state, a, events) {
  if (a.noXp || a.summoned || a.kind === 'shade') return;
  // I67: elementalings drop their own element's mote instead of a table pick.
  if (a.drops && typeof a.drops === 'object' && a.drops.mote) {
    if (a.element) { state.floor.items.push({ x: a.x, y: a.y, item: { kind: 'mote', el: a.element } }); events.push({ type: 'drops', at: { x: a.x, y: a.y } }); }
  }
  const t = typeof a.drops === 'string' && L[a.drops];
  // I67: the Luck ring raises the chance (+25% a power; two rings add).
  let luck = 0;
  for (const s of ['ring1', 'ring2']) { const it = state.hero?.worn?.[s]; if (it?.id === 'luck') luck += value(rings.rows.luck.values.lootMult, it, state.hero) / 100; }
  if (t && next(state.rng) < Math.min(0.95, (t.chancePct / 100) * (a.elite ? 2 : 1) * (1 + luck))) {
    const drops = rollTable(state, a.drops, state.floorNo);
    for (const it of drops) { const at = lootSpot(state, a); state.floor.items.push({ x: at.x, y: at.y, item: it }); }
    if (drops.length) events.push({ type: 'drops', at: { x: a.x, y: a.y } }, { type: 'log', words: `${capFirst(theName(a.name))} drops ${drops.some(d => d.kind === 'food') ? 'food' : 'something'}.` });   // CD27 (1.7 gear.js:210)
  }
  const life = state.now + REWARDS.globeLifeTurns * TURN;
  if (next(state.rng) < REWARDS.heartGlobePct / 100) state.floor.items.push({ x: a.x, y: a.y, item: { kind: 'heart' }, until: life });
  if (next(state.rng) < REWARDS.manaGlobePct / 100) state.floor.items.push({ x: a.x, y: a.y, item: { kind: 'globe' }, until: life });
  events.push({ type: 'drops', at: { x: a.x, y: a.y } });
}

/** A8 (moved to game turns, ruled 2026-10-15): hearts and globes vanish 40 game turns after they dropped. */
registerPhase('item-expiry', (state, ctx, events) => {
  if (!state.floor.items) return;
  const before = state.floor.items.length;
  state.floor.items = state.floor.items.filter(i => i.until === undefined || i.until > state.now);
  if (state.floor.items.length !== before) events.push({ type: 'expired' });
});
