// The terrain bakes' workers (consolidation M8, render-04): one worker entry, bake-worker.js, takes both the Realm's
// rock raster (realm-bake.js, lane 'realm') and the Underdark's cave chunks (underdark-raster.js, lane 'deep') by the
// lane each message carries. Each lane keeps its own pool and its own size, as before; this is how both start one.

/**
 * A lane's pool of bake workers, started the first time `get()` asks: `size()` slots {w, job, post(message,
 * transfer)}; post adds the lane. answered(slot, m) gets every answer. If the workers cannot start (no Worker, no
 * OffscreenCanvas, no page, FORGE_NO_WORKERS) or one fails, the pool is dead: onDead(pool) hands its slots' jobs back
 * and the lane bakes on the main thread from then on. `extra`: the lane's own fields on the pool object.
 */
export function workerPool(lane, size, answered, onDead, extra = {}) {
  let pool = null;
  const kill = () => {
    if (!pool || pool.dead) return;
    pool.dead = true;
    for (const s of pool.workers) { try { s.w.terminate(); } catch { /* gone */ } }
    onDead(pool);
  };
  const get = () => {
    if (pool) return pool.dead ? null : pool;
    pool = { workers: [], dead: false, ...extra };
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof document === 'undefined' || globalThis.FORGE_NO_WORKERS) throw new Error('no workers');
      for (let i = 0, n = size(); i < n; i++) {
        const w = new Worker(new URL('build/bake-worker.js', document.baseURI), { type: 'module' });
        const slot = { w, job: null, post: (m, transfer = []) => w.postMessage({ ...m, lane }, transfer) };
        w.onmessage = e => answered(slot, e.data);
        w.onerror = e => { e.preventDefault?.(); kill(); };
        pool.workers.push(slot);
      }
    } catch { kill(); return null; }
    return pool;
  };
  return { get, kill, get current() { return pool; } };
}
