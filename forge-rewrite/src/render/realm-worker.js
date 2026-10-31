// A worker that paints the planes' and the Realm's natural-rock raster off the main thread (1.7's environment-terrain.js
// worker pool, audit WT8): a step never waits on a chunk being drawn. realm-bake.js sends each floor's fields once
// ({type: 'fields', key, data}: realm-fields.js rasterFields) and then chunks ({type: 'chunk', key, id, cx, cy, cw, ch,
// S}); each answer is {key, id, bitmap} (null for a chunk with no rock), the bitmap handed over, not copied.
// The 'realm' lane of bake-worker.js (M8, render-04), which tools/dev/serve.mjs bundles as build/bake-worker.js.

import { rasterChunk } from './realm-raster.js';
import { rasterFields } from './realm-fields.js';

/** A made-up 10 x 10 cell patch of Earth plane (a room in rock with a pool), painted once and thrown away. */
function warm() {
  const W = 10, H = 10, wall = new Uint8Array(W * H), dist = new Uint8Array(W * H), pool = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const edge = x < 2 || y < 2 || x > 7 || y > 7; wall[y * W + x] = edge ? 1 : 0; dist[y * W + x] = edge ? Math.max(x < 2 ? 2 - x : x > 7 ? x - 7 : 0, y < 2 ? 2 - y : y > 7 ? y - 7 : 0) : 0; }
  pool[5 * W + 5] = 1;
  const F = rasterFields({ W, H, salt: 7, pool, mats: ['earth'], mat: new Uint8Array(W * H).fill(1), wall, moss: new Uint8Array(W * H), dist, center: null, suns: [], rock: null });
  rasterChunk(F, 1, 1, 8, 8, 48)?.transferToImageBitmap().close();
}
const fields = new Map();   // key -> F, the newest three floors (the one shown, the one being entered, a rebuild); an
                            // older one's chunk answers lost, and realm-bake.js sends its fields again
export function onRealm(m) {
  if (m.type === 'fields') {
    fields.set(m.key, rasterFields(m.data));
    while (fields.size > 3) fields.delete(fields.keys().next().value);
    return;
  }
  if (m.type === 'warm') { warm(); return; }
  if (m.type !== 'chunk') return;
  const F = fields.get(m.key);
  let bitmap = null;
  if (F) { const c = rasterChunk(F, m.cx, m.cy, m.cw, m.ch, m.S); bitmap = c ? c.transferToImageBitmap() : null; }
  self.postMessage({ key: m.key, id: m.id, bitmap, lost: !F }, bitmap ? [bitmap] : []);
}
