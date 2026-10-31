// The hero's move (consolidation C13, engine-rules-21): a bump attack, a reach strike, an ally swapped, a tile that
// answers a walk-in (the BUMPS table), or a step; and Fear's step away. Moved from game.js.

import { isWall, bodyAt, tryStep } from '../rules/moves.js';
import { weaponAttack, offHandSwing } from '../rules/attack.js';
import { blocks, statusRow } from '../rules/statuses.js';
import { observeMove } from '../rules/ai-sense.js';
import { realmBump, realmStepped } from './realm.js';
import { coreName } from '../rules/loot.js';
import { shrineState } from '../rules/faith.js';
import { T, tileAt, walkable, G } from '../data/tiles.js';
import { itemRow } from '../rules/items.js';
import { PROP_USES, TILE_USES, BODY_USES } from '../rules/set-pieces.js';
import { refreshSight } from '../rules/sight.js';
import { revealSecret } from '../rules/traps.js';
import { enterTile, openChest, spawnAround } from '../rules/pickup.js';
import { breakProp } from '../rules/props.js';
import { tollBump, altarBump } from '../rules/rooms.js';
import { next } from '../lib/rng.js';
import { cheb, D8 } from '../lib/geometry.js';

/** CD2: a melee weapon attack has its own time (scheduler.js, costs.js attackTime). */
export const melee = state => { const w = state.hero?.worn?.main ?? null; return { kind: 'act', attack: { melee: true, unarmed: !w, weapon: w } }; };

/**
 * The tile bumps in 1.7's order (C13, engine-rules-21): each answers a walk into (x, y) with a result, or null for the
 * next. The owning modules seed it (rules/rooms.js: the spiked door and the sacrifice altar).
 */
const BUMPS = [
  // W52: a shut door opens when walked into; it costs the action.
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(state.floor, x, y) === T.DOOR) {
      state.floor.tiles[y * state.floor.w + x] = T.OPEN_DOOR;
      events.push({ type: 'door', at: { x, y }, open: true, sfx: 'door-open' });   // 1.7 systems.js:43
      refreshSight(state, events);
      return 'act';
    }
    return null;
  },
  // W51: the sealed exit gate takes the carried core and grinds open (an action); open, it is walked onto.
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.EXIT && !f.exitOpen) {
      // E44 (1.7 cores.js:90-99 absorbCoreAtGate, :122-135 moveCoreGate): only this biome's core opens it, and it is named.
      if (h.core && h.core !== coreName(state.floorNo)) { events.push({ type: 'log', words: 'This gate does not answer to the core you carry.', cls: 'c-info', sfx: 'door-locked' }); return 'refused'; }
      if (h.core) {
        const name = h.core;
        h.core = null; f.exitOpen = true;
        events.push({ type: 'door', at: { x, y }, open: true, sfx: 'victory', gate: true }, { type: 'log', words: `You press the <b>${name}</b> into the gate. It drinks the light, and the gate grinds open.`, kill: true });
        refreshSight(state, events);
        return 'act';
      }
      events.push({ type: 'log', words: 'The gate is sealed. It waits for the heart its guardian carried.', sfx: 'door-locked' });
      return 'refused';
    }
    return null;
  },
  // W49: a chasm is crossed only floating (a step over it); otherwise the hero is told and stays (1.7 systems.js:53-56).
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.CHASM) {
      if (!p.statuses.levitate || bodyAt(state, x, y)) { events.push({ type: 'log', words: 'A sheer drop into darkness. You would need to float to cross.' }); return 'refused'; }
      const from = { x: p.x, y: p.y };
      p.x = x; p.y = y;
      events.push({ type: 'moved', id: p.id, from, to: { x, y } });
      return 'move';
    }
    return null;
  },
  // W22: walking into the Forge or a shrine opens its window (no action).
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.FORGE) { events.push({ type: 'forge', at: { x, y }, sfx: 'forge-open' }); return 'refused'; }
    if (tileAt(f, x, y) === T.SHRINE) { events.push({ type: 'shrine', ...shrineState(state), sfx: 'shrine-open' }); return 'refused'; }
    return null;
  },
  // W27: an iron door opens with a key (an action); without one it says where to look (no action).
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.LOCKED) {
      if ((h.keys ?? 0) > 0) {
        h.keys -= 1; f.tiles[k] = T.OPEN_DOOR;
        events.push({ type: 'door', at: { x, y }, open: true, sfx: 'door-unlock' }, { type: 'log', words: 'The iron key turns. The vault opens.' });
        refreshSight(state, events);
        return 'act';
      }
      const holder = state.order.some(id => state.actors[id].key && state.actors[id].hp > 0) || f.items?.some(i => i.item.kind === 'key');
      events.push({ type: 'log', words: 'Locked. An iron key would open it.' + (holder ? ' One is somewhere on this floor.' : ''), sfx: 'door-locked' });
      return 'refused';
    }
    return null;
  },
  // W30: walking into a hidden door finds it if a tell is beside it, else on a 25% draw; only a find costs the action.
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.SECRET) {
      const tell = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx2, dy2]) => f.ground?.[(y + dy2) * f.w + x + dx2] === 10);
      if (tell || next(state.rng) < 0.25) { revealSecret(state, x, y, events); return 'act'; }
      events.push({ type: 'blocked', id: p.id, at: { x, y } });
      return 'refused';
    }
    return null;
  },
  // S32: the portcullis lever (once): the portcullis rises and two brutes and a shaman guard the cache. The sealed
  (state, p, x, y, events, { f, k, h, other }) => {

    return null;
  },
  // portcullis itself only says it is sealed (W54).
  (state, p, x, y, events, { f, k, h, other }) => {
    const lever = f.props.find(q => q.x === x && q.y === y && (q.id === 'lever-up' || q.id === 'lever-down') && q.portcullis);
    if (lever) {
      if (lever.id === 'lever-down') { events.push({ type: 'log', words: 'Its work is done.' }); return 'refused'; }
      lever.id = 'lever-down';
      const { door, room } = lever.portcullis;
      f.tiles[door.y * f.w + door.x] = T.OPEN_DOOR;
      spawnAround(state, ['brute', 'brute', 'shaman'], { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) }, events);
      events.push({ type: 'door', at: door, open: true }, { type: 'log', words: 'The portcullis rises. Two brutes and a shaman guard the cache.', sfx: 'lever' });
      refreshSight(state, events);
      return 'act';
    }
    return null;
  },
  // W54: a sealed door says what opens it (TILE_USES: the crystal vault's door, the elemental treasury's), else 'Sealed.'
  (state, p, x, y, events, { f, k, h, other }) => {
    if (tileAt(f, x, y) === T.SEALED) {
      for (const use of other ? [] : TILE_USES) { const r = use(state, x, y, events); if (r) return r; }
      events.push({ type: 'log', words: 'Sealed.' }); return 'refused';
    }
    return null;
  },
  (state, p, x, y, events) => tollBump(state, p, x, y, events),   // W28: the spiked door asks first
  (state, p, x, y, events) => altarBump(state, p, x, y, events),   // S10: the sacrifice altar asks first
];

/** CB03: the foe a reach weapon (weapons.json reach 2: the spear) strikes 2 tiles away in direction (dx, dy), or null. */
export function reachFoe(state, p, dx, dy) {
  const w = state.hero?.worn?.main, reach = w ? itemRow(w.id).row.reach ?? 1 : 1;
  if (reach < 2 || (!dx && !dy)) return null;
  const mx = p.x + dx, my = p.y + dy, fx = p.x + 2 * dx, fy = p.y + 2 * dy, f = state.floor;
  if (!walkable(f, mx, my) || bodyAt(state, mx, my)) return null;
  const foe = bodyAt(state, fx, fy);
  return foe && foe.side === 'foe' && foe.hp > 0 && state.vis?.[fy * f.w + fx] ? foe : null;
}

// G20 (1.7 effect-adapter.js:166-186, turns.js:219): an afraid hero may still step and strike, but any other paid
// command (wait, search, shoot, a spell, sigil, amulet, food, prayer, the stairs) is replaced by one step away from
// the fear's source (else the nearest foe); held fast or cornered, the turn is spent trapped.
export const FEAR_REPLACES = new Set(['wait', 'search', 'shoot', 'use', 'pray', 'descend', 'ascend']);
export const TOMB_WAITS = new Set([...FEAR_REPLACES, 'move', 'provoke', 'rest', 'explore', 'equip', 'unequip']);
const NO_FLEE = new Set([T.CHASM, T.PORTAL, T.EXIT, T.STAIRS, T.STAIRS_UP]);
export function fearAction(state, p, events) {
  const id = Object.keys(p.statuses ?? {}).find(k => statusRow(k).tags?.includes('fear'));
  if (!id) return null;
  const row = statusRow(id), st = p.statuses[id];
  let from = st.source && state.actors[st.source]?.hp > 0 ? state.actors[st.source] : null;
  if (!from) from = state.order.map(k => state.actors[k]).filter(a => a?.side === 'foe' && a.hp > 0).sort((a, b) => cheb(p, a) - cheb(p, b))[0] ?? null;
  const f = state.floor;
  let best = null, value = from ? cheb(p, from) : Infinity;
  if (from && !blocks(p, 'move')) for (const [dx, dy] of D8) {
    const x = p.x + dx, y = p.y + dy;
    if (!walkable(f, x, y) || bodyAt(state, x, y) || NO_FLEE.has(tileAt(f, x, y))) continue;
    if (dx && dy && !walkable(f, p.x + dx, p.y) && !walkable(f, p.x, p.y + dy)) continue;
    const d = cheb({ x, y }, from);
    if (d > value) { value = d; best = { dx, dy }; }
  }
  if (!best) { events.push({ type: 'log', words: row.log?.trapped ?? 'Fear: trapped.', cls: 'c-info' }); return 'act'; }
  events.push({ type: 'log', words: row.log?.retreat ?? 'Fear: retreat.', cls: 'c-info' });
  return resolveMove(state, p, best.dx, best.dy, events);
}

/**
 * The player's move: a bump attack, a door opened, a step, or a refusal (no time passes). The result is a kind
 * ('move', 'act', 'free', 'refused') or { kind, attack, loud } for the scheduler (C13: one result shape).
 */
export function resolveMove(state, p, dx, dy, events) {
  const x = p.x + dx, y = p.y + dy;
  // CB30 (1.7 systems.js:24-25, :36): a direction pressed while frozen or stunned spends the turn and says why; rooted,
  // a step does (a blow still lands).
  const held = what => Object.keys(p.statuses ?? {}).map(id => statusRow(id)).find(r => (r.blocksPlayer ?? r.blocks)?.includes(what) && r.log?.blockedPlayer)?.log.blockedPlayer;
  const spend = words => { if (dx) events.push({ type: 'face', id: p.id, dx: Math.sign(dx) }); events.push({ type: 'log', words }); return 'act'; };
  if (blocks(p, 'move') && blocks(p, 'melee') && held('melee')) return spend(held('melee'));
  const other = bodyAt(state, x, y);
  if (other && other.side === 'foe') {
    if (blocks(p, 'melee')) { events.push({ type: 'refused', id: p.id, why: 'cannot-attack' }); return 'refused'; }
    weaponAttack(state, p, other, events);
    offHandSwing(state, p, other, events);
    if (state.hero) state.hero.lastAttacked = other.id;   // Double Strike follows the foe last attacked
    return melee(state);
  }
  // CB03 (1.7 reach.js): a spear reaches 2 tiles in a line. Moving toward a seen foe exactly 2 away, over open, empty
  // ground, strikes it from there; the off hand does not follow.
  const far = !other && reachFoe(state, p, dx, dy);
  if (far) {
    if (blocks(p, 'melee')) { events.push({ type: 'refused', id: p.id, why: 'cannot-attack' }); return 'refused'; }
    weaponAttack(state, p, far, events, { label: null });
    if (state.hero) state.hero.lastAttacked = far.id;
    return { kind: 'act', loud: true };   // E31: an attack, for Lightning Reflexes
  }
  if (blocks(p, 'move') && held('move')) return spend(held('move'));
  if (blocks(p, 'move')) { events.push({ type: 'refused', id: p.id, why: 'cannot-move' }); return 'refused'; }
  // Walking into one of the hero's allies swaps places with it (1.7).
  if (other && other.side === 'ally' && !blocks(other, 'move')) {
    observeMove(state, { x, y }, events);   // EP13: hunters in sight see which way he went
    const from = { x: p.x, y: p.y };
    other.x = p.x; other.y = p.y; p.x = x; p.y = y;
    events.push({ type: 'moved', id: other.id, from: { x, y }, to: from }, { type: 'moved', id: p.id, from, to: { x, y } });
    enterTile(state, events);
    return 'move';
  }
  // A neutral body answers a bump itself (set-pieces.js BODY_USES: the hungry spider's confirm); unanswered, it blocks.
  if (other && other.side === 'neutral') for (const use of BODY_USES) { const r = use(state, other, events); if (r) return r; }
  // Realm and plane bumps: the void, plane lava, the Crucible gates, the Forge of the Elements (src/engine/realm.js).
  const rb = realmBump(state, p, x, y, events);
  if (rb) return rb;
  const f = state.floor, k = y * f.w + x, h = state.hero;
  for (const bump of BUMPS) { const r = bump(state, p, x, y, events, { f, k, h, other }); if (r) return r; }
  // Props 104: walking into a breakable prop breaks it (an action).
  // Something lying on the tile (rules/set-pieces.js TILE_USES: a Crypt corpse is smashed, the hero stays put).
  for (const use of other ? [] : TILE_USES) { const r = use(state, x, y, events); if (r) return r; }
  // A prop with its own use (rules/set-pieces.js PROP_USES: the Crypt's funeral bell) answers the bump itself.
  const usable = !other && f.props.find(q => q.x === x && q.y === y && PROP_USES[q.id]);
  if (usable) return PROP_USES[usable.id](state, usable, events);
  if (!other && breakProp(state, x, y, events, { by: p.id })) return 'act';
  // I69: walking into a chest opens it; it costs the action.
  if (tileAt(state.floor, x, y) === T.CHEST && openChest(state, x, y, events)) return 'act';
  // CB48 (1.7 systems.js:57): walking into a plain wall from a hidden door's tell says a draft comes through.
  if (!other && tileAt(f, x, y) === T.WALL && f.ground?.[p.y * f.w + p.x] === G.TELL) events.push({ type: 'log', words: 'A draft whispers through the stones here. Something is behind this wall.', cls: 'c-info' });
  if (isWall(state.floor, x, y) || other) { events.push({ type: 'blocked', id: p.id, at: { x, y } }); return 'refused'; }
  observeMove(state, { x, y }, events);   // EP13 (1.7 systems.js:62 observeMove): before the step, while they still see him
  if (tryStep(state, p, dx, dy, events)) {
    enterTile(state, events);
    realmStepped(state, events);
    stairsHint(state, events);
    // W51: stepping on the open gate goes down (the last floor's gate ends the run in victory: later).
    if (tileAt(state.floor, p.x, p.y) === T.EXIT && state.floor.exitOpen) state.pendingGate = true;
  }
  return 'move';
}

/**
 * WC2 (1.7 systems.js:146, floors.js:140 entryUpstairsHint): stepping onto stairs says where they go and how, in kill
 * gold, touch words on touch (log-text.js). A Realm current or the treasure room's stairs say their own (engine/realm.js).
 */
function stairsHint(state, events) {
  const f = state.floor, p = state.actors[state.playerId], t = tileAt(f, p.x, p.y), cu = f.chaos?.currents;
  if ((t !== T.STAIRS && t !== T.STAIRS_UP) || f.treasureRoom) return;
  if (cu && [cu.up, cu.down].some(q => q && q.x === p.x && q.y === p.y)) return;
  const down = t === T.STAIRS, n = state.floorNo + (down ? 1 : -1);
  if (!down && n < 1) return;
  events.push({ type: 'log', words: `${down ? 'Down' : 'Up'} to floor ${n}: ${down ? '>' : '<'} or click.`, touch: `${down ? 'Down' : 'Up'} to floor ${n}: tap stairs.`, kill: true });
}
