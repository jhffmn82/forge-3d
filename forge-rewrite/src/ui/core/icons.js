// Icons for windows: abilities, prayers and classes from map-icons; items and motes as the floor draws them
// (environment-items, else map-items: render/icons.js).
// Both sheets load with the play group; creation loads map-icons on its own. Before that an icon is absent.

import { Assets, Container, Graphics, Sprite, Texture } from '../../../../forge-godot/runtime/pixi.js';
import { iconTexture, statusIcon, missingIconBooks, trimmedTexture } from '../../render/icons.js';
export { iconTexture, statusIcon };
import abilities from '../../../data/abilities.json' with { type: 'json' };
import prayers from '../../../data/prayers.json' with { type: 'json' };
import { elementColour } from './colour.js';

// The icon books and iconTexture live in render/icons.js (N2, render-26); this file is the windows' and HUD's door to them.

/** 1.7's Invoke before a god is sworn: a white four-point star (its creation panel, Justin 10-17 item 82). */
function sparkle(size) {
  const c = new Container(), g = new Graphics(), m = size / 2, r = size * 0.36, w = size * 0.07;
  g.poly([m, m - r, m + w, m - w, m + r, m, m + w, m + w, m, m + r, m - w, m + w, m - r, m, m - w, m - w]).fill({ color: 0xffffff });
  g.circle(m, m, size * 0.09).fill({ color: 0xffffff, alpha: 0.9 });
  c.addChild(g);
  return c;
}

const waiting = new Set();
/**
 * Calls back once when every icon book is in, if one is still out: a window drawn before the play art streamed in shows
 * empty wells, and redraws when they arrive (proof pass item 8: a 360x640 Inventory opened that early stayed blank).
 */
export function whenIconBooks(cb) {
  const miss = missingIconBooks();
  if (!miss.length) return;
  waiting.add(cb);
  if (waiting.size > 1) return;
  Assets.load(miss.map(b => `assets/sheets/${b}.json`)).then(() => { const w = [...waiting]; waiting.clear(); w.forEach(f => f()); }).catch(() => waiting.clear());
}

/** An icon fitted into size x size, or null. */
export function icon(name, size) {
  if (name === 'ic-pray') return sparkle(size);
  const raw = iconTexture(name);
  if (!raw) return null;
  const t = name.startsWith('mote-') ? trimmedTexture(name, raw) : raw;   // a mote is a small picture in a 64 px cell
  const s = new Sprite(t);
  s.anchor.set(0);
  const k = size / Math.max(t.width, t.height);
  s.scale.set(k);
  s.position.set(Math.round((size - t.width * k) / 2), Math.round((size - t.height * k) / 2));
  return s;
}

/** Inventory's enchant mark, at the top right of a square item area; absent for an unknown or unenchanted item. */
export function enchantDot(element, size) {
  if (!element) return null;
  const dot = new Graphics().circle(size - 6.5, 6.5, 3.5).fill({ color: elementColour(element, 'enchant') ?? 0xffffff });
  dot.label = 'enchant-dot'; dot.eventMode = 'none';
  return dot;
}

/**
 * An ability's name and icon from its row (abilities.json, else prayers.json; C4, ui-05): Frost Cone draws the Tidal
 * Surge picture under its own name. The Cleric's 'invoke' before a god is sworn is 1.7's sparkle.
 */
export function abilityLook(id) {
  const r = abilities.rows[id] ?? prayers.rows[id];
  return { name: r?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : ''), icon: r?.icon ?? (id === 'invoke' ? 'ic-pray' : null) };
}
