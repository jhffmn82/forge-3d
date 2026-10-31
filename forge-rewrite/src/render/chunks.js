// The chunked layers' cull (consolidation M8, render-04): terrain, the Caverns' surface, the ground paint and the
// plants are each drawn in chunks with a box [x0, y0, x1, y1] in map px; only the chunks near the camera show.

/** Whether a chunk's box meets the view x0..x1, y0..y1 (map px). */
export const boxOn = (box, x0, y0, x1, y1) => box[2] > x0 && box[0] < x1 && box[3] > y0 && box[1] < y1;

/**
 * A cull that also caches each chunk as a texture while it shows (terrain.js, cave-surface.js). Sandbox 55 (Justin
 * 2026-10-16: "i see a black line seam in the floor tiles", terrain.js 8b8a6ac): Pixi caches a chunk into a pooled
 * power-of-two texture, and smooth sampling at its right and bottom edge read the empty texels past it, so a dark
 * column ran down every 8th tile line at some camera offsets. The cache is made at the screen's density d (device
 * pixels per map pixel, from map-view), rounded up so a chunk of `span` map px is a whole number of texels, and
 * sampled nearest; it is dropped once the chunk is more than `far` past the view. chunks: the layer's array (holes
 * allowed), read at each call.
 * @returns {(x0:number, y0:number, x1:number, y1:number, d?:number) => void}
 */
export function chunkCache(chunks, span, far) {
  let density = 0;
  return (x0, y0, x1, y1, d) => {
    if (d && Math.abs(d - density) > 1e-6) { density = d; for (const c of chunks) if (c?.cached) { c.cacheAsTexture(false); c.cached = false; } }
    for (const c of chunks) {
      if (!c) continue;
      const on = boxOn(c.box, x0, y0, x1, y1), near = boxOn(c.box, x0 - far, y0 - far, x1 + far, y1 + far);
      if (on && !c.cached) { c.cacheAsTexture(density ? { antialias: false, resolution: Math.ceil(span * density) / span, scaleMode: 'nearest' } : { antialias: false }); c.cached = true; }
      else if (!near && c.cached) { c.cacheAsTexture(false); c.cached = false; }
      c.visible = on;
    }
  };
}
