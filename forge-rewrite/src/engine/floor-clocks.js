// A paused floor does not tick (spec/world.md 838; planes 37): while the hero is away, every world-clock stamp on the
// stored floor and its creatures (a field's or prop's `until`, a corpse's rise `at`, a mark's `landAt`, a status's
// `born`, any `...At`, and each move's stamp in a creature's readyAt) moves on by the time spent away, so nothing there
// ran out or landed in the meantime.

export function pauseClocks(stored, dt) {
  if (!(dt > 0)) return;
  const STAMP = /^(until|at|born|coldSince)$|.At$/;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6 || ArrayBuffer.isView(o)) return;
    if (Array.isArray(o)) { if (o.length && typeof o[0] !== 'object') return; for (const v of o) walk(v, depth + 1); return; }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'leftAt') continue;
      if (k === 'readyAt' && v && typeof v === 'object') { for (const m in v) if (Number.isFinite(v[m])) v[m] += dt; continue; }   // C5 cooldowns: one stamp per move
      if (typeof v === 'number' && STAMP.test(k) && Number.isFinite(v)) o[k] = v + dt;
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(stored.floor, 0);   // tiles, ground and other number arrays are skipped whole
  for (const c of stored.creatures ?? []) walk(c, 0);
}
