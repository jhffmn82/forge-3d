// The ground layer on the map, drawn the way 1.7 draws it (js/presentation/render/vegart.js): grass tufts from the
// vegetation sheet (back tufts under bodies, a front tuft over whoever stands in tall grass), plants on the
// vegetation spots. Water, moss, puddles, blood, scorch, tells and bones are painted (src/render/ground-paint.js). Everything sways in a slow wind
// unless motion is reduced. Cells are picked by world position, so nothing changes as the camera moves.

import { Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { T, G } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import { CHUNK } from './terrain.js';
import { cryptShroom, cryptGroundLife, lyingCorpses, shroomGlowAnim } from './crypt-life.js';
import { underdarkPlant } from './underdark-look.js';
import { boxOn } from './chunks.js';

const VEG = 'environment-vegetation';
const GRASS_ALPHA = 0.78, DUNGEON_TINT = 0x9ea08f;   // vegart.js VEG_GRASS_A and the Dungeon's darkening (0.38 toward #2A2E1C)
const UNDERDARK_TINT = 0xcbcacf;                      // deeprender.js VEG_DIM.underdark: 0.22 toward #1A1426
const CAVERNS_TINT = 0xc4c8ca;                        // vegart.js VEG_DIM.caverns: 0.25 toward #14222A
export const EARTH_TINT = 0xd3d4d1;                   // vegart.js VEG_DIM.earth: 0.2 toward #23261A
const CLUSTERS = 'environment-vegetation-clusters';
const SPREADS = 'environment-mushroom-spreads';

/** The wind: a slow wave across the map plus a flutter (vegart.js vegSway). */
export const sway = (x, y, t) => (Math.sin(t * 0.9 + x * 0.45 + y * 0.2) * 0.5 + Math.sin(t * 2.3 + x * 1.3 + y * 0.7) * 0.18) * 0.16;

/**
 * @returns {{under: Container, over: Sprite[], swaying: {s: Sprite, x: number, y: number, k: number}[]}} under goes
 *   below the bodies (grass beds and blades); over (plants, bushes) sorts with them; swaying is what the wind moves.
 */
export function buildGround(floor, tile, hide = null) {
  const under = new Container(), over = [], swaying = [];
  under.cull = () => {};
  if (!floor.ground) return { under, over, swaying };
  // Grass under the bodies goes in chunks so off-screen grass is neither drawn nor moved by the wind.
  const chunks = new Map(), CW = Math.ceil(floor.w / CHUNK);
  const chunkAt = (x, y) => {
    const k = Math.floor(y / CHUNK) * CW + Math.floor(x / CHUNK);
    let c = chunks.get(k);
    if (!c) { c = new Container(); const cx = (k % CW) * CHUNK * tile, cy = Math.floor(k / CW) * CHUNK * tile; c.box = [cx - tile, cy - tile * 2, cx + (CHUNK + 1) * tile, cy + (CHUNK + 1) * tile]; chunks.set(k, c); under.addChild(c); }
    return c;
  };
  // vegart.js vegSet: the Earth plane's tufts on the Earth plane; the other planes have no tufts (their grass is
  // plane-anim.js's blades); the Realm's floors none either.
  // Without its sheet the vegetation alone is left out; the Crypt's mushrooms, ooze, wisps and corpses are still drawn.
  const vs = hasSheet(VEG) ? sheet(VEG) : null;
  const set = !vs ? null : floor.plane ? (floor.plane === 'earth' ? 'earth' : null) : floor.chaos ? null : floor.biome === 'underdark' ? 'underdark' : floor.biome === 'caverns' ? 'caverns' : 'dungeon';
  const veg = vs?.textures ?? {}, res = vs?.data.meta.res ?? 1, deep = set === 'underdark', cave = set === 'caverns', earth = set === 'earth';
  const art = name => veg['veg-' + name];
  // vegDraw: bottom centre at (cx, base), size frame x tile/64 x scale / res, sheared by the sway.
  const plant = (tex, cx, base, scale, swayK, alpha, flip, x, y) => {
    if (!tex) return null;
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1); s.position.set(cx, base);
    s.scale.set((flip ? -1 : 1) * (tile / 64) * scale / res, (tile / 64) * scale / res);
    s.alpha = alpha; s.tint = deep ? UNDERDARK_TINT : cave ? CAVERNS_TINT : earth ? EARTH_TINT : DUNGEON_TINT;
    if (swayK) swaying.push({ s, x, y, k: swayK, v: null });
    return s;
  };
  const pickArt = (kind, x, y, salt) => art(`${set}-${kind}-${1 + Math.floor(hash2(x, y, salt) * 3)}`);
  const W = floor.w, glows = [];   // the Crypt mushrooms' halos (crypt-look.js), breathing each frame
  // Item 147: what a tile, a plant spot or a bush puts over the bodies is marked with its chunk, so retile can redo one chunk.
  const keyOf = (x, y) => Math.floor(y / CHUNK) * CW + Math.floor(x / CHUNK);
  const marked = (x, y, fn) => { const n = over.length; fn(); for (let i = n; i < over.length; i++) over[i].chunkKey = keyOf(x, y); };
  const grassAt = (x, y) => {
    const g = floor.ground[y * W + x], px = x * tile, py = y * tile;
    if (floor.tiles[y * W + x] === T.WATER) return;   // water is painted (ground-paint.js), glints drawn by the map
    // A chasm (the greedy vault's collapse): the floor is gone, only the dark below shows (1.7's #050408).
    if (floor.tiles[y * W + x] === T.CHASM && floor.chaos) return;   // the Realm's void is drawn with its terrain (realm-view.js)
    // CV2: in the Dungeon, the Crypt and the Caverns the ground paint draws the chasm, edge and void together (1.7 chsRaster).
    if (floor.tiles[y * W + x] === T.CHASM && !floor.plane && ['dungeon', 'crypt', 'caverns'].includes(floor.biome ?? 'dungeon')) return;
    if (floor.tiles[y * W + x] === T.CHASM) { chunkAt(x, y).addChild(new Graphics().rect(px, py, tile, tile).fill({ color: 0x050408 })); return; }
    const flip = hash2(x, y, 51) < 0.5;
    // The Crypt's grass is its glowing mushrooms (1.7 drawMushroomGrass), trampled ones squashed.
    if (floor.biome === 'crypt' && (g === G.GRASS || g === G.SHORT)) { cryptShroom(x, y, g, tile, chunkAt(x, y), over, glows); return; }
    if (!set) return;
    if (g === G.GRASS) {
      chunkAt(x, y).addChild(plant(pickArt('grass-back', x, y, 55), px + tile * (0.1 + 0.8 * hash2(x, y, 56)), py + tile * 0.62, 0.9, 0.9, GRASS_ALPHA * 0.95, !flip, x, y));
      chunkAt(x, y).addChild(plant(pickArt('grass-back', x, y, 57), px + tile * (0.05 + 0.9 * hash2(x, y, 58)), py + tile * 0.82, 1.05, 1, GRASS_ALPHA, flip, x, y));
      chunkAt(x, y).addChild(plant(pickArt('grass-back', x, y, 54), px + tile * 0.5, py + tile, 1.2, 1, GRASS_ALPHA, flip, x, y));
      // Item 169 (Justin 2026-10-18: "I've also see grass get painted over a ration"): the front blades are ground
      // cover with the rest, under what lies on the floor (traps, loot) and what stands on it.
      chunkAt(x, y).addChild(plant(pickArt('grass-front', x, y, 52), px + tile * (0.3 + 0.4 * hash2(x, y, 53)), py + tile * 1.02, 1, 1.1, GRASS_ALPHA, flip, x, y));
    } else if (g === G.SHORT) {
      chunkAt(x, y).addChild(plant(pickArt('grass-front', x, y, 66), px + tile * (0.05 + 0.9 * hash2(x, y, 67)), py + tile * (0.4 + 0.2 * hash2(x, y, 68)), 0.85, 0.8, GRASS_ALPHA * 0.9, hash2(x, y, 69) < 0.5, x, y));
      chunkAt(x, y).addChild(plant(pickArt('grass-front', x, y, 61), px + tile * (0.1 + 0.8 * hash2(x, y, 62)), py + tile * (0.72 + 0.2 * hash2(x, y, 63)), 1.1, 0.8, GRASS_ALPHA, hash2(x, y, 64) < 0.5, x, y));
      if (hash2(x, y, 65) < 0.6) chunkAt(x, y).addChild(plant(pickArt('grass-front', x, y, 70), px + tile * hash2(x, y, 71), py + tile * (0.95 + 0.1 * hash2(x, y, 72)), 1, 0.8, GRASS_ALPHA, hash2(x, y, 73) < 0.5, x, y));

    }
  };
  for (let y = 0; y < floor.h; y++) for (let x = 0; x < W; x++) marked(x, y, () => grassAt(x, y));
  // The Crypt: ooze pools under the growth, their bubbles, soul wisps (crypt-life.js); a Shambler's corpse on any floor
  // (item 241, Justin 2026-10-20: "the corpse doesn't allways show on the map to be destroyed"); anims run each frame.
  const anims = [...(floor.biome === 'crypt' ? cryptGroundLife(floor, tile, under, over, swaying) : []), ...lyingCorpses(floor, tile, over, hide)];
  if (glows.length) anims.push(shroomGlowAnim(glows));
  // Plants on the vegetation spots: a fern by water, else a bush or a fern (Earth art, as 1.7 borrows it).
  const spotAt = sp => {
    if (floor.tiles[sp.y * W + sp.x] === T.CHASM) return;   // 343: old collapsed saves may still carry plant spots
    if (deep) { underdarkPlant(sp, tile, art, plant, over); return; }   // fungus clumps and ashweed (underdark-look.js)
    if (cave) {   // vegart.js drawOrdinaryPlants: one of five baked groups of one colour, half a tile, on the ground, still (item 239)
      // 1.7 sceneryClusterArt: the newer spread-out mushroom groups (environment-mushroom-spreads, row by colour), else the old clusters.
      const row = Math.floor(hash2(sp.x, sp.y, 71) * 3), v = Math.floor(hash2(sp.x, sp.y, 72) * 5);
      const t = (hasSheet(SPREADS) ? sheet(SPREADS).textures[`props/mushroom-spread-${row}-${v}`] : null) ?? (hasSheet(CLUSTERS) ? sheet(CLUSTERS).textures[`mushroom-${['teal', 'violet', 'amber'][row]}-${v}`] : null);
      const s = t && plant(t, (sp.x + 0.5) * tile, (sp.y + 1) * tile, 0.5 * 64 / t.frame.width * res, 0, 1, hash2(sp.x, sp.y, 77) < 0.5, sp.x, sp.y);
      if (s) chunkAt(sp.x, sp.y).addChild(s);
      return;
    }
    const kind = sp.wet ? 'fern' : hash2(sp.x, sp.y, 78) < 0.55 ? 'bush' : 'fern';   // WT13 (1.7 vegart.js): by water it is always a fern
    const s = plant(art(`earth-${kind}-${1 + Math.floor(hash2(sp.x, sp.y, 79) * 3)}`), (sp.x + 0.5) * tile, (sp.y + 0.95) * tile, 0.85, kind === 'bush' ? 0.35 : 0.8, 1, hash2(sp.x, sp.y, 80) < 0.5, sp.x, sp.y);
    if (s) { s.zIndex = (sp.y + 1) * tile - 2; over.push(s); }
  };
  for (const sp of set ? floor.spots ?? [] : []) marked(sp.x, sp.y, () => spotAt(sp));
  // Cuttable bushes (props): the Earth bush art, swaying a little.
  const bushAt = p => {
    const s = plant(art(`earth-bush-${1 + Math.floor(hash2(p.x, p.y, 91) * 3)}`), (p.x + 0.5) * tile, (p.y + 0.97) * tile, 1, 0.3, 1, hash2(p.x, p.y, 92) < 0.5, p.x, p.y);
    if (s) { s.zIndex = (p.y + 1) * tile - 1; over.push(s); }
  };
  for (const p of floor.props ?? []) if (p.id === 'bush') marked(p.x, p.y, () => bushAt(p));
  sporeGrowth(floor, tile, under, anims);
  // Each swaying sprite follows the visibility of what holds it: its chunk under the bodies, itself above them.
  for (const w of swaying) w.v = w.s.parent && w.s.parent !== under ? w.s.parent : w.s;
  under.cull = (a, b, c, d) => {
    for (const ch of chunks.values()) ch.visible = boxOn(ch.box, a, b, c, d);
    for (const s of over) s.visible = s.x > a - tile && s.x < c + tile && s.y > b - tile && s.y < d + tile * 2;
  };
  /**
   * Item 147 (turn frames of 55-87 ms): a body trampled the grass at (x, y). Only its chunk is drawn again, in the full
   * pass's order (its tiles, then its plant spots and bushes), not every grass sprite on the floor. Returns the chunk's
   * new sprites over the bodies for the map to place, or null (the Crypt's growth carries glows: draw the floor again).
   */
  const retile = (x, y) => {
    if (!set || floor.biome === 'crypt') return null;
    const key = keyOf(x, y), gone = new Set(chunks.get(key)?.removeChildren() ?? []);
    for (const s of over) if (s.chunkKey === key) gone.add(s);
    for (const s of gone) s.destroy();
    for (let i = over.length - 1; i >= 0; i--) if (gone.has(over[i])) over.splice(i, 1);
    for (let i = swaying.length - 1; i >= 0; i--) if (gone.has(swaying[i].s)) swaying.splice(i, 1);
    const n = over.length, sw = swaying.length, x0 = (key % CW) * CHUNK, y0 = Math.floor(key / CW) * CHUNK;
    for (let yy = y0; yy < Math.min(floor.h, y0 + CHUNK); yy++) for (let xx = x0; xx < Math.min(W, x0 + CHUNK); xx++) marked(xx, yy, () => grassAt(xx, yy));
    for (const sp of floor.spots ?? []) if (keyOf(sp.x, sp.y) === key) marked(sp.x, sp.y, () => spotAt(sp));
    for (const p of floor.props ?? []) if (p.id === 'bush' && keyOf(p.x, p.y) === key) marked(p.x, p.y, () => bushAt(p));
    for (const w of swaying.slice(sw)) w.v = w.s.parent && w.s.parent !== under ? w.s.parent : w.s;
    return over.slice(n);
  };
  return { under, over, swaying, anims, retile };
}

// ---------------------------------------------------------------- a spore field's mushrooms (1.7 sporecaller.js plant/ground)
// CSS hue-rotate(180deg) then saturate(.72), the filter 1.7 bakes the Crypt clusters through: the same art, turned green.
const HUE = [-0.574, 1.43, 0.144, 0.426, 0.43, 0.144, 0.426, 1.43, -0.856];
const SAT = (s => [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s])(0.72);
const GREEN = [0, 1, 2].flatMap(r => [0, 1, 2].map(c => SAT[r * 3] * HUE[c] + SAT[r * 3 + 1] * HUE[3 + c] + SAT[r * 3 + 2] * HUE[6 + c]));
const greenPlants = new Map();
/** A spore field's mushroom: a Crypt cluster turned green (variant v of 5), or null until its sheet is in. */
export function greenPlant(v) {
  if (greenPlants.has(v)) return greenPlants.get(v);
  const src = hasSheet(CLUSTERS) ? sheet(CLUSTERS).textures[`mushroom-crypt-${v}`] : null, img = src?.source?.resource;
  if (!src || !img || typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d', { willReadFrequently: true }), f = src.frame;
  g.imageSmoothingEnabled = false; g.drawImage(img, f.x, f.y, 128, 128, 0, 0, 128, 128);
  const d = g.getImageData(0, 0, 128, 128), p = d.data, M = GREEN;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], gg = p[i + 1], b = p[i + 2];
    p[i] = M[0] * r + M[1] * gg + M[2] * b; p[i + 1] = M[3] * r + M[4] * gg + M[5] * b; p[i + 2] = M[6] * r + M[7] * gg + M[8] * b;
  }
  g.putImageData(d, 0, 0);
  const t = Texture.from({ resource: c, scaleMode: 'nearest' });
  greenPlants.set(v, t);
  return t;
}
const lastGrowth = new WeakMap();   // floor -> the mushroom cells drawn last time, so a crushed one puffs
const PUFF = [0xb7e07a, 0x6fa040, 0x4e7a2a];   // 1.7 fx.js poison palette
/**
 * The mushrooms a spore field leaves (state.floor.mushrooms): the Crypt's mushroom clusters turned green, at 0.72 of
 * a tile, footed near the bottom of their cell, still (item 239). One crushed since the last drawing
 * bursts into ten poison motes (1.7 burst(x, y, 'poison', 10, .035)) that drift and fade.
 */
function sporeGrowth(floor, tile, under, anims) {
  const keys = Object.keys(floor.mushrooms ?? {}).map(Number), before = lastGrowth.get(floor);
  lastGrowth.set(floor, new Set(keys));
  const plants = [];
  for (const k of keys) {
    const x = k % floor.w, y = Math.floor(k / floor.w), t = greenPlant((x * 3 + y * 7) % 5);
    if (!t) continue;
    const s = new Sprite(t);
    s.anchor.set(0.5, 1); s.position.set((x + 0.5) * tile, (y + 0.92) * tile); s.width = s.height = tile * 0.72; s.alpha = 0.88;
    s.visible = false;   // until the first frame says whether it is in sight or known (below)
    under.addChild(s); plants.push({ s, x, y, k });
  }
  const motes = [];
  for (const k of before ?? []) {
    if (keys.includes(k)) continue;
    const x = k % floor.w, y = Math.floor(k / floor.w);
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, sp = Math.random() * 0.035, size = 2.6 * (0.7 + Math.random() * 0.8) * tile / 64;
      const s = new Sprite(Texture.WHITE); s.anchor.set(0.5); s.width = s.height = size; s.tint = PUFF[Math.floor(Math.random() * 3)];
      s.position.set((x + 0.5) * tile, (y + 0.5) * tile); under.addChild(s);
      motes.push({ s, k, x0: s.x, y0: s.y, vx: Math.cos(a) * sp * tile, vy: (Math.sin(a) * sp + 0.04) * tile, life: 520 * (0.6 + Math.random() * 0.8), size });
    }
  }
  if (!plants.length && !motes.length) return;
  let born = null;
  anims.push((t, reduced, sight) => {
    // 1.7 ground(): one in sight at .88; one known (seen since it grew) on a remembered tile at memA(.4); else not drawn.
    const vis = sight?.vis, seen = sight?.state?.seen, M = sight?.state?.floor?.mushrooms;
    for (const p of plants) {
      const inSight = !!vis?.[p.k], shown = inSight || (M?.[p.k] === 2 && !!seen?.[p.k]);
      p.s.visible = shown;
      if (!shown) continue;
      p.s.alpha = inSight ? 0.88 : 0.4;
    }
    if (!motes.length) return;
    if (born == null) {   // 1.7 trample bursts only where vis[i]: a crush out of sight makes no puff
      for (let i = motes.length - 1; i >= 0; i--) if (!vis?.[motes[i].k]) { motes[i].s.destroy(); motes.splice(i, 1); }
      if (!motes.length) return;
    }
    born ??= t;
    const age = (t - born) * 1000;
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i], left = 1 - age / m.life;
      if (left <= 0 || reduced) { m.s.destroy(); motes.splice(i, 1); continue; }
      const steps = age / 16;   // 1.7 moves a mote its speed each frame
      m.s.position.set(m.x0 + m.vx * steps, m.y0 + m.vy * steps); m.s.alpha = left; m.s.width = m.s.height = m.size * Math.max(0.2, left);
    }
  });
}
