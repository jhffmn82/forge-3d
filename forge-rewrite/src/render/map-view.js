// The map: terrain, bodies and floating numbers, with a camera that follows the hero. Reads game state; never writes it.
// Its parts (M10, render-28): map-floor.js, map-sight.js, map-bodies.js, map-remains.js, map-overlays.js, map-words.js and
// map-fog.js; this file holds the layers, the looks and the state they share.

import { Container, Graphics, Sprite } from '../../../forge-godot/runtime/pixi.js';
import { buildTerrain } from './terrain.js';
import { buildCaveTerrain } from './cave-terrain.js';
import { remainsSprite } from './actor-sprite.js';
import { hasSheet, loadSheet, sheet, readable } from './art-store.js';
import { createLighting } from './lighting.js';
import { buildStructures } from './structures.js';
import { mapTilePx } from './map-tile.js';
import * as blocks from './looks/blocks.js';   // Options > Map art > Blocks (RC6)
import { buildGround } from './ground-view.js';
import { createPieces } from './fx-kit.js';
import { realmTerrain } from './realm-view.js';
import { realmClock } from './realm-kit.js';
import { realmStructures } from './realm-pieces.js';
import { clarityFilter } from './map-fog.js';
import { createBodies } from './map-bodies.js';
import { createRemains } from './map-remains.js';
import { createOverlays } from './map-overlays.js';
import { createWords } from './map-words.js';
import { createFloor } from './map-floor.js';
import { createSight } from './map-sight.js';
import { createAirMotes } from './air-motes.js';

export function createMapView(clock) {
  realmClock(clock);   // the Realm's motion holds under reduced motion (realm-view.js)
  // A render group: moving the camera moves one transform on the GPU, not every sprite's on the CPU each frame.
  const root = new Container({ isRenderGroup: true });
  const ground = new Container(), groundCover = new Container(), fog = new Sprite(), actors = new Container(), floaters = new Container();
  actors.sortableChildren = true;
  const light = createLighting(clock, () => view, { sheet, hasSheet, readable });
  const aim = new Graphics(), beaconLayer = new Container();   // over the light: beacons and water glints (beacons.js)
  const marks = new Container();   // D11: the key holder's key, over the light
  const remainsLayer = new Container();   // FX14: bodies left on the floor, under the living (1.7 drawDeathRemains)
  remainsLayer.sortableChildren = true;
  const terrainLit = new Container();
  // M10 (render-28): what the view's parts share and change (map-floor.js, map-sight.js, map-bodies.js, map-remains.js,
  // map-overlays.js): the sight last set, the pieces drawn, the ground's layers, the floor last shown and its remains.
  const inner = { sight: null, calmHero: null, emberCells: [], prepared: null, structures: [], objAnim: null, cover: { under: null, over: [], swaying: [] },
    paint: null, beacons: null, groundOf: null, markOf: null, remainsOf: null, remainsDirty: false, stairsOf: null };
  const sprites = new Map();
  // gearOf(hero): what the hero holds, set by main from src/render/held.js (the held-weapons session's file).
  const view = { lighting: true, root, tile: 64, screenW: 0, screenH: 0, scale: 1, camera: { x: 0, y: 0 }, follow: null, resolution: 1, gearOf: null, look: 'painted' };
  view.lightLayer = light;   // dev and tools/lighting: bake timings (light.stats)
  // Options > Map zoom (1.7 options.js MAP_ZOOM_MUL): the map's scale over the stage's, set by main (CH-09, RB36).
  view.zoom = null; view.touch = false;   // RB36: Map zoom's tile-count multiplier (null: the device's default) and touch
  // Options > High contrast (1.7 render.js CLARITY_FILTER, phoneActorClarity): bodies and floor loot drawn at
  // brightness 1.2 with a faint dark keyline so they stand off the floor; on by default on touch. One filter shared by
  // every body (CH-09, RC32; map-fog.js clarityFilter).
  const CLARITY = clarityFilter();
  view.contrast = false;
  const clarity = node => { if (node && !node.destroyed) node.filters = view.contrast ? [CLARITY] : null; };
  view.setContrast = on => {
    if (view.contrast === !!on) return;
    view.contrast = !!on;
    for (const s of sprites.values()) clarity(s.root);
    for (const s of inner.structures) if (s.item || s.globe) clarity(s);
  };
  // The spells' set pieces and bolts (fx-kit.js), over the light and the marks; seenTile keeps them to what is in sight.
  const pieces = createPieces(view, clock);
  // The map's layers, bottom to top, in this one place (item 169). The ground group is lit in one pass (RL12; lighting's
  // terrainHost): the terrain (its floor, liquids, walls, their trim, and what hangs on the walls over the trim: item 198)
  // and its paint, the ground cover (grass beds and blades), the flat pieces (light.flats:
  // stairs, rubble, traps, flat props, loot), the last three lit as flat ground, never as stone relief (1.7). Then the
  // hanging stone, gear and food in sight unlit, the dead, the living and what stands (by depth), the light, beacons,
  // the air's motes (item 210: shaft dust, embers, mist), the fog (sandbox 92: over the light and glows), marks, the
  // spells' pieces, the vignette, the aim, floating words.
  terrainLit.addChild(ground, groundCover, light.flats);
  light.terrainHost(terrainLit);
  root.addChild(terrainLit, light.under, light.unlit, remainsLayer, actors, light.root, beaconLayer, createAirMotes(view, clock).root, fog, marks, pieces.root, light.over, aim, floaters);
  view.pieces = pieces;
  view.embers = () => inner.emberCells;
  view.seenTile = (x, y) => !!inner.sight && x >= 0 && y >= 0 && x < inner.sight.w && y < inner.sight.h && !!inner.sight.vis[y * inner.sight.w + x];
  view.floor = () => inner.markOf?.floor ?? null;   // the floor last shown (the spells' pictures keep to open ground)
  // FX29, FX30: the living hero and where his sprite stands, for the auras of his long buffs (auras.js via fx-kit.js)
  view.auraHero = () => { const id = inner.sight?.player, a = id && inner.sight.actors?.[id], s = a && sprites.get(id); return s?.root && !s.root.destroyed && s.root.visible ? { actor: a, x: s.root.x, y: s.root.y } : null; };
  // Upheaval (1.7 environment-props.js fit, elements.js:441): each rock heaves up out of the floor from its base over
  // 420 ms, at the moment the cast lets go for it. heave([{x, y, at}]): at is ms from now on the pieces' clock.
  const heaves = new Map();
  view.heave = list => { for (const h of list) heaves.set(h.x + ',' + h.y, pieces.now + h.at); };
  // RB33 (1.7 ACTOR_LIFT, Justin 2026-10-11): a body stands a third of a tile up in its square, shadow, bars and marks too.
  const lift = () => look().lift(view.tile);
  const centre = (x, y) => ({ x: (x + 0.5) * view.tile, y: (y + 1) * view.tile - lift() });

  const look = () => LOOKS[view.look], lookCtx = { get tile() { return view.tile; }, clock };
  // shownTile: device pixels a tile covers on screen (the Underdark bakes its caves that fine, up to 128, WT10).
  const shownTile = () => Math.round(view.tile * (view.scale || 1) * (view.resolution || 1));
  const paintedTerrain = state => (takePrepared(state) ?? realmTerrain(state, view.tile, view) ?? (state.floor.biome === 'caverns' ? buildCaveTerrain(state.floor, view.tile, { seed: state.seed, floorNo: state.floorNo }) : buildTerrain(state.floor, state.floor.biome === 'crypt' ? 'crypt' : 'dungeon', view.tile, { seed: state.seed, floorNo: state.floorNo, shown: shownTile() })));   // the Realm's islands and void, the planes' rock (realm-view.js); the Caverns' rock and chasms (cave-terrain.js)
  // The ground paint (liquids, moss, marks) sits in the terrain's liquids layer, under the walls (terrain.js), so a
  // pool or a splash never covers a wall; terrain without that layer keeps it over the ground.
  const holdPaint = () => { if (inner.paint) inner.paint.parent?.removeChild(inner.paint); };
  const placePaint = () => { if (inner.paint) (ground.children[0]?.liquids ?? groundCover).addChildAt(inner.paint, 0); };
  const k = { view, clock, inner, root, ground, groundCover, fog, actors, floaters, light, aim, beaconLayer, marks, remainsLayer, sprites, pieces,
    clarity, CLARITY, heaves, lift, centre, shownTile, look, lookCtx, holdPaint, placePaint, hasSheet, loadSheet, mapTilePx };
  const { paintedBody } = Object.assign(k, createBodies(k));
  // render-18: one object per look, what a floor and its bodies are drawn with (looks/blocks.js; this one).
  const painted = { lift: tile => tile / 3, body: paintedBody, terrain: paintedTerrain, ground: (st, c, dying) => buildGround(st.floor, view.tile, dying),
    structures: (st, c, kept) => buildStructures(st.floor, view.tile, st.now, st, realmStructures, kept), remainsSheet: true, paint: true, beacons: true, objAnim: true, prepare: true, swaps: true,
    remains: (r, c, mirrored) => remainsSprite({ sheet: r.sheet, art: r.art, bigScale: r.bigScale }, view.tile, { size: r.size, mirrored }) };
  const LOOKS = { painted, blocks: blocks.look };
  // WT8: a Realm or plane floor's terrain is built before the floor shows (main.js waits on prepareFloor before setFloor),
  // its chunks over the hero's view drawn (realm-bake.js), and setFloor takes it, so nothing pops in.
  const takePrepared = state => { const p = inner.prepared; inner.prepared = null; if (p && p.floor === state.floor && p.tile === view.tile && !p.t.destroyed) return p.t; p?.t.destroy({ children: true }); return null; };

  // M10: the view's parts, each given k and adding what the later ones use (map-bodies.js above).
  Object.assign(k, createRemains(k), createOverlays(k));
  createWords(k); createFloor(k); createSight(k);
  view.sprite = id => sprites.get(id);
  view.centre = centre;

  /** Screen point (CSS px) to tile. */
  view.tileAt = (px, py) => ({
    x: Math.floor((px - root.x) / view.scale / view.tile),
    y: Math.floor((py - root.y) / view.scale / view.tile),
  });
  // M2 (render-10): bodies, tiles and the screen, all through lift() (RB33: a third of a tile up; Block Art: none).
  view.lift = lift;   // how far up a body is drawn inside its tile (map px)
  /** A body's position in tiles (its foot cell), fractional mid-slide: the inverse of centre(). sp: a body or its root. */
  view.posOf = sp => { const r = sp?.root ?? sp; return { x: r.x / view.tile - 0.5, y: (r.y + lift()) / view.tile - 1 }; };
  view.tileOf = sp => { const p = view.posOf(sp); return { x: Math.round(p.x), y: Math.round(p.y) }; };   // the tile it stands on
  /** RB34 (1.7 travel.js tileAt): the tile under a screen point, and `below`, a body's lift lower: a lifted body's head
   *  covers the tile above it, so a point there may mean that body (map-hover.js liftedTile). Block Art: the same tile. */
  view.pickTile = (px, py) => ({ ...view.tileAt(px, py), below: view.tileAt(px, py + lift() * view.scale) });

  return view;
}

