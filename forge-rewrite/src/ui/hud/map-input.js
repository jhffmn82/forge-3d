// The map's pointer input (consolidation H4; ui-22, render-10), moved out of main.js: the hover card and long press
// forwarded to the HUD, the aim square under the mouse, a tap or click on the map, a right-click that ends the aim, and
// a right-click that shuts a door. Every tile is picked through the map view's pickTile, so a body's head drawn over the
// tile above picks that body in the painted look (RB34) and a Block Art tap picks the tile it lands on.

import { mapClick, arrivalCommand, liftedTile } from './map-hover.js';
import { doorClosable } from '../../engine/reads.js';

/**
 * Wires the stage's map pointer events. o: { map (render/map-view.js), ui (screens/flow.js createUi), game: () => the
 * state, play(command), walk(path, onArrive) } (main.js's traveller walks the route a step a turn).
 * @returns {(x:number, y:number) => {x:number, y:number}} the tile a screen point picks
 */
export function attachMapInput(stage, canvas, { map, ui, game, play, walk }) {
  const pickAt = (x, y) => { const t = map.pickTile(x, y); return liftedTile(game(), { x: t.x, y: t.y }, t.below); };
  const onMap = e => !e.target || e.target === stage;
  // 1.7's map hover cursor and card, and its touch long press (sandbox items 57 and 63): ui/hud/map-hover.js via hud.js.
  for (const kind of ['globalpointermove', 'pointerdown', 'pointerup', 'pointerupoutside']) stage.on(kind, e => {
    const live = game() && ui.mode === 'play' && !ui.blocking;
    ui.mapPointer?.(kind, e, live ? () => pickAt(e.global.x, e.global.y) : null, game(), canvas);
  });
  // RB32: while aiming, the target square follows the mouse over the map (off it over the HUD or a window).
  stage.on('globalpointermove', e => {
    if (e.pointerType !== 'mouse' || !game()) return;
    if (ui.aiming && onMap(e)) ui.aimHover?.(pickAt(e.global.x, e.global.y)); else map.markHover(null);
  });
  // AA4 (1.7 game.js:562): a right-click on the map while aiming ends the aim. Pixi sends a right-click as a pointertap
  // too; on the map it never casts, walks or strikes (a door beside the hero: the contextmenu below).
  stage.on('rightclick', e => { if (ui.aiming && onMap(e)) ui.action('close'); });
  stage.on('pointertap', e => {
    if (e.button === 2) return;
    if (ui.mapHeld?.()) return;   // a long press showed a card, or a tap closed one: the map does not act
    const g = game();
    if (ui.blocking || !g || ui.mode !== 'play') return;
    const p = g.actors[g.playerId], t = pickAt(e.global.x, e.global.y);
    // aim mode: a map tap aims (on a body's picture, the body: RB34), it never moves the hero
    if (ui.aiming) return ui.mapTap?.({ x: t.x, y: t.y });
    // T1, T7, RB20 (1.7 travel.js handleMapClick, map-hover.js mapClick): a foe beside the hero is struck, one in the
    // bow's range shot, one further off walked to; known ground, an item, the stairs, a door or a lever is walked to a
    // step a turn (engine/travel.js: it stops when hurt, a foe comes into view or a trap is found) and then used.
    const plan = mapClick(g, t.x, t.y);
    if (!plan) { if (t.x === p.x && t.y === p.y) play({ type: 'wait' }); return; }   // T42: a tap on the hero waits
    if (plan.say) return ui.say(plan.say);
    if (plan.command) return play(plan.command);
    walk(plan.path, plan.then ? () => { const c = arrivalCommand(game(), plan.then); if (c) play(c); } : null);
  });
  // CB29 (1.7 boot.js:324-329): a right-click on an empty open door beside the hero shuts it (aiming takes it first).
  canvas.addEventListener('contextmenu', e => {
    const g = game();
    if (g && ui.mode === 'play' && ui.aiming) { e.preventDefault(); return; }   // AA4: the rightclick above ends the aim, no browser menu
    if (!g || ui.blocking || ui.mode !== 'play' || ui.aiming || ui.mapHeld?.()) return;
    const r = canvas.getBoundingClientRect(), t = map.tileAt(e.clientX - r.left, e.clientY - r.top);
    if (doorClosable(g, t.x, t.y)) { e.preventDefault(); play({ type: 'close-door', x: t.x, y: t.y }); }
  });
  return pickAt;
}
