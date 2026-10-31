// The map's bodies (M10, render-28: moved out of map-view.js): how each body's sprite is made in the look drawn,
// its echo, Shade, charge, rim and facing, and how a few are drawn from their state each frame (asleep, faint in water,
// channelling, entombed).

import monsters from '../../data/monsters.json' with { type: 'json' };
import { createActorSprite } from './actor-sprite.js';
import { createLivingFlame } from './living-flame.js';
import { objArt, objSprite } from './art.js';
import { tileAt, T } from '../data/tiles.js';

/**
 * Item 321: the monster row a body is drawn by. A Corrupted body's Shade (god-powers.js raiseCopy) keeps its own kind's
 * moves but is drawn on the Shade's sheet, so its clips (stride, fidget, strike), burrow and pose are the Shade's: a
 * Shade of a rat played the rat's sniff, a row the Shade's sheet does not have, and the map threw on every frame.
 */
export const drawnLook = a => monsters.rows?.[a.shade ? 'shade' : a.kind]?.look ?? {};

/** Installs its part of the map view on k (map-view.js createMapView: the view, its layers and shared state). */
export function createBodies(k) {
  const { view, clock, inner, pieces, clarity, look, lookCtx, hasSheet, loadSheet } = k;
  // RC11 (1.7 isShadeSummon, render.js:929): an ally that is a Shade, by its flag (Corrupt) or its kind (the Swarm's).
  const isShadeSummon = a => a.side === 'ally' && (!!a.shade || a.kind === 'shade-swarm' || a.kind === 'shade');
  // RC4 (1.7 render.js:2467 charged=(flameShots%3)===2): a body whose every-Nth move fires on its next use glows charged.
  const flameCharged = a => (monsters.rows?.[a.kind]?.moves ?? []).some(m => m.alsoEveryNth && ((a.moveUses?.[m.id] ?? 0) % m.alsoEveryNth.n) === m.alsoEveryNth.n - 1);
  // A body's sprite in the look drawn (LOOKS); none for a boss's limbs (PT16) in any look (RC6). Painted: RC4, CV12.
  const makeSprite = a => (!a.look || a.limbOf ? null : look().body(a, lookCtx));
  const paintedBody = a => {
    if (a.kind === 'living-flame') {
      // Its picture is a lone image in the play group's files, not a sheet: fetched the first time, then drawn.
      if (!hasSheet('living-flame.webp')) { loadSheet('sheets/living-flame.webp').then(() => { if (inner.remainsOf?.actors?.[a.id]?.hp > 0) view.addActor(inner.remainsOf, a.id); }, () => {}); return null; }
      return createLivingFlame(view.tile, clock, [...String(a.id)].reduce((h, c) => h * 31 + c.charCodeAt(0) >>> 0, 7) % 97);
    }
    // RC15, UD9 (1.7 render.js:2350, deepmobs.js:643): fliers drawn up off the floor, a bat (not a Shade made from one)
    // half a tile, any other 0.12; hoverers bob higher still. Each on its own beat (1.7 added e.id to the clock).
    const fly = a.flags?.includes('flying'), shade = isShadeSummon(a), own = drawnLook(a);
    const hash = [...String(a.id)].reduce((h, c) => h * 31 + c.charCodeAt(0) >>> 0, 7);
    const air = fly ? (own.air && !shade ? own.air : 0.12) : 0, phase = hash % 628 / 100;
    // RC36 (1.7 render.js:1063): each body's idle runs (id*97)%500 ms off the others'. RC37, RC38 (render.js:1001, :1205):
    // an element-tier or still-posed row breathes if its sheet has no motion; a still-posed one holds its still (not a Shade).
    const row = monsters.rows?.[a.kind], idlePhase = ((Number.isFinite(+a.id) ? +a.id : hash) * 97) % 500;
    const still = !!row?.stillPose && !shade, elemental = !!(row?.elementTier || row?.stillPose);
    return createActorSprite(a.look, view.tile, clock, { size: a.size ?? 1, burrower: !!own.burrower, pose: own.pose ?? null, air, hover: !!a.flags?.includes('hover'), phase, idlePhase, still, elemental, clips: own.clips ?? null,
      fallDust: () => pieces.burst(a.x, a.y, 'earth', 10, 0.03) });   // FX13: a fall's dust where it stood (1.7 fx.js:169)
  };

  // RC10: an echo of the hero is drawn as 1.7's shadow clone, a grey-violet ghost at 72%, in its owner's gear.
  const bodyOf = (state, a) => {
    const s = makeSprite(a);
    if (s && a.kind === 'echo') { s.ghost(); if (view.gearOf && a.owner === state.playerId && state.hero) s.wear(view.gearOf(state.hero)); }
    // RC11 (1.7 isShadeSummon, render.js:928-939, :1214): the hero's Shades are grey-violet and see-through, not foes.
    // A Corrupted foe's Shade keeps its own kind with shade set (effects.js corrupt), so the flag decides (RC11, FX16).
    if (s && isShadeSummon(a)) s.shadeSummon();
    s?.charge(flameCharged(a));   // RC4
    // RC34 (1.7 render.js:1217-1227): a sheet's coloured edge, and the faint pale rim on an older sheet's foe (only foes in
    // sight are drawn); PT15 (1.7 prepareNaturalActor): the soft violet halo on a plane and in the Caverns.
    // A24 (1.7 cryptrooms.js:265-272 prepareCryptActor): in the Crypt a body on an unpainted sheet carries a pale lilac
    // halo, rgba(226,218,246) at .24 on a foe and .48 on others, blur max(2, tile x .07); never the hero.
    const natural = !!state.floor?.plane || state.floor?.biome === 'caverns', crypt = !natural && state.floor?.biome === 'crypt';
    if (s && a.id !== state.playerId) s.rim({ pale: a.side === 'foe', halo: natural ? (a.side === 'foe' ? 0.175 : 0.35) : crypt ? (a.side === 'foe' ? 0.24 : 0.48) : 0,
      ...(crypt ? { haloColour: 'rgb(226,218,246)', haloBlurTiles: 0.07, haloUnpainted: true } : {}) });
    if (s) clarity(s.root);
    // RC39 (1.7 render.js:2352-2354): a creature that has not moved yet faces the hero.
    const hero = state.actors[state.playerId];
    if (s?.watch && hero && a.id !== state.playerId) s.watch((hero.x - a.x) * view.tile);
    return s;
  };

  // How a few bodies are drawn from their state, each frame. CV15 (1.7 cavernmobs.js:640-646 drawCavernActor): a Shock
  // Eel in its water is faint (42%) and a tenth of a tile low until 2 turns after it bites or zaps. UD8: the Matron
  // channelling. E15 (1.7 elements.js:98-107 prepareTombActor): an entombed body, the hero too, shows inside the painted
  // ice block, fitted to 1.05 of its footprint on its feet at 52%.
  const tombs = new Map();
  const bodyLook = (id, s, a) => {
    if (!a) return; const own = monsters.rows?.[a.kind]?.look ?? {};   // render-19: faintInWater, channels
    s.sleep(!!a.asleep && id !== inner.sight.player);   // RC13: a sleeping creature holds still
    if (own.faintInWater) {
      const f = inner.markOf?.floor, st = inner.sight.state, wet = !!f && tileAt(f, a.x, a.y) === T.WATER;
      const faint = wet && !(a.surfacedAt !== undefined && (st?.actions ?? 0) - a.surfacedAt < 2);
      s.fade(faint ? 0.42 : 1); s.lower(faint ? 0.1 : 0);
    } else if (own.channels) s.channel(!!a.mt?.rit);
    let ice = tombs.get(id);
    if (ice?.destroyed) { tombs.delete(id); ice = null; }
    if (!a.statuses?.tomb) { if (ice) { ice.destroy(); tombs.delete(id); } return; }
    if (ice) return;
    const tex = objArt('props', 'ice-block'), n = s.size ?? 1;
    if (!tex) return;
    ice = objSprite(tex, (n - 1) / 2 - 0.5, n - 2, view.tile, { feet: true, fit: 1.05 * n, alpha: 0.52 });
    s.root.addChild(ice); tombs.set(id, ice);
  };
  return { isShadeSummon, flameCharged, paintedBody, bodyOf, tombs, bodyLook };
}
