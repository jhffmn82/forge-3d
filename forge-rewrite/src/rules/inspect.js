// What a search names (consolidation C4; ui-04, engine-rules-23): H11 (1.7 ui.js logSearchInspection) as a rules
// function over the state and data, so the search log is the same headless and on the page. The map cards
// (ui/hud/map-hover.js) read their titles, tile names and the Realm's ways from here too.

import gods from '../../data/gods.json' with { type: 'json' };
import planes from '../../data/planes.json' with { type: 'json' };
import traps from '../../data/traps.json' with { type: 'json' };
import { T, tileAt } from '../data/tiles.js';
import { litAt } from './sight.js';
import { itemName } from './item-names.js';
import { itemRow } from './items.js';

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** H08: a crystal vault's treasure names only its kind until it is taken (1.7 inspectItemHTML it.crystal). */
export const CRYSTAL_TYPE = { weapon: 'Weapon', armour: 'Armor', offhand: 'Off-hand equipment', ring: 'Ring', amulet: 'Amulet', sigil: 'Sigil', essence: 'Essence', mote: 'Elemental mote', food: 'Food', key: 'Key' };
/** 1.7 inspectTileHTML: the tiles that have a card, and their names. */
export const TILE_NAMES = { 2: 'Closed door', 3: 'Stairs down', 4: 'Chest', 5: 'Elemental Forge', 7: 'Open door', 9: 'Locked iron door', 10: 'Shrine', 11: 'Ice-sealed door',
  12: 'Thorn-choked doorway', 13: 'The gate onward', 14: 'Spiked door', 18: 'Sealed door', 19: 'Stairs up', 20: 'Portal' };
export const WALK_TILES = [2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 18, 19, 20];

const rowOrNull = id => { try { return itemRow(id).row; } catch { return null; } };

/**
 * Item 290 (Justin 2026-10-20: "does it not understand that you shouldnt see what it;s the crystal?"): a crystal vault's
 * treasure lies sealed in the crystal on its cell (rule 55; puzzles.js itemTaken shatters the crystals when one is taken):
 * the map draws the crystal and not the treasure, and its card names only the kind inside.
 */
export const sealedTreasure = (floor, i) => !!i?.crystal && (floor?.props ?? []).some(q => q.crystalVault && q.x === i.x && q.y === i.y);

/** A floor item's card title (1.7 itemLabel): the floor words with a capital; a crystal vault's piece by its kind only. */
export function itemTitle(s, it, entry = null) {
  if (entry?.crystal) return CRYSTAL_TYPE[it.kind] ?? 'Treasure';
  if (['heart', 'globe', 'essence', 'mote', 'key', 'core', 'relic', 'sigil'].includes(it.kind)) return cap(itemName(it, s));
  const row = rowOrNull(it.id);
  if (!row) return it.name ?? it.id;
  return itemName({ kind: row.kind, ...it, tier: it.tier ?? 0 }, s);
}

/** H10: the Realm's own ways on: currents, the gateway home, island portals, the treasure room's portal, the Crucible. */
export function chaosWay(s, x, y, t) {
  const f = s.floor, n = s.floorNo ?? 0, cu = f.chaos?.currents, at = q => q && q.x === x && q.y === y;
  if (cu && n === 21 && cu.materialGate && at(cu.up) && t === T.PORTAL) return { title: 'Portal to the Material Plane', hint: 'This elemental gateway leads back to the treasure room beneath floor 20. The way to Chaos remains open.' };
  const dir = cu && at(cu.down) ? 1 : cu && at(cu.up) && !(n === 21 && cu.materialGate) ? -1 : 0;
  if (dir) { const name = n + dir === 20 ? 'the treasure room' : 'floor ' + (n + dir); return { title: 'Current to ' + name, hint: `A magical current will carry you through the void to ${name}.` }; }
  const isle = t === T.PORTAL && (f.chaos?.portals ?? []).find(q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
  if (isle) return { title: isle.label ?? 'Portal', hint: 'A two-way portal to another island on this floor. Step onto it to travel.' };
  if (f.treasureRoom && t === T.PORTAL) return { title: 'Portal to the Realm of Chaos', hint: 'Leads to floor 21. Gather the supplies before stepping through; there are no god shrines beyond this room.' };
  const c = f.crucible;
  if (c) {
    const on = g => g && y === g.y && x >= g.x && x < g.x + g.w;
    if (on(c.rearSeal)) return { title: 'Gate of the Elements', hint: c.walkthrough ? 'Raised for the sandbox layout walkthrough; no victory has been recorded.' : c.phase === 'defeated' ? 'The Unmaker is defeated. The way to the Forge of the Elements is open.' : 'Sealed until the Unmaker is defeated.' };
    if (on(c.entryGate)) return { title: "The Unmaker's entrance gate", hint: c.walkthrough ? 'Raised for the sandbox layout walkthrough; no victory has been recorded.' : c.phase === 'active' ? 'Sealed until the Unmaker falls.' : c.phase === 'ready' ? 'Open this gate to face the Unmaker. It seals behind you.' : 'The entrance gate is raised.' };
  }
  return null;
}

/** A tile's card title, or null for terrain without a card: the Realm's ways, then the named tiles (chests, the shrine's god, a plane's portal). */
export function tileTitle(s, x, y) {
  const f = s.floor, t = tileAt(f, x, y), way = chaosWay(s, x, y, t);
  if (way) return way.title;
  if (!WALK_TILES.includes(t)) return null;
  let title = TILE_NAMES[t];
  const chest = t === T.CHEST ? (f.chests ?? []).find(c => c.x === x && c.y === y) : null;
  if (chest?.kind === 'gold') title = 'Gold chest';
  if (chest?.table === 'chest-enhanced' || chest?.enhanced) title = 'Enhanced gold chest';
  if (t === T.SHRINE) { const g = f.shrine?.god ?? s.run?.shrine?.god; if (gods.rows[g]) title = `Shrine to ${gods.rows[g].name}`; }
  if (t === T.PORTAL && f.portal?.plane) title = `Portal to ${planes.rows['plane-' + f.portal.plane]?.name ?? f.portal.plane}`;
  return title;
}

/**
 * H11 (1.7 ui.js logSearchInspection): the names a search lists, nearest first (ties in 1.7's order: creatures, floor
 * items, found traps, crates and barrels, then usable tiles), within radius r of the hero, on tiles in sight only.
 * A creature over several tiles is named once, at its nearest tile. Read-only.
 */
export function searchInspection(s, r = 2) {
  const p = s?.actors?.[s.playerId], f = s?.floor;
  if (!p || !f) return [];
  const out = [], d = (x, y) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
  const ok = (x, y) => litAt(s, x, y) && d(x, y) <= r;
  const add = (x, y, name) => { if (name) out.push({ d: d(x, y), i: out.length, name }); };
  for (const id of s.order ?? []) {
    const a = s.actors[id], n = a?.size ?? 1;
    if (!a || id === s.playerId || a.hp <= 0 || a.hidden || a.parent) continue;
    let best = null;
    for (let y = a.y; y < a.y + n; y++) for (let x = a.x; x < a.x + n; x++) if (ok(x, y) && (!best || d(x, y) < best.d)) best = { x, y, d: d(x, y) };
    if (best) add(best.x, best.y, a.name);
  }
  for (const e of f.items ?? []) if (e && ok(e.x, e.y)) add(e.x, e.y, itemTitle(s, e.item, e));
  for (const t of f.traps ?? []) if (t.found && ok(t.x, t.y)) add(t.x, t.y, `${traps.rows[t.kind]?.name ?? cap(t.kind)} trap`);
  for (const q of f.props ?? []) if (!q.part && !q.broken && /(^|-)(crate|barrel)(-|$)/.test(q.id) && ok(q.x, q.y)) add(q.x, q.y, cap(q.id === 'barrel-explosive' ? 'powder barrel' : q.id.replace(/-\d+$/, '').replace(/-/g, ' ')));
  for (let y = p.y - r; y <= p.y + r; y++) for (let x = p.x - r; x <= p.x + r; x++) if (ok(x, y)) add(x, y, tileTitle(s, x, y));
  return out.sort((a, b) => a.d - b.d || a.i - b.i).map(e => e.name);
}
