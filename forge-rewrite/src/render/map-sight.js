// What the map shows each turn and each frame (M10, render-28: moved out of map-view.js): setSight (the light, the fog
// and the bodies in sight), the heave of Upheaval's rocks, and the frame loop (camera, culling, motion, marks).

import { Texture } from '../../../forge-godot/runtime/pixi.js';
import tuning from '../../data/tuning.json' with { type: 'json' };
import { cameraOn } from './clock.js';
import { beerHandFree } from './held.js';
import { globeTick, markTick } from './map-marks.js';
import { sway } from './ground-view.js';
import { underdarkTick } from './underdark-look.js';
import { createWardShells } from './ward-view.js';
import { createStatusBadges } from './status-badges.js';
import { slimeTrailLayer } from './realm-hazards.js';
import { createFogPainter } from './map-fog.js';

/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createSight(k) {
  const { view, clock, inner, root, ground, groundCover, fog, actors, floaters, light, remainsLayer, sprites, pieces, heaves, lift, flameCharged, bodyLook, remainsShown, liveRemains, refreshRemains, remainsSight, updateMarks, stairsPointer } = k;
  // RC59: calm: alive, no foe in sight, the beer hand free (1.7 render.js:976 with capstones.js foesInView).
  const calmNow = () => {
    const me = inner.sight.actors?.[inner.sight.player];
    if (!me || me.hp <= 0 || !inner.calmHero || !beerHandFree(inner.calmHero)) return false;
    for (const id in inner.sight.actors) { const a = inner.sight.actors[id]; if (a.side === 'foe' && a.hp > 0 && inner.sight.vis?.[a.y * inner.sight.w + a.x]) return false; }
    return true;
  };

  const heaveFrame = () => {
    if (!heaves.size) return;
    for (const s of inner.structures) {
      const p = s.prop, born = p?.upheaval && heaves.get(p.x + ',' + p.y);
      if (born === undefined || born === false || s.destroyed) continue;
      s.heave ??= { x: s.x, y: s.y, w: s.width, h: s.height };
      const age = pieces.now - born, rise = clock.reduced ? 1 : age < 0 ? 0 : age < 420 ? 1 - Math.pow(1 - age / 420, 3) : 1, k = 0.04 + 0.96 * rise, b = s.heave;
      const ax = b.x + b.w / 2, ay = b.y + b.h;   // from its base
      s.width = b.w * k; s.height = b.h * k; s.position.set(ax + (b.x - ax) * k, ay + (b.y - ay) * k);
    }
    for (const [key, born] of heaves) if (pieces.now - born > 420) heaves.delete(key);
  };

  /** spec/sight.md V11: never seen is black, remembered is shaded, in sight is clear. The fog is 4 pixels a tile (8 on natural rock),
   *  feathered at its edges (setSight). */
  let fogCanvas = null, fogTex = null, fogImg = null;
  // Natural rock (raster terrain) rounds its edge of sight by distance, at 8 pixels a tile so the curve does not step.
  const fogPaints = { built: createFogPainter(), rock: createFogPainter(8, 0.5, [1, 1.3]) };
  const wards = createWardShells(view);   // Bone Ward shells on warded undead (ward-view.js)
  floaters.addChild(wards.root);
  const badges = createStatusBadges(view);   // 1.7 over bodies: status chips, HP bars, burning, the hero's shield bubble (status-badges.js)
  floaters.addChild(badges.root);
  const slime = slimeTrailLayer(clock);   // EP1: the Green Slimes' poison trail, on the ground under the light (realm-view.js)
  groundCover.parent.addChildAt(slime.root, groundCover.parent.getChildIndex(groundCover) + 1);   // groundCover sits in the lit ground group (RL12)
  view.structureSight = state => {
    const f = state.floor;
    for (const s of inner.structures) {
      const p = s.prop ?? s.cell;
      if (!p) continue;
      let known = false;
      for (let y = p.y; y < p.y + (p.h ?? 1) && !known; y++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) {
        if (x >= 0 && y >= 0 && x < f.w && y < f.h && (state.vis?.[y * f.w + x] || state.seen?.[y * f.w + x])) { known = true; break; }
      }
      s.visible = known;   // Tall artwork must not reveal an unseen room over a visible wall.
    }
  };
  view.setSight = (state, fade = true) => {
    view.structureSight(state);
    wards.update(state);
    badges.update(state);
    // RC39: bodies that have not stepped or struck sideways yet keep turning to face the hero.
    const me = state.actors[state.playerId];
    if (me) for (const [id, s] of sprites) { const a = state.actors[id]; if (a && id !== state.playerId) s.watch(me.x - a.x); }
    for (const [id, s] of sprites) if (s.charge) { const a = state.actors[id]; if (a) s.charge(flameCharged(a)); }   // RC4: the flame's third shot
    slime.update(state, view.tile, !!view.lighting);   // EP29: remembered trail at memA(.4)
    inner.beacons?.update(state); inner.objAnim?.update(state);
    // spec/lighting.md: with Lighting on, the light map is the fog (never seen black, remembered in memory colour).
    // Sandbox 92 (Justin 2026-10-17: "i can see behind walls"): the light map left never-seen ground dark blue, with
    // brighter blocks where light reached, so the fog stays on in every look for never-seen cells (solid black, over the
    // light and the glows); with Lighting on the light map still shades the remembered ones.
    light.root.visible = !!view.lighting; fog.visible = true;
    if (view.lighting) light.update(state, view.tile, fade);
    // The relief look (spec/lighting.md L17) lights bodies and props as standing cards; classic and off leave them be.
    actors.filters = view.lighting ? light.actorFilters : null;
    // Item 93 (Justin 2026-10-17: "corpses aren't shaded"): the remains lie under the living and are lit as they are (1.7
    // drew them in its lit floor pass), with the same filter and the visible window as its area.
    remainsLayer.filters = actors.filters; remainsLayer.filterArea = actors.filters ? actors.filterArea ?? null : null;
    light.under.visible = !!view.lighting && light.mode === 'relief';
    const f = state.floor, t = view.tile, shade = tuning.rows.sight.rememberedShade, pad = 48;   // sandbox 92: past the map's edge is black too, not the page
    const w = f.w + pad * 2, h = f.h + pad * 2;
    inner.sight = { vis: state.vis, w: f.w, h: f.h, player: state.playerId, actors: state.actors, state };   // actors: read live for a.hidden (planes M44, M46)
    // the burning cells in sight, which throw embers (fx-kit.js)
    inner.emberCells = Object.keys(f.burning ?? {}).map(Number).filter(k => state.vis?.[k]).map(k => [k % f.w, (k / f.w) | 0]);
    inner.calmHero = state.hero;
    inner.remainsOf = state;
    if ([...remainsShown.keys()].length !== liveRemains().length) inner.remainsDirty = true; else remainsSight();   // expired ones go
    inner.markOf = { floor: f, seen: state.seen, actors: state.actors };
    inner.stairsOf = { floor: f, seen: state.seen, hero: state.actors[state.playerId] };   // RC29
    // The fog (createFogPainter): its buffers kept per floor size, only the changed cells repainted and put.
    const fogPaint = view.terrainKinds ? fogPaints.rock : fogPaints.built, res = fogPaint.update(f, state.vis, state.seen, view.lighting ? 0 : shade, pad);
    let dirty = res.dirty;
    if (!fogCanvas || fogCanvas.width !== res.w || fogCanvas.height !== res.h) {
      fogCanvas = document.createElement('canvas'); fogCanvas.width = res.w; fogCanvas.height = res.h;
      fogTex?.destroy(true);
      fogTex = Texture.from({ resource: fogCanvas, scaleMode: 'linear' });
      fog.texture = fogTex; fogImg = null;
    }
    if (!fogImg || fogImg.data !== res.data) { fogImg = new ImageData(res.data, res.w, res.h); dirty = [0, 0, res.w, res.h]; }
    if (dirty) { fogCanvas.getContext('2d').putImageData(fogImg, 0, 0, dirty[0], dirty[1], dirty[2], dirty[3]); fogTex.source.update(); }
    fog.position.set(-pad * t, -pad * t);
    fog.scale.set(t / fogPaint.fp);
  };

  let windT = 0, sceneryT = performance.now();

  let followSp = null;   // the hero's sprite, whose slide the camera follows
  clock.onFrame(dt => {
    const scenerySpeed = inner.sight?.state?.floor?.biome === 'crypt' ? 0.5 : 1;
    sceneryT += dt * scenerySpeed;
    windT += dt * scenerySpeed / 1000;
    inner.beacons?.tick(sceneryT, clock.reduced); inner.objAnim?.tick(sceneryT, clock.reduced);
    wards.tick(performance.now(), clock.reduced);
    badges.tick(performance.now(), clock.reduced);
    underdarkTick(inner.structures, performance.now(), clock.reduced);   // stirring cocoons twitch (underdark-look.js)
    globeTick(inner.structures, performance.now(), clock.reduced);   // hearts and mana globes pulse, bob and blink (structures.js)
    markTick(inner.structures, performance.now(), clock.reduced, inner.sight);   // coloured telegraphs pulse, in sight only (structures.js)
    // RB24 (1.7 vegart.js vegBody, vegBend): a plant whose tile holds a body leans 0.35 away from it, over the wind.
    const bodyAt = new Map();
    for (const s of sprites.values()) if (s.root.visible && !s.root.destroyed) { const t = view.tileOf(s); bodyAt.set(t.x + ',' + t.y, view.posOf(s).x); }   // M2: the tile it stands on
    for (const w of inner.cover.swaying) {
      if (w.v?.visible === false) continue;
      const bx = bodyAt.get(w.x + ',' + w.y), bend = bx === undefined ? 0 : (bx <= w.x ? -1 : 1) * 0.35;
      w.s.skew.x = -((clock.reduced ? 0 : sway(w.x, w.y, windT)) + bend) * w.k;
    }
    for (const a of inner.cover.anims ?? []) a(windT, clock.reduced, inner.sight);   // the ground's own motion (the Crypt's ooze and wisps; the ooze's in sight only)
    for (const a of ground.children[0]?.anims ?? []) a(performance.now(), clock.reduced);   // the terrain's own (the Underdark's lava)
    if (view.follow && !view.follow.destroyed) {
      // Movement rebuild (feel spec 2.5): the camera is locked to the hero's slide, on the device-pixel grid the pose draws
      // him on, with no lerp: he holds one screen pixel as he walks and nothing drifts after he lands. Item 89 (Justin
      // 2026-10-17: "i don't like the camera moving with the character during attack animations"): a lunge, a bump and
      // the step's hop are left out.
      if (followSp?.root !== view.follow) followSp = [...sprites.values()].find(s => s.root === view.follow) ?? null;
      const f = view.follow, at = (followSp && clock.pos?.(followSp)) ?? { x: f.x - (f.offX ?? 0), y: f.y + (f.hop ?? 0) - (f.offY ?? 0) };
      const cam = cameraOn(at, 1 / (view.scale * view.resolution), view.tile);
      view.camera.x = cam.x; view.camera.y = cam.y;
    }
    if (inner.remainsDirty) refreshRemains();
    for (const [id, s] of sprites) {
      const n = s.size ?? 1;
      const floorY = clock.pos?.(s)?.y ?? s.root.y + (s.root.hop ?? 0) - (s.root.offY ?? 0);
      s.root.zIndex = floorY + lift() + (n - 1) * view.tile;   // Sort by the floor position, independent of hops and attack poses.
      // RC16: the hero is half seen while Hidden (1.7 render.js:2324).
      if (inner.sight && id === inner.sight.player) s.fade(inner.sight.actors?.[id]?.statuses?.hidden ? 0.5 : 1);
      if (inner.sight && id === inner.sight.player && s.calm) s.calm(calmNow());   // RC59: the beer waits for a calm hero
      // V9, V12: a creature shows only while the tile it stands on is in sight; the hero always shows.
      if (inner.sight && id !== inner.sight.player) {
        const { x: tx, y: ty } = view.tileOf(s);   // M2 (render-10): the tile it stands on mid-slide, as the picking names it
        let seen = false;   // a big body shows while any tile of its footprint is in sight (1.7 render.js:1131-1133)
        for (let y = ty; y < ty + n && !seen; y++) for (let x = tx; x < tx + n; x++) if (x >= 0 && y >= 0 && x < inner.sight.w && y < inner.sight.h && inner.sight.vis[y * inner.sight.w + x]) { seen = true; break; }
        s.root.visible = seen && !inner.sight.actors?.[id]?.hidden;   // a Stalker away or a burrowed Burrower is unseen
      }
      if (inner.sight) bodyLook(id, s, inner.sight.actors?.[id]);
    }
    updateMarks(performance.now());
    heaveFrame();
    root.scale.set(view.scale);
    // Chunks within a tile of the screen are drawn; the rest are skipped (terrain and ground layers).
    const hw = view.screenW / 2 / view.scale + view.tile, hh = view.screenH / 2 / view.scale + view.tile;
    for (const layer of [ground.children[0], inner.paint, inner.cover.under]) layer?.cull?.(view.camera.x - hw, view.camera.y - hh, view.camera.x + hw, view.camera.y + hh, view.scale * view.resolution);
    const px = v => Math.round(v * view.resolution) / view.resolution;   // whole device pixels, so art pixels never shimmer
    root.position.set(px(view.screenW / 2 - view.camera.x * view.scale), px(view.screenH / 2 - view.camera.y * view.scale));
    stairsPointer(performance.now());
  });
}
