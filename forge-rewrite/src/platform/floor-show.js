// Putting a floor on screen (consolidation C15, moved from main.js): the floor hold while its art loads, the art the
// budget keeps, the start of play and each new floor. S is the page's run state (main.js): game, ui, floorHold,
// shownFloor, stage, cssSize, resolution, arrival, startEarned, coachDue.

import { loadManifest, loadGroup, keepArt } from './assets.js';
import { PLAY_GROUPS, bodySheets, floorWant, floorGroups, roomArt, CORE_ART } from './floor-art.js';
import { refreshSight } from '../rules/sight.js';
import { bodyKey } from '../ui/model/hud-model.js';
import { TOUR } from '../ui/hud/tips.js';

// The floor the map shows (CH27: a change from below the Realm's first floor to it is the portal opening).
const REALM_FLOOR = 21;
const heroLook = g => g.actors[g.playerId]?.look?.sheet?.replace(/^cast-/, '') ?? g.hero.look;

export function createFloorShow(S, { map, notices, audio, drawFields, saves }) {
  // A floor whose art is still loading holds the game (1.7 renderer.js holdFloor/prepareFloorArt, pacing.js:13-17;
  // RB6, RB7, CSS-35): input waits, the map keeps the last floor's picture and takes no events of the new one, and
  // after 150 ms the floor notice says so. Art that fails to load turns it into "Some artwork could not load." with a
  // Retry, which asks again at once. Only the newest hold counts: a second Continue replaces the first.
  function holdFloor(words, load, then, failed = 'Some artwork could not load.') {
    const hold = S.floorHold = {};
    const attempt = retry => {
      const slow = setTimeout(() => { if (S.floorHold === hold) notices.floor(words); }, 150);
      load(retry).then(() => {
        clearTimeout(slow);
        if (S.floorHold !== hold) return;
        S.floorHold = null; notices.floor(null);
        then();
      }, e => {
        clearTimeout(slow);
        if (S.floorHold !== hold) return;
        console.error('Floor artwork could not load', e);
        notices.floor(failed, () => { notices.floor(words); attempt(true); });
      });
    };
    attempt(false);
  }
  /** The art the budget keeps while this floor is up: the core groups, this floor's and the next one's, the hero's look and the creatures' sheets. */
  // Proof pass (Chaos f21, Continue or a cold load): the floor's art is kept from the start of its hold, not only once it
  // shows. A hold can take half a minute; meanwhile each sheet that arrived over the art budget parked whatever the
  // old keep list left out and had not been drawn for 5 s: the hero, the portrait and the hotbar icons loaded first
  // (blank until they came back behind the queue), and the Realm's rock master before its islands were baked from it
  // (a flat dark slab). also: groups kept besides, as the floor still drawn while the next one loads.
  let kept = [];
  async function keepFloorArt(g = S.game, also = []) {
    const m = await loadManifest().catch(() => null);
    if (!m || !g) return;
    const groups = [...Object.keys(m.groups).filter(n => CORE_ART.test(n)), 'look-' + heroLook(g), ...floorWant(g.floorNo, g.floor?.plane ?? null), ...roomArt(g), ...floorWant(g.floorNo + 1), ...also];
    kept = [...floorWant(g.floorNo, g.floor?.plane ?? null), ...roomArt(g)];   // this floor's own, for the next hold
    keepArt(groups, Object.values(g.actors).map(a => a?.look?.sheet).filter(Boolean).map(s => `sheets/${s}.json`));
  }

  function enterPlay() {
    // Continue or New game before the stream has the first floor in: the floor notice, never a black screen; art
    // that fails gets the notice's Retry (RB6: a failure here used to hang with nothing said).
    const g = S.game;
    holdFloor('Preparing the dungeon…', async retry => {
      const o = { retry };
      await keepFloorArt(g);
      await Promise.all(PLAY_GROUPS.map(n => loadGroup(n, o)));
      // HUD item 4 (proof pass): the portrait's body comes in with the hero's look, so play never opens on a black portrait
      // (1.7 boot.js held for it too); a body that fails never holds play.
      const body = bodyKey(g.hero);
      await Promise.all([loadGroup('look-' + heroLook(g), o), ...(body ? [loadGroup('body-' + body, o).catch(() => {})] : []), floorGroups(g.floorNo, g.floor?.plane ?? null, o, roomArt(g))]);
      await bodySheets(Object.values(g.actors));
      await map.prepareFloor(g);   // WT8: a plane's or the Realm's terrain over the view drawn before it shows
    }, () => { if (S.game === g) showPlay(); });
  }
  function showPlay() {
    const { game, ui: uiApi } = S;
    if (!game.vis) refreshSight(game, null);
    if (S.cssSize) map.resize(S.cssSize[0], S.cssSize[1], S.stage.s, S.stage.kind, S.resolution);
    S.shownFloor = game.floorNo;
    map.setFloor(game);
    drawFields();
    uiApi.play(game, S.arrival ?? {}); S.arrival = null;
    saves.sayEarned(S.startEarned); S.startEarned = [];
    // A new run with the tutorial on opens How to play and Finding your way around, and a Cleric's the god card after them
    // (hud/tips.js TOUR; Justin 2026-10-22: "clerics would get that at start").
    if (S.coachDue) { S.coachDue = false; uiApi.offerTips?.([...TOUR, ...(game.hero?.cls === 'cleric' && game.hero?.faith?.god ? ['god'] : [])]); }
    audio.setScene(game);   // A8: the floor's tune and its ambience (a Forge's fire, the Water plane's water, none in the Caverns)
    keepFloorArt();
  }

  // A new floor may need its biome's or boss's art first; the next floor's is fetched ahead in the background.
  // A new biome or a plane changes the music (a plane plays 'plane-<element>'); the boss rooms start their own.
  function enterFloor(shake = 0) {
    audio.setScene(S.game);
    const g = S.game;
    // CH27 (1.7 chaos-campaign.js:137-156): stepping from the treasure room into the Realm says the portal is opening
    // while its art loads, and that it could not open when the art fails (Retry asks again); the old room stays drawn
    // and input waits (holdFloor) until the Realm is set.
    const realm = g.floorNo >= REALM_FLOOR && !g.floor.plane && S.shownFloor < REALM_FLOOR;
    S.shownFloor = g.floorNo;
    holdFloor(realm ? 'Entering the Realm of Chaos. The portal is opening…' : 'Preparing floor…', retry => keepFloorArt(g, kept).then(() => floorGroups(g.floorNo, g.floor.plane ?? null, { retry }, roomArt(g))).then(() => bodySheets(Object.values(g.actors))).then(() => map.prepareFloor(g)), () => {
      const { game, ui: uiApi } = S;
      if (game !== g) return;
      map.setFloor(game); drawFields(); uiApi.refresh(game); keepFloorArt();
      if (shake) map.pieces.shake(shake);   // G39 (1.7 transition-adapter.js:69 SHAKE=6): a portal's jolt once the plane is drawn
      floorGroups(game.floorNo + 1, null, { background: true }).catch(() => {});
    }, realm ? 'The portal could not open. Please try again.' : undefined);
  }
  return { enterPlay, enterFloor };
}
