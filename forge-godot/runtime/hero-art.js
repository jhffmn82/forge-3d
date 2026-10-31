// The hero's held gear for the 3D build's hero card (Justin 2026-10-28: "he isn't holding his weapon", "or sheild"):
// the sheet rows the 2D game plays for what the hands hold (forge-rewrite render/held.js rowFor), and for each of their
// frames where it lays the held pictures over the body and the fingers that close over a handle (heldLayers, as
// render/hero-gear.js draws them), with the held pictures' sheet. scripts/main.gd puts them on the hero's card.

import * as P from './pixi.js';
import { heldGear, heldLayers, rowFor } from '../../forge-rewrite/src/render/held.js';
import elements from '../../forge-rewrite/data/elements.json' with { type: 'json' };
import heldData from '../../forge-rewrite/data/held.json' with { type: 'json' };
const G = heldData.rows.grip;
// held.js handMiddle: a hand's middle, G.hand of the cell on from its fist along its forearm (cell px).
const handMiddle = (hand, cell) => {
  const L = Math.hypot(hand.f[0] - hand.e[0], hand.f[1] - hand.e[1]) || 1;
  return [r2(hand.f[0] + (hand.f[0] - hand.e[0]) / L * cell * G.hand), r2(hand.f[1] + (hand.f[1] - hand.e[1]) / L * cell * G.hand)];
};

const ACTIONS = ['idle', 'walk', 'melee', 'hurt', 'death', 'cast', 'ranged'];
const r2 = v => Math.round(v * 100) / 100, r4 = v => Math.round(v * 10000) / 10000;
let kept = { key: null, art: null };

const sheetOf = state => state.actors[state.playerId]?.look?.sheet ?? 'cast-dwarf-f';

/** What the hero's card looks like: its sheet and what its hands hold. heroArt is worked out again when it changes. */
export function heroArtKey(state) {
  return sheetOf(state) + '|' + JSON.stringify(heldGear(state.hero));
}

/**
 * {key, sheet, rows: {action: {name, row, frames}}, layers: {row name: [frame: [layer]]}, held: {src, frames}}. A layer
 * is {b: 1} (the body), an item {k, x, y, s, ax, ay, r, m, fy, t} (its picture's key, where its anchor sits in the
 * cell's pixels, its scale from the picture's pixels to the cell's, its anchor, turn, mirror, flattening and tier) or
 * the fingers {f: 1, x, y, r} (the body's pixels round a fist, drawn again over the handle).
 */
export function heroArt(state) {
  const key = heroArtKey(state);
  if (kept.key === key) return kept.art;
  const name = sheetOf(state);
  const sheet = P.sheetLoaders.sheet('assets/sheets/' + name + '.json'), held = P.sheetLoaders.sheet('assets/sheets/map-held.json');
  if (!sheet || !held) return null;
  const gear = heldGear(state.hero), meta = sheet.meta;
  const artSize = k => { const f = held.frames['held-' + k]?.frame; if (!f) throw new Error('no held picture held-' + k); return { w: f.w, h: f.h }; };
  const rows = {}, layers = {}, keys = new Set();
  // RC59 (hero-gear.js beerIdle): a look whose sheet has a beer row (the Dwarf male tourist's) plays it at rest.
  const beer = meta.clips.beer?.play ? meta.clips.beer : null;
  for (const a of beer ? [...ACTIONS, 'beer'] : ACTIONS) {
    const r = a === 'beer' ? 'beer' : rowFor(meta, a, gear), c = meta.clips[r];
    if (!c) continue;
    rows[a] = { name: r, row: c.row, frames: c.frames };
    if (layers[r]) continue;
    layers[r] = [];
    for (let i = 0; i < c.frames; i++) {
      let ls;
      // A melee row's nine frames are its nine steps (held.js stepAt), which turn the swing.
      try { ls = heldLayers(sheet, gear, { row: r, frame: i, ...(a === 'melee' ? { step: i } : {}) }, artSize); } catch (e) { ls = [{ body: true }]; }
      layers[r].push(ls.map(L => {
        if (L.body) return { b: 1 };
        // e: an enchanted handled item's glow, its element's colour (hero-gear.js glowOf, H23)
        if (L.item) { keys.add(L.item); return { k: L.item, x: r2(L.x), y: r2(L.y), s: r4(L.scale), ax: L.anchorX, ay: L.anchorY, r: r4(L.rot), m: L.mirror ? 1 : 0, fy: r4(L.flatY), t: L.tier ?? 1, ...(L.enchant ? { e: elements.rows[L.enchant]?.colour ?? '#FFFFFF' } : {}) }; }
        // A palm's hand over an orb or a tome (H17): its middle and reach, the hand itself found in the sheet's pixels by
        // scripts/main.gd (held.js handRuns), as here there are none to read.
        if (L.runs) { const [x, y] = handMiddle(L.grip, meta.cell); return { p: 1, x, y, r: r2(meta.cell * G.handReach) }; }
        return { f: 1, x: r2(L.x), y: r2(L.y), r: r2(L.r) };
      }).filter(Boolean));
    }
  }
  const frames = {};
  for (const k of keys) { const f = held.frames['held-' + k].frame; frames[k] = [f.x, f.y, f.w, f.h]; }
  // The look's skin, for finding a painted hand: its still's place on the sheet and each hand's middle there (skinOf).
  const stillName = sheet.frames.static ? 'static' : 'idle-0', still = sheet.frames[stillName];
  const skin = still?.grip ? { at: [still.frame.x, still.frame.y], mids: ['r', 'l'].map(hn => handMiddle(still.grip[hn], meta.cell)) } : null;
  kept = { key, art: { key, sheet: name, rows, layers, held: { src: 'assets/sheets/' + (held.meta?.image ?? 'map-held.webp'), frames },
    skin, scan: heldData.rows['hand-scan'], ...(beer ? { beer: { play: beer.play, after: beer.after ?? 10 } } : {}) } };
  return kept.art;
}
