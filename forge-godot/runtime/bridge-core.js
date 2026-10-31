// The game itself, for the 3D build: the 2D game's engine (forge-rewrite src/engine), unchanged, and its windows
// (ui.js), behind one call, serve(request) -> reply. bridge.js serves it to Godot's PC build from QuickJS, a JSON line
// in and out; web.js serves it to the browser build from a worker. The engine changes all the state; Godot only shows it.
//   {op: "new", seed, hero, store, vw, vh}  a new run               -> {view, floor, log, recent, ui?, uiState}
//   {op: "step", cmd}                       one command             -> {events, log, recent, view, floor?, ui?, uiState}
//   {op: "ui", ev: {...}}                   the windows (ui.js)     -> {ui?, uiState, cursor, walk?, events?, log?, view?...}
// view: what the screen needs each turn (the bodies, the hero's bars, sight, the floor's tiles and loot); floor: the whole
// floor when it changes, in the shape tools/export-floor.html writes (Level.from_dict); ui: the windows' drawing when it
// changed (ui.js frame). While answering, the bridge may ask Godot things first ({ask: ...} lines, answered a line each):
// how wide some words are in a font, a font's box, a picture's size.

import { createGame, step } from '../../forge-rewrite/src/engine/game.js';
import { logLines, flushLog, floorIntro } from '../../forge-rewrite/src/ui/screens/log-text.js';
import { xpView, hungerView, statusList, barOf, slotCommand, pietyView, shieldsOf, itemsHere } from '../../forge-rewrite/src/ui/model/hud-model.js';
import { cooldownFracs } from '../../forge-rewrite/src/ui/hud/slot-face.js';
import { heroView, whoLine } from '../../forge-rewrite/src/ui/model/hero-view.js';
import { tone } from '../../forge-rewrite/src/ui/core/look.js';
import { itemArtName } from '../../forge-rewrite/src/render/art.js';
import { entryView, slotTint, sigilPulse } from '../../forge-rewrite/src/ui/hud/hotbar-model.js';
import { createRecentLog } from '../../forge-rewrite/src/ui/hud/recent-log.js';
import { depthLine, bodyKey } from '../../forge-rewrite/src/ui/model/hud-model.js';
import { color } from '../../forge-rewrite/src/ui/core/widgets.js';
import tuning from '../../forge-rewrite/data/tuning.json' with { type: 'json' };
const TURN_UNITS = tuning.rows.clock.unitsPerGameTurn;
import { createTraveller } from '../../forge-rewrite/src/engine/travel.js';
import { mapClick, arrivalCommand } from '../../forge-rewrite/src/ui/hud/map-hover.js';
import { doorClosable, aimArea, litAt, seenAt, sealedTreasure } from '../../forge-rewrite/src/engine/reads.js';
import { aimFor, markRect, boltDots, bowNextTarget, bowCanHit } from '../../forge-rewrite/src/ui/hud/aim.js';
import { cheb, covers } from '../../forge-rewrite/src/lib/geometry.js';
import { layField, ignite } from '../../forge-rewrite/src/rules/fields.js';
import { createEvents, sfxLevel, distanceGain } from '../../forge-rewrite/src/audio/cues.js';
import { tuneFor, ambienceFor, bossTuneFor } from '../../forge-rewrite/src/audio/scene.js';
import { setSounds, soundFiles } from '../../forge-rewrite/src/audio/sound-list.js';
import { synthRecipe } from '../../forge-rewrite/src/audio/synth.js';
import audioData from '../../forge-rewrite/data/audio.json' with { type: 'json' };
import uiData from '../../forge-rewrite/data/ui.json' with { type: 'json' };
import { readText } from './io.js';
import { startWalk, walkNext } from '../../forge-rewrite/src/rules/auto.js';
import { lookTurn, standing } from './fx-plans.js';
import { createUiHost, setAsker } from './ui.js';
import { heroArt, heroArtKey } from './hero-art.js';
import { buildCaveField } from '../../forge-rewrite/src/render/cave-field.js';
import { surfaceSalt } from '../../forge-rewrite/src/lib/noise.js';
import { CAVE_ROCK, DEEP_ROCK, ROCK } from '../../forge-rewrite/src/data/rock.js';

// The HUD's log as the 2D game keeps it (src/ui/hud/recent-log.js): the last three commands that said something,
// a repeat as "xN", pick-ups gathered; its warning inks never merge (src/ui/screens/hud.js WARN).
const recent = createRecentLog({ later: fn => fn() });
const WARN = new Set([0xc8382e, 0xff5a6a, color.hp]);
function hear(lines) {
  for (const l of lines) recent.add(l.words, l.fill, { warning: WARN.has(l.fill), marks: l.marks });
  host?.heard(lines);   // the run's whole log, for the Combat log window and a window's notice (ui.js heard)
}

let state = null;
let floorKey = null;   // the floor object the scene was last sent (a plane's keeps its host's number and seed)
let host = null;
let gfxSent = 0;   // the 3D look's change Godot has (uiOut)
let marksSent = -1;   // the targeting marks' change Godot has (uiOut)
let uiWhole = false;   // Godot missed a frame of the windows' drawing: the next is sent whole (game.gd _take_ui)

const plain = v => (ArrayBuffer.isView(v) ? Array.from(v) : v);
const bits = a => (a ? Array.from(a, v => (v ? '1' : '0')).join('') : '');
const chars = a => String.fromCharCode(...Array.from(a, v => 48 + v));

function floorOut() {
  const f = state.floor, o = {};
  for (const [k, v] of Object.entries(f)) o[k] = plain(v);
  const p = state.actors[state.playerId];
  return { seed: state.floorSeed, floorNo: state.floorNo, start: { x: p.x, y: p.y }, floor: o, creatures: [] };
}

// What the 2D game draws over a body and how it poses it, read off its state (render/status-badges.js, map-bodies.js,
// map-overlays.js, ward-view.js), for scripts/badges.gd and dressing.gd.
import statusRows from '../../forge-rewrite/data/statuses.json' with { type: 'json' };
import monsterRows from '../../forge-rewrite/data/monsters.json' with { type: 'json' };
import { tileAt as tileOf, T as TILE, isWallTile } from '../../forge-rewrite/src/data/tiles.js';
import { objectMark, propMark, itemMark, trapMark, actorMark } from '../../forge-rewrite/src/render/looks/blocks.js';
const ROWS = statusRows.rows, MON = monsterRows.rows ?? {};
// status-badges.js shown(): every status it bears in the order it took them, immunities aside, each with its icon.
const chipsOf = a => Object.keys(a.statuses ?? {}).filter(k => !k.startsWith('imm-') && ROWS[k]?.icon).map(k => [k, ROWS[k].icon]);
// map-bodies.js flameCharged (RC4): its every-Nth move fires on its next use.
const chargedOf = a => (MON[a.kind]?.moves ?? []).some(m => m.alsoEveryNth && ((a.moveUses?.[m.id] ?? 0) % m.alsoEveryNth.n) === m.alsoEveryNth.n - 1);

function bodies() {
  const out = [];
  for (const id of state.order) {
    const a = state.actors[id];
    if (!a || id === state.playerId) continue;
    const own = MON[a.kind]?.look ?? {}, st = a.statuses ?? {}, lens = st.chaoslens;
    // its look, with its monster row's glow where it has one (lights.js creature-glow: the Spark Jelly's, scripts/life.gd)
    out.push({ id, kind: a.kind, name: a.name, x: a.x, y: a.y, hp: a.hp, maxhp: a.maxhp, side: a.side,
      look: a.look ? { ...a.look, ...(own.glow ? { glow: own.glow } : {}) } : null,
      asleep: !!a.asleep, hunting: !!a.hunting, boss: !!a.boss,
      // its '!' over it while its noticing her is news (render/status-badges.js: caughtOff this action; play.gd _sync_marks)
      alert: a.side === 'foe' && !!a.hunting && !a.asleep && !a.boss && !(a.flags ?? []).includes('boss') && a.caughtOff === state.actions, size: a.size ?? 1, statuses: Object.keys(a.statuses ?? {}),
      flags: (a.flags ?? []).filter(f => f === 'flying' || f === 'hover'),   // (dressing.gd: fliers off the floor)
      // unseen though its tile is in sight: a Stalker away, a burrowed Burrower, a Shade in its wall (map-sight.js V9)
      hidden: !!a.hidden,
      chips: chipsOf(a), key: !!a.key, merchant: !!a.merchant && a.side !== 'foe',
      // RC11: the hero's own Shades, grey-violet and see-through; RC10 an echo of her
      shade: a.side === 'ally' && (!!a.shade || a.kind === 'shade-swarm' || a.kind === 'shade'), echo: a.kind === 'echo',
      charged: chargedOf(a), pose: own.pose ?? null, burrower: !!own.burrower, clips: own.clips ?? null,
      // CV15: a Shock Eel in its water, faint until 2 turns after it bites; UD8: the Matron channelling her ritual
      faint: !!own.faintInWater && tileOf(state.floor, a.x, a.y) === TILE.WATER && !(a.surfacedAt !== undefined && (state.actions ?? 0) - a.surfacedAt < 2),
      channel: !!own.channels && !!a.mt?.rit, ward: !!st.boneward, tomb: !!st.tomb, inWall: a.kind === 'shade' && !!a.hidden && !!a.inWall,
      // the chaos marks (status-badges.js CH-R2 to CH-R4, EP32): the Prism Seer's next element, a Lens's source, the brace
      seer: a.kind === 'chaos-prism-seer' ? a.chaosElement ?? null : null, lens: lens?.n > 0 ? String(lens.source ?? '') : null,
      brace: !!st.chaosbrace, spore: !!st.sporecoat,
      limb: !!a.limbOf,   // a boss's limb (PT16): no body of its own in any look (map-bodies.js makeSprite)
      // the Night Warden out of the crystals' light, shrouded, or in it, glowing (plane-anim.js item 250)
      shroud: a.kind === 'nightwarden' ? (litPlane(state.floor, a) ? 'lit' : 'dark') : null });
  }
  return out;
}

// What the 2D game draws on the hero for her state (status-badges.js, map-sight.js RC16), for scripts/badges.gd: the
// shield's whole points (its pulsing bubble), Hidden (drawn at half), Stillness's and Levitate's rings, a tomb of ice.
import { shieldPools as poolsOf, litByPlaneLight as litPlane } from '../../forge-rewrite/src/engine/reads.js';
function heroOver(p) {
  const st = p.statuses ?? {};
  let shield = 0;
  try { shield = poolsOf(p).reduce((n, q) => n + Math.floor(q.n), 0); } catch (e) { shield = 0; }
  // and the cages still holding a prisoner, for their '!' while she sees them (status-badges.js RC42)
  const cages = (state.floor?.props ?? []).filter(q => q.prisoner && !q.part).map(q => [q.x, q.y]);
  // the Crypt Shamblers' corpses lying in wait (crypt-life.js lyingCorpses, rules/crypt.js A16): each body's id, and
  // whether it is about to rise (its twitch and gold '!')
  const corpses = (state.floor?.corpses ?? []).map(c => [String(c.id), !!c.twitch]);
  // calm enough for the beer (map-view.js calmNow, held.js beerHandFree: alive, no foe in sight, the off hand free)
  let calm = false;
  try {
    const w = state.floor.w, foe = state.order.some(id => { const a = state.actors[id]; return a?.side === 'foe' && a.hp > 0 && !a.hidden && state.vis?.[a.y * w + a.x]; });
    calm = p.hp > 0 && !foe && beerHandFree(state.hero);
  } catch (e) { calm = false; }
  return { calm, shield, hidden: !!st.hidden, stillness: !!st.stillness, levitate: !!st.levitate, tomb: !!st.tomb, cages, corpses };
}
import { beerHandFree } from '../../forge-rewrite/src/render/held.js';

function heroOut() {
  const p = state.actors[state.playerId], h = state.hero;
  let hv = null;
  try { hv = heroView(state); } catch (e) { hv = null; }
  let st = [];
  try { st = statusList(p, state).map(s => ({ id: s.id, name: s.name ?? s.id, turns: s.turns ?? null, icon: s.icon ?? null, stacks: s.stacks ?? 0, harmful: !!s.harmful })); } catch (e) { st = []; }
  let bar = [];
  try { bar = barOf(state).map(e => e ? { kind: e.kind, id: e.id, cmd: slotCommand(e) } : null); } catch (e) { bar = []; }
  return {
    x: p.x, y: p.y, hp: p.hp, maxhp: p.maxhp, mana: p.mana, maxmana: p.maxmana, guard: p.guard ?? 0, maxguard: p.maxguard ?? 0,
    name: h.name, race: h.race, cls: h.cls, level: h.level, look: p.look ?? null, over: heroOver(p),
    xp: xpView(h), hunger: hungerView(h.hunger), essence: h.essence ?? 0, keys: h.keys ?? 0,
    who: hv?.who ?? null, statuses: st, hotbar: bar, main: h.worn?.main?.id ?? null,
    // Light and Fire affinity: her lamp reaches further, and a dark room stays lit (render/lights.js, light-areas.js).
    affinity: { light: h.affinity?.light ?? 0, fire: h.affinity?.fire ?? 0 },
    body: bodyKey(h), points: h.points ?? 0, art: (() => { try { return heroArtKey(state); } catch (e) { return ''; } })(),
    // Each hotbar slot as the 2D HUD draws it (hotbar-model.js entryView, slotTint): its icon, its small line, whether
    // it can be used now, the turns of cooldown left, its glow; the share of its cooldown still to run (slot-face.js
    // cooldownFracs: the clock sweep), whether it is the click spell (its bullseye).
    slots: hudSlots(),
    ...hudReadouts(p, h),
  };
}

/** hotbar.js set: the bar (barOf: the default bar while the engine keeps none) and each slot's view. */
function hudSlots() {
  try {
    const bar = barOf(state), views = bar.map(e => { try { return e ? entryView(state, e) : null; } catch (err) { return null; } });
    const cd = cooldownFracs(state.hero, bar, views).fracs;
    return bar.map((e, i) => { const v = views[i]; if (!e || !v) return null; let tint = null; try { tint = slotTint(state, e, v); } catch (err) { tint = null; }
      return { icon: v.icon ?? null, name: v.name ?? '', line: v.line ?? '', ready: !!v.ready, left: v.left ?? 0, tint, cmd: slotCommand(e), cd: Math.round((cd[i] ?? 0) * 1000) / 1000, click: !!v.click }; });
  } catch (err) { return []; }
}

/** The readouts the 2D HUD adds (bars.js, portrait.js, status.js): the shields on HP's end (Guard, Ice Armor and wards
 *  together), the god's piety line, rank and favor in its colour, Wobbles' Amusement. */
function hudReadouts(p, h) {
  let f = null, shield = p.guard ?? 0;
  try { f = pietyView(h.faith); } catch (e) { f = null; }
  try { shield = shieldsOf(p).total; } catch (e) { /* Guard alone */ }
  return { shield, faith: f && { god: f.god, name: f.name, colour: f.colour, rank: f.rank, frac: f.frac, favor: f.favor },
    amusement: h.faith?.god === 'wobbles' ? Math.max(0, Math.min(100, Math.round(h.faith?.amusement ?? 0))) : null,
    stairs: stairsFound(p), here: (() => { try { return itemsHere(state); } catch (e) { return 0; } })() };   // (touch: Pick up shows)
}

/**
 * Options' Map art Blocks (render/looks/blocks.js, 1.7 Block Art), for scripts/blocks.gd: the floor as the readable glyph
 * map. terrain (each floor once): its looks [fill, symbol, ink] and each tile's look as a character (48 + its index);
 * marks: every object tile, prop, found trap, chest and floor item as [x, y, w, h, symbol, ink, alpha] (blocks.js
 * buildStructures, its marks by objectMark, propMark, trapMark, itemMark); bodies: [x, y, size, symbol, ink, line ink]
 * (actorMark), her own '@' among them.
 */
let blocksFloor = null;
function blocksOut(force) {
  const f = state?.floor, out = {};
  if (!f) return null;
  if (force || blocksFloor !== f) {
    blocksFloor = f;
    const bg = { dungeon: '#201C19', crypt: '#1E1D23', caverns: '#1F1B16', underdark: '#1F1B16', chaos: '#1E1D23' }[f.biome] ?? '#201C19';
    const looks = [], index = new Map(), chars = [];
    for (let i = 0; i < f.tiles.length; i++) {
      const t = f.tiles[i], wall = isWallTile(t);
      const look = wall ? ['#2B2B30', '#', '#B1ADB5'] : t === TILE.CHASM ? ['#050408', '∨', '#817690'] : t === TILE.LAVA ? ['#512819', '~', '#E59555']
        : t === TILE.WATER ? ['#182733', '~', '#6DA9BD'] : [bg, '.', '#69646B'];
      const key = look.join('|');
      if (!index.has(key)) { index.set(key, looks.length); looks.push(look); }
      chars.push(String.fromCharCode(48 + index.get(key)));
    }
    out.terrain = { w: f.w, h: f.h, looks, tiles: chars.join('') };
  }
  const marks = [], put = (x, y, m, w = 1, h = 1, a = 1) => { if (m) marks.push([x, y, w, h, m.ch, m.color, a]); };
  const chestAt = new Set((f.chests ?? []).map(c => c.y * f.w + c.x));
  for (let i = 0; i < f.tiles.length; i++) {
    const t = f.tiles[i];
    if (t === TILE.FLOOR || t === TILE.WALL || t === TILE.WATER || t === TILE.SECRET || t === TILE.CHASM || t === TILE.LAVA || (t === TILE.CHEST && chestAt.has(i))) continue;
    try { put(i % f.w, (i / f.w) | 0, objectMark(t, !!f.exitOpen)); } catch (e) { /* drawn without */ }
  }
  for (const p of f.props ?? []) {
    let m = null;
    try { m = propMark(p); } catch (e) { m = null; }
    if (!m) continue;
    put(p.x, p.y, m, p.w ?? 1, p.h ?? 1, (m.used ? 0.4 : 1) * (m.scenery ? 0.7 : 1));
  }
  for (const t of f.traps ?? []) if (t.found) put(t.x, t.y, trapMark(t));
  for (const c of f.chests ?? []) put(c.x, c.y, { ch: '(', color: '#F1CF7E' }, 1, 1, c.open ? 0.4 : 1);
  for (const i of f.items ?? []) { try { put(i.x, i.y, itemMark(i.item)); } catch (e) { /* drawn without */ } }
  out.marks = marks;
  out.bodies = [];
  for (const id of state.order ?? []) {
    const a = state.actors[id];
    if (!a || a.hp <= 0 || a.hidden) continue;
    try { const m = actorMark(a, id === state.playerId); out.bodies.push([a.x, a.y, a.size ?? 1, m.ch, m.color, m.allegiance]); } catch (e) { /* drawn without */ }
  }
  return out;
}

/** render/map-overlays.js stairsPointer (RC29): the nearest stairs down she has seen, or the open exit, for the HUD's
 *  arrow at the screen's edge; null when none. */
function stairsFound(p) {
  const f = state.floor, seen = state.seen;
  if (!f?.tiles || !seen || !p || p.hp <= 0) return null;
  let best = null, bd = Infinity;
  for (let i = 0; i < f.tiles.length; i++) {
    const t = f.tiles[i];
    if (!(t === 3 || (t === 13 && f.exitOpen)) || !seen[i]) continue;   // tiles.js T.STAIRS, T.EXIT
    const x = i % f.w, y = (i / f.w) | 0, d = Math.abs(x - p.x) + Math.abs(y - p.y);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}

// What changes on the floor while she is on it, which the 2D game draws from the floor as it stands each frame and the
// 3D scene built once (scripts/world_sync.gd keeps it in step):
// - ground: each tile's ground (data/tiles.js G) as tiles are sent: the blood a blow spills, scorch and ash, grass
//   trampled short or burnt, puddles left by water drawn off, ice on frozen water, web, a secret door's tell;
// - props: each prop by its head tile, "x,y,id" and ",o" once opened (an elemental lock), ";" between: a lever pulled
//   (its id lever-down), a ritual circle lit, a burrow opened, a cocoon hatched or a web burnt away (gone from the list);
// - exitOpen: the biome's sealed exit has taken its core (engine/bump.js); caveExit: the Maw's burrow out (rules/maw.js).
const propsLine = f => (f.props ?? []).filter(p => !p.part).map(p => `${p.x},${p.y},${p.id}${p.opened ? ',o' : ''}`).join(';');
function worldOut(f) {
  return { ground: f.ground ? chars(f.ground) : '', props: propsLine(f), exitOpen: !!f.exitOpen,
    caveExit: f.caveExit ? { x: f.caveExit.x, y: f.caveExit.y } : null,
    // The mushrooms a spore field left (rules/caverns.js floor.mushrooms: a tile's index, 2 once she has seen it grown),
    // till each is trampled (scripts/spores.gd; render/ground-view.js sporeGrowth).
    mushrooms: Object.entries(f.mushrooms ?? {}).map(([k, v]) => [Number(k), v]) };
}

function view() {
  const f = state.floor;
  return {
    floorNo: state.floorNo, biome: f.biome, depth: depthLine(state), over: !!state.over, cause: state.stats?.cause ?? '', turn: state.now,
    hero: heroOut(), bodies: bodies(), vis: bits(state.vis), seen: bits(state.seen), tiles: chars(f.tiles),
    // Each item with the picture the 2D game draws it by (art.js itemArtName). A crystal vault's treasure lies unseen in
    // its crystal (render/structures.js item 290, rules/inspect.js sealedTreasure).
    items: (f.items ?? []).filter(i => !sealedTreasure(f, i)).map(i => { let art = null; try { art = itemArtName(state, i.item); } catch (e) { art = null; }
      return { x: i.x, y: i.y, id: i.item?.id ?? i.item?.kind ?? 'item', kind: i.item?.kind ?? '', art }; }),
    // Each chest by its kind and its own picture where it has one (a plane's rune chest: render/structures.js art), for
    // scripts/world_sync.gd: one gone from the list went (a mimic's, as it lunges: rules/pickup.js).
    chests: (f.chests ?? []).map(c => ({ x: c.x, y: c.y, kind: c.kind, open: !!c.open, art: c.art ?? null })),
    // The bodies that lie where they fell, their time not yet up (rules/death.js deathRemains; map-remains.js), for
    // scripts/play.gd: those still lie there, the rest fade as they die. A Shambler's corpse lies so too, till it rises or
    // is smashed or burnt (rules/crypt.js corpses; render/crypt-life.js lyingCorpses).
    remains: [...(f.deathRemains ?? []).filter(r => state.now < r.expiresAt).map(r => r.id), ...(f.corpses ?? []).map(c => c.id)],
    ...worldOut(f),
    // The Unmaker's Prism Pylons while its fight is on (rules/unmaker.js encounter pylons; render/realm-pieces.js pylon),
    // for scripts/life.gd: each by its site's id, charging (its warning) and how much of its charge is left.
    pylons: (f.crucible?.encounter?.status === 'active' ? f.crucible.encounter.pylons ?? [] : []).map(p => ({ id: p.id, x: p.x, y: p.y,
      warn: !!p.warning, left: p.warning ? Math.max(0, Math.min(1, (p.warning.fireAt - (state.now ?? 0)) / 200)) : -1 })),
    // The traps she has found (render/structures.js draws only these), for scripts/play.gd _sync_traps.
    traps: (f.traps ?? []).filter(t => t.found).map(t => ({ x: t.x, y: t.y, kind: t.kind })),
    // The floor's live fields (rules/fields.js) and burning tiles, for scripts/fields.gd: each field's kind, its cells,
    // whether it is the Crypt's grave ooze, the turns it has left (-1: lasting).
    fields: (f.fields ?? []).map(r => ({ id: r.id, kind: r.kind, cells: r.cells, ooze: !!r.ooze,
      left: r.until === null || r.until === undefined ? -1 : Math.max(0, r.until - (state.now ?? 0)) / TURN_UNITS })),
    burning: Object.keys(f.burning ?? {}).map(Number),
    // The ground marked for a blow or a hazard to come (forge-rewrite render/map-marks.js buildMarks), for
    // scripts/dangers.gd: its tiles, its own colour (the planes' flares, rocks, surges and gales; else the red squares)
    // and whether it lands within the turn (dangerTick).
    dangers: (f.marks ?? []).map(m => {
      const owner = state.actors?.[m.owner], land = m.landAt ?? (owner?.telegraph ?? owner?.pending)?.landAt;
      const urgent = m.level !== 2 && !(Number.isFinite(land) && Number.isFinite(state.now) && Math.ceil((land - state.now) / TURN_UNITS) > 1);
      // A charge's lane: the way he runs, its arrow on each tile (map-marks.js buildMarks, warn.grukk.charge); a spore
      // field's warning: its roots, mist and sprouts under the glow (fields-view.js sporeWarnTiles).
      const tl = m.tiles ?? [], lane = m.warning === 'warn.grukk.charge' && tl.length > 1 ? Math.atan2(tl[1].y - tl[0].y, tl[1].x - tl[0].x) : null;
      return { t: tl.map(q => [q.x, q.y]), c: m.colour ?? null, u: urgent, ...(lane !== null ? { a: lane } : {}),
        ...(m.warning === 'warn.spore-field' ? { s: true } : {}) };
    }),
  };
}

function words(events) {
  const lines = [];
  for (const e of events) {
    try { const l = logLines(e, state); if (l && l.length) lines.push(...l); } catch (err) { /* a line it cannot word */ }
  }
  try { lines.push(...flushLog()); } catch (err) { /* nothing held */ }
  return lines.map(l => ({ words: l.words, fill: l.fill ?? 0xdddddd, marks: l.marks ?? null }));
}

// ---- sound: each event's cues as the 2D game picks them (audio/cues.js), for scripts/sound.gd to play

const SOUNDS = JSON.parse(readText('../../forge-rewrite/assets/manifest.json') ?? '{}').sounds ?? null;
setSounds(SOUNDS);
const ALIAS = audioData.aliases?.cues ?? {}, MIX = audioData.mix, MUSIC = audioData.music;
const ECHO_CUES = new RegExp(MIX.echoCues);
const strip = f => f.replace(/^assets\/audio\//, '');
const filesOf = name => soundFiles(name) ?? soundFiles(ALIAS[name]);
/** A track's file (a score or an ambience: one each). */
const fileOf = name => { const fs = name && filesOf(name); return fs?.length ? strip(fs[0]) : null; };
// Each sound carries the index of the turn's event that made it (ev), so scripts/play.gd plays a blow's sound as the
// blow lands on the screen, not as the turn arrives (Justin 2026-10-29: "you can't hear the sound of each"); and the run
// it belongs to (run), so a new or loaded run cuts the old one's (audio.js newRun, A15).
let here = null, heard = [], heardFor = -1, stepTake = 0, soundRun = 0;
const round3 = v => Math.round(v * 1000) / 1000;
// As audio.js cue has it (A4, A3, A14): the gain is the cue's volume, its level and its distance (a creature's alert at
// 0.55, mix.alertGain); a cue with several takes (the stone steps) goes through them in turn, not at random; a cue with
// no recording (about sixty: the statuses, double-strike, two spell hits) is the 2D game's small synthesized sound
// (synth.js: its layers, at the cue's volume and distance, through the echo). Which repeats merge is sound.gd's, as
// they play (n, its group g, near: the 2D game merges them as each event plays out, and so does play.gd's timing).
const hearer = {
  cue(name, volume = 1, from = null, after = 0) {
    if (!name || volume === 0) return;
    const near = distanceGain(from, here);
    if (near <= 0) return;
    const alert = /-alert$/.test(name), group = alert ? 'creature-alert' : /^ui-(click|open|close|hover)$/.test(name) ? 'ui-feedback' : null;
    const fs = filesOf(name), tag = { n: name, ...(group ? { g: group } : {}), ...(near < 1 ? { near } : {}), run: soundRun,
      ...(heardFor >= 0 ? { ev: heardFor } : {}), ...(after > 0 ? { after } : {}) };
    if (!fs?.length) {
      const r = synthRecipe(name), gain = volume * near * (r.levelled ? sfxLevel(name) : 1);
      if (gain > 0.01) heard.push({ ...tag, synth: r.layers, gain: round3(gain), echo: 1 });
      return;
    }
    const gain = volume * sfxLevel(name) * (alert ? MIX.alertGain : 1) * near;
    if (gain <= 0.01) return;
    const file = strip(fs[fs.length > 1 ? stepTake++ % fs.length : 0]);
    heard.push({ ...tag, file, gain: round3(gain), ...(ECHO_CUES.test(name) ? { echo: 1 } : {}) });   // A5: the stone-room echo
  },
};
hearer.ui = name => hearer.cue(name);
/** A new or loaded run (audio.js newRun, A15): the old run's sounds are cut, queued ones too (the interface's play on),
 *  and the casters' last spells forgotten. */
function newSoundRun() {
  soundRun += 1;
  heard = heard.filter(s => /^ui-/.test(s.n));
  sfx.clear();
}
/** The cues a turn's pictures make as they play out (runtime/fx-plans.js look.cues: the fireball's blast as its bolt
 *  lands, the Hook's clink as it bites; playback.js onLand, onBite), each with its event and how long after it. */
function hearLooks(looks) {
  for (const [k, look] of Object.entries(looks ?? {})) {
    if (!look?.cues) continue;
    heardFor = +k;
    for (const [name, ms] of look.cues) hearer.cue(name, 1, null, ms);
    heardFor = -1;
    delete look.cues;
  }
}
/** What scripts/sound.gd needs of the 2D game's mix, sent with each new run: its tracks' fades (ui.json audio), the
 *  ambience's gain, each track's filters (audio.json music.filters), the songs' rest, the echo, the limiter, the repeats'
 *  windows, the stale limit, and the recordings the title wants first (the manifest's audio-boot group), by file. */
function mixOut() {
  const byFile = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [fileOf(k), v]).filter(([f, v]) => f && typeof v !== 'string'));
  const A = uiData.audio;
  return { fades: byFile(A.musicFadeMs), fade: A.musicFadeMs.default, ambience: A.ambienceGain, filters: byFile(MUSIC.filters),
    restMs: MUSIC.restMs, endsSeconds: MUSIC.endsSilentSeconds, endsPeak: MUSIC.endsPeak, echo: MIX.echo, limiter: MIX.limiter,
    repeatMs: MIX.repeatMs, staleMs: MIX.staleMs, voices: MIX.voices,
    boot: Object.keys(SOUNDS ?? {}).filter(k => SOUNDS[k].group === 'audio-boot').flatMap(k => (soundFiles(k) ?? []).map(strip)) };
}
/** The Options' Animation speed (options-list.js animSpeed: 1, 1.5, 2 or 3; display.js clock.speed), 1 unset. */
const animSpeed = () => (v => (typeof v === 'number' && v > 0 ? v : 1))(host?.option('animSpeed'));
// The music is the scene's (scene() below), worked out on every reply: what the 2D game's cues ask of its music player
// (the hero's death stopping it, a boss's score) is said by the scene. Without these the cue that asked threw.
hearer.stopMusic = () => {};
hearer.playMusic = () => {};
const sfx = createEvents(hearer, { soundFiles, setHere: h => { here = h; } });
function hearEvents(events, base = 0) {
  events.forEach((ev, i) => {
    heardFor = base + i;
    // A grain sack bursts soft and earthy, not as a crate splinters (Justin 2026-10-29: "smashing a grain bag shouldn't
    // have the same sound as a crate"; the 2D game gives it the crate's).
    if (ev.type === 'prop-broken' && /^sacks?$/.test(ev.id ?? '')) { hearer.cue('knock-thud', 0.8, ev.at ?? null); hearer.cue('earth-hit', 0.5, ev.at ?? null); return; }
    try { sfx.onEvent(ev, state); } catch (e) { /* a cue it cannot place */ }
  });
  heardFor = -1;
  // (The hero's own step, stone or water, is cues.js's 'moved' handler's, tagged with its event like the rest, so it
  // sounds as play.gd starts that step: a walk's next step comes while the one before plays. A second step cue here
  // waited on a 'move' event the engine never sends.)
}
/** The scene's music and ambience (audio/scene.js): its boss's score while one is up, else its floor's tune; and the run
 *  the sounds belong to (newSoundRun). */
function scene() {
  // The title and creation: the title song alone (audio/scene.js: no ambience under it).
  // (Its manifest name is 'title': asked for as 'music-title' alone, the title and creation stood silent; 2026-10-30.)
  if (host && (host.state.mode === 'title' || host.state.mode === 'create')) return { music: fileOf('music-title') ?? fileOf('title'), ambience: null, run: soundRun };
  // The run over: the hero's death stops the music and ambience, and the end screen is silent (audio/cues.js:64-66).
  if (state?.over) return { music: null, ambience: null, run: soundRun };
  const boss = bossTuneFor(state), tune = boss ?? tuneFor(state);
  return { music: fileOf('music-' + tune) ?? fileOf(tune), ambience: (a => a && fileOf(a))(ambienceFor(state, !!boss)), run: soundRun };
}

// ---- asking Godot while a request is being answered (bridge.js: a line out, a line back; web.js: its own tables)

let answering = false;
let askGodot = () => null;
/** How this host answers the windows' questions (how wide some words are, a picture's size). */
export function setAsk(fn) { askGodot = fn; }
setAsker(q => (answering ? askGodot(q) : null));

// ---- one request's gathering: what the engine did and said, from the hero's command or a window's

let turn = null;   // { events, log, said } while a request runs
function play(cmd) {
  if (!state || (state.over && cmd?.type !== 'sandbox')) return [];
  recent.begin();
  const before = standing(state);
  const events = step(state, cmd);
  hearEvents(events, turn ? turn.events.length : 0);
  // What each event shows (fx-plans.js: the 2D game's spells, shots, sigils and sparks), for scripts/fx.gd.
  if (turn) { try { const looks = lookTurn(state, events, before, turn.events.length); hearLooks(looks); Object.assign(turn.fx ??= {}, looks); } catch (e) { /* drawn without */ } }
  if (events.some(e => e.type === 'floor')) host?.autosave();   // event-router.js: the only autosave, as a floor begins
  const log = words(events);
  hear(log);
  recent.end();
  if (turn) { turn.events.push(...events); turn.log.push(...log); }
  host?.afterStep(events);
  aimRefresh();
  return events;
}

// ---- aim mode, as the 2D HUD has it (forge-rewrite src/ui/screens/hud.js press, castAt, endAim, bowPress, aimHover,
// aim.js), whose marks scripts/marks.gd lays on the floor (Justin 2026-10-28: "targeting visual queues are not in
// game"; the number keys had cast at the nearest foe at once): a targeted ability's first press aims it, washing the
// tiles in reach and picking the nearest foe a bolt, chain, beam or tomb can hit; its second press casts at that foe, a
// click on the map at that tile; Esc ends it. The bow's first press draws on the nearest foe it can hit, the next looses.
let aim = null, bow = null;   // aim {slot, entry, view, hoverKey}; bow {slot, id, now}
function hotbarPress(i) {
  if (!state || state.over || host?.covered) return;   // (the HUD stands over the map overlay: its slots work there)
  const entry = state.hero?.hotbar?.[i];
  host?.slotUsed(i, null);   // hotbar.js use: every press clicks, an empty slot's too (A7)
  if (!entry) return;
  traveller.stop(); stopWalker();
  if (entry.kind === 'ranged') return bowPress();
  if (bow) dropBow();
  if (aim && aim.slot === i) { if (aim.view.target) castAt(aim.view.target); else endAim(); return; }
  const v = aimFor(state, entry);
  if (!v) {
    endAim();
    // Feature 136: a sigil's slot pulses in its rune's glow as it is cast (hotbar.js use: measured before the cast).
    try { host?.slotPulse(i, sigilPulse(state, entry)); } catch (e) { /* no pulse */ }
    play(slotCommand(entry));
    return;
  }
  aim = { slot: i, entry, view: v, hoverKey: null };
  host.markTarget(v.mark, v.tiles, v.area, v.path);
  if (v.hint) said(`${v.hint} Esc cancels.`, color.ash);
}
function castAt(at) {
  const a = aim;
  endAim();
  play({ ...slotCommand(a.entry), at: { x: at.x, y: at.y } });
}
function endAim() {
  const was = !!aim;
  aim = null;
  host?.markTarget(null);
  host?.markHover(null);
  return was;
}
function dropBow() { bow = null; host?.markBow(null); }
function bowPress() {
  const p = state.actors[state.playerId];
  if (!p?.bow) { endAim(); if (bow) dropBow(); said('No bow equipped.', color.ash); return; }
  if (aim) endAim();
  const live = bow && bow.now === state.now && bowCanHit(state, state.actors[bow.id]) ? bow.id : null;
  if (live) { dropBow(); play({ type: 'shoot', id: live }); return; }
  const e = bowNextTarget(state, bow?.id ?? null);
  // Item 287: with only a foe beside the hero, the bow slot says why it will not draw.
  const close = (state.order ?? []).some(id => { const a = state.actors[id]; return a?.side === 'foe' && a.hp > 0 && !a.hidden && cheb(p, a) === 1; });
  if (!e) { if (bow) dropBow(); said(close ? 'Too close to shoot.' : 'No bow target in range.', color.ash); return; }
  bow = { id: e.id, now: state.now };
  host.markBow(markRect(e));
}
/** After a turn: the world may have moved, so the aim picks again and the bow's mark goes stale (hud.js set). */
function aimRefresh() {
  if (aim) { aim.view = aimFor(state, aim.entry) ?? aim.view; aim.hoverKey = null; host?.markTarget(aim.view.mark, aim.view.tiles, aim.view.area, aim.view.path); }
  if (bow && (bow.now !== state.now || !bowCanHit(state, state.actors[bow.id]))) dropBow();
}
/** The pointer over tile t while aiming: the target square, gold in reach, red out of it; a bolt's flight to it. */
function aimHover(t) {
  if (!aim) return;
  if (!t || !(litAt(state, t.x, t.y) || seenAt(state, t.x, t.y))) { host.markHover(null); return; }
  const f = state.floor, p = state.actors[state.playerId], k = t.y * f.w + t.x, lit = litAt(state, t.x, t.y);
  const ok = (t.x !== p.x || t.y !== p.y) && (aim.view.explored || lit && cheb(t, p) <= aim.view.range);
  const body = lit ? state.order.map(id => state.actors[id]).find(a => a.hp > 0 && !a.hidden && covers(a, t.x, t.y)) : null;
  host.markHover(body ? markRect(body, body.id === state.playerId) : { x: t.x, y: t.y, w: 1 }, ok, lit, aim.view.bolt && ok && lit ? boltDots(state, t) : []);
  const key = ok && lit ? k : -1;
  if (key !== aim.hoverKey) { aim.hoverKey = key; host.markTarget(aim.view.mark, aim.view.tiles, key >= 0 ? aimArea(state, aim.view.id, t) : aim.view.area, aim.view.path); }
}
function said(words, fill) {
  const l = { words, fill: fill ?? 0xdddddd, marks: null };
  recent.begin(); hear([l]); recent.end();
  if (turn) turn.log.push(l);
}

// Walks of more than a step (play-loop.js): a route from the map (the traveller, engine/travel.js), Explore and a rest
// (rules/auto.js). Each takes its first step at once; Godot asks for the next ({op: "walk"}) once a step has played,
// and any key stops it.
const traveller = createTraveller({ game: () => state, play: c => play(c), say: w => said(w) });
let walker = null;
function beginWalk(kind) {
  if (!state || state.over || host?.blocking) return;
  const r = startWalk(kind, state);
  if (kind === 'rest') { if (r.say) said(r.say, color.ash); if (!r.walk) return; }
  else if (!r.walk) { if (r.say) said(r.say); return; }
  traveller.stop();
  walker = { kind, walk: r.walk };
  walkStep();
}
function stopWalker(why) {
  if (!walker) return;
  const kind = walker.kind;
  walker = null;
  if (kind === 'explore' && why) said(why);
}
function walkStep() {
  if (!walker || !state) return;
  if (host?.blocking) return stopWalker();
  const n = walkNext(state, walker.walk);
  if (n.stop && walker.kind === 'rest') { walker = null; if (n.say) said(n.say, n.good ? 0x7fd08a : color.ink); return; }
  if (n.stop) { stopWalker(n.say); if (n.command) play(n.command); return; }
  play(n.command);
}
const walking = () => !!traveller.active || !!walker;

/** A click on the 3D map's tile (map-input.js pointertap, contextmenu): a foe beside the hero struck, one in the bow's
 *  range shot, ground, an item, the stairs, a door or a lever walked to a step a turn and then used (map-hover.js
 *  mapClick); a click on the hero waits; a right-click shuts an open door beside the hero. */
function clickMap(x, y, right) {
  if (!state || state.over || host?.blocking) return;
  if (aim && !right) { castAt({ x, y }); return; }   // aiming, a click casts at that tile (hud.js mapTap)
  if (aim) endAim();
  traveller.stop(); stopWalker();
  if (right) { if (doorClosable(state, x, y)) play({ type: 'close-door', x, y }); return; }
  const p = state.actors[state.playerId], plan = mapClick(state, x, y);
  if (!plan) { if (x === p.x && y === p.y) play({ type: 'wait' }); return; }
  if (plan.say) return said(plan.say);
  if (plan.command) return play(plan.command);
  traveller.walk(plan.path, plan.then ? () => { const c = arrivalCommand(state, plan.then); if (c) play(c); } : null);
}

function ensureHost(req) {
  if (host) return;
  host = createUiHost({
    state: () => state, play, say: said, store: req.store ?? '', cue: name => hearer.cue(name), compat: !!req.compat, build: req.build ?? 'dev', site: req.site ?? '',
    newRun: (hero, o = {}) => { turn.newRun = { hero, sandbox: !!o.sandbox, seed: o.seed ?? null }; },
    quit: () => { turn.quit = true; },
    // A saved run played on (the Load window): the engine's state is the save's, its floor built anew; ui.js says
    // "Game loaded." and brings its log back (run-saves.js arrive).
    load: g => { state = g; floorKey = null; endAim(); dropBow(); traveller.stop(); walker = null; recent.clear(); newSoundRun(); },
    walk: path => traveller.walk(path),
    // play-loop.js exploreState: Explore running (the HUD's gold Stop), the floor explored (its stairs).
    explore: { toggle: () => (walker?.kind === 'explore' ? stopWalker() : beginWalk('explore')), state: () => ({ active: walker?.kind === 'explore', stairs: !!state?.floor?.exploreComplete }) },
    hotbar: i => hotbarPress(i),   // a slot's menu's Use (hotbar.js use)
  });
}

async function handle(req) {
  turn = { events: [], log: [] };
  if (req.cam && host) host.cam = req.cam;
  if (req.uiWhole) uiWhole = true;   // where the 3D camera shows the floor (a tutorial card stands beside a thing)
  if (req.op === 'new') {
    ensureHost(req);
    // sandbox: the game's own testing sandbox (forge-rewrite src/engine/sandbox.js), whose commands (god mode, heal, the
    // next floor) play.gd's F keys send.
    state = createGame({ seed: req.seed ?? (Date.now() % 1000000), hero: req.hero, sandbox: !!req.sandbox });
    floorKey = state.floor;
    let log = [];
    // The run opens as the 2D HUD opens it (src/ui/screens/hud.js): who enters, in gold, then the floor's intro.
    try { log = [{ words: `${state.hero.name}, ${whoLine(state.hero)}, enters the Dungeon.`, fill: tone.gold, marks: null },
      ...floorIntro(state).map(l => ({ words: l.words, fill: l.fill ?? 0xdddddd, marks: l.marks ?? null }))]; } catch (e) { log = []; }
    recent.clear(); recent.begin(); hear(log); recent.end();
    if (!host.started) { host.started = true; await host.start(req.vw ?? 1280, req.vh ?? 800, !!req.touch, req.dpr ?? 1); }
    host.newRun(log);
    // The game opens on the title (flow.js showTitle), over the run it starts with; a hero the player made starts saved.
    if (req.title) host.showTitle();
    else if (req.hero) host.runBegun(req.hero);
    heard = [];
    newSoundRun();   // (the old run's sounds cut: audio.js newRun)
    return { view: view(), floor: floorOut(), log, recent: recent.lines(), scene: scene(), audio: host.audioLevels(), anim: animSpeed(), mix: mixOut(), ...uiOut(true) };
  }
  if (req.op === 'field') return caveField(req);
  if (!state) return { error: 'no game' };
  if (req.op === 'step') {
    play(req.cmd);
    return gathered();
  }
  if (req.op === 'ui') {
    const ev = req.ev ?? {};
    if (ev.kind === 'move' || ev.kind === 'down' || ev.kind === 'up' || ev.kind === 'wheel') host.pointer(ev.kind, ev.x, ev.y, ev);
    else if (ev.kind === 'key' && (ev.action === 'menu' || ev.action === 'cancel') && (endAim() || (bow && (dropBow(), true)))) turn.used = true;   // Esc ends an aim first
    else if (ev.kind === 'key') turn.used = host.action(ev.action);
    else if (ev.kind === 'hotbar') hotbarPress(ev.slot | 0);
    else if (ev.kind === 'gfx') host.setGfx(ev.key, ev.value);   // (play.gd: the camera's keys)
    else if (ev.kind === 'toggle') { const on = !host.option(ev.key); host.setOption(ev.key, on); said(`${ev.key === 'music' ? 'Music' : 'Sound'} ${on ? 'on' : 'off'}.`); }   // (play.gd: N, the 2D game's music key)
    else if (ev.kind === 'tick') host.tick(ev.ms ?? 50);
    else if (ev.kind === 'resize') host.resize(ev.vw, ev.vh, ev.touch, ev.dpr);
    else if (ev.kind === 'open') host.open(ev.name, ev.arg ?? null);
    else if (ev.kind === 'map') host.toggleMap(ev.on);
    else if (ev.kind === 'end') host.showEnd();
    else if (ev.kind === 'close') host.close();
    else if (ev.kind === 'text') host.text(ev.value ?? '', !!ev.done);
    else if (ev.kind === 'standing') host.standing();
    else if (ev.kind === 'hall') host.hall();   // (main.gd: the 3D hall stands behind creation)
    else if (ev.kind === 'maphover') { host.mapHover(ev.t ?? null, { x: ev.x ?? 0, y: ev.y ?? 0 }, ev.touch ? { band: ev.band ?? null } : null); if (!ev.touch) aimHover(ev.t ?? null); }
    else if (ev.kind === 'mapclick') clickMap(ev.x, ev.y, !!ev.right);
    // The HUD (scripts/hud.gd): where its hotbar's slots lie, the part under the mouse (its card), a right-click on a
    // slot (its menu or the click spell), a slot dragged along the bar or off it.
    else if (ev.kind === 'hudplaces') host.hudPlaces(ev.slots);
    else if (ev.kind === 'hudhover') host.hudHover(ev.what ? ev : null);
    else if (ev.kind === 'slotmenu') host.slotRightClick(ev.slot | 0);
    else if (ev.kind === 'barmove') host.barMove(ev.from | 0, ev.to | 0);
    else if (ev.kind === 'slotinfo') host.slotInfo(ev.slot | 0);   // (touch: a tap on an empty slot, hotbar.js showInfo)
    // A key as the page names it, while Options waits for one to bind (options.js listen); a save file picked (save.js pickFile).
    else if (ev.kind === 'rawkey') host.rawKey(ev);
    else if (ev.kind === 'file') host.fileChosen(ev.text ?? null);
    else if (ev.kind === 'say') host.say(String(ev.words ?? ''), ev.fill ?? null);   // (ui2d.gd: where an export went)
    return gathered(!!ev.force);
  }
  if (req.op === 'walk') {
    // next: the last step has played, take the next; stop: a key or a press; explore, rest: start one.
    if (req.kind === 'stop') { traveller.stop(); stopWalker(); }
    else if (req.kind === 'explore') { if (walker?.kind === 'explore') stopWalker(); else beginWalk('explore'); }
    else if (req.kind === 'rest') beginWalk('rest');
    else if (traveller.active) traveller.next();
    else if (walker) walkStep();
    return gathered();
  }
  if (req.op === 'debug') {
    // For testing (play.gd --auto {die}): the hero falls, as a death would end the run.
    if (req.q?.what === 'die') {
      const p = state.actors[state.playerId];
      p.hp = 0; state.over = true; state.stats ??= {}; state.stats.cause ??= 'a test';
      const ev = [{ type: 'died', id: state.playerId }];
      turn.events.push(...ev);
      host.afterStep(ev);
    }
    // For testing (play.gd --auto {win}): the run won, as the Unmaker's fall ends it (the end screen's Save this character).
    if (req.q?.what === 'win') {
      state.won = true; state.over = true; state.sandbox = false;
      const ev = [{ type: 'won' }];
      turn.events.push(...ev);
      host.afterStep(ev);
    }
    // For testing (play.gd --auto {tap=name-field}): the windows' control of that label pressed.
    if (req.q?.what === 'tap') host.tap(req.q.label);
    // For testing (play.gd --auto {drag=bag-0>slot2}): where a window's control of that label lies, in the stage's units.
    if (req.q?.what === 'where') return { where: host.where(req.q.label), ...uiOut() };
    // For testing (play.gd --auto {boss}, a sandbox run): the sandbox's teleport to a few tiles from the floor's boss.
    if (req.q?.what === 'boss') {
      const b = Object.values(state.actors).find(a => a.boss && a.hp > 0);
      if (b) play({ type: 'sandbox', action: 'teleport', x: b.x, y: b.y + 3, near: true });
    }    // For testing (play.gd --auto {fields}): one of each field round the hero, a few tiles apart, and fire.
    if (req.q?.what === 'fields') {
      const p = state.actors[state.playerId], ev = [];
      const kinds = ['gas', 'spores', 'smoke', 'static', 'darkness', 'ice', 'roots', 'holy', 'poison-trail', 'web'];
      kinds.forEach((kind, i) => {
        const cx = p.x - 6 + (i % 5) * 3, cy = p.y + (i < 5 ? -2 : 2), tiles = [];
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) tiles.push({ x: cx + dx, y: cy + dy });
        layField(state, { field: kind, turns: 50, permanent: kind === 'poison-trail' }, tiles, p, ev);
      });
      ignite(state, p.x + 1, p.y, true, 30, ev);
      turn.events.push({ type: 'field', kind: 'test' });
    }
    // For testing (play.gd --auto {world=act}): the floor changed round the hero as the rules change it in play, for a
    // look at scripts/world_sync.gd keeping up (worldOut): marks (one of each ground mark on the floor round her), lever
    // (a lever beside her, then pulled), lock (an elemental lock beside her, then opened), unprop (the nearest prop gone
    // without breaking), mimic (the nearest chest gone), collapse (a room's floor round her, but her tile, a chasm),
    // burrow (the Maw's way down beside her), gate (a sealed exit gate beside her), open (the exit opened).
    if (req.q?.what === 'world') {
      const f = state.floor, p = state.actors[state.playerId], k = (x, y) => y * f.w + x, act = req.q.act;
      const free = (x, y) => f.tiles[k(x, y)] === TILE.FLOOR && !f.props.some(q => q.x === x && q.y === y);
      const near = (fn, r = 3) => { for (let d = 1; d <= r; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === d && fn(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy }; return null; };
      const byDist = a => a.sort((m, n) => cheb(m, p) - cheb(n, p))[0];
      if (act === 'marks') [[5, -2, -1], [6, -1, -1], [3, 0, -1], [4, 1, -1], [9, 2, -1], [10, -2, 1], [11, -1, 1], [5, 0, 1], [6, 1, 1], [6, 2, 1]]
        .forEach(([g, dx, dy]) => { const x = p.x + dx, y = p.y + dy; if (f.tiles[k(x, y)] !== TILE.WALL) f.ground[k(x, y)] = g; });
      if (act === 'lever') { const l = f.props.find(q => q.id === 'lever-up' || q.id === 'lever-down'); if (l) { l.id = 'lever-down'; l.used = true; } else { const c = near(free); if (c) f.props.push({ id: 'lever-up', x: c.x, y: c.y }); } }
      if (act === 'lock') { const l = f.props.find(q => q.id === 'elemental-lock'); if (l) l.opened = true; else { const c = near(free); if (c) f.props.push({ id: 'elemental-lock', x: c.x, y: c.y, element: 'fire' }); } }
      if (act === 'unprop') { const q = byDist(f.props.filter(q => !q.part)); if (q) f.props = f.props.filter(r => r !== q && !(r.part && r.part.x === q.x && r.part.y === q.y)); }
      if (act === 'mimic') { const c = byDist([...(f.chests ?? [])]); if (c) { f.chests.splice(f.chests.indexOf(c), 1); f.tiles[k(c.x, c.y)] = TILE.FLOOR; } }
      if (act === 'collapse') for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = p.x + dx, y = p.y + dy; if ((dx || dy) && Math.abs(dx) + Math.abs(dy) > 1 && free(x, y)) { f.tiles[k(x, y)] = TILE.CHASM; f.ground[k(x, y)] = 0; } }
      if (act === 'burrow') { const c = near(free); if (c) { f.tiles[k(c.x, c.y)] = TILE.EXIT; f.exit = c; f.exitOpen = false; f.caveExit = c; } }
      if (act === 'gate') { const c = near(free); if (c) { f.tiles[k(c.x, c.y)] = TILE.EXIT; f.exit = c; f.exitOpen = false; } }
      if (act === 'open') f.exitOpen = true;
      if (act === 'fire') ignite(state, p.x + 1, p.y, true, 30, []);   // fire beside her, to burn what it will
      // grass: tall grass grown on the bare floor east of her, 3 by 3, as it grows back (rules/props.js regrowth)
      if (act === 'grass') for (let dy = -1; dy <= 1; dy++) for (let dx = 1; dx <= 3; dx++) if (f.tiles[k(p.x + dx, p.y + dy)] === TILE.FLOOR) f.ground[k(p.x + dx, p.y + dy)] = 1;
      // charge: a charge's lane marked east of her; spores: a spore field's warning on the 3 by 3 north-east of her;
      // mushrooms: a spore field's mushrooms on the 3 by 3 east of her (rules/caverns.js), seen
      const ring = (dx0, dy0) => { const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.x + dx0 + dx, y = p.y + dy0 + dy; if (f.tiles[k(x, y)] === TILE.FLOOR) out.push({ x, y }); } return out; };
      if (act === 'charge') { const lane = []; for (let d = 1; d <= 5 && f.tiles[k(p.x + d, p.y)] !== TILE.WALL; d++) lane.push({ x: p.x + d, y: p.y }); (f.marks ??= []).push({ tiles: lane, warning: 'warn.grukk.charge', level: 1 }); }
      if (act === 'spores') (f.marks ??= []).push({ tiles: ring(2, -2), warning: 'warn.spore-field', colour: '#9BD06A', level: 1 });
      if (act === 'mushrooms') { f.mushrooms ??= {}; for (const t of ring(2, 0)) f.mushrooms[k(t.x, t.y)] = 2; }
      if (act === 'unmark') f.marks = [];
      // smoke: a short smoke east of her, to see it thin away as it ends; traps: found fire, spark and dart traps under
      // the props nearest her and an alarm on the floor beside her
      if (act === 'smoke') layField(state, { field: 'smoke', turns: 2 }, ring(2, 0), p, []);
      if (act === 'static' || act === 'roots') layField(state, { field: act, turns: 30 }, ring(2, 0), p, []);
      if (act === 'traps') {
        const props = f.props.filter(q => !q.part).sort((m, n) => cheb(m, p) - cheb(n, p)).slice(0, 3);
        props.forEach((q, i) => (f.traps ??= []).push({ x: q.x, y: q.y, kind: ['fire', 'spark', 'dart'][i], found: true }));
        const c = near(free); if (c) f.traps.push({ x: c.x, y: c.y, kind: 'alarm', found: true });
      }
      // secret: the nearest wall with open floor south of it made a hidden door (its seam drawn on its face)
      if (act === 'secret') { let y = p.y - 1; while (y > 0 && f.tiles[k(p.x, y)] !== TILE.WALL) y--; if (f.tiles[k(p.x, y + 1)] !== TILE.WALL) f.tiles[k(p.x, y)] = TILE.SECRET; }
      // drain: the water within 6 of her drawn off, floor and puddles left (rules/gear-use.js); freeze: frozen (abilities.js)
      if (act === 'drain' || act === 'freeze') for (let y = p.y - 6; y <= p.y + 6; y++) for (let x = p.x - 6; x <= p.x + 6; x++) {
        if (x < 0 || y < 0 || x >= f.w || y >= f.h || f.tiles[k(x, y)] !== TILE.WATER) continue;
        if (act === 'drain') { f.tiles[k(x, y)] = TILE.FLOOR; f.ground[k(x, y)] = 4; } else f.ground[k(x, y)] = 9;
      }
      turn.events.push({ type: 'log', words: `(test: world ${act})` });
    }
    return gathered();
  }
  if (req.op === 'view') return { view: view() };
  // The hero card's rows and held gear (hero-art.js), asked for when view.hero.art says they changed.
  if (req.op === 'heroart') { try { return { art: heroArt(state) }; } catch (e) { return { art: null, error: String(e?.stack ?? e) }; } }
  return { error: 'unknown op ' + req.op };
}

// ---- the Caverns' rock, as the 2D game shapes it (render/cave-field.js), for scripts/cave.gd

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0, n = (a << 16) | (b << 8) | c;
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}
/**
 * {op: "field", floor?, run?, floorNo?} -> the cave shape field of the floor now (or the one given, for a tour): its
 * samples a tile and size, the salt the 2D game's cave surface paints with, the shape and ground fields (RGBA, base64)
 * and the cave material's colours (0-255); on an Underdark floor, each tile's region and the deep rock's colours.
 */
function caveField(req) {
  const floor = req.floor ?? state?.floor, floorNo = req.floorNo ?? state?.floorNo ?? 11, run = req.run ?? state?.seed ?? 0;
  if (!floor) return { error: 'no floor' };
  const salt = (surfaceSalt(run, floorNo) + 911) % 65536;
  const F = buildCaveField(floor, salt);
  const out = { S: F.S, w: F.w, h: F.h, salt, shape: base64(F.shape), ground: base64(F.ground), palette: CAVE_ROCK };
  // The Underdark: each tile's region (0 the temple, 1 the spider caves, 2 the volcanic rock) and their rock.
  if (floor.region) Object.assign(out, { region: base64(Uint8Array.from(floor.region)), deep: DEEP_ROCK });
  // The Realm's islands and the planes: their natural rock's colours (the Rot and Violet islands', each plane's).
  if (floor.chaos || floor.plane) out.rock = ROCK;
  return out;
}

/** The windows' answer for this request: their drawing if it changed, where they stand, the pointer's look. */
function uiOut(force = false) {
  if (!host) return {};
  const tree = host.frame(force || uiWhole);
  uiWhole = false;
  const out = { uiState: host.state, cursor: host.cursor, tips: host.tips };
  if (tree) out.ui = tree;
  // The 3D look (graphics.js), when the Sandbox's View page changed it.
  if (force || host.gfxSeq !== gfxSent) { out.gfx = host.gfx; gfxSent = host.gfxSeq; }
  if (force || host.marksSeq !== marksSent) { out.marks = host.marks; marksSent = host.marksSeq; }
  if (host.wantsEnd) out.uiState.ended = true;
  // For the HUD and play.gd: the slot being aimed (its gold ring, hotbar.js armed), the walk under way (O or R again
  // stops it, play-loop.js onAction) and Explore's state (the gold Stop, the stairs: hud.js setExplore).
  out.uiState.aim = aim ? aim.slot : bow ? (state?.hero?.hotbar ?? []).findIndex(e => e?.kind === 'ranged') : -1;
  out.uiState.aiming = !!aim;   // a targeted ability waits for its target: a move key ends the aim (play-loop.js AA3)
  out.uiState.walk = walker?.kind ?? (traveller.active ? 'travel' : null);
  out.uiState.stairs = !!state?.floor?.exploreComplete;
  out.uiState.sandbox = !!state?.sandbox;   // a sandbox run shows the Record button (play.gd, record-web.js)
  // Options' key table and the options that change play (ui.js keys, playOptions), when they changed.
  const keys = host.keysSeq, po = JSON.stringify(host.playOptions);
  if (force || keys !== keysSent) { out.keys = host.keys; keysSent = keys; }
  if (force || po !== optsSent) { out.playOptions = host.playOptions; optsSent = po; }
  const file = host.takeFile();   // a save to write or one to pick (save.js Export, Import)
  if (file) out.file = file;
  // Map art Blocks: the glyph map's floor and what stands on it (blocksOut), with each turn while it is chosen.
  if (host.playOptions.mapArt === 'blocks' && state) {
    const turnKey = `${state.now}|${state.actions ?? 0}|${state.floorNo}`;
    if (force || turnKey !== blocksSent || blocksFloor !== state.floor || turn?.events?.length) { const b = blocksOut(force); if (b) out.blocks = b; blocksSent = turnKey; }
  } else { blocksSent = null; blocksFloor = null; }
  return out;
}
let keysSent = null, optsSent = null, blocksSent = null;

/** What a request did: the engine's events and log when a command ran, the view, a new floor, the windows. */
function gathered(force = false) {
  const out = { ...uiOut(force) };
  if (turn.used !== undefined) out.used = turn.used;
  if (turn.newRun) out.newRun = turn.newRun;
  if (turn.quit) out.quit = true;
  out.walking = walking();
  if (heard.length) { out.sounds = heard; heard = []; }
  if (state) out.scene = scene();
  if (host) out.audio = host.audioLevels();   // the Options' sound settings (scripts/sound.gd levels)
  if (host) out.anim = animSpeed();   // the Options' Animation speed (game.gd _take_ui)
  if (turn.events.length || turn.log.length) {
    out.events = turn.events;
    out.fx = turn.fx ?? {};
    out.log = turn.log;
    out.recent = recent.lines();
    out.view = view();
    // A new floor is a new floor object: a plane's (or the Realm's) keeps its host's number and seed, so by those the
    // scene was never told of it, and the plane of fire stood as the Dungeon floor it was entered from (2026-10-28).
    const key = state.floor;
    if (key !== floorKey) {
      floorKey = key;
      out.floor = floorOut();   // its intro is in the log already, from the 'floor' event (log-text.js)
    }
  }
  return out;
}

/**
 * One request answered, after every promise it started has settled (settle: a timer that runs only once the job queue
 * is empty), so nothing the windows do runs between requests, when Godot is not listening.
 */
export async function serve(req, settle) {
  answering = true;
  let out;
  try {
    const job = handle(req);
    await settle();
    out = await job;
    await settle();
    if (host && turn && (out?.ui === undefined) && req.op !== 'view') {
      // Whatever settled after the answer was made (a window opened by a promise) is drawn now.
      const late = host.frame(false);
      if (late) out.ui = late;
    }
    host?.flush();
  } catch (e) { out = { error: String(e && e.stack || e) }; }
  answering = false;
  return out;
}
