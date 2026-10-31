// Break debris (sandbox item 101, Justin 2026-10-17: "I want broken crates / pots etc to leave behind some evidence
// they were there"): where a prop broke (floor.debris, pushed by rules/props.js breakProp), a small cluster of his
// wood or pottery pieces lies scattered on the ground for the rest of the floor. Baked at the props' density (128
// texels per tile) in the colours of the prop that broke, drawn flat on the ground under bodies and items and lit
// with the floor (light.flats). Seeded by the tile and the prop, so the same floor always shows the same pieces.

import { Sprite } from '../../../forge-godot/runtime/pixi.js';
import { sheet, hasSheet } from './art-store.js';

const SHEET = 'debris';
// Which pieces a broken prop leaves, in the colours of the prop itself (tools/assets/vendor/debris/make-debris.py).
// A stack-group with a family (pot, crate) leaves its family's pieces instead (debrisSprites).
const LOOK = {
  crate: 'wood', barrel: 'wood', 'barrel-explosive': 'wood', 'barrel-poison': 'wood', 'barrel-water': 'wood',
  'weapon-rack': 'wood', cart: 'wood', 'stack-group': 'wood', 'kobold-crate': 'wood-kobold', 'mine-cart': 'wood-kobold',
  pot: 'shards', urn: 'shards-urn', 'urn-tall': 'shards-urn-tall', 'urn-squat': 'shards-urn-squat',
  'urn-ornate': 'shards-urn-ornate', 'urn-group': 'shards-urn-ornate',
};

/** A small deterministic stream from the tile and the prop. */
function stream(x, y, id) {
  let h = (x * 73856093) ^ (y * 19349663);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}

const order = new Map();
/** A variant's piece numbers, largest first (by area on the sheet). */
function sizeOrder(book, look, n) {
  if (!order.has(look)) {
    const area = i => { const f = book.textures[`${look}/${i}`]?.frame; return f ? f.width * f.height : 0; };
    order.set(look, [...Array(n).keys()].sort((a, b) => area(b) - area(a)));
  }
  return order.get(look).slice();
}

/** The debris sprites for a floor: one scatter of pieces per broken prop that leaves pieces. */
export function debrisSprites(floor, tile) {
  if (!floor.debris?.length || !hasSheet(SHEET)) return [];
  const book = sheet(SHEET), k = tile / (book.data.meta.texelsPerTile ?? 128), out = [];
  for (const d of floor.debris) {
    const look = LOOK[d.family ?? d.id], v = look && book.data.meta.variants[look];   // a stack leaves what it was a stack of
    if (!v || (d.burnt && v.kind === 'wood')) continue;   // wood caught in a blast burned to the ash under it
    const r = stream(d.x, d.y, d.id), ids = sizeOrder(book, look, v.pieces);
    // Two of the four largest pieces and two or three smaller ones, each once (sandbox 101 review: scattered, not a clump).
    const big = ids.slice(0, 4), small = ids.slice(4), picks = [];
    while (picks.length < 2) picks.push(big.splice(Math.floor(r() * big.length), 1)[0]);
    const n = 2 + (r() < 0.5 ? 1 : 0);
    while (picks.length < 2 + n && small.length) picks.push(small.splice(Math.floor(r() * small.length), 1)[0]);
    // Round the spot in different directions: the big pieces near where the prop stood, the small ones further out.
    const turn = r() * Math.PI * 2;
    picks.forEach((i, j) => {
      const t = book.textures[`${look}/${i}`];
      if (!t) return;
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.scale.set(k * (r() < 0.5 ? -1 : 1), k);   // a mirrored piece reads as another piece
      const a = turn + (j * Math.PI * 2) / picks.length + (r() - 0.5) * 0.8;
      const far = j < 2 ? 0.1 + r() * 0.12 : 0.26 + r() * 0.12;   // in tiles: the big pieces near the spot, the small flung further
      // Kept inside the tile: each piece's half size bounds how far it may lie from the centre.
      const hw = (t.frame.width * k) / 2 / tile, hh = (t.frame.height * k) / 2 / tile;
      const fx = Math.max(-0.5 + hw, Math.min(0.5 - hw, Math.cos(a) * far)), fy = Math.max(-0.42 + hh, Math.min(0.42 - hh, Math.sin(a) * far * 0.8));
      s.position.set((d.x + 0.5 + fx) * tile, (d.y + 0.55 + fy) * tile);
      s.zIndex = -1;
      out.push(s);
    });
  }
  return out;
}
