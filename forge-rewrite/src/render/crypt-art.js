// The Crypt's art helpers (M10, render-28: moved out of crypt-look.js): its sheets, frame pixels, the darkened
// vegetation, the per-floor picture cache and 1.7's scenery clusters, shared by its props and its ground life.

import { Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';
import { isOpaqueTile } from '../data/tiles.js';


export const SET = 'environment-props-set', PROPS = 'environment-props-props', VEG = 'environment-vegetation', CLUSTERS = 'environment-vegetation-clusters', SPREADS = 'environment-mushroom-spreads';
/** A loaded sheet, or null: the Crypt's pieces read their sheets through here (render-26). */
export const sheetOf = name => (hasSheet(name) ? sheet(name) : null);
export const tex = (sh, name) => (hasSheet(sh) ? sheet(sh).textures[name] ?? null : null);
export const setArt = name => tex(SET, `set/${name}`);
export const propArt = name => tex(PROPS, `props/${name}`);

/** A texture's own pixels on a canvas of its frame's size; null without a canvas (tests) or a readable source. */
export function framePixels(t) {
  if (typeof document === 'undefined' || !t?.source?.resource) return null;
  try {
    const f = t.frame, c = document.createElement('canvas'); c.width = f.width; c.height = f.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(t.source.resource, f.x, f.y, f.width, f.height, 0, 0, f.width, f.height);
    return { c, g };
  } catch { return null; }
}

// 1.7 vegart.js VEG_DIM: how far a set's plants are darkened toward its shadow colour (source-atop wash), once a picture.
export const VEG_DIM = { crypt: [0.18, '#221A30'] }, BAKED = new Map();
export function vegBaked(t, set) {
  const key = t, d = VEG_DIM[set];
  if (!d) return t;
  if (BAKED.has(key)) return BAKED.get(key);
  const px = framePixels(t);
  let out = t;
  if (px) {
    px.g.globalCompositeOperation = 'source-atop'; px.g.globalAlpha = d[0]; px.g.fillStyle = d[1];
    px.g.fillRect(0, 0, px.c.width, px.c.height);
    out = Texture.from({ resource: px.c, scaleMode: 'linear' });
  }
  BAKED.set(key, out);
  return out;
}

/**
 * C13 (Justin 2026-10-16): the ooze and grime pictures are worked out once per floor and kept with it (keyed by the
 * floor object, so a stored floor and a reloaded one each make theirs once); the ground's redraws (a corpse, a rising)
 * reuse them. `key` says what they were made from; a change (ooze cells, an opened door) makes them again.
 */
const PICTURES = new WeakMap();
export function cachedPicture(floor, name, key, make) {
  let m = PICTURES.get(floor);
  if (!m) PICTURES.set(floor, (m = {}));
  const hit = m[name];
  if (hit && hit.key === key) return hit.val;
  hit?.val?.tex?.destroy(true);
  const val = make();
  m[name] = { key, val };
  return val;
}
/** The wall line is every tile that stops sight by itself (data/tiles.js isOpaqueTile): wall, hidden door and every
 *  closed door (liquid never paints on them; Justin 2026-10-16: "paint walls after painting liquids"). */
export const wallLineKey = floor => { let n = 0; for (const t of floor.tiles) if (isOpaqueTile(t)) n++; return n; };

/** 1.7 drawSceneryCluster: a 128 x 128 cluster cell drawn one tile wide, bottom-centred on the tile. */
export function cluster(name, x, y, tile, flip) {
  const t = tex(CLUSTERS, name);
  return t ? footSprite(t, x, y, tile, flip) : null;
}
export function footSprite(t, x, y, tile, flip) {
  const sp = new Sprite(t);
  sp.anchor.set(0.5, 1); sp.position.set((x + 0.5) * tile, (y + 1) * tile);
  sp.width = tile; sp.height = tile;
  if (flip) sp.scale.x *= -1;
  return sp;
}
