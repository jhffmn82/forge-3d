// The prison's cage (spec/world.md S8-S9; rooms.json prison): walking into a cage that holds a prisoner frees it as a
// fighter, an escapee or a hostile; an escapee walks to the upstairs for a reward and calls a rescue patrol.
// The Underdark's ritual cage (S29) is the same prop with a fixed outcome. Draws from the play stream.

import rooms from '../../data/rooms.json' with { type: 'json' };
import floors from '../../data/floors.json' with { type: 'json' };
import props from '../../data/props.json' with { type: 'json' };
import { next } from '../lib/rng.js';
import { makeCreature } from './monsters.js';
import { rollTable } from './loot.js';
import { stepToward } from './ai-step.js';
import { PROP_USES, CREATURE_HOOKS } from './set-pieces.js';
import { T, tileAt, walkable } from '../data/tiles.js';
import { isWall, bodyAt } from './moves.js';
import { cheb, D4 } from '../lib/geometry.js';
import { distanceField } from '../lib/grid.js';

const SWAP = floors.rows['swap-underdark'].map, PR = rooms.rows.prison, LOG = PR.interaction.logs, SFX = PR.interaction.sound;
const TRAVEL = new Set([T.STAIRS, T.STAIRS_UP, T.EXIT, T.PORTAL]);
const DOORISH = new Set([T.DOOR, T.OPEN_DOOR, T.LOCKED]);
const inRoom = (r, c) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;

/** A free floor cell within r of a point, nearest ring first (1.7 nearFree). */
function nearFree(state, at, r) {
  const f = state.floor;
  for (let d = 1; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
    const x = at.x + dx, y = at.y + dy;
    if (!isWall(f, x, y) && !bodyAt(state, x, y)) return { x, y };
  }
  return null;
}

const add = (state, m, events) => { state.actors[m.id] = m; state.order.push(m.id); events.push({ type: 'spawned', id: m.id, at: { x: m.x, y: m.y } }); };

/** S8: the upstairs, else the exit, for an escapee to reach; null when the floor has neither. */
export function prisonExit(f) {
  let exit = null;
  for (let k = 0; k < f.tiles.length; k++) {
    if (f.tiles[k] === T.STAIRS_UP) return { x: k % f.w, y: (k / f.w) | 0, up: true };
    if (f.tiles[k] === T.EXIT && !exit) exit = { x: k % f.w, y: (k / f.w) | 0, up: false };
  }
  return exit;
}

/** S8: walking into a cage with a prisoner frees it (a turn); an empty cage just stands there. */
PROP_USES.cage = (state, cage, events) => {
  if (!cage.prisoner) { events.push({ type: 'blocked', id: state.playerId, at: { x: cage.x, y: cage.y } }); return 'refused'; }
  const p = state.actors[state.playerId], f = state.floor;
  const c = nearFree(state, cage, 1) ?? nearFree(state, p, 2);
  if (!c) return 'refused';
  // 1.7 spawn: in the Underdark a Dungeon kind comes out as its deep counterpart (not the ritual's captive).
  const deep = Math.floor((state.floorNo - 1) / 5) === 3 && !f.plane && !cage.ritual;
  const m = makeCreature(deep ? SWAP[cage.prisoner] ?? cage.prisoner : cage.prisoner, c.x, c.y);
  cage.prisoner = null;
  const outcome = cage.prisonerOutcome ?? ['fighter', 'escapee', 'hostile'][Math.floor(next(state.rng) * 3)];
  const exit = outcome === 'escapee' && prisonExit(f);
  if (outcome !== 'hostile') Object.assign(m, { side: 'ally', asleep: false, hunting: false, avoidTraps: true, t: p.t });
  if (exit) {
    // The escapee: half max HP (a ritual captive keeps its share), half armour and evasion.
    m.maxhp = Math.max(1, Math.floor(m.maxhp / 2));
    m.hp = cage.ritual ? Math.max(1, Math.ceil(m.maxhp * cage.captiveHp / cage.captiveMaxhp)) : m.maxhp;
    m.armour /= 2; m.eva /= 2;
    Object.assign(m, { escapee: true, escapeExit: { x: exit.x, y: exit.y }, name: 'Escaping ' + m.name });
    add(state, m, events);
    events.push({ type: 'log', words: `Escort the prisoner to the ${exit.up ? 'upstairs' : 'exit'}. Reward on arrival.`, sfx: SFX });
    if (!cage.ritual) patrol(state, cage, events);
  } else if (outcome !== 'hostile') {
    m.name = 'Freed ' + m.name;
    add(state, m, events);
    events.push({ type: 'log', words: LOG[2], sfx: SFX });
  } else {
    Object.assign(m, { asleep: false, hunting: true, t: p.t, lastSeen: { x: p.x, y: p.y, at: state.now } });
    add(state, m, events);
    events.push({ type: 'log', words: LOG[3], sfx: SFX });
  }
  return 'act';
};

/** S8: the escapee heads for the way out while the hero is within 3 of it, else follows; at it, the reward. */
CREATURE_HOOKS.act.push((state, a, events) => {
  if (!a.escapee || a.hp <= 0) return false;
  const p = state.actors[state.playerId], exit = a.escapeExit, f = state.floor;
  if (!exit) { if (cheb(a, p) > 2) stepToward(state, a, p, events); return true; }   // a floor with no way up: it follows
  if (cheb(a, exit) <= 1 && cheb(p, exit) <= 3) {
    // WC12: the silk survivor leaves the escort reward, a ring or an amulet (1.7 makeEscortReward).
    for (const it of rollTable(state, a.silkEscort ? 'escort-reward' : 'prisoner-reward', state.floorNo)) f.items.push({ x: a.x, y: a.y, item: it });
    events.push({ type: 'drops', at: { x: a.x, y: a.y } }, { type: 'log', words: LOG[1] });
    a.hp = 0;
    events.push({ type: 'died', id: a.id, dismissed: true });
    return true;
  }
  if (cheb(p, exit) <= 3) stepToward(state, a, exit, events);
  else if (cheb(a, p) > 2) stepToward(state, a, p, events);
  return true;
});

/**
 * S9: the rescue patrol: the biome's pack on free floor 4-18 steps from the cage (through walkable tiles and doors,
 * past no blocking prop), outside the prison, out of sight, clear of stairs and traps, nearest first, hunting the
 * cage 100 later. The Crypt adds a ghoul behind the hero. Needs a cell for every member.
 */
function patrol(state, cage, events) {
  const f = state.floor, W = f.w, p = state.actors[state.playerId], b = Math.floor((state.floorNo - 1) / 5) + 1;
  const pack = PR.ambush.packs[b];
  if (!pack) return false;
  const room = (f.rooms ?? []).find(r => inRoom(r, cage));
  // The patrol's reach: 4-way steps from the cage over open ground and doors, round blocking props (lib/grid, C10h).
  const blocked = new Set(f.props.filter(q2 => props.rows[q2.id]?.blocks).map(q2 => q2.y * W + q2.x));
  const d = distanceField(W, f.h, cage.y * W + cage.x, n => !blocked.has(n) && (walkable(f, n % W, (n / W) | 0) || DOORISH.has(f.tiles[n])), { dirs: D4 });
  const nearTravel = (x, y) => { for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) if (TRAVEL.has(tileAt(f, xx, yy))) return true; return false; };
  const free = (x, y) => tileAt(f, x, y) === T.FLOOR && !bodyAt(state, x, y) && !f.props.some(o => o.x === x && o.y === y) && !(f.traps ?? []).some(t => t.x === x && t.y === y) && !nearTravel(x, y);
  const cells = [];
  for (let y = 1; y < f.h - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    if (d[k] < 4 || d[k] > 18 || (room && inRoom(room, { x, y })) || state.vis?.[k] || !free(x, y)) continue;
    cells.push({ x, y, d: d[k] });
  }
  if (cells.length < pack.length) return false;
  cells.sort((a, c) => a.d - c.d);
  const hunt = m => Object.assign(m, { asleep: false, hunting: true, t: p.t + 100, lastSeen: { x: cage.x, y: cage.y, at: state.now } });
  pack.forEach((kind, i) => add(state, hunt(makeCreature(kind, cells[i].x, cells[i].y)), events));
  if (b === 2) {
    const dx = Math.sign(cage.x - p.x), dy = Math.sign(cage.y - p.y);
    let back = null;
    for (let y = p.y - 3; y <= p.y + 3 && !back; y++) for (let x = p.x - 3; x <= p.x + 3; x++) if ((x - p.x) * dx + (y - p.y) * dy < 0 && d[y * W + x] >= 0 && free(x, y)) { back = { x, y }; break; }
    if (back) add(state, hunt(makeCreature('ghoul', back.x, back.y)), events);
  }
  events.push({ type: 'log', words: LOG[4] });
  return true;
}
