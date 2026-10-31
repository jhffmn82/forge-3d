// The Underdark's pieces as 1.7 draws them (js/presentation/render/deeprender.js deepArt, renderer.js:312 @3c8b312):
// every piece from environment-props-deep at its natural size (128 px a tile), a piece wider than a tile once from
// its head across its footprint, standing pieces on the footprint's foot line, flat ones (ritual circles, clusters,
// web on the floor) with their canvas centred on it and the clusters flipped by the cell, wall pieces (silk banners,
// web corners) hung from the top of their wall face, curtains scaled to fill their tunnel (deeprender.js deepDrawPiece);
// the down stairs as the drow stairway standing on its cell; the plants on its vegetation spots (drawUnderdarkPlants).

import { Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { T, tileAt } from '../data/tiles.js';
import { hash2 } from '../lib/noise.js';
import props from '../../data/props.json' with { type: 'json' };
import { looped } from './art.js';

const SHEET = 'environment-props-deep', P = props.rows;
const cut = new Map();
const sheetTex = id => (hasSheet(SHEET) ? sheet(SHEET).textures[`deep/${id}`] ?? null : null);
const deepTex = id => {
  const t = sheetTex(id);
  if (!t) return null;
  if (!cut.has(t)) cut.set(t, new Texture({ source: t.source, frame: t.frame, label: t.label }));   // label: objanim.js
  return cut.get(t);
};
/** The piece's canvas in sheet pixels (1.7 o.fullW/fullH and the trimmed picture's offset o.ox/oy in it). */
const canvasOf = (id, tex) => {
  const t = sheetTex(id), tr = t?.trim;
  return { W: t?.orig?.width ?? tex.frame.width, H: t?.orig?.height ?? tex.frame.height, ox: tr?.x ?? 0, oy: tr?.y ?? 0 };
};
// deeprender.js:574: the floor clusters vary by flipping (hash2(x, y, 5) < 0.5).
const FLIPS = /^(web-floor|cocoons-small|basalt|obsidian|candles)/;

/** A piece's sprite, null for a cell a wider piece covers, undefined when the id is not an Underdark piece. */
export function underdarkPropSprite(p, tile) {
  if (P[p.id]?.set !== 'underdark') return undefined;
  if (p.part) return null;
  const tex = deepTex(p.id);
  if (!tex) return undefined;
  const fp = P[p.id].footprint ?? { w: 1, h: 1 }, s = tile / 128, c = canvasOf(p.id, tex);
  let w = tex.frame.width * s, h = tex.frame.height * s, x, y, flip = false;
  const X = p.x * tile, Y = p.y * tile, flat = !!P[p.id].flat;
  if (P[p.id].curtain) {
    // deeprender.js:563-566: the curtains are painted small and low in their cell, so they are scaled up to fill the
    // tunnel wall to wall (1.12 of a tile across it), centred, the across-the-passage one raised 0.08.
    const across = p.id === 'web-curtain-h', k = tile * 1.12 / (across ? tex.frame.width : tex.frame.height);
    w = tex.frame.width * k; h = tex.frame.height * k;
    x = X + (tile - w) / 2; y = Y + (tile - h) / 2 - (across ? tile * 0.08 : 0);
  } else if (P[p.id].wallMounted || p.wall) {
    // deeprender.js:567-571: hung from the top of the wall face it is set on (0.12 down; the web corners at the top).
    flip = !!(p.flip || p.flipX);
    x = X + (tile - c.W * s) / 2 + c.ox * s; y = Y + c.oy * s + (/^web-corner/.test(p.id) ? 0 : tile * 0.12);
    if (flip) x = X + tile - (x - X) - w;
  } else if (flat) {
    // deeprender.js:572-575: lies in the floor, its canvas centred on the footprint; the clusters flip by the cell.
    flip = !!p.flip || ((!!P[p.id].cluster || FLIPS.test(p.id)) && hash2(p.x, p.y, 5) < 0.5);
    x = X + (fp.w * tile - c.W * s) / 2 + c.ox * s; y = Y + (fp.h * tile - c.H * s) / 2 + c.oy * s;
    if (flip) x = X + fp.w * tile - (x - X) - w;
  } else {
    x = (p.x + fp.w / 2) * tile - w / 2; y = (p.y + fp.h) * tile - tile * 0.04 - h;
    flip = !!p.flip;
  }
  let sp = new Sprite(tex);
  sp.width = w; sp.height = h; sp.position.set(Math.round(x), Math.round(y));
  if (flip) { sp.scale.x *= -1; sp.x += w; }
  sp = looped(sp, p.id, p.x, p.y);   // a piece with a loop (the silk banners, item 322) plays it once its frames exist
  sp.flat = flat;
  if (p.hatch || P[p.id].hatches) sp.stir = { p, x0: sp.x, w, seed: hash2(p.x, p.y, 91) * 3 };   // twitches while p.stirring
  // Sandbox U17 (Justin, 2026-10-16): silk banners, web curtains and wall webs sway a little in the draughts.
  else if (/^(silk-banner|web-curtain|web-corner)/.test(p.id)) sp.drift = { k: /^silk-banner/.test(p.id) ? 0.09 : /^web-curtain/.test(p.id) ? 0.08 : 0.035, seed: hash2(p.x, p.y, 93) * 6.28, rate: 0.9 + 0.5 * hash2(p.x, p.y, 94) };
  return sp;
}

/**
 * Sandbox U2 and U17 (Justin, 2026-10-16): silk and webs sway (U17); a cocoon the rules mark as stirring (the hero sees it within 3) twitches in short
 * bursts, something moving inside; under reduced motion it leans still instead. Called each frame with the structures.
 */
export function underdarkTick(sprites, now, reduced) {
  for (const sp of sprites) {
    if (sp.drift && !sp.destroyed) { sp.skew.x = reduced ? 0 : Math.sin(now / 1000 * sp.drift.rate + sp.drift.seed) * sp.drift.k; continue; }
    const st = sp.stir;
    if (!st || sp.destroyed) continue;
    if (!st.p.stirring) { if (sp.skew.x) { sp.skew.x = 0; sp.x = st.x0; } continue; }
    if (reduced) { sp.skew.x = 0.04; sp.x = st.x0; continue; }
    const t = (now / 1000 + st.seed) % 0.9, k = t < 0.45 ? Math.sin(t / 0.45 * Math.PI * 4) * (1 - 0.6 * t / 0.45) : 0;
    sp.skew.x = k * 0.16; sp.x = st.x0 + k * st.w * 0.07;
  }
}

/** The drow stairway for the down stairs on an Underdark floor; null elsewhere. */
export function underdarkTile(floor, x, y) {
  if (floor.biome !== 'underdark' || tileAt(floor, x, y) !== T.STAIRS) return null;
  // RB12, deeprender.js drawUnderdarkDoor: the stairway at its natural size (128 sheet pixels a tile), centred on the
  // cell and standing on the cell's bottom edge (its solid foot is the trimmed picture's last row, so 1.7's pad is 0),
  // tall over the passage behind it; drawn in 1.7's door pass, under every creature (so it keeps the flat depth).
  const tex = sheetTex('stairs-down-drow');
  return tex ? [tex, { fit: tex.frame.height / 128, feet: true, base: 1, flat: true }] : null;
}

/**
 * One vegetation spot's plants (deeprender.js drawUnderdarkPlants): a stand of ashweed in the volcanic caves, else two
 * or three of the authored fungus, loosely placed (mushrooms drawn at half size, vegDraw). The ashweed sways; the fungus
 * stands still (item 239, Justin 2026-10-20: "mushrooms don't need to be animated").
 * plant(tex, cx, base, scale, swayK, alpha, flip, x, y) is ground-view's vegDraw.
 */
export function underdarkPlant(sp, tile, art, plant, over) {
  const px = sp.x * tile, py = sp.y * tile, h = (s, a = sp.x, b = sp.y) => hash2(a, b, s);
  if (sp.kind === 'ashweed') {
    const s = plant(art(`volcanic-ashweed-${1 + Math.floor(h(81) * 3)}`), px + tile * (0.35 + 0.3 * h(82)), py + tile * 0.95, 0.85, 0.6, 1, h(83) < 0.5, sp.x, sp.y);
    if (s) { s.zIndex = (sp.y + 1) * tile - 2; over.push(s); }
    return;
  }
  const n = 2 + Math.floor(h(72) * 2), kind = 1 + Math.floor(h(71) * 3);
  for (let k = 0; k < n; k++) {
    const ox = 0.2 + 0.6 * hash2(sp.x + k, sp.y, 73), oy = 0.55 + 0.4 * hash2(sp.x, sp.y + k, 74), sc = (0.85 + 0.4 * hash2(k, sp.x + sp.y, 75)) * 0.5;
    const s = plant(art(`underdark-fungus-${kind}`), px + tile * ox, py + tile * oy, sc, 0, 1, hash2(k, sp.y, 77) < 0.5, sp.x, sp.y);
    if (s) { s.zIndex = sp.y * tile + tile * oy - 1; over.push(s); }
  }
}
