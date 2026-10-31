// Icon pictures (consolidation N2, render-26): the icon books, an icon frame's texture and a status icon fitted by its
// drawn part. Render draws status chips over bodies with these; ui/core/icons.js is the windows' and HUD's door to them.

import { Assets, Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { hasSheet, sheet } from './art-store.js';
import { runeTexture } from './runes.js';
import { itemArt } from './art.js';

// Items 243, 269 (Justin 2026-10-20: "bow in inventory isn't using the bow art", "in inventory, a holy symbol looks like
// an amulet instead of the holy symbol on the map" and "i'm wondering if all the inventory items use old art instead of
// the newer art"): an item's icon is the picture the floor draws, through the one lookup both use (item 325: art.js
// itemArt; its name, art.js itemArtName), so 1.7's newer motes (Justin 10-16), the gods' Holy Symbol discs (EQ20, W32),
// keys and cores (W35) and the ceremonial knife (sandbox item 61), as every other item a painting is made for. What is
// not an item (an ability, a prayer, a status) is map-icons'.
const ICON_BOOKS = ['environment-items', 'map-icons', 'map-items'];

// Prayers whose own name has no frame use the picture 1.7 gave them (ui.js PRAYER_ICONS @3c8b312, sandbox item 82).
const NAME_ALIAS = { 'pr-fieldsmelt': 'pr-offering', 'pr-anviltoll': 'pr-reforge' };
// 1.7's standalone prayer paintings (art/packed/map-pr-*.webp), outside every sheet; scaled to 128 px in assets/images/abilities.
const LOOSE = ['pr-arcanelance', 'pr-bonespear'];
const loosePath = n => `assets/images/abilities/${n}.webp`;
Assets.load(LOOSE.map(loosePath)).catch(() => {});

/** The icon books not loaded yet. */
export const missingIconBooks = () => ICON_BOOKS.filter(b => !hasSheet(b) && !Assets.get(`assets/sheets/${b}.json`));

/** The texture for an icon frame, or null when no loaded sheet has it. */
export function iconTexture(name) {
  if (!name) return null;
  name = NAME_ALIAS[name] ?? name;
  if (LOOSE.includes(name)) return Assets.get(loosePath(name)) ?? null;
  const rune = runeTexture(name);   // E11: a sigil's rune is drawn in code (render/runes.js), not a sheet frame
  if (rune) return rune;
  const item = itemArt(name);
  if (item) return item;
  const icons = hasSheet('map-icons') ? sheet('map-icons') : Assets.get('assets/sheets/map-icons.json');
  return icons?.textures[name] ?? null;
}

const trimmedIcons = new Map();
/** An icon's drawn part as its own texture, made once per name (status icons; the windows' mote icons, ui/core/icons.js). */
export function trimmedTexture(name, raw = iconTexture(name)) {
  if (!raw) return null;
  if (!trimmedIcons.has(name)) trimmedIcons.set(name, new Texture({ source: raw.source, frame: raw.frame.clone() }));
  return trimmedIcons.get(name);
}
/**
 * A status icon fitted by its drawn part, as 1.7 drew it (objArt's trimmed frame): the sheet keeps each icon trimmed inside
 * a 128 px cell, and fitting the cell would leave the picture about two thirds the size 1.7 showed.
 */
export function statusIcon(name, size, square = false) {
  const t = trimmedTexture(name);
  if (!t) return null;
  const s = new Sprite(t), k = size / Math.max(t.width, t.height);
  if (square) { s.scale.set(size / t.width, size / t.height); return s; }   // 1.7 statusIconURL drew the picture into a 32 x 32 square
  s.scale.set(k);
  s.position.set(Math.round((size - t.width * k) / 2), Math.round((size - t.height * k) / 2));
  return s;
}
