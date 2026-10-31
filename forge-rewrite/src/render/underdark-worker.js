// A worker that bakes the Underdark caves' per-pixel chunks off the main thread (sandbox item 73: a chunk is 30-60 ms
// of work, so walking into new rock dropped frames). underdark-raster.js sends the sheets' pixels once each
// ({type: 'sheets', items: [{id, px}]}), each floor once ({type: 'floor', key, floor, run, sheets}) and then chunks
// ({type: 'chunk', key, id, cx, cy, cw, ch, S?}: at 64 samples a tile, or at S for the fine pass, audit WT10); each
// answer is {key, id, hi, ground, rock, ms} (two ImageBitmaps handed over, not copied; null for a chunk with nothing to
// draw) or {key, id, hi, lost} when the floor is no longer held here.
// The 'deep' lane of bake-worker.js (M8, render-04), which tools/dev/serve.mjs bundles as build/bake-worker.js.

import { caveField, bakeChunk, S_MAIN } from './underdark-bake.js';

const sheets = new Map();   // id -> pixels; a sheet released on the page is sent again under a new id
const floors = new Map();   // key -> {floor, run, fields, px}, the newest three floors (the one shown, the one being entered, a rebuild)
function bitmap(d, w, h) {
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(d, w, h), 0, 0);
  return c.transferToImageBitmap();
}
export function onDeep(m) {
  if (m.type === 'sheets') {
    for (const { id, px } of m.items) sheets.set(id, px);
    while (sheets.size > 24) sheets.delete(sheets.keys().next().value);
    return;
  }
  if (m.type === 'drop') {   // WT18: sheets the page released, and the floors built from them
    const gone = new Set(m.ids.map(id => sheets.get(id)).filter(Boolean));
    for (const id of m.ids) sheets.delete(id);
    for (const [k, f] of floors) if ([f.px.rockP, f.px.detailP, ...f.px.mat.flatMap(t => [t.floor, t.face, t.top])].some(q => q && gone.has(q))) floors.delete(k);
    return;
  }
  if (m.type === 'floor') {
    const get = id => (id == null ? null : sheets.get(id) ?? null), s = m.sheets;
    floors.set(m.key, { floor: m.floor, run: m.run, fields: new Map(), px: { rockP: get(s.rock), detailP: get(s.detail), mat: s.mat.map(t => ({ floor: get(t.floor), face: get(t.face), top: get(t.top) })) } });
    while (floors.size > 3) floors.delete(floors.keys().next().value);
    return;
  }
  if (m.type !== 'chunk') return;
  const f = floors.get(m.key), hi = !!m.S, n = m.S ?? S_MAIN;
  if (!f) { self.postMessage({ key: m.key, id: m.id, hi, lost: true }); return; }
  if (!f.fields.has(n)) f.fields.set(n, caveField(f.floor, f.run, n));
  const t0 = performance.now(), gen = bakeChunk(f.fields.get(n), f.px, m.cx, m.cy, m.cw, m.ch);
  let r;
  while (!(r = gen.next()).done);
  const c = r.value;
  if (!c) { self.postMessage({ key: m.key, id: m.id, hi, ground: null, rock: null, ms: performance.now() - t0 }); return; }
  const ground = bitmap(c.ground, c.PW, c.PH), rock = bitmap(c.rock, c.PW, c.PH);
  self.postMessage({ key: m.key, id: m.id, hi, ground, rock, ms: performance.now() - t0 }, [ground, rock]);
}
