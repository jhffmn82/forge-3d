// What the map says under the pointer, as 1.7 said it (Justin 2026-10-16, sandbox items 57 and 63: "there used to be hover
// over icons for move, attack, break etc in 1.7", "no tool tip over it when i mouse over"; "i want it done how 1.7 did it").
//  - mapIntent: 1.7 travel.js clickIntent, the cursor's case (the bow's shoot case and the click spell's cast case too).
//  - mapClick: 1.7 handleMapClick, what the click then does: a blow (beside, or a spear's reach at 2), a shot, or a
//    walk over known ground (travelPath) with what to do on arrival (pick up, go down or up, bump the lever or prop).
//  - cursorFor: 1.7's cursor, the case's glyph drawn on a 32 px canvas.
//  - the map card (1.7 ui.js inspectHTML) is map-cards.js (consolidation H6, ui-24); the lookups below are shared with it.
// No Pixi here, so it runs in Node tests (cursorFor needs a document and returns null without one).

import { T, tileAt, walkable } from '../../data/tiles.js';
import props from '../../../data/props.json' with { type: 'json' };
import { litAt, seenAt, abilityRow, aimRange, doorClosable, AUTO, canShoot, canShootProp, trueForgeAt, usedOnBump } from '../../engine/reads.js';
import { cheb, covers, footprintGap } from '../../lib/geometry.js';
import { travelPath } from '../../engine/travel.js';
import { reachFoe } from '../../engine/bump.js';

export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------------------------------------------------------------- the cursor (1.7 travel.js cursorFor) */
const GLYPH = { close: '\u{1F6AA}', door: '\u{1F6AA}', break: '\u{1F528}', move: '\u{1F463}', grab: '\u{1F392}', stairs: '\u{1FA9C}', upstairs: '\u{1FA9C}', portal: '\u{1F300}', shoot: '\u{1F3F9}', cast: '✨', attack: '⚔️', use: '\u{1F449}', inspect: '\u{1F50D}', exit: '\u{1F6AA}' };
const CURSORS = {};
export function cursorFor(kind) {
  if (CURSORS[kind] !== undefined) return CURSORS[kind];
  const glyph = GLYPH[kind];
  if (!glyph || typeof document === 'undefined') return (CURSORS[kind] = null);
  try {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.font = '18px "IBM Plex Mono",monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';   // 80% of 1.7's first pass, so every icon reads the same size
    g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 3; g.fillText(glyph, 16, 17);
    CURSORS[kind] = `url(${c.toDataURL()}) 16 16, pointer`;
  } catch { CURSORS[kind] = null; }
  return CURSORS[kind];
}

/* ---------------------------------------------------------------- what is where */
export const known = seenAt, inSight = litAt;
/** A living body on the tile (a big one over its whole footprint), not hidden. */
export function bodyAt(s, x, y) {
  for (const id of s.order ?? []) {
    const a = s.actors[id];
    if (a && a.hp > 0 && id !== s.playerId && !a.hidden && covers(a, x, y)) return a;
  }
  return null;
}
// 1.7 kept one prop a tile; here flat decoration can share a tile with an object, so the object answers.
const weight = p => { const r = props.rows[p.id] ?? {}; return /^lever/.test(p.id) || r.breakable || r.altar || r.drinkable || r.bush ? 3 : r.blocks ? 2 : r.flat ? 0 : 1; };
export const propAt = (s, x, y) => (s.floor.props ?? []).filter(p => p.x === x && p.y === y && !p.broken).sort((a, b) => weight(b) - weight(a))[0] ?? null;
export const propRow = p => (p ? props.rows[p.id] ?? {} : {});
export const itemsAt = (s, x, y) => (s.floor.items ?? []).filter(e => e && e.x === x && e.y === y);

/** 1.7 entityPoint: the tile of a body's footprint nearest the hero (a big body is reached at its near edge). */
function nearPoint(a, p) {
  const n = a.size ?? 1;
  return { x: Math.max(a.x, Math.min(a.x + n - 1, p.x)), y: Math.max(a.y, Math.min(a.y + n - 1, p.y)) };
}
const gap = (p, a) => footprintGap(a, p);
/** 1.7 reachDir: the step toward a foe exactly 2 away in a straight line that a spear strikes from here, or null. */
function reachStep(s, p, a) {
  const q = nearPoint(a, p), ex = q.x - p.x, ey = q.y - p.y;
  if (Math.max(Math.abs(ex), Math.abs(ey)) !== 2 || ex % 2 || ey % 2) return null;
  const dx = ex / 2, dy = ey / 2;
  return reachFoe(s, p, dx, dy) === a ? { dx, dy } : null;
}

/** T7 (1.7 travel.js clickSpellReady): the click spell set from the hotbar is known and this foe is in its reach. */
function clickSpellReady(s, p, foe) {
  const h = s.hero, id = h?.clickSpell, row = id && (h.abilities ?? []).includes(id) ? abilityRow(id) : null;
  return !!row && gap(p, foe) <= Math.max(1, aimRange(h, row));
}

/** CH26 (1.7 FoteUnmakerEncounter.forgeInfo): the Forge of the Elements under (x, y), lit or not, the hero beside it or not. */
function forgeAt(s, x, y) {
  if (!trueForgeAt(s.floor, x, y)) return null;
  const f = s.floor.crucible.trueForge, p = s.actors[s.playerId];
  const near = Math.max(Math.max(f.x - p.x, 0, p.x - (f.x + f.w - 1)), Math.max(f.y - p.y, 0, p.y - (f.y + f.h - 1))) <= 1;
  return { ...f, near, ready: s.floor.crucible.phase === 'defeated' };
}
/** T13 (1.7 clickIntent): the hungry spider, not yet provoked, or the Myconid Merchant or its stall. */
const spiderAt = (s, b) => (b && b.side === 'neutral' && b.hungrySpider && !b.hungrySpider.provoked ? b : null);
const merchantAt = (s, b, x, y) => (b && b.side === 'neutral' && b.merchant) || !!propAt(s, x, y)?.merchant;
/**
 * 1.7 handleMapClick's approach (travel.js:340-343, :353-354): the shortest walk to a known open cell beside the
 * footprint (x, y, w, h), none inside it; null when there is none.
 */
function approach(s, x, y, w = 1, h = 1) {
  let best = null;
  for (let ay = y - 1; ay <= y + h; ay++) for (let ax = x - 1; ax <= x + w; ax++) {
    if (ax >= x && ax < x + w && ay >= y && ay < y + h) continue;
    if (!known(s, ax, ay) || !walkable(s.floor, ax, ay) || bodyAt(s, ax, ay) || trueForgeAt(s.floor, ax, ay)) continue;
    const r = travelPath(s, ax, ay);
    if (r?.length && (!best || r.length < best.length)) best = r;
  }
  return best;
}
const besideHero = (p, x, y) => cheb(p, { x, y }) === 1;

/** 1.7 clickIntent, for the rewrite's click: the case the cursor shows over (x, y), or null. */
export function mapIntent(s, x, y) {
  const p = s?.actors?.[s.playerId];
  if (!p || p.hp <= 0 || !s.floor || !known(s, x, y)) return null;
  const foe = inSight(s, x, y) ? bodyAt(s, x, y) : null;
  if (foe && foe.side === 'foe') return clickSpellReady(s, p, foe) ? 'cast' : gap(p, foe) <= 1 || reachStep(s, p, foe) ? 'attack' : canShoot(s, foe) ? 'shoot' : 'move';
  if (spiderAt(s, foe)) return 'hungry-spider';
  if (merchantAt(s, foe, x, y)) return 'merchant';
  const forge = forgeAt(s, x, y);
  if (forge) return forge.ready ? 'use' : 'inspect';
  const t = tileAt(s.floor, x, y);
  // ui-08: the step takes the auto kinds (rules/pickup.js AUTO), so a click there is a plain walk. Item 96: underfoot,
  // one still lying was never stepped on (a sandbox teleport, a drop), and a tap takes it as Pick up does; a heart or
  // globe there waits for its bar (1.7: walked over, not grabbed).
  const lying = itemsAt(s, x, y), grab = lying.some(e => !AUTO.includes(e.item?.kind));
  if (x === p.x && y === p.y) {
    if (lying.some(e => !['heart', 'globe'].includes(e.item?.kind))) return 'grab';
    if (t === T.STAIRS) return 'stairs';
    if (t === T.STAIRS_UP) return 'upstairs';
    if (t === T.PORTAL) return 'portal';   // CH25: a portal underfoot offers its trip again
    return null;
  }
  if (t === T.STAIRS) return 'stairs';
  if (t === T.STAIRS_UP) return 'upstairs';
  const pr = propAt(s, x, y), row = propRow(pr);
  if (pr && /^lever/.test(pr.id)) return pr.used ? 'inspect' : 'use';
  if (pr?.prisoner) return 'use';   // item 160 (Justin 2026-10-18): a caged prisoner is freed by a click, as by a bump
  if (pr && canShootProp(s, x, y)) return 'shoot';   // CB02 (1.7 travel.js:87): a bow shoots a crate across the room
  if (pr && row.breakable) return 'break';
  if (t === T.EXIT) return s.floor.exitOpen ? 'exit' : 'use';
  if ([T.DOOR, T.OPEN_DOOR, T.LOCKED, T.SEALED, T.ICE_DOOR, T.THORNS, T.TOLL].includes(t)) return 'door';
  if ([T.CHEST, T.SHRINE, T.FORGE].includes(t)) return 'use';
  if (grab) return 'grab';
  // Item 306 (Justin 2026-10-21: "you have to bump into it to interact, click won't work"): anything a walk-in uses (the
  // elemental lock, an altar, a shrine's bowl, a fountain: explore.js usedOnBump) is the click's to use too.
  if (usedOnBump(s, x, y)) return 'use';
  if (walkable(s.floor, x, y) && !(pr && row.blocks)) return 'move';   // 1.7 walkable(): a blocking prop is not ground
  return null;
}

/**
 * 1.7 handleMapClick (travel.js:308-376): what a click or tap on (x, y) does, as a plan for main.js to carry out:
 *  { command }        play it now (a blow on a foe beside the hero, a shot, pick up, stairs underfoot, a bump);
 *  { path, then }     walk the route a step a turn (engine/travel.js), then play `then` if the hero is where it says;
 *  { say }            a line for the log ("You can't find a way there.");
 *  null               nothing to do.
 */
export function mapClick(s, x, y) {
  // H33 (1.7 travel.js handleMapClick): in the sandbox's Map mode a click moves the hero straight to the tile, or the
  // nearest free one within 2.
  if (s?.sandbox?.mapMode) return { command: { type: 'sandbox', action: 'teleport', x, y, near: true } };
  const it = mapIntent(s, x, y), p = s?.actors?.[s.playerId];
  if (!it || !p || it === 'inspect') return null;
  const foe = inSight(s, x, y) ? bodyAt(s, x, y) : null;
  if (foe && foe.side === 'foe') {
    const q = nearPoint(foe, p);
    if (it === 'attack') return { command: { type: 'move', dx: Math.sign(q.x - p.x), dy: Math.sign(q.y - p.y) } };   // beside, or a spear's reach at 2
    if (it === 'shoot') return { command: { type: 'shoot', id: foe.id } };
    // T7 (1.7 castClickSpell): the click spell at the tapped cell of the foe's body; the engine checks mana and cooldown.
    if (it === 'cast') return { command: { type: 'use', ability: s.hero.clickSpell, at: { x, y } } };
    const path = travelPath(s, q.x, q.y, { stopAdjacent: true });   // walk toward it; the walk ends beside it
    return path?.length ? { path } : { say: "You can't find a way there." };
  }
  // CH26 (1.7 travel.js:336-347): the lit Forge of the Elements beside the hero is touched (its question, engine/realm.js);
  // from across the room the hero walks to the nearest open cell beside it.
  const forge = forgeAt(s, x, y);
  if (forge) {
    if (forge.near) {
      const q = { x: Math.max(forge.x, Math.min(forge.x + forge.w - 1, p.x)), y: Math.max(forge.y, Math.min(forge.y + forge.h - 1, p.y)) };
      return { command: { type: 'move', dx: q.x - p.x, dy: q.y - p.y } };
    }
    const path = approach(s, forge.x, forge.y, forge.w, forge.h);
    return path ? { path } : { say: "You can't find a way to the Forge." };
  }
  // T13 (1.7 travel.js:351-355): the hungry spider or the merchant beside the hero is bumped (its question or the stock);
  // from afar the hero walks up beside it first.
  if (it === 'hungry-spider' || it === 'merchant') {
    if (besideHero(p, x, y)) return { command: { type: 'move', dx: x - p.x, dy: y - p.y } };
    const path = it === 'merchant' ? approach(s, x, y) : travelPath(s, x, y, { stopAdjacent: true });
    return path?.length ? { path, then: { beside: { x, y } } } : { say: "You can't find a way there." };
  }
  // CB29 (1.7 boot.js:316-321): a click on an empty open door beside the hero shuts it; one with something in it walks.
  if (it === 'door' && doorClosable(s, x, y)) return { command: { type: 'close-door', x, y } };
  const here = x === p.x && y === p.y;
  // CH25: a tap on the portal the hero stands on (the treasure room's, an island's, floor 21's gateway, a plane's) asks
  // its question again (engine/realm.js realmStepped) instead of waiting a turn.
  if (here) return it === 'grab' ? { command: { type: 'pickup' } } : it === 'stairs' ? { command: { type: 'descend' } } : it === 'upstairs' ? { command: { type: 'ascend' } } : it === 'portal' ? { command: { type: 'realm', action: 'prompt' } } : null;
  if (it === 'shoot') return { command: { type: 'shoot', at: { x, y } } };   // CB02: an arrow at a breakable prop
  // Anything a walk-in uses (a lever, a caged prisoner, the elemental lock, an altar) or breaks: beside the hero the
  // click bumps it, as the key would (item 306); from afar the hero walks up beside it, then bumps it.
  if ((it === 'use' && usedOnBump(s, x, y)) || it === 'break') {
    const bump = { beside: { x, y } };
    if (besideHero(p, x, y)) return { command: { type: 'move', dx: x - p.x, dy: y - p.y } };
    const path = travelPath(s, x, y, { stopAdjacent: true });
    return path?.length ? { path, then: bump } : { say: "You can't find a way there." };
  }
  // Item 307 (Justin 2026-10-21: "you should be able to pick up an item you are next to with a click without having to
  // be on top of it"): beside the hero, the click takes it where it lies, as Pick up does underfoot.
  if (it === 'grab' && besideHero(p, x, y)) return { command: { type: 'pickup', at: { x, y } } };
  const path = travelPath(s, x, y);
  if (!path && it === 'grab') {
    const near = travelPath(s, x, y, { stopAdjacent: true });
    if (near?.length) return { path: near, then: { beside: { x, y }, command: { type: 'pickup', at: { x, y } } } };
  }
  if (!path) return { say: "You can't find a way there." };
  const then = it === 'grab' ? { command: { type: 'pickup' }, at: { x, y } } : it === 'stairs' ? { command: { type: 'descend' }, at: { x, y } } : it === 'upstairs' ? { command: { type: 'ascend' }, at: { x, y } } : null;
  return { path, then };   // doors, chests, shrines, the Forge: the last step bumps them
}

/** On arrival: the command a walk's `then` asks for, if the hero ended where it needs (on the tile, or beside it). */
export function arrivalCommand(s, then) {
  const p = s?.actors?.[s.playerId];
  if (!then || !p) return null;
  if (then.at) return p.x === then.at.x && p.y === then.at.y ? then.command : null;
  if (then.beside) {
    const dx = then.beside.x - p.x, dy = then.beside.y - p.y;
    return besideHero(p, then.beside.x, then.beside.y) ? then.command ?? { type: 'move', dx, dy } : null;
  }
  return then.command ?? null;
}

/**
 * 1.7 travel.js tileAt: a body is drawn a third of a tile up, so its head covers the lower third of the tile above. A
 * point there (below is the tile a third of a tile lower) means that body, unless the upper tile has one of its own.
 */
export function liftedTile(s, t, below) {
  if (!s?.floor || !t || !below || below.y !== t.y + 1) return t;
  const seen = (x, y) => inSight(s, x, y) && (bodyAt(s, x, y) || (s.actors[s.playerId]?.x === x && s.actors[s.playerId]?.y === y));
  return !seen(t.x, t.y) && seen(t.x, t.y + 1) ? { x: t.x, y: t.y + 1 } : t;
}
