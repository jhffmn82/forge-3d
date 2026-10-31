// Doors, stairs, props, chests and floor items on the map, drawn from the art 1.7 draws today: the environment-props
// sheets first (structures, props, set, chests, items), the older packed map-* sheets only where those have no
// picture (1.7 render.js objArt, renderer.js:3-90, render.js:2170-2300 @3c8b312). Each picture is fitted to the tile as
// 1.7's drawObjectSprite fits it: scaled to fit a share of the tile (keeping its shape), centred, or standing on the
// tile's foot line (0.96 down). Sprites go in the bodies' layer and sort by depth with creatures.

import { Graphics, Sprite } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { T, G, tileAt, isWallTile } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { sealedTreasure } from '../engine/reads.js';   // C17: the rules' answers through the engine (PLAN section 2)
import { cryptPropSprite, cryptSconceFlames } from './crypt-look.js';
import { underdarkPropSprite, underdarkTile } from './underdark-look.js';
import { isCavePiece, caveSprite, caveArt } from './cave-terrain.js';
import { runeTexture, sigilArtName } from './runes.js';
import { debrisSprites } from './debris-view.js';
import { objArt, anyArt, objSprite, propFit, propLoop, looped, itemArtName } from './art.js';
import { doorGraphic } from './door-view.js';
import { globeSprite, lootGlow, MOTE_COL, buildMarks } from './map-marks.js';
import { smoothLoot, crisp, upheavalRock, spikeTrap, trapLeak, alarmBell, drawVines } from './piece-art.js';

const TRAPS = 'environment-props-traps';
const ITEM_FIT = { ring: 0.42, amulet: 0.46, essence: 0.42, mote: 0.42, key: 0.46, sigil: 0.56, food: 0.52, offhand: 0.58, armour: 0.62, weapon: 0.68, core: 0.52 };   // E51: cores 0.52 (1.7 cores.js)

// 1.7 render.js DOOR_ART: the materials 1.7 painted an open front door for; the others are the art packet's (door-view.js).
const DOOR_ART = { wood: 'door-wood-open', iron: 'door-iron-open' };

// Grave flowers are decorative; a Crypt mushroom cell keeps its visible growth, light and trampling (item 336).
const hiddenFlower = (p, floor) => floor?.biome === 'crypt' && /^grave-flowers-moss-\d$/.test(p.id)
  && [G.GRASS, G.SHORT].includes(floor.ground?.[p.y * floor.w + p.x]);

const DECO_REGIONS = ['temple', 'underdark', 'volcanic'];
/** 1.7 environment-deco.js palette(): which deco colours a cell takes. */
function decoPalette(floor, x, y) {
  if (!floor) return 'dungeon';
  if (floor.plane) return floor.plane;
  if (floor.biome === 'underdark') return floor.region ? DECO_REGIONS[floor.region[y * floor.w + x]] ?? 'underdark' : 'underdark';
  return floor.biome === 'caverns' || floor.biome === 'crypt' ? floor.biome : 'dungeon';
}

/** The picture a door, stairs or other object tile shows, and how 1.7 fits it (render.js:2187-2190). */
function tileObject(floor, x, y) {
  const t = tileAt(floor, x, y);
  const ud = underdarkTile(floor, x, y);   // the drow stairway (underdark-look.js)
  if (ud) return ud;
  const wallish = isWallTile;
  const side = wallish(tileAt(floor, x, y - 1)) && wallish(tileAt(floor, x, y + 1)) && !(wallish(tileAt(floor, x - 1, y)) && wallish(tileAt(floor, x + 1, y)));
  // A door face-on fills its tile. Side-on doors, and the open front doors 1.7 had no picture for, are the art packet's
  // frame and leaf (door-view.js doorGraphic, item 176).
  const door = { fit: 1.02, fill: true, feet: true, base: 1 };   // on the tile's foot, flush with the wall's bottom edge (Justin 2026-10-19)
  // RC7 (1.7 render.js drawOpenDoor, 2026-09-27 Q22): an opened door keeps the material the rules noted (rules/doors.js;
  // M3: the map only reads it). Face-on it is that material's painted open door over the floor.
  if (t === T.OPEN_DOOR && !side) { const m = floor.doorMaterials?.[y * floor.w + x] ?? 'wood'; return DOOR_ART[m] ? [objArt('structures', DOOR_ART[m]), door] : [null, { drawn: true, side }]; }
  // Sandbox 94: a sealed door in a north-south wall is a side door too, not the face-on iron door standing in the wall;
  // an event gate keeps its portcullis.
  const gate = t === T.SEALED && (floor.props ?? []).some(q => q.x === x && q.y === y && q.eventGate);
  if (side && (t === T.OPEN_DOOR || t === T.DOOR || t === T.LOCKED || t === T.TOLL || t === T.ICE_DOOR || t === T.THORNS || (t === T.SEALED && !gate))) return [null, { drawn: true, side }];
  // RC8: a Crypt door is the Crypt's own (1.7 renderer.js:153).
  if (t === T.DOOR) return [(floor.biome === 'crypt' && objArt('set', 'crypt-door')) || objArt('structures', 'door-wood'), door];
  if (t === T.LOCKED) return [objArt('structures', 'door-iron'), door];
  // The crystal vault's door (world.md 55; 1.7 render.js:361 draws door-crystal there).
  if (t === T.SEALED && floor.crystalVault && !floor.crystalVault.opened && floor.crystalVault.door.x === x && floor.crystalVault.door.y === y) return [objArt('structures', 'door-crystal') ?? objArt('structures', 'door-iron'), door];
  // RC56 (1.7 render.js): an event gate is a portcullis at 1.4; an ordinary sealed door is iron with a blue seal tint.
  if (t === T.SEALED && (floor.props ?? []).some(q => q.x === x && q.y === y && q.eventGate)) return [objArt('props', 'portcullis-closed') ?? objArt('structures', 'door-iron'), { fit: 1.4, fill: true }];
  if (t === T.SEALED) return [objArt('structures', 'door-iron'), { ...door, seal: true }];
  if (t === T.TOLL) return [objArt('structures', 'door-spiked'), door];
  if (t === T.FORGE) return [objArt('set', 'forge-lit') ?? objArt('structures', 'forge-lit'), { fit: 2.3, feet: true }];
  if (t === T.SHRINE) return [(floor.shrine?.god && objArt('set', 'shrine-' + floor.shrine.god)) || objArt('structures', 'shrine'), { fit: 2.1, feet: true }];
  // RL26 (1.7 renderer.js:147): the Caverns' way down, opened by the Maw's death, is an open worm burrow on the ground.
  if (t === T.EXIT && floor.caveExit) { const b = caveArt('worm-burrow-open'); if (b) return [b, { fit: 1, fill: true, flat: true }]; }
  if (t === T.EXIT) return [objArt('structures', 'exit-gate') ?? objArt('structures', 'archway'), { fit: 1.18, feet: true }];
  if (t === T.STAIRS) return [objArt('structures', 'stairs-down'), { fit: 0.95, flat: true }];
  if (t === T.STAIRS_UP) return [objArt('structures', 'stairs-up') ?? objArt('structures', 'stairs-down'), { fit: 0.95, flat: true }];
  return [null];
}

/** How 1.7 draws one prop (renderer.js drawPropSurface and FIT, render.js paintProp). */
export function propSprite(p, tile, now = 0, floor = null) {
  const id = p.id;
  if (id === 'bush' || hiddenFlower(p, floor)) return null;   // bushes are drawn with the vegetation (ground-view.js)
  if (p.upheaval) return upheavalRock(p, tile);   // WT5: bare rock, a ridge
  const crypt = cryptPropSprite(p, tile);   // the Crypt's pieces, tombs and urn groups (crypt-look.js); undefined: not one
  if (crypt !== undefined) return crypt;
  const deep = underdarkPropSprite(p, tile);   // the Underdark's pieces (underdark-look.js); undefined: not one
  if (deep !== undefined) return deep;
  if (p.part) return null;   // a piece wider than a tile is drawn once, from its head
  if (isCavePiece(id)) return caveSprite(p, tile);   // the Caverns' pieces at their natural size (cave-terrain.js)
  if (id === 'stack-group') {
    const fam = p.family ?? 'crate', tex = objArt('props', fam), f = propFit(id);
    return tex ? objSprite(tex, p.x, p.y, tile, { feet: f.feet, fit: f.family?.[fam] ?? f.size, flip: !!p.flip }) : null;
  }
  if (id === 'rubble') {   // a pebble decal, a shade larger than a tile (surface.js drawStoneProp)
    // WT12 (1.7 environment-deco.js palette): the pebbles take the plane's, the Underdark region's or the biome's colours.
    const n = 1 + Math.floor(hash2(p.x, p.y, 73) * 3), deco = hasSheet('environment-deco') ? sheet('environment-deco').textures : null;
    const tex = deco ? deco[`${decoPalette(floor, p.x, p.y)}/pebble-${n}`] ?? deco[`dungeon/pebble-${n}`] : null;
    // At 1.7's size, round the tile's centre (Justin 2026-10-19: "stones were strunk too many times", undoing sandbox 91's half).
    const f = propFit(id);
    return tex ? objSprite(tex, p.x, p.y, tile, { fit: f.size, scale: f.scale, anchor: f.anchor }) : null;
  }
  if (id === 'bones' || id === 'bone-pile') {   // ground bones at 0.7 of a tile (fit)
    const tex = smoothLoot(hasSheet('environment-ground-bones') ? sheet('environment-ground-bones').textures[`props/ground-bones-${Math.floor(hash2(p.x, p.y, 74) * 5)}`] : objArt('props', 'bones'));   // mipmapped: drawn smaller than its art
    if (!tex) return null;
    // The picture at 0.7 of a tile, turned up to 0.35 rad (RL25); fitted once (Justin 2026-10-19: "looks like the bones
    // were shrunk multiple times"; 2026-10-20, item 259: "can we try these bones at like 70% the size of the skull there
    // should match player art": at 0.7 the skull, 48 px of the 128, is the hero's head, 16.5 px against 24 at one tile).
    const f = propFit(id), sp = objSprite(tex, p.x, p.y, tile, { fit: f.size, scale: f.scale, anchor: f.anchor });
    sp.anchor.set(0.5); sp.position.set((p.x + 0.5) * tile, (p.y + 0.5) * tile); sp.rotation = (hash2(p.x, p.y, 61) - 0.5) * 0.7;
    return sp;
  }
  // A stone pillar (a puzzle room's or a guardian room's cover, the library's, the Amulet of the Pillar's): 1.7's packed
  // stone pillar picture through anyArt (environment-props-pillar; item 175, Justin 2026-10-18: "old bad art for pillars
  // is being used here": 1.7 painted one in code only when the picture was missing). EQ9.
  // G45: a prop drawn as a short loop on a sheet of its own (the silk-wrapped traveler struggling in his cocoon, 4
  // frames at 160 ms; 1.7 environment-props.json frames, frameMs), or on the Dungeon's own props sheet (the mossy drain and
  // the broken shrine, item 233), fitted as the still pieces are, at its props.json fit.frameMs (art.js propLoop and
  // looped, which the Underdark's silk banners and the exit gate share, item 322).
  const loop = propLoop(id);
  if (loop.length > 1) { const f = propFit(id); return looped(objSprite(loop[0], p.x, p.y, tile, { feet: f.feet, fit: f.size }), id, p.x, p.y, loop); }
  if (id === 'vines') { const g = new Graphics(); g.vines = { x: p.x, y: p.y, tile }; drawVines(g, 0, true); return g; }   // RC50
  // CR18 (1.7 cryptpack.js): the puzzle-treasure marker (a flat violet crystal) is the small crystal off the planes.
  const tex = (id === 'crystal-violet' && p.flat && anyArt('crystal-violet-small')) || anyArt(id);
  if (!tex) return null;
  // The prop's fit, from its props.json row (art.js propFit): 1.7 renderer.js FIT and environment-props.js fit. Sandbox
  // 91 (Justin 2026-10-17): small scatter and mushrooms at half size, urns, braziers and incense at 0.8; A18: the element
  // crystals at 0.7 on their foot (WT19, WT20). Item 103 (1.7 surface.js:288-296 drawStoneProp, reached by renderer.js:82
  // renderProp and cryptset.js:239): shelves fill 0.98 of the tile's width, as tall as the crop makes them (1.382 for
  // 78 x 110), standing at 0.97 of the tile so a row stands nearly flush against the wall, drawn pixel-sharp (item 112:
  // 0e56e02's drawObj fit 1.12 was not 1.7's path).
  const f = propFit(id, { flat: !!p.flat }), pic = f.crisp ? crisp(tex) : tex;
  // A piece wider than a tile (its head carries w and h: item 233's long table, rug, fallen masonry) is fitted to its
  // footprint's width, centred across it, standing on its bottom row (or centred down it when it lies flat).
  const w = p.w ?? 1, h = p.h ?? 1, fit = (f.tall ? f.size * Math.max(1, pic.frame.height / pic.frame.width) : f.size) * w;
  const at = { x: p.x + (w - 1) / 2, y: p.y + (f.feet ? h - 1 : (h - 1) / 2) };
  // RC44 (1.7 render.js): an opened elemental lock dims to 60%.
  const sp = objSprite(pic, at.x, at.y, tile, { feet: f.feet, fit, base: f.base, scale: f.scale, anchor: f.anchor, ...(id === 'elemental-lock' && p.opened ? { alpha: 0.6 } : {}) });
  if (/^barrel-(water|poison)$/.test(id)) {
    const ordinary = anyArt('barrel');
    if (ordinary) {
      const ref = objSprite(ordinary, at.x, at.y, tile, { feet: f.feet, fit, base: f.base });
      const centre = sp.x + sp.width / 2;
      sp.width = ref.width; sp.x = centre - sp.width / 2;
      ref.destroy();
    }
  }
  if (f.lies) sp.flat = true;   // under the bodies (fit.lies)
  return sp;
}


/**
 * Builds sprites for every object tile, prop, found trap, mark, chest and floor item, with their depth. M9 (render-25):
 * in groups, each keyed by what it is drawn from; with `kept` (the map view's own, kept between calls) a group whose key
 * is unchanged keeps its sprites, so a pickup draws the items again and not the floor. The list is in the same order
 * whatever was kept; list.rebuilt names the groups drawn again. The Realm's pieces run through every group, so on its
 * floors everything is drawn each time.
 */
export function buildStructures(floor, tile, now, state = null, realmPieces = null, kept = null) {
  // realmPieces: realm-view.js realmStructures, handed in by the map view (render-26: this file does not import
  // realm-view.js, which draws its props through propSprite): the Realm of Chaos, the planes and the portals; null elsewhere.
  const realm = realmPieces?.(floor, tile, now) ?? null, cache = realm ? null : kept, json = v => JSON.stringify(v ?? null);
  if (cache && (cache.floor !== floor || cache.tile !== tile)) Object.assign(cache, { floor, tile, groups: {}, propOver: null });
  const tilesKey = floor.tiles.join() + json(floor.doorMaterials) + floor.exitOpen + floor.caveExit + json(floor.crystalVault) + json(floor.shrine);
  const propsKey = tilesKey + json(floor.props) + (floor.biome === 'crypt' ? json((floor.props ?? []).map(p => hiddenFlower(p, floor))) : ''), sigils = (floor.items ?? []).filter(i => i.item.kind === 'sigil').map(i => sigilArtName(state, i.item.id));
  let propOver = cache?.propOver ?? null;
  const groups = [
    ['debris', json(floor.debris), depth => {
      for (const s of debrisSprites(floor, tile)) depth(s, 0, true);   // sandbox 101: what broken props left, flat and first (debris-view.js)
    }],
    ['tiles', tilesKey + json((floor.props ?? []).filter(q => q.eventGate)), depth => {
      for (let y = 0; y < floor.h; y++) for (let x = 0; x < floor.w; x++) {
        const t = floor.tiles[y * floor.w + x];
        if (t === T.FLOOR || t === T.WALL || t === T.WATER || t === T.SECRET) continue;   // most tiles carry nothing
        if (realm?.skip.has(y * floor.w + x)) continue;
        const [tex, o] = tileObject(floor, x, y);
        // the exit gate plays its loop once it has one (art.js looped, item 322)
        let gate = null;
        if (tex) { const s0 = objSprite(tex, x, y, tile, o), s = t === T.EXIT && !floor.caveExit ? looped(s0, 'exit-gate', x, y) : s0; gate = s; s.cell = { x, y }; depth(s, y, !!o.flat); }   // cell: the tile it stands for (objanim.js, RB13)
        // RC9 and RC56 (1.7 render.js): a sealed biome exit's doorway is dark until its guardian falls; a sealed door glows blue.
        if (tex && t === T.EXIT && !floor.exitOpen && !floor.caveExit) {
          const shade = new Graphics();
          const gx = gate.x, gy = gate.y, gw = gate.width, gh = gate.height;
          shade.moveTo(gx + gw * 0.28, gy + gh * 0.89).lineTo(gx + gw * 0.28, gy + gh * 0.45)
            .quadraticCurveTo(gx + gw * 0.28, gy + gh * 0.25, gx + gw * 0.5, gy + gh * 0.25)
            .quadraticCurveTo(gx + gw * 0.72, gy + gh * 0.25, gx + gw * 0.72, gy + gh * 0.45)
            .lineTo(gx + gw * 0.72, gy + gh * 0.89).closePath().fill({ color: 0, alpha: 0.55 });
          shade.label = 'exit-doorway-shade'; depth(shade, y, false);
        }
        if (tex && o?.seal) depth(new Graphics().rect(x * tile, y * tile, tile, tile).fill({ color: 0x6FB7FF, alpha: 0.35 }), y, false);
        else if (o?.drawn) { const d = doorGraphic(floor, x, y, t, o.side, tile); if (d) depth(d, y, false); }
      }
    }],
    ['props', propsKey, depth => {
      // Item drawn under a prop (Justin 2026-10-17: "items to be picked up drawn under a map object?"): each standing prop
      // marks the cells it covers with its depth, so loot on one of them is drawn just above it (1.7: a floor item is never
      // under a prop on its own tile). A hoard's ice block keeps its treasure inside.
      propOver = new Map(); if (cache) cache.propOver = propOver;
      for (const p of realm?.ownsProps ? [] : floor.props ?? []) {
        const s = propSprite(p, tile, now, floor);
        if (!s) continue;
        s.prop = p; depth(s, p.y + (p.h ?? 1) - 1, p.id === 'rubble' || !!s.flat);   // prop: Upheaval's heave (map-view.js)
        if (s.zIndex !== -1) for (let y = p.y; y < p.y + (p.h ?? 1); y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) {
          const k = y * floor.w + x, o = propOver.get(k);
          propOver.set(k, p.hoard || o === 'hoard' ? 'hoard' : Math.max(o ?? -Infinity, s.zIndex));
        }
      }
      // Justin 2026-10-19: "chain shirt should be above bushes": a bush or a vegetation spot's plant (ground-view.js, at its
      // depth among the bodies) covers its own cell and the one north of it, so loot there is drawn just above it too.
      const plants = [...(floor.props ?? []).filter(p => p.id === 'bush').map(p => [p, 1]), ...(floor.biome === 'caverns' ? [] : floor.spots ?? []).map(p => [p, 2])];
      for (const [p, d] of plants) for (const y of [p.y - 1, p.y]) {
        const k = y * floor.w + p.x, o = propOver.get(k);
        if (y >= 0 && o !== 'hoard') propOver.set(k, Math.max(o ?? -Infinity, (p.y + 1) * tile - d));
      }
    }],
    ['sconces', tilesKey, depth => {
      // WT2: the Crypt sconces' soul-green fires, over their wall, glowing in the dark (crypt-look.js, light-layer.js).
      if (floor.biome === 'crypt' && !realm) for (const s of cryptSconceFlames(floor, tile)) depth(s, s.row, false);
    }],
    ['traps', propsKey + json(floor.traps), depth => {
      // Found traps only (traps 78, 97-99); a hidden one draws nothing.
      for (const t of floor.traps ?? []) {
        if (t.found && t.kind === 'spikes') { depth(spikeTrap(t, tile), t.y, true); continue; }
        if (!t.found || !hasSheet(TRAPS)) continue;
        // RC26 (1.7 render.js drawOrdinaryTrap): under a prop only what leaks out shows (a vent's glow and wisps, a spark
        // arc, dart tips at the prop's feet), never the plate.
        const covered = (floor.props ?? []).some(q => q.x === t.x && q.y === t.y);
        if (covered && /^(dart|fire|gas|frost|spark)$/.test(t.kind)) { const g = new Graphics(); g.trapFx = { kind: t.kind, x: t.x, y: t.y, tile }; trapLeak(g, 0, false); depth(g, t.y, false); continue; }
        const tex = sheet(TRAPS).textures[`traps/trap-${t.kind}`];
        if (tex && t.kind === 'alarm') { for (const s of alarmBell(tex, t, tile)) depth(s, t.y, true); continue; }
        if (tex) depth(objSprite(tex, t.x, t.y, tile, { fit: 0.8, alpha: 0.9 }), t.y, true);
      }
    }],
    ['marks', json(floor.marks), (depth, out) => { out.push(...buildMarks(floor, tile)); }],
    ['chests', json(floor.chests), depth => {
      // Chests (W38): 1.7 fits the chest to 0.85 of the tile, centred; a mimic looks like a wooden chest.
      for (const c of floor.chests ?? []) {
        // PL3 (1.7 portals.js openPlaneChest): a plane's rune chest wears its own art and, once opened, the open wooden chest.
        const art = c.art ?? (c.kind === 'mimic' ? 'chest-wood' : c.kind.startsWith('chest-') || c.kind === 'crate-supply' ? c.kind : `chest-${c.kind}`);   // the Caverns' survey camp names its crate by kind
        // Item 121 (Justin 2026-10-17: "this immage doesn't change when looted, my suggestion is to turn it into broken"):
        // a looted supply crate lies broken, in the wood pieces a smashed crate leaves (debris-view.js, item 101).
        if (c.open && art === 'crate-supply') { for (const s of debrisSprites({ debris: [{ x: c.x, y: c.y, id: 'crate-supply', family: 'crate' }] }, tile)) depth(s, 0, true); continue; }
        // 1.7 systems.js openChest: every opened chest (iron, ornate, crystal, elemental too) becomes the open wooden chest.
        const tex = (c.open && (objArt('chests', art + '-open') || objArt('chests', 'chest-wood-open'))) || objArt('chests', art) || objArt('chests', 'chest-ornate');
        if (tex) depth(objSprite(tex, c.x, c.y, tile, { fit: 0.85 }), c.y, false);
      }
    }],
    ['items', propsKey + json(floor.items) + json(sigils), (depth, out) => {
      // Items on the floor: the item's own picture at 1.7's size for its kind, a little below the centre.
      for (const i of floor.items ?? []) {
        if (sealedTreasure(floor, i)) continue;   // item 290 (1.7 render.js:2271): a crystal vault's treasure lies unseen in its crystal
        const it = i.item, over = propOver.get(i.y * floor.w + i.x), n0 = out.length;
        if (it.kind === 'heart' || it.kind === 'globe') { out.push(globeSprite(i, tile, now)); continue; }
        const name = itemArtName(state, it);   // item 325: the name every window draws it by too (art.js)
        // E11: a sigil wears its run's rune, drawn in code as 1.7's (render/runes.js); the plain sigil art until the run gives one.
        const tex = runeTexture(name) ?? smoothLoot(objArt('items', name));
        if (!tex) continue;
        // A20: no ellipse under a floor item (1.7 render.js:2268-2296 draws none).
        if (it.kind === 'key') {
          // RC5 (Justin 2026-09-17: keys on stone were impossible to spot): a breathing blue glow and a few ice glints.
          const glow = new Sprite(lootGlow()); glow.anchor.set(0.5); glow.position.set((i.x + 0.5) * tile, (i.y + 0.58) * tile); glow.width = glow.height = tile * 1.24;
          glow.tint = it.key === 'crystal' ? 0xA0E6FF : 0x78BEFF; glow.alpha = 0.55; glow.blendMode = 'add';   // added, so the light pass over the floor can't drown it
          const glints = [0, 1, 2].map(k => { const d = new Graphics().rect(-1, -1, 2, 2).fill({ color: 0xE8FAFF }); d.position.set((i.x + 0.2 + 0.6 * hash2(i.x, i.y, 80 + k)) * tile, (i.y + 0.25 + 0.6 * hash2(i.x, i.y, 90 + k)) * tile); d.phase = 6.28 * hash2(i.x, i.y, 100 + k); d.alpha = 0; return d; });
          glow.loot = { key: true, x: i.x, y: i.y, glints };
          glow.lootAt = i; depth(glow, i.y, true); for (const d of glints) { d.lootAt = i; depth(d, i.y, true); }
        }
        if (it.kind === 'mote' && MOTE_COL[it.el]) {
          const glow = new Graphics().circle((i.x + 0.5) * tile, (i.y + 0.58) * tile, tile * 0.2).fill({ color: MOTE_COL[it.el] });
          glow.blendMode = 'add'; glow.alpha = 0.18; glow.loot = { mote: true, x: i.x }; glow.lootAt = i;
          depth(glow, i.y, true);
        }
        const s = objSprite(tex, i.x, i.y, tile, { fit: ITEM_FIT[it.kind] ?? 0.5 });
        s.item = { kind: it.kind, x: i.x, y: i.y };   // the light layer shows gear and food unlit while in sight (audit RL10)
        s.y += tile * 0.08;
        s.loot = { bob: true, x: i.x, y: i.y, y0: s.y, tile };
        depth(s, i.y, true);
        if (typeof over === 'number') out.slice(n0).forEach((q, k) => { q.zIndex = over + 0.1 + k * 0.01; });   // over the prop, in its own order
      }
    }],
  ];
  const list = [], rebuilt = new Set();
  for (const [name, key, build] of groups) {
    let g = cache?.groups[name];
    if (!g || g.key !== key || g.sprites.some(q => q.destroyed)) {
      const out = [];
      build((q, y, flat) => { q.zIndex = flat ? -1 : (y + 1) * tile - 1; out.push(q); }, out);
      g = { key, sprites: out }; rebuilt.add(name);
      if (cache) cache.groups[name] = g;
    }
    list.push(...g.sprites);
  }
  if (realm) list.push(...realm.sprites);
  list.rebuilt = rebuilt;
  return list;
}

