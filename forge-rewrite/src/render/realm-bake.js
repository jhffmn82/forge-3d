// When the planes' and the Realm's terrain chunks get drawn (1.7 environment-terrain.js bakeView, its idle ahead ring
// and its worker pool, audit WT8). Before: a chunk was painted on the main thread the frame it came near the camera,
// a 100-400 ms stall for each one a step brought into view. Now:
// - the natural-rock raster is painted by a small pool of workers (bake-worker.js, the 'realm' lane), nearest the camera first, and the
//   rest of the floor goes on being painted ahead in the background, so walking never waits on a chunk;
// - ready(box) gives a promise for the chunks over a box: the floor is held behind "Preparing floor..." until the view
//   is drawn (main.js holdFloor, map-view.js prepareFloor), so nothing pops in;
// - jobs a worker cannot do (the Realm's void painter needs the page's canvas) and every job when workers cannot start
//   are painted on the main thread: ahead in idle time, and at worst the frame they come into view, as before;
// - full detail at once (audit WT7, 1.7 environment-terrain.js enhance: a cell is drawn at its final 128 px detail the
//   first time it is drawn, never as a coarser picture first): every chunk is painted once, at 1.7's 128 samples a
//   cell, and never swapped for another picture, so nothing sharpens after the floor shows;
// - the painted chunks are capped in memory as 1.7 caps its cells (realm-view.js: twice the view's cells; at most 768
//   cells, 48 MiB, on a touch screen): only the nearest chunks the cap holds are painted, and when the view moves on
//   the farthest off screen are let go, to be painted again at full detail when they come near (1.7 trim: a cell on
//   screen is never let go);
// - the floor waits on the chunks over the view that hold a cell the hero knows (1.7 bakeView: windowCells knownOnly),
//   the page does not paint worker chunks itself while it waits: a chunk is most of a second, a frozen frame;
// - a rebuild of the same floor (a resize, a new tile size, a hidden door found) takes the pictures already painted: they
//   do not depend on the tile size, so the terrain never goes dark again while the workers repaint it; a chunk whose
//   cells changed shows its old picture until the new one lands.
// Presentation only.

import { Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { workerPool } from './bake-pool.js';

const BUDGET_MS = 24;   // main-thread chunks drawn in one frame, at most this long (a chunk that starts always finishes)
let nextKey = 1;

// The lane's pool (bake-pool.js; render-04): one fewer than the cores, at most three. If the workers die, each job one
// had goes back to its floor's baker.
const POOL = workerPool('realm', () => Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1)), (slot, m) => answered(slot, m),
  p => { for (const s of p.workers) if (s.job) { const { baker, job } = s.job; s.job = null; job.sent = false; baker.wake(); } });
/**
 * Starts the workers and has each paint a small made-up patch, so the first real chunks do not pay the engine's warm-up
 * (several times a chunk's cost). Called on a floor with a plane portal (realm-view.js), ahead of the plane.
 */
export function warmRealmWorkers() {
  const P = POOL.get();
  if (!P || P.warmed) return;
  P.warmed = true;
  for (const s of P.workers) s.post({ type: 'warm' });
}
function answered(slot, m) {
  const sent = slot.job; slot.job = null;
  if (sent && sent.job.id === m.id && sent.baker.key === m.key) sent.baker.landed(sent.job, m.bitmap ?? null, m.lost, slot);
  else m.bitmap?.close?.();
  for (const b of bakers) b.pump();
}
const bakers = new Set();
/** The pictures of the last floor's terrain taken down, kept for its next build: {floor, tex: Map(key -> {tex, bytes})}. */
let carried = null;
function dropCarried() {
  if (!carried) return;
  for (const c of carried.tex.values()) c.tex?.destroy(true);
  carried = null;
}

/**
 * @param {object} o
 * @param {object|null} o.data realm-fields.js rasterFields data, for the workers (null: no raster jobs)
 * @param {{box:number[], w:number, h:number, into:import('../../../forge-godot/runtime/pixi.js').Container, build:() => any, raster?:object}[]} o.jobs
 *   box in map pixels; build() paints the chunk here (a canvas or null); raster {cx, cy, cw, ch, S} when a worker may
 * @param {number} o.far how far beyond the screen a chunk counts as near (map pixels)
 * @param {number} [o.cap] bytes the painted raster chunks may hold at once (0: no cap)
 * @param {object} [o.floor] the floor drawn, with a `key` on each job: a rebuild of it takes the pictures already painted
 */
export function createBaker({ data, jobs, far, cap = 0, floor = null }) {
  const key = nextKey++;
  let bytes = 0;
  let centre = null, dead = false, idle = null, waiting = [];
  jobs.forEach((j, i) => { j.id = i; j.done = false; j.sent = false; });
  const P = data ? POOL.get() : null;
  if (P) for (const s of P.workers) s.post({ type: 'fields', key, data });
  const baker = {
    key, stats: { worker: 0, main: 0, mainMs: 0, dropped: 0 },
    get bytes() { return bytes; },
    get pending() { return jobs.reduce((n, j) => n + (j.done ? 0 : 1), 0); },
  };
  const place = (j, src) => {
    if (dead || j.done) { src?.close?.(); return; }
    j.done = true;
    if (j.stand) { unstand(j); }
    if (src) {
      const s = new Sprite(Texture.from(src)); s.position.set(j.box[0], j.box[1]); s.width = j.w; s.height = j.h;
      j.into.addChild(s); j.sprite = s;
      if (j.raster) { j.bytes = (src.width || 0) * (src.height || 0) * 4; bytes += j.bytes; trim(); }
    }
    settle();
  };
  /** A changed chunk's old picture, shown until its new one is painted (so a hidden door found never shows a hole). */
  const unstand = j => { const { sprite, tex } = j.stand; j.stand = null; sprite.destroy(); for (const t of tex) t?.destroy(true); };
  const paint = j => { const t0 = performance.now(); const c = j.build(); baker.stats.main++; baker.stats.mainMs += performance.now() - t0; place(j, c); };
  const dist = j => (centre ? Math.hypot((j.box[0] + j.box[2]) / 2 - centre[0], (j.box[1] + j.box[3]) / 2 - centre[1]) : 0);
  const overlaps = (j, b) => j.box[2] > b[0] && j.box[0] < b[2] && j.box[3] > b[1] && j.box[1] < b[3];
  const workable = j => !!(j.raster && P && !P.dead);
  // ---- the memory cap (1.7 environment-terrain.js cap, trim)
  const sizeOf = j => j.raster.cw * j.raster.S * j.raster.ch * j.raster.S * 4;
  /** The raster chunks the cap holds now: the nearest first, as many as fit (all of them with no cap). */
  let wantedMemo = null;
  const wanted = () => {
    if (wantedMemo) return wantedMemo;
    const list = jobs.filter(j => j.raster).sort((a, b) => dist(a) - dist(b)), out = new Set();
    let n = 0;
    for (const j of list) { n += sizeOf(j); if (cap && n > cap && out.size) break; out.add(j); }
    return (wantedMemo = out);
  };
  const onScreen = j => !!(j.sprite?.visible);
  /** Over the cap: the farthest painted chunks the cap no longer holds, off screen, are let go (painted again when near). */
  function trim() {
    if (!cap || bytes <= cap) return;
    const keep = wanted();
    for (const q of jobs.filter(j => j.raster && j.sprite && j.bytes).sort((a, b) => dist(b) - dist(a))) {
      if (bytes <= cap) break;
      if (!keep.has(q) && !onScreen(q)) drop(q);
    }
  }
  function drop(q) {
    bytes -= q.bytes; q.bytes = 0;
    q.sprite.destroy({ texture: true, textureSource: true }); q.sprite = null;
    q.done = false; q.sent = false; baker.stats.dropped++;
  }
  function settle() {
    waiting = waiting.filter(w => { if (jobs.some(j => !j.done && w.need(j))) return true; w.resolve(); return false; });
  }
  // A worker that had forgotten this floor's fields (it keeps the newest few) is sent them again, then the chunk.
  baker.landed = (j, bitmap, lost, slot) => {
    if (lost) {
      if (!j.done) j.sent = false;
      if (!dead && slot && data) slot.post({ type: 'fields', key, data });
      baker.pump(); return;
    }
    baker.stats.worker++; place(j, bitmap);
  };
  /** The nearest raster chunk the cap holds that is not yet drawn or sent (null: none). */
  const nextRaster = () => {
    let best = null, bd = Infinity;
    for (const j of wanted()) if (!j.done && !j.sent) { const d = dist(j); if (d < bd) { bd = d; best = j; } }
    return best;
  };
  /** Hands each free worker the nearest chunk not yet drawn or sent. */
  baker.pump = () => {
    if (dead || !P || P.dead) return;
    for (const s of P.workers) {
      if (s.job) continue;
      const best = nextRaster();
      if (!best) return;
      best.sent = true;
      s.job = { baker, job: best };
      s.post({ type: 'chunk', key, id: best.id, ...best.raster });
    }
  };
  /** Main-thread chunks ahead of need, in idle time: the nearest first, one per idle slice with room for it. */
  const ahead = () => {
    if (dead || idle !== null) return;
    const run = deadline => {
      idle = null;
      if (dead) return;
      const left = jobs.filter(j => !j.done && !j.sent && !workable(j) && (!j.raster || wanted().has(j)));
      if (!left.length) return;
      if (deadline.timeRemaining() > 12) { left.sort((a, b) => dist(a) - dist(b)); paint(left[0]); }
      ahead();
    };
    idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 2000 }) : setTimeout(() => run({ timeRemaining: () => 16 }), 50);
  };
  /** Proof items 1-3 (sandbox lead 2026-10-17): the cap can change while the floor is up (realm-view.js lifts it while
   *  the sandbox's Reveal map or Map mode shows the whole floor); the chunks it now holds are painted, nearest the view first. */
  baker.setCap = n => { if (n === cap) return; cap = n; wantedMemo = null; trim(); baker.pump(); ahead(); };
  /** After a change (a worker free, the workers gone): the workers fed; with no workers, a held view drawn here now. */
  baker.wake = () => {
    if (!dead && waiting.length && (!P || P.dead)) for (const j of jobs) if (!j.done && waiting.some(w => w.need(j))) paint(j);
    baker.pump(); ahead();
  };
  /** Each frame (map-view.js): built chunks near the screen shown, the rest hidden; the nearest asked for first. */
  baker.cull = (x0, y0, x1, y1) => {
    const c = [(x0 + x1) / 2, (y0 + y1) / 2];
    if (!centre || c[0] !== centre[0] || c[1] !== centre[1]) wantedMemo = null;
    centre = c;
    const t0 = performance.now();
    for (const j of jobs) {
      const on = j.box[2] > x0 - far && j.box[0] < x1 + far && j.box[3] > y0 - far && j.box[1] < y1 + far;
      if (j.sprite) { j.sprite.visible = on; continue; }
      // In view and nothing else will draw it in time: drawn now, as before (never when a worker has it).
      if (on && !j.done && !j.sent && !workable(j) && j.box[2] > x0 && j.box[0] < x1 && j.box[3] > y0 && j.box[1] < y1 && performance.now() - t0 < BUDGET_MS) paint(j);
    }
    trim();
    baker.wake();
  };
  /**
   * Resolves once every chunk over the box is drawn (the rest follow, nearest first); main-thread ones are drawn now.
   * With `known(job)`, only the chunks over the box it accepts are waited on (1.7 bakeView: the cells the hero knows);
   * when it accepts none of them, all of them are.
   */
  baker.ready = (x0, y0, x1, y1, known = null) => {
    centre = [(x0 + x1) / 2, (y0 + y1) / 2]; wantedMemo = null;
    const box = [x0, y0, x1, y1], over = jobs.filter(j => overlaps(j, box));
    const held = new Set(known && over.some(known) ? over.filter(known) : over);
    const need = j => held.has(j);
    for (const j of held) if (!j.done && !j.sent && !workable(j)) paint(j);
    // A worker that never answers must not hold the floor: after 10 s whatever is left over the view is drawn here.
    setTimeout(() => { if (!dead && waiting.length) for (const j of held) if (!j.done) paint(j); }, 10000);
    const p = new Promise(resolve => { waiting.push({ box, need, resolve }); settle(); });
    baker.wake();
    return p;
  };
  /** Tools (the board capture): everything drawn now, here. */
  baker.buildAll = () => { for (const j of jobs) if (!j.done) paint(j); };
  baker.destroy = () => {
    dead = true; bakers.delete(baker);
    if (idle !== null) (typeof cancelIdleCallback === 'function' ? cancelIdleCallback : clearTimeout)(idle);
    for (const w of waiting) w.resolve();
    waiting = [];
    // Kept for this floor's next build, unless the game has moved on to another floor (its terrain is up or being made).
    const keep = floor && ![...bakers].some(b => b.floor !== floor);
    if (keep) {
      dropCarried();
      const mine = carried = { floor, tex: new Map() };
      setTimeout(() => { if (carried === mine) dropCarried(); });   // a rebuild comes at once (map-view.js setFloor); else freed
    }
    for (const j of jobs) {
      if (j.stand) for (const t of j.stand.tex) t?.destroy(true);
      const tex = j.sprite?.texture ?? null;
      if (keep && tex && j.key !== undefined) { carried.tex.set(j.key, { tex, bytes: j.bytes ?? 0 }); continue; }   // the sprite goes, its picture stays
      tex?.destroy(true);
    }
  };
  // The same floor built again: its painted chunks are placed now (scaled to this tile size), only the rest are painted.
  if (carried && (!floor || carried.floor !== floor)) dropCarried();
  if (carried) {
    for (const j of jobs) {
      const c = j.key !== undefined ? carried.tex.get(j.key) : null;
      if (!c) continue;
      carried.tex.delete(j.key);
      place(j, null);
      const s = new Sprite(c.tex); s.position.set(j.box[0], j.box[1]); s.width = j.w; s.height = j.h;
      j.into.addChild(s); j.sprite = s;
      if (j.raster) { j.bytes = c.bytes; bytes += c.bytes; }
    }
    // A chunk whose cells changed is painted again; its old picture stands in until then.
    const byPlace = new Map([...carried.tex].map(([k, c]) => [k.split(':')[0], [k, c]]));
    for (const j of jobs) {
      const old = !j.done && j.key !== undefined ? byPlace.get(j.key.split(':')[0]) : null;
      if (!old || !carried.tex.has(old[0])) continue;
      carried.tex.delete(old[0]);
      const sprite = new Sprite(old[1].tex); sprite.position.set(j.box[0], j.box[1]); sprite.width = j.w; sprite.height = j.h;
      j.into.addChild(sprite); j.stand = { sprite, tex: [old[1].tex] };
    }
    dropCarried();
  }
  baker.floor = floor;
  bakers.add(baker);
  baker.wake();
  return baker;
}
