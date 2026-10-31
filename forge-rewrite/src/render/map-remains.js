// The bodies left on the floor (M10, render-28: moved out of map-view.js): FX14's remains, shown once their tile has
// been seen and dimmed out of sight, and view.remove, which lets a body's remains show once its own sprite is gone.


/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createRemains(k) {
  const { view, inner, remainsLayer, sprites, lift, centre, look, lookCtx, hasSheet, loadSheet } = k;
  view.remove = id => {
    const s = sprites.get(id);
    if (!s) return;
    if (s.mirrored !== undefined) remainsFacing.set(id, s.mirrored);
    s.root.destroy({ children: true }); sprites.delete(id);
    inner.remainsDirty = true;   // its remains, if it left any, show now its own sprite is gone
    if (inner.groundOf?.floor?.corpses?.some(c => c.id === id)) view.setGround(inner.groundOf);   // CR13: its corpse lies down now
  };

  // FX14 (1.7 fx.js:172-189, combat.md C80): bodies lie where they fell for 2000 time units (state.floor.deathRemains,
  // written by rules/death.js), under the living; shown once their tile has been seen, dimmed when out of sight.
  const remainsShown = new Map(), remainsFacing = new Map(), remainsLoading = new Set();
  const liveRemains = () => (inner.remainsOf?.floor?.deathRemains ?? []).filter(r => inner.remainsOf.now < r.expiresAt && !sprites.has(r.id));
  /** True when a body that just died leaves remains (playback then skips the fade). */
  view.leavesRemains = id => !!inner.remainsOf?.floor?.deathRemains?.some(r => r.id === id && inner.remainsOf.now < r.expiresAt);
  const refreshRemains = () => {
    inner.remainsDirty = false;
    if (!look().remains) return;
    const want = new Set();
    for (const r of liveRemains()) {
      want.add(r.id);
      if (remainsShown.has(r.id)) continue;
      if (look().remainsSheet && !hasSheet(r.sheet)) {   // RC6: Block Art's remains are a bar of the body's colour, no sheet
        if (!remainsLoading.has(r.sheet)) { remainsLoading.add(r.sheet); loadSheet(`sheets/${r.sheet}.json`).then(() => { inner.remainsDirty = true; }, () => {}); }
        continue;
      }
      const c = look().remains(r, lookCtx, remainsFacing.get(r.id) ?? false);
      const p = centre(r.x, r.y);
      c.position.set(p.x, p.y); c.zIndex = p.y + lift();
      c.tileX = r.x; c.tileY = r.y;
      remainsLayer.addChild(c); remainsShown.set(r.id, c);
    }
    for (const [id, c] of remainsShown) if (!want.has(id)) { c.destroy({ children: true }); remainsShown.delete(id); }
    remainsSight();
  };
  const remainsSight = () => {
    const st = inner.remainsOf;
    if (!st?.floor) return;
    const W = st.floor.w;
    for (const c of remainsShown.values()) {
      const i = c.tileY * W + c.tileX;
      c.visible = !!st.seen?.[i];
      c.alpha = st.vis?.[i] ? 1 : 0.45;   // 1.7 memA(.45)
    }
  };
  return { remainsShown, liveRemains, refreshRemains, remainsSight };
}
