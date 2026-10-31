// Pictures for creation: the hand-painted figures (1.7's hi-res creation art) and the gods' shrine statues. A step's
// figures show together. Shared scenery, icons and statues load before creation opens and stay resident until it closes.
// Item 264 (Justin 2026-10-20: "why is the file size so high again?"): every body's bare figure, all the race and court
// steps show, is on one sheet (images/creation/bases, streamed from the title); a body's outfits, the later steps', on its
// own sheet, asked for once that body is picked.

import { Sprite } from '../../../../forge-godot/runtime/pixi.js';
import { whenLoaded } from '../core/loaded.js';
import { hasSheet, sheet, loadSheet, alsoLoad, readable } from '../core/art.js';
import { CREATION_STAGE_ART } from './creation-stage.js';

const SHRINES = 'assets/sheets/map-set.json';
export const CREATION_ART = ['images/creation/bases.json', ...CREATION_STAGE_ART, 'sheets/map-icons.json', SHRINES.slice('assets/'.length)];
// Ordinary manifest files are not group loads; use the existing extras path, leaving all other outfits on demand.
for (const path of CREATION_ART.slice(1)) alsoLoad('creation', path);
// A sheet now or once it loads; one the art budget dropped during a run is asked for again (item 161, core/loaded.js).
const want = whenLoaded;

const bodyOf = look => look.match(/^(fae-[a-z]+-[mf]|[a-z]+-[mf])/)?.[1];
const keyOf = look => /-base$/.test(look) ? 'images/creation/bases' : 'images/creation/' + bodyOf(look);
const resident = key => {
  if (!hasSheet(key)) return false;
  const book = sheet(key);
  return readable(book.textureSource ?? Object.values(book.textures)[0]?.source);
};
/**
 * Item 228 (Justin 2026-10-19: "in char selection when not all character sprites load at the same time"): the paintings
 * a step shows are asked of the loader side by side, ahead of the stream that brings the rest of the creation group
 * (main.js), and drawn only once every one of them is in: they appear together. True once they are; else it asks for
 * them, and `redraw` runs when they land. The sheet of the `ahead` look, the body picked, is asked for beside them.
 */
let waiting = null, ready = false;
export function paintingsIn(looks, redraw, ahead = null) {
  const keys = [...new Set(looks.filter(bodyOf).map(keyOf))], k = keys.join();
  if (ahead && bodyOf(ahead) && !resident(keyOf(ahead))) try { loadSheet(keyOf(ahead) + '.json').catch(() => {}); } catch { /* asked again when shown */ }
  ready = keys.every(resident);
  if (!ready && waiting !== k) {
    waiting = k;
    try { Promise.all(keys.map(key => loadSheet(key + '.json'))).then(() => { if (waiting === k) { waiting = null; redraw(); } }, () => { waiting = null; }); } catch { waiting = null; }
  }
  return ready;
}

/** A painted figure of `look` (see creation-model lookOf), its feet at y = 0, scaled to `h` px tall: none until the
 *  step's paintings are all in (paintingsIn). */
export function figure(look, h) {
  const book = ready && bodyOf(look) && hasSheet(keyOf(look)) ? sheet(keyOf(look)) : null;
  const t = book?.textures[book.data.meta.looks?.[look] ?? look];
  if (!t) return null;
  const s = new Sprite(t);
  s.anchor.set(0.5, 1);
  s.scale.set(h / t.height);
  return s;
}

/** A god's shrine statue, feet at y = 0, `h` px tall. */
export function shrine(god, h, redraw) {
  const sheet = want(SHRINES, redraw);
  const t = sheet?.textures['shrine-' + god];
  if (!t) return null;
  const s = new Sprite(t);
  // Each statue's frame keeps a different empty margin under its feet in the 256 box; anchoring on the trimmed foot
  // stands every shrine on the same floor line (1.7 paintCreationShrine trimmed that margin). The box still sets the
  // scale, so the statues keep their sizes against each other.
  s.anchor.set(0.5, t.trim ? (t.trim.y + t.trim.height) / t.orig.height : 1);
  s.scale.set(h / t.height);
  return s;
}
