// The Realm of Chaos and the elemental planes on the map, drawn as 1.7 draws them today (@3c8b312):
// - js/presentation/render/chaos-preview-render.js: the void beyond the islands (a shared sky, each island's haze and
//   the cliffs hanging under its southern edges, side ledges), the islands' terrain by palette (Prism and Cinder on
//   their environment-terrain sheets, Rot and Violet on the natural-rock raster, ./realm-raster.js), chains, filaments,
//   tendrils, the Crucible's floor inlays, the portals' glows, and the palette maps 1.7 lays over shared prop art;
// - chaos-preview-art.js and cryptset.js drawSetSprite: focals, portals and the true forge at their footprint, on their
//   idle strips; js/presentation/render/cavernrender.js drawCaveProp and cryptpack.js packDraw: cave and plane pieces at
//   their natural size; environment-props.js fit: the shrinks;
// - chaos-current-render.js: the currents and the material gateway; unmaker-preview.js drawGate: the Crucible's gates
//   by phase; unmaker-encounter.js and unmaker-pylon-art.js: the pylons with their I / II / III labels;
//   chaos-enemy-art.js drawHazards: poison patches; planesfwa.js: lava crust and heat, the deep water, wind streaks,
//   updraft vents; portals.js drawPortalTelegraphs: the plane portal's swirl (spec/planes.md 24).
// map-view.js, terrain.js's caller, structures.js and ground-view.js call in through small hooks. Presentation only: it
// writes no game state (the portal, gateway and island lights are born with the floor, world/floor-lights.js, W3).
// M10 (render-28): this file keeps the terrain; the pieces are realm-pieces.js's, with realm-props, realm-life and
// realm-hazards; the void realm-void.js's, the palettes realm-palette.js's, the shared helpers and sheets realm-kit.js's.

import { Container } from '../../../forge-godot/runtime/pixi.js';
import { T, G } from '../data/tiles.js';
import { buildTerrain } from './terrain.js';
import { ROCK } from '../data/rock.js';
import { rasterChunk } from './realm-raster.js';
import { rasterFields, rockPixels, wallDistance, kindsField, accentField, rockOutline } from './realm-fields.js';
import { chasmCell } from './realm-ground.js';
import { surfaceSalt } from '../lib/noise.js';
import { createBaker } from './realm-bake.js';
import { sheet, hasSheet, VC, RS, RC, wallish, SALTS, motionSalt, STATES, liveState } from './realm-kit.js';
import { voidScene } from './realm-void.js';

export const planeSalt = motionSalt;   // for the light: the plane's vein and crystal spots (plane-anim.js planeVeinSources)
/** A floor this module draws (the Realm, its treasure room, a plane). */
export const realmFloor = f => !!(f && (f.chaos || f.plane || f.treasureRoom));

/** The floor and walls of a Realm or plane floor, or null for any other floor (map-view.js falls back to terrain.js). */
export function realmTerrain(state, tile, view) {
  const floor = state.floor;
  // The treasure room is Dungeon masonry (its relief palette is floor.palette, W8, so terrain.js sees no regions).
  if (floor?.treasureRoom) return buildTerrain(floor, 'dungeon', tile, { seed: state.seed, floorNo: state.floorNo });
  if (!floor?.chaos && !floor?.plane) return null;
  const W = floor.w, H = floor.h, root = new Container(), layers = [];
  const salt = surfaceSalt(state.seed, state.floorNo ?? 1) + 911;
  SALTS.set(floor, salt); STATES.set(floor, { state, view });
  const ch = floor.chaos, regions = ch?.regions ?? [];
  const palAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : ch ? regions[ch.regionOf[y * W + x]]?.palette ?? null : null);
  // Prism and Cinder islands: their environment-terrain sheets, through terrain.js, each on a floor holding only its islands.
  if (ch) for (const pal of ['prism', 'cinder']) {
    if (!regions.some(r => r.palette === pal)) continue;
    const masked = { ...floor, tiles: floor.tiles.map((t, i) => (regions[ch.regionOf[i]]?.palette === pal ? t : T.CHASM)), props: [], lights: [], region: undefined };   // no region: terrain.js would take it for the Underdark's
    const t = buildTerrain(masked, pal, tile, { seed: state.seed, floorNo: state.floorNo });
    root.addChild(t); layers.push(t);
  }
  // The natural-rock raster: every cell of a plane, the Rot and Violet islands.
  const matAt = floor.plane ? (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : ROCK[floor.plane]) : (x, y) => { const p = palAt(x, y); return p === 'rot' || p === 'violet' ? ROCK[p] : null; };
  const wall = rockOutline(matAt, (x, y) => x < 0 || y < 0 || x >= W || y >= H || wallish(floor.tiles[y * W + x]));
  const dist = wallDistance(W, H, wall);
  const pool = new Float32Array(W * H);
  for (const i of floor.poolField ?? []) pool[i] = 1;
  if (floor.plane) floor.tiles.forEach((t, i) => { if (t === T.WATER || t === T.LAVA) pool[i] = 1; });
  for (const p of ch?.pools ?? []) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (matAt(x, y)) pool[y * W + x] = 0.62;
  // The raster's fields as plain data (realm-fields.js rasterFields), so the workers paint from the same (realm-bake.js).
  const mats = [], mat = new Uint8Array(W * H), wallA = new Uint8Array(W * H), moss = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, M = matAt(x, y), k = M ? Object.keys(ROCK).find(n => ROCK[n] === M) : null, g = floor.ground?.[i];
    if (k) { if (!mats.includes(k)) mats.push(k); mat[i] = mats.indexOf(k) + 1; }
    wallA[i] = wall(x, y) ? 1 : 0; moss[i] = g === G.MOSS || g === G.GRASS ? 1 : 0;
  }
  const rockM = hasSheet('environment-terrain-cave-rock') ? rockPixels(Object.values(sheet('environment-terrain-cave-rock').textures)[0].source) : null;
  const fluidM = floor.plane && floor.plane !== 'fire' && hasSheet('environment-terrain-fluid-detail') ? rockPixels(Object.values(sheet('environment-terrain-fluid-detail').textures)[0].source) : null;
  const data = {
    W, H, salt, pool, mats, mat, wall: wallA, moss, dist, center: floor.plane ? floor.centre ?? null : null, suns: floor.suns ?? [],
    rock: rockM?.red ? { red: rockM.red, w: rockM.w, h: rockM.h } : null,
    fluid: fluidM?.red ? { red: fluidM.red, w: fluidM.w, h: fluidM.h } : null,
  };
  const F = rasterFields(data);
  // What a chunk's picture is painted from, over it and 3 cells round (the raster reads a little beyond its chunk): a
  // rebuild (a resize, a hidden door found) takes an earlier picture only while this is unchanged (realm-bake.js).
  const sig = (cx, cy, cw, chh) => {
    let h = 2166136261;
    for (let y = Math.max(0, cy - 3); y < Math.min(H, cy + chh + 3); y++) for (let x = Math.max(0, cx - 3); x < Math.min(W, cx + cw + 3); x++) {
      const i = y * W + x;
      h = Math.imul(h ^ (wallA[i] | mat[i] << 1 | moss[i] << 5 | Math.min(255, dist[i]) << 8 | Math.round(pool[i] * 100) << 16), 16777619);
    }
    return (h >>> 0).toString(36);
  };
  const jobs = [];
  const raster = new Container(); root.addChild(raster);
  for (let cy = 0; cy < H; cy += RC) for (let cx = 0; cx < W; cx += RC) {
    const cw = Math.min(RC, W - cx), chh = Math.min(RC, H - cy);
    let any = false;
    for (let y = cy; y < cy + chh && !any; y++) for (let x = cx; x < cx + cw; x++) if (matAt(x, y) || chasmCell(F, x, y)) { any = true; break; }   // item 185: the void beside the land holds its cliff
    if (any) jobs.push({ box: [cx * tile, cy * tile, (cx + cw) * tile, (cy + chh) * tile], build: () => rasterChunk(F, cx, cy, cw, chh, RS), raster: { cx, cy, cw, ch: chh, S: RS }, key: `r${cx},${cy}:${sig(cx, cy, cw, chh)}`, into: raster, w: cw * tile, h: chh * tile });
  }
  // The void (Realm floors only): sky and hanging rock beyond the islands, then the ornaments that cross the land.
  if (ch) {
    const sky = new Container(); root.addChild(sky);
    const scene = voidScene(floor);
    for (let cy = 0; cy < H; cy += VC) for (let cx = 0; cx < W; cx += VC) {
      const cw = Math.min(VC, W - cx), chh = Math.min(VC, H - cy);
      jobs.push({ box: [cx * tile, cy * tile, (cx + cw) * tile, (cy + chh) * tile], build: () => scene(cx, cy, cw, chh), key: `v${cx},${cy}:${sig(cx, cy, cw, chh)}`, into: sky, w: cw * tile, h: chh * tile });
    }
  }
  // Painted by realm-bake.js: by workers, nearest the camera first and then ahead; the view before the floor shows.
  // WT7: at full detail the first time, capped as 1.7 caps its 128 px cells (environment-terrain.js cap: twice the
  // view's cells and 3 round, at most 768 cells on a touch screen). The chunks are coarser than 1.7's cells, so the cap
  // is never under 768 cells (48 MiB), and a desktop's never under 1536 (96 MiB): the ring round the view stays painted.
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const px = view ? tile * (view.scale || 1) : 0, viewCells = px ? 2 * ((view.screenW || 1280) / px + 3) * ((view.screenH || 800) / px + 3) : 0;
  const cells = !view ? 0 : touch ? 768 : Math.max(1536, Math.ceil(viewCells));
  const baker = createBaker({ data: jobs.some(j => j.raster) ? data : null, jobs, far: 8 * tile, cap: cells * RS * RS * 4, floor });   // the keys: a rebuild takes the chunks already painted
  // Proof items 1-3 (sandbox lead 2026-10-17): with the sandbox's Reveal map or Map mode on, the whole floor is shown, so
  // the cap is lifted (desktop) or doubled (touch, 1536 tiles) and every chunk is painted, nearest the view first; normal
  // play keeps WT7's cap. Revealed: Map mode, or a floor whose every cell is seen (looked at once per seen array).
  const capCells = n => n * RS * RS * 4, wideCap = touch ? capCells(2 * 768) : 0;
  let seenMemo = null, revealedMemo = false;
  const revealed = () => {
    const s = liveState(floor);
    if (!s?.sandbox) return false;
    if (s.sandbox.mapMode) return true;
    if (s.seen !== seenMemo) { seenMemo = s.seen; revealedMemo = !!s.seen?.length && s.seen.every(Boolean); }
    return revealedMemo;
  };
  Object.defineProperty(root, 'pending', { get: () => baker.pending });
  root.baker = baker;
  /** map-view.js prepareFloor: resolves once the chunks over this box (map pixels) are drawn. */
  // 1.7 bakeView (windowCells knownOnly): the floor waits on the chunks holding a cell the hero knows, or one beside one
  // (the fog's soft edge shows a little of its neighbours); the rest of the view is black and is painted after.
  const knownNear = j => {
    const s = liveState(floor);
    if (!s?.seen && !s?.vis) return true;
    const x0 = Math.max(0, Math.round(j.box[0] / tile) - 1), y0 = Math.max(0, Math.round(j.box[1] / tile) - 1);
    const x1 = Math.min(W - 1, Math.round(j.box[2] / tile)), y1 = Math.min(H - 1, Math.round(j.box[3] / tile));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (s.seen?.[i] || s.vis?.[i]) return true; }
    return false;
  };
  root.ready = (x0, y0, x1, y1) => baker.ready(x0, y0, x1, y1, knownNear);
  // The relief light's per-pixel kinds over the raster cells (map-view.js hands it to relief.js setFineKinds).
  let kinds = null;
  root.kindsField = () => (kinds ??= kindsField(F, 16, floor.palette?.at ?? null));
  // The Rot and Violet ground's mineral glow for the light map (map-view.js hands it on as view.terrainAccent).
  let accent;
  // The floors' mineral veins give a weak light of their own: the Chaos islands' and the planes' (Justin 2026-10-16).
  root.accentField = () => (accent === undefined ? (accent = floor.chaos || floor.plane ? accentField(F) : null) : accent);
  // Tools (the board capture): every chunk drawn now, not a few a frame near the camera.
  root.buildAll = () => baker.buildAll();
  // A door opened or closed in play (map-view.js): the island terrain that drew it shows floor or face (terrain.js).
  root.syncDoors = f => { for (const t of layers) t.syncDoors?.(f); };
  root.cull = (x0, y0, x1, y1) => {
    for (const l of layers) l.cull?.(x0, y0, x1, y1);
    if (view) baker.setCap(revealed() ? wideCap : capCells(cells));
    baker.cull(x0, y0, x1, y1);
  };
  root.on('destroyed', () => baker.destroy());
  return root;
}
