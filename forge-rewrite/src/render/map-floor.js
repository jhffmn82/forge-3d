// The map's floor (M10, render-28: moved out of map-view.js): preparing and setting a floor, its terrain, the screen
// size, the hero's gear and look, the pieces and the ground drawn again when they change, and bodies that appear.

import { buildTerrain } from './terrain.js';
import { buildGroundPaint } from './ground-paint.js';
import { buildBeacons } from './beacons.js';
import { buildObjAnim } from './objanim.js';
import { realmTerrain, realmFloor } from './realm-view.js';
import { surfaceSalt } from '../lib/noise.js';
import { mapEvent } from './map-events.js';

/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createFloor(k) {
  const { view, inner, ground, groundCover, actors, light, beaconLayer, marks, remainsLayer, sprites, pieces, clarity, CLARITY, heaves, lift, centre, shownTile, look, lookCtx, holdPaint, placePaint, mapTilePx, bodyOf, tombs, remainsShown, keyMarks } = k;
  /** Resolves once the floor's terrain over the hero's view is drawn (only the Realm's and the planes' take time). */
  // WT9: an Underdark floor too, its caves over the view baked (underdark-raster.js ready), as 1.7 held a floor until
  // its terrain cells were built (terrain-workers.js).
  view.prepareFloor = state => {
    const realm = realmFloor(state.floor), deep = !realm && state.floor.biome === 'underdark' && !!state.floor.region;
    if (!look().prepare || !(realm || deep) || state.floor.treasureRoom) return Promise.resolve();
    inner.prepared?.t.destroy({ children: true }); inner.prepared = null;
    const t = realm ? realmTerrain(state, view.tile, view) : buildTerrain(state.floor, state.floor.biome === 'crypt' ? 'crypt' : 'dungeon', view.tile, { seed: state.seed, floorNo: state.floorNo, shown: shownTile() });
    if (!t?.ready) { t?.destroy({ children: true }); return Promise.resolve(); }
    inner.prepared = { floor: state.floor, tile: view.tile, t };
    const hero = state.actors[state.playerId], c = hero ? centre(hero.x, hero.y) : { x: 0, y: 0 };
    const hw = (view.screenW || 1280) / 2 / (view.scale || 1) + view.tile, hh = (view.screenH || 800) / 2 / (view.scale || 1) + view.tile;
    return t.ready(c.x - hw, c.y - view.tile / 2 - hh, c.x + hw, c.y - view.tile / 2 + hh);
  };
  view.setFloor = (state) => {
    pieces.clear(); heaves.clear();
    holdPaint();
    ground.removeChildren().forEach(c => c.destroy({ children: true }));
    ground.addChild(look().terrain(state, lookCtx));
    view.terrainKinds = ground.children[0]?.kindsField?.() ?? null;   // raster terrain's per-pixel kinds for relief (underdark-raster.js)
    view.terrainAccent = ground.children[0]?.accentField?.() ?? null;   // and the light its hot paint gives (1.7's accent)
    actors.removeChildren().forEach(c => c.destroy({ children: true }));
    marks.removeChildren().forEach(c => c.destroy({ children: true })); keyMarks.clear();
    // Item 113 (Justin 2026-10-17: "what/s up with the tiny stairs?"): the flat pieces live in the light's flats layer (RL10), not in actors, so clearing actors left the last floor's stairs, rubble, traps and loot drawn under this one; each rebuild (a new floor, a resize, a tile size) added another copy. They are destroyed here with the rest.
    for (const s of inner.structures) if (!s.destroyed) s.destroy();
    inner.structures = [];
    sprites.clear(); tombs.clear();
    remainsLayer.removeChildren().forEach(c => c.destroy({ children: true })); remainsShown.clear(); inner.remainsOf = state; inner.remainsDirty = true;
    for (const id of state.order) {
      const a = state.actors[id];
      if (a.hp <= 0) continue;
      const s = bodyOf(state, a);
      if (!s) continue;
      const p = centre(a.x, a.y);
      s.root.position.set(p.x, p.y);
      s.root.zIndex = p.y + lift();
      sprites.set(id, s);
      actors.addChild(s.root);
    }
    view.setStructures(state);
    inner.paint?.destroy({ children: true });
    inner.paint = !look().paint || realmFloor(state.floor) && !state.floor.treasureRoom ? null : buildGroundPaint(state.floor, view.tile, surfaceSalt(state.seed, state.floorNo));
    placePaint();
    inner.beacons?.root.destroy({ children: true });
    inner.beacons = !look().beacons ? null : buildBeacons(state.floor, view.tile);
    if (inner.beacons) beaconLayer.addChild(inner.beacons.root);
    view.setGround(state);
    view.follow = sprites.get(state.playerId)?.root ?? null;
    view.refreshGear(state);
    view.setSight(state, false);
    if (view.follow) { view.camera.x = view.follow.x; view.camera.y = view.follow.y - view.tile / 2; }
  };

  /** Redraws the floor and walls alone (a hidden door found turns wall into door). */
  view.setTerrain = state => {
    holdPaint();
    ground.removeChildren().forEach(c => c.destroy({ children: true }));
    ground.addChild(look().terrain(state, lookCtx));
    placePaint();
    view.terrainKinds = ground.children[0]?.kindsField?.() ?? null;
    view.terrainAccent = ground.children[0]?.accentField?.() ?? null;
  };

  /** Sets the screen size in CSS px and the logical scale; the map fills the whole screen. */
  view.resize = (cssW, cssH, s, kind, resolution) => {
    // A new density rebuilds the floor too: the cached terrain texture was drawn at the old one.
    const newDensity = resolution !== view.resolution;
    const cssTile = kind === 'P' ? 40 : 64;
    // RB36: the tile stands as big as 1.7's tile counts make it (ui/core/stage.js mapTilePx), Map zoom included.
    view.screenW = cssW; view.screenH = cssH; view.resolution = resolution;
    CLARITY.setResolution(resolution);   // RC32: the keyline's blur stays 0.45 CSS px
    view.scale = mapTilePx(cssW, cssH, view.touch, view.zoom ?? (view.touch ? 1 : 14 / 12)) / cssTile;
    if (cssTile !== view.tile) { view.tile = cssTile; return true; }
    return newDensity;
  };

  /** Puts the hero's worn gear in his hands (wear is idempotent). */
  view.refreshGear = state => {
    if (!view.gearOf) return;
    const g = view.gearOf(state.hero), mine = id => id === state.playerId || (state.actors[id]?.kind === 'echo' && state.actors[id].owner === state.playerId);
    for (const [id, s] of sprites) if (mine(id)) s.wear(g);   // RC10: the echo holds its owner's gear
  };

  /** RC3: the hero's body drawn again when the look he is drawn in changes (a Tourist, a follower of Chad); its sheet
   *  must be loaded. Returns whether it changed. */
  view.syncLook = (state, id) => {
    const a = state.actors[id], old = sprites.get(id);
    if (!a || !old || !look().swaps || !old.sheet || old.sheet === a.look?.sheet) return false;
    const s = bodyOf(state, a);
    s.root.position.set(old.root.x, old.root.y); s.root.zIndex = old.root.zIndex;
    actors.addChild(s.root); old.root.destroy({ children: true });
    sprites.set(id, s);
    if (id === state.playerId) view.follow = s.root;
    view.refreshGear(state);
    return true;
  };

  /** Doors, stairs and props, sorted with the bodies; drawn again when a door opens or closes. */
  const kept = {};   // kept: M9 (render-25), the pieces' groups between calls (structures.js)
  view.setStructures = state => {
    ground.children[0]?.syncDoors?.(state.floor);   // sandbox 65: an opened door's tile shows floor, a closed one the wall face
    // Only the groups whose inputs changed are drawn again; every piece goes back in its order (addChild moves a kept one).
    const next = look().structures(state, lookCtx, kept), stay = new Set(next), had = new Set(inner.structures);
    for (const s of inner.structures) if (!stay.has(s)) s.destroy();
    inner.structures = next;   // flat pieces (stairs, rubble, traps, flat props, loot) lie under the light, lit as the floor (1.7 'ground'; RL10)
    view.structureSight?.(state);
    // Item 212: telegraphs (warning glows, danger squares, spore warnings) lie on the ground at their own colour, never
    // card-lit among the bodies, where overlapping ones shaded each other into dark blotches.
    for (const s of inner.structures) (s.warn || s.danger || s.sporeWarn ? light.unlit : s.zIndex === -1 && !s.globe ? light.flats : actors).addChild(s);
    for (const s of inner.structures) if (!had.has(s) && (s.item || s.globe)) clarity(s);
    if (inner.objAnim && next.rebuilt && [...next.rebuilt].every(n => n === 'items' || n === 'marks')) return;   // loot, marks: no animated pieces
    // The props' small animations (objanim.js), over the light with the beacons; rebuilt with the props.
    inner.objAnim?.root.destroy({ children: true });
    inner.objAnim = !look().objAnim ? null : buildObjAnim(state.floor, view.tile, inner.structures);   // RB29: every piece drawn, by its art's name
    if (inner.objAnim) { beaconLayer.addChild(inner.objAnim.root); inner.objAnim.update(state); }
  };

  /** Grass, water, splashes and plants (src/render/ground-view.js); drawn again when the ground changes. */
  view.setGround = (state, ev = null) => {
    const fresh = ev?.ground === 2 && ev.by && inner.groundOf?.floor === state.floor ? inner.cover.retile?.(ev.at.x, ev.at.y) : null;   // item 147: a trampled tile redraws its chunk's grass (ground-view.js retile); the paint is unchanged (grass and short grass paint alike)
    if (fresh) { for (const s of fresh) actors.addChild(s); return; }
    inner.groundOf = state;
    // CR13 (1.7 crypt.js:384 animating.has(c.id)): a Shambler's corpse lies down only once its dying body is gone.
    const dying = new Set((state.floor.corpses ?? []).filter(c => sprites.has(c.id)).map(c => c.id));
    inner.cover.under?.destroy({ children: true }); for (const s of inner.cover.over) if (!s.destroyed) s.destroy();
    inner.cover = look().ground(state, lookCtx, dying);
    inner.paint?.repaint(state.floor);   // only the chunks whose ground changed
    if (inner.cover.under) groundCover.addChild(inner.cover.under); for (const s of inner.cover.over) actors.addChild(s);
  };

  /** A body that appears mid-floor (a mimic, a summon, the Maw surfacing): its sprite joins the others. One already
   *  drawn moves to where it now stands (CV14). ev: the 'spawned' event; surfaced: the Maw rises (CV12). */
  view.addActor = (state, id, ev = null) => {
    const a = state.actors[id];
    if (!a || a.hp <= 0) return;
    let s = sprites.get(id);
    if (!s) {
      s = bodyOf(state, a);
      if (!s) return;
      sprites.set(id, s); actors.addChild(s.root);
    }
    const p = centre(a.x, a.y);
    s.root.position.set(p.x, p.y); s.root.zIndex = p.y + lift();
    if (ev?.surfaced) s.rise();
    // EP25 (1.7 ghoul.js:9, :25): a Buried Ghoul digs itself out, facing the hero, at 140 ms a frame.
    if (ev?.emerge) {
      const h = state.actors[state.playerId];
      if (h) s.face((h.x - a.x) * view.tile);
      s.play('emerge').then(run => { if (!s.destroyed) s.idle(run); });
    } else if (ev && a.set === 'unmaker') {
      // CH10 (1.7 unmaker-encounter.js:57 animation 'arrival'): the Unmaker wakes as the gate seals, with its cast.
      s.play('cast').then(run => { if (!s.destroyed) s.idle(run); });
    }
  };
  /** CH1: a body whose picture changed (the Unmaker's next form) is drawn again from its new look. */
  view.redrawActor = (state, id) => { view.remove(id); view.addActor(state, id); return sprites.get(id) ?? null; };
  view.onEvent = (ev, state, load) => mapEvent(view, ev, state, load);   // M9: what each played event redraws (map-events.js)
}
