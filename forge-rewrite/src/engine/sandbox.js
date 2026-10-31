// Sandbox mode: dev commands for looking at the draft (Justin 2026-10-16: "i will need to jump in in sandbox mode
// and investigate"). 1.7's Sandbox tab and Map mode, as one command family: {type:'sandbox', action, ...}.
// Only a run started as a sandbox (state.sandbox, set by createGame's sandbox option) takes them; a normal run refuses them.
// A sandbox run is kept apart from normal play: main.js saves it to its own slot and never offers it as Continue,
// and anything that records progress (the journal, run history: packet H) skips a sandbox state.
// The World and Rooms pages' actions and the catalog are in sandbox-world.js.
//
// game.js wires two hooks (the coordinator's):
//   resolveHeroCommand(): if (c.type === 'sandbox') return sandboxCommand(state, c, events, { ...FLOORS, applyHero }) (engine/floors.js).
//   applyHero(), last line: sandboxBody(state);   (god mode outlives a gear change)

import monsters from '../../data/monsters.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import loot from '../../data/loot.json' with { type: 'json' };
import bosses from '../../data/bosses.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import piety from '../../data/piety.json' with { type: 'json' };
import { refreshSight } from '../rules/sight.js';
import { spawnAround, enterTile } from '../rules/pickup.js';
import { makeItem } from '../rules/items.js';
import { ELEMENTS, randomGear } from '../rules/loot.js';
import { floorRosterKind } from '../rules/spawns.js';
import { kill } from '../rules/death.js';
import { scaleBody } from '../rules/damage.js';
import { gainLevel } from '../rules/progression.js';
import { compilePassives } from '../rules/passives.js';
import { fuseRefusals, infuse, loseAffinity } from '../rules/magic.js';
import { pledge, award, devotion, pietyDepth } from '../rules/faith.js';
import { godRefuses, refusalText } from '../rules/god-refusal.js';
import { T, tileAt, walkable } from '../data/tiles.js'; import { bossFields, phylacteryFields } from '../world/boss.js';
import { BIOMES, say, toFloor, toPlane, toRoom, stairsOf, reveal, walkthrough } from './sandbox-world.js';

export { sandboxCatalog, BIOMES } from './sandbox-world.js';
const ATTRS = progression.rows.attributes.ids;
const BAG_MAX = loot.rows.bag.slots;
const GOD_MOD = { verb: 'damage-mod', direction: 'taken', mult: 0, sandbox: true };

/**
 * The actions that put the hero on another floor or plane. The Sandbox window closes before sending one: an open
 * window is rebuilt whole by the refresh after the command, while the new floor's art is still held (main.js
 * holdFloor), and that rebuild threw (proof pass 13: "Cannot set properties of null (setting 'x')", Escape dead).
 */
export const TRAVEL = new Set(['floor', 'reroll', 'plane', 'room', 'biome', 'next']);

/** God mode: no damage reaches the hero. Re-applied after applyHero rebuilds the body's passives. */
export function sandboxBody(state, fill = false) {
  const p = state.actors?.[state.playerId];
  if (!p?.fx) return;
  p.fx.taken = (p.fx.taken ?? []).filter(m => !m.sandbox);
  // H33: Map mode (1.7 mapview.js) is also safe: "you cannot be hurt".
  if (state.sandbox?.god || state.sandbox?.mapMode) p.fx.taken.push({ ...GOD_MOD });
  // CH-39: the hero's HP and mana at the run's number scale (1.7 stats.js hp(): maxhp and maxmp x numberScale).
  const n = state.sandbox?.scale?.numbers ?? 1;
  if (n !== 1) {
    p.maxhp = Math.max(1, Math.round(p.maxhp * n)); p.maxmana = Math.max(0, Math.round(p.maxmana * n));
    if (fill) { p.hp = p.maxhp; p.mana = p.maxmana; }
  }
}

/** CH-39: 1.7's Sandbox Number scale (Small, Medium, Large) and Lethality (Gentle, Standard, Deadly) picks. */
export const SCALES = { numbers: [['Small', 0.6], ['Medium', 1], ['Large', 1.8]], lethality: [['Gentle', 0.7], ['Standard', 1], ['Deadly', 1.45]] };

/**
 * CH-39: sets a sandbox run's number scale and lethality. Every body now on the floor takes the new scale with its
 * wounds in proportion; creatures met later take it on arrival or at their first hit (damage.js).
 */
export function setSandboxScale(state, { numbers, lethality } = {}, api = {}) {
  const sb = state.sandbox;
  if (!sb) return;
  const was = sb.scale ?? { numbers: 1, lethality: 1 };
  const next = { numbers: numbers ?? was.numbers, lethality: lethality ?? was.lethality };
  const p = state.actors[state.playerId], hpPart = p.maxhp > 0 ? p.hp / p.maxhp : 1, manaPart = p.maxmana > 0 ? p.mana / p.maxmana : 1;
  sb.scale = next;
  for (const id of state.order) if (id !== state.playerId && state.actors[id]) scaleBody(state.actors[id], next.numbers);
  if (api.applyHero) api.applyHero(state); else { p.fx = compilePassives(state.hero); sandboxBody(state); }
  p.hp = Math.max(1, Math.min(p.maxhp, Math.round(p.maxhp * hpPart))); p.mana = Math.min(p.maxmana, Math.round(p.maxmana * manaPart));
}

/** A spawned thing for the bag, or null: gear by id (tier 1-3, plus), food, a sigil. */
function itemFor(c) {
  if (c.kind === 'sigil') return sigils.rows[c.id]?.name ? { kind: 'sigil', id: c.id, count: c.count ?? 1 } : null;
  try {
    const it = makeItem(c.id, c.tier ?? 1, c.plus ?? 0);
    if (it.kind === 'food') return { ...it, count: c.count ?? 1 };
    it.known = true;
    if (c.enchant && ELEMENTS.includes(c.enchant)) it.enchant = c.enchant;
    return it;
  } catch { return null; }
}

/** The bag takes it when there is room; otherwise it lies at the hero's feet. */
function give(state, it, events) {
  const h = state.hero, p = state.actors[state.playerId];
  const stack = (it.kind === 'food' || it.kind === 'sigil') && h.bag.find(b => b.kind === it.kind && b.id === it.id);
  if (stack) stack.count = (stack.count ?? 1) + (it.count ?? 1);
  else if (h.bag.length < BAG_MAX) h.bag.push(it);
  else { state.floor.items.push({ x: p.x, y: p.y, item: it }); events.push({ type: 'drops', at: { x: p.x, y: p.y } }); say(events, 'the bag is full; it lies at your feet.'); return; }
  events.push({ type: 'hero', change: 'sandbox' });
}

/** Bosses that live only in their own arena: their rules read the arena's state, so a spawn elsewhere is refused. */
const ARENA_ONLY = {
  'deep-maw': { ready: () => false, words: 'the Deep Maw rises only in its arena. Jump to floor 15 and walk in.' },
  unmaker: { ready: () => false, words: 'the Unmaker wakes only at the Crucible gate. Jump to floor 25 and walk through the gate.' },
};

/**
 * A spawned set piece gets what its own floor gives it (world/boss.js, crypt/hall.js, underdark/hall.js): its `set`,
 * awake and hunting off the throne (a sandbox floor has no boss room to wake it), the wake event (music, roar, the
 * boss bar), and Morty his phylactery. Plane guardians use their moves on a plane; elsewhere they fight as hunters.
 */
function setUpBoss(state, a, events) {
  const set = monsters.rows[a.kind]?.set, B = bosses.rows[set];
  if (!set) return;
  const p = state.actors[state.playerId];
  Object.assign(a, bossFields(set, { throne: false, hunting: true, rot: 0, phase: 0, lastSeen: { x: p.x, y: p.y, at: state.now } }));
  if (set === 'morty' && a.kind === 'morty') {
    a.turnN = 0;
    const before = state.order.length;
    spawnAround(state, ['phylactery'], { x: a.x, y: a.y }, events);
    const ph = state.actors[state.order[before]];
    if (ph) { Object.assign(ph, phylacteryFields(a)); a.phylactery = ph.id; }
  } else if (a.kind === 'phylactery') Object.assign(a, { set: 'phylactery', still: true, object: true, hunting: false });
  if (B && B.monsters?.[0] === a.kind) {
    events.push({ type: 'log', words: `${a.name} awakens!` });
    events.push({ type: 'boss', id: a.id, name: a.name, state: 'awake', music: B.music, sfx: B.wake?.sfx, shake: B.wake?.shake });
  }
  if (bosses.rows[set]?.music?.startsWith('plane-') && !state.floor.plane) say(events, `${a.name} uses its moves on a plane; here it fights as a hunter.`);
}

/**
 * {type:'sandbox', action, ...}. Every action is free (no game time passes) and logs what it did.
 * @param {any} state @param {any} c @param {any[]} events @param {{arriveFloor:Function, leaveFloor:Function, takeStored:Function, followers:Function, applyHero?:Function}} api
 * @returns {'free'|'refused'}
 */
export function sandboxCommand(state, c, events, api) {
  const refuse = why => { events.push({ type: 'refused', id: state.playerId, why, command: 'sandbox' }); return 'refused'; };
  if (!state.sandbox) return refuse('not-sandbox');
  // A sandbox refusal always says so in the log (a tap that does nothing reads as broken); the reason is the code's.
  const refuseSaid = why => { if (!events.some(e => e.type === 'log' && e.words?.startsWith('Sandbox: '))) say(events, `that did not work here (${why}).`); return refuse(why); };
  const h = state.hero, p = state.actors[state.playerId], f = state.floor, sb = state.sandbox, shown = !!f.unrevealed;
  const reapply = () => { if (api.applyHero) api.applyHero(state); else { p.fx = compilePassives(h); sandboxBody(state); } events.push({ type: 'hero', change: 'sandbox' }); };
  let why = null;
  switch (c.action) {
    case 'floor': why = toFloor(state, c.floor, events, api); break;
    case 'reroll': why = f.plane ? 'on-plane' : toFloor(state, state.floorNo, events, api); break;
    // One tap per biome (its first floor) and the next floor down (sandbox item 102).
    case 'biome': { const i = BIOMES.indexOf(c.biome); why = i < 0 ? 'bad-biome' : toFloor(state, i * 5 + 1, events, api); break; }
    case 'next': why = state.floorNo >= 25 ? (say(events, 'floor 25 is the last floor.'), 'last-floor') : toFloor(state, state.floorNo + 1, events, api); break;
    case 'plane': why = toPlane(state, c.plane, events, api); break;
    case 'room': why = toRoom(state, c, events, api); break;
    case 'encounters': sb.encounters = !!c.on; say(events, `Chaos encounters ${sb.encounters ? 'on' : 'off'} (from the next Realm floor).`); break;
    case 'walkthrough': why = walkthrough(state, !!c.on, events); break;
    case 'god':
      sb.god = c.on ?? !sb.god;
      sandboxBody(state);
      if (sb.god) { p.hp = p.maxhp; p.mana = p.maxmana; }
      say(events, `god mode ${sb.god ? 'on: nothing hurts you' : 'off'}.`);
      events.push({ type: 'hero', change: 'sandbox' });
      break;
    case 'heal':
      p.hp = p.maxhp; p.mana = p.maxmana; p.guard = p.maxguard ?? 0; p.iceArmor = p.maxIceArmor ?? 0;
      h.hunger = progression.rows['start-of-run'].hunger;
      for (const id of Object.keys(p.statuses)) if (!p.statuses[id]?.perm) delete p.statuses[id];
      say(events, 'healed, fed and cleansed.'); events.push({ type: 'hero', change: 'sandbox' });
      break;
    case 'level': {   // item 180: one level at a time through the rules' own level-up, up to `to` (play never lowers one)
      const n = c.to ? c.to - h.level : Math.max(1, Math.min(30, c.n ?? 1)), from = h.level;
      for (let i = 0; i < n; i++) gainLevel(state, events);
      reapply();
      say(events, h.level === from ? 'already at the level cap.' : `level ${h.level}.`);
      break;
    }
    case 'points': h.points = Math.max(0, h.points + (c.n ?? 1)); say(events, `${h.points} stat points to spend.`); events.push({ type: 'hero', change: 'sandbox' }); break;
    case 'stat':
      if (!ATTRS.includes(c.attr) || !Number.isFinite(c.value)) { why = 'bad-stat'; break; }
      h.attr[c.attr] = Math.max(1, Math.min(99, Math.round(c.value)));
      reapply();
      say(events, `${c.attr} ${h.attr[c.attr]}.`);
      break;
    case 'affinity': {
      // Item 180: the Forge's own infusion and spells (magic.js), less the mote, Forge and cap; -1 takes them back.
      if (!ELEMENTS.includes(c.element)) { why = 'bad-element'; break; }
      if ((c.n ?? 1) < 0) { loseAffinity(state, c.element, events); reapply(); break; }
      const no = fuseRefusals(state, c.element).filter(r => r !== 'no-mote'), held = no.filter(r => !['at-cap', 'forbidden'].includes(r));
      if (held.length) { why = held[0]; break; }
      if (no.length) say(events, `in play this would be refused (${no.join(', ')}).`);
      infuse(state, c.element, events);
      reapply();
      break;
    }
    case 'pledge':   // item 180: the shrine's own vows (faith.js pledge) to any god; what play would refuse is said
      if (!gods.rows[c.god]?.boons) { why = 'bad-god'; break; }
      if (h.faith?.god === c.god) { say(events, `already sworn to ${gods.rows[c.god].name}.`); break; }
      if (godRefuses(c.god, h)) say(events, `in play: ${refusalText(c.god, h)}`);
      pledge(state, c.god, events);
      reapply();
      break;
    case 'rank': {   // item 180: rank 1-5 with the piety to match, through the rules' own award, so boons and prayers come as in play
      const to = Math.max(1, Math.min(piety.rows.ranks.maxRank, c.to ?? 1));
      if (!h.faith?.god) { say(events, 'choose a patron god first.'); why = 'no-god'; break; }
      if (to < h.faith.rank) pledge(state, h.faith.god, events);   // down: fresh vows at rank 1 (play never lowers a rank), then up
      const need = piety.rows.ranks.thresholds[to - 1] - h.faith.piety;
      if (need > 0) award(state, (need + 0.01) / (devotion(h) * pietyDepth(state)), events, { pietyOnly: true });
      reapply();
      break;
    }
    case 'essence': h.essence = Math.max(0, h.essence + (c.n ?? 100)); say(events, `${h.essence} essence.`); events.push({ type: 'hero', change: 'sandbox' }); break;
    case 'motes':
      for (const el of c.element ? [c.element] : ELEMENTS) if (ELEMENTS.includes(el)) h.motes[el] = (h.motes[el] ?? 0) + (c.n ?? 1);
      say(events, c.element ? `a ${c.element} mote.` : 'one mote of every element.'); events.push({ type: 'hero', change: 'sandbox' });
      break;
    case 'scale': {
      const ok = (k, v) => v === undefined || SCALES[k].some(([, x]) => x === v);
      if (!ok('numbers', c.numbers) || !ok('lethality', c.lethality)) { why = 'bad-scale'; break; }
      setSandboxScale(state, c, api);
      const name = (k, v) => SCALES[k].find(([, x]) => x === v)[0];
      say(events, `numbers ${name('numbers', sb.scale.numbers)}, lethality ${name('lethality', sb.scale.lethality)}.`);
      events.push({ type: 'hero', change: 'sandbox' });
      break;
    }
    case 'key': h.keys = (h.keys ?? 0) + 1; say(events, 'an iron key.'); events.push({ type: 'hero', change: 'sandbox' }); break;
    case 'item-random':   // item 166 (1.7 boot.js bGive, Item to bag): a piece of gear as this floor drops it
    case 'item': {
      const it = c.action === 'item' ? itemFor(c) : randomGear(state, state.floorNo);
      if (!it) { why = 'bad-item'; break; }
      give(state, it, events);
      say(events, `${it.kind === 'sigil' ? sigils.rows[it.id].name : it.id}${it.tier > 1 ? ` (tier ${it.tier})` : ''}${it.plus ? ` +${it.plus}` : ''}.`);
      break;
    }
    case 'spawn-random':   // item 166 (1.7 boot.js bSpawn, Spawn nearby): one of this floor's own creatures, hunting
    case 'spawn': {
      const kind = c.action === 'spawn' ? c.kind : floorRosterKind(state);
      if (!kind && c.action !== 'spawn') { say(events, 'this floor has no creatures of its own.'); why = 'no-roster'; break; }
      if (!monsters.rows[kind]?.hp) { why = 'bad-creature'; break; }
      const only = ARENA_ONLY[Object.keys(ARENA_ONLY).find(set => bosses.rows[set].monsters.includes(kind))];
      if (only && !only.ready(state)) { say(events, only.words); why = 'boss-floor-only'; break; }
      const before = state.order.length;
      spawnAround(state, Array(Math.max(1, Math.min(8, c.n ?? 1))).fill(kind), { x: p.x, y: p.y }, events);
      const made = state.order.length - before;
      if (!made) { why = 'no-room'; break; }
      if (c.asleep) for (const id of state.order.slice(before)) Object.assign(state.actors[id], { asleep: true, hunting: false });
      else for (const id of state.order.slice(before)) setUpBoss(state, state.actors[id], events);
      say(events, `${made} ${monsters.rows[kind].name}${made > 1 ? 's' : ''}.`);
      break;
    }
    case 'kill-all': {
      let n = 0;
      for (const id of state.order.slice()) { const a = state.actors[id]; if (a && a.side === 'foe' && a.hp > 0) { kill(state, a, null, events, ['sandbox']); n++; } }
      say(events, `${n} creature${n === 1 ? '' : 's'} removed.`);
      break;
    }
    case 'sleep-all': {
      let n = 0;
      for (const id of state.order) { const a = state.actors[id]; if (a.side === 'foe' && a.hp > 0) { a.asleep = true; a.hunting = false; n++; } }
      say(events, `${n} creature${n === 1 ? '' : 's'} put to sleep.`);
      break;
    }
    case 'reveal':   // item 166 (1.7 bReveal): on until turned off, then the floor as the hero had seen it
      reveal(state, c.on ?? !shown, events);
      say(events, f.unrevealed ? 'the whole floor is revealed.' : 'the fog is back.');
      break;
    case 'map-mode':
      // H33 (1.7 mapview.js mapviewSetOn): creatures stand still, the hero cannot be hurt, the fog is off, and a click
      // on a tile moves the hero straight there (ui/hud/map-hover.js mapClick).
      sb.mapMode = !!c.on;
      reapply();
      if (sb.mapMode) reveal(state, true, events);   // and Reveal with it, which stays on after (1.7 mapviewSetOn)
      say(events, sb.mapMode ? 'Map mode. Creatures stand still, you cannot be hurt, the fog is off. Click a tile to go there.' : 'Map mode off.');
      break;
    case 'teleport': {
      // H33 (1.7 handleMapClick in map mode): a picked tile that is not free takes the nearest free one within 2.
      const free = (x, y) => walkable(f, x, y) && !state.order.some(id => id !== p.id && state.actors[id].hp > 0 && state.actors[id].x === x && state.actors[id].y === y);
      const nearFree = (x, y) => { for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(x + dx, y + dy)) return { x: x + dx, y: y + dy }; return null; };
      const to = c.to === 'stairs' ? stairsOf(f) : c.to === 'arrival' ? f.arrival : c.near ? nearFree(c.x, c.y) : { x: c.x, y: c.y };
      const t = to && tileAt(f, to.x, to.y);
      if (!to || t === undefined || t === T.WALL || state.order.some(id => id !== p.id && state.actors[id].hp > 0 && state.actors[id].x === to.x && state.actors[id].y === to.y)) { why = 'no-tile'; break; }
      const from = { x: p.x, y: p.y };
      p.x = to.x; p.y = to.y;
      events.push({ type: 'teleported', id: p.id, from, to: { x: to.x, y: to.y } });
      refreshSight(state, events);
      enterTile(state, events);   // item 96: arriving takes what lies there, as a step does
      break;
    }
    default: why = 'bad-action';
  }
  // H33: in Map mode, or with Reveal on, a jump comes in with its fog off too (1.7 mapviewGo, a global revealAll).
  if (!why && (sb.mapMode || shown) && TRAVEL.has(c.action)) reveal(state, true, events);
  return why ? refuseSaid(why) : 'free';
}
