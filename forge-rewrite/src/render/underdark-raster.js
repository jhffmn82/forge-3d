// The Underdark's caves per pixel, as 1.7 draws them (js/presentation/render/deeprender.js deepNeedsRaster,
// deepCellRaster, deepRockCol, drawDeepLava, drawDeepSurface; the 'deep' pass of js/world/terrain/environment-terrain.js
// enhanceKernel; the fire ground of js/world/planes/planeterrain.js ptGroundRaster @3c8b312):
// - a cell near the edge of a spider or volcanic cave, or near a change of region, is baked per pixel: an organic
//   outline (smooth for the spider caves, chipped and jagged for the volcanic rock), a cliff face where rock meets the
//   ground below, the rock graded from the painted cave-rock master in the region's colours, lava glowing in the
//   basalt's seams; floors from the region's own floor sheet (the same cells terrain.js lays), darkened under a face
//   and beside rock; open volcanic ground is the fire plane's ground, veined with lava;
// - where a hallway crosses from one region into the next, each pixel takes its region from a noise-warped
//   neighbour, so the stone changes set along a ragged line, with a little rubble on the seam (rooms keep their own);
// - lava: the lava-flow master drifting two ways and breathing, cut to a rounded edge that keeps off the rock, a
//   basalt crust round it and a bright rim on top;
// - webbing draped on the spider caves' faces, glowing cracks on the volcanic faces.
// - solid rock in the spider and volcanic regions is that graded rock everywhere, a little darker away from the caves
//   (environment-terrain.js naturalRockTop, deepDim); all open volcanic ground is the fire ground (masonrySample).
// terrain.js asks covers(x, y) and leaves those cells to this. Baked in 4 x 4 cell chunks, nearest the camera first
// (underdark-chunks.js); the lava in underdark-lava.js, the light's fields in underdark-fields.js (M10).

import { Container, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet, onRelease } from './art-store.js';
import { T } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { S_MAIN, rasterCells, caveField } from './underdark-bake.js';
import { lavaSprites } from './underdark-lava.js';
import { caveLight } from './underdark-fields.js';
import { openFloor, sendFloor, forgetSheet, startChunks } from './underdark-chunks.js';

export { rasterCells, caveField };
const REGIONS = ['temple', 'underdark', 'volcanic'];

// ---- the temple floor's grout as cooling lava (environment-terrain.js emberGrout, Justin 2026-10-12): only plainly
// red grout changes; heat is how red the paint is times a slow noise that repeats with the master; crust, ember, core.
function emberGrout(data, w, h) {
  const lattice = (ix, iy, n, salt) => {
    ix = ((ix % n) + n) % n; iy = ((iy % n) + n) % n;
    let v = Math.imul((ix * 374761393 + iy * 668265263 + salt * 1442695041) | 0, 1274126177);
    v ^= v >>> 15; v = Math.imul(v, -2048144777); v ^= v >>> 13; return (v >>> 0) / 4294967295;
  };
  const noise = (x, y, n, salt) => {
    const gx = x / w * n, gy = y / h * n, ix = Math.floor(gx), iy = Math.floor(gy);
    let fx = gx - ix, fy = gy - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, n, salt), b = lattice(ix + 1, iy, n, salt), c = lattice(ix, iy + 1, n, salt), d = lattice(ix + 1, iy + 1, n, salt);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  for (let p = 0, i = 0; p < data.length; p += 4, i++) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r < 12 || g > r * 0.5 || b > r * 0.4) continue;
    const x = i % w, y = (i - x) / w, paint = Math.min(1, (r - Math.max(g, b)) / 60);
    let zone = (noise(x, y, 10, 7) * 0.72 + noise(x, y, 44, 11) * 0.28 - 0.43) / 0.2; zone = zone < 0 ? 0 : zone > 1 ? 1 : zone; zone = zone * zone * (3 - 2 * zone);
    const heat = paint * (0.1 + 0.9 * zone);
    let k;
    if (heat < 0.3) { k = heat / 0.3; data[p] = 30 + 30 * k; data[p + 1] = 13; data[p + 2] = 11 - k; }
    else if (heat < 0.62) { k = (heat - 0.3) / 0.32; data[p] = 60 + 82 * k; data[p + 1] = 13 + 9 * k; data[p + 2] = 10 + 2 * k; }
    else { k = (heat - 0.62) / 0.38; data[p] = 142 + 78 * k; data[p + 1] = 22 + 42 * k; data[p + 2] = 12 + 10 * k; }
  }
  return data;
}

// ---- pixels of the loaded sheets, read once
const pixelCache = new Map();
let nextSheetId = 1;   // a sheet's pixels go to the workers once under this id
// WT18 (1.7 environment-terrain.js:100-108): a terrain sheet the loader releases takes its pixels with it, here and in
// the workers (underdark-worker.js 'drop'), so leaving the Underdark frees its masters as 1.7's release did.
onRelease(name => {
  const hit = pixelCache.get(name);
  if (!hit) return;
  pixelCache.delete(name);
  forgetSheet(hit.id);
});
function pixelsOf(name) {
  for (const k of pixelCache.keys()) if (!hasSheet(k)) pixelCache.delete(k);   // WT18: a released terrain sheet's pixels go with it
  if (!hasSheet(name) || typeof document === 'undefined') return null;
  const sh = sheet(name), src = Object.values(sh.textures)[0]?.source;
  if (!src) return null;
  const hit = pixelCache.get(name);
  if (hit?.src === src) return hit;
  try {
    const w = src.pixelWidth, h = src.pixelHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src.resource, 0, 0);
    const key = Object.keys(sh.data.meta.keys)[0];
    const d = g.getImageData(0, 0, w, h).data;
    if (key === 'temple-floor') emberGrout(d, w, h);
    const out = { id: nextSheetId++, src, w, h, d, k: sh.data.meta.keys[key], key, frames: sh.data.frames };
    pixelCache.set(name, out);
    return out;
  } catch { return null; }
}
/** The temple floor master with its ember grout, as a texture for terrain.js's tiles (null until loaded). */
let emberTex = null;
export function emberFloor(tex) {
  const src = tex?.source;
  if (!src || typeof document === 'undefined') return null;
  if (emberTex?.src === src) return emberTex.t;
  const P = pixelsOf('environment-terrain-temple-floor');
  if (!P) return null;
  const c = document.createElement('canvas'); c.width = P.w; c.height = P.h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(P.d), P.w, P.h), 0, 0);
  emberTex = { src, t: Texture.from(c) };
  return emberTex.t;
}

/**
 * The per-pixel caves of an Underdark floor (floor.region), or null on any other floor. Two layers: the container
 * itself (ground pixels, seam rubble, the lava) goes under the liquids and ground paint; its .over (rock pixels and
 * what hangs on the faces) goes over them, so nothing liquid is ever painted on a wall (Justin, 2026-10-16).
 * @returns {null | Container & {over: Container, covers:(x:number,y:number)=>boolean, cull:Function, pending:number, anims:Function[]}}
 */
export function buildUnderdarkRaster(floor, tile, run = {}) {
  if (!floor.region || typeof document === 'undefined') return null;
  // every chunk's first bake is at 64 samples a tile (S_MAIN), here or in a worker; then the fine pass below bakes the near ones again at 128 (WT10)
  const { P, key } = openFloor();
  const F = caveField(floor, run, S_MAIN), { W, H, R, wall, surf, ptSalt, salt, need, covers, pixReg, solid } = F;

  const rockP = pixelsOf('environment-terrain-cave-rock'), detailP = pixelsOf('environment-terrain-stone-detail');
  const mat = REGIONS.map(n => ({ floor: pixelsOf(`environment-terrain-${n}-floor`), face: pixelsOf(`environment-terrain-${n}-face`), top: pixelsOf(`environment-terrain-${n}-top`) }));
  const px = { rockP, detailP, mat };
  if (P) sendFloor(P, key, floor, run, px);

  const root = new Container(), raster = new Container(), decals = new Container(), lavaLayer = new Container();
  const over = new Container(), rockRaster = new Container(), faceDecals = new Container();
  root.addChild(raster, decals, lavaLayer); over.addChild(rockRaster, faceDecals); root.over = over;

  // drawDeepSurface: rubble on a hallway seam between regions; webbing on spider cave faces, cracks on volcanic ones.
  const deco = hasSheet('environment-deco') ? sheet('environment-deco').textures : null;
  const decal = (name, x, y, { dx = 0, dy = 0, s = 1, a = 1 } = {}, into = decals) => {
    const t = deco?.[name]; if (!t) return;
    const sp = new Sprite(t), w = tile * s;
    sp.position.set(Math.round(x * tile + dx * tile + (tile - w) / 2), Math.round(y * tile + dy * tile + (tile - w) / 2)); sp.width = sp.height = Math.round(w); sp.alpha = a;
    into.addChild(sp);
  };
  const ssalt = surf + 530, roomAt = new Uint8Array(W * H), propAt = new Set((floor.props ?? []).map(p => p.y * W + p.x));
  for (const r of floor.rooms ?? []) {
    if (r.cells) for (const k of r.cells) roomAt[k] = 1;
    else for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) roomAt[y * W + x] = 1;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = floor.tiles[i];
    if (t === T.FLOOR && !roomAt[i] && !propAt.has(i) && !floor.ground?.[i]) {
      const seam = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => { const nx = x + ox, ny = y + oy; return nx >= 0 && ny >= 0 && nx < W && ny < H && !wall[ny * W + nx] && R[ny * W + nx] !== R[i]; });
      if (seam && hash2(x, y, ssalt) < 0.75) decal(`${REGIONS[R[i]]}/pebble-${1 + Math.floor(hash2(x, y, ssalt + 1) * 3)}`, x, y, { dx: (hash2(x, y, ssalt + 2) - 0.5) * 0.4, dy: (hash2(x, y, ssalt + 3) - 0.5) * 0.4, s: 0.8 });
    }
    if (t === T.WALL && y + 1 < H && !wall[i + W] && R[i] !== 0 && need[i] === 1 && !propAt.has(i)) {
      const h = hash2(x, y, ssalt + 7);
      if (R[i] === 1 && h < 0.14) decal(`underdark/banner-${hash2(x, y, ssalt + 8) < 0.5 ? 1 : 2}`, x, y, { dy: 0.08, s: 0.9, a: 0.9 }, faceDecals);
      else if (R[i] === 2 && h < 0.1) decal(`volcanic/crack-${1 + Math.floor(hash2(x, y, ssalt + 9) * 3)}`, x, y, { dy: 0.1, a: 0.8 }, faceDecals);
    }
  }

  // ---- lava (drawDeepLava, deepLavaRasters): per flow, a mask and a crust baked once; the flow drifts over the mask.
  const anims = [];
  const lavaArt = hasSheet('environment-terrain-lava-flow') ? Object.values(sheet('environment-terrain-lava-flow').textures)[0]?.source : null;
  lavaSprites(floor, F, tile, lavaLayer, anims, lavaArt);

  const { kindsField, accentField } = caveLight(floor, F, mat);
  root.kindsField = kindsField;
  root.accentField = accentField;
  root.covers = covers;
  root.anims = anims;
  startChunks({ root, over, floor, run, tile, F, px, P, key, raster, rockRaster, lavaLayer });
  return root;
}
