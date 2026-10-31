// The Underdark caves' chunks, baked off the main thread (M10, render-28: moved out of underdark-raster.js, which draws
// what they hold): the 'deep' worker pool shared by every floor, and each floor's baker, which hands the workers the
// chunks nearest the camera, bakes here what no worker has, places the pictures and swaps in the fine pass (WT9, WT10).

import { Sprite, Texture } from '../../../forge-godot/runtime/pixi.js';
import { workerPool } from './bake-pool.js';
import { S, caveField, bakeFloor, bakeChunk } from './underdark-bake.js';

const RC = 4;   // RC: a chunk, in cells

const BUDGET_MS = 6;    // main-thread baking a frame may take, at most, where workers cannot start (nearest the camera
                        // first, then ahead of it); a chunk bakes in row bands that resume on the next frame or idle slice

// ---- the worker pool (bake-worker.js, the 'deep' lane), shared by every floor, one chunk each at a time, so the nearest chunk is
// always the next one started. As 1.7's pool (terrain-workers.js size): one fewer than the cores, at most four, a phone two.
let nextKey = 1;
let urgent = null;   // the floor being prepared (root.ready): its chunks go to the workers first
const bakers = new Map();   // floor key -> its baker, while the floor is shown
/** A touch device (a phone or a tablet): fewer workers, a smaller cap on fine pictures. */
function phoneLike() { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; }
const POOL = workerPool('deep', () => Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, phoneLike() ? 2 : 4)), (slot, m) => answered(slot, m),
  p => { for (const s of p.workers) s.job = null; for (const b of bakers.values()) b.lost(); }, { sheets: new Set() });   // bake-pool.js; sheets: the ids sent
function answered(slot, m) {
  const sent = slot.job; slot.job = null;
  const b = bakers.get(m.key);
  if (sent && b && sent.baker === b && sent.id === m.id) b.landed(m.id, m);
  else { m.ground?.close?.(); m.rock?.close?.(); }
  for (const x of bakers.values()) x.pump();
}

/** The floor's pool (null: everything is baked here) and its key, before the caves' field is worked out, so the workers start meanwhile. */
export function openFloor() { return { P: POOL.get(), key: nextKey++ }; }
/** Sends the workers the floor and any of its sheets they lack. */
export function sendFloor(P, key, floor, run, { rockP, detailP, mat }) {
  const sent = [rockP, detailP, ...mat.flatMap(m => [m.floor, m.face, m.top])].filter(q => q && !P.sheets.has(q.id));
  const items = [...new Set(sent)].map(q => ({ id: q.id, px: { w: q.w, h: q.h, d: q.d, k: q.k, key: q.key, frames: q.frames } }));
  for (const q of items) P.sheets.add(q.id);
  const ids = { rock: rockP?.id, detail: detailP?.id, mat: mat.map(m => ({ floor: m.floor?.id, face: m.face?.id, top: m.top?.id })) };
  for (const s of P.workers) {
    if (items.length) s.post({ type: 'sheets', items });
    s.post({ type: 'floor', key, floor: bakeFloor(floor), run: { seed: run.seed, floorNo: run.floorNo }, sheets: ids });
  }
}
/** WT18: a released sheet's pixels leave the workers too. */
export function forgetSheet(id) {
  const pool = POOL.current; if (pool && !pool.dead) { pool.sheets.delete(id); for (const s of pool.workers) s.post({ type: 'drop', ids: [id] }); }
}

/** A floor's baker: its chunks over the cells the raster draws, culled, prepared (root.ready), baked and placed into raster and rockRaster. */
export function startChunks({ root, over, floor, run, tile, F, px, P, key, raster, rockRaster, lavaLayer }) {
  const { W, H, need } = F;
  const jobs = [];
  for (let cy = 0; cy < H; cy += RC) for (let cx = 0; cx < W; cx += RC) {
    const cw = Math.min(RC, W - cx), chh = Math.min(RC, H - cy);
    let any = false;
    for (let y = cy; y < cy + chh && !any; y++) for (let x = cx; x < cx + cw; x++) if (need[y * W + x]) { any = true; break; }
    if (any) jobs.push({ box: [cx * tile, cy * tile, (cx + cw) * tile, (cy + chh) * tile], cx, cy, cw, ch: chh, build: () => bakeChunk(F, px, cx, cy, cw, chh), w: cw * tile, h: chh * tile });
  }
  root.stats = { worker: 0, main: 0, fine: 0, dropped: 0, workers: P ? P.workers.length : 0, workerMs: 0 };
  jobs.forEach((j, i) => { j.id = i; });
  const near = (mx, my) => (a, b) => Math.hypot(a.box[0] - mx, a.box[1] - my) - Math.hypot(b.box[0] - mx, b.box[1] - my);
  const overlaps = (j, x0, y0, x1, y1) => j.box[2] > x0 && j.box[0] < x1 && j.box[3] > y0 && j.box[1] < y1;
  // WT10, the fine pass (1.7 bakes 128 samples a tile at every screen size, environment-terrain.js S, and draws it
  // scaled down, which smooths the rock edges): once the floor is baked at 64, the chunks near the camera are baked
  // again at 128, nearest first (by the workers, or here in idle time where there are none), and each chunk takes the
  // finer pictures in place, with mipmaps. Fine pictures are capped in memory as 1.7 caps its 128px cells (48 MiB on a
  // touch screen); the farthest off screen go back to their first pictures. Nothing waits on it.
  const hiS = S;
  let fineField = null;   // the 128 field, for the fine pass baked here (no workers)
  const hiCap = (phoneLike() ? 48 : 192) * 1024 * 1024, fineSize = j => j.cw * hiS * j.ch * hiS * 4 * 2;
  let hiBytes = 0;
  /** Chunks still to bake (tools, the review board, wait for 0). */
  Object.defineProperty(root, 'pending', { get: () => jobs.reduce((n, j) => n + (j.done ? 0 : 1), 0) });
  Object.defineProperty(root, 'fineBytes', { get: () => hiBytes });
  root.hiS = hiS;
  let lastBox = null;
  root.cull = (x0, y0, x1, y1) => {
    const t0 = performance.now(), far = RC * tile;
    for (const f of lavaLayer.children) if (f.box) f.visible = f.box[2] > x0 && f.box[0] < x1 && f.box[3] > y0 && f.box[1] < y1;
    const moved = !lastBox || lastBox.some((v, k) => Math.abs(v - [x0, y0, x1, y1][k]) >= tile / 2);
    if (moved) { jobs.sort(near((x0 + x1) / 2, (y0 + y1) / 2)); lastBox = [x0, y0, x1, y1]; }
    const workers = live();
    for (const j of jobs) {
      const on = overlaps(j, x0 - far, y0 - far, x1 + far, y1 + far);
      j.on = on;
      if (j.sprites) { for (const s of j.sprites) s.visible = on; continue; }
      if ((!workers || j.gen) && !j.done && !j.ready) advance(j, t0 + BUDGET_MS);   // j.gen: a chunk a worker lost
    }
    // Sandbox item 73: at most one finished chunk becomes sprites a frame, the nearest, so the texture uploads spread.
    // Its sprites show this one frame wherever they are (the upload happens now, not the frame they come into view);
    // the next cull hides them if they are off screen. A fine chunk's pictures go in the same way, one a frame.
    const j = jobs.find(q => q.ready);
    if (j) place(j);
    else { const h = jobs.find(q => q.hiReady); if (h) refine(h); }
    view = { x0, y0, x1, y1 };
    if (workers) pump(); else idle();
  };
  /**
   * WT9 (1.7 terrain-workers.js, renderer.js prepareFloorArt): resolves once every chunk over the box (map pixels) is
   * baked and placed, so the floor shows whole (main.js holds it behind "Preparing floor..." meanwhile, map-view.js
   * prepareFloor). The workers take this floor's chunks before any other floor's, and the page bakes the ones no worker
   * has in slices between frames (all of them without workers), so the notice still draws. A worker that never answers
   * holds nothing: after 10 s whatever is left is baked here at once.
   */
  root.ready = (x0, y0, x1, y1) => new Promise(resolve => {
    const t0 = performance.now(), mine = () => jobs.filter(j => !j.done && overlaps(j, x0, y0, x1, y1));
    urgent = key;
    const finish = () => { if (urgent === key) urgent = null; for (const b of bakers.values()) b.pump(); resolve(); };
    root.cull(x0, y0, x1, y1);
    const step = () => {
      if (root.destroyed) return finish();
      const late = performance.now() - t0 > 10000;
      for (const j of mine()) {
        if (j.ready) place(j);
        else if (late) { advance(j, Infinity); if (j.ready) place(j); }
      }
      const left = mine();
      if (!left.length) return finish();
      // the page helps while the floor is held, as 1.7's did (terrain-workers.js): a chunk no worker has, in slices
      if (live()) pump();
      const j = left.find(q => !q.ready && !q.sent);
      if (j) advance(j, performance.now() + 12);
      setTimeout(step, 0);
    };
    step();
  });
  const baker = { key, pump: () => pump(), landed, lost: () => { for (const j of jobs) { j.sent = false; j.hiSent = false; } } };
  /** The pool while it works for this floor (null: everything is baked here). */
  function live() { return P && !P.dead && !root.destroyed ? P : null; }
  /** The chunks the fine pictures may cover now: the nearest baked ones, as many as the cap holds. */
  function fineSet() {
    const out = new Set();
    let bytes = 0;
    for (const j of jobs) { if (!j.sprites) continue; bytes += fineSize(j); if (bytes > hiCap) break; out.add(j); }
    return out;
  }
  /** Hands each idle worker the nearest chunk nobody has started (a floor being prepared goes first), then fine ones. */
  function pump() {
    const Q = live();
    if (!Q || (urgent !== null && urgent !== key && bakers.has(urgent))) return;
    let fineOk = null;
    for (const s of Q.workers) {
      if (s.job) continue;
      let j = jobs.find(q => !q.done && !q.ready && !q.sent && !q.gen), hi = false;
      if (!j && hiS && urgent === null && !jobs.some(q => !q.done)) {
        fineOk ??= fineSet();
        j = jobs.find(q => fineOk.has(q) && !q.hiTex && !q.hiReady && !q.hiSent) ?? null; hi = !!j;
      }
      if (!j) return;
      if (hi) j.hiSent = true; else j.sent = true;
      s.job = { baker, id: j.id };
      s.post({ type: 'chunk', key, id: j.id, cx: j.cx, cy: j.cy, cw: j.cw, ch: j.ch, ...(hi ? { S: hiS } : {}) });
    }
  }
  function landed(id, m) {
    const j = jobs.find(q => q.id === id);
    const drop = () => { m.ground?.close?.(); m.rock?.close?.(); };
    if (!j || root.destroyed) return drop();
    if (m.hi) {   // a fine chunk's pictures
      j.hiSent = false;
      if (m.lost || !m.ground || !j.sprites || j.hiTex || j.hiReady) return drop();
      root.stats.workerMs += m.ms ?? 0;
      j.hiReady = { ground: m.ground, rock: m.rock };
      return;
    }
    if (j.done || j.ready) return drop();
    j.sent = false;
    if (m.lost) { j.gen = j.build(); return; }   // the worker no longer holds this floor: baked here
    root.stats.worker++; root.stats.workerMs += m.ms ?? 0;
    j.ready = m.ground ? { ground: m.ground, rock: m.rock } : null;
    if (!j.ready) j.done = true;
  }
  /** Bakes a job's bands here until the clock passes `until` or the chunk is done (then it waits to be placed). */
  function advance(j, until) {
    const tb = performance.now();
    j.gen ??= j.build();
    let r = { done: false };
    while (performance.now() < until && !(r = j.gen.next()).done);
    root.bakeMs = (root.bakeMs ?? 0) + performance.now() - tb;
    if (!r.done) return;
    const c = r.value; j.gen = null; root.stats.main++;
    if (!c) { j.done = true; return; }
    const canvas = d => { const cv = document.createElement('canvas'); cv.width = c.PW; cv.height = c.PH; cv.getContext('2d').putImageData(new ImageData(d, c.PW, c.PH), 0, 0); return cv; };
    j.ready = { ground: canvas(c.ground), rock: canvas(c.rock) };
  }
  function place(j) {
    const c = j.ready; j.ready = null; j.done = true;
    j.sprites = [[c.ground, raster], [c.rock, rockRaster]].map(([src, into]) => {
      const s = new Sprite(Texture.from(src)); s.position.set(j.box[0], j.box[1]); s.width = j.w; s.height = j.h; into.addChild(s); return s;
    });
    j.lo = j.sprites.map(s => s.texture);
  }
  /** A chunk takes its fine pictures; over the cap, the farthest fine chunks off screen take their first ones again. */
  function refine(j) {
    const c = j.hiReady; j.hiReady = null;
    if (!j.sprites || j.hiTex) { c.ground.close?.(); c.rock.close?.(); return; }
    j.hiTex = [c.ground, c.rock].map(src => {
      const t = Texture.from(src);
      t.source.autoGenerateMipmaps = true;   // drawn smaller than baked between screen sizes: mipmaps keep the grain from shimmering
      return t;
    });
    j.sprites.forEach((s, k) => { s.texture = j.hiTex[k]; s.width = j.w; s.height = j.h; });
    j.hiBytes = fineSize(j); hiBytes += j.hiBytes; root.stats.fine++;
    if (hiBytes <= hiCap) return;
    for (let i = jobs.length - 1; i >= 0 && hiBytes > hiCap; i--) { const q = jobs[i]; if (q.hiTex && !q.on) coarsen(q); }
  }
  function coarsen(j) {
    j.sprites.forEach((s, k) => { s.texture = j.lo[k]; s.width = j.w; s.height = j.h; });
    for (const t of j.hiTex) release(t);
    j.hiTex = null; hiBytes -= j.hiBytes; j.hiBytes = 0; root.stats.dropped++;
  }
  // Idle time bakes ahead here when there are no workers (the nearest chunks still pending), so a chunk is usually
  // ready before it comes into view.
  let view = null, idleOn = false;
  // With every chunk baked, idle time bakes the fine pass here too (WT10), nearest first, as the workers would.
  const fineLeft = () => { const ok = fineSet(); return jobs.filter(j => ok.has(j) && !j.hiTex && !j.hiReady && !j.hiNone); };
  function idle() {
    if (idleOn || typeof requestIdleCallback === 'undefined' || root.destroyed) return;
    if (!root.pending && (urgent !== null || !fineLeft().length)) return;
    idleOn = true;
    requestIdleCallback(deadline => {
      idleOn = false;
      if (root.destroyed || live()) return;
      const left = jobs.filter(j => !j.done && !j.ready).sort(near(view ? (view.x0 + view.x1) / 2 : 0, view ? (view.y0 + view.y1) / 2 : 0));
      for (const j of left) {
        if (deadline.timeRemaining() < 2) break;
        advance(j, performance.now() + Math.max(1, deadline.timeRemaining() - 1));
      }
      if (!root.pending && urgent === null) for (const j of fineLeft()) {
        if (deadline.timeRemaining() < 2) break;
        advanceFine(j, performance.now() + Math.max(1, deadline.timeRemaining() - 1));
      }
      idle();
    }, { timeout: 500 });
  }
  /** Bakes a chunk's fine pictures here (no workers) until the clock passes `until`; done, it waits to be refined. */
  function advanceFine(j, until) {
    fineField ??= caveField(floor, run, hiS);
    j.hiGen ??= bakeChunk(fineField, px, j.cx, j.cy, j.cw, j.ch);
    let r = { done: false };
    while (performance.now() < until && !(r = j.hiGen.next()).done);
    if (!r.done) return;
    const c = r.value; j.hiGen = null;
    if (!c) { j.hiNone = true; return; }   // nothing to draw: it keeps its first pictures
    const canvas = d => { const cv = document.createElement('canvas'); cv.width = c.PW; cv.height = c.PH; cv.getContext('2d').putImageData(new ImageData(d, c.PW, c.PH), 0, 0); return cv; };
    j.hiReady = { ground: canvas(c.ground), rock: canvas(c.rock) };
  }
  if (P) bakers.set(key, baker);
  if ((typeof __FORGE_PUBLIC__ === 'undefined' || !__FORGE_PUBLIC__) && typeof window !== 'undefined') window.forgeUnderdark = root;   // tools (the review board) wait for root.pending
  const release = t => { const r = t.source?.resource; t.destroy(true); r?.close?.(); };
  const closeReady = r => { r?.ground.close?.(); r?.rock.close?.(); };
  // each layer gives its baked textures back once its own sprites are gone
  root.on('destroyed', () => {
    bakers.delete(key);
    if (urgent === key) urgent = null;
    for (const j of jobs) {
      if (j.lo) release(j.lo[0]);
      if (j.hiTex) release(j.hiTex[0]);
      closeReady(j.ready); closeReady(j.hiReady); j.ready = j.hiReady = null;
    }
  });
  over.on('destroyed', () => { for (const j of jobs) { if (j.lo) release(j.lo[1]); if (j.hiTex) release(j.hiTex[1]); } });
}
