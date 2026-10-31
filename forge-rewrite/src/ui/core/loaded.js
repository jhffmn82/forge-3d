// Load-then-redraw, once (consolidation U7; audit ui-31): a screen draws what is in Pixi's cache and redraws when what it
// asked for arrives. A load clears its mark when it settles, so a picture that left the cache is asked for again (161).

import { Assets } from '../../../../forge-godot/runtime/pixi.js';

const asked = new Set();
/** The loaded asset at `src` now, or null; `redraw` runs once it has loaded. */
export function whenLoaded(src, redraw) {
  const got = Assets.get(src);
  if (got) return got;
  if (!asked.has(src)) { asked.add(src); Assets.load(src).then(redraw, () => {}).finally(() => asked.delete(src)); }
  return null;
}
