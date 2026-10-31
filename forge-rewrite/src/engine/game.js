// Game state and the one entry point that changes it. Headless: no DOM, no wall clock, no Math.random.

import { sandboxBody, sandboxCommand } from './sandbox.js';
import { leaveFloor, takeStored, arriveFloor, followers } from './floors.js';
import { realmTravel } from './realm.js';
// C17: the modules that provide the rules' up-calls (set-pieces.js UP) load with the engine.
import '../rules/effects.js';
import '../rules/death.js';
import '../rules/ai-moves.js';
import '../rules/passives.js';
import '../rules/faith.js';
import '../rules/props.js';
import '../rules/spell-ground.js';
import { compilePassives } from '../rules/passives.js';
import { bodyIds } from '../rules/monsters.js';
import classes from '../../data/classes.json' with { type: 'json' };
import { amount } from '../rules/amount.js';
import { stream, nextFloorSeed, next } from '../lib/rng.js';
import { playerAction } from './scheduler.js';
import { isWall } from '../rules/moves.js';
import { hook } from '../rules/set-pieces.js';
import { createHero, castLook } from '../rules/hero.js';
import { heroStats, damageRows } from '../rules/derive.js';
import { generateFloor, reachFrom } from '../world/generate.js';
import { makeRunPlan, settleShrine } from '../world/runplan.js';
import '../rules/boss.js';
import '../rules/crypt.js';   // the Crypt's creatures and corpses (biome 2)
import '../rules/morty.js';   // Morty and his phylactery (floor 10)
import '../rules/caverns.js';   // the Caverns' creatures, spores and eels (biome 3)
import '../rules/merchant.js';   // its merchant (S24)
import '../rules/maw.js';   // the Deep Maw (floor 15)
import '../rules/prison.js';   // the prison's cage, escapee and rescue patrol (world.md S8-S9)
import '../rules/crypt-rare.js';   // the hungry spider (world.md rule 72)
import '../rules/caverns-rare.js';   // the Sealed Lamp (world.md rule 73)
import { descentAward, actionAwards } from '../rules/faith.js';
import { testFloor, testCreatures } from '../world/test-room.js';
import { T, tileAt } from '../data/tiles.js';
import { registerPhase } from '../rules/phases.js';
import { refreshSight } from '../rules/sight.js';
import { recordDoorMaterials } from '../rules/doors.js';
import { stillnessStep } from '../rules/gear-use.js';
import { scaleBody } from '../rules/damage.js';
import { noteFloor } from '../rules/run-record.js';
import { resolveMove, fearAction, FEAR_REPLACES, TOMB_WAITS } from './bump.js';
import { resolveHeroCommand } from './commands.js';

// B1: sight is refreshed after the hero moves (spec/sight.md V10).
registerPhase('refresh-sight', (state, ctx, events) => { if (ctx.kind === 'move') refreshSight(state, events); });

export const DEFAULT_CHOICE = { name: 'Guide', sex: 'm', race: 'dwarf', court: null, cls: 'fighter', god: null };

/** Copies the hero's derived numbers onto the player's body (after creation, a level, a point, gear). */
export function applyHero(state, { fill = false } = {}) {
  // E2: the body's statuses count (Iron Body, Temper, Living Mountain, Haste...); statuses.js calls back here as they change.
  const p = state.actors[state.playerId], s = heroStats(state.hero, p), fx = compilePassives(state.hero, { divine: s.divine });
  // The class's Guard pool (classes.json: a shield effect on the guard pool), sized from the new max HP.
  const guard = (classes.rows[state.hero.cls]?.passive ?? []).find(e => e.verb === 'shield' && e.pool === 'guard');
  const guardMax = guard ? amount(guard.cap, { state, owner: { ...p, maxhp: s.maxhp } }) : 0;
  Object.assign(p, {
    maxhp: s.maxhp, maxmana: s.maxmana, acc: s.acc, eva: s.eva, armour: s.armour, dmg: s.dmg, crit: s.crit,
    critMult: s.critMult, block: s.block, parry: s.parry, luck: s.luck, defence: s.defence, moveMult: s.moveMult, speed: s.speed, attr: { ...state.hero.attr }, maxguard: guardMax,
    spellPower: s.spellPower, divine: s.divine, faithRank: state.hero.faith?.rank ?? 0, affinity: { ...state.hero.affinity }, bow: s.bow,
    fx, immune: fx.immune, maxIceArmor: fx.iceArmorMax, resist: s.resist, derived: { damageRows: damageRows(state.hero), stealthRaw: s.stealthRaw },   // C7: read per blow and per hearing check
    look: { sheet: 'cast-' + castLook(state.hero) },   // RC3: a Tourist's vacation outfit, a follower of Chad's underwear
  });
  if (fill) { p.hp = s.maxhp; p.mana = s.maxmana; p.guard = guardMax; p.iceArmor = fx.iceArmorMax; }
  p.iceArmor = Math.min(p.iceArmor ?? 0, fx.iceArmorMax);
  if (typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) sandboxBody(state, fill);   // a sandbox run's god mode and number scale survive gear changes
  p.hp = Math.min(p.hp, p.maxhp); p.mana = Math.min(p.mana, p.maxmana); p.guard = Math.min(p.guard ?? 0, guardMax);
}
hook('heroChanged', state => { if (state.hero && state.actors?.[state.playerId]) applyHero(state); });

/** Puts a floor (new or stored) in the state, the hero at (x, y). Creatures' clocks start at the hero's (W12). */
function enterFloor(state, floorNo, built, at) {
  const p = state.actors[state.playerId];
  state.floorNo = floorNo;
  state.floor = built.floor;
  recordDoorMaterials(state.floor);   // C4: an opened door keeps its material (RC7)
  noteFloor(state);   // the deepest floor, for the end screen and the score
  state.actors = { [state.playerId]: p };
  state.order = [state.playerId];
  for (const c of built.creatures) { c.t = p.t; state.actors[c.id] = c; state.order.push(c.id); }
  // Creatures that fell through a pit wait here (effects fall, carry).
  for (const c of state.fallen?.[floorNo] ?? []) { const to = landing(state, built.floor, state.order.map(id => state.actors[id])); c.x = to.x; c.y = to.y; c.t = p.t; state.actors[c.id] = c; state.order.push(c.id); }
  if (state.fallen) delete state.fallen[floorNo];
  state.seen = built.seen ?? null;
  p.x = at.x; p.y = at.y;
  // CH-39: a sandbox run's creatures arrive at its number scale.
  if ((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) && state.sandbox?.scale) for (const id of state.order) if (id !== state.playerId) scaleBody(state.actors[id], state.sandbox.scale.numbers);
  refreshSight(state, null);
}

/** C3: the one way between floors (floors.js), for travel, the Realm, the planes and the sandbox, entering through enterFloor. */
export const FLOORS = { leaveFloor, takeStored, followers, arriveFloor: (state, n, built, at, o = {}) => arriveFloor(state, n, built, at, { ...o, enter: enterFloor }) };

/** C13: the one floor builder for a new floor: the engine tests' fixed room, else the run's generated floor n. */
export const buildFloor = (state, n, { testRoom = false } = {}) => ((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) && testRoom ? { floor: testFloor(), creatures: testCreatures(), start: { x: 4, y: 7 } } : generateFloor(state.floorSeed, n, state.run, { masterworks: state.masterworks ?? {} }));   // I65: the floor's gear rerolls against the hero's Masterworks

/** @param {{seed:number, hero?:object, testRoom?:boolean}} options (testRoom: the fixed room the engine tests use) */
export function createGame({ seed, hero = DEFAULT_CHOICE, testRoom = false, sandbox = false }) {
  if ((typeof __FORGE_PUBLIC__ !== 'undefined' && __FORGE_PUBLIC__)) { testRoom = false; sandbox = false; }
  const player = { id: 'player', kind: 'hero', name: 'You', side: 'player', x: 0, y: 0, t: 0, statuses: {}, hunting: true, caughtOff: -1, hp: 1, mana: 0, sfx: 'player' };
  const state = {
    version: 5, seed, rng: stream(seed), floorSeed: nextFloorSeed(seed), floorNo: 1, where: 'dungeon',
    now: 0, pulseAt: 0, actions: 0, actors: { player }, order: ['player'], playerId: 'player', over: false, unbuilt: {},
    stored: {}, hero: createHero(hero), floor: null,
  };
  state.run = makeRunPlan(seed, state.hero);
  applyHero(state, { fill: true });
  if (!testRoom && !sandbox) settleShrine(state.run, 1, state.hero);   // WC7: a shrine on floor 1 is fixed now
  bodyIds(state, () => { const built = buildFloor(state, 1, { testRoom }); enterFloor(state, 1, built, built.start); });   // C2: ids from the game's counter
  if (sandbox) state.sandbox = { god: false, encounters: true };   // a sandbox run (src/engine/sandbox.js): its own saves, no scores
  return state;
}

/** A random walkable, empty tile in one of a floor's rooms: where a fall lands. */
function landing(state, floor, bodies) {
  // W49: a random reachable free tile of an ordinary room (never inside a locked vault or another pocket).
  const cells = [], reach = floor.arrival ? reachFrom(floor, floor.arrival) : null;
  for (const r of (floor.rooms ?? []).filter(q => !q.pocket && !q.rareEvent)) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (reach && reach[y * floor.w + x] < 0) continue;
    if (!isWall(floor, x, y) && !bodies.some(b => b.x === x && b.y === y)) cells.push({ x, y });
  }
  return cells.length ? cells[Math.floor(next(state.rng) * cells.length)] : floor.arrival;
}

/** W46-W47: stairs down to the next floor (new, or as it was left), stairs up to the stored floor above.
 *  A fall (a pit, traps 87) goes down without stairs and lands on a random room tile. */
export function travel(state, dir, events, { fall = false } = {}) {
  // The Realm of Chaos and the planes (src/engine/realm.js): floor 20's open exit, floors 21-25, plane stairs. null when not its case.
  const r = realmTravel(state, dir, events, FLOORS);
  if (r) return r;
  const p = state.actors[state.playerId], here = tileAt(state.floor, p.x, p.y);
  // G38 (1.7 ui.js:838, transition-adapter.js:48): the refusals say why.
  if (dir > 0 && here !== T.STAIRS && !fall && !(here === T.EXIT && state.floor.exitOpen)) { events.push({ type: 'log', words: 'No stairs here.', cls: 'c-info' }); return 'refused'; }
  if (dir < 0 && here !== T.STAIRS_UP) { events.push({ type: 'log', words: 'No stairs up here.', cls: 'c-info' }); return 'refused'; }
  const leaving = state.floorNo, target = leaving + dir;
  const pets = leaveFloor(state, leaving);
  let built = takeStored(state, target), at;   // a kept floor did not tick
  const back = !!built;
  if (built) at = dir > 0 ? built.floor.arrival : built.floor.stairs;
  else if (dir > 0) {
    state.floorSeed = nextFloorSeed(state.floorSeed);
    if (!state.sandbox) settleShrine(state.run, target, state.hero);   // WC7, F16: the shrine's god as the hero is now
    built = buildFloor(state, target);
    if (!built) { delete state.stored[leaving]; events.push({ type: 'log', words: `The next floor could not be prepared. You remain on floor ${leaving}. Try the stairs again.` }); return 'refused'; }
    at = built.start;
  } else { delete state.stored[leaving]; events.push({ type: 'log', words: 'The way up has collapsed.' }); return 'refused'; }
  if (fall) at = landing(state, built.floor, built.creatures);
  FLOORS.arriveFloor(state, target, built, at, { pets });
  // G38 (1.7 transition-adapter.js:36-55): the stairs sound (not on a fall); a floor as it was left says so in kill gold,
  // and going back up to the Forge's floor reminds the hero it burns there. A new floor opens with its intro (log-text.js).
  events.push({ type: 'floor', floorNo: target, back, fall, ...(fall ? {} : { sfx: 'stairs' }) });
  if (back) {
    events.push({ type: 'log', words: `You climb back ${dir > 0 ? 'down' : 'up'} to <b>floor ${target}</b>. It is as you left it.`, kill: true });
    if (dir < 0 && state.floor.forge) events.push({ type: 'log', words: 'The Elemental Forge still burns on this floor.', cls: 'c-info' });
  }
  if (!back && dir > 0) descentAward(state, events);   // F7
  return 'free';
}

/**
 * Applies one player command and the world's reply. Returns the events, in order.
 * @param {any} state
 * @param {{type:string, dx?:number, dy?:number, attr?:string, bag?:number, slot?:string}} command
 */
export function step(state, command) { return bodyIds(state, () => stepIn(state, command)); }   // C2: every body made in a step takes its id from state.nextBodyId
function stepIn(state, command) {
  const events = [];
  if (state.over) return events;
  const p = state.actors[state.playerId];
  // D51: the core's free infusion lasts until the hero does anything else.
  if (state.coreInfusion && !['fuse', 'end-infusion'].includes(command.type)) state.coreInfusion = false;
  const at0 = { x: p.x, y: p.y };
  // 1.7 elements.js:404-413 advanceTomb: in his own Glacial Tomb the hero only waits; a step, cast or shot passes the turn
  // (each one shown, so the ice block stays on him until it ends).
  if (p.statuses?.tomb && TOMB_WAITS.has(command.type)) command = { type: 'wait' };
  playerAction(state, ev => {
    const from = ev.length;
    // G20: an ability or sigil says it is refused (magic.md D1, D47: nothing spent), then the fear takes the turn.
    const later = command.type === 'use' && (command.ability || (command.bag != null ? state.hero?.bag?.[command.bag] : state.hero?.bag?.find(b => b.id === command.item))?.kind === 'sigil');
    const feared = FEAR_REPLACES.has(command.type) && !later ? fearAction(state, p, ev) : null;
    let res = feared ? feared : command.type === 'move' ? resolveMove(state, p, command.dx ?? 0, command.dy ?? 0, ev)
      : command.type === 'wait' ? 'act' : command.type === 'sandbox' ? ((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) ? sandboxCommand(state, command, ev, { ...FLOORS, applyHero }) : 'refused')
      : resolveHeroCommand(state, command, ev, { applyHero, travel, FLOORS }) ?? 'refused';
    let kind = res?.kind ?? res;
    if (later && kind === 'refused' && ev.slice(from).some(e => e.type === 'refused' && e.why === 'feared')) {
      // E28 (1.7 casting-adapter.js:215, :280; sigil-adapter.js:258): the fear takes the command before it is tried, so
      // the refusal's own words go and only 'Fear: retreat.' or 'Fear: trapped.' is said.
      for (let i = ev.length - 1; i >= from; i--) if (ev[i].type === 'log' && ev[i].words === 'You are too afraid.') ev.splice(i, 1);
      res = fearAction(state, p, ev) ?? res; kind = res?.kind ?? res;
    }
    if (actionAwards(state, ev, from)) applyHero(state);   // CF12: Old Anvil's piety for essence spent and Forge work
    const done = command.type === 'use' && command.amulet ? kind : stillnessStep(state, kind, ev);   // I47 Stillness
    return typeof res === 'object' ? { ...res, kind: done } : done;
  }, events);
  // RB52 (1.7 knockback, teleports: computeFOV): a hero thrown, pulled or teleported this action sees from where he stands.
  if (!state.over && state.floor && p.hp > 0 && (p.x !== at0.x || p.y !== at0.y) && state.sightAt !== p.x + ',' + p.y) refreshSight(state, events);
  // Traps 87: the hero fell through a pit this action, and goes down once the action is over.
  if (state.pendingFall && !state.over) { delete state.pendingFall; travel(state, 1, events, { fall: true }); }
  if (state.pendingGate && !state.over) { delete state.pendingGate; travel(state, 1, events); }
  return events;
}
