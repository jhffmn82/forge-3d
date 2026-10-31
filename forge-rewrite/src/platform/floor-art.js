// The art a floor needs (consolidation C15, moved from main.js): its biome's, boss's and plane's groups, the bodies'
// own sheets, and what the art budget never trims. platform/assets.js loads and keeps them.

import { loadManifest, loadGroup, loadSheet, hasSheet } from './assets.js';
import { biomeOf } from '../data/schedule.js';
import { cavePieceArt } from '../render/cave-terrain.js';

export const PLAY_GROUPS = ['play', 'biome-dungeon', 'audio-play', 'audio-biome-dungeon'];

/** The art and sound a floor needs: its biome's groups, and its boss's on a boss floor (assets/manifest.json). */
/** A creature's own sheet, wherever its art group lives (a bone vault's elementalings are the Caverns' art). */
// The hero's own cast sheet comes with the hero; another body drawn on a cast sheet (G45: the freed traveler, 1.7's
// escort-human-m on the human cast) loads it here.
export const bodySheets = bodies => Promise.all(bodies.filter(a => a.side !== 'player').map(a => a.look?.sheet).filter(s => s && s !== 'mob-living-flame' && !hasSheet(s)).map(s => loadSheet(`sheets/${s}.json`).catch(() => {})));

/** The groups a floor needs (floorGroups loads them; keepArt keeps them while the floor is up). */
export function floorWant(floorNo, plane = null) {
  const b = biomeOf(floorNo);   // the run's schedule (data/schedule.js)
  const want = [`biome-${b}`, `audio-biome-${b}`, `music-biome-${b}`, b, `music-${b}`];   // the Realm's groups are named 'chaos', 'music-chaos'
  if (plane) want.push(`plane-${plane}`, `audio-plane-${plane}`, `music-plane-${plane}`, 'plane-light', 'plane-fire');   // the shared planeset sheets live in light and fire
  // The Realm's islands borrow props and cave rock from other groups (Chaos session, bb8bb36).
  if (floorNo >= 21 && floorNo <= 25) want.push('chasm', 'biome-crypt', 'plane-light');
  if (b === 'caverns') want.push('chasm', 'plane-light');   // the cave pieces, chasm lips and bridges; the cave-rock master
  if (b === 'underdark') want.push('plane-light');   // the cave-rock master the Underdark's rock is graded from (underdark-raster.js)
  if (b === 'dungeon' && floorNo > 1) want.push('biome-dungeon-deep');   // item 264: the creatures floor 1 never spawns, fetched as its floor ahead
  if (floorNo % 5 === 0) want.push(`boss-${b}`, `audio-boss-${b}`, `music-boss-${b}`);
  return want;
}
/** `o.retry` asks again at once for art that failed (the floor notice's Retry); `o.background` for the floor ahead. */
export async function floorGroups(floorNo, plane = null, o = {}, extra = []) {
  const m = await loadManifest(o);
  await Promise.all([...floorWant(floorNo, plane), ...extra].filter(n => m.groups[n]).map(n => loadGroup(n, o)));
}
/** A floor's art beyond its biome's: the treasure room before the Realm is Dungeon masonry (realm-view.js); cave pieces
 *  on any floor bring the cave props' group (render/cave-terrain.js cavePieceArt, item 168). */
export const roomArt = g => [...(g.floor?.treasureRoom ? ['biome-dungeon'] : []), ...cavePieceArt(g.floor)];
// What the art budget never trims (assets.js keepArt): the HUD's, the sounds', the portraits' and normal maps' groups.
export const CORE_ART = /^(boot|play|audio-|music-|body-|normals)/;
