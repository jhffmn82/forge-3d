// How the Crypt's own pieces are drawn (1.7 cryptset.js, cryptpack.js, cryptrooms.js, cryptprops.js renderers
// @3c8b312), from the art 1.7 draws today: environment-props-set (tombs, urn groups, candles, grave flowers, wall pieces,
// grave posts, the hall's set pieces), environment-props-props (urns, soul braziers, candelabras, coffins, pillars),
// environment-vegetation (crypt shrooms, shelf fungus, hanging roots). A piece several tiles big is drawn once, from
// its head, across its footprint; its other cells draw nothing.
// The stone pieces 1.7 paints in code (sarcophagi, pedestals, tombs) come from crypt-stone.js; the grave slab draws nothing.
// Its ground life is crypt-life.js, its stains crypt-grime.js, the helpers they share crypt-art.js (M10).

import { Container, Rectangle, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hash2 } from '../lib/noise.js';
import { cryptStone } from './crypt-stone.js';
import { isWallTile } from '../data/tiles.js';
import { trimmed } from './art.js';
import { RIM } from './wall-decor.js';
import { SET, sheetOf, setArt, propArt, framePixels, cluster } from './crypt-art.js';

/**
 * WT2: the Crypt's sconce (1.7 environment-deco.js cryptSconceFlame, :46-64): only the painted fire, in the top 43%
 * of the cell, is recoloured to the soul-green of its light (bright, warm pixels; the white core keeps more blue);
 * the iron bracket is untouched. Returns { paint, flame }: the recoloured sconce for the wall, and the fire alone, which
 * stands over it among the bodies and glows at 0.9 in the dark (environment-deco.js:86). Null without a canvas.
 */
let SCONCE;
export function cryptSconce(t) {
  if (SCONCE !== undefined && SCONCE.src === t) return SCONCE.val;
  const px = framePixels(t);
  let val = null;
  if (px) {
    const { c, g } = px, W = c.width, H = c.height, img = g.getImageData(0, 0, W, H), d = img.data;
    const fc = document.createElement('canvas'); fc.width = W; fc.height = H;
    const fg = fc.getContext('2d'), fimg = fg.createImageData(W, H), m = fimg.data;
    for (let y = 0; y < H * 0.43; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, r = d[i], gr = d[i + 1], b = d[i + 2];
      if (!d[i + 3] || !((r > 130 && gr > 60 && r > b * 1.35) || Math.min(r, gr, b) > 190)) continue;
      const v = Math.max(r, gr, b), core = Math.min(1, b / Math.max(1, r));
      d[i] = Math.round(v * (0.28 + 0.6 * core)); d[i + 1] = v; d[i + 2] = Math.round(v * (0.45 + 0.35 * core));
      m[i] = d[i]; m[i + 1] = d[i + 1]; m[i + 2] = d[i + 2]; m[i + 3] = d[i + 3];
    }
    g.putImageData(img, 0, 0); fg.putImageData(fimg, 0, 0);
    val = { paint: Texture.from({ resource: c, scaleMode: 'linear' }), flame: Texture.from({ resource: fc, scaleMode: 'linear' }) };
  }
  SCONCE = { src: t, val };
  return val;
}

/**
 * WT2: the sconces' fires on a Crypt floor, placed where terrain.js hangs each sconce (a wall torch on a wall face;
 * a side torch on the wall's inner edge at 0.78), for the bodies' layer: each says its row, and `emission` 0.9 while
 * its wall is in sight (`emitAt`, the wall's cell), which the light layer's glow pass reads.
 */
export function cryptSconceFlames(floor, tile) {
  const deco = sheetOf('environment-deco') ? sheetOf('environment-deco').textures['crypt/sconce'] : null;
  const art = deco && cryptSconce(deco);
  if (!art) return [];
  const W = floor.w, H = floor.h, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : floor.tiles[y * W + x]);
  const wallish = isWallTile;
  const out = [];
  for (const l of floor.lights ?? []) {
    if (l.kind !== 'wall-torch' || at(l.x, l.y) !== 0) continue;
    const faces = !wallish(at(l.x, l.y + 1));
    if (!!l.side === faces) continue;   // terrain.js: a face torch on a face, a side torch on a top
    const s = l.side ? 0.78 : 1, dx = l.side ? (l.side === 'w' ? 0.36 : -0.36) : 0, dy = l.side ? 0.06 : -0.02, w = Math.round(tile * s);
    const sp = new Sprite(art.flame);
    sp.position.set(Math.round(l.x * tile + dx * tile + (tile - w) / 2), Math.round(l.y * tile + dy * tile + (tile - w) / 2));
    sp.width = sp.height = w;
    sp.row = l.y; sp.emission = 0.9; sp.emitAt = l.y * W + l.x;
    out.push(sp);
  }
  return out;
}

/**
 * A picture fitted to a w x h block of tiles at (x, y): scaled to the block's width (at most `fit` of its height
 * past the top), standing on its foot line unless flat; flipped when asked.
 */
function block(t, x, y, w, h, tile, { fit = 1, flat = false, flip = false, lift = 0, scale = 1 } = {}) {
  if (!t) return null;
  const tt = trimmed(t), fw = tt.frame.width, fh = tt.frame.height;
  let s = (w * tile * fit) / fw;
  if (flat) s = Math.min(s, (h * tile * fit) / fh);
  s *= scale;
  const sp = new Sprite(tt);
  sp.width = fw * s; sp.height = fh * s;
  const cx = (x + w / 2) * tile, foot = (y + h) * tile - tile * (0.04 + lift);
  sp.x = cx - sp.width / 2;
  sp.y = flat ? (y + h / 2) * tile - sp.height / 2 : foot - sp.height;
  if (flip) { sp.scale.x *= -1; sp.x += sp.width; }
  return sp;
}

/** Empty canvas rows under a piece's solid art (sheet px; 1.7 packBottomPad: the lowest row with 3 pixels of alpha
 *  140 or more), read once per picture; the trim's own bottom margin when the pixels cannot be read. */
const PADS = new Map();
function bottomPad(t) {
  if (PADS.has(t)) return PADS.get(t);
  const o = t.orig, tr = t.trim ?? { x: 0, y: 0, width: t.frame.width, height: t.frame.height };
  let pad = o.height - (tr.y + tr.height);
  try {
    const f = t.frame, c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(t.source.resource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    const D = g.getImageData(0, 0, f.width, f.height).data;
    for (let y = f.height - 1; y >= 0; y--) {
      let n = 0;
      for (let x = 0; x < f.width; x++) if (D[(y * f.width + x) * 4 + 3] >= 140) n++;
      if (n >= 3) { pad = o.height - (tr.y + y + 1); break; }
    }
  } catch { /* no canvas (tests) or an unreadable source: the trim's margin */ }
  PADS.set(t, Math.max(0, pad));
  return PADS.get(t);
}

/**
 * 1.7 packDraw (cryptpack.js:130-143): a pack piece at its natural size, one art pixel = tile / 64 (the set sheet holds
 * 128 px a tile), its whole canvas bottom-centred on the w x h footprint and set down by the empty rows under the art;
 * a wall piece stands on its wall cell's floor line. `scale` shrinks it about the tile's centre (1.7's 0.8 for urns).
 */
function natural(t, x, y, w, h, tile, { wall = false, flip = false, scale = 1 } = {}) {
  if (!t) return null;
  const per = sheetOf(SET) ? sheetOf(SET).data.meta.pixelsPerTile ?? 128 : 128, s = tile / per;
  const o = t.orig, tr = t.trim ?? { x: 0, y: 0, width: t.frame.width, height: t.frame.height };
  const left = x * tile + (w * tile - o.width * s) / 2, bottom = (wall ? y + 1 : y + h) * tile + bottomPad(t) * s;
  const sp = new Sprite(trimmed(t));
  let dx = left + tr.x * s, dy = bottom - o.height * s + tr.y * s, dw = tr.width * s, dh = tr.height * s;
  if (scale !== 1) {
    const ax = (x + 0.5) * tile, ay = (y + 0.5) * tile;
    dx = ax + (dx - ax) * scale; dy = ay + (dy - ay) * scale; dw *= scale; dh *= scale;
  }
  sp.position.set(Math.round(dx), Math.round(dy)); sp.width = Math.round(dw); sp.height = Math.round(dh);
  if (flip) { sp.scale.x *= -1; sp.x += sp.width; }
  return sp;
}

/** 1.7 drawSetSprite (cryptset.js:30-43) for a floor piece: the trimmed art fitted to 0.98 of the footprint's width and
 *  1.15 (one tile) or 1.02 of its height, standing 0.02 of a tile above the foot line; `scale` shrinks it about the
 *  tile's centre (environment-props.js fit, anchor 0.5). */
function setSprite(t, p, tile, scale = 1) {
  if (!t) return null;
  const tt = trimmed(t), sw = tt.frame.width, sh = tt.frame.height, w = p.w ?? 1, h = p.h ?? 1;
  const sc = Math.min((w * tile * 0.98) / sw, (h * tile * (w === 1 && h === 1 ? 1.15 : 1.02)) / sh);
  const dw = sw * sc, dh = sh * sc, ax = (p.x + 0.5) * tile, ay = (p.y + 0.5) * tile;
  const dx = p.x * tile + (w * tile - dw) / 2, dy = (p.y + h) * tile - dh - tile * 0.02;
  const sp = new Sprite(tt);
  sp.position.set(ax + (dx - ax) * scale, ay + (dy - ay) * scale);
  sp.width = dw * scale; sp.height = dh * scale;
  return sp;
}

/** 1.7 packDrawRecess (cryptpack.js:180-185): the burial niche in the middle wall cell, a memorial plaque either side
 *  (the recess is only placed where all three cells are wall). */
function recess(p, tile) {
  const c = new Container(), niche = natural(setArt('wall-niche'), p.x, p.y, 1, 1, tile, { wall: true });
  if (!niche) return null;
  for (const d of [-1, 1]) { const q = natural(setArt('wall-plaque'), p.x + d, p.y, 1, 1, tile, { wall: true }); if (q) c.addChild(q); }
  c.addChild(niche);
  return c;
}

const URN_GROUPS = 4;

/**
 * The sprite for one Crypt prop, null to draw nothing, or undefined when it is not a Crypt piece (the shared drawer
 * then draws it). `flat` on the result says it lies on the ground (drawn under the bodies).
 */
/** CR7: which pack urn group a crypt urn-group draws. 1.7 packNameFor (cryptpack.js:113): a room's group has no pattern
 * (cryptrooms.js urnGroupExtra sets only clusterVariant and flip), so 'urn-groups-' + (1 + (0 + flip) % 4): group 1 or 2.
 * The hall's set clusters take packVariant(p, 61), any of the four. */
export function urnGroupArt(p) {
  const n = p.set ? 1 + (Math.floor(hash2(p.x, p.y, 61) * 4) % 4) : 1 + (((p.pattern ?? 0) + (p.flip ? 1 : 0)) % URN_GROUPS);
  return `urn-groups-${n}`;
}

export function cryptPropSprite(p, tile) {
  const id = p.id, w = p.w ?? 1, h = p.h ?? 1;
  if (p.part) return null;
  // 1.7 tries drawPackedProp ahead of drawCryptStoneProp (renderer.js:4-8): a sarcophagus or tomb whose pack picture is
  // loaded shows it at its natural size (packNameFor, cryptpack.js:109-112: open and lying the open tomb, open standing
  // or cracked a crumbled one, else the plain tomb). Crypt look pass 2026-10-17: ours painted them all, flat and bare
  // next to 1.7's carved, mossy, candle-lit tombs.
  const pack = id === 'sarc' ? (p.kind === 'open' ? (p.horiz ? 'tomb-open-h' : 'tomb-crumbled-v') : p.kind === 'cracked' ? (p.horiz ? 'tomb-crumbled-h' : 'tomb-crumbled-v') : (p.horiz ? 'tomb-h' : 'tomb-v'))
    : /^tomb-/.test(id) ? id : null;
  const packed = pack && natural(setArt(pack), p.x, p.y, w, h, tile);
  if (packed) return packed;
  // 1.7's painted stone (crypt-stone.js) where the pack has no picture: pedestals, and the tombs while their art is
  // missing; across the footprint, rising `lift` above it, drawn pixel-sharp.
  const stone = cryptStone(p);
  if (stone) {
    const sp = new Sprite(stone.tex);
    sp.position.set(p.x * tile, (p.y - stone.lift) * tile);
    sp.width = stone.cw * tile; sp.height = (stone.ch + stone.lift) * tile;
    return sp;
  }
  let s;
  // 1.7 drawPackedProp ahead of drawUrnGroupProp (renderer.js:5, cryptpack.js:113-114): the pack's urn group at its
  // natural size, shrunk to 0.8 about the tile's centre (environment-props.js fit for urns), never flipped. The hall's
  // urn clusters take packVariant(p, 61); a room's group urnGroupArt (groups 1 or 2 by flip, as 1.7). The vegetation
  // cluster picture only when the pack art is missing.
  if (id === 'urn-group') {
    s = natural(setArt(urnGroupArt(p)), p.x, p.y, 1, 1, tile, { scale: 0.8 }) ?? cluster(`urn-${(p.variant ?? 0) % 5}`, p.x, p.y, tile, !!p.flip);
  }
  // (A sarcophagus or pedestal never reaches here on a page: cryptStone paints both; render-21.)
  else if (id === 'grave-slab') {
    // C16 (Justin 2026-10-16): the slab under the urn chamber's recess, reusing the painted sarcophagus lid (crypt-stone.js,
    // its top cut out), laid flat over its two cells and darkened a little into the floor.
    const lid = cryptStone({ id: 'sarc', kind: 'intact', horiz: false, seed: (p.x * 7 + p.y * 3) % 97, x: p.x, y: p.y });
    if (!lid) return null;
    const src = lid.tex.source, t = new Texture({ source: src, frame: new Rectangle(1, 7, src.width - 2, 51) });
    const sp = new Sprite(t);
    sp.position.set((p.x + 0.06) * tile, (p.y + 0.04) * tile); sp.width = tile * 0.88; sp.height = tile * 1.9;
    sp.tint = 0xb4acc0; sp.alpha = 0.95; sp.flat = true;
    return sp;
  }
  // CR1: the hall's set pieces at 1.7's natural size (packDraw): the grave monument about 1 x 2 tiles in its 2 x 2.
  else if (/^(tomb-|dais-sarcophagus|grave-monument)/.test(id)) s = natural(setArt(id), p.x, p.y, w, h, tile);
  // CR19: candles, grave flowers and grave posts are pack pieces, drawn at their natural size (packDraw); only the
  // flowers (and bone piles) are mirrored, by hash2(x, y, 65) (cryptpack.js:139). Candles and flowers lie flat.
  else if (/^candles-\d$/.test(id) || /^grave-flowers-moss-\d$/.test(id)) { s = natural(setArt(id), p.x, p.y, 1, 1, tile, { scale: id === 'candles-2' || id === 'candles-4' ? 0.5 : 1, flip: /^grave/.test(id) && hash2(p.x, p.y, 65) < 0.5 }); if (s) s.flat = true; return s; }
  else if (id === 'grave-post') s = natural(setArt(id), p.x, p.y, 1, 1, tile);
  // The urns are vessels: 1.7 drawSetSprite's fit (0.98 of the width, 1.15 of the height, standing 0.02 above the
  // foot) shrunk to 0.8 about the tile's centre (environment-props.js fit for urns): a soul urn 0.78 of a tile wide.
  else if (id === 'urn-shattered') { s = setSprite(setArt(id), p, tile, 0.8); if (s) s.flat = true; return s; }
  else if (/^(urn-tall|urn-squat|urn-ornate|soul-urn)$/.test(id)) s = setSprite(setArt(id), p, tile, 0.8);
  // Wall pieces sit on the wall face (their tile is wall); the hall's plaques and niches, cobwebs in the corners.
  // At 1.7's natural size on the wall's floor line (packDraw p.wall); the recess is the niche between two plaques (CR6).
  else if (id === 'crypt-recess') s = recess(p, tile);
  else if (id === 'wall-plaque' || id === 'wall-niche') s = natural(setArt(id), p.x, p.y, 1, 1, tile, { wall: true });
  // C8 the ossuary's bone wall: a skeleton niche standing on its face's foot, shrunk to fit under the capstone's rim (item
  // 260, Justin 2026-10-20: "this art needs to be lowered on the wall:"; at 0.8 of the width it rose 0.12 of a tile over
  // its wall cell).
  else if (id === 'skeleton-niche') {
    const t = propArt(id) ?? setArt('wall-niche'), f = t && trimmed(t).frame;
    s = t ? block(t, p.x, p.y, 1, 1, tile, { fit: 0.8, scale: Math.min(1, (0.96 - RIM) / (0.8 * f.height / f.width)) }) : null;
  }
  // CR8: the web hangs into the corner it hugs (1.7 flip = !!p.webLeft, cryptpack.js:138).
  else if (id === 'wall-cobweb') s = natural(setArt(id), p.x, p.y, 1, 1, tile, { wall: true, flip: !!p.webLeft });
  else if (/^crypt-(roots|shelf-fungus)-\d$/.test(id)) return null;   // drawn swaying with the ground (cryptGroundLife)
  else return undefined;
  return s;
}
