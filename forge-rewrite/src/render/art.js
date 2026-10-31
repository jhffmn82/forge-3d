// The map's shared art lookups (consolidation M6; render-20, 24, 26): a picture by group and name (1.7 render.js
// objArt), the trimmed picture, 1.7's drawObjectSprite fit, and each prop's fit, read from its data/props.json row
// (propFit) on every floor. structures.js, realm-view.js, fields-view.js, crypt-look.js, cave-terrain.js and the map
// view draw from here, so none of them imports another look file for its art.

import { AnimatedSprite, Assets, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet, readable } from './art-store.js';
import { sigilArtName } from './runes.js';
import { itemRow, trinketLook } from '../engine/reads.js';   // C17: the rules' answers through the engine
import { hash2 } from '../lib/noise.js';
import props from '../../data/props.json' with { type: 'json' };

const GROUPS = { structures: 'environment-props-structures', props: 'environment-props-props', set: 'environment-props-set', chests: 'environment-props-chests' };   // items: itemArt
const FALLBACK = { structures: 'map-structures', props: 'map-props', set: 'map-set', chests: null };
// The Dungeon's own props beyond 1.7's sheets (tools/assets/vendor/dungeon-props: Justin's first-biome props and the room
// templates' pieces, items 206 and 233).
const OWN = { props: 'environment-props-dungeon' };

const cut = new Map();
/** The trimmed picture alone (1.7 draws the atlas rectangle, not the padded canvas); label: its art name (objanim.js). */
export function trimmed(tex) {
  let t = cut.get(tex);
  if (!t) { t = new Texture({ source: tex.source, frame: tex.frame, label: tex.label }); cut.set(tex, t); }
  return t;
}

/** A prop's loop (G45): frames props/<id>-0 to -7 on a sheet of its own (environment-prop-<id>) or on the Dungeon's own
 *  props sheet; none while it has no frames. */
export function propLoop(id) {
  const n = [`environment-prop-${id}`, OWN.props].find(s => hasSheet(s) && sheet(s).textures[`props/${id}-0`]);
  return n ? [0, 1, 2, 3, 4, 5, 6, 7].map(k => sheet(n).textures[`props/${id}-${k}`]).filter(Boolean) : [];
}

/** Sprite s of prop id, or, once the prop has a loop of two frames or more, the loop in its place (its spot, size and
 *  facing) at the prop's props.json fit.frameMs, from a frame picked by its cell. A still until its frames exist. */
export function looped(s, id, x, y, loop = propLoop(id)) {
  if (loop.length < 2) return s;
  const a = new AnimatedSprite(loop.map(trimmed));
  a.position.copyFrom(s.position); a.width = Math.abs(s.width); a.height = s.height; a.alpha = s.alpha;
  if (s.scale.x < 0) a.scale.x *= -1;
  s.destroy();
  a.animationSpeed = 1000 / propFit(id).frameMs / 60; a.gotoAndPlay(Math.floor(hash2(x, y, 9) * loop.length));
  return a;
}

/**
 * Item 325 (Justin 2026-10-25: "a number of items did not have the same art in the inventory and on the map or had no
 * art displayed at all"): an item's picture name, the one the floor, the bag, the pouch and every card draw (1.7
 * render.js itemArtName). A ring or amulet wears its run look, worked out where the item carries none; a core is the
 * Crypt's own or the Dungeon's painting, as 1.7's; worn, a Holy Symbol shows its holder's god's disc (EQ20, W32).
 */
export function itemArtName(state, it, { worn = false, hero = null } = {}) {
  if (!it) return null;
  if (it.kind === 'essence') return 'item-essence';
  if (it.kind === 'mote') return `mote-${it.el}`;
  if (it.kind === 'sigil') return sigilArtName(state, it.id);
  if (it.kind === 'key') return it.key === 'crystal' ? 'item-key-crystal' : 'item-key-iron';
  if (it.kind === 'core') return it.name === 'Crypt Core' ? 'item-core-crypt' : 'item-core-dungeon';
  if (it.kind === 'relic') return it.id;
  if (it.kind === 'ring' || it.kind === 'amulet') {
    const look = it.look ?? (state ? trinketLook(state, it.kind, it.id) : null);
    return look ? `item-${it.kind}-${look}` : it.kind === 'ring' ? 'item-ring-iron' : 'item-amulet';
  }
  let icon = it.icon ?? null;
  try { icon = itemRow(it.id).row.icon ?? icon; } catch { /* no data row yet: the icon it carries */ }
  return worn && icon === 'item-holy' && hero?.faith?.god ? `item-holy-${hero.faith.god}` : icon;
}
/** A loaded sheet by name, or one in the asset cache not yet handed to the store. */
const book = n => (hasSheet(n) ? sheet(n) : Assets.get(`assets/sheets/${n}.json`) ?? null);
/**
 * Item 325: an item's picture by its art name, for the floor and every window alike (render/icons.js asks it first):
 * environment-items' painting, else a painting on a sheet of its own (the Sealed Lamp's), else map-items' older one,
 * else 1.7's packed sheet of its own (the Tourist's Hawaiian shirt, item 289).
 */
export function itemArt(name) {
  if (!name) return null;
  return book('environment-items')?.textures[`items/${name}`] ?? book(`environment-items-${name}`)?.textures[`items/${name}`]
    ?? book('map-items')?.textures[name] ?? (name.startsWith('item-') ? book(`map-${name.slice(5)}`)?.textures[name] : null) ?? null;
}

/** 1.7 objArt: the picture for a name in a group, current sheet first. */
export function objArt(group, name) {
  if (!name) return null;
  if (group === 'items') return itemArt(name);
  const g = group === 'props' && /^barrel-(water|poison)$/.test(name) ? 'environment-props-fluid-barrels' : GROUPS[group];
  if (g && hasSheet(g)) { const t = sheet(g).textures[`${group}/${name}`]; if (t) return t; }
  const own = OWN[group];
  if (own && hasSheet(own)) { const t = sheet(own).textures[`${group}/${name}`]; if (t) return t; }
  // 1.7 packedObjectSpec: the up stairs and the weapon rack have packed sheets of their own (map-stairs, map-rack),
  // ahead of the older pictures of the same name on map-structures and map-props.
  const own17 = group === 'structures' && name === 'stairs-up' ? 'map-stairs' : group === 'props' && name === 'weapon-rack' ? 'map-rack' : null;
  if (own17 && hasSheet(own17)) { const t = sheet(own17).textures[name]; if (t) return t; }
  const f = FALLBACK[group];
  if (f && hasSheet(f)) { const t = sheet(f).textures[name]; if (t) return t; }
  // A sheet of its own: levers and the portcullis (environment-prop-NAME); the sword in the stone and the stone pillar
  // (environment-props-NAME, as 1.7 packed them; item 168: the sword's stone blocked and drew nothing).
  for (const own of [`environment-prop-${name}`, `environment-props-${name}`]) {
    if (hasSheet(own)) { const t = sheet(own).textures[`structures/${name}`] ?? sheet(own).textures[`props/${name}`]; if (t) return t; }
  }
  return null;
}
const READ = new WeakMap();
/**
 * A sheet's pixels, read back once per picture source and kept while the source lives (N2, render-24): {data, w, h}.
 * A parked source (its picture coming back) is read but not kept, so the next call reads it again.
 */
export function sheetPixels(source) {
  let v = READ.get(source);
  if (v) return v;
  const src = source.resource, c = new OffscreenCanvas(src.width, src.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  v = { data: g.getImageData(0, 0, src.width, src.height).data, w: src.width, h: src.height };
  if (readable(source)) READ.set(source, v);
  return v;
}

/** The held items' sheet (spec/held-items.md), for the hero's gear (hero-gear.js). */
export const heldArt = () => sheet('map-held');
const BAKED = new Map();
/**
 * A picture made once from a sheet's pixels and kept by id (N3): make() returns {tex, source}; it is kept only while
 * source is in memory, since a parked sheet bakes blank and is made again when it is back.
 */
export function bakedOnce(id, make) {
  const kept = BAKED.get(id);
  if (kept) return kept;
  const { tex, source } = make();
  if (readable(source)) BAKED.set(id, tex);
  return tex;
}

/** A prop's picture in whichever group holds it. */
export const anyArt = name => objArt('props', name) ?? objArt('structures', name) ?? objArt('chests', name) ?? objArt('set', name);

/**
 * 1.7 drawObjectSprite: fit (share of a tile, default 0.92), feet (stand on the foot line at base 0.96), fill (cover
 * the tile), flip; scale/anchor shrink the result around a point of the tile (environment-props.js fit).
 */
export function objSprite(tex, x, y, tile, o = {}) {
  const t = trimmed(tex), w0 = t.frame.width, h0 = t.frame.height, F = (o.fit ?? 0.92) * tile;
  let s = o.fill ? Math.max(tile / w0, tile / h0) : Math.min(F / w0, F / h0);
  const k = o.scale ?? 1;
  s *= k;
  const w = w0 * s, h = h0 * s, px = x * tile, py = y * tile;
  // the anchor point of the shrink: the tile's centre line, `anchor` of a tile down
  const ax = px + tile / 2, ay = py + tile * (o.anchor ?? 0.5);
  const top0 = o.feet ? py + tile * (o.base ?? 0.96) - h / k : py + (tile - h / k) / 2;
  const sp = new Sprite(t);
  sp.width = w; sp.height = h;
  sp.position.set(ax + (px + (tile - w / k) / 2 - ax) * k, ay + (top0 - ay) * k);
  if (o.flip) { sp.scale.x *= -1; sp.x += w; }
  if (o.alpha !== undefined) sp.alpha = o.alpha;
  return sp;
}

/**
 * A prop's fit, from its props.json row's `fit` (1.7 renderer.js FIT and environment-props.js fit; render-20):
 *   size: the share of a tile it is fitted to, 0.9 standing and 0.82 flat unless given (flatSize);
 *   scale, anchor: environment-props.js fit's shrink, about a point `anchor` of the tile down (0.96, the foot; 0.5 when
 *     flat) unless given;
 *   feet (stands on the foot line; default: when not flat), base (that line, 0.96); tall: size is of the width, as tall
 *     as the picture makes it; crisp: drawn pixel-sharp; family: a stack's size by what it is a stack of;
 *   cave: the share of a cave piece's natural size (1.7 caveArtScale).
 * realm: on the Realm's floors (realm-view.js) these are read with the row's `realm` over them, today's Chaos fits,
 * held for Justin (consolidation 5a item 4); paint: the Realm recolours the picture to its island.
 */
export function propFit(id, { flat = false, realm = false } = {}) {
  const row = props.rows[id]?.fit ?? {}, f = realm && row.realm ? { ...row, ...row.realm } : row;
  return {
    size: flat ? f.flatSize ?? 0.82 : f.size ?? 0.9, scale: f.scale ?? 1, anchor: f.anchor ?? (flat ? 0.5 : 0.96),
    feet: f.feet ?? !flat, base: f.base ?? 0.96, tall: !!f.tall, crisp: !!f.crisp, paint: !!f.paint, cave: f.cave ?? 1, family: f.family ?? null,
    frameMs: f.frameMs ?? 160,   // a prop that moves: its frame time (structures.js loop)
    lies: !!f.lies,   // a picture lying on the floor, under the bodies (item 233's rug, debris, bedroll, books)
  };
}
