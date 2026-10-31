// A full UI rebuild waits out a floor hold (sandbox lead, 2026-10-17, from proof pass 13): while main.js holds a floor
// change (the new floor's art still loading, the map still on the old one), a rebuild runs against the new floor half
// made and throws, leaving the hotbar blank and the window stuck open. The gate runs `run` now, or once `held()` turns
// false; asks made during the hold collapse into one run, the newest.

/**
 * @param {() => boolean} held whether a floor hold is on
 * @param {(cb: () => void) => void} [later] how to look again (a frame later in the game; tests pass their own)
 * @returns {(run: () => void) => void}
 */
export function createHoldGate(held, later = cb => requestAnimationFrame(cb)) {
  let pending = null;
  const look = () => {
    if (held()) { later(look); return; }
    const run = pending;
    pending = null;
    run?.();
  };
  return run => {
    if (!held() && !pending) { run(); return; }
    const first = !pending;
    pending = run;
    if (first) later(look);
  };
}
