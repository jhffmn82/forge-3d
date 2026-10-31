// The Realm's and the planes' props (M10, render-28: moved out of realm-view.js): the set and pack art, the loom's
// frames, cave and plane kit pieces, fitted and shrunk as 1.7 draws them, and the Earth plane's plants.

import { AnimatedSprite, Container, Graphics, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import { objArt, objSprite, propFit } from './art.js';
import { propSprite } from './structures.js';
import { upheavalRock } from './piece-art.js';
import { ROCK } from '../data/rock.js';
import { sway as windSway, EARTH_TINT } from './ground-view.js';
import { sheet, hasSheet, animate } from './realm-kit.js';
import { recolour } from './realm-palette.js';
import { vent } from './realm-life.js';

// Set pieces with idle strips (chaos-preview-art.js animations; the strips are cropped as 1.7 crops them).
const IDLE_FPS = { 'violet-portal': 4, 'violet-pavilion': 4.5, 'violet-eggs': 4.5 };
function setArt(name) {
  if (name === 'violet-loom') { const loom = loomFrames(); if (loom) return loom; }
  if (hasSheet(`map-${name}-idle`)) {
    const s = sheet(`map-${name}-idle`), frames = Object.keys(s.textures).filter(k => k.startsWith(name + '-')).sort((a, b) => +a.split('-').pop() - +b.split('-').pop()).map(k => s.textures[k]);
    if (frames.length > 1 && name !== 'violet-loom') return { frames, fps: IDLE_FPS[name] ?? s.data.meta.fps ?? 5.5 };
  }
  if (hasSheet(`map-${name}`)) return { frames: [sheet(`map-${name}`).textures[name]], fps: 0 };
  return null;
}
/**
 * chaos-preview-art.js detailedAnimation: the wide loom keeps its painted master at full detail, and takes from its
 * idle strip only the moving light: each frame is the master with that strip frame laid over it at 10% (source-atop,
 * so only where the master has paint), 512 px wide.
 */
let loomCache = null;
function loomFrames() {
  if (!hasSheet('map-violet-loom') || !hasSheet('map-violet-loom-idle') || typeof document === 'undefined') return null;
  const master = sheet('map-violet-loom').textures['violet-loom'], strip = sheet('map-violet-loom-idle');
  if (loomCache?.master === master) return loomCache.art;
  const names = Object.keys(strip.textures).filter(k => k.startsWith('violet-loom-')).sort((a, b) => +a.split('-').pop() - +b.split('-').pop());
  if (names.length < 2) return null;
  const f0 = strip.textures[names[0]].frame, W = 512, H = Math.round(W * f0.height / f0.width), mf = master.frame, frames = [];
  try {
    for (const n of names) {
      const sf = strip.textures[n].frame, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(master.source.resource, mf.x, mf.y, mf.width, mf.height, 0, 0, W, H);
      g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 0.1;
      g.drawImage(strip.textures[n].source.resource, sf.x, sf.y, sf.width, sf.height, 0, 0, W, H);
      frames.push(Texture.from(c));
    }
  } catch { return null; }
  loomCache = { master, art: { frames, fps: strip.data.meta.fps ?? 5.5 } };
  return loomCache.art;
}
/** cryptset.js drawSetSprite: the art fills the piece's tiles, standing on their bottom edge. */
function setPiece(name, x, y, w, h, tile) {
  const a = setArt(name); if (!a) return null;
  const t0 = a.frames[0], sw = t0.frame.width, sh = t0.frame.height;
  const sc = Math.min((w * tile * 0.98) / sw, (h * tile * (w === 1 && h === 1 ? 1.15 : 1.02)) / sh), dw = sw * sc, dh = sh * sc;
  const s = a.frames.length > 1 ? new AnimatedSprite(a.frames) : new Sprite(t0);
  s.anchor.set(0, 0);   // the sheets carry a foot anchor; these sizes are worked out from the top left
  s.width = dw; s.height = dh; s.position.set(x * tile + (w * tile - dw) / 2, (y + h) * tile - dh - tile * 0.02);
  if (a.frames.length > 1) { s.animationSpeed = a.fps / 60; s.gotoAndPlay(Math.floor(hash2(x, y, 9) * a.frames.length)); }
  return s;
}
const resOf = name => { const d = sheet(name).data.meta; return d.res ?? (d.pixelsPerTile ? d.pixelsPerTile / 64 : 1); };
/** A sheet picture with its full canvas (orig) and the sheet's resolution. */
function fullArt(group, name) {
  const look = [['environment-props-cave', `cave/${name}`], ['environment-mushroom-props', `cave/${name}`], ['environment-props-planeset', `planeset/${name}`], ['map-planeset', name]];
  if (group === 'anim' && hasSheet('map-planeset-anim')) {
    const s = sheet('map-planeset-anim'), frames = Object.keys(s.textures).filter(k => k.startsWith(name + '-')).map(k => s.textures[k]);
    if (frames.length) return { frames, res: s.data.meta.res ?? 2, ms: s.data.meta.frameMs ?? 180 };
  }
  for (const [sh, key] of look) if (hasSheet(sh) && sheet(sh).textures[key]) return { tex: sheet(sh).textures[key], res: resOf(sh) };
  return null;
}
/** cavernrender.js drawCaveSprite: the canvas, bottom centre at (cx, bottom), at TS/64 x scale. */
function caveSprite(o, cx, bottom, k, tile, flip) {
  const s = new Sprite(o.tex), sc = tile / 64 * k / o.res;
  s.anchor.set(0.5, 1); s.scale.set(flip ? -sc : sc, sc); s.position.set(cx, bottom);
  return s;
}
/** environment-props.js fit, applied after: shrink k around the tile's anchor point. */
function shrink(s, x, y, tile, k, anchor) {
  if (!s || k === 1) return s;
  const ax = (x + 0.5) * tile, ay = (y + anchor) * tile;
  s.position.set(ax + (s.x - ax) * k, ay + (s.y - ay) * k); s.scale.set(s.scale.x * k, s.scale.y * k);
  return s;
}
const PACK_PLANE = new Set(['rune-stone-light', 'rune-stone-shadow', 'rune-stone-earth', 'rune-stone-fire', 'rune-stone-water', 'rune-stone-air', 'stalagmite-light', 'stalagmite-shadow', 'stalagmite-earth', 'stalagmite-fire', 'stalagmite-water', 'stalagmite-air',
  'crystal-gold', 'crystal-violet', 'crystal-amber', 'crystal-fire', 'crystal-water', 'crystal-air', 'crystal-gold-small', 'crystal-violet-small', 'crystal-amber-small', 'crystal-fire-small', 'crystal-water-small', 'crystal-air-small',
  'sun-dais', 'stepping-stone', 'mossy-boulder', 'fern', 'root-tangle', 'glow-mushrooms', 'lava-fountain', 'signature-water', 'signature-air']);
const PLANE_KIT = { light: ['crystal-gold', 'crystal-gold-small', 'stalagmite-light'], shadow: ['crystal-violet', 'crystal-violet-small', 'stalagmite-shadow'], earth: ['crystal-amber', 'crystal-amber-small', 'stalagmite-earth'],
  fire: ['crystal-fire', 'crystal-fire-small', 'stalagmite-fire'], water: ['crystal-water', 'crystal-water-small', 'stalagmite-water'], air: ['crystal-air', 'crystal-air-small', 'stalagmite-air'] };
/** cryptpack.js packBottomPad: the empty canvas rows under the solid art (3+ pixels at alpha 140), in sheet pixels. */
const pads = new Map();
function bottomPad(tex) {
  if (pads.has(tex.uid)) return pads.get(tex.uid);
  const f = tex.frame, below = tex.trim ? tex.orig.height - (tex.trim.y + tex.trim.height) : 0;
  let pad = below;
  try {
    const c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.source.resource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    const d = g.getImageData(0, 0, f.width, f.height).data;
    for (let y = f.height - 1; y >= 0; y--) { let n = 0; for (let x = 0; x < f.width; x++) if (d[(y * f.width + x) * 4 + 3] >= 140) n++; if (n >= 3) { pad = below + (f.height - 1 - y); break; } }
  } catch { /* the trim alone */ }
  pads.set(tex.uid, pad);
  return pad;
}
/** cryptpack.js packDraw: a plane piece at its natural size, its canvas centred on the piece and standing on its foot. */
function packSprite(name, p, tile, plane, crystalPart) {
  const anim = /^(lava-fountain|signature-water|signature-air)$/.test(name) ? fullArt('anim', name) : null;
  const o = anim ?? fullArt('plane', name); if (!o) return null;
  const tex = o.tex ?? o.frames[0], res = o.res, s = tile / 64 * (crystalPart ? 0.7 : 1), w = p.w ?? 1, h = p.h ?? 1;
  const fw = tex.orig.width / res * s, fh = tex.orig.height / res * s;
  const pad = bottomPad(tex) / res;
  let left = p.x * tile + (w * tile - fw) / 2;
  if (p.id === 'pt-cluster' && p.wallDir) left += p.wallDir[0] * tile * 0.28;
  const bottom = (p.y + h) * tile + pad * s;
  const sp = o.frames ? new AnimatedSprite(o.frames) : new Sprite(tex);
  sp.anchor.set(0, 0); sp.scale.set(s / res); sp.position.set(Math.round(left), Math.round(bottom - fh));
  if (o.frames) { sp.animationSpeed = 1000 / o.ms / 60; sp.play(); }
  const wet = name === 'stepping-stone' && plane;
  if (wet) {
    const M = ROCK[plane], c = new Container(), g = new Graphics(), cx0 = left + fw / 2, cy0 = (p.y + h) * tile - tile * 0.16, dw = fw;
    g.ellipse(cx0, cy0, dw * 0.56, tile * 0.2).fill({ color: (Math.round(M.pool[0] * 0.55) << 16) | (Math.round(M.pool[1] * 0.55) << 8) | Math.round(M.pool[2] * 0.6), alpha: 0.75 });
    const rim = (M.poolRim[0] << 16) | (M.poolRim[1] << 8) | M.poolRim[2];
    for (let i = 0; i <= 12; i++) { const a = Math.PI * (0.08 + 0.84 * i / 12), xx = cx0 + Math.cos(a) * dw * 0.5, yy = cy0 + Math.sin(a) * tile * 0.17; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
    g.stroke({ color: rim, width: Math.max(1, tile / 32), alpha: 0.5 });
    sp.y += Math.round(tile * 0.12);
    c.addChild(g, sp); return c;
  }
  return sp;
}

/** How 1.7 draws one prop on these floors (render.js paintProp, renderer.js drawPropSurface and renderProp). */
export function realmProp(floor, p, tile, palette) {
  const name = p.art ?? p.id, flat = !!p.flat || !!PROP_FLAT[p.id];
  if (/^cl-cave-pearls-[1-4]$/.test(name)) return null;
  if (p.art) {
    if (p.art === 'rot-pool') return null;   // the ground paints it as water (cryptset.js drawSetSprite, Justin 2026-10-12)
    return setPiece(p.art, p.x, p.y, p.w ?? 1, p.h ?? 1, tile);
  }
  if (p.id === 'vines') return propSprite(p, tile);   // 1.7's drawVines with its stir, shared with every floor (structures.js, audit RC50)
  if (p.id === 'updraft-vent') return vent(floor, p.x, p.y, tile);
  if (floor.plane) {
    if (p.id === 'pt-outcrop') {
      const K = PLANE_KIT[floor.plane], sd = p.seed || 0, back = hash2(sd, 1, 71) < 0.5 ? [K[2], K[0], K[0]] : [K[0], K[0], K[2]], j = (k, a) => (hash2(sd, k, 73) - 0.5) * a;
      const parts = [{ x: p.x + 0.15 + j(1, 0.3), y: p.y - 0.1 + j(2, 0.25), n: back[0] }, { x: p.x + 1 + j(3, 0.2), y: p.y + j(4, 0.2), n: back[1] }, { x: p.x + 1.85 + j(5, 0.3), y: p.y - 0.05 + j(6, 0.25), n: back[2] },
        { x: p.x + 0.3 + j(7, 0.4), y: p.y + 0.9 + j(8, 0.15), n: K[1] }, { x: p.x + 1.5 + j(9, 0.5), y: p.y + 1 + j(10, 0.1), n: K[1] }];
      const c = new Container(); c.fxParts = true; c.fxCell = { x: p.x, y: p.y };   // RB29: objanim.js animates each part
      for (const q of parts) { const s = packSprite(q.n, { x: q.x, y: q.y, w: 1, h: 1 }, tile, null, /^crystal-/.test(q.n)); if (s) c.addChild(s); }
      return c;
    }
    if (p.id === 'pt-cluster') {
      const K = PLANE_KIT[floor.plane], n = (p.size ?? 1) < 1 ? K[1] : hash2(p.seed || 0, p.x, 67) < 0.45 ? K[2] : K[0];
      return packSprite(n, p, tile, null, /^crystal-/.test(n));
    }
    // vegart.js drawEarthPlantProp: the Earth plane's plants are the vegetation pack's, swaying.
    if (floor.plane === 'earth' && EARTH_PLANT[p.id]) { const s = earthPlant(floor, p, tile); if (s) return s; }
    if (p.upheaval) return upheavalRock(p, tile, objArt('props', p.id) ?? fullArt('plane', p.id)?.tex);   // WT5: Upheaval's bare ridge (structures.js)
    if (PACK_PLANE.has(p.id)) {
      // environment-props.js fit: a direct crystal shrinks to .7 on its foot (the Earth's glow mushrooms keep their size).
      const s = packSprite(p.id, p, tile, floor.plane, false), f = propFit(p.id);
      if (/^crystal-/.test(p.id)) return shrink(s, p.x, p.y, tile, f.scale, f.anchor);
      return s;
    }
  }
  // The prop's props.json fit with its Realm fit over it (art.js propFit; today's Chaos fits, held for Justin in
  // consolidation 5a item 4), then the cave pieces (cavernrender.js drawCaveProp), then the shared prop art.
  const f = propFit(name, { flat, realm: true });
  if (f.paint) {
    const tex = recolour(objArt('props', name) ?? fullArt('plane', name)?.tex, palette, name), g = propFit(name, { realm: true });   // at its standing size, flat or not
    if (tex) return objSprite(tex, p.x, p.y, tile, { fit: g.size, scale: g.scale, anchor: g.anchor });
  }
  const cave = fullArt('cave', name);
  if (cave && !/^(crystal-|scatter-|embers-)/.test(name)) {
    const o = { tex: recolour(cave.tex, palette, name), res: cave.res }, w = p.w ?? 1, h = p.h ?? 1, k = f.cave, flip = hash2(p.x, p.y, 5) < 0.5;
    const s = flat ? caveSprite(o, (p.x + 0.5) * tile, (p.y + 0.5) * tile + o.tex.orig.height / o.res * (tile / 64 * k) / 2, k, tile, flip) : caveSprite(o, (p.x + w / 2) * tile, (p.y + h) * tile - tile * 0.02, k, tile, flip);
    return shrink(s, p.x, p.y, tile, f.scale, f.anchor);
  }
  if (p.id === 'rubble') {
    const n = 1 + Math.floor(hash2(p.x, p.y, 73) * 3), tex = hasSheet('environment-deco') ? sheet('environment-deco').textures[`dungeon/pebble-${n}`] : null, g = propFit('rubble', { realm: true });
    return tex ? objSprite(recolour(tex, palette, 'rubble'), p.x, p.y, tile, { fit: g.size, scale: g.scale, anchor: g.anchor }) : null;
  }
  const tex = recolour(objArt('props', name) ?? objArt('structures', name) ?? objArt('set', name) ?? fullArt('plane', name)?.tex, palette, name);
  if (!tex) return null;
  return objSprite(tex, p.x, p.y, tile, { feet: f.feet, fit: f.size, base: f.base, scale: f.scale, anchor: f.anchor });
}
export const PROP_FLAT = { 'cl-small-mushrooms-1': 1, 'cl-small-mushrooms-2': 1, 'cl-small-mushrooms-3': 1, 'cl-small-mushrooms-4': 1, vines: 1, chains: 1, rubble: 1, 'crystal-violet-small': 1, 'crystal-gold-small': 1, 'crystal-fire-small': 1,
  'crystal-water-small': 1, 'crystal-air-small': 1, 'crystal-amber-small': 1, 'stepping-stone': 1, fern: 1, 'glow-mushrooms': 1, 'root-tangle': 1, 'updraft-vent': 1 };
for (const k of ['cl-glow-moss-', 'cl-rubble-', 'cl-cave-pearls-', 'cl-crystal-shards-', 'scatter-air-', 'scatter-water-', 'embers-slag-']) for (let i = 1; i <= 4; i++) PROP_FLAT[k + i] = 1;

/** vegart.js drawEarthPlantProp: which pack plants an Earth prop wears (a fern spot is a fern or a bush). */
const EARTH_PLANT = { fern: ['fern', 'bush'], 'root-tangle': ['root-tangle'], 'glow-mushrooms': ['mushroom-cluster'] };
/**
 * An Earth plane plant from the vegetation pack, darkened as the pack's Earth set (VEG_DIM.earth), its foot on the cell,
 * swaying in ground-view.js's wind (fern 0.8, bush 0.35, root tangle 0.1); still with reduced motion. The mushrooms
 * never sway (item 239, Justin 2026-10-20: "mushrooms don't need to be animated").
 * The glow mushrooms are drawSceneryCluster('mushroom-earth'): one of five baked groups, half a tile wide.
 */
function earthPlant(floor, p, tile) {
  const kinds = EARTH_PLANT[p.id], flip = hash2(p.x, p.y, 83) < 0.5;
  let tex, k, sc, base;
  if (p.id === 'glow-mushrooms') {
    tex = hasSheet('environment-mushroom-spreads') ? sheet('environment-mushroom-spreads').textures[`props/mushroom-spread-4-${Math.floor(hash2(p.x, p.y, 82) * 5)}`] : null;
    if (!tex) return null;
    sc = tile * 0.5 / tex.orig.width; base = (p.y + 1) * tile;
  } else {
    const kind = kinds[Math.floor(hash2(p.x, p.y, 81) * kinds.length)], n = kind === 'root-tangle' ? 2 : 3, VEG = 'environment-vegetation';
    tex = hasSheet(VEG) ? sheet(VEG).textures[`veg-earth-${kind}-${1 + Math.floor(hash2(p.x, p.y, 82) * n)}`] : null;
    if (!tex) return null;
    sc = tile / 64 * 0.95 / (sheet(VEG).data.meta.res ?? 1); base = (p.y + 0.96) * tile; k = kind === 'fern' ? 0.8 : kind === 'bush' ? 0.35 : 0.1;
  }
  const s = new Sprite(tex);
  s.anchor.set(0.5, 1); s.position.set((p.x + 0.5) * tile, base); s.scale.set(flip ? -sc : sc, sc); s.tint = EARTH_TINT;
  return p.id === 'glow-mushrooms' ? s : animate(s, t => { s.skew.x = t ? -windSway(p.x, p.y, t) * k : 0; }, { floor, cells: [p.y * floor.w + p.x] });
}
