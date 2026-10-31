// The ground marks 1.7 paints procedurally rather than from pictures (js/presentation/render/surface.js mossRaster,
// waterRaster, bonesRaster; render.js drawBaseGroundDecal @3c8b312): water pools, moss (on moss cells and in damp inner corners of rooms),
// puddles, blood, scorch and ash, ice, the uneven-stone tell of a hidden door, and bones (the ground-bones art turned
// a little, shown from its sheet over the chunk). Painted once per 16 x 16 tile chunk into a small canvas (PX pixels a tile) and shown as one sprite: the
// chunks near the camera at once, the rest in the background (D13); a chunk is painted again only when a cell in it
// changes. Nothing here draws from the game's random stream.

import { Container, Rectangle, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { G, isWallTile } from '../data/tiles.js';
import { CHUNK } from './terrain.js';
import { boxOn } from './chunks.js';
import { MOSS_PX } from './ground-marks.js';
import { paintGroundChunk } from './ground-chunk.js';
import { smoothLoot } from './piece-art.js';
import { propFit } from './art.js';

/**
 * @param {any} floor @param {number} tile @param {number} salt the surface salt (run seed % 9973 + floor x 31)
 * @returns {Container & {cull:Function, repaint:(floor:any)=>void, paintAll:()=>void}}
 */
export function buildGroundPaint(floor, tile, salt) {
  const root = new Container();
  if (typeof document === 'undefined') { root.cull = () => {}; root.repaint = () => {}; root.paintAll = () => {}; return root; }
  const W = floor.w, H = floor.h, CW = Math.ceil(W / CHUNK), chunks = new Map();
  const wallish = isWallTile;
  const bonesArt = hasSheet('environment-ground-bones') ? sheet('environment-ground-bones') : null;
  // The fluid grain (environment-terrain.js enhance, 'fluid' mode): the detail master's red channel, x 0.12 on water.
  let fluid = null;
  if (hasSheet('environment-terrain-fluid-detail')) {
    const src = Object.values(sheet('environment-terrain-fluid-detail').textures)[0].source, img = src.resource;
    const fc = document.createElement('canvas'); fc.width = src.pixelWidth; fc.height = src.pixelHeight;
    const fg = fc.getContext('2d', { willReadFrequently: true }); fg.drawImage(img, 0, 0);
    const px = fg.getImageData(0, 0, fc.width, fc.height).data, red = new Uint8Array(fc.width * fc.height);
    for (let i = 0; i < red.length; i++) red[i] = px[i * 4];
    fluid = { red, w: fc.width, h: fc.height };
  }
  const paintChunk = (f, cx, cy) => paintGroundChunk(f, cx, cy, { W, H, wallish, fluid, salt });
  const signature = (f, cx, cy) => {
    let s = '';
    for (let y = cy * CHUNK; y < Math.min(H, cy * CHUNK + CHUNK); y++) for (let x = cx * CHUNK; x < Math.min(W, cx * CHUNK + CHUNK); x++) { const k = y * W + x, gv = f.ground[k]; s += (gv === G.GRASS || gv === G.SHORT ? 'g' : gv) + ',' + f.tiles[k] + ';'; }
    return s;
  };
  // A chunk is painted when it first comes near the camera, and again when a cell in it changes.
  let current = floor;
  const paintNow = k => {
    const st = chunks.get(k); if (!st?.dirty) return;
    st.dirty = false;
    if (st.sprite) { st.sprite.texture.destroy(true); st.sprite.destroy(); st.sprite = null; }
    if (st.moss) { st.mossTex.destroy(true); st.moss.destroy({ children: true }); st.moss = null; }
    if (st.sharp) { st.sharp.destroy({ children: true }); for (const t of st.sharpTex) t.destroy(true); st.sharp = null; }
    const c = paintChunk(current, st.cx, st.cy); if (!c) return;
    const sp = new Sprite(Texture.from(c));
    sp.position.set(st.cx * CHUNK * tile, st.cy * CHUNK * tile); sp.width = CHUNK * tile; sp.height = CHUNK * tile;
    st.sprite = sp; root.addChild(sp);
    // The moss patches: each mossy tile a sprite from the chunk's atlas, under the chunk's other marks (1.7 draws moss first).
    if (c.moss) {
      const tex = Texture.from(c.moss.canvas), box = new Container();
      for (const m of c.moss.tiles) {
        const s = new Sprite(new Texture({ source: tex.source, frame: new Rectangle(m.u, m.v, MOSS_PX, MOSS_PX) }));
        s.position.set(m.x * tile, m.y * tile); s.width = tile; s.height = tile; box.addChild(s);
      }
      box.visible = sp.visible; st.moss = box; st.mossTex = tex; root.addChildAt(box, root.getChildIndex(sp));
    }
    // Sandbox 67: the pixel marks (puddles) are scaled up without smoothing, so their edges stay crisp pixels. Over them
    // the bones: each its ground-bones picture from the sheet at the bones pieces' size (props.json bones fit, 0.7 of a
    // tile), turned (Justin 2026-10-19: "why is the bone art so bad?"; 2026-10-20, items 236 and 259).
    const bones = bonesArt ? c.bones.filter(b => bonesArt.textures[b.frame]) : [], bw = tile * propFit('bones').size;
    if (c.pixels || bones.length) {
      const px = new Container(); st.sharpTex = [];
      // the pool multiplies the stone under it (tint and darken, the stone showing through); its light goes over
      if (c.pixels) for (const [cv, blend] of [[c.pixels.mul, 'multiply'], [c.pixels.over, 'normal']]) {
        const tex = Texture.from({ resource: cv, scaleMode: 'nearest' }), s = new Sprite(tex);
        s.position.copyFrom(sp.position); s.width = sp.width; s.height = sp.height; s.blendMode = blend; px.addChild(s); st.sharpTex.push(tex);
      }
      for (const b of bones) {
        const s = new Sprite(smoothLoot(bonesArt.textures[b.frame]));   // mipmapped: drawn smaller than its art
        s.anchor.set(0.5); s.position.set((b.x + 0.5) * tile, (b.y + 0.5) * tile); s.width = bw; s.height = bw; s.rotation = b.turn; px.addChild(s);
      }
      px.visible = sp.visible;
      st.sharp = px; root.addChild(px);
    }
  };
  root.repaint = f => {
    current = f;
    for (let cy = 0; cy < Math.ceil(H / CHUNK); cy++) for (let cx = 0; cx < CW; cx++) {
      const k = cy * CW + cx, s = signature(f, cx, cy);
      let st = chunks.get(k);
      if (!st) { st = { cx, cy, box: [cx * CHUNK * tile, cy * CHUNK * tile, (cx + 1) * CHUNK * tile, (cy + 1) * CHUNK * tile], sig: null, dirty: false, sprite: null }; chunks.set(k, st); }
      if (st.sig === s) continue;
      st.sig = s; st.dirty = true;
      if (st.shown) paintNow(k);
    }
  };
  root.cull = (a, b, c, d) => {
    for (const [k, st] of chunks) {
      st.shown = boxOn(st.box, a, b, c, d);
      if (st.shown && st.dirty) paintNow(k);
      if (st.sprite) st.sprite.visible = st.shown;
      if (st.moss) st.moss.visible = st.shown; if (st.sharp) st.sharp.visible = st.shown;
    }
  };
  root.paintAll = () => { for (const k of chunks.keys()) paintNow(k); };
  // D13 (Justin 2026-10-16): the rest of the floor is painted in the background, a chunk per idle moment, so the camera
  // never waits for a mossy area it reaches for the first time. A chunk off screen stays hidden once painted.
  const later = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 250 }) : setTimeout(f, 16));
  const stop = h => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(h) : clearTimeout(h));
  let baking = null;
  const bake = () => {
    baking = null;
    if (root.destroyed) return;
    for (const [k, st] of chunks) {
      if (!st.dirty) continue;
      paintNow(k);
      if (st.sprite) st.sprite.visible = !!st.shown;
      if (st.moss) st.moss.visible = !!st.shown;
      if (st.sharp) st.sharp.visible = !!st.shown;
      baking = later(bake);
      return;
    }
  };
  const bakeSoon = () => { if (!baking) baking = later(bake); };
  root.once('destroyed', () => { if (baking) stop(baking); baking = null; });
  const repaint = root.repaint;
  root.repaint = f => { repaint(f); bakeSoon(); };
  root.repaint(floor);
  return root;
}
