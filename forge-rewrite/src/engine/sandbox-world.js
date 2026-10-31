// The Sandbox's World and Rooms pages (split from sandbox.js, item 166): what the window offers (floors, planes,
// creatures, items, rooms), the jumps between floors and planes, the room preview, the Crucible walkthrough and
// Reveal. sandbox.js's sandboxCommand calls these; each returns null when it worked, else why it did not.

import monsters from '../../data/monsters.json' with { type: 'json' };
import weapons from '../../data/weapons.json' with { type: 'json' };
import armour from '../../data/armour.json' with { type: 'json' };
import offhands from '../../data/offhands.json' with { type: 'json' };
import rings from '../../data/rings.json' with { type: 'json' };
import amulets from '../../data/amulets.json' with { type: 'json' };
import foods from '../../data/foods.json' with { type: 'json' };
import sigils from '../../data/sigils.json' with { type: 'json' };
import progression from '../../data/progression.json' with { type: 'json' };
import gods from '../../data/gods.json' with { type: 'json' };
import roomRows from '../../data/rooms.json' with { type: 'json' };
import puzzleRows from '../../data/puzzles.json' with { type: 'json' };
import { nextFloorSeed } from '../lib/rng.js';
import { refreshSight } from '../rules/sight.js';
import { generateFloor } from '../world/generate.js';
import { buildChaosFloor } from '../world/biomes/chaos/realm.js';
import { syncGates } from '../rules/chaos-map.js';
import { buildPlane } from '../world/planes/build.js';
import { prepare as preparePlane } from '../rules/planes.js';
import { ELEMENTS } from '../rules/loot.js';
import { T, walkable } from '../data/tiles.js';

export const BIOMES = ['dungeon', 'crypt', 'caverns', 'underdark', 'chaos'];
const BIOME_NAMES = { dungeon: 'Dungeon', crypt: 'Crypt', caverns: 'Caverns', underdark: 'Underdark', chaos: 'Realm of Chaos', planes: 'Planes', other: 'Bosses and set pieces' };
const PLANES = ['light', 'shadow', 'earth', 'fire', 'water', 'air'];
const ATTRS = progression.rows.attributes.ids;

export const say = (events, words) => events.push({ type: 'log', words: 'Sandbox: ' + words });

const rowsOf = t => Object.entries(t.rows).filter(([, r]) => r && typeof r === 'object' && r.kind !== 'rule' && r.name);

/** What the Sandbox window offers: floors, planes, creatures by biome, items by kind, attributes. */
export function sandboxCatalog() {
  const creatures = {};
  for (const [id, r] of Object.entries(monsters.rows)) {
    if (!r?.hp || !r.look) continue;
    const s = r.spawn ?? {}, fam = BIOMES.includes(r.family) ? r.family : null;
    const g = s.plane ? 'planes' : id.startsWith('chaos-') || id.startsWith('unmaker-') ? 'chaos' : s.biomes?.[0] ?? fam
      ?? (s.floors?.[0] >= 1 ? BIOMES[Math.min(4, Math.floor((s.floors[0] - 1) / 5))] : r.family === 'cavern' ? 'caverns' : 'other');
    (creatures[g] ??= []).push({ id, name: r.name, boss: (r.flags ?? []).includes('boss') });
  }
  const order = [...BIOMES, 'planes', 'other'];
  const sorted = Object.fromEntries(order.filter(k => creatures[k]).map(k => [k, creatures[k]]));
  const items = {
    weapon: rowsOf(weapons).map(([id, r]) => ({ id, name: r.name })),
    armour: rowsOf(armour).map(([id, r]) => ({ id, name: r.name })),
    offhand: rowsOf(offhands).map(([id, r]) => ({ id, name: r.name })),
    ring: rowsOf(rings).map(([id, r]) => ({ id, name: r.name })),
    amulet: rowsOf(amulets).map(([id, r]) => ({ id, name: r.name })),
    food: rowsOf(foods).filter(([, r]) => r.kind === 'food').map(([id, r]) => ({ id, name: r.name })),
    sigil: Object.entries(sigils.rows).filter(([, r]) => r?.name).map(([id, r]) => ({ id, name: r.name })),
  };
  const floors = Array.from({ length: 25 }, (_, i) => ({ n: i + 1, biome: BIOMES[Math.min(4, Math.floor(i / 5))] }));
  const patrons = Object.entries(gods.rows).filter(([, r]) => r?.boons).map(([id, r]) => ({ id, name: r.name.split(',')[0].split(' the ')[0] }));   // item 180: 'Sylla', 'Sir Reginald'
  return { floors, planes: PLANES, creatures: sorted, items, attrs: ATTRS, biomeNames: BIOME_NAMES, elements: ELEMENTS, rooms: roomCatalog(), gods: patrons };
}

// ---- Room preview (1.7 FoteRoomPreview: the Sandbox could build a floor with any special, rare, hidden or puzzle room) ----
const RR = roomRows.rows;
const nameOf = id => id[0].toUpperCase() + id.slice(1).replace(/-/g, ' ');
/** The rooms a preview can force, by group: {type, kind, name, floors} (floors: where the room can stand, best first). */
function roomCatalog() {
  const at = row => {
    const ex = row.exclude?.floors ?? [], fl = [];
    for (let n = 1; n <= 19; n++) {
      if (n % 5 === 0 || ex.includes(n) || n < (row.minFloor ?? 1) || (row.floors && (n < row.floors[0] || n > row.floors[1]))) continue;
      if (row.biomes && !row.biomes.includes(BIOMES[Math.floor((n - 1) / 5)])) continue;
      fl.push(n);
    }
    return fl;
  };
  const of = kinds => Object.entries(RR).filter(([id, r]) => r && kinds.includes(r.kind) && id !== 'merchant');
  return {
    special: of(['special', 'uncommon-event']).map(([id, r]) => ({ type: 'special', kind: id, name: r.name ?? nameOf(id), floors: at(r) })),
    rare: of(['rare-floor']).map(([id, r]) => ({ type: 'special', kind: id, name: r.name ?? nameOf(id), floors: at(r) })),
    hidden: of(['hidden-sigil']).map(([id, r]) => ({ type: 'hidden', kind: id.replace(/^hidden-/, ''), name: r.name ?? nameOf(id), floors: at(r) })),
    // Puzzles are built on Dungeon floors 2-4 for now (generate.js runs the puzzle pass there).
    puzzle: Object.entries(puzzleRows.rows).filter(([, r]) => r?.name && r.kind !== 'rule').map(([id, r]) => ({ type: 'puzzle', kind: id, name: r.name, floors: [2, 3, 4] })),
  };
}

/**
 * Item 171 (Justin 2026-10-18: "jump to one of the special rooms"): where the hero stands in the forced room: its free
 * floor tile nearest the middle. The room is the floor's own record of it (a special's kind, 'hidden', or the puzzle
 * pass's room); null when the builder fell back to another room, so the next seed is tried.
 */
function standIn(out, e) {
  const f = out.floor, want = e.type === 'hidden' ? ['hidden'] : e.type === 'puzzle' ? ['puzzle', 'crystal', 'elemental-treasure'] : [e.kind];
  const r = (f.rooms ?? []).find(q => want.includes(q.special));
  if (!r) return null;
  const free = (x, y) => walkable(f, x, y) && !out.creatures.some(m => m.x === x && m.y === y) && !(f.props ?? []).some(q => q.x === x && q.y === y);
  const mid = { x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 }, cells = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (free(x, y)) cells.push({ x, y });
  return cells.sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0] ?? null;
}

/** A floor built with one room forced (up to 12 seeds until it stands), the hero standing in it. */
export function toRoom(state, c, events, api) {
  const all = Object.values(roomCatalog()).flat(), e = all.find(r => r.type === c.room && r.kind === c.kind);
  if (!e) return 'bad-room';
  if (!e.floors.length) { say(events, `${e.name} has no floor to stand on.`); return 'no-floor'; }
  const n = e.floors.includes(state.floorNo) && !state.floor.plane ? state.floorNo : e.floors.find(f => f >= 3) ?? e.floors[0];
  for (let t = 0; t < 12; t++) {
    state.floorSeed = nextFloorSeed(state.floorSeed);
    let res;
    const force = { type: e.type, kind: e.kind, built: false }, run = { ...state.run };   // a rejected room preview keeps no trinket history (340)
    try { res = { out: generateFloor(state.floorSeed, n, run, { force, masterworks: state.masterworks ?? {} }), built: force.built }; } catch { res = null; }
    const at = res?.out && res.built && standIn(res.out, e);
    if (!at) continue;
    state.run = run;
    state.stored = {}; state.fallen = {};
    api.arriveFloor(state, n, res.out, at);
    events.push({ type: 'floor', floorNo: n, sandbox: true });
    say(events, `${e.name}, floor ${n}.`);
    return null;
  }
  say(events, `${e.name} could not be built on floor ${n}. Try again.`);
  return 'no-room';
}

/** A new floor (1-25), fresh from a new seed. Stored floors are dropped: a jump is a clean look, not a route. */
export function toFloor(state, n, events, api) {
  if (!Number.isInteger(n) || n < 1 || n > 25) return 'bad-floor';
  state.floorSeed = nextFloorSeed(state.floorSeed);
  let built;
  try { built = n >= 21 ? buildChaosFloor(state.floorSeed, n, { encounters: state.sandbox.encounters, masterworks: state.masterworks ?? {} }) : generateFloor(state.floorSeed, n, state.run, { masterworks: state.masterworks ?? {} }); } catch (e) { built = null; }
  if (!built) { say(events, `floor ${n} could not be built from this seed. Try again.`); return 'no-floor'; }
  state.stored = {}; state.fallen = {};
  api.arriveFloor(state, n, built, built.start);
  events.push({ type: 'floor', floorNo: n, sandbox: true, ...(n >= 21 ? { chaos: true } : {}) });
  say(events, `floor ${n}, ${BIOME_NAMES[BIOMES[Math.min(4, Math.floor((n - 1) / 5))]]}.`);
  return null;
}

/** Into a plane from the floor the hero is on; its portal back leads to where the hero stood (realm.js leavePlane). */
export function toPlane(state, el, events, api) {
  if (!PLANES.includes(el)) return 'bad-plane';
  // Already on a plane: back to its host floor first (as its portal would), then on to the new plane.
  if (state.floor.plane) {
    const pets = api.followers(state), home = api.takeStored(state, 'plane');   // its timers paused while away, as the portal home does (planes 37)
    if (!home) return 'on-plane';
    api.arriveFloor(state, state.floorNo, home, home.at, { pets, keepKeys: true });
  }
  const p = state.actors[state.playerId];
  const S = ((state.floorSeed ^ 0x7A11E5 ^ (state.floorNo * 131) ^ (state.now + 1)) >>> 0);
  let built;
  try { built = buildPlane(S, el, state.floorNo, state.rng); } catch (e) { say(events, `the plane of ${el} could not be built.`); return 'no-plane'; }
  const pets = api.leaveFloor(state, 'plane', { at: { x: p.x, y: p.y } });
  (state.planesVisited ??= []).push(el);
  api.arriveFloor(state, state.floorNo, built, built.start, { pets, keepKeys: true });
  preparePlane(state);
  events.push({ type: 'floor', floorNo: state.floorNo, plane: el, music: 'plane-' + el, sandbox: true });
  say(events, `the plane of ${el}.`);
  return null;
}

export function stairsOf(f) {
  const k = f.tiles.indexOf(T.STAIRS) >= 0 ? f.tiles.indexOf(T.STAIRS) : f.tiles.indexOf(T.EXIT) >= 0 ? f.tiles.indexOf(T.EXIT) : f.tiles.indexOf(T.PORTAL);
  return k >= 0 ? { x: k % f.w, y: (k / f.w) | 0 } : null;
}

/**
 * Item 166 (1.7 game.js bReveal, revealAll): Reveal shows the whole floor until it is turned off again. The floor keeps
 * what the hero had really seen (floor.unrevealed), and Reveal off puts that back, plus what is in sight now.
 */
export function reveal(state, on, events) {
  const f = state.floor;
  if (on && !f.unrevealed) { f.unrevealed = state.seen ? Array.from(state.seen) : new Array(f.w * f.h).fill(0); state.seen = new Array(f.w * f.h).fill(1); }
  if (!on && f.unrevealed) { state.seen = f.unrevealed; delete f.unrevealed; }
  refreshSight(state, events);
}

/**
 * CH33, 1.7 FoteUnmakerPreview.setWalkthrough: on floor 25 both Crucible gates rise so the layout and the true Forge can
 * be walked without the fight. It never counts as a victory (the Forge still waits for the Unmaker's defeat), it is
 * refused while the fight is on, and the locks come back only with everyone south of the rear gate; with anyone still
 * between the gates the entrance stays raised (phase 'preview'), so a gate is never lowered onto a body nor anyone shut in.
 */
export function walkthrough(state, on, events) {
  const f = state.floor, c = f.crucible;
  if (!c) { say(events, "the gate walkthrough is for the Unmaker's Crucible, floor 25."); return 'no-crucible'; }
  if (c.phase === 'active') { say(events, 'not while the Unmaker fight is on.'); return 'fight-on'; }
  if (!!c.walkthrough === on) return null;
  const living = state.order.map(id => state.actors[id]).filter(a => a.hp > 0 && !a.limbOf);
  if (!on && c.phase !== 'defeated' && living.some(a => a.y <= c.rearSeal.y)) {
    say(events, 'you and your companions must return south of the rear gate before the gate locks are restored.');
    return 'beyond-gate';
  }
  // 1.7: someone between the gates while the fight is still to come keeps the entrance raised ('preview'), so nobody is
  // shut in; once everyone is back south of it the entrance locks again and opening it starts the fight.
  if (!on && (c.phase === 'ready' || c.phase === 'preview')) c.phase = living.some(a => a.y <= c.entryGate.y) ? 'preview' : 'ready';
  c.walkthrough = on;
  syncGates(f);
  events.push({ type: 'door', at: { x: c.entryGate.x, y: c.entryGate.y }, open: on, sfx: on ? 'door-open' : 'door-locked' });
  refreshSight(state, events);
  say(events, on ? 'both Crucible gates raised for a walkthrough. This does not count as defeating the Unmaker.' : "gate locks restored. The rear gate waits for the Unmaker's defeat.");
  return null;
}
