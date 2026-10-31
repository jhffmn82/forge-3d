// The loaded art the drawing reads (consolidation C17, moved out of platform/assets.js so render reads its own layer):
// the sheets by name, the release hooks, and the page's loader behind them. platform/assets.js loads, parks and
// releases the sheets and plugs itself in here (plugLoader); render asks only what is loaded, and asks for more
// through loadSheet and loadGroup.

const sheets = new Map();
const releaseHooks = new Set();
let loader = { touch: () => {}, parked: () => false, wake: () => {}, loadSheet: null, loadGroup: null, alsoLoad: null, retainArt: null };
const early = [];   // alsoLoad calls made as a module loads, before the page's loader is plugged in
const earlyRetains = new Set();

/** platform/assets.js: the sheets it fills and the hooks it calls, and its own answers behind sheet(), readable() and the loads. */
export const artStore = {
  sheets, releaseHooks,
  plugLoader: l => {
    loader = { ...loader, ...l };
    if (loader.alsoLoad) for (const [g, p] of early.splice(0)) loader.alsoLoad(g, p);
    if (loader.retainArt) { for (const pin of earlyRetains) pin.release = loader.retainArt(pin.paths); earlyRetains.clear(); }
  },
};

/** A loaded sheet by its name (for example 'mob-m-rat'). A parked sheet is asked for again (its textures draw blank
 *  until its picture is back). */
export function sheet(name) {
  const s = sheets.get(name);
  if (!s) throw new Error('sheet not loaded: ' + name);
  loader.touch(name);
  return s;
}

/** Loaded (a parked sheet too: its textures draw, blank until its picture is back; loadGroup and loadSheet bring the
 *  picture back, which is how a floor's art is whole before the floor shows). */
export function hasSheet(name) { return sheets.has(name); }

/** False while a texture source's picture is parked: code that reads its pixels on the CPU (a shadow mask, a recolour)
 *  waits and tries again rather than caching a blank. Asks for the picture again. */
export function readable(src) {
  if (!src || !loader.parked(src)) return !!src;
  loader.wake(src);
  return false;
}

/** Called with (sheet name, its texture source) when a sheet is released whole (WT18), so a module cache built from
 *  its pixels (underdark-raster.js, terrain.js) lets them go too. Returns the unsubscribe. */
export function onRelease(fn) { releaseHooks.add(fn); return () => releaseHooks.delete(fn); }

/** Asks the page's loader for a sheet or a group (platform/assets.js loadSheet, loadGroup). */
export const loadSheet = (path, o = {}) => loader.loadSheet(path, o);
export const loadGroup = (name, o = {}) => loader.loadGroup(name, o);
/** Scoped protection from parking; supports a screen registering before the page's loader is installed. */
export function retainArt(paths) {
  if (loader.retainArt) return loader.retainArt(paths);
  const pin = { paths: [...paths], release: null };
  earlyRetains.add(pin);
  return () => { earlyRetains.delete(pin); pin.release?.(); pin.release = null; };
}
/** A single picture that loads and stays with a group's sheets (platform/assets.js alsoLoad, CH-R17). */
export const alsoLoad = (group, path) => (loader.alsoLoad ? loader.alsoLoad(group, path) : void early.push([group, path]));
