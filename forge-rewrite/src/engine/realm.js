// Travel beyond the ordinary stairs (spec/chaos.md 4-28, 49-53, 70-83; spec/planes.md 23-39): the treasure room
// under floor 20, the Realm's currents and island portals, the gateway back to the treasure room, the Crucible's gates,
// the Forge of the Elements and the run's victory, and the elemental planes (in and out through their portal).
// game.js calls four hooks (see the coordinator's wiring note in chaos-progress.md):
//   travel():            const r = realmTravel(state, dir, events, api); if (r) return r;
//   resolveMove(), bump: const b = realmBump(state, p, x, y, events); if (b) return b;
//   resolveMove(), step: realmStepped(state, events);   (after enterTile, when the hero moved)
//   resolveHeroCommand(): if (c.type === 'realm') return realmCommand(state, c, events, api);
// api = game.js's FLOORS (engine/floors.js): leaveFloor, takeStored, arriveFloor, followers (C3: one way between floors).
// Allies wait on every floor the hero leaves, the Realm's and the treasure room included (chaos answer 5; 2026-10-16).

import planes from '../../data/planes.json' with { type: 'json' };
import biomes from '../../data/biomes.json' with { type: 'json' };
import { nextFloorSeed } from '../lib/rng.js';
import { bodyAt } from '../rules/moves.js';
import { refreshSight } from '../rules/sight.js';
import { T, tileAt, walkable } from '../data/tiles.js';
import { buildChaosFloor, buildTreasureRoom, MATERIAL_GATE_NAME } from '../world/biomes/chaos/realm.js';
import { chaosRegionAt } from '../rules/chaos-map.js';
import { buildPlane } from '../world/planes/build.js';
import { descentAward } from '../rules/faith.js';
import { startFight, trueForgeAt } from '../rules/unmaker.js';
import '../rules/chaos-ai.js';
import { prepare as preparePlane } from '../rules/planes.js';

const PL = planes.rows, BIOME_NAMES = ['Dungeon', 'Crypt', 'Caverns', 'Underdark', 'Realm of Chaos'];
const TITLE = el => PL['plane-' + el]?.name ?? `the Plane of ${el[0].toUpperCase()}${el.slice(1)}`;
const here = state => { const p = state.actors[state.playerId]; return { p, t: tileAt(state.floor, p.x, p.y) }; };
const log = (events, words, extra = {}) => events.push({ type: 'log', words, ...extra });
const onTreasure = state => !!state.floor?.treasureRoom;
const currentName = n => (n === 20 ? 'the treasure room' : 'floor ' + n);

function arrive(state, floorNo, built, at, events, api, extra = {}, pets = []) {
  api.arriveFloor(state, floorNo, built, at, { pets });
  events.push({ type: 'floor', floorNo, ...extra });
}

/** A new or stored Realm floor (chaos 17, 19): visited floors come back as they were left. */
function toChaosFloor(state, target, dir, events, api, quiet = false, pets = []) {
  let built = api.takeStored(state, target), at;
  const back = !!built;
  if (back) at = dir > 0 ? built.floor.arrival : built.floor.stairs;
  else {
    state.floorSeed = nextFloorSeed(state.floorSeed);
    built = buildChaosFloor(state.floorSeed, target, { masterworks: state.masterworks ?? {} });
    at = built.start;
  }
  // CB32 (1.7 systems.js:807): riding a current plays the stairs; the Realm's entry says it on its own line (quiet).
  arrive(state, target, built, at, events, api, { back, chaos: true, ...(quiet ? {} : { sfx: 'stairs' }) }, pets);
  if (back) log(events, `The current carries you back to floor ${target}. It is as you left it.`);
  if (!back && dir > 0) descentAward(state, events);
  return 'free';
}

/** Hook in travel(): stairs, currents and gateways that are not the ordinary floor-to-floor stairs. */
export function realmTravel(state, dir, events, api) {
  const { p, t } = here(state), f = state.floor, n = state.floorNo;
  if (f.plane) {
    log(events, dir > 0 ? `There are no stairs in ${TITLE(f.plane)}. The portal is the way home.` : 'No stairs up here.');
    return 'refused';
  }
  // Chaos 4-5: floor 20's open exit leads to the treasure room, not to floor 21.
  if (n === 20 && !onTreasure(state) && dir > 0 && t === T.EXIT && f.exitOpen) {
    const pets = api.leaveFloor(state, 20), built = api.takeStored(state, 'chaos-entry') ?? buildTreasureRoom(state.seed);
    arrive(state, 20, built, built.floor.arrival, events, api, { treasureRoom: true }, pets);
    // CH32 (1.7 chaos-campaign.js:66, :120, :130, :135, :149): the travel lines are c-kill gold.
    log(events, 'Beyond the twentieth floor, a quiet treasure room waits before the portal to Chaos.', { sfx: 'stairs', kill: true });
    events.push({ type: 'autosave', label: 'Chaos treasure room' });
    return 'free';
  }
  if (onTreasure(state)) {
    if (dir > 0) { log(events, 'The portal leads to floor 21. Step into it to enter the Realm of Chaos.'); return 'refused'; }
    if (t !== T.STAIRS_UP) return 'refused';
    if (!state.stored[20]) { log(events, "The way back to the Matron's hall is not available in this scenario."); return 'refused'; }
    const pets = api.leaveFloor(state, 'chaos-entry'), back = api.takeStored(state, 20);
    const k = back.floor.tiles.indexOf(T.EXIT), at = k >= 0 ? { x: k % back.floor.w, y: (k / back.floor.w) | 0 } : back.floor.stairs;
    arrive(state, 20, back, at, events, api, { back: true }, pets);
    log(events, "You return to floor 20 and the Matron's hall.", { sfx: 'stairs', kill: true });
    events.push({ type: 'autosave', label: 'floor 20' });
    return 'free';
  }
  if (n < 21) return null;
  // Floors 21-24 ride the currents; floor 21's way up is the gateway (chaos 18), floor 25 has no way down.
  if (dir > 0) {
    if (t !== T.STAIRS || n >= 25) return 'refused';
    return toChaosFloor(state, n + 1, 1, events, api, false, api.leaveFloor(state, n));
  }
  if (n === 21) return t === T.PORTAL ? gatewayBack(state, events, api) : 'refused';
  if (t !== T.STAIRS_UP) return 'refused';
  return toChaosFloor(state, n - 1, -1, events, api, false, api.leaveFloor(state, n));
}

/** Chaos 18: floor 21's gateway back to the treasure room. */
function gatewayBack(state, events, api) {
  if (!state.stored['chaos-entry']) { log(events, 'The upstream current fades before reaching the treasure room.'); return 'refused'; }
  const pets = api.leaveFloor(state, 21), room = api.takeStored(state, 'chaos-entry');
  arrive(state, 20, room, { x: 28, y: 13 }, events, api, { treasureRoom: true, back: true }, pets);
  log(events, 'You step through the elemental gateway into the treasure room.', { sfx: 'stairs', kill: true });
  events.push({ type: 'autosave', label: 'Chaos treasure room' });
  return 'free';
}

/** Chaos 10: the treasure room's portal opens the Realm (floor 21 new, or as it was left). */
function enterRealm(state, events, api) {
  const { t } = here(state);
  if (!onTreasure(state) || t !== T.PORTAL || state.over) return 'refused';
  toChaosFloor(state, 21, 1, events, api, true, api.leaveFloor(state, 'chaos-entry'));
  log(events, 'You step through the portal into <b>the Realm of Chaos</b>.', { sfx: 'stairs', kill: true });
  events.push({ type: 'autosave', label: 'floor 21' });
  return 'free';
}

/** Chaos 50-52: through a linked portal to the next island; allies follow to the nearest free island cells. */
function islandPortal(state, events) {
  const { p } = here(state), f = state.floor, ch = f.chaos;
  const src = ch?.portals.find(q => p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h);
  const dest = src && ch.portals.find(q => q.id === src.destinationId);
  if (!dest || dest.destinationId !== src.id) return 'refused';
  const taken = new Set(state.order.map(id => state.actors[id]).filter(a => a.hp > 0 && a !== p).map(a => a.y * f.w + a.x));
  const legal = (x, y) => chaosRegionAt(f, x, y) === dest.region && (tileAt(f, x, y) === T.FLOOR || tileAt(f, x, y) === T.OPEN_DOOR) && !f.props.some(q => q.x === x && q.y === y) && !taken.has(y * f.w + x);
  const nearest = from => {
    const out = [];
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (legal(x, y)) out.push({ x, y });
    out.sort((a, b) => Math.abs(a.x - from.x) + Math.abs(a.y - from.y) - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)) || a.y - b.y || a.x - b.x);
    return out[0] ?? null;
  };
  const to = legal(dest.arrival.x, dest.arrival.y) ? dest.arrival : nearest(dest.arrival);
  if (!to) return 'refused';
  const from = { x: p.x, y: p.y };
  p.x = to.x; p.y = to.y; taken.add(to.y * f.w + to.x);
  events.push({ type: 'teleported', id: p.id, from, to: { ...to }, portal: true, sfx: 'portal' });
  for (const a of state.order.map(id => state.actors[id]).filter(a => a.side === 'ally' && a.hp > 0)) {
    taken.delete(a.y * f.w + a.x);
    const c = nearest(p);
    if (!c) { taken.add(a.y * f.w + a.x); continue; }
    const af = { x: a.x, y: a.y }; a.x = c.x; a.y = c.y; a.t = p.t; taken.add(c.y * f.w + c.x);
    events.push({ type: 'teleported', id: a.id, from: af, to: { ...c } });
  }
  ch.current = dest.region;
  log(events, `You step into ${ch.regions.find(r => r.id === dest.region)?.name ?? 'the next island'}. The portal behind you stays open.`);
  events.push({ type: 'autosave', label: 'Chaos portal' });
  refreshSight(state, events);
  return 'act';
}

/** Hook in resolveMove() before doors and walls: the void, the Crucible's gates, the Forge of the Elements, lava. */
export function realmBump(state, p, x, y, events) {
  const f = state.floor, t = tileAt(f, x, y);
  if (f.voidImpassable && t === T.CHASM) { log(events, biomes.rows.chaos.voidLog); return 'refused'; }
  // UD18: lava refuses a step with its words on a plane and in the Underdark's volcanic caves alike (1.7 deep.js:719
  // moveDeepTerrain, planes blockedMoveLog); a foe standing on it is still attacked.
  if (t === T.LAVA && !bodyAt(state, x, y)) { log(events, biomes.rows['hazard-underdark-lava']?.moveBlockLog ?? 'Molten rock. You cannot cross it.'); return 'refused'; }
  const c = f.crucible;
  if (c) {
    const onEntry = y === c.entryGate.y && x >= c.entryGate.x && x < c.entryGate.x + c.entryGate.w;
    const onRear = y === c.rearSeal.y && x >= c.rearSeal.x && x < c.rearSeal.x + c.rearSeal.w;
    // CH33: the sandbox's gate walkthrough (1.7 FoteUnmakerPreview.setWalkthrough) raises both gates without the fight.
    if (c.walkthrough && (onEntry || onRear)) return null;
    if (onRear && c.phase !== 'defeated') { log(events, 'The rear gate is sealed until the Unmaker is defeated.', { sfx: 'door-locked' }); return 'refused'; }
    if (onEntry && c.phase === 'active') { log(events, 'The entrance gate stays sealed until the Unmaker falls.', { sfx: 'door-locked' }); return 'refused'; }
    if (onEntry && c.phase === 'ready') {
      if (!startFight(state, events)) { log(events, 'The gate will not open yet.'); return 'refused'; }
      refreshSight(state, events);
      return 'act';
    }
    if (trueForgeAt(f, x, y)) {
      if (c.phase !== 'defeated') { log(events, 'It will not wake until the Unmaker falls.'); return 'refused'; }
      if (c.retired) { log(events, 'The Forge burns in balance. Your work here is done.'); return 'refused'; }   // item 80: a loaded winner
      events.push({ type: 'confirm', id: 'forge-of-the-elements', title: 'Forge of the Elements', text: 'The elements gather at your touch. Would you like to restore balance and retire?',
        yes: 'Retire', no: 'Keep exploring', command: { type: 'realm', action: 'retire' }, decline: { type: 'realm', action: 'keep-exploring' } });
      return 'refused';
    }
  }
  return null;
}

/** Hook after the hero steps: the prompts of portals, gateways and currents (chaos 9, 16, 18, 50; planes 27-28). */
export function realmStepped(state, events) {
  const { p, t } = here(state), f = state.floor, n = state.floorNo;
  if (onTreasure(state) && t === T.PORTAL) {
    events.push({ type: 'confirm', id: 'enter-realm', title: 'Enter the Realm of Chaos', text: 'The portal leads to floor 21. Collect any supplies you want to carry before leaving. There are no god shrines in Chaos.', yes: 'Step through', command: { type: 'realm', action: 'enter-realm' } });
    return;
  }
  if (onTreasure(state) && t === T.STAIRS_UP) { log(events, "Stairs back to floor 20 and the Matron's hall.", { kill: true }); return; }
  const ch = f.chaos;
  if (ch?.currents) {
    const cu = ch.currents;
    if (n === 21 && cu.materialGate && p.x === cu.up.x && p.y === cu.up.y) {
      events.push({ type: 'confirm', id: 'material-gate', title: 'Return to the Material Plane', text: 'This elemental gateway leads back to the treasure room beneath floor 20. The way to Chaos remains open.', yes: 'Step through', command: { type: 'ascend' }, name: MATERIAL_GATE_NAME });
      return;
    }
    const dir = cu.down && p.x === cu.down.x && p.y === cu.down.y ? 1 : cu.up && p.x === cu.up.x && p.y === cu.up.y && n > 21 ? -1 : 0;
    if (dir) {
      const name = currentName(n + dir), hint = `A magical current will carry you through the void to ${name}.`;
      log(events, `${hint} Press <b>${dir > 0 ? '>' : '<'}</b> to ride the current.`, { touch: `${hint} Tap it to travel.`, cls: 'c-kill' });   // CH24 (1.7 chaos-campaign.js:56)
      events.push({ type: 'confirm', id: 'current', title: 'Current to ' + name, text: hint, yes: 'Ride the current', command: { type: dir > 0 ? 'descend' : 'ascend' } });
      return;
    }
    if (t === T.PORTAL && ch.portals.some(q => p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h)) {
      events.push({ type: 'confirm', id: 'island-portal', title: 'Step through to the next island?', text: 'A two-way portal to another island on this floor.', yes: 'Step through', command: { type: 'realm', action: 'island-portal' } });
      return;
    }
  }
  // Planes 27-28: the host floor's portal, and the way home from a plane.
  if (t === T.PORTAL && f.plane) {
    const guardian = state.order.some(id => { const a = state.actors[id]; return a.elite && a.hp > 0; });
    const chest = (f.chests ?? []).some(c => !c.open);
    const notes = [guardian ? 'Its guardian still lives.' : '', chest ? 'Its rune chest is still unopened; anything left here is lost.' : ''].filter(Boolean).join(' ');
    events.push({ type: 'confirm', id: 'leave-plane', title: `Leave ${TITLE(f.plane)}?`, text: notes, yes: 'Return', command: { type: 'realm', action: 'leave-plane' } });
    return;
  }
  if (t === T.PORTAL && f.portal?.plane) {
    if (f.portal.used) { log(events, 'The portal has gone dark.'); return; }
    events.push({ type: 'confirm', id: 'enter-plane', title: 'Step through the portal?', text: `It leads to ${TITLE(f.portal.plane)}.`, yes: 'Step through', command: { type: 'realm', action: 'enter-plane' } });
  }
}

/** Planes 29-35, 40: into the plane, the host floor kept as it was (its portal now dark). */
function enterPlane(state, events, api) {
  const { p, t } = here(state), f = state.floor, el = f.portal?.plane;
  if (t !== T.PORTAL || !el || f.portal.used) return 'refused';
  if (!PL['plane-' + el]?.roster) { log(events, 'The portal flickers and will not hold. Nothing lies beyond it yet.', { sfx: 'ui-error' }); return 'refused'; }
  const S = ((state.floorSeed ^ 0x7A11E5 ^ (state.floorNo * 131)) >>> 0);
  let built;
  try { built = buildPlane(S, el, state.floorNo, state.rng); } catch (e) {
    log(events, `The plane could not be prepared. You remain on floor ${state.floorNo}. Try the portal again.`);
    return 'refused';
  }
  f.portal.used = true; f.lights = (f.lights ?? []).filter(l => !l.portalLight);   // a used portal stops glowing (W3)
  // Allies are left behind on every floor change (ruled 2026-10-16): they wait on the host floor with its creatures.
  const pets = api.leaveFloor(state, 'plane', { at: { x: p.x, y: p.y } });
  (state.planesVisited ??= []).push(el);
  // Planes 107: creatures that fell from above wait for the host floor, never the plane (it keeps the host's number).
  const fell = state.fallen?.[state.floorNo];
  if (fell) delete state.fallen[state.floorNo];
  api.arriveFloor(state, state.floorNo, built, built.start, { pets, keepKeys: true });
  if (fell) state.fallen[state.floorNo] = fell;
  preparePlane(state);   // its bodies' native flags and own rules before anything strikes them
  events.push({ type: 'floor', floorNo: state.floorNo, plane: el, music: 'plane-' + el, shake: 6 });
  log(events, `You step through the portal into ${TITLE(el)}.`, { sfx: 'stairs', kill: true });
  if (PL['plane-' + el].arrivalText) log(events, PL['plane-' + el].arrivalText);
  events.push({ type: 'autosave', label: 'plane' });
  return 'free';
}

/** Planes 36, 39: home again; the plane and anything left on it are gone, the portal stays dark. */
function leavePlane(state, events, api) {
  const { t } = here(state), f = state.floor;
  if (!f.plane || t !== T.PORTAL) return 'refused';
  if (!state.stored.plane) { log(events, 'The portal flickers but nothing happens.'); return 'refused'; }
  const pets = api.followers(state), home = api.takeStored(state, 'plane');   // planes 37: the host's timers paused meanwhile; its portal went dark (39)
  // Off a plane Snuffed caps sight but does not count down (plane-hazard-snuffed offPlane): frozen from this moment, so
  // the first pulse at home takes nothing off (statuses tick before the planes' pulse hook re-freezes it).
  const snuffed = state.actors[state.playerId].statuses?.snuffed;
  if (snuffed) snuffed.born = state.now + 1;
  api.arriveFloor(state, state.floorNo, home, home.at, { pets, keepKeys: true });
  events.push({ type: 'floor', floorNo: state.floorNo, back: true, fromPlane: f.plane });
  log(events, `You step back into the ${BIOME_NAMES[Math.min(4, Math.floor((state.floorNo - 1) / 5))]}. Behind you the portal gutters and goes dark.`, { kill: true });
  events.push({ type: 'autosave', label: 'floor ' + state.floorNo });
  return 'free';
}

/** Chaos 81-83: Retire ends the run in victory; Keep exploring leaves it open. */
function retire(state, events, yes) {
  const c = state.floor.crucible, p = state.actors[state.playerId], fo = c?.trueForge;
  if (!c || c.phase !== 'defeated' || state.over || c.retired) return 'refused';   // a loaded winner has retired already (item 80)
  const near = fo && Math.max(Math.max(fo.x - p.x, 0, p.x - (fo.x + fo.w - 1)), Math.max(fo.y - p.y, 0, p.y - (fo.y + fo.h - 1))) <= 1;
  if (!near) return 'refused';
  if (!yes) { log(events, 'Your journey continues. Use the Forge again when you are ready to retire.'); return 'free'; }
  c.retired = true;
  state.over = true; state.won = true;
  log(events, '<b>You restore the Forge of the Elements and retire. Balance returns to the material plane.</b>', { kill: true });   // CH32 (unmaker-encounter.js:289)
  events.push({ type: 'victory', sfx: 'victory', story: 'You defeated the Unmaker and restored balance to the material plane. Fire, water, air, earth, light and shadow burn in harmony once more. Your work is done.' });
  return 'free';
}

/** Hook in resolveHeroCommand() for {type:'realm', action}. */
export function realmCommand(state, c, events, api) {
  switch (c.action) {
    case 'enter-realm': return enterRealm(state, events, api);
    case 'island-portal': return islandPortal(state, events);
    case 'retire': return retire(state, events, true);
    case 'keep-exploring': return retire(state, events, false);
    case 'enter-plane': return enterPlane(state, events, api);
    case 'leave-plane': return leavePlane(state, events, api);
    // CH25: a tap on the portal underfoot asks its question again; no time passes.
    case 'prompt': return here(state).t === T.PORTAL ? (realmStepped(state, events), 'free') : 'refused';
  }
  return 'refused';
}
