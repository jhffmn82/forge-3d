// The map's own redraws for each event as it plays (consolidation M9, render-25): main.js hands every event to
// map.onEvent and the map decides which of its layers change; main.js keeps only the wiring. What only the page can
// load comes in with the call: load.sheets(bodies) (their body sheets) and load.group(name) (an art group).

/** Events that change a door, a trap, a prop, a chest, an item or a mark: the pieces among the bodies. */
const STRUCTURES = new Set(['trap', 'trap-found', 'fell', 'pickup', 'chest', 'drops', 'expired', 'spawned', 'telegraph', 'telegraph-end', 'prop-broken', 'explosion', 'terrain']);
/** Events that leave something on the ground (rubble, scorch, a collapse). */
const GROUND = new Set(['prop-broken', 'explosion', 'collapse']);

/** Redraws what `ev` changed on `view` (map-view.js) for the game `state`. */
export function mapEvent(view, ev, state, load) {
  if (ev.type === 'sight') view.setSight(state);
  if (ev.type === 'door') { if (ev.found) view.setTerrain(state); view.setStructures(state); }
  if (ev.type === 'ground') {
    view.setGround(state, ev);   // item 147: a trampled tile redraws only its grass
    // Burning, freezing and regrowth change which Crypt flowers share a mushroom cell (item 336).
    if (state.floor.biome === 'crypt' && !(ev.ground === 2 && ev.by)) view.setStructures(state);
  }
  if (STRUCTURES.has(ev.type)) view.setStructures(state);
  if (GROUND.has(ev.type)) view.setGround(state);
  if (ev.type === 'spawned') load.sheets([state.actors[ev.id]].filter(Boolean)).then(() => view.addActor(state, ev.id, ev));
  if (ev.type === 'despawned') view.remove(ev.id);   // CV14: the Maw dives; it is drawn again where it surfaces
  // CH1: the Unmaker's next form: its sheet, then its new picture, playing the change (1.7 animation 'transition', a cast).
  if (ev.type === 'boss-form') load.sheets([state.actors[ev.id]].filter(Boolean)).then(() => { const s = view.redrawActor(state, ev.id); s?.play('cast').then(run => { if (!s.destroyed) s.idle(run); }); });
  if (ev.type === 'fell') view.remove(ev.id);
  if (ev.type === 'hero') {
    view.refreshGear(state);
    // RC3: joining Chad or a Tourist's outfit changes the look the hero is drawn in; the old body stands until it loads.
    const want = state.actors[state.playerId]?.look?.sheet, now = view.sprite(state.playerId)?.sheet;
    if (want && now && now !== want) load.group('look-' + want.replace(/^cast-/, '')).then(() => view.syncLook(state, state.playerId)).catch(() => {});
  }
}
